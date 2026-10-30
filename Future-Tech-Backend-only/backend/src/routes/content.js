const express = require("express");
const path = require("path");
const fs = require("fs");
const { verifyToken } = require("../utils/jwt");
const { Student, IndividualAdmission, School, ClassContent, LiveClass, ClassProgress, QuizResult } = require("../models");

const router = express.Router();

// Recorded class videos live here, alongside PDFs under content/ - same
// auth-gating approach as PDFs (see requireStudentAuthFlexible below).
//   backend/content/videos/<level>/<module>/<filename>
const VIDEO_ROOT = path.join(__dirname, "..", "..", "content", "videos");

// School logo files live here (separate from the auth-gated PDFs below -
// logos are PUBLIC branding images, not protected content).
//   backend/content/school-logos/<schoolId>.<ext>
const LOGO_ROOT = path.join(__dirname, "..", "..", "content", "school-logos");

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

// Shared by the routes below - confirms the logged-in student's own
// registered level matches the level they're asking for content from.
// Returns the Student row on success, or sends an error response and
// returns null on failure.
async function requireOwnLevel(req, res, level) {
  const student = await Student.findByPk(req.student.id);
  if (!student) {
    res.status(404).json({ error: "Account not found." });
    return null;
  }
  const admission = await IndividualAdmission.findByPk(student.admissionId);
  if (!admission || admission.programLevel !== level) {
    res.status(403).json({ error: "You don't have access to this level's content." });
    return null;
  }
  return student;
}

// GET /api/content/classes/:level/:module
// The list of classes (title, whether a PDF/video exists) for a level's
// module - what used to be a hardcoded CLASSES array inside each
// module1.html, now admin-managed (see adminClassContent.js) and fetched
// live here instead.
router.get("/classes/:level/:module", requireStudentAuthFlexible, async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!ALLOWED_LEVELS.includes(level)) return res.status(400).json({ error: "Unknown level." });
  if (!/^module\d+$/.test(moduleParam)) return res.status(400).json({ error: "Invalid module reference." });

  try {
    const student = await requireOwnLevel(req, res, level);
    if (!student) return;

    const rows = await ClassContent.findAll({
      where: { level, module: moduleParam },
      order: [["classNumber", "ASC"]],
      attributes: ["id", "classNumber", "title", "pdfFilename", "videoFilename", "videoUrl"],
    });

    res.json(
      rows.map((r) => ({
        id: r.id,
        classNumber: r.classNumber,
        title: r.title,
        pdfFile: r.pdfFilename || null,
        videoFile: r.videoFilename || null,
        videoUrl: r.videoFilename ? null : r.videoUrl || null, // an uploaded file takes priority
      }))
    );
  } catch (err) {
    console.error("list classes error", err);
    res.status(500).json({ error: "Could not load classes." });
  }
});

// GET /api/content/live-class/:level/:module
// The "Live Class" meeting link for this level/module, if the admin has
// set one. Gated behind a valid student login for that level (not fully
// public) so the meeting link doesn't leak to outsiders.
router.get("/live-class/:level/:module", requireStudentAuthFlexible, async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!ALLOWED_LEVELS.includes(level)) return res.status(400).json({ error: "Unknown level." });
  if (!/^module\d+$/.test(moduleParam)) return res.status(400).json({ error: "Invalid module reference." });

  try {
    const student = await requireOwnLevel(req, res, level);
    if (!student) return;

    const row = await LiveClass.findOne({ where: { level, module: moduleParam } });
    res.json({ meetingUrl: (row && row.meetingUrl) || null, note: (row && row.note) || null });
  } catch (err) {
    console.error("live class lookup error", err);
    res.status(500).json({ error: "Could not load live class info." });
  }
});

// GET /api/content/video/:level/:module/:filename
// Streams a recorded class video with HTTP Range support, so the video
// element can seek properly instead of only playing from the start.
router.get("/video/:level/:module/:filename", requireStudentAuthFlexible, async (req, res) => {
  const { level, module: moduleParam, filename } = req.params;

  if (!ALLOWED_LEVELS.includes(level)) return res.status(400).json({ error: "Unknown level." });
  if (!/^module\d+$/.test(moduleParam)) return res.status(400).json({ error: "Invalid module reference." });
  if (!/^[\w-]+\.(mp4|webm|ogv|mov)$/i.test(filename) || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid file reference." });
  }

  try {
    const student = await requireOwnLevel(req, res, level);
    if (!student) return;

    const filePath = path.join(VIDEO_ROOT, level, moduleParam, filename);
    if (!filePath.startsWith(VIDEO_ROOT + path.sep)) {
      return res.status(400).json({ error: "Invalid file reference." });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Video not found." });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeByExt = { mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime" };
    const contentType = mimeByExt[ext] || "application/octet-stream";

    if (!range) {
      res.writeHead(200, { "Content-Length": fileSize, "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
      res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
      return res.end();
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch (err) {
    console.error("video stream error", err);
    if (!res.headersSent) res.status(500).json({ error: "Could not load video." });
  }
});

// GET /api/content/module-status/:level
// For the logged-in student's own level: every module that has any
// classes set up, how many of its classes this student has opened, and
// whether it's unlocked. A module unlocks once the PREVIOUS module is
// "complete" - all of its classes opened, and (only for module1 right
// now, the only module with a quiz/practical built) its quiz passed too.
// Module 1 is always unlocked. This is the single source of truth the
// student portal and each module page both check before showing content.
router.get("/module-status/:level", requireStudentAuthFlexible, async (req, res) => {
  const { level } = req.params;
  if (!ALLOWED_LEVELS.includes(level)) return res.status(400).json({ error: "Unknown level." });

  try {
    const student = await requireOwnLevel(req, res, level);
    if (!student) return;

    const classRows = await ClassContent.findAll({
      where: { level },
      attributes: ["id", "module", "classNumber"],
    });
    if (!classRows.length) return res.json({ modules: [] });

    const moduleNumbers = Array.from(
      new Set(classRows.map((r) => parseInt(r.module.replace("module", ""), 10)))
    ).sort((a, b) => a - b);

    const progressRows = await ClassProgress.findAll({ where: { studentId: req.student.id, level } });
    const openedIds = new Set(progressRows.map((r) => r.file)); // "file" holds the classId (see classProgress.js)

    const quizResults = await QuizResult.findAll({ where: { studentId: req.student.id, level } });
    const quizByModule = {};
    quizResults.forEach((r) => {
      // quizId looks like "module1-quiz" - only the "-quiz" one gates
      // progress; "-practical" stays optional/supplementary.
      const m = /^(module\d+)-quiz$/.exec(r.quizId);
      if (m) quizByModule[m[1]] = r.passed;
    });

    let previousComplete = true; // module 1 is always unlocked
    const modules = moduleNumbers.map((num) => {
      const moduleKey = "module" + num;
      const classesInModule = classRows.filter((r) => r.module === moduleKey);
      const total = classesInModule.length;
      const opened = classesInModule.filter((r) => openedIds.has(r.id)).length;
      // Only module1 has a quiz/practical page built right now. When a
      // quiz page is added for another module, add its number here -
      // deliberately NOT inferred from attempt history, so a student who
      // simply hasn't attempted the quiz yet still gets gated by it
      // rather than skipping the requirement entirely.
      const hasQuiz = num === 1;
      const quizPassed = hasQuiz ? !!quizByModule[moduleKey] : true;
      const complete = total > 0 && opened === total && quizPassed;

      const entry = {
        module: moduleKey,
        moduleNumber: num,
        totalClasses: total,
        openedClasses: opened,
        hasQuiz,
        quizPassed: hasQuiz ? quizPassed : null,
        complete,
        unlocked: previousComplete,
      };
      previousComplete = complete;
      return entry;
    });

    res.json({ modules });
  } catch (err) {
    console.error("module status error", err);
    res.status(500).json({ error: "Could not load module status." });
  }
});

// GET /api/content/school-logo/:schoolId
// PUBLIC — no login required. This needs to work for all FOUR places a
// school's logo is shown: the public home page's "Partner Schools"
// section (no one is logged in there at all), a student's own LMS
// portal (logged in as a STUDENT, not that school), that school's own
// School Portal, and the admin dashboard. A school's logo is just a
// branding image, not sensitive data - knowing a school's (unguessable,
// random UUID) id doesn't expose anything beyond the image itself.
// Returns 404 (silently) if the school has no logo set, so an <img> tag
// can just fall back to showing nothing / a placeholder.
router.get("/school-logo/:schoolId", async (req, res) => {
  const { schoolId } = req.params;
  if (!/^[\w-]+$/.test(schoolId)) {
    return res.status(400).json({ error: "Invalid school reference." });
  }

  try {
    const school = await School.findByPk(schoolId, { attributes: ["id", "logoFilename"] });
    if (!school || !school.logoFilename) {
      return res.status(404).json({ error: "No logo set for this school." });
    }

    const filePath = path.join(LOGO_ROOT, school.logoFilename);
    if (!filePath.startsWith(LOGO_ROOT + path.sep) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "No logo set for this school." });
    }

    // Logos rarely change - let browsers cache them for a day instead of
    // re-fetching on every page load.
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(filePath);
  } catch (err) {
    console.error("school logo serve error", err);
    res.status(500).json({ error: "Could not load logo." });
  }
});

module.exports = router;
