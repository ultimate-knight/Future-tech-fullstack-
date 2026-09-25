const express = require("express");
const { Student, IndividualAdmission } = require("../models");
const { requireStudentAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/students/me
router.get("/me", requireStudentAuth, async (req, res) => {
  const student = await Student.findByPk(req.student.id);
  if (!student) return res.status(404).json({ error: "Account not found." });

  const admission = await IndividualAdmission.findByPk(student.admissionId);

  res.json({
    id: student.id,
    fullName: student.fullName,
    email: student.email,
    grade: student.grade,
    parentName: student.parentName,
    phone: student.phone,
    address: student.address,
    dob: student.dob,
    programLevel: admission ? admission.programLevel : null,
    createdAt: student.createdAt,
  });
});

module.exports = router;
