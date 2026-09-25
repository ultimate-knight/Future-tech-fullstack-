const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Admin = sequelize.define(
  "Admin",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: { type: DataTypes.STRING, defaultValue: "Administrator" },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
  },
  {
    tableName: "admins",
    timestamps: true,
  }
);

module.exports = Admin;
