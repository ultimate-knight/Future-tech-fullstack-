/**
 * One-off migration for the Razorpay -> UPI QR payments change.
 *
 * Run this ONCE, BEFORE `npm run db:init`, on any database that already
 * has rows in the `payments` table (i.e. any real deployment, as opposed
 * to a brand new empty database).
 *
 * Why this is needed: the new Payment model narrows `status` from
 * ENUM('created','paid','failed') to ENUM('pending','paid','failed').
 * MySQL/Postgres both refuse to narrow an ENUM out from under rows that
 * still hold the value being removed ('created') - so this script widens
 * the enum first, migrates the data, then narrows it back down.
 *
 * (The other half of this migration - `referenceId` going from
 * NOT NULL UNIQUE to nullable UNIQUE - doesn't need a script; it's just
 * a plain nullable column add, which `db:init` handles fine on its own.
 * Run backfillPaymentReferences.js afterwards if you'd like old rows to
 * have a real reference too, instead of a blank one.)
 *
 * Usage:  node src/scripts/migrateToUpiPayments.js
 */
require("dotenv").config();
const sequelize = require("../config/database");

async function run() {
  const dialect = sequelize.getDialect();
  console.log(`Detected DB dialect: ${dialect}`);

  try {
    if (dialect === "mysql" || dialect === "mariadb") {
      console.log("1/3 Widening payments.status enum to allow both 'created' and 'pending'...");
      await sequelize.query(
        "ALTER TABLE `payments` MODIFY `status` ENUM('created','pending','paid','failed') DEFAULT 'pending'"
      );

      console.log("2/3 Migrating old 'created' rows to 'pending'...");
      const [result] = await sequelize.query(
        "UPDATE `payments` SET `status` = 'pending' WHERE `status` = 'created'"
      );
      console.log(`     -> updated ${result.affectedRows || 0} row(s)`);

      console.log("3/3 Narrowing payments.status enum back down...");
      await sequelize.query(
        "ALTER TABLE `payments` MODIFY `status` ENUM('pending','paid','failed') DEFAULT 'pending'"
      );
    } else if (dialect === "postgres") {
      console.log("1/3 Widening the payments status enum type...");
      await sequelize.query(`ALTER TYPE "enum_payments_status" ADD VALUE IF NOT EXISTS 'pending'`);

      console.log("2/3 Migrating old 'created' rows to 'pending'...");
      const [, result] = await sequelize.query(
        `UPDATE "payments" SET "status" = 'pending' WHERE "status" = 'created'`
      );
      console.log(`     -> updated ${result.rowCount || 0} row(s)`);

      console.log(
        "3/3 Postgres doesn't support removing a single enum value directly - " +
          "'created' will remain a harmless, unused option in the enum type. Not a problem: " +
          "nothing in the app ever sets or expects it again."
      );
    } else {
      console.log(
        `SQLite doesn't enforce ENUM at the database level, so there's nothing to migrate here - ` +
          `old 'created' rows are just treated the same as 'pending' by the app from now on ` +
          `(both mean "awaiting confirmation"). You can run db:init directly.`
      );
    }

    console.log("\nDone. You can now safely run: npm run db:init");
  } catch (err) {
    console.error("\nMigration failed:", err.message);
    console.error(
      "Nothing else was changed by this script beyond what's logged above - safe to re-run after fixing the issue."
    );
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

run();
