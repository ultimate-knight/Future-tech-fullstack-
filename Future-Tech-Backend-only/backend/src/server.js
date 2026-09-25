require("dotenv").config();

const validateEnv = require("./config/validateEnv");
validateEnv();

const app = require("./app");
const { sequelize } = require("./models");
const ensureAdminExists = require("./scripts/ensureAdmin");

const PORT = process.env.PORT || 5000;

let server;

async function start() {
  try {
    await sequelize.authenticate();
    console.log(`Database connected (${process.env.DB_DIALECT || "sqlite"}).`);

    // Creates/updates tables to match the models. In production, prefer
    // proper migrations (e.g. sequelize-cli) instead of sync({ alter }).
    await sequelize.sync({ alter: process.env.NODE_ENV !== "production" });
    console.log("Database synced.");

    await ensureAdminExists();

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
