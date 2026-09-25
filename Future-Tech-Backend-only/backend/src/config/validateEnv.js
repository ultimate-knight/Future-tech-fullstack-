// ---------------------------------------------------------------------------
// Startup environment validation.
//
// This is a safety net for the "should fix before go-live" checklist:
//   1. Rotate all secrets (JWT_SECRET, ADMIN_PASSWORD, DB credentials)
//   2. Move off localhost (CORS_ORIGIN must point at the real domain)
//   3. Confirm the UPI receiving details are actually filled in
//
// In production (NODE_ENV=production) this REFUSES TO START the server if
// any of these are still set to development/test/placeholder values, so a
// developer can't accidentally ship the dev secrets to real users.
//
// In development it only prints warnings, so local work is never blocked.
// ---------------------------------------------------------------------------

const KNOWN_DEV_JWT_SECRETS = [
  "test-secret-for-student-lms-verification",
  "replace-this-with-a-long-random-string",
];

const KNOWN_DEV_PASSWORDS = [
  "test123456",
  "change-this-password",
  "password",
  "admin123",
];

const KNOWN_DEV_DB_PASSWORDS = ["aniketh", "root", "password", ""];

function validateEnv() {
  const isProduction = process.env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  // -------------------------------------------------------------------
  // 1. Secrets: JWT_SECRET, ADMIN_PASSWORD, DB credentials
  // -------------------------------------------------------------------
  const jwtSecret = process.env.JWT_SECRET || "";
  if (!jwtSecret) {
    errors.push("JWT_SECRET is not set.");
  } else if (KNOWN_DEV_JWT_SECRETS.includes(jwtSecret)) {
    (isProduction ? errors : warnings).push(
      "JWT_SECRET is still set to a known development/placeholder value. Generate a fresh one with:\n" +
        "    node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
    );
  } else if (jwtSecret.length < 32) {
    (isProduction ? errors : warnings).push(
      "JWT_SECRET is shorter than 32 characters. Use a longer, random value."
    );
  }

  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (KNOWN_DEV_PASSWORDS.includes(adminPassword.toLowerCase())) {
    (isProduction ? errors : warnings).push(
      "ADMIN_PASSWORD is still set to a known development/placeholder value. Set a strong, unique password " +
        "(you can change it again after first login from the admin dashboard)."
    );
  }

  if (["postgres", "mysql"].includes((process.env.DB_DIALECT || "").toLowerCase())) {
    const dbPassword = process.env.DB_PASSWORD || "";
    if (KNOWN_DEV_DB_PASSWORDS.includes(dbPassword.toLowerCase())) {
      (isProduction ? errors : warnings).push(
        "DB_PASSWORD looks like a development/placeholder value. Use a real, unique database password in production."
      );
    }
  }

  // -------------------------------------------------------------------
  // 2. Move off localhost: CORS_ORIGIN must be the real domain in prod
  // -------------------------------------------------------------------
  const corsOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (isProduction) {
    if (corsOrigins.length === 0) {
      errors.push("CORS_ORIGIN is empty. Set it to your real production domain(s), e.g. https://www.yourschoolprogram.com");
    }
    const localOrigins = corsOrigins.filter((o) => /localhost|127\.0\.0\.1/i.test(o));
    if (localOrigins.length > 0) {
      errors.push(
        `CORS_ORIGIN still contains a localhost/127.0.0.1 entry (${localOrigins.join(", ")}) while NODE_ENV=production. ` +
          "Update it to your real deployed domain over HTTPS."
      );
    }
    const insecureOrigins = corsOrigins.filter((o) => o.startsWith("http://") && !/localhost|127\.0\.0\.1/i.test(o));
    if (insecureOrigins.length > 0) {
      warnings.push(
        `CORS_ORIGIN contains a plain http:// origin (${insecureOrigins.join(", ")}). Production traffic should use https://.`
      );
    }
  }

  // -------------------------------------------------------------------
  // 3. Confirm the UPI receiving details are filled in - without these,
  //    /api/payments/create-order fails for every single payer.
  // -------------------------------------------------------------------
  const upiVpa = process.env.UPI_VPA || "";
  const upiPayeeName = process.env.UPI_PAYEE_NAME || "";
  const PLACEHOLDER_VPAS = ["", "yourname@okbank", "example@upi"];

  if (isProduction) {
    if (!upiVpa || PLACEHOLDER_VPAS.includes(upiVpa.toLowerCase())) {
      errors.push(
        "UPI_VPA is not set (or is still the placeholder). Set it to the UPI ID that should receive payments, e.g. yourschool@okhdfcbank."
      );
    }
    if (!upiPayeeName) {
      errors.push("UPI_PAYEE_NAME is not set - this is the name shown in the payer's UPI app.");
    }
  } else if (!upiVpa || !upiPayeeName) {
    warnings.push(
      "UPI_VPA / UPI_PAYEE_NAME are not set yet - payment QR codes will fail to generate until both are filled in in .env."
    );
  }

  // -------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------
  if (warnings.length > 0) {
    console.warn("\n⚠️  Environment warnings:");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }

  if (errors.length > 0) {
    console.error("\n❌ Refusing to start: the following must be fixed before running in production:");
    errors.forEach((e) => console.error(`   - ${e}`));
    console.error(
      "\nSee DEPLOYMENT_CHECKLIST.md for the full pre-launch checklist. Set NODE_ENV=development to bypass " +
        "this check locally.\n"
    );
    process.exit(1);
  }
}

module.exports = validateEnv;
