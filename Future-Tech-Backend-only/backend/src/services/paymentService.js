const { Payment } = require("../models");
const generateReceiptNumber = require("../utils/receiptNumber");
const { generateReceiptPdf } = require("./receiptService");

async function getAdmission(type, admissionId) {
  // Lazy require to sidestep a require-cycle with models/index.js.
  const { IndividualAdmission, BulkAdmission } = require("../models");
  if (type === "individual") return IndividualAdmission.findByPk(admissionId);
  if (type === "bulk") return BulkAdmission.findByPk(admissionId);
  return null;
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

  const receiptNumber = await generateReceiptNumber(Payment);

  payment.status = "paid";
  payment.receiptNumber = receiptNumber;
  if (meta.markedPaidByAdminId) {
    payment.markedPaidByAdminId = meta.markedPaidByAdminId;
    payment.markedPaidAt = new Date();
  } else if (meta.markedPaidBySchoolId) {
    payment.markedPaidBySchoolId = meta.markedPaidBySchoolId;
    payment.markedPaidAt = new Date();
  }
  await payment.save();

  const admission = await getAdmission(payment.type, payment.admissionId);
  if (admission) {
    admission.paymentStatus = "paid";
    admission.paymentId = payment.id;
    await admission.save();
  }

  await generateReceiptPdf(payment, admission, payment.type);

  return payment;
}

module.exports = { confirmPaymentPaid, getAdmission };
