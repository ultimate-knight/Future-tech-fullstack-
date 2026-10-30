const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { ClassContent, LiveClass } = require("../models");
const { requireAdminAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAdminAuth);

const ALLOWED_LEVELS = ["level1", "level2", "level3", "level4"];

const PDF_ROOT = path.join(__dirname, "..", "..", "content", "pdfs");
const VIDEO_ROOT = path.join(__dirname, "..", "..", "content", "videos");

function validLevelModule(level, moduleParam) {
  return ALLOWED_LEVELS.includes(level) && /^module\d+$/.test(moduleParam || "");
}

// Wraps an async route handler so a thrown/rejected error becomes a
// clean 500 response instead of an unhandled rejection (Express 4
// doesn't catch these on its own).
function ah(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error("class-content admin route error", err);
      if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
    });
  };
}

function safeUnlink(filePath, root) {
  try {
    if (filePath.startsWith(root + path.sep) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("safeUnlink error (continuing)", err);
  }
}

// ---------------------------------------------------------------------
// Multer storage - PDFs and videos are written straight to disk (not
// buffered fully in memory first, unlike the small base64 school-logo
// uploads) since recorded class videos can be large.
// ---------------------------------------------------------------------
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_UPLOAD_MB || 500) * 1024 * 1024; // 500MB default

const pdfUpload = multer({
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === "application/pdf"),
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const { level, module: moduleParam } = req.params;
      const dir = path.join(PDF_ROOT, level, moduleParam);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${req.params.id}.pdf`),
  }),
});

const VIDEO_MIME_TO_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
};
const videoUpload = multer({
  limits: { fileSize: MAX_VIDEO_BYTES },
  fileFilter: (req, file, cb) => cb(null, !!VIDEO_MIME_TO_EXT[file.mimetype]),
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const { level, module: moduleParam } = req.params;
      const dir = path.join(VIDEO_ROOT, level, moduleParam);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${req.params.id}.${VIDEO_MIME_TO_EXT[file.mimetype]}`);
    },
  }),
});

function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File is too large." });
    }
    return res.status(400).json({ error: "Upload failed: " + err.message });
  }
  if (err) return res.status(400).json({ error: err.message || "Upload failed." });
  next();
}

// =======================================================================
// ClassContent - the per-class list (title, PDF, video) for a level/module
// =======================================================================

// GET /api/admin/class-content/:level/:module
router.get("/class-content/:level/:module", ah(async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!validLevelModule(level, moduleParam)) return res.status(400).json({ error: "Invalid level/module." });

  const rows = await ClassContent.findAll({
    where: { level, module: moduleParam },
    order: [["classNumber", "ASC"]],
  });
  res.json(rows);
}));

// POST /api/admin/class-content/:level/:module
// Body: { title, classNumber? } - classNumber defaults to "add at the end".
router.post("/class-content/:level/:module", ah(async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!validLevelModule(level, moduleParam)) return res.status(400).json({ error: "Invalid level/module." });

  const title = (req.body && req.body.title || "").trim();
  if (!title) return res.status(400).json({ error: "Title is required." });

  let classNumber = Number(req.body && req.body.classNumber);
  if (!classNumber || classNumber < 1) {
    const last = await ClassContent.findOne({
      where: { level, module: moduleParam },
      order: [["classNumber", "DESC"]],
    });
    classNumber = last ? last.classNumber + 1 : 1;
  }

  const row = await ClassContent.create({ level, module: moduleParam, classNumber, title });
  res.status(201).json(row);
}));

// PATCH /api/admin/class-content/:id
// Body: { title?, classNumber?, videoUrl? } - set videoUrl to "" to clear it.
router.patch("/class-content/:id", ah(async (req, res) => {
  const row = await ClassContent.findByPk(req.params.id);
  if (!row) return res.status(404).json({ error: "Class not found." });

  const { title, classNumber, videoUrl } = req.body || {};
  if (typeof title === "string" && title.trim()) row.title = title.trim();
  if (classNumber !== undefined && Number(classNumber) > 0) row.classNumber = Number(classNumber);
  if (typeof videoUrl === "string") {
    const trimmed = videoUrl.trim();
    // Setting a link clears any previously uploaded video file for this
    // class, since only one video source is shown at a time.
    if (trimmed && row.videoFilename) {
      safeUnlink(path.join(VIDEO_ROOT, row.level, row.module, row.videoFilename), VIDEO_ROOT);
      row.videoFilename = null;
    }
    row.videoUrl = trimmed || null;
  }
  await row.save();
  res.json(row);
}));

// DELETE /api/admin/class-content/:id - removes the row and its files.
router.delete("/class-content/:id", ah(async (req, res) => {
  const row = await ClassContent.findByPk(req.params.id);
  if (!row) return res.json({ ok: true });

  if (row.pdfFilename) safeUnlink(path.join(PDF_ROOT, row.level, row.module, row.pdfFilename), PDF_ROOT);
  if (row.videoFilename) safeUnlink(path.join(VIDEO_ROOT, row.level, row.module, row.videoFilename), VIDEO_ROOT);

  await row.destroy();
  res.json({ ok: true });
}));

// POST /api/admin/class-content/:id/pdf  (multipart/form-data, field "pdf")
router.post(
  "/class-content/:id/pdf",
  async (req, res, next) => {
    try {
      const row = await ClassContent.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: "Class not found." });
      req.params.level = row.level;
      req.params.module = row.module;
      req._classContentRow = row;
      next();
    } catch (err) {
      console.error("pdf upload lookup error", err);
      res.status(500).json({ error: "Could not look up this class." });
    }
  },
  (req, res, next) => pdfUpload.single("pdf")(req, res, (err) => multerErrorHandler(err, req, res, next)),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No PDF file uploaded, or it wasn't a PDF." });
    const row = req._classContentRow;
    // Old file had the same name (<id>.pdf) and has already been
    // overwritten on disk by multer, so nothing extra to clean up here.
    row.pdfFilename = `${row.id}.pdf`;
    await row.save();
    res.json(row);
  })
);

// POST /api/admin/class-content/:id/video  (multipart/form-data, field "video")
router.post(
  "/class-content/:id/video",
  async (req, res, next) => {
    try {
      const row = await ClassContent.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: "Class not found." });
      req.params.level = row.level;
      req.params.module = row.module;
      req._classContentRow = row;
      next();
    } catch (err) {
      console.error("video upload lookup error", err);
      res.status(500).json({ error: "Could not look up this class." });
    }
  },
  (req, res, next) => videoUpload.single("video")(req, res, (err) => multerErrorHandler(err, req, res, next)),
  ah(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No video file uploaded, or the format isn't supported (MP4, WEBM, OGG, MOV)." });
    const row = req._classContentRow;
    // If a different video extension was uploaded previously, remove that
    // old file (the new one may have a different filename/extension).
    if (row.videoFilename && row.videoFilename !== req.file.filename) {
      safeUnlink(path.join(VIDEO_ROOT, row.level, row.module, row.videoFilename), VIDEO_ROOT);
    }
    row.videoFilename = req.file.filename;
    row.videoUrl = null; // an uploaded file replaces any external link
    await row.save();
    res.json(row);
  })
);

// =======================================================================
// LiveClass - one meeting link per level/module
// =======================================================================

// GET /api/admin/live-class/:level/:module
router.get("/live-class/:level/:module", ah(async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!validLevelModule(level, moduleParam)) return res.status(400).json({ error: "Invalid level/module." });

  const row = await LiveClass.findOne({ where: { level, module: moduleParam } });
  res.json(row || { level, module: moduleParam, meetingUrl: null, note: null });
}));

// PUT /api/admin/live-class/:level/:module
// Body: { meetingUrl, note? } - meetingUrl: "" clears it.
router.put("/live-class/:level/:module", ah(async (req, res) => {
  const { level, module: moduleParam } = req.params;
  if (!validLevelModule(level, moduleParam)) return res.status(400).json({ error: "Invalid level/module." });

  const meetingUrl = (req.body && req.body.meetingUrl || "").trim();
  const note = (req.body && req.body.note || "").trim();

  const [row] = await LiveClass.findOrCreate({ where: { level, module: moduleParam } });
  row.meetingUrl = meetingUrl || null;
  row.note = note || null;
  await row.save();
  res.json(row);
}));

module.exports = router;
