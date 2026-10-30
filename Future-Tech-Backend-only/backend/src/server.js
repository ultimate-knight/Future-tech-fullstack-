require("dotenv").config();

const validateEnv = require("./config/validateEnv");
validateEnv();

const app = require("./app");
const { sequelize } = require("./models");
const ensureAdminExists = require("./scripts/ensureAdmin");
const { logEmailConfigStatus } = require("./services/emailService");

const PORT = process.env.PORT || 5000;

let server;

const cors = require("cors");

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

async function start() {
  try {
    await sequelize.authenticate();
    console.log(`Database connected (${process.env.DB_DIALECT || "sqlite"}).`);

    // Creates any MISSING tables. It does NOT alter existing ones on every
    // start any more: on MySQL, sync({ alter: true }) adds another copy of every
    // unique index on each start until MySQL fails with "Too many keys
    // specified; max 64 keys allowed". To apply a schema change (new
    // columns) run `npm run db:init`; or set DB_SYNC_ALTER=true in .env to
    // get the old alter-on-start behaviour (SQLite development only).
    await sequelize.sync({ alter: process.env.DB_SYNC_ALTER === "true" });
    console.log("Database synced.");

    await ensureAdminExists();
    logEmailConfigStatus();

    server = app.listen(PORT, () => {
      console.log(`Future Tech backend listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------
// Graceful shutdown - let in-flight requests finish and close the DB
// connection cleanly instead of dropping connections when a process
// manager (PM2, systemd, Docker, Kubernetes) sends a stop signal.
// ---------------------------------------------------------------------
function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(async (err) => {
    if (err) {
      console.error("Error while closing HTTP server:", err);
      process.exit(1);
    }
    try {
      await sequelize.close();
      console.log("Database connection closed. Bye.");
      process.exit(0);
    } catch (closeErr) {
      console.error("Error closing database connection:", closeErr);
      process.exit(1);
    }
  });

  // Force-exit if something hangs for too long.
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

start();
