require("dotenv").config();
const { sequelize } = require("../models");

(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });
    console.log("Database tables created/updated successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  }
})();
