const express = require("express");
const rateLimit = require("express-rate-limit");
const { Op } = require("sequelize");
const { body, validationResult } = require("express-validator");
const { IndividualAdmission, BulkAdmission, Payment, School } = require("../models");
const fees = require("../config/fees");
const { buildUpiUri, generateUpiQrDataUrl, getUpiConfig } = require("../services/upiService");
const generatePaymentReference = require("../utils/paymentReference");
const { withLock } = require("../utils/keyedLock");

const router = express.Router();

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

async function getAdmission(type, admissionId) {
  if (type === "individual") return IndividualAdmission.findByPk(admissionId);
  if (type === "bulk") return BulkAdmission.findByPk(admissionId);
  return null;
}

function computeBulkAmount(admission) {
  return Math.max(
    fees.bulkMinimum,
    (admission.studentCount || 0) * fees.bulkPerStudent || fees.bulkMinimum
  );
}

// Only the endpoint that creates a new payment (and therefore a fresh QR
// code) is rate-limited this tightly - it's the one an abusive script could
// hammer to spam pending-payment rows. The status-check endpoint below gets
// its own, much more generous limiters (see below) since the browser polls
// it every few seconds for as long as the QR modal stays open.
const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please try again in a few minutes." },
});

// Result of the "create or reuse the payment row" step. Returned (not
// thrown) so the HTTP status stays with the route handler.
function fail(status, error) {
  return { fail: { status, error } };
}

// Creates the payment row, retrying if the freshly generated reference was
// taken by another request in the same instant (UNIQUE referenceId).
//
// Allocation is serialised in-process (one reference at a time): when a whole
// class pays at the same moment, every request would otherwise compute the
// SAME "next" reference and fight over it. The retry below remains as the
// safety net for the rare cross-process clash.
function createPaymentRow(fields) {
  return withLock("payment-reference", () => createPaymentRowUnlocked(fields));
}

async function createPaymentRowUnlocked(fields) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    const referenceId = await generatePaymentReference(Payment);
    try {
      return await Payment.create({ ...fields, referenceId });
    } catch (err) {
      if (err && err.name === "SequelizeUniqueConstraintError") {
        // Another request may have created THE payment for this admission
        // (only possible across processes / without the in-process lock) -
        // use theirs instead of failing or duplicating.
        const existing = await Payment.findOne({
          where: { type: fields.type, admissionId: fields.admissionId },
          order: [["createdAt", "DESC"]],
        });
        if (existing) return existing;
        if (attempt < MAX_ATTEMPTS) continue; // reference clash - draw a new one
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------
// POST /api/payments/create-order
// Body: { type: 'individual'|'bulk', admissionId, payerName, payerEmail, payerPhone,
//         months?, expectedAmount? }
//
// The amount is NEVER trusted from the client - it's always recomputed
// server-side from the admission record + the fee config, so nobody can
// tamper with the price by editing the request:
//   individual: monthly fee of the admission's level x payment period
//               (months, default = the 5-month program)
//   bulk:       per-student fee x student count (unchanged)
// `expectedAmount` is optional: it is the figure the page showed the payer.
// If it doesn't match what the server calculates (stale page, fee changed)
// the request is refused instead of silently charging a different amount.
//
// One Payment row per admission, ever: an unpaid/failed row is reused (so
// "Try Payment Again" and double-clicks never create duplicates) and an
// admission that is already paid is refused.
//
// Creates a "pending" Payment row with our own reference id, and returns a
// UPI deep-link + QR code for that exact amount. Nothing is marked paid
// here - the parent scans/pays on their own UPI app, and the school (or an
// admin) confirms the payment later after checking it actually landed in the
// bank account.
// ---------------------------------------------------------------------
router.post(
  "/create-order",
  createOrderLimiter,
  [
    body("type").isIn(["individual", "bulk"]).withMessage("Invalid payment type."),
    body("admissionId").notEmpty().withMessage("admissionId is required."),
    body("months").optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 60 }).withMessage("Invalid payment period."),
    body("expectedAmount").optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage("Invalid expected amount."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { type, admissionId, payerName, payerEmail, payerPhone, months, expectedAmount } = req.body;

    try {
      // Serialise requests for the same admission so "look for an existing
      // payment, else create one" can't race itself into two rows.
      const outcome = await withLock(`${type}:${admissionId}`, async () => {
        const admission = await getAdmission(type, admissionId);
        if (!admission) return fail(404, "Admission record not found.");

        if (admission.paymentStatus === "paid") {
          return fail(409, "This admission has already been paid for.");
        }
        // Belt and braces: a confirmed payment row means "already paid" even
        // if the admission's own status was never updated.
        const alreadyPaid = await Payment.findOne({ where: { type, admissionId: admission.id, status: "paid" } });
        if (alreadyPaid) return fail(409, "This admission has already been paid for.");

        // ---- work out the amount (server side only) ----
        let amount;
        let breakdown = {};
        if (type === "individual") {
          const pricing = fees.calculateIndividualFee(admission.programLevel, months);
          if (pricing.error) return fail(400, pricing.error);
          amount = pricing.total;
          breakdown = {
            studentName: admission.studentName,
            programLevel: pricing.level,
            paymentMonths: pricing.months,
            monthlyFee: pricing.monthlyFee,
          };
        } else {
          amount = computeBulkAmount(admission);
        }

        if (expectedAmount !== undefined && expectedAmount !== null && expectedAmount !== "" && Number(expectedAmount) !== amount) {
          return fail(
            409,
            `The fee shown on the page (Rs. ${Number(expectedAmount).toLocaleString("en-IN")}) does not match the current fee ` +
              `(Rs. ${amount.toLocaleString("en-IN")}). Please refresh the page and try again.`
          );
        }

        // ---- create the payment row, or reuse the existing unpaid one ----
        let payment = await Payment.findOne({
          where: { type, admissionId: admission.id, status: { [Op.ne]: "paid" } },
          order: [["createdAt", "DESC"]],
        });

        if (payment) {
          payment.status = "pending";
          payment.amount = amount;
          Object.assign(payment, breakdown);
          payment.payerName = payerName || payment.payerName || "";
          payment.payerEmail = payerEmail || payment.payerEmail || "";
          payment.payerPhone = payerPhone || payment.payerPhone || "";
          await payment.save();
        } else {
          payment = await createPaymentRow({
            type,
            admissionId: admission.id,
            amount,
            currency: fees.currency,
            status: "pending",
            payerName: payerName || "",
            payerEmail: payerEmail || "",
            payerPhone: payerPhone || "",
            ...breakdown,
          });
        }

        return { payment, admission, amount, breakdown };
      });

      if (outcome.fail) return res.status(outcome.fail.status).json({ error: outcome.fail.error });

      const { payment, admission, amount, breakdown } = outcome;
      const referenceId = payment.referenceId;

      // Route the money straight to the school's own account when this
      // admission is tied to a school that's configured its own UPI ID
      // (Schools tab -> "Set UPI ID"). Falls back to the platform-wide
      // UPI_VPA/UPI_PAYEE_NAME from .env for admissions not tied to any
      // school, or tied to a school that hasn't set one up yet.
      let schoolVpa;
      let schoolPayeeName;
      if (admission.schoolId) {
        const school = await School.findByPk(admission.schoolId);
        if (school && school.upiVpa) {
          schoolVpa = school.upiVpa;
          schoolPayeeName = school.upiPayeeName || school.schoolName;
        }
      }

      const noteSubject =
        type === "individual" ? admission.studentName : admission.organizationName;
      const note = `${referenceId}${noteSubject ? " " + noteSubject : ""}`;
      const upiUri = buildUpiUri({
        amount,
        refId: referenceId,
        note,
        vpa: schoolVpa,
        payeeName: schoolPayeeName,
      });
      const qrCodeDataUrl = await generateUpiQrDataUrl(upiUri);

      res.status(201).json({
        paymentId: payment.id,
        referenceId,
        amount,
        currency: fees.currency,
        // Individual payments only - lets the page show "Rs. 500 x 5 months".
        programLevel: breakdown.programLevel,
        paymentMonths: breakdown.paymentMonths,
        monthlyFee: breakdown.monthlyFee,
        upiUri,
        qrCodeDataUrl,
        vpa: schoolVpa || getUpiConfig().vpa,
        payeeName: schoolPayeeName || getUpiConfig().payeeName,
      });
    } catch (err) {
      console.error("create-order error", err);
      const message =
        err.message && err.message.startsWith("UPI payments are not configured")
          ? err.message
          : "Could not initiate payment. Please try again.";
      res.status(500).json({ error: message });
    }
  }
);

// The browser polls the status endpoint every few seconds while the QR modal
// is open. Two layers, so one busy network can't lock everyone out:
//  - per PAYMENT (what a single open modal actually needs): 120 / 5 min
//  - per IP (a ceiling against scripts): generous, because a whole school
//    lab / office often shares ONE public IP. Previously a flat 120 / 5 min
//    per IP meant just three students paying at the same time from one
//    school network got "429 Too many status checks", which the page used to
//    swallow silently - leaving the "waiting" spinner on forever.
const statusIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status checks. Please wait a moment and try again." },
});
const statusPaymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `payment-status:${req.params.paymentId}`,
  message: { error: "Too many status checks for this payment. Please wait a moment and try again." },
});

// ---------------------------------------------------------------------
// GET /api/payments/:paymentId/status
//
// Polled by the browser while the "scan & pay" QR modal is open, so the
// page can pick up the moment the school/admin confirms the payment and hand
// the payer their receipt link - without the payer needing to do anything
// else or refresh the page.
//
// Reachable with just the payment's own (cryptographically random,
// unguessable) UUID - same capability-URL pattern as the receipt download
// link (see src/routes/receipts.js) - and returns nothing more sensitive
// than the status, the amount/reference the payer already saw, and the
// receipt link.
// ---------------------------------------------------------------------
router.get("/:paymentId/status", statusIpLimiter, statusPaymentLimiter, async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found." });

    res.json({
      status: payment.status,
      amount: payment.amount,
      referenceId: payment.referenceId,
      paymentMonths: payment.paymentMonths || undefined,
      monthlyFee: payment.monthlyFee || undefined,
      receiptNumber: payment.status === "paid" ? payment.receiptNumber : undefined,
      downloadUrl: payment.status === "paid" ? `/api/receipts/${payment.id}/download` : undefined,
    });
  } catch (err) {
    console.error("payment status error", err);
    res.status(500).json({ error: "Could not check payment status." });
  }
});

module.exports = router;
