// Usage:
//   npm run email:diagnose                      -> checks config, DNS, TCP, TLS and login (sends nothing)
//   npm run email:diagnose -- you@example.com   -> ...and also sends one real test message
//
// Prints a plain-English verdict for the first thing that is wrong. Never
// prints the SMTP password or the full login/from addresses.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const net = require("net");
const dns = require("dns").promises;
const nodemailer = require("nodemailer");
const {
  verifyEmailConnection,
  describeEmailError,
  missingSmtpSettings,
  smtpSecure,
} = require("../services/emailService");

function maskEmail(v) {
  const s = String(v || "");
  const m = /<([^>]+)>/.exec(s);
  const addr = (m ? m[1] : s).trim();
  const [local, domain] = addr.split("@");
  if (!domain) return addr ? "(not an email address)" : "(empty)";
  return `${local.slice(0, 2)}***@${domain}`;
}

const line = (ok, text) => console.log(`${ok === true ? "  OK    " : ok === false ? "  FAIL  " : "  INFO  "}${text}`);

(async () => {
  const to = process.argv[2];
  let failed = false;
  console.log("\nEmail diagnostics (secrets are never printed)\n");

  // ---- 1. settings ----
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  line(null, `NODE_ENV=${process.env.NODE_ENV || "(unset)"}  SMTP_HOST=${host || "(EMPTY)"}  SMTP_PORT=${port}  mode=${smtpSecure() ? "implicit TLS" : "STARTTLS"}`);
  line(null, `SMTP_USER=${maskEmail(process.env.SMTP_USER)}  SMTP_FROM=${maskEmail(process.env.SMTP_FROM || process.env.SMTP_USER)}  SMTP_PASSWORD=${process.env.SMTP_PASSWORD ? `set (${process.env.SMTP_PASSWORD.length} characters)` : "(EMPTY)"}`);

  // Duplicate keys in .env are legal but confusing: the LAST one wins.
  try {
    const envFile = path.join(process.cwd(), ".env");
    if (fs.existsSync(envFile)) {
      const counts = {};
      fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach((l) => {
        const m = /^\s*(SMTP_[A-Z_]+)\s*=/.exec(l);
        if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
      });
      Object.keys(counts).filter((k) => counts[k] > 1).forEach((k) =>
        line(false, `${k} appears ${counts[k]} times in .env - only the LAST one is used. Delete the duplicates.`)
      );
    } else {
      line(null, "No .env file in this folder - settings come from the process environment (pm2/systemd/hosting panel).");
    }
  } catch (e) { /* informational only */ }

  const missing = missingSmtpSettings();
  if (missing.length) {
    line(false, `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} empty. A value left blank counts as not configured, so every send fails before any connection is attempted.`);
    console.log("\nFix: fill them in .env (host name comes from your mail provider's 'SMTP settings' page), restart the app, then run this again.\n");
    process.exit(1);
  }

  // ---- 2. DNS ----
  try {
    const r = await dns.lookup(host);
    line(true, `DNS: ${host} -> ${r.address}`);
  } catch (e) {
    line(false, `DNS: cannot resolve "${host}" (${e.code}). Check the spelling of SMTP_HOST.`);
    process.exit(1);
  }

  // ---- 3. TCP ----
  await new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 8000 });
    sock.once("connect", () => { line(true, `TCP: connected to ${host}:${port}`); sock.destroy(); resolve(); });
    const bad = (why) => { failed = true; line(false, `TCP: cannot connect to ${host}:${port} (${why}). Wrong port, or this server's firewall/hosting provider blocks outgoing SMTP.`); sock.destroy(); resolve(); };
    sock.once("timeout", () => bad("timed out"));
    sock.once("error", (e) => bad(e.code || e.message));
  });
  if (failed) process.exit(1);

  // ---- 4. TLS + login (no mail sent) ----
  const v = await verifyEmailConnection();
  if (v.ok) {
    line(true, "SMTP: connected, secured (where the server offers it) and the server ACCEPTED the login.");
  } else {
    line(false, `SMTP [${v.code}]: ${v.reason}`);
    if (v.raw) line(null, `server said: ${v.raw.split("\n")[0].slice(0, 200)}`);
    process.exit(1);
  }

  // ---- 5. optional real send ----
  if (to) {
    try {
      const t = nodemailer.createTransport({
        host, port, secure: smtpSecure(),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
      });
      const info = await t.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: "Future Tech School Program - email test",
        text: "If you can read this, outgoing email from the Future Tech School Program server works.",
      });
      if (info.rejected && info.rejected.length) throw Object.assign(new Error("recipient rejected"), { code: "EENVELOPE" });
      line(true, `Test message accepted for delivery to ${maskEmail(to)}. Check the inbox AND the spam folder.`);
    } catch (e) {
      line(false, `Send failed: ${describeEmailError(e).reason}`);
      process.exit(1);
    }
  } else {
    line(null, "Nothing was sent. Add an address to send a real test:  npm run email:diagnose -- you@example.com");
  }
  console.log("");
  process.exit(0);
})();
