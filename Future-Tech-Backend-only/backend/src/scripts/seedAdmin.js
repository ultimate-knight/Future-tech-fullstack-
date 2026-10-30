require("dotenv").config();
const { sequelize } = require("../models");
const ensureAdminExists = require("./ensureAdmin");

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    await ensureAdminExists();
    process.exit(0);
  } catch (err) {
    console.error("Failed to seed admin:", err);
    process.exit(1);
  }
})();
