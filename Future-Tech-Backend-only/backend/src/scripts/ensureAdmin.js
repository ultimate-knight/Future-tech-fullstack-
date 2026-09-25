const bcrypt = require("bcryptjs");
const { Admin } = require("../models");

/**
 * If no admin account exists yet, creates one from ADMIN_EMAIL /
 * ADMIN_PASSWORD in .env. Safe to call on every server start — it's a
 * no-op once at least one admin exists.
 */
async function ensureAdminExists() {
  const count = await Admin.count();
  if (count > 0) return;

  const email = (process.env.ADMIN_EMAIL || "admin@futuretech.org").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "change-this-password";

  const passwordHash = await bcrypt.hash(password, 10);
  await Admin.create({ name: "Administrator", email, passwordHash });

  console.log("----------------------------------------------------------");
  console.log(`No admin account found — created one from .env:`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: (whatever you set as ADMIN_PASSWORD in .env)`);
  console.log(`Log in at the admin page and change this password's account`);
  console.log(`details as needed. Change ADMIN_PASSWORD in .env for future`);
  console.log(`fresh installs.`);
  console.log("----------------------------------------------------------");
}

module.exports = ensureAdminExists;
