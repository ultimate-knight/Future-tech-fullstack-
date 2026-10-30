require("dotenv").config();
const bcrypt = require("bcryptjs");
const { sequelize, Admin } = require("../models");

/**
 * Unlike ensureAdmin.js (which only creates an admin the very first time),
 * this FORCE-resets the admin matching ADMIN_EMAIL to the current
 * ADMIN_PASSWORD in .env — creating it if it doesn't exist yet.
 *
 * Use this whenever you've changed ADMIN_PASSWORD in .env and need the
 * database to actually match it (e.g. after rotating secrets on an
 * existing database).
 *
 * Usage: npm run db:reset-admin
 */
(async () => {
  try {
    await sequelize.authenticate();

    const email = (process.env.ADMIN_EMAIL || "admin@futuretech.org").toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!password) {
      console.error("❌ ADMIN_PASSWORD is not set in .env. Set it first, then re-run this.");
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [admin, created] = await Admin.findOrCreate({
      where: { email },
      defaults: { name: "Administrator", email, passwordHash },
    });

    if (!created) {
      admin.passwordHash = passwordHash;
      await admin.save();
    }

    console.log("----------------------------------------------------------");
    console.log(created ? "✅ Created new admin account:" : "✅ Reset password for existing admin account:");
    console.log(`  Email:    ${email}`);
    console.log(`  Password: (whatever ADMIN_PASSWORD is currently set to in .env)`);
    console.log("----------------------------------------------------------");
    process.exit(0);
  } catch (err) {
    console.error("Failed to reset admin:", err);
    process.exit(1);
  }
})();
