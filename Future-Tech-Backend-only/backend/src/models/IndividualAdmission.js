const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const IndividualAdmission = sequelize.define(
  "IndividualAdmission",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    studentName: { type: DataTypes.STRING, allowNull: false },
    grade: { type: DataTypes.STRING },
    // Free-text fallback (older submissions, or if schoolId isn't set).
    // schoolId is the real relational link used for data isolation.
    schoolName: { type: DataTypes.STRING },
    schoolId: { type: DataTypes.UUID, allowNull: true },
    parentName: { type: DataTypes.STRING },
    mobile: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING },
    programLevel: {
      // level1 | level2 | level3 | level4 — used to look up the fee
      type: DataTypes.STRING,
      allowNull: false,
    },
    interests: { type: DataTypes.JSON, defaultValue: [] },
    // Every other field captured from the form that doesn't have its own
    // column yet — keeps the form flexible without needing a migration
    // every time a field is tweaked on the frontend.
    extraFields: { type: DataTypes.JSON, defaultValue: {} },
    consents: { type: DataTypes.JSON, defaultValue: [] },

    // Payment status snapshot for quick reads (source of truth is the
    // Payment row itself, linked via paymentId)
    paymentStatus: {
      type: DataTypes.ENUM("pending", "paid", "failed"),
      defaultValue: "pending",
    },
    paymentId: { type: DataTypes.UUID, allowNull: true },
  },
  {
    tableName: "individual_admissions",
    timestamps: true,
  }
);

module.exports = IndividualAdmission;
