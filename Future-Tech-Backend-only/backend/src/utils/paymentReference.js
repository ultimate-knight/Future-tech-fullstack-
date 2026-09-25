/**
 * Generates a human-readable, roughly-sequential payment reference, e.g.
 * FTPAY-2026-000123. Set on the Payment record at creation time and reused
 * as both the UPI transaction reference (tr=) and the note shown in the
 * payer's UPI app — the same string the admin later searches for in the
 * bank statement to confirm and match a payment. Same "count of existing
 * rows" approach as utils/receiptNumber.js — fine for a single-instance
 * deployment; use a DB sequence instead for multi-instance/high concurrency.
 */
async function generatePaymentReference(Payment) {
  const year = new Date().getFullYear();
  const count = await Payment.count();
  const serial = String(count + 1).padStart(6, "0");
  return `FTPAY-${year}-${serial}`;
}

module.exports = generatePaymentReference;
