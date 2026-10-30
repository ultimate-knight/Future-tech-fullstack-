const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Payment = sequelize.define(
  "Payment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // "individual" | "bulk"
    type: { type: DataTypes.STRING, allowNull: false },

    // id of the IndividualAdmission or BulkAdmission row this payment is for
    admissionId: { type: DataTypes.UUID, allowNull: false },

    amount: { type: DataTypes.INTEGER, allowNull: false }, // in rupees
    currency: { type: DataTypes.STRING, defaultValue: "INR" },

    // What this amount was calculated FROM (individual payments only; all
    // nullable so old rows and bulk payments are unaffected). The server
    // sets amount = monthlyFee x paymentMonths from the admission's level -
    // never from anything the browser sends - and stores the inputs here so
    // every payment record says exactly which student, which level and which
    // payment period it covers. studentName is a snapshot for the admin /
    // school views; admissionId remains the real link to the student's
    // registration (and from there to their LMS account).
    studentName: { type: DataTypes.STRING, allowNull: true },
    programLevel: { type: DataTypes.STRING, allowNull: true }, // level1..level4
    paymentMonths: { type: DataTypes.INTEGER, allowNull: true }, // e.g. 5
    monthlyFee: { type: DataTypes.INTEGER, allowNull: true }, // rupees per month

    // Our own human-readable, roughly-sequential reference (e.g.
    // FTPAY-2026-000123) — see utils/paymentReference.js. Doubles as the
    // UPI transaction reference/note shown to the payer, so it's the same
    // string an admin searches for in the bank statement to confirm a
    // payment. Every payment created through the app always has one (see
    // routes/payments.js) — this is only nullable at the schema level so
    // that adding this column to a database that already has rows in it
    // doesn't fail (MySQL/Postgres both reject a NOT NULL UNIQUE column
    // added to a non-empty table, since every existing row would collide
    // on the same blank value). Run the one-off backfill script
    // (src/scripts/backfillPaymentReferences.js) once after migrating to
    // give old rows a real reference too.
    referenceId: { type: DataTypes.STRING, allowNull: true, unique: true },

    // "pending"  - QR shown to the payer, awaiting manual bank/UPI-app
    //              confirmation by an admin.
    // "paid"     - an admin has verified the money actually arrived and
    //              confirmed it (see POST /api/admin/payments/:id/mark-paid).
    // "failed"   - an admin has rejected an unconfirmed/false payment claim.
    status: {
      type: DataTypes.ENUM("pending", "paid", "failed"),
      defaultValue: "pending",
    },

    payerName: { type: DataTypes.STRING },
    payerEmail: { type: DataTypes.STRING },
    payerPhone: { type: DataTypes.STRING },

    receiptNumber: { type: DataTypes.STRING, unique: true, allowNull: true },

    // Who confirmed this payment and when — since there's no automatic
    // gateway verification anymore, every "paid" payment was manually
    // checked by whoever's responsible for that account: either a
    // platform admin (markedPaidByAdminId) or, for a payment that went
    // straight to a school's own UPI account, that school confirming it
    // themselves from their own portal (markedPaidBySchoolId). Exactly
    // one of these is set, never both. Null until confirmed.
    markedPaidByAdminId: { type: DataTypes.UUID, allowNull: true },
    markedPaidBySchoolId: { type: DataTypes.UUID, allowNull: true },
    markedPaidAt: { type: DataTypes.DATE, allowNull: true },

    // Legacy: previously set when a payment settled (in part or fully)
    // directly to a school's Razorpay Route Linked Account. No new
    // payment can set this anymore (see RAZORPAY_ROUTE.md) — kept only so
    // old rows and historical reports don't break. Always false going
    // forward; settlement to schools is now handled entirely through the
    // School Settlement Invoice feature (src/services/invoiceService.js).
    settledToSchool: { type: DataTypes.BOOLEAN, defaultValue: false },

    // Set once this payment has been included in a generated
    // SchoolInvoice (see src/routes/admin.js "generate invoice"), so the
    // same collected amount can never be counted on two invoices.
    schoolInvoiceId: { type: DataTypes.UUID, allowNull: true },
  },
  {
    tableName: "payments",
    timestamps: true,
  }
);

module.exports = Payment;
