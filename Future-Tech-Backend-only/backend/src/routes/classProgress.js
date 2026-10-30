const express = require("express");
const { ClassProgress, Student, IndividualAdmission } = require("../models");
const { requireStudentAuth } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_LEVELS = ["level1", "level2", "level3", "level4"];

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * POST /api/class-progress
 * Body: { level, module, file }
 * Marks one class's notes PDF as opened for the logged-in student.
 * Idempotent - opening the same PDF again just no-ops (findOrCreate).
 */
router.post("/", requireStudentAuth, async (req, res) => {
  try {
    const { level, module: moduleParam, file } = req.body || {};

    if (!ALLOWED_LEVELS.includes(level)) return badRequest(res, "Unknown level.");
    if (!/^module\d+$/.test(moduleParam || "")) return badRequest(res, "Invalid module reference.");
    if (!file || typeof file !== "string" || file.length > 128) return badRequest(res, "Invalid file reference.");

    // Same ownership check used for PDF access/quiz results - a student
    // may only log progress against their OWN registered level.
    const student = await Student.findByPk(req.student.id);
    if (!student) return res.status(404).json({ error: "Account not found." });
    const admission = await IndividualAdmission.findByPk(student.admissionId);
    if (!admission || admission.programLevel !== level) {
      return res.status(403).json({ error: "You don't have access to this level." });
    }

    await ClassProgress.findOrCreate({
      where: { studentId: req.student.id, level, module: moduleParam, file },
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("save class progress error", err);
    res.status(500).json({ error: "Could not save your progress." });
  }
});

/**
 * GET /api/class-progress/me?level=level1&module=module1
 * Returns the list of filenames this student has opened for that
 * level/module - e.g. { files: ["cl1.pdf", "cl2.pdf"] }
 */
router.get("/me", requireStudentAuth, async (req, res) => {
  try {
    const { level, module: moduleParam } = req.query;
    if (!ALLOWED_LEVELS.includes(level)) return badRequest(res, "Unknown level.");
    if (!/^module\d+$/.test(moduleParam || "")) return badRequest(res, "Invalid module reference.");

    const rows = await ClassProgress.findAll({
      where: { studentId: req.student.id, level, module: moduleParam },
      attributes: ["file"],
    });

    res.json({ files: rows.map((r) => r.file) });
  } catch (err) {
    console.error("fetch class progress error", err);
    res.status(500).json({ error: "Could not load your progress." });
  }
});

module.exports = router;
