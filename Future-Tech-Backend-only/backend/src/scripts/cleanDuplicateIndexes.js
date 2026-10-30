// Usage:
//   npm run db:clean-indexes             -> shows what WOULD be dropped (changes nothing)
//   npm run db:clean-indexes -- --apply  -> drops the duplicate unique indexes
//
// Fixes "Too many keys specified; max 64 keys allowed" on MySQL. See
// src/utils/cleanDuplicateIndexes.js for exactly what is (and is not) touched.
// Take a database backup first if this is a live database.
require("dotenv").config();
const sequelize = require("../config/database");
const { cleanDuplicateIndexes } = require("../utils/cleanDuplicateIndexes");

(async () => {
  try {
    await sequelize.authenticate();
    if (sequelize.getDialect() !== "mysql") {
      console.log(`Database is ${sequelize.getDialect()} - this problem only affects MySQL. Nothing to do.`);
      return process.exit(0);
    }
    const apply = process.argv.includes("--apply");
    const found = await cleanDuplicateIndexes(sequelize, { apply });

    if (!found.length) {
      console.log("No duplicate indexes found. Nothing to do.");
      return process.exit(0);
    }
    const perTable = {};
    found.forEach((f) => (perTable[f.table] = (perTable[f.table] || 0) + 1));
    console.log(apply ? "Duplicate indexes processed:" : "Duplicate indexes found (nothing changed yet):");
    Object.keys(perTable).forEach((t) => console.log(`  ${t.padEnd(22)} ${perTable[t]}`));

    if (apply) {
      const ok = found.filter((f) => f.dropped).length;
      const bad = found.filter((f) => f.error);
      console.log(`\nDropped ${ok} of ${found.length}.`);
      bad.forEach((f) => console.error(`  could not drop ${f.table}.${f.index}: ${f.error}`));
      return process.exit(bad.length ? 1 : 0);
    }
    console.log("\nRun again with --apply to drop them:  npm run db:clean-indexes -- --apply");
    process.exit(0);
  } catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
  }
})();
