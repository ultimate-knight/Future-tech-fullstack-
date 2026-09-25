const nodemailer = require("nodemailer");

// Built lazily, same pattern as upiService.js — the server can
// start up fine before SMTP is configured; only actually sending an
// email will fail until the env vars below are filled in.
let transporter = null;

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error(
      "Email is not configured yet. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD in .env."
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465, // true for port 465, false for 587/others
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }
  return transporter;
}

/**
 * Emails a school's coordinator their login credentials — used both when
 * an admin first creates the account and when a password is reset.
 * Never throws in a way that should block the caller's own success
 * response; the route calling this should catch and log, not fail the
 * whole request just because the email didn't go out (see admin.js).
 */
async function sendSchoolCredentialsEmail({ toEmail, schoolName, contactName, temporaryPassword, isReset }) {
  const transport = getTransporter();
  const loginUrl = process.env.SCHOOL_PORTAL_LOGIN_URL || "http://localhost:8080/school-login.html";
  const greetingName = contactName || schoolName;

  const subject = isReset
    ? "Your Future Tech School Program password has been reset"
    : "Your Future Tech School Program account is ready";

  const intro = isReset
    ? "Your Future Tech School Program login password has been reset."
    : `An account has been created for ${schoolName} on the Future Tech School Program portal.`;

  const text =
    `Hi ${greetingName},\n\n${intro}\n\n` +
    `Login email: ${toEmail}\n` +
    `Temporary password: ${temporaryPassword}\n\n` +
    `Log in here: ${loginUrl}\n\n` +
    `For security, please log in and set your own password as soon as possible — ` +
    `there's a "Change Password" section right on your school portal page.\n\n` +
    `If you weren't expecting this email, please contact us right away.\n\n` +
    `— Future Tech School Program`;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
}

/**
 * Emails a student their LMS login credentials — used when a Super Admin
 * adds a student account directly (bypassing the usual pay-then-register
 * flow). Same "never block the caller's success response" contract as
 * sendSchoolCredentialsEmail above.
 */
async function sendStudentCredentialsEmail({ toEmail, fullName, temporaryPassword }) {
  const transport = getTransporter();
  const loginUrl = process.env.STUDENT_PORTAL_LOGIN_URL || "http://localhost:8080/student-login.html";

  const subject = "Your Future Tech School Program student account is ready";
  const text =
    `Hi ${fullName},\n\nAn account has been created for you on the Future Tech School Program learning portal.\n\n` +
    `Login email: ${toEmail}\n` +
    `Temporary password: ${temporaryPassword}\n\n` +
    `Log in here: ${loginUrl}\n\n` +
    `For security, please log in and set your own password as soon as possible.\n\n` +
    `If you weren't expecting this email, please contact your school right away.\n\n` +
    `— Future Tech School Program`;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
}

/**
 * Emails a student a welcome/confirmation once they've completed their own
 * LMS self-registration (POST /api/auth/student/register). Includes the
 * password they just chose, at the user's request, so students who forget
 * it can just look it up in this email instead of needing a reset flow.
 */
async function sendStudentWelcomeEmail({ toEmail, fullName, password }) {
  const transport = getTransporter();
  const loginUrl = process.env.STUDENT_PORTAL_LOGIN_URL || "http://localhost:8080/student-login.html";

  const subject = "Welcome to Future Tech School Program — your learning portal is ready";
  const text =
    `Hi ${fullName},\n\nYour Future Tech School Program learning portal account is all set up.\n\n` +
    `Login email: ${toEmail}\n` +
    `Password: ${password}\n\n` +
    `Log in here to access your class notes, recorded videos and quizzes: ${loginUrl}\n\n` +
    `Keep this email safe — if you ever forget your password, you can always come back to it.\n\n` +
    `If you didn't create this account, please contact your school right away.\n\n` +
    `— Future Tech School Program`;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject,
    text,
  });
}

module.exports = { sendSchoolCredentialsEmail, sendStudentCredentialsEmail, sendStudentWelcomeEmail };
