const { verifyToken } = require("../utils/jwt");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * Requires a valid school-account JWT AND that the account is still
 * active — re-checked on every request (not just at login) so a
 * mid-session suspension by the Super Admin takes effect immediately.
 * Attaches req.school = { id, email }.
 */
async function requireSchoolAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Login required." });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== "school") throw new Error("wrong role");

    // Lazy require to avoid a require-cycle between middleware and models
    const { School } = require("../models");
    const school = await School.findByPk(decoded.id);
    if (!school || !school.isActive) {
      return res.status(403).json({ error: "This account has been suspended. Please contact support." });
    }

    req.school = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
  }
}

/** Requires a valid admin JWT. Attaches req.admin = { id, email }. */
function requireAdminAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Admin login required." });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== "admin") throw new Error("wrong role");
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Admin session expired or invalid. Please log in again." });
  }
}

/** Requires a valid student-account JWT. Attaches req.student = { id, email }. */
function requireStudentAuth(req, res, next) {
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

module.exports = { requireSchoolAuth, requireAdminAuth, requireStudentAuth };
