const express = require("express");
const rateLimit = require("express-rate-limit");
const { Op } = require("sequelize");
const { body, validationResult } = require("express-validator");
const { IndividualAdmission, BulkAdmission, Payment, School } = require("../models");
const fees = require("../config/fees");
const { buildUpiUri, generateUpiQrDataUrl, getUpiConfig } = require("../services/upiService");
const generatePaymentReference = require("../utils/paymentReference");

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

function computeAmount(type, admission) {
  if (type === "individual") {
    return fees.individualLevelFees[admission.programLevel];
  }
  return Math.max(
    fees.bulkMinimum,
    (admission.studentCount || 0) * fees.bulkPerStudent || fees.bulkMinimum
  );
}

// Only the endpoint that creates a new payment (and therefore a fresh QR
// code) is rate-limited this tightly - it's the one an abusive script could
// hammer to spam pending-payment rows. The status-check endpoint below gets
// its own, much more generous limiter (see below) since the browser polls
// it every few seconds for as long as the QR modal stays open.
const createOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please try again in a few minutes." },
});

// ---------------------------------------------------------------------
// POST /api/payments/create-order
// Body: { type: 'individual'|'bulk', admissionId, payerName, payerEmail, payerPhone }
//
// The amount is NEVER trusted from the client - it's always recomputed
// server-side from the admission record + the fee config, so nobody can
// tamper with the price by editing the request.
//
// Creates a "pending" Payment row with our own reference id, and returns a
// UPI deep-link + QR code for that exact amount. Nothing is marked paid
// here - the parent scans/pays on their own UPI app, and an admin
// confirms the payment later (see POST /api/admin/payments/:id/mark-paid)
// after checking it actually landed in the bank account.
// ---------------------------------------------------------------------
router.post(
  "/create-order",
  createOrderLimiter,
  [
    body("type").isIn(["individual", "bulk"]).withMessage("Invalid payment type."),
    body("admissionId").notEmpty().withMessage("admissionId is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { type, admissionId, payerName, payerEmail, payerPhone } = req.body;

    try {
      const admission = await getAdmission(type, admissionId);
      if (!admission) return res.status(404).json({ error: "Admission record not found." });

      if (admission.paymentStatus === "paid") {
        return res.status(409).json({ error: "This admission has already been paid for." });
      }

      const amount = computeAmount(type, admission);

      // Reuse an existing pending/failed payment for this admission instead
      // of creating a new row every time. Without this, clicking "Try
      // Payment Again" after a failed/abandoned attempt created a brand
      // new Payment (and, once paid, a new receipt number) each retry -
      // leaving old rows behind and skipping receipt numbers.
      let payment = await Payment.findOne({
        where: { type, admissionId: admission.id, status: { [Op.ne]: "paid" } },
        order: [["createdAt", "DESC"]],
      });

      if (payment) {
        payment.status = "pending";
        payment.amount = amount;
        payment.payerName = payerName || payment.payerName || "";
        payment.payerEmail = payerEmail || payment.payerEmail || "";
        payment.payerPhone = payerPhone || payment.payerPhone || "";
        await payment.save();
      } else {
        const referenceId = await generatePaymentReference(Payment);
        payment = await Payment.create({
          type,
          admissionId: admission.id,
          amount,
          currency: fees.currency,
          referenceId,
          status: "pending",
          payerName: payerName || "",
          payerEmail: payerEmail || "",
          payerPhone: payerPhone || "",
        });
      }

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

const statusLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120, // the QR modal polls every few seconds while open - this is generous on purpose
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many status checks. Please slow down." },
});

// ---------------------------------------------------------------------
// GET /api/payments/:paymentId/status
//
// Polled by the browser while the "scan & pay" QR modal is open, so the
// page can pick up the moment an admin confirms the payment and hand the
// payer their receipt link - without the payer needing to do anything
// else or refresh the page.
//
// Reachable with just the payment's own (cryptographically random,
// unguessable) UUID - same capability-URL pattern as the receipt download
// link (see src/routes/receipts.js) - and returns nothing more sensitive
// than the status + receipt link.
// ---------------------------------------------------------------------
router.get("/:paymentId/status", statusLimiter, async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found." });

    res.json({
      status: payment.status,
      receiptNumber: payment.status === "paid" ? payment.receiptNumber : undefined,
      downloadUrl: payment.status === "paid" ? `/api/receipts/${payment.id}/download` : undefined,
    });
  } catch (err) {
    console.error("payment status error", err);
    res.status(500).json({ error: "Could not check payment status." });
  }
});

module.exports = router;
