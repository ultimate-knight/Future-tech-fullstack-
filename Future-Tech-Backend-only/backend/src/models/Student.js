const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * A Student LMS account. Created only after a parent successfully pays
 * for an Individual Admission — registration is gated by that payment,
 * not open self-signup. One admission can only ever create one student
 * account (see the unique constraint on admissionId).
 */
const Student = sequelize.define(
  "Student",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Link back to the paid IndividualAdmission that unlocked this account.
    admissionId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    fullName: { type: DataTypes.STRING, allowNull: false },
    dob: { type: DataTypes.DATEONLY, allowNull: true },
    grade: { type: DataTypes.STRING },
    parentName: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    address: { type: DataTypes.STRING },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
      // The email IS the login username, and login looks it up lower-cased
      // (routes/auth.js). Store it the same way no matter which code path
      // creates the account, so a mixed-case value can never end up in the
      // table where the student could not log in with it - and so uniqueness
      // behaves the same on SQLite (case-sensitive) and MySQL (not).
      set(value) {
        this.setDataValue("email", typeof value === "string" ? value.trim().toLowerCase() : value);
      },
    },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
  },
  {
    tableName: "students",
    timestamps: true,
  }
);

module.exports = Student;
