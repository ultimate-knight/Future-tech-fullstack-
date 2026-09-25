/**
 * Generates a human-readable, roughly-sequential receipt number, e.g.
 * FT-2026-000123. Uses the count of existing payments as the running
 * number, which is fine for a single-instance deployment; for a
 * multi-instance/high-concurrency production setup you'd want a DB
 * sequence instead.
 */
async function generateReceiptNumber(Payment) {
  const year = new Date().getFullYear();
  const count = await Payment.count();
  const serial = String(count + 1).padStart(6, "0");
  return `FT-${year}-${serial}`;
}

module.exports = generateReceiptNumber;
