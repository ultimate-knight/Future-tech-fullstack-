const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const { body, validationResult } = require("express-validator");
const {
  ContactMessage,
  IndividualAdmission,
  BulkAdmission,
  Payment,
  School,
  Admin,
  Student,
  SchoolInvoice,
  QuizResult,
} = require("../models");
const { requireAdminAuth } = require("../middleware/auth");
const generateTempPassword = require("../utils/generateTempPassword");
const generateInvoiceNumber = require("../utils/invoiceNumber");
const { sendSchoolCredentialsEmail, sendStudentCredentialsEmail } = require("../services/emailService");
const { confirmPaymentPaid } = require("../services/paymentService");
const { generateSchoolInvoicePdf, generateSchoolStatementPdf, INVOICES_DIR } = require("../services/invoiceService");
const fees = require("../config/fees");

const router = express.Router();
router.use(requireAdminAuth);

// POST /api/admin/me/change-password
// Lets the Super Admin swap out their .env-seeded password for one they
// choose themselves — no more editing .env + restarting the server.
router.post(
  "/me/change-password",
  [
    body("currentPassword").notEmpty().withMessage("Current password is required."),
    body("newPassword").isLength({ min: 6 }).withMessage("New password must be at least 6 characters."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const admin = await Admin.findByPk(req.admin.id);
      if (!admin) return res.status(404).json({ error: "Account not found." });

      const match = await bcrypt.compare(req.body.currentPassword, admin.passwordHash);
      if (!match) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      admin.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
      await admin.save();

      res.json({ ok: true, message: "Password updated successfully." });
    } catch (err) {
      console.error("admin change-password error", err);
      res.status(500).json({ error: "Could not update password. Please try again." });
    }
  }
);

// GET /api/admin/summary
router.get("/summary", async (req, res) => {
  const [contacts, individuals, bulks, paidPayments] = await Promise.all([
    ContactMessage.count(),
    IndividualAdmission.count(),
    BulkAdmission.count(),
    Payment.findAll({ where: { status: "paid" } }),
  ]);

  const totalRevenue = paidPayments.reduce((sum, p) => sum + p.amount, 0);

  res.json({
    contacts,
    individualAdmissions: individuals,
    bulkAdmissions: bulks,
    paidPayments: paidPayments.length,
    totalRevenue,
  });
});

// GET /api/admin/contacts
router.get("/contacts", async (req, res) => {
  const records = await ContactMessage.findAll({ order: [["createdAt", "DESC"]] });
  res.json(records);
});

// DELETE /api/admin/contacts/:id
router.delete("/contacts/:id", async (req, res) => {
  await ContactMessage.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// GET /api/admin/admissions/individual
router.get("/admissions/individual", async (req, res) => {
  const records = await IndividualAdmission.findAll({
    order: [["createdAt", "DESC"]],
    include: [{ model: School, attributes: ["id", "schoolName"] }],
  });
  res.json(records);
});

// DELETE /api/admin/admissions/individual/:id
router.delete("/admissions/individual/:id", async (req, res) => {
  await IndividualAdmission.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// GET /api/admin/admissions/bulk
router.get("/admissions/bulk", async (req, res) => {
  const records = await BulkAdmission.findAll({ order: [["createdAt", "DESC"]] });
  res.json(records);
});

// DELETE /api/admin/admissions/bulk/:id
router.delete("/admissions/bulk/:id", async (req, res) => {
  await BulkAdmission.destroy({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// GET /api/admin/payments
router.get("/payments", async (req, res) => {
  const records = await Payment.findAll({ order: [["createdAt", "DESC"]] });

  // Enrich each payment with the school it belongs to (via its admission),
  // so the Payments tab can show which school a payment is for instead of
  // just the individual payer's name.
  const individualIds = records.filter((p) => p.type === "individual").map((p) => p.admissionId);
  const bulkIds = records.filter((p) => p.type === "bulk").map((p) => p.admissionId);

  const [individuals, bulks] = await Promise.all([
    individualIds.length
      ? IndividualAdmission.findAll({
          where: { id: { [Op.in]: individualIds } },
          include: [{ model: School, attributes: ["id", "schoolName"] }],
        })
      : [],
    bulkIds.length
      ? BulkAdmission.findAll({
          where: { id: { [Op.in]: bulkIds } },
          include: [{ model: School, attributes: ["id", "schoolName"] }],
        })
      : [],
  ]);

  const schoolByAdmissionId = new Map();
  individuals.forEach((a) => {
    schoolByAdmissionId.set(a.id, (a.School && a.School.schoolName) || a.schoolName || null);
  });
  bulks.forEach((a) => {
    schoolByAdmissionId.set(a.id, (a.School && a.School.schoolName) || a.organizationName || null);
  });

  const result = records.map((p) => {
    const plain = p.toJSON();
    plain.schoolName = schoolByAdmissionId.get(p.admissionId) || null;
    return plain;
  });

  res.json(result);
});

// POST /api/admin/payments/:id/mark-paid
// The core of the manual-verification flow that replaced Razorpay: the
// admin checks the bank account/UPI app for a transaction matching this
// payment's amount + reference (Payment.referenceId, shown to the payer
// and used as the UPI transaction note), then confirms it here. This
// marks the payment paid, updates the admission, and generates the PDF
// receipt - exactly what used to happen automatically after a Razorpay
// signature check. Idempotent: confirming an already-paid payment again
// just returns it unchanged.
router.post("/payments/:id/mark-paid", async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    if (payment.status === "failed") {
      return res.status(409).json({
        error: "This payment was previously marked failed. If you've now confirmed it did arrive, please contact support.",
      });
    }
    await confirmPaymentPaid(payment, { markedPaidByAdminId: req.admin.id });
    res.json(payment);
  } catch (err) {
    console.error("mark-paid error", err);
    res.status(500).json({ error: "Could not mark this payment as paid." });
  }
});

// POST /api/admin/payments/:id/mark-failed
// For rejecting a payment claim that never actually shows up in the bank
// account/UPI app after a reasonable wait - the counterpart to the
// automatic fraud protection lost by moving off Razorpay's signature
// verification. Can't be used on a payment already confirmed paid.
router.post("/payments/:id/mark-failed", async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: "Payment not found." });
    if (payment.status === "paid") {
      return res.status(409).json({ error: "This payment has already been confirmed as paid and can't be marked failed." });
    }
    payment.status = "failed";
    await payment.save();
    res.json(payment);
  } catch (err) {
    console.error("mark-failed error", err);
    res.status(500).json({ error: "Could not mark this payment as failed." });
  }
});

// GET /api/admin/schools
router.get("/schools", async (req, res) => {
  const records = await School.findAll({
    order: [["createdAt", "DESC"]],
    attributes: { exclude: ["passwordHash"] },
  });
  res.json(records);
});

// POST /api/admin/schools
// Creates a school account and returns a generated login password.
// This is the ONLY time the plain-text password is ever available —
// it is not stored anywhere and cannot be retrieved again later, only
// reset (see POST /api/admin/schools/:id/reset-password).
router.post(
  "/schools",
  [
    body("schoolName").trim().notEmpty().withMessage("School name is required."),
    body("email").isEmail().withMessage("A valid email is required."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { schoolName, contactName, email, phone } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const existing = await School.findOne({ where: { email: normalizedEmail } });
      if (existing) {
        return res.status(409).json({ error: "A school account with this email already exists." });
      }

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      const school = await School.create({
        schoolName,
        contactName: contactName || "",
        email: normalizedEmail,
        phone: phone || "",
        passwordHash,
      });

      // Email the login credentials to the school's coordinator. If this
      // fails (SMTP not configured yet, bad address, etc.) we don't fail
      // account creation — the admin still sees the password below and
      // can share it manually. emailSent tells the admin UI which happened.
      let emailSent = false;
      try {
        await sendSchoolCredentialsEmail({
          toEmail: school.email,
          schoolName: school.schoolName,
          contactName: school.contactName,
          temporaryPassword: tempPassword,
          isReset: false,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Could not send school welcome email:", emailErr.message);
      }

      res.status(201).json({
        school: {
          id: school.id,
          schoolName: school.schoolName,
          contactName: school.contactName,
          email: school.email,
          phone: school.phone,
          createdAt: school.createdAt,
        },
        // Shown once, right now, in the response only — never persisted in plain text.
        temporaryPassword: tempPassword,
        emailSent,
      });
    } catch (err) {
      console.error("admin create school error", err);
      res.status(500).json({ error: "Could not create school account. Please try again." });
    }
  }
);

// POST /api/admin/schools/:id/reset-password
// Generates a fresh temporary password for an existing school (e.g. if
// they lost their original credentials) and returns it once.
router.post("/schools/:id/reset-password", async (req, res) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });

    const tempPassword = generateTempPassword();
    school.passwordHash = await bcrypt.hash(tempPassword, 10);
    await school.save();

    let emailSent = false;
    try {
      await sendSchoolCredentialsEmail({
        toEmail: school.email,
        schoolName: school.schoolName,
        contactName: school.contactName,
        temporaryPassword: tempPassword,
        isReset: true,
      });
      emailSent = true;
    } catch (emailErr) {
      console.error("Could not send school reset-password email:", emailErr.message);
    }

    res.json({ temporaryPassword: tempPassword, emailSent });
  } catch (err) {
    console.error("admin reset school password error", err);
    res.status(500).json({ error: "Could not reset password. Please try again." });
  }
});

// POST /api/admin/schools/:id/toggle-status
// Suspends an active school (blocks their login immediately, even
// mid-session) or reactivates a suspended one. Does not delete any of
// their data — just blocks access.
router.post("/schools/:id/toggle-status", async (req, res) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });

    school.isActive = !school.isActive;
    await school.save();

    res.json({ ok: true, isActive: school.isActive });
  } catch (err) {
    console.error("admin toggle school status error", err);
    res.status(500).json({ error: "Could not update school status." });
  }
});

// ---------------------------------------------------------------------
// POST /api/admin/schools/:id/upi
// Sets (or clears) a school's own UPI ID for direct settlement — once
// set, every payment for a student/enrollment tied to this school shows
// a QR code that pays straight into the SCHOOL's own account instead of
// the platform's. See UPI_PAYMENTS.md.
// ---------------------------------------------------------------------
router.post(
  "/schools/:id/upi",
  [
    body("upiVpa")
      .optional({ nullable: true })
      .trim()
      .matches(/^[\w.\-]{2,256}@[\w.\-]{2,64}$/)
      .withMessage('UPI ID should look like "name@bank", e.g. "chaitanyaschool@okhdfcbank".'),
    body("upiPayeeName").optional({ nullable: true }).trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const school = await School.findByPk(req.params.id);
      if (!school) return res.status(404).json({ error: "School not found." });

      const { upiVpa, upiPayeeName } = req.body;
      if (upiVpa !== undefined) school.upiVpa = upiVpa || null;
      if (upiPayeeName !== undefined) school.upiPayeeName = upiPayeeName || null;
      await school.save();

      res.json({
        ok: true,
        school: {
          id: school.id,
          schoolName: school.schoolName,
          upiVpa: school.upiVpa,
          upiPayeeName: school.upiPayeeName,
        },
      });
    } catch (err) {
      console.error("admin set school UPI error", err);
      res.status(500).json({ error: "Could not update this school's UPI details." });
    }
  }
);

// ---------------------------------------------------------------------
// POST /api/admin/schools/:id/razorpay-account
// Links (or updates) a school's Razorpay Route Linked Account, once you've
// created it in the Razorpay Dashboard/API and Razorpay has finished
// verifying its KYC. See RAZORPAY_ROUTE.md.
//
// LEGACY / INERT: kept only so old data and this endpoint don't break.
// Payments now go through UPI QR (see POST /schools/:id/upi above), which
// has no gateway "order" for Route to attach a transfer to — this route
// can still be called but it no longer affects where any money goes.
//
// IMPORTANT: only set razorpaySettlementStatus to "active" once Razorpay
// shows this Linked Account's status as verified/activated on their end -
// setting it to "active" here starts splitting real money to it on this
// school's very next payment.
// ---------------------------------------------------------------------
router.post(
  "/schools/:id/razorpay-account",
  [
    body("razorpayAccountId")
      .optional({ nullable: true })
      .matches(/^acc_[A-Za-z0-9]+$/)
      .withMessage('Razorpay account id should look like "acc_XXXXXXXXXXXX".'),
    body("razorpaySettlementStatus")
      .optional()
      .isIn(["not_configured", "pending", "active"])
      .withMessage("Invalid settlement status."),
    body("commissionPercentOverride")
      .optional({ nullable: true })
      .isFloat({ min: 0, max: 100 })
      .withMessage("Commission override must be a number between 0 and 100."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const school = await School.findByPk(req.params.id);
      if (!school) return res.status(404).json({ error: "School not found." });

      const { razorpayAccountId, razorpaySettlementStatus, commissionPercentOverride } = req.body;

      if (razorpaySettlementStatus === "active" && !(razorpayAccountId || school.razorpayAccountId)) {
        return res.status(400).json({
          error: "Set a razorpayAccountId before marking this school's settlement status as active.",
        });
      }

      if (razorpayAccountId !== undefined) school.razorpayAccountId = razorpayAccountId || null;
      if (razorpaySettlementStatus !== undefined) school.razorpaySettlementStatus = razorpaySettlementStatus;
      if (commissionPercentOverride !== undefined) {
        school.commissionPercentOverride = commissionPercentOverride === null ? null : Number(commissionPercentOverride);
      }

      await school.save();

      res.json({
        ok: true,
        school: {
          id: school.id,
          schoolName: school.schoolName,
          razorpayAccountId: school.razorpayAccountId,
          razorpaySettlementStatus: school.razorpaySettlementStatus,
          commissionPercentOverride: school.commissionPercentOverride,
        },
      });
    } catch (err) {
      console.error("admin set school razorpay account error", err);
      res.status(500).json({ error: "Could not update this school's Razorpay settlement settings." });
    }
  }
);

// GET /api/admin/schools/revenue
// Platform-wide revenue broken down BY school — for the Super Admin
// overview, instead of just one lump total. Also reports how much of
// each school's revenue is still NOT covered by a generated
// SchoolInvoice yet ("uninvoiced"), so the admin can see what's still
// pending settlement at a glance.
router.get("/schools/revenue", async (req, res) => {
  try {
    const schools = await School.findAll({ attributes: ["id", "schoolName"] });
    const [individualAdmissions, bulkAdmissions, paidPayments] = await Promise.all([
      IndividualAdmission.findAll({ where: { paymentId: { [Op.ne]: null } } }),
      BulkAdmission.findAll({ where: { paymentId: { [Op.ne]: null } } }),
      Payment.findAll({ where: { status: "paid" } }),
    ]);

    const paymentById = new Map(paidPayments.map((p) => [p.id, p]));

    const revenueBySchool = new Map();
    schools.forEach((s) =>
      revenueBySchool.set(s.id, {
        schoolId: s.id,
        schoolName: s.schoolName,
        revenue: 0,
        paidCount: 0,
        uninvoicedRevenue: 0,
        uninvoicedCount: 0,
      })
    );

    const tally = (admissions) => {
      admissions.forEach((a) => {
        if (!a.schoolId) return;
        const payment = paymentById.get(a.paymentId);
        if (!payment) return;
        const entry = revenueBySchool.get(a.schoolId);
        if (!entry) return;
        entry.revenue += payment.amount;
        entry.paidCount += 1;
        if (!payment.schoolInvoiceId) {
          entry.uninvoicedRevenue += payment.amount;
          entry.uninvoicedCount += 1;
        }
      });
    };
    tally(individualAdmissions);
    tally(bulkAdmissions);

    const result = Array.from(revenueBySchool.values()).sort((a, b) => b.revenue - a.revenue);
    res.json(result);
  } catch (err) {
    console.error("admin schools revenue error", err);
    res.status(500).json({ error: "Could not load revenue breakdown." });
  }
});

// ---------------------------------------------------------------------
// School Settlement Invoices
//
// An invoice bills the SCHOOL for our platform commission (+ GST on that
// commission) over a period, and states the net amount payable to them.
// Generating one locks in the payments it covers (Payment.schoolInvoiceId)
// so the same collected amount can never appear on two invoices.
//
// IMPORTANT: the GST math here is a computed default using whatever rate
// you pass in (or the 18% fallback) - it is not verified tax advice. This
// gives you the arithmetic and a shareable PDF; have your CA/accountant
// confirm GST rate/applicability and invoice-format requirements before
// treating a generated PDF as your official tax invoice.
// ---------------------------------------------------------------------

// POST /api/admin/schools/:id/invoices
// Body (all optional): { periodStart, periodEnd, commissionPercent, gstPercent }
// No periodStart/periodEnd = "every paid payment for this school that
// hasn't been invoiced yet", which is the normal way to use this: just
// keep generating invoices, each one naturally only picks up what's new.
router.post(
  "/schools/:id/invoices",
  [
    body("periodStart").optional({ nullable: true }).isISO8601().withMessage("Invalid period start date."),
    body("periodEnd").optional({ nullable: true }).isISO8601().withMessage("Invalid period end date."),
    body("commissionPercent").optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage("Commission must be 0-100."),
    body("gstPercent").optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage("GST must be 0-100."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
      const school = await School.findByPk(req.params.id);
      if (!school) return res.status(404).json({ error: "School not found." });

      const { periodStart, periodEnd } = req.body;
      const commissionPercent =
        req.body.commissionPercent !== undefined && req.body.commissionPercent !== null
          ? Number(req.body.commissionPercent)
          : school.commissionPercentOverride !== null && school.commissionPercentOverride !== undefined
          ? school.commissionPercentOverride
          : fees.platformCommissionPercent;
      const gstPercent =
        req.body.gstPercent !== undefined && req.body.gstPercent !== null ? Number(req.body.gstPercent) : 18;

      // Find every paid, not-yet-invoiced payment for this school, in
      // both admission types, optionally restricted to a date range.
      const paymentWhere = { status: "paid", schoolInvoiceId: null };
      if (periodStart && periodEnd) {
        paymentWhere.updatedAt = { [Op.gte]: new Date(periodStart), [Op.lte]: new Date(periodEnd) };
      }

      const [individualAdmissions, bulkAdmissions] = await Promise.all([
        IndividualAdmission.findAll({ where: { schoolId: school.id, paymentId: { [Op.ne]: null } } }),
        BulkAdmission.findAll({ where: { schoolId: school.id, paymentId: { [Op.ne]: null } } }),
      ]);
      const admissionByPaymentId = new Map();
      individualAdmissions.forEach((a) => admissionByPaymentId.set(a.paymentId, { type: "individual", record: a }));
      bulkAdmissions.forEach((a) => admissionByPaymentId.set(a.paymentId, { type: "bulk", record: a }));

      const paymentIds = Array.from(admissionByPaymentId.keys());
      const payments = paymentIds.length
        ? await Payment.findAll({ where: { ...paymentWhere, id: { [Op.in]: paymentIds } } })
        : [];

      if (payments.length === 0) {
        return res.status(400).json({
          error: "No uninvoiced paid payments found for this school in the given period.",
        });
      }

      const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
      const commissionAmount = Math.round(((totalCollected * commissionPercent) / 100) * 100) / 100;
      const gstAmount = Math.round(((commissionAmount * gstPercent) / 100) * 100) / 100;
      const netPayableToSchool = Math.round((totalCollected - commissionAmount - gstAmount) * 100) / 100;

      const invoiceNumber = await generateInvoiceNumber(SchoolInvoice);

      const invoice = await SchoolInvoice.create({
        schoolId: school.id,
        invoiceNumber,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        paymentCount: payments.length,
        totalCollected,
        commissionPercent,
        commissionAmount,
        gstPercent,
        gstAmount,
        netPayableToSchool,
        pdfFileName: `${invoiceNumber}.pdf`,
        generatedByAdminId: req.admin.id,
      });

      const lineItems = payments
        .map((p) => {
          const a = admissionByPaymentId.get(p.id);
          return {
            date: p.updatedAt,
            receiptNumber: p.receiptNumber,
            description: a.type === "individual" ? a.record.studentName : a.record.organizationName,
            amount: p.amount,
          };
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      await generateSchoolInvoicePdf(invoice, school, lineItems);

      // Lock these payments to this invoice so they can never be double-billed.
      await Payment.update({ schoolInvoiceId: invoice.id }, { where: { id: { [Op.in]: payments.map((p) => p.id) } } });

      res.json({ ok: true, invoice, downloadUrl: `/api/admin/invoices/${invoice.id}/download` });
    } catch (err) {
      console.error("admin generate school invoice error", err);
      res.status(500).json({ error: "Could not generate invoice." });
    }
  }
);

// GET /api/admin/schools/:id/invoices
// Past invoices generated for this school, newest first.
router.get("/schools/:id/invoices", async (req, res) => {
  try {
    const invoices = await SchoolInvoice.findAll({
      where: { schoolId: req.params.id },
      order: [["createdAt", "DESC"]],
    });
    res.json(invoices);
  } catch (err) {
    console.error("admin list school invoices error", err);
    res.status(500).json({ error: "Could not load invoices." });
  }
});

// GET /api/admin/schools/:id/statement?startDate=&endDate=
// A plain payment history report - every payment for this school in the
// period (paid AND unpaid/failed, so nothing is hidden), regardless of
// whether it's already been settled/invoiced. Nothing is locked or
// recorded - this can be regenerated identically any number of times, at
// any time, unlike Generate Invoice above. Both startDate and endDate are
// optional; omit both for "everything, all time".
router.get("/schools/:id/statement", async (req, res) => {
  try {
    const school = await School.findByPk(req.params.id);
    if (!school) return res.status(404).json({ error: "School not found." });

    const { startDate, endDate } = req.query;
    const paymentWhere = {};
    if (startDate && endDate) {
      paymentWhere.createdAt = { [Op.gte]: new Date(startDate), [Op.lte]: new Date(endDate) };
    }

    const [individualAdmissions, bulkAdmissions] = await Promise.all([
      IndividualAdmission.findAll({ where: { schoolId: school.id, paymentId: { [Op.ne]: null } } }),
      BulkAdmission.findAll({ where: { schoolId: school.id, paymentId: { [Op.ne]: null } } }),
    ]);
    const descriptionByPaymentId = new Map();
    individualAdmissions.forEach((a) => descriptionByPaymentId.set(a.paymentId, a.studentName));
    bulkAdmissions.forEach((a) => descriptionByPaymentId.set(a.paymentId, a.organizationName));

    const paymentIds = Array.from(descriptionByPaymentId.keys());
    const payments = paymentIds.length
      ? await Payment.findAll({ where: { ...paymentWhere, id: { [Op.in]: paymentIds } }, order: [["createdAt", "ASC"]] })
      : [];

    const lineItems = payments.map((p) => ({
      date: p.createdAt,
      receiptNumber: p.receiptNumber,
      description: descriptionByPaymentId.get(p.id) || "-",
      amount: p.amount,
      status: p.status,
    }));

    const periodLabel =
      startDate && endDate
        ? `${new Date(startDate).toLocaleDateString("en-IN")} - ${new Date(endDate).toLocaleDateString("en-IN")}`
        : "All time";

    const fileName = `statement-${school.id}-${Date.now()}.pdf`;
    const filePath = path.join(INVOICES_DIR, fileName);
    await generateSchoolStatementPdf(school, lineItems, periodLabel, filePath);

    res.download(filePath, `${school.schoolName.replace(/[^\w\- ]/g, "")} - Payment Statement.pdf`, (err) => {
      // Clean up the temp file after sending (or on failure) - this
      // report is regenerate-on-demand, not a document we need to keep.
      fs.unlink(filePath, () => {});
      if (err) console.error("statement download error", err);
    });
  } catch (err) {
    console.error("admin generate school statement error", err);
    res.status(500).json({ error: "Could not generate payment statement." });
  }
});

// GET /api/admin/invoices/:id/download
router.get("/invoices/:id/download", async (req, res) => {
  try {
    const invoice = await SchoolInvoice.findByPk(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found." });

    const filePath = path.join(INVOICES_DIR, invoice.pdfFileName);

    if (!fs.existsSync(filePath)) {
      // Self-healing: the invoice's numbers are already locked in and safe
      // (this record, and which payments it covers via
      // Payment.schoolInvoiceId, never change) - only the PDF rendering
      // itself is missing, e.g. the invoices/ folder was cleared outside
      // the app. Rebuild it from what's already stored rather than
      // telling the admin their invoice is gone.
      const school = await School.findByPk(invoice.schoolId);
      if (!school) {
        return res.status(404).json({ error: "Invoice file is missing and its school no longer exists, so it can't be rebuilt." });
      }

      const coveredPayments = await Payment.findAll({ where: { schoolInvoiceId: invoice.id } });
      if (coveredPayments.length === 0) {
        return res.status(404).json({ error: "Invoice file is missing and no payments are linked to it, so it can't be rebuilt." });
      }

      const paymentIds = coveredPayments.map((p) => p.id);
      const [individualAdmissions, bulkAdmissions] = await Promise.all([
        IndividualAdmission.findAll({ where: { paymentId: { [Op.in]: paymentIds } } }),
        BulkAdmission.findAll({ where: { paymentId: { [Op.in]: paymentIds } } }),
      ]);
      const descriptionByPaymentId = new Map();
      individualAdmissions.forEach((a) => descriptionByPaymentId.set(a.paymentId, a.studentName));
      bulkAdmissions.forEach((a) => descriptionByPaymentId.set(a.paymentId, a.organizationName));

      const lineItems = coveredPayments
        .map((p) => ({
          date: p.updatedAt,
          receiptNumber: p.receiptNumber,
          description: descriptionByPaymentId.get(p.id) || "-",
          amount: p.amount,
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      await generateSchoolInvoicePdf(invoice, school, lineItems);
      console.warn(`Rebuilt missing invoice PDF ${invoice.pdfFileName} for school ${school.id}`);
    }

    res.download(filePath, invoice.pdfFileName);
  } catch (err) {
    console.error("admin download invoice error", err);
    res.status(500).json({ error: "Could not fetch invoice." });
  }
});

// ---------------------------------------------------------------------
// STUDENTS — Super Admin sees every student across every school.
// (Compare to GET /api/schools/me/individual-admissions, which a school
// account uses to see only its own students.)
// ---------------------------------------------------------------------

// GET /api/admin/students
router.get("/students", async (req, res) => {
  try {
    const records = await Student.findAll({
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: IndividualAdmission,
          include: [{ model: School, attributes: ["id", "schoolName"] }],
        },
      ],
    });

    const result = records.map((s) => {
      const admission = s.IndividualAdmission;
      return {
        id: s.id,
        fullName: s.fullName,
        email: s.email,
        grade: s.grade,
        parentName: s.parentName,
        phone: s.phone,
        programLevel: admission ? admission.programLevel : null,
        schoolId: admission ? admission.schoolId : null,
        schoolName: (admission && admission.School && admission.School.schoolName) || (admission && admission.schoolName) || "Unaffiliated",
        addedByAdmin: !!(admission && admission.extraFields && admission.extraFields.addedByAdmin),
        createdAt: s.createdAt,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("admin list students error", err);
    res.status(500).json({ error: "Could not load students." });
  }
});

// POST /api/admin/students
// Lets the Super Admin add a student directly — no payment flow, no
// parent self-registration. Creates a backing (paymentStatus: "paid",
// flagged extraFields.addedByAdmin) IndividualAdmission so the student
// still shows up correctly in that school's own portal list, plus the
// actual Student LMS login account itself. Returns a one-time temporary
// password the same way school creation does.
router.post(
  "/students",
  [
    body("fullName").trim().notEmpty().withMessage("Student name is required."),
    body("email").isEmail().withMessage("A valid email is required."),
    body("programLevel")
      .isIn(["level1", "level2", "level3", "level4"])
      .withMessage("A valid program level is required."),
    body("schoolId").notEmpty().withMessage("Please select a school."),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { fullName, email, programLevel, schoolId, grade, parentName, phone } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const school = await School.findByPk(schoolId);
      if (!school) return res.status(404).json({ error: "Selected school was not found." });

      const existingEmail = await Student.findOne({ where: { email: normalizedEmail } });
      if (existingEmail) {
        return res.status(409).json({ error: "A student account with this email already exists." });
      }

      const admission = await IndividualAdmission.create({
        studentName: fullName,
        grade: grade || "",
        schoolName: school.schoolName,
        schoolId: school.id,
        parentName: parentName || "",
        mobile: phone || "0000000000",
        email: normalizedEmail,
        programLevel,
        paymentStatus: "paid",
        extraFields: { addedByAdmin: true },
      });

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      const student = await Student.create({
        admissionId: admission.id,
        fullName,
        grade: grade || "",
        parentName: parentName || "",
        phone: phone || "",
        email: normalizedEmail,
        passwordHash,
      });

      let emailSent = false;
      try {
        await sendStudentCredentialsEmail({
          toEmail: student.email,
          fullName: student.fullName,
          temporaryPassword: tempPassword,
        });
        emailSent = true;
      } catch (emailErr) {
        console.error("Could not send student welcome email:", emailErr.message);
      }

      res.status(201).json({
        student: {
          id: student.id,
          fullName: student.fullName,
          email: student.email,
          programLevel,
          schoolName: school.schoolName,
        },
        temporaryPassword: tempPassword,
        emailSent,
      });
    } catch (err) {
      console.error("admin add student error", err);
      res.status(500).json({ error: "Could not create student account. Please try again." });
    }
  }
);

// DELETE /api/admin/students/:id
// Fully removes a student: their LMS login (Student), their quiz history,
// the payment(s) tied to their registration, and the registration
// (IndividualAdmission) itself. Deleting only the Student row used to
// leave the underlying admission behind, which meant the student kept
// showing up as "registered" in their school's own portal even after
// being deleted here - this removes the whole record so the deletion is
// actually final everywhere.
router.delete("/students/:id", async (req, res) => {
  try {
    const student = await Student.findByPk(req.params.id);
    if (!student) return res.json({ ok: true }); // already gone

    const admissionId = student.admissionId;

    await QuizResult.destroy({ where: { studentId: student.id } });
    if (admissionId) {
      await Payment.destroy({ where: { admissionId } });
    }
    await student.destroy();
    if (admissionId) {
      await IndividualAdmission.destroy({ where: { id: admissionId } });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("admin delete student error", err);
    res.status(500).json({ error: "Could not delete student." });
  }
});

module.exports = router;
