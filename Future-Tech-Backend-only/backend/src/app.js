const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const schoolRoutes = require("./routes/schools");
const studentRoutes = require("./routes/students");
const contactRoutes = require("./routes/contact");
const admissionRoutes = require("./routes/admissions");
const paymentRoutes = require("./routes/payments");
const receiptRoutes = require("./routes/receipts");
const adminRoutes = require("./routes/admin");
const adminClassContentRoutes = require("./routes/adminClassContent");
const configRoutes = require("./routes/config");
const contentRoutes = require("./routes/content");
const quizResultRoutes = require("./routes/quizResults");
const classProgressRoutes = require("./routes/classProgress");

const app = express();

// Behind a reverse proxy (Nginx, Render, Railway, etc.) in production, so
// req.ip / X-Forwarded-For are read correctly (needed for accurate rate
// limiting and logging).
app.set("trust proxy", 1);

// ---------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------
app.use(helmet());

// ---------------------------------------------------------------------
// CORS - only the origins listed in CORS_ORIGIN may call this API.
// ---------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow server-to-server / curl / same-origin requests with no
      // Origin header, and any origin explicitly listed in CORS_ORIGIN.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(compression());
app.use(
  express.json({
    limit: "4mb",
  })
);

// ---------------------------------------------------------------------
// Logging - concise in development, Apache-combined in production (pipe
// to a log file / log aggregator via your process manager).
// ---------------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ---------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------
// General safety net across the whole API.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  // The payment QR modal polls GET /payments/:id/status every few seconds;
  // that route has its own dedicated limiters (src/routes/payments.js), so it
  // must not also eat the shared 300-requests budget - otherwise two open
  // payment windows on one network block everything else (logins included).
  skip: (req) => req.method === "GET" && /^\/payments\/[^/]+\/status$/.test(req.path),
});
app.use("/api", generalLimiter);

// Tighter limits on brute-forceable / abuse-prone endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login/registration attempts. Please try again in a few minutes." },
});
// Payment routes set their own, more finely-tuned limiters per-endpoint
// (see src/routes/payments.js) - create-order is tightly capped, while the
// QR-modal status-poll endpoint needs a much more generous one.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages sent. Please try again later." },
});

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/config", configRoutes);
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/contact", contactLimiter, contactRoutes);
app.use("/api/admissions", admissionRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/receipts", receiptRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminClassContentRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/quiz-results", quizResultRoutes);
app.use("/api/class-progress", classProgressRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not found." }));

// Central error handler (catches anything thrown/rejected and not
// already handled by a route's own try/catch)
app.use((err, req, res, next) => {
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "This origin is not allowed to access the API." });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

module.exports = app;
