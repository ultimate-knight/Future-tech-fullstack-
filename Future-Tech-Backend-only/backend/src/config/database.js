const path = require("path");
const { Sequelize } = require("sequelize");

const dialect = (process.env.DB_DIALECT || "sqlite").toLowerCase();

let sequelize;

if (dialect === "sqlite") {
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "..", "..", "data", "database.sqlite"),
    logging: false,
  });
} else if (dialect === "postgres" || dialect === "mysql") {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect,
      logging: false,
      pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    }
  );
} else {
  throw new Error(
    `Unsupported DB_DIALECT "${dialect}". Use "sqlite", "postgres", or "mysql".`
  );
}

module.exports = sequelize;
