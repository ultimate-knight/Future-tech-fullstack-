const express = require("express");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const { School, BulkAdmission, IndividualAdmission, Payment, Student } = require("../models");
const { requireSchoolAuth } = require("../middleware/auth");
const { confirmPaymentPaid, getAdmission } = require("../services/paymentService");

const router = express.Router();

// GET /api/schools/list
// PUBLIC — no auth. Used to populate the "Your School" dropdown on the
// individual admission form. Only returns id + name, nothing sensitive,
// and only schools whose account is currently active.
router.get("/list", async (req, res) => {
  try {
    const records = await School.findAll({
      where: { isActive: true },
      attributes: ["id", "schoolName"],
      order: [["schoolName", "ASC"]],
    });
    res.json(records);
  } catch (err) {
    console.error("schools list error", err);
    res.status(500).json({ error: "Could not load school list." });
  }
});

// GET /api/schools/me
router.get("/me", requireSchoolAuth, async (req, res) => {
  const school = await School.findByPk(req.school.id);
  if (!school) return res.status(404).json({ error: "Account not found." });
  res.json({
    id: school.id,
    schoolName: school.schoolName,
    contactName: school.contactName,
    email: school.email,
    phone: school.phone,
    createdAt: school.createdAt,
  });
});

// GET /api/schools/me/bulk-admissions
// Returns this school's bulk admission enquiries (matched by schoolId,
// set automatically when a logged-in school submits the bulk form).
router.get("/me/bulk-admissions", requireSchoolAuth, async (req, res) => {
  const records = await BulkAdmission.findAll({
    where: { schoolId: req.school.id },
    order: [["createdAt", "DESC"]],
  });

  const withPayments = await Promise.all(
    records.map(async (r) => {
      // r.paymentId is only ever set once a payment is confirmed PAID (see
      // paymentService.confirmPaymentPaid), so it's always null while a
      // payment is still pending - looking it up that way meant a pending
      // payment could never be found here, and the "Mark as Paid/Failed"
      // buttons never appeared. Look up the most recent payment for this
      // admission directly instead, regardless of admission.paymentId.
      const payment = await Payment.findOne({
        where: { type: "bulk", admissionId: r.id },
        order: [["createdAt", "DESC"]],
      });
      return {
        id: r.id,
        organizationName: r.organizationName,
        coordinatorName: r.coordinatorName,
        studentCount: r.studentCount,
        selections: r.selections,
        paymentStatus: r.paymentStatus,
        submittedAt: r.createdAt,
        // NOTE: this is the Payment record's id (needed for the receipt
        // download URL /api/receipts/:paymentId/download), not the bulk
        // admission's own id.
        paymentRecordId: payment && payment.status === "paid" ? payment.id : null,
        receiptNumber: payment && payment.status === "paid" ? payment.receiptNumber : null,
        amountPaid: payment && payment.status === "paid" ? payment.amount : null,
        // Present whenever a payment has been started, regardless of
        // status — lets the portal show "Mark as Paid" for a pending one
        // (see POST /me/payments/:id/mark-paid below) with the amount +
        // reference to check against the bank/UPI app.
        pendingPayment:
          payment && payment.status === "pending"
            ? { paymentId: payment.id, amount: payment.amount, referenceId: payment.referenceId }
            : null,
      };
    })
  );

  res.json(withPayments);
});

// GET /api/schools/me/individual-admissions
// Returns individual student admissions where this school was selected
// on the admission form — this school's own students only.
router.get("/me/individual-admissions", requireSchoolAuth, async (req, res) => {
  const records = await IndividualAdmission.findAll({
    where: { schoolId: req.school.id },
    order: [["createdAt", "DESC"]],
  });

  const withPayments = await Promise.all(
    records.map(async (r) => {
      // See the matching note in /me/bulk-admissions above - look up the
      // payment directly by admissionId rather than via r.paymentId, which
      // stays null until a payment is already marked paid.
      const payment = await Payment.findOne({
        where: { type: "individual", admissionId: r.id },
        order: [["createdAt", "DESC"]],
      });
      // Whether the student (or their parent) has completed the
      // post-payment "create password" step and can log in to the LMS.
      const studentAccount = await Student.findOne({ where: { admissionId: r.id } });
      return {
        id: r.id,
        studentName: r.studentName,
        grade: r.grade,
        parentName: r.parentName,
        mobile: r.mobile,
        programLevel: r.programLevel,
        paymentStatus: r.paymentStatus,
        submittedAt: r.createdAt,
        // NOTE: this is the Payment record's id (needed for the receipt
        // download URL /api/receipts/:paymentId/download), not this
        // admission's own id — same distinction as bulk-admissions above.
        paymentRecordId: payment && payment.status === "paid" ? payment.id : null,
        receiptNumber: payment && payment.status === "paid" ? payment.receiptNumber : null,
        amountPaid: payment && payment.status === "paid" ? payment.amount : null,
        hasStudentAccount: !!studentAccount,
        // Present whenever a payment has been started, regardless of
        // status — lets the portal show "Mark as Paid" for a pending one
        // (see POST /me/payments/:id/mark-paid below) with the amount +
        // reference to check against the bank/UPI app.
        pendingPayment:
          payment && payment.status === "pending"
            ? { paymentId: payment.id, amount: payment.amount, referenceId: payment.referenceId }
            : null,
      };
    })
  );

  res.json(withPayments);
});

// POST /api/schools/me/change-password
// Lets a logged-in school swap out the temporary password an admin
// gave them for one they choose themselves.
router.post(
  "/me/change-password",
  requireSchoolAuth,
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
      const school = await School.findByPk(req.school.id);
      if (!school) return res.status(404).json({ error: "Account not found." });

      const match = await bcrypt.compare(req.body.currentPassword, school.passwordHash);
      if (!match) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }

      school.passwordHash = await bcrypt.hash(req.body.newPassword, 10);
      await school.save();

      res.json({ ok: true, message: "Password updated successfully." });
    } catch (err) {
      console.error("school change-password error", err);
      res.status(500).json({ error: "Could not update password. Please try again." });
    }
  }
);

// ---------------------------------------------------------------------
// POST /api/schools/me/payments/:id/mark-paid
// A school confirming, from their own portal, that a payment (for one of
// their own students, or their own bulk enquiry) actually arrived in
// their account — the school-side counterpart to the platform admin's
// POST /api/admin/payments/:id/mark-paid. Since payments now route
// straight to whichever account is configured for that admission (a
// school's own UPI ID, or the platform's), it's whoever actually
// receives the money who's in the best position to confirm it.
//
// Ownership is strictly enforced: a school can only confirm a payment
// whose underlying admission belongs to them (checked below), never any
// other school's or the platform's own fallback payments.
// ---------------------------------------------------------------------
router.post("/me/payments/:id/mark-paid", requireSchoolAuth, async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: "Payment not found." });

    const admission = await getAdmission(payment.type, payment.admissionId);
    if (!admission || admission.schoolId !== req.school.id) {
      return res.status(403).json({ error: "You don't have access to this payment." });
    }

    if (payment.status === "failed") {
      return res.status(409).json({
        error: "This payment was previously marked failed. Please contact support if you believe this was a mistake.",
      });
    }

    await confirmPaymentPaid(payment, { markedPaidBySchoolId: req.school.id });
    res.json({ ok: true });
  } catch (err) {
    console.error("school mark-paid error", err);
    res.status(500).json({ error: "Could not mark this payment as paid." });
  }
});

// POST /api/schools/me/payments/:id/mark-failed
// The school-side counterpart to the admin's mark-failed — for rejecting
// a payment claim that never actually showed up in their account.
router.post("/me/payments/:id/mark-failed", requireSchoolAuth, async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.id);
    if (!payment) return res.status(404).json({ error: "Payment not found." });

    const admission = await getAdmission(payment.type, payment.admissionId);
    if (!admission || admission.schoolId !== req.school.id) {
      return res.status(403).json({ error: "You don't have access to this payment." });
    }

    if (payment.status === "paid") {
      return res.status(409).json({ error: "This payment has already been confirmed as paid and can't be marked failed." });
    }

    payment.status = "failed";
    await payment.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("school mark-failed error", err);
    res.status(500).json({ error: "Could not mark this payment as failed." });
  }
});

module.exports = router;
