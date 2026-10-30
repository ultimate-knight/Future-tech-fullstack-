// Usage: npm run db:add-payment-unique-index
//
// OPTIONAL hardening. The app already prevents duplicate payment rows
// (routes/payments.js reuses an admission's existing unpaid row, and serialises
// simultaneous requests inside one Node process). This adds the same rule to
// the DATABASE - one payment row per (type, admissionId) - which also protects
// when the app runs as several processes.
//
// Safe by design: it makes NO changes if duplicate rows already exist (older
// versions created a new row on every retry). It lists them so you can decide
// which to keep, and exits. It never deletes anything.
require("dotenv").config();
const { sequelize, Payment } = require("../models");

const INDEX_NAME = "payments_type_admission_unique";

(async () => {
  try {
    const qi = sequelize.getQueryInterface();
    const existing = await qi.showIndex("payments");
    if (existing.some((i) => i.name === INDEX_NAME)) {
      console.log(`Index ${INDEX_NAME} already exists - nothing to do.`);
      return process.exit(0);
    }

    const rows = await Payment.findAll({ attributes: ["id", "type", "admissionId", "status", "amount", "referenceId", "createdAt"], order: [["createdAt", "ASC"]], raw: true });
    const groups = {};
    rows.forEach((r) => { (groups[`${r.type}:${r.admissionId}`] = groups[`${r.type}:${r.admissionId}`] || []).push(r); });
    const dups = Object.entries(groups).filter(([, g]) => g.length > 1);

    if (dups.length) {
      console.error(`Not creating the index: ${dups.length} admission(s) have more than one payment row.\n`);
      dups.forEach(([key, g]) => {
        console.error(key);
        g.forEach((r) => console.error(`   ${r.id}  ${r.status.padEnd(8)}  Rs.${r.amount}  ${r.referenceId || "(no reference)"}  ${new Date(r.createdAt).toISOString()}`));
      });
      console.error("\nResolve these by hand (keep the paid row if any, otherwise the newest), then run this again.");
      return process.exit(1);
    }

    await qi.addIndex("payments", ["type", "admissionId"], { unique: true, name: INDEX_NAME });
    console.log(`Created unique index ${INDEX_NAME} on payments(type, admissionId).`);
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
