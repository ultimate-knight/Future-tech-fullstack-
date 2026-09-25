const express = require("express");
const bcrypt = require("bcryptjs");
const { body, validationResult } = require("express-validator");
const { School, Admin, Student, IndividualAdmission } = require("../models");
const { signToken } = require("../utils/jwt");
const { sendStudentWelcomeEmail } = require("../services/emailService");

const router = express.Router();

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// NOTE: There is no public POST /school/register endpoint anymore.
// School accounts are created by an admin (POST /api/admin/schools,
// see src/routes/admin.js) after a school has enrolled and paid — this
// matches the intended workflow: credentials are issued by staff, not
// self-created by visitors.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// POST /api/auth/school/login
// ---------------------------------------------------------------------
router.post(
  "/school/login",
  [
    body("email").isEmail().withMessage("A valid email is required."),
    body("password").notEmpty().withMessage("Password is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    try {
      const school = await School.findOne({ where: { email } });
      if (!school) return res.status(401).json({ error: "Incorrect email or password." });

      const match = await bcrypt.compare(password, school.passwordHash);
      if (!match) return res.status(401).json({ error: "Incorrect email or password." });

      if (!school.isActive) {
        return res.status(403).json({ error: "This account has been suspended. Please contact Future Tech School Program support." });
      }

      const token = signToken({ role: "school", id: school.id, email: school.email });
      res.json({
        token,
        school: {
          id: school.id,
          schoolName: school.schoolName,
          contactName: school.contactName,
          email: school.email,
          phone: school.phone,
          createdAt: school.createdAt,
        },
      });
    } catch (err) {
      console.error("school login error", err);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  }
);

// ---------------------------------------------------------------------
// POST /api/auth/admin/login
// ---------------------------------------------------------------------
router.post(
  "/admin/login",
  [
    body("email").isEmail().withMessage("A valid email is required."),
    body("password").notEmpty().withMessage("Password is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    try {
      const admin = await Admin.findOne({ where: { email } });
      if (!admin) return res.status(401).json({ error: "Incorrect email or password." });

      const match = await bcrypt.compare(password, admin.passwordHash);
      if (!match) return res.status(401).json({ error: "Incorrect email or password." });

      const token = signToken({ role: "admin", id: admin.id, email: admin.email });
      res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
    } catch (err) {
      console.error("admin login error", err);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  }
);

module.exports = router;

// ---------------------------------------------------------------------
// STUDENT LMS ACCOUNTS
// Registration is gated by a successful payment — you cannot create a
// student account without a matching PAID IndividualAdmission. This is
// checked server-side, never trusted from the client.
// ---------------------------------------------------------------------

// POST /api/auth/student/register
router.post(
  "/student/register",
  [
    body("admissionId").notEmpty().withMessage("Missing admission reference."),
    body("email").isEmail().withMessage("A valid email is required."),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
    body("fullName").trim().notEmpty().withMessage("Full name is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const { admissionId, email, password, fullName, dob, grade, parentName, phone, address } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    try {
      // 1. The admission must exist and must actually be PAID.
      const admission = await IndividualAdmission.findByPk(admissionId);
      if (!admission) {
        return res.status(404).json({ error: "We couldn't find that registration. Please check the link and try again." });
      }
      if (admission.paymentStatus !== "paid") {
        return res.status(403).json({ error: "Payment for this registration hasn't been confirmed yet. Please complete payment first." });
      }

      // 2. This admission must not already have a student account (one account per paid admission).
      const existingForAdmission = await Student.findOne({ where: { admissionId } });
      if (existingForAdmission) {
        return res.status(409).json({ error: "A student account already exists for this registration. Please log in instead." });
      }

      // 3. Email must not already be used by a different student account.
      const existingEmail = await Student.findOne({ where: { email: normalizedEmail } });
      if (existingEmail) {
        return res.status(409).json({ error: "An account with this email already exists. Please log in instead." });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const student = await Student.create({
        admissionId,
        fullName,
        dob: dob || null,
        grade: grade || admission.grade || "",
        parentName: parentName || admission.parentName || "",
        phone: phone || admission.mobile || "",
        address: address || "",
        email: normalizedEmail,
        passwordHash,
      });

      // Best-effort welcome email with the portal link and their password
      // (user's explicit request — students forget passwords, this is
      // easier than a reset flow). Never block account creation itself
      // just because SMTP isn't configured or a send fails.
      let emailSent = false;
      try {
        await sendStudentWelcomeEmail({ toEmail: student.email, fullName: student.fullName, password });
        emailSent = true;
      } catch (emailErr) {
        console.error("Could not send student welcome email. Full error below:");
        console.error(emailErr);
      }

      const token = signToken({ role: "student", id: student.id, email: student.email });
      res.status(201).json({
        token,
        student: {
          id: student.id,
          fullName: student.fullName,
          email: student.email,
          grade: student.grade,
        },
        emailSent,
      });
    } catch (err) {
      console.error("student register error", err);
      res.status(500).json({ error: "Could not create your account. Please try again." });
    }
  }
);

// POST /api/auth/student/login
router.post(
  "/student/login",
  [
    body("email").isEmail().withMessage("A valid email is required."),
    body("password").notEmpty().withMessage("Password is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const email = req.body.email.trim().toLowerCase();
    const { password } = req.body;

    try {
      const student = await Student.findOne({ where: { email } });
      if (!student) return res.status(401).json({ error: "Incorrect email or password." });

      const match = await bcrypt.compare(password, student.passwordHash);
      if (!match) return res.status(401).json({ error: "Incorrect email or password." });

      const token = signToken({ role: "student", id: student.id, email: student.email });
      res.json({
        token,
        student: {
          id: student.id,
          fullName: student.fullName,
          email: student.email,
          grade: student.grade,
        },
      });
    } catch (err) {
      console.error("student login error", err);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  }
);

module.exports = router;
