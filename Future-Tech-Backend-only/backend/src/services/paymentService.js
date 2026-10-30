const path = require("path");
const fs = require("fs");
const { Op } = require("sequelize");
const { Payment } = require("../models");
const { withLock } = require("../utils/keyedLock");
const generateReceiptNumber = require("../utils/receiptNumber");
const { generateReceiptPdf, SCHOOL_LOGO_DIR } = require("./receiptService");

async function getAdmission(type, admissionId) {
  // Lazy require to sidestep a require-cycle with models/index.js.
  const { IndividualAdmission, BulkAdmission } = require("../models");
  if (type === "individual") return IndividualAdmission.findByPk(admissionId);
  if (type === "bulk") return BulkAdmission.findByPk(admissionId);
  return null;
}

// Resolves the absolute path to a school's uploaded logo file, if they
// have one - used so receipts can show it alongside the Future Tech
// name. Returns null (never throws) if there's no school, no logo, or
// the file's gone missing from disk.
async function getSchoolLogoPath(schoolId) {
  if (!schoolId) return null;
  try {
    const { School } = require("../models");
    const school = await School.findByPk(schoolId, { attributes: ["logoFilename"] });
    if (!school || !school.logoFilename) return null;
    const logoPath = path.join(SCHOOL_LOGO_DIR, school.logoFilename);
    return fs.existsSync(logoPath) ? logoPath : null;
  } catch (err) {
    console.error("getSchoolLogoPath lookup error (continuing without logo)", err);
    return null;
  }
}

/**
 * Marks a Payment (and its linked admission) as paid and generates the PDF
 * receipt, if that hasn't already happened. Safe to call more than once for
 * the same payment — it's a no-op after the first successful call.
 *
 * Used from two places: the platform admin's "Mark as Paid" action
 * (src/routes/admin.js) and a school confirming their own payment from
 * their own portal (src/routes/schools.js) — since payments now go
 * straight into whichever account was configured for that admission
 * (school's own UPI, or the platform's), it's whoever's responsible for
 * that account who checks and confirms it. There is no automatic path -
 * every payment is confirmed by a human.
 *
 * @param {object} payment
 * @param {Object} [meta]
 * @param {string} [meta.markedPaidByAdminId]  - Admin.id, if a platform admin confirmed it
 * @param {string} [meta.markedPaidBySchoolId] - School.id, if the school confirmed it themselves
 */
async function confirmPaymentPaid(payment, meta = {}) {
  if (payment.status === "paid") {
    return payment; // already handled - nothing to do
  }

  // Integrity check: for payments that carry their fee breakdown, the stored
  // amount must still equal monthly fee x months. (It is always written that
  // way by POST /api/payments/create-order; this only trips if a row was
  // edited by hand or by a bug - better to refuse than issue a receipt for a
  // wrong amount.) Compared against the row's OWN breakdown, not today's
  // fee table, so a later fee change never blocks a legitimate payment.
  if (payment.monthlyFee && payment.paymentMonths && payment.amount !== payment.monthlyFee * payment.paymentMonths) {
    const err = new Error(
      "The amount on this payment record does not match its fee breakdown " +
        `(${payment.monthlyFee} x ${payment.paymentMonths} months). Please contact support before confirming it.`
    );
    err.statusCode = 409;
    throw err;
  }

  // Claim the payment atomically: the UPDATE only applies while the row is
  // still not "paid", so two simultaneous confirmations (double-click, school
  // + admin at once) cannot both issue a receipt number. Retry with a fresh
  // receipt number if another payment grabbed the same one a moment ago.
  const MAX_ATTEMPTS = 5;
  let claimed = false;
  // One receipt number is allocated at a time (in-process) so a school
  // ticking many payments at once doesn't make them all race for the same
  // number; the retry on a UNIQUE clash covers anything that slips through.
  await withLock("receipt-number", async () => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const receiptNumber = await generateReceiptNumber(Payment);
    const changes = { status: "paid", receiptNumber, markedPaidAt: new Date() };
    if (meta.markedPaidByAdminId) changes.markedPaidByAdminId = meta.markedPaidByAdminId;
    else if (meta.markedPaidBySchoolId) changes.markedPaidBySchoolId = meta.markedPaidBySchoolId;
    else delete changes.markedPaidAt;

    try {
      const [affected] = await Payment.update(changes, {
        where: { id: payment.id, status: { [Op.ne]: "paid" } },
      });
      claimed = affected > 0;
      break;
    } catch (err) {
      const isReceiptClash = err && err.name === "SequelizeUniqueConstraintError";
      if (!isReceiptClash || attempt === MAX_ATTEMPTS) throw err;
      console.warn(`[payment] receipt number ${receiptNumber} was taken at the same moment; retrying (${attempt}/${MAX_ATTEMPTS - 1}).`);
    }
  }
  });

  await payment.reload();
  if (!claimed) {
    return payment; // someone else confirmed it first - nothing more to do
  }

  const admission = await getAdmission(payment.type, payment.admissionId);
  if (admission) {
    admission.paymentStatus = "paid";
    admission.paymentId = payment.id;
    await admission.save();
  }

  // The payment is already confirmed at this point. A PDF problem (disk full,
  // unreadable logo...) must not turn a successful confirmation into an error
  // for the school: the receipt is rebuilt on first download anyway (see
  // routes/receipts.js), so log it and carry on.
  try {
    await generateReceiptPdf(payment, admission, payment.type, await getSchoolLogoPath(admission && admission.schoolId));
  } catch (pdfErr) {
    console.error(
      `[payment] Payment ${payment.id} IS confirmed (receipt ${payment.receiptNumber}) but its receipt PDF could not be written; ` +
        "it will be rebuilt on first download:",
      pdfErr
    );
  }

  return payment;
}

module.exports = { confirmPaymentPaid, getAdmission, getSchoolLogoPath };
