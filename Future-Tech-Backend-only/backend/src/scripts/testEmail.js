// Usage:  npm run email:test -- someone@example.com
// Sends the real student login-details email to that address so you can
// check SMTP settings, spam placement and the login URL without having
// to register a student.
require("dotenv").config();
const { sendStudentWelcomeEmail, logEmailConfigStatus } = require("../services/emailService");

(async () => {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: npm run email:test -- someone@example.com");
    process.exit(1);
  }
  logEmailConfigStatus();
  try {
    await sendStudentWelcomeEmail({ toEmail: to, fullName: "Test Student", password: "Test@12345" });
    console.log("Done - check the inbox (and spam folder) of " + to);
    process.exit(0);
  } catch (err) {
    console.error("Send failed:", err.message);
    process.exit(1);
  }
})();
