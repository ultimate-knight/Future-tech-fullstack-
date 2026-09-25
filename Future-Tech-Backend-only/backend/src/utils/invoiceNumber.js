/**
 * Generates a human-readable, roughly-sequential school settlement
 * invoice number, e.g. INV-2026-000007. Same approach as
 * receiptNumber.js — fine for a single-instance deployment.
 */
async function generateInvoiceNumber(SchoolInvoice) {
  const year = new Date().getFullYear();
  const count = await SchoolInvoice.count();
  const serial = String(count + 1).padStart(6, "0");
  return `INV-${year}-${serial}`;
}

module.exports = generateInvoiceNumber;
