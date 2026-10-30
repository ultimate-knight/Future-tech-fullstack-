const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const INVOICES_DIR = path.join(__dirname, "..", "..", "invoices");

if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

/**
 * Builds a School Settlement Invoice PDF and saves it to disk. This is
 * OUR invoice to the school for our platform commission on what their
 * students paid through us in the covered period — not a receipt to a
 * parent (see receiptService.js for that).
 *
 * IMPORTANT: this is a computed default, not tax advice. GST
 * applicability, rate, inclusive/exclusive treatment, and whether reverse
 * charge applies can depend on your specific registration and agreement
 * with each school — confirm the actual treatment with your CA/accountant
 * before this goes out as a real tax invoice. This tool only does the
 * arithmetic once you tell it the rate to use.
 *
 * @param {object} invoice - SchoolInvoice model instance (already saved)
 * @param {object} school  - School model instance
 * @param {object[]} lineItems - [{ date, receiptNumber, description, amount }]
 */
function generateSchoolInvoicePdf(invoice, school, lineItems) {
  const filePath = path.join(INVOICES_DIR, `${invoice.invoiceNumber}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ---- Header ----
  doc.fillColor("#06264d").fontSize(22).font("Helvetica-Bold").text("FUTURE TECH SCHOOL PROGRAM", { align: "left" });
  doc
    .fillColor("#555")
    .fontSize(10)
    .font("Helvetica")
    .text("3DWebSoft IT Solutions, Narsingi, Hyderabad, Telangana - 500075, India")
    .text("info@futuretech.org  |  +91 8562487139");

  doc.moveDown(1.2);
  doc.strokeColor("#0d6efd").lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  doc.fillColor("#0d6efd").fontSize(18).font("Helvetica-Bold").text("SCHOOL SETTLEMENT INVOICE", { align: "center" });
  doc.moveDown(1.2);

  // ---- Invoice meta ----
  const metaTop = doc.y;
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#222");
  doc.text("Invoice No:", 50, metaTop);
  doc.text("Date:", 50, metaTop + 18);
  doc.text("Billed To:", 50, metaTop + 36);
  doc.text("Period:", 50, metaTop + 54);

  const periodLabel =
    invoice.periodStart && invoice.periodEnd
      ? `${new Date(invoice.periodStart).toLocaleDateString("en-IN")} - ${new Date(invoice.periodEnd).toLocaleDateString("en-IN")}`
      : "All uninvoiced payments to date";

  doc.font("Helvetica").fillColor("#444");
  doc.text(invoice.invoiceNumber, 160, metaTop);
  doc.text(new Date(invoice.createdAt).toLocaleString("en-IN"), 160, metaTop + 18);
  doc.text(school.schoolName, 160, metaTop + 36);
  doc.text(periodLabel, 160, metaTop + 54);

  doc.moveDown(4);

  // ---- Line items table ----
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#06264d").text("Payments Covered by This Invoice");
  doc.moveDown(0.5);

  const tableTop = doc.y;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#fff");
  doc.rect(50, tableTop, 495, 20).fill("#06264d");
  doc.fillColor("#fff");
  doc.text("Date", 55, tableTop + 6, { width: 90 });
  doc.text("Receipt No.", 150, tableTop + 6, { width: 110 });
  doc.text("Student / Organization", 265, tableTop + 6, { width: 170 });
  doc.text("Amount", 445, tableTop + 6, { width: 90, align: "right" });

  let rowY = tableTop + 20;
  doc.font("Helvetica").fontSize(9);
  const maxRowsBeforeSummaryPage = 32; // keep it simple; a very long list wraps to further rows on the same running y, PDFKit auto-paginates
  lineItems.forEach((item, i) => {
    if (rowY > 760) {
      doc.addPage();
      rowY = 50;
    }
    if (i % 2 === 0) {
      doc.rect(50, rowY, 495, 18).fill("#f5f8fc");
    }
    doc.fillColor("#333");
    doc.text(new Date(item.date).toLocaleDateString("en-IN"), 55, rowY + 4, { width: 90 });
    doc.text(item.receiptNumber || "-", 150, rowY + 4, { width: 110 });
    doc.text(item.description || "-", 265, rowY + 4, { width: 170 });
    doc.text(`Rs. ${item.amount.toLocaleString("en-IN")}`, 445, rowY + 4, { width: 90, align: "right" });
    rowY += 18;
  });

  doc.y = rowY + 15;

  // ---- Settlement summary box ----
  if (doc.y > 620) {
    doc.addPage();
    doc.y = 50;
  }
  const boxTop = doc.y;
  const boxHeight = 150;
  doc.rect(50, boxTop, 495, boxHeight).fill("#f0f6ff");

  const line = (label, value, y, opts = {}) => {
    doc.fontSize(11).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fillColor(opts.color || "#222");
    doc.text(label, 65, y, { width: 300 });
    doc.text(value, 65, y, { width: 460, align: "right" });
  };

  line("Total collected from students", `Rs. ${invoice.totalCollected.toLocaleString("en-IN")}`, boxTop + 14, { bold: true });
  line(
    `Platform commission (${invoice.commissionPercent}%)`,
    `- Rs. ${invoice.commissionAmount.toLocaleString("en-IN")}`,
    boxTop + 38
  );
  line(`GST on commission (${invoice.gstPercent}%)`, `- Rs. ${invoice.gstAmount.toLocaleString("en-IN")}`, boxTop + 58);

  doc.strokeColor("#0d6efd").lineWidth(1).moveTo(65, boxTop + 82).lineTo(530, boxTop + 82).stroke();

  doc.fontSize(13).font("Helvetica-Bold").fillColor("#06264d");
  doc.text("Net Payable to School", 65, boxTop + 96, { width: 300 });
  doc.fontSize(16).fillColor("#198754");
  doc.text(`Rs. ${invoice.netPayableToSchool.toLocaleString("en-IN")}`, 65, boxTop + 94, { width: 460, align: "right" });

  doc.fontSize(9).font("Helvetica").fillColor("#666");
  doc.text(`${invoice.paymentCount} payment(s) covered by this invoice`, 65, boxTop + 124);

  doc.y = boxTop + boxHeight + 20;

  // ---- Footer / disclaimer ----
  doc
    .fontSize(8)
    .fillColor("#888")
    .font("Helvetica")
    .text(
      "This is a system-generated settlement statement. GST treatment shown here uses the rate configured " +
        "at generation time and has not been independently verified for tax compliance - please have your " +
        "accountant confirm GST applicability, rate, and invoice format requirements before relying on this " +
        "for filing. For any questions regarding this invoice, please contact info@futuretech.org.",
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

/**
 * Builds a plain Payment Statement PDF - every payment for a school in a
 * period, no commission/GST math, nothing locked or recorded. Unlike
 * generateSchoolInvoicePdf(), this can be regenerated identically as many
 * times as you like; it's a report, not a financial document that fixes
 * numbers in time.
 *
 * @param {object} school - School model instance
 * @param {object[]} lineItems - [{ date, receiptNumber, description, amount, status }]
 * @param {string} periodLabel - human-readable period, e.g. "All time" or a date range
 * @param {string} filePath - where to write the PDF
 */
function generateSchoolStatementPdf(school, lineItems, periodLabel, filePath) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fillColor("#06264d").fontSize(22).font("Helvetica-Bold").text("FUTURE TECH SCHOOL PROGRAM", { align: "left" });
  doc
    .fillColor("#555")
    .fontSize(10)
    .font("Helvetica")
    .text("3DWebSoft IT Solutions, Narsingi, Hyderabad, Telangana - 500089, India")
    .text("info@futuretech.org | contact@3dwebsoftitsolutions.com  |  +91 9108534041");

  doc.moveDown(1.2);
  doc.strokeColor("#0d6efd").lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  doc.fillColor("#0d6efd").fontSize(18).font("Helvetica-Bold").text("PAYMENT STATEMENT", { align: "center" });
  doc.moveDown(0.3);
  doc.fillColor("#666").fontSize(11).font("Helvetica").text(school.schoolName, { align: "center" });
  doc.fillColor("#888").fontSize(9).text(periodLabel, { align: "center" });
  doc.moveDown(1.2);

  const tableTop = doc.y;
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#fff");
  doc.rect(50, tableTop, 495, 20).fill("#06264d");
  doc.fillColor("#fff");
  doc.text("Date", 55, tableTop + 6, { width: 80 });
  doc.text("Receipt No.", 140, tableTop + 6, { width: 100 });
  doc.text("Student / Organization", 245, tableTop + 6, { width: 150 });
  doc.text("Status", 400, tableTop + 6, { width: 60 });
  doc.text("Amount", 460, tableTop + 6, { width: 75, align: "right" });

  let rowY = tableTop + 20;
  doc.font("Helvetica").fontSize(9);
  let total = 0;
  lineItems.forEach((item, i) => {
    if (rowY > 760) {
      doc.addPage();
      rowY = 50;
    }
    if (i % 2 === 0) {
      doc.rect(50, rowY, 495, 18).fill("#f5f8fc");
    }
    doc.fillColor("#333");
    doc.text(new Date(item.date).toLocaleDateString("en-IN"), 55, rowY + 4, { width: 80 });
    doc.text(item.receiptNumber || "-", 140, rowY + 4, { width: 100 });
    doc.text(item.description || "-", 245, rowY + 4, { width: 150 });
    doc.fillColor(item.status === "paid" ? "#198754" : "#dc3545");
    doc.text((item.status || "-").toUpperCase(), 400, rowY + 4, { width: 60 });
    doc.fillColor("#333");
    doc.text(`Rs. ${item.amount.toLocaleString("en-IN")}`, 460, rowY + 4, { width: 75, align: "right" });
    if (item.status === "paid") total += item.amount;
    rowY += 18;
  });

  doc.y = rowY + 15;
  doc.strokeColor("#0d6efd").lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#06264d");
  doc.text(`Total Paid: Rs. ${total.toLocaleString("en-IN")}`, 50, doc.y, { width: 495, align: "right" });
  doc.fontSize(9).font("Helvetica").fillColor("#888");
  doc.text(`${lineItems.length} payment(s) shown, ${lineItems.filter((i) => i.status === "paid").length} paid`, 50, doc.y + 18, {
    width: 495,
    align: "right",
  });

  doc
    .fontSize(8)
    .fillColor("#888")
    .font("Helvetica")
    .text(
      "This is a plain payment history report and is not a settlement invoice - it includes every payment in the " +
        "period regardless of whether it has already been settled. For the commission/GST settlement breakdown, use " +
        "the Generate Settlement Invoice option instead.",
      50,
      doc.y + 30,
      { width: 495, align: "center" }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

module.exports = { generateSchoolInvoicePdf, generateSchoolStatementPdf, INVOICES_DIR };
