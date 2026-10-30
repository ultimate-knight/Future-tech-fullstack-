require("dotenv").config();
const { sequelize } = require("../models");
const { cleanDuplicateIndexes } = require("../utils/cleanDuplicateIndexes");

(async () => {
  try {
    await sequelize.authenticate();
    // MySQL: sync({ alter: true }) leaves one extra copy of every unique index
    // behind on each run (until "Too many keys"). Clear old copies first (so a
    // database already at the limit can still be updated), then the ones this
    // run adds. Only provably redundant duplicates are dropped.
    const before = await cleanDuplicateIndexes(sequelize, { apply: true });
    await sequelize.sync({ alter: true });
    const after = await cleanDuplicateIndexes(sequelize, { apply: true });
    const dropped = before.concat(after).filter((f) => f.dropped).length;
    if (dropped) console.log(`Removed ${dropped} duplicate index(es) left behind by earlier schema updates.`);
    console.log("Database tables created/updated successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  }
})();
