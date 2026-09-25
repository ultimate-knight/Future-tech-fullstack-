const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const RECEIPTS_DIR = path.join(__dirname, "..", "..", "receipts");

if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

/**
 * Builds a PDF receipt for a paid Payment record and saves it to disk.
 * Returns the absolute file path.
 *
 * @param {object} payment   - Payment model instance (already marked paid)
 * @param {object} admission - the linked IndividualAdmission or BulkAdmission
 * @param {"individual"|"bulk"} type
 */
function generateReceiptPdf(payment, admission, type) {
  const filePath = path.join(RECEIPTS_DIR, `${payment.receiptNumber}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ---- Header ----
  doc
    .fillColor("#06264d")
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("FUTURE TECH SCHOOL PROGRAM", { align: "left" });

  doc
    .fillColor("#555")
    .fontSize(10)
    .font("Helvetica")
    .text("3DWebSoft IT Solutions, Narsingi, Hyderabad, Telangana - 500075, India")
    .text("info@futuretech.org  |  +91 8562487139");

  doc.moveDown(1.2);
  doc
    .strokeColor("#0d6efd")
    .lineWidth(2)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke();
  doc.moveDown(1);

  // ---- Title ----
  doc
    .fillColor("#0d6efd")
    .fontSize(18)
    .font("Helvetica-Bold")
    .text("PAYMENT RECEIPT", { align: "center" });
  doc.moveDown(1.2);

  // ---- Receipt meta ----
  const metaTop = doc.y;
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#222");
  doc.text("Receipt No:", 50, metaTop);
  doc.text("Date:", 50, metaTop + 18);
  doc.text("Payment Ref:", 50, metaTop + 36);
  doc.text("Payment Mode:", 50, metaTop + 54);

  doc.font("Helvetica").fillColor("#444");
  doc.text(payment.receiptNumber, 160, metaTop);
  doc.text(new Date(payment.updatedAt).toLocaleString("en-IN"), 160, metaTop + 18);
  doc.text(payment.referenceId, 160, metaTop + 36);
  doc.text("UPI", 160, metaTop + 54);

  doc.moveDown(4.5);

  // ---- Payer / Admission details ----
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#06264d");
  doc.text(type === "individual" ? "Student & Payer Details" : "Organization & Payer Details");
  doc.moveDown(0.5);

  doc.fontSize(11).font("Helvetica").fillColor("#333");

  const rows = [];
  if (type === "individual") {
    rows.push(["Student Name", admission.studentName || "-"]);
    rows.push(["Grade / Class", admission.grade || "-"]);
    rows.push(["School Name", admission.schoolName || "-"]);
    rows.push(["Parent / Guardian", admission.parentName || "-"]);
    rows.push(["Program Level", (admission.programLevel || "-").toUpperCase()]);
  } else {
    rows.push(["Organization / School", admission.organizationName || "-"]);
    rows.push(["Coordinator", admission.coordinatorName || "-"]);
    rows.push(["Number of Students", String(admission.studentCount || 0)]);
  }
  rows.push(["Payer Name", payment.payerName || "-"]);
  rows.push(["Payer Email", payment.payerEmail || "-"]);
  rows.push(["Payer Phone", payment.payerPhone || "-"]);

  rows.forEach(([label, value]) => {
    doc.font("Helvetica-Bold").text(`${label}:`, 50, doc.y, { continued: true, width: 200 });
    doc.font("Helvetica").text(`  ${value}`);
  });

  doc.moveDown(1.5);

  // ---- Amount box ----
  const boxTop = doc.y;
  doc.rect(50, boxTop, 495, 60).fill("#f0f6ff");
  doc
    .fillColor("#06264d")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("Amount Paid", 65, boxTop + 12);
  doc
    .fillColor("#0d6efd")
    .fontSize(22)
    .font("Helvetica-Bold")
    .text(`Rs. ${payment.amount.toLocaleString("en-IN")}.00`, 65, boxTop + 30);
  doc
    .fillColor("#198754")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("PAID", 480, boxTop + 22);

  doc.moveDown(5);

  // ---- Footer ----
  doc
    .fontSize(9)
    .fillColor("#888")
    .font("Helvetica")
    .text(
      "This is a system-generated receipt and does not require a physical signature. " +
        "For any questions regarding this payment, please contact info@futuretech.org.",
      50,
      doc.y,
      { width: 495, align: "center" }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

module.exports = { generateReceiptPdf, RECEIPTS_DIR };
