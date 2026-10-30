const { Op } = require("sequelize");

/**
 * Generates a human-readable, roughly-sequential receipt number, e.g.
 * FT-2026-000123.
 *
 * The serial is "highest serial already issued + 1", NOT "number of payment
 * rows + 1". The old count-based approach handed out the SAME number to
 * every payment confirmed back-to-back (the row count only changes when a
 * payment is CREATED, not when one is confirmed), so the second tick a
 * school made in a row hit the UNIQUE constraint on receiptNumber and
 * failed with "Could not mark this payment as paid". Counting also
 * produced duplicates after any payment row was deleted.
 *
 * The serial keeps increasing across years (only the year in the prefix
 * changes), same as the previous behaviour.
 *
 * Two confirmations at the very same instant can still compute the same
 * number - the UNIQUE constraint is the final guard, and the caller
 * (services/paymentService.js) retries with a fresh number when it trips.
 */
async function generateReceiptNumber(Payment) {
  const year = new Date().getFullYear();
  // "FT-" + 4-digit year + "-" + 6-digit serial; underscores are single-
  // character LIKE wildcards, so this only matches numbers in that shape.
  const last = await Payment.findOne({
    where: { receiptNumber: { [Op.like]: "FT-____-______" } },
    order: [["receiptNumber", "DESC"]],
    attributes: ["receiptNumber"],
  });
  const lastSerial = last ? parseInt(last.receiptNumber.slice(-6), 10) || 0 : 0;
  return `FT-${year}-${String(lastSerial + 1).padStart(6, "0")}`;
}

module.exports = generateReceiptNumber;
