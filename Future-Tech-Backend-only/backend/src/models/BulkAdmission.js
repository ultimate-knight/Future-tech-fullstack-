const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const BulkAdmission = sequelize.define(
  "BulkAdmission",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    organizationName: { type: DataTypes.STRING, allowNull: false },
    coordinatorName: { type: DataTypes.STRING },
    coordinatorMobile: { type: DataTypes.STRING, allowNull: false },
    coordinatorEmail: { type: DataTypes.STRING },

    // Optional link to a registered School account (matched by email at
    // submit time, if that school is logged in / has an account)
    schoolId: { type: DataTypes.UUID, allowNull: true },

    students: { type: DataTypes.JSON, defaultValue: [] }, // [{name, grade, parentName, parentMobile}]
    studentCount: { type: DataTypes.INTEGER, defaultValue: 0 },

    selections: { type: DataTypes.JSON, defaultValue: [] }, // program/requirement checkboxes
    extraFields: { type: DataTypes.JSON, defaultValue: {} },
    excelFileName: { type: DataTypes.STRING, allowNull: true },

    paymentStatus: {
      type: DataTypes.ENUM("pending", "paid", "failed"),
      defaultValue: "pending",
    },
    paymentId: { type: DataTypes.UUID, allowNull: true },
  },
  {
    tableName: "bulk_admissions",
    timestamps: true,
  }
);

module.exports = BulkAdmission;
