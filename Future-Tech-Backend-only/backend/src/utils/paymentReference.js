const { Op } = require("sequelize");

/**
 * Generates a human-readable, roughly-sequential payment reference, e.g.
 * FTPAY-2026-000123. Set on the Payment record at creation time and reused
 * as both the UPI transaction reference (tr=) and the note shown in the
 * payer's UPI app - the same string the admin/school later searches for in
 * the bank statement to confirm and match a payment.
 *
 * The serial is "highest serial already issued + 1" rather than "row count
 * + 1": counting handed out an already-used reference (and so failed the
 * UNIQUE constraint with a 500) as soon as any payment row had been deleted
 * - e.g. by deleting a student in the admin panel. Legacy back-filled
 * references (FTPAY-2026-LEGACY-000001, see scripts/backfillPaymentReferences.js)
 * are ignored because they do not match the strict FTPAY-YYYY-NNNNNN shape.
 *
 * Concurrent callers can still compute the same value; the UNIQUE
 * constraint is the final guard and routes/payments.js retries on conflict.
 */
async function generatePaymentReference(Payment) {
  const year = new Date().getFullYear();
  const last = await Payment.findOne({
    where: { referenceId: { [Op.like]: "FTPAY-____-______" } },
    order: [["referenceId", "DESC"]],
    attributes: ["referenceId"],
  });
  const lastSerial = last ? parseInt(last.referenceId.slice(-6), 10) || 0 : 0;
  return `FTPAY-${year}-${String(lastSerial + 1).padStart(6, "0")}`;
}

module.exports = generatePaymentReference;
