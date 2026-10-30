const express = require("express");
const { QuizResult, Student, IndividualAdmission } = require("../models");
const { requireStudentAuth } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_LEVELS = ["level1", "level2", "level3", "level4"];

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * POST /api/quiz-results
 * Body: { level, module, quizId, score, correctCount, totalQuestions, passed }
 * Saves one attempt for the logged-in student. Always accepted as a new
 * attempt row (attemptNumber auto-increments) — the "best attempt" view
 * used for progress tracking is computed in GET /me below.
 */
router.post("/", requireStudentAuth, async (req, res) => {
  try {
    const { level, module: moduleParam, quizId, score, correctCount, totalQuestions, passed } =
      req.body || {};

    if (!ALLOWED_LEVELS.includes(level)) return badRequest(res, "Unknown level.");
    if (!/^module\d+$/.test(moduleParam || "")) return badRequest(res, "Invalid module reference.");
    if (typeof score !== "number" || score < 0 || score > 100) return badRequest(res, "Invalid score.");

    // A student may only log a result against their OWN registered level
    // (mirrors the same check used for PDF access in content.js).
    const student = await Student.findByPk(req.student.id);
    if (!student) return res.status(404).json({ error: "Account not found." });
    const admission = await IndividualAdmission.findByPk(student.admissionId);
    if (!admission || admission.programLevel !== level) {
      return res.status(403).json({ error: "You don't have access to this level." });
    }

    const safeQuizId = String(quizId || "module-quiz").slice(0, 64);

    const previousCount = await QuizResult.count({
      where: { studentId: req.student.id, level, module: moduleParam, quizId: safeQuizId },
    });

    const result = await QuizResult.create({
      studentId: req.student.id,
      level,
      module: moduleParam,
      quizId: safeQuizId,
      score: Math.round(score),
      correctCount: Number(correctCount) || 0,
      totalQuestions: Number(totalQuestions) || 0,
      passed: !!passed,
      attemptNumber: previousCount + 1,
    });

    res.status(201).json({
      id: result.id,
      score: result.score,
      passed: result.passed,
      attemptNumber: result.attemptNumber,
      createdAt: result.createdAt,
    });
  } catch (err) {
    console.error("save quiz result error", err);
    res.status(500).json({ error: "Could not save your quiz result. Your score was still shown above." });
  }
});

/**
 * GET /api/quiz-results/me
 * Returns the student's best attempt (highest score) per level/module/quizId,
 * plus how many times they've attempted each one. Used to power the
 * "Progress Tracking" section of the student portal.
 */
router.get("/me", requireStudentAuth, async (req, res) => {
  try {
    const rows = await QuizResult.findAll({
      where: { studentId: req.student.id },
      order: [["createdAt", "ASC"]],
    });

    const byKey = {};
    rows.forEach((r) => {
      const key = r.level + ":" + r.module + ":" + r.quizId;
      if (!byKey[key]) {
        byKey[key] = {
          level: r.level,
          module: r.module,
          quizId: r.quizId,
          bestScore: r.score,
          passed: r.passed,
          attempts: 0,
          lastAttemptAt: r.createdAt,
        };
      }
      byKey[key].attempts += 1;
      if (r.score > byKey[key].bestScore) {
        byKey[key].bestScore = r.score;
        byKey[key].passed = r.passed;
      }
      byKey[key].lastAttemptAt = r.createdAt;
    });

    res.json({ results: Object.values(byKey) });
  } catch (err) {
    console.error("fetch quiz results error", err);
    res.status(500).json({ error: "Could not load quiz progress." });
  }
});

module.exports = router;
