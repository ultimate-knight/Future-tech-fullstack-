/**
 * Gives every existing payment row that predates the UPI QR change a
 * referenceId, so old rows show something useful in the admin Payments
 * tab instead of a blank "Reference" column. Safe to run more than once
 * - only touches rows where referenceId is still null.
 *
 * These are backfilled, not real UPI transaction references (those old
 * payments went through Razorpay, not UPI) - marked "LEGACY" so that's
 * obvious at a glance and nobody goes searching a bank statement for one.
 *
 * Usage:  node src/scripts/backfillPaymentReferences.js
 */
require("dotenv").config();
const { Payment } = require("../models");
const sequelize = require("../config/database");

async function run() {
  const rows = await Payment.findAll({
    where: { referenceId: null },
    order: [["createdAt", "ASC"]],
  });

  if (!rows.length) {
    console.log("No payments are missing a reference - nothing to do.");
    return;
  }

  console.log(`Backfilling reference ids for ${rows.length} payment(s)...`);
  let serial = 0;
  for (const row of rows) {
    serial += 1;
    const year = new Date(row.createdAt).getFullYear();
    row.referenceId = `FTPAY-${year}-LEGACY-${String(serial).padStart(6, "0")}`;
    await row.save();
    console.log(`  ${row.id} -> ${row.referenceId}`);
  }
  console.log("Done.");
}

run()
  .catch((err) => {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
