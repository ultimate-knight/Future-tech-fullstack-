const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const School = sequelize.define(
  "School",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    schoolName: { type: DataTypes.STRING, allowNull: false },
    contactName: { type: DataTypes.STRING },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    phone: { type: DataTypes.STRING },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    // Super Admin can suspend a school's access (e.g. non-payment) without
    // deleting their account/data. Suspended schools cannot log in.
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },

    // ---- Razorpay Route (multi-school settlement) ----
    // The Razorpay Linked Account id (e.g. "acc_XXXXXXXXXXXXXX") for this
    // school, once 3D WebSoft's Razorpay account has Route enabled AND
    // this school has completed its own KYC/onboarding as a Linked
    // Account. Null until then — see RAZORPAY_ROUTE.md.
    razorpayAccountId: { type: DataTypes.STRING, allowNull: true },
    // "not_configured" (default, money settles to the platform account,
    //   same as before) | "pending" (linked account created, KYC not yet
    //   verified by Razorpay - do NOT start splitting transfers yet) |
    // "active" (Razorpay has verified the linked account - safe to split
    //   payments to it going forward).
    razorpaySettlementStatus: {
      type: DataTypes.ENUM("not_configured", "pending", "active"),
      defaultValue: "not_configured",
    },
    // Optional per-school override (0-100) of PLATFORM_COMMISSION_PERCENT
    // from .env, for schools with a different negotiated split. Null =
    // use the platform-wide default.
    commissionPercentOverride: { type: DataTypes.FLOAT, allowNull: true },

    // ---- Per-school UPI settlement ----
    // This school's own UPI ID, e.g. "chaitanyaschool@okhdfcbank". When
    // set, every payment for a student registered under this school
    // shows a QR code paying directly into the SCHOOL's own account
    // instead of the platform's (see src/routes/payments.js). Null =
    // fall back to the platform-wide UPI_VPA/UPI_PAYEE_NAME in .env, same
    // as before this existed.
    upiVpa: { type: DataTypes.STRING, allowNull: true },
    // Name shown in the payer's UPI app. Falls back to schoolName if this
    // is left blank but upiVpa is set.
    upiPayeeName: { type: DataTypes.STRING, allowNull: true },

    // ---- School branding ----
    // Filename only (e.g. "<schoolId>.png"), stored on disk under
    // backend/content/school-logos/. Served publicly (no login needed -
    // it's just a branding image) via GET /api/content/school-logo/:id.
    // Null = no logo uploaded yet, show the Future Tech logo alone.
    logoFilename: { type: DataTypes.STRING, allowNull: true },
  },
  {
    tableName: "schools",
    timestamps: true,
  }
);

module.exports = School;
