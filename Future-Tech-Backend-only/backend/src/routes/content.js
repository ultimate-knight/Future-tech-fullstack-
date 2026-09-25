const express = require("express");
const path = require("path");
const fs = require("fs");
const { verifyToken } = require("../utils/jwt");
const { Student, IndividualAdmission } = require("../models");

const router = express.Router();

// PDFs live OUTSIDE the publicly-hosted frontend, inside the backend
// project, so they can never be reached directly by URL - only through
// this authenticated, level-checked route.
//   backend/content/pdfs/<level>/<module>/<filename>.pdf
const CONTENT_ROOT = path.join(__dirname, "..", "..", "content", "pdfs");

const ALLOWED_LEVELS = ["level1", "level2", "level3", "level4"];

/**
 * Same idea as requireStudentAuth in middleware/auth.js, but also accepts
 * the token as a ?token= query param. Needed because these links are
 * opened as plain file downloads / new tabs (<a>, window.open), which
 * can't attach a custom Authorization header.
 */
function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (req.query.token) return req.query.token;
  return null;
}

function requireStudentAuthFlexible(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Login required." });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== "student") throw new Error("wrong role");
    req.student = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
  }
}

// GET /api/content/pdf/:level/:module/:filename
// e.g. /api/content/pdf/level1/module1/cl1.pdf
router.get("/pdf/:level/:module/:filename", requireStudentAuthFlexible, async (req, res) => {
  const { level, module: moduleParam, filename } = req.params;

  if (!ALLOWED_LEVELS.includes(level)) {
    return res.status(400).json({ error: "Unknown level." });
  }
  // Reject anything that isn't a plain "moduleN" segment or a plain
  // filename - blocks path traversal (../../etc) before it ever touches fs.
  if (!/^module\d+$/.test(moduleParam)) {
    return res.status(400).json({ error: "Invalid module reference." });
  }
  if (!/^[\w\- .]+\.pdf$/i.test(filename) || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid file reference." });
  }

  try {
    const student = await Student.findByPk(req.student.id);
    if (!student) return res.status(404).json({ error: "Account not found." });

    const admission = await IndividualAdmission.findByPk(student.admissionId);
    if (!admission || admission.programLevel !== level) {
      return res.status(403).json({ error: "You don't have access to this level's content." });
    }

    const filePath = path.join(CONTENT_ROOT, level, moduleParam, filename);

    // Belt-and-braces: resolved path must still be inside CONTENT_ROOT.
    if (!filePath.startsWith(CONTENT_ROOT + path.sep)) {
      return res.status(400).json({ error: "Invalid file reference." });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found." });
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error("content pdf error", err);
    res.status(500).json({ error: "Could not load file." });
  }
});

module.exports = router;
