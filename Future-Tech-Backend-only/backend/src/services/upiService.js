const QRCode = require("qrcode");

/**
 * Reads the platform's UPI receiving details from .env. Thrown lazily (on
 * first actual use, not at module load) so the server can still start up
 * before these are filled in — same pattern as the old razorpayService's
 * getRazorpayClient().
 */
function getUpiConfig() {
  const vpa = process.env.UPI_VPA;
  const payeeName = process.env.UPI_PAYEE_NAME;
  if (!vpa || !payeeName) {
    throw new Error(
      "UPI payments are not configured yet. Set UPI_VPA and UPI_PAYEE_NAME in .env."
    );
  }
  return { vpa, payeeName };
}

/**
 * Builds a standard UPI deep link ("intent") URI. Any UPI app (Google Pay,
 * PhonePe, Paytm, BHIM, a bank's own app...) understands this same format,
 * whether it's opened directly on a phone or scanned as a QR code.
 *
 * - pa/pn: which account the money goes to. Defaults to the platform's
 *   own UPI_VPA/UPI_PAYEE_NAME, but a school with its own upiVpa set
 *   (School.upiVpa/upiPayeeName) is passed in explicitly instead, so that
 *   school's payments go straight into their own bank account rather
 *   than the platform's — see routes/payments.js.
 * - am/cu: exact amount + currency, so the payer's app pre-fills the right
 *   amount and can't be short-paid by mistake.
 * - tr:    our own reference id (see utils/paymentReference.js), baked
 *   into the payment itself so it's traceable start to finish.
 * - tn:    a short human-readable note, shown in the payer's UPI app and
 *   (usually) in the resulting bank statement line — this is what makes
 *   manual reconciliation against the bank statement fast: whoever's
 *   checking (platform admin, or the school itself) can search the
 *   statement for the reference id instead of matching by amount + rough
 *   timestamp.
 *
 * @param {Object} opts
 * @param {number} opts.amount  - rupees, whole number
 * @param {string} opts.refId   - our Payment.referenceId
 * @param {string} opts.note    - short transaction note (kept short — many
 *   UPI apps truncate this)
 * @param {string} [opts.vpa]        - override; defaults to platform UPI_VPA
 * @param {string} [opts.payeeName]  - override; defaults to platform UPI_PAYEE_NAME
 */
function buildUpiUri({ amount, refId, note, vpa, payeeName }) {
  // Only fall back to (and therefore only require) the platform-wide
  // config when the caller didn't already supply a school's own VPA —
  // this way a deployment that always routes through school accounts
  // never needs UPI_VPA/UPI_PAYEE_NAME set in .env at all.
  const resolvedVpa = vpa || getUpiConfig().vpa;
  const resolvedPayeeName = payeeName || getUpiConfig().payeeName;
  const params = new URLSearchParams({
    pa: resolvedVpa,
    pn: resolvedPayeeName,
    am: String(amount),
    cu: "INR",
    tr: refId,
    tn: (note || refId).slice(0, 50),
  });
  return `upi://pay?${params.toString()}`;
}

/**
 * Renders a UPI URI as a scannable QR code, returned as a base64 PNG data
 * URL (ready to drop straight into an <img src="...">).
 */
async function generateUpiQrDataUrl(upiUri) {
  return QRCode.toDataURL(upiUri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
  });
}

module.exports = { getUpiConfig, buildUpiUri, generateUpiQrDataUrl };
