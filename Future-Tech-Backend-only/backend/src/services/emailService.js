const nodemailer = require("nodemailer");

// Built lazily, same pattern as upiService.js — the server can
// start up fine before SMTP is configured; only actually sending an
// email will fail until the env vars below are filled in.
let transporter = null;

/** Names (never values) of the required SMTP settings that are empty/missing. */
function missingSmtpSettings() {
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"].filter((k) => !String(process.env[k] || "").trim());
}

/**
 * Whether the connection starts encrypted (implicit TLS, normally port 465)
 * or starts plain and upgrades with STARTTLS (normally port 587). Defaults to
 * the usual rule by port; set SMTP_SECURE=true|false in .env to override for
 * providers that do it differently.
 */
function smtpSecure() {
  const forced = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(forced)) return true;
  if (["false", "0", "no"].includes(forced)) return false;
  return Number(process.env.SMTP_PORT) === 465;
}

function getTransporter() {
  const missing = missingSmtpSettings();
  if (missing.length) {
    const err = new Error(
      `Email is not configured: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} empty in .env ` +
        "(an empty value counts as not set)."
    );
    err.code = "EMAIL_NOT_CONFIGURED";
    throw err;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: String(process.env.SMTP_HOST).trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      secure: smtpSecure(),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
      // Fail fast instead of leaving the student staring at a spinner
      // if the SMTP server is unreachable.
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

/** Removes the SMTP password from any text before it is logged or shown. */
function redactSecrets(text) {
  let out = String(text || "");
  const pw = process.env.SMTP_PASSWORD;
  if (pw && pw.length >= 4) out = out.split(pw).join("***");
  return out;
}

/**
 * Turns a nodemailer/network error into { code, reason }: a short,
 * plain-English cause that is safe to log and to show to the admin (never
 * contains a secret). The raw error stays in the server log.
 */
function describeEmailError(err) {
  const host = process.env.SMTP_HOST || "(SMTP_HOST)";
  const port = process.env.SMTP_PORT || 587;
  const code = (err && (err.code || err.responseCode)) || "UNKNOWN";
  const raw = redactSecrets((err && err.message) || "");

  if (err && err.code === "EMAIL_NOT_CONFIGURED") return { code: "NOT_CONFIGURED", reason: err.message };
  if (code === "EAUTH" || [530, 534, 535].includes(err && err.responseCode)) {
    return { code: "AUTH", reason: "The mail server rejected the login. Check SMTP_USER / SMTP_PASSWORD (some providers need an app-specific password, or SMTP/IMAP switched on for the mailbox)." };
  }
  if (code === "ENOTFOUND" || code === "EDNS") {
    return { code: "DNS", reason: `SMTP_HOST "${host}" could not be found. Check the spelling of the host name.` };
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/.test(raw)) {
    return { code: "CONNECTION_REFUSED", reason: `Connection refused by ${host}:${port}. Wrong SMTP_PORT, or the provider does not accept connections there.` };
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || /timeout|timed out/i.test(raw)) {
    return { code: "TIMEOUT", reason: `Could not reach ${host}:${port} in time. Wrong host/port, or the server's firewall / hosting provider blocks outgoing SMTP on this port.` };
  }
  if (/wrong version number|ssl3_get_record|packet length too long|unexpected eof/i.test(raw)) {
    return { code: "TLS_MISMATCH", reason: `TLS settings do not match port ${port}. Port 465 needs SMTP_SECURE=true; port 587 uses STARTTLS (SMTP_SECURE=false).` };
  }
  if (/self.signed|certificate|altnames|CERT_|UNABLE_TO_VERIFY/i.test(raw + " " + code)) {
    return { code: "TLS_CERTIFICATE", reason: `The mail server's TLS certificate was not accepted for "${host}". SMTP_HOST must be the exact host name on the provider's certificate.` };
  }
  if (err && [550, 551, 553, 554].includes(err.responseCode)) {
    return { code: "REJECTED", reason: "The mail server refused the message. SMTP_FROM usually must be an address this mailbox is allowed to send as; or the recipient address is invalid." };
  }
  if (err && err.code === "EENVELOPE") {
    return { code: "REJECTED", reason: "The recipient or sender address was rejected as invalid." };
  }
  return { code: String(code), reason: `Mail could not be sent (${raw.split("\n")[0].slice(0, 160) || "unknown error"}).` };
}

/**
 * The single place every email is sent from. Logs one "[email]" line for
 * success AND failure, checks the server did not reject the recipient, and
 * on failure throws the original error with .emailReason / .emailCode
 * attached (safe to show to an admin). Callers still catch - an email
 * problem must never fail the request that triggered it.
 */
async function deliver(label, toEmail, { subject, text, html }) {
  try {
    const transport = getTransporter();
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: toEmail,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    if (info.rejected && info.rejected.length) {
      const e = new Error("SMTP server rejected recipient(s): " + info.rejected.join(", "));
      e.code = "EENVELOPE";
      throw e;
    }
    console.log(`[email] ${label} sent to ${toEmail} (messageId ${info.messageId}, response: ${redactSecrets(info.response)})`);
    return info;
  } catch (err) {
    const d = describeEmailError(err);
    console.error(`[email] FAILED ${label} to ${toEmail}: [${d.code}] ${d.reason}`);
    if (d.code !== "NOT_CONFIGURED") console.error(`[email]   raw error: ${redactSecrets(err && err.message)}`);
    err.emailReason = d.reason;
    err.emailCode = d.code;
    throw err;
  }
}

/** Short, safe reason string for any caught email error (for API responses). */
function emailFailureReason(err) {
  return (err && err.emailReason) || describeEmailError(err).reason;
}

/**
 * Opens a real connection to the SMTP server, negotiates TLS and logs in -
 * without sending anything. Resolves { ok: true } or { ok: false, code, reason }.
 */
async function verifyEmailConnection() {
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (err) {
    const d = describeEmailError(err);
    return { ok: false, code: d.code, reason: d.reason, raw: redactSecrets(err && err.message) };
  }
}

/**
 * Emails a school's coordinator their login credentials — used both when
 * an admin first creates the account and when a password is reset.
 * Never throws in a way that should block the caller's own success
 * response; the route calling this should catch and log, not fail the
 * whole request just because the email didn't go out (see admin.js).
 */
async function sendSchoolCredentialsEmail({ toEmail, schoolName, contactName, temporaryPassword, isReset }) {
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

  await deliver(isReset ? "School password reset" : "School credentials", toEmail, { subject, text });
}

/**
 * Emails a student their LMS login credentials — used when a Super Admin
 * adds a student account directly (bypassing the usual pay-then-register
 * flow). Same "never block the caller's success response" contract as
 * sendSchoolCredentialsEmail above.
 */
async function sendStudentCredentialsEmail({ toEmail, fullName, temporaryPassword }) {
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

  await deliver("Student credentials", toEmail, { subject, text });
}

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Where the student should log in. Priority:
 *  1. STUDENT_PORTAL_LOGIN_URL from .env - unless it is still the
 *     "localhost" placeholder from .env.example
 *  2. The website the student is actually on (passed in by the route from
 *     the request's Origin/Referer) + /student-login.html
 *  3. The .env value / localhost as a last resort
 */
function resolveStudentLoginUrl(siteOrigin) {
  const fromEnv = process.env.STUDENT_PORTAL_LOGIN_URL;
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv;
  if (siteOrigin) return String(siteOrigin).replace(/\/+$/, "") + "/student-login.html";
  return fromEnv || "http://localhost:8080/student-login.html";
}

/**
 * Emails a student their login details (username/email, password and the
 * login URL) once they've completed their own LMS self-registration
 * (POST /api/auth/student/register). The password is included in plain
 * text at the owner's request, so students who forget it can look it up.
 *
 * Throws on failure - the caller catches it (account creation must not
 * fail just because an email didn't go out). Logs a clear line on both
 * success and failure so the server console always shows what happened.
 */
async function sendStudentWelcomeEmail({ toEmail, fullName, password, loginUrl: siteOrigin }) {
  const loginUrl = resolveStudentLoginUrl(siteOrigin);

  const subject = "Your Future Tech School Program login details";

  const text =
    `Hi ${fullName},\n\n` +
    `Welcome to the Future Tech School Program! Your learning portal account is ready.\n\n` +
    `YOUR LOGIN DETAILS\n` +
    `Username (email): ${toEmail}\n` +
    `Password: ${password}\n` +
    `Login URL: ${loginUrl}\n\n` +
    `Log in to access your class notes, recorded videos and quizzes.\n\n` +
    `Keep this email safe - if you ever forget your password, you can find it here.\n\n` +
    `If you didn't create this account, please contact your school right away.\n\n` +
    `- Future Tech School Program`;

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#1d2433;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">
        <tr><td style="background:#0e0e41;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold;">
          Future Tech School Program
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 12px;font-size:16px;">Hi ${escapeHtml(fullName)},</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
            Welcome! Your learning portal account is ready. Here are your login details:
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;border-radius:8px;margin-bottom:22px;">
            <tr><td style="padding:16px 18px;font-size:15px;line-height:1.9;">
              <b>Username (email):</b> ${escapeHtml(toEmail)}<br>
              <b>Password:</b> <span style="font-family:Consolas,Menlo,monospace;background:#ffffff;padding:2px 6px;border-radius:4px;">${escapeHtml(password)}</span><br>
              <b>Login URL:</b> <a href="${escapeHtml(loginUrl)}" style="color:#0d6efd;">${escapeHtml(loginUrl)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;text-align:center;">
            <a href="${escapeHtml(loginUrl)}" style="background:#0d6efd;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;display:inline-block;">Log in to your portal</a>
          </p>
          <p style="margin:0 0 10px;font-size:13px;color:#5b6577;line-height:1.5;">
            Keep this email safe - if you ever forget your password, you can find it here.
          </p>
          <p style="margin:0;font-size:13px;color:#5b6577;line-height:1.5;">
            If you didn't create this account, please contact your school right away.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  await deliver("Student login details", toEmail, { subject, text, html });
}

/** Printed once at startup so it's obvious whether email is configured. */
function logEmailConfigStatus() {
  const missing = missingSmtpSettings();
  if (!missing.length) {
    console.log(`[email] SMTP configured (${String(process.env.SMTP_HOST).trim()}:${process.env.SMTP_PORT || 587}, ${smtpSecure() ? "implicit TLS" : "STARTTLS"}, from ${process.env.SMTP_FROM || process.env.SMTP_USER}). Checking the connection...`);
    // Non-blocking: the server is already listening; this only reports,
    // in the log, whether the mail server actually accepts our login.
    verifyEmailConnection().then((r) => {
      if (r.ok) console.log("[email] SMTP connection check OK - the server accepted the login.");
      else console.error(`[email] SMTP connection check FAILED [${r.code}]: ${r.reason}`);
    });
  } else {
    console.warn(`[email] SMTP is NOT configured - no emails will be sent. Empty/missing in .env: ${missing.join(", ")}.`);
  }
}

module.exports = {
  sendSchoolCredentialsEmail,
  sendStudentCredentialsEmail,
  sendStudentWelcomeEmail,
  resolveStudentLoginUrl,
  logEmailConfigStatus,
  // used by the diagnose script and the admin routes
  verifyEmailConnection,
  emailFailureReason,
  describeEmailError,
  missingSmtpSettings,
  smtpSecure,
};
