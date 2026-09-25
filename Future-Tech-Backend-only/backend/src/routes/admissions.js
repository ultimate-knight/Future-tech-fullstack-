const express = require("express");
const { body, validationResult } = require("express-validator");
const { IndividualAdmission, BulkAdmission, School } = require("../models");
const fees = require("../config/fees");

const router = express.Router();

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

// A resubmission of the exact same admission (double-click on "Submit &
// Pay", a slow network retry, or a back-button + resubmit) within this
// window reuses the existing PENDING record instead of creating a new
// duplicate one. Once an admission has actually been paid for, it's no
// longer "the same pending submission" - a genuinely new registration for
// the same student is allowed to proceed as a fresh record.
const DUPLICATE_SUBMISSION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------
// POST /api/admissions/individual
// Creates a pending admission record and returns the fee to be paid.
// The frontend then calls /api/payments/create-order with this id.
// ---------------------------------------------------------------------
router.post(
  "/individual",
  [
    body("studentName").trim().notEmpty().withMessage("Student full name is required."),
    body("mobile").trim().notEmpty().withMessage("Parent/guardian mobile number is required."),
    body("programLevel")
      .isIn(["level1", "level2", "level3", "level4"])
      .withMessage("Please select a valid program level."),
    body("schoolId").notEmpty().withMessage("Please select your school."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const {
      studentName,
      grade,
      schoolId,
      parentName,
      mobile,
      email,
      programLevel,
      interests,
      consents,
      extraFields,
    } = req.body;

    try {
      const school = await School.findOne({ where: { id: schoolId, isActive: true } });
      if (!school) {
        return res.status(400).json({ error: "The selected school could not be found. Please choose again." });
      }

      // Duplicate-submission guard: if this exact registration (same
      // student name + mobile + school + level) was already submitted a
      // few minutes ago and is still unpaid, reuse that record instead of
      // creating a second one (see DUPLICATE_SUBMISSION_WINDOW_MS above).
      const { Op } = require("sequelize");
      const recentDuplicate = await IndividualAdmission.findOne({
        where: {
          studentName,
          mobile,
          schoolId: school.id,
          programLevel,
          paymentStatus: "pending",
          createdAt: { [Op.gte]: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) },
        },
        order: [["createdAt", "DESC"]],
      });

      const admission =
        recentDuplicate ||
        (await IndividualAdmission.create({
          studentName,
          grade,
          schoolId: school.id,
          schoolName: school.schoolName,
          parentName,
          mobile,
          email,
          programLevel,
          interests: interests || [],
          consents: consents || [],
          extraFields: extraFields || {},
        }));

      const amount = fees.individualLevelFees[programLevel];

      res.status(201).json({
        admissionId: admission.id,
        amount,
        currency: fees.currency,
      });
    } catch (err) {
      console.error("individual admission create error", err);
      res.status(500).json({ error: "Could not save your registration. Please try again." });
    }
  }
);

// ---------------------------------------------------------------------
// POST /api/admissions/bulk
// Creates a pending bulk/school enquiry and returns the fee to be paid.
// If the request carries a valid school JWT, the record is linked to
// that school's account automatically.
// ---------------------------------------------------------------------
router.post(
  "/bulk",
  [
    body("organizationName").trim().notEmpty().withMessage("Organization / school name is required."),
    body("coordinatorMobile").trim().notEmpty().withMessage("Coordinator mobile number is required."),
  ],
  async (req, res) => {
    if (handleValidation(req, res)) return;

    const {
      organizationName,
      coordinatorName,
      coordinatorMobile,
      coordinatorEmail,
      students,
      selections,
      extraFields,
      excelFileName,
    } = req.body;

    try {
      // Optionally link to a logged-in school account
      let schoolId = null;
      const authHeader = req.headers.authorization || "";
      if (authHeader.startsWith("Bearer ")) {
        try {
          const { verifyToken } = require("../utils/jwt");
          const decoded = verifyToken(authHeader.slice(7));
          if (decoded.role === "school") schoolId = decoded.id;
        } catch (e) {
          // ignore invalid/expired token here — bulk enquiries can also
          // be submitted by schools who haven't registered an account
        }
      }

      const studentList = Array.isArray(students) ? students : [];
      const studentCount = studentList.length;

      const { Op } = require("sequelize");
      const recentDuplicate = await BulkAdmission.findOne({
        where: {
          organizationName,
          coordinatorMobile,
          paymentStatus: "pending",
          createdAt: { [Op.gte]: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) },
        },
        order: [["createdAt", "DESC"]],
      });

      const admission =
        recentDuplicate ||
        (await BulkAdmission.create({
          organizationName,
          coordinatorName,
          coordinatorMobile,
          coordinatorEmail,
          schoolId,
          students: studentList,
          studentCount,
          selections: selections || [],
          extraFields: extraFields || {},
          excelFileName: excelFileName || null,
        }));

      const amount = Math.max(
        fees.bulkMinimum,
        studentCount * fees.bulkPerStudent || fees.bulkMinimum
      );

      res.status(201).json({
        admissionId: admission.id,
        amount,
        currency: fees.currency,
      });
    } catch (err) {
      console.error("bulk admission create error", err);
      res.status(500).json({ error: "Could not save your enquiry. Please try again." });
    }
  }
);

module.exports = router;
