const express = require("express");
const path = require("path");
const fs = require("fs");
const { Payment, IndividualAdmission, BulkAdmission, Student } = require("../models");
const { RECEIPTS_DIR, generateReceiptPdf } = require("../services/receiptService");
const { getAdmission, getSchoolLogoPath } = require("../services/paymentService");
const { verifyToken } = require("../utils/jwt");

const router = express.Router();

/**
 * Receipt links are shared right after a successful payment, before the
 * payer necessarily has any login session (an individual admission's payer
 * is often not the eventual student-LMS account holder, and a bulk
 * enquiry's payer may not be a registered school account at all) - so this
 * route is reachable with just the payment's own (cryptographically random,
 * unguessable) UUID, same as a Stripe-style hosted-invoice link.
 *
 * Defense in depth: if the request DOES carry a valid school/student/admin
 * session token, we go further and check that session actually owns this
 * payment, so a logged-in school (or student) can never use its own valid
 * token to pull up a receipt belonging to someone else by guessing/trying
 * other payment IDs.
 */
async function requesterOwnsPayment(req, payment) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return true; // no session - anonymous capability-URL access

  let decoded;
  try {
    decoded = verifyToken(header.slice(7));
  } catch (e) {
    return true; // expired/invalid token - treat like no session, don't block the plain link
  }

  if (decoded.role === "admin") return true;

  if (payment.type === "individual") {
    const admission = await IndividualAdmission.findByPk(payment.admissionId);
    if (!admission) return false;
    if (decoded.role === "school") return admission.schoolId === decoded.id;
    if (decoded.role === "student") {
      const student = await Student.findByPk(decoded.id);
      return !!student && student.admissionId === admission.id;
    }
  }

  if (payment.type === "bulk") {
    const admission = await BulkAdmission.findByPk(payment.admissionId);
    if (!admission) return false;
    if (decoded.role === "school") return admission.schoolId === decoded.id;
  }

  return true;
}

// GET /api/receipts/:paymentId/download
router.get("/:paymentId/download", async (req, res) => {
  try {
    const payment = await Payment.findByPk(req.params.paymentId);
    if (!payment || payment.status !== "paid" || !payment.receiptNumber) {
      return res.status(404).json({ error: "Receipt not found." });
    }

    if (!(await requesterOwnsPayment(req, payment))) {
      return res.status(403).json({ error: "You don't have access to this receipt." });
    }

    const filePath = path.join(RECEIPTS_DIR, `${payment.receiptNumber}.pdf`);
    if (!fs.existsSync(filePath)) {
      // Self-healing, same pattern as the School Settlement Invoice
      // download route: the payment record itself is already locked in
      // and safe (status, receiptNumber, amount, referenceId never
      // change once paid) - only the PDF rendering is missing, e.g. the
      // receipts/ folder was cleared, not carried over during a
      // redeploy, or this is a fresh environment pointed at an existing
      // database. Rebuild it from what's already stored rather than
      // telling the payer their receipt is gone.
      const admission = await getAdmission(payment.type, payment.admissionId);
      if (!admission) {
        return res.status(404).json({
          error: "Receipt file is missing and its admission record no longer exists, so it can't be rebuilt.",
        });
      }

      await generateReceiptPdf(payment, admission, payment.type, await getSchoolLogoPath(admission.schoolId));
      console.warn(`Rebuilt missing receipt PDF ${payment.receiptNumber}.pdf for payment ${payment.id}`);
    }

    res.download(filePath, `${payment.receiptNumber}.pdf`);
  } catch (err) {
    console.error("receipt download error", err);
    res.status(500).json({ error: "Could not fetch receipt." });
  }
});

module.exports = router;
