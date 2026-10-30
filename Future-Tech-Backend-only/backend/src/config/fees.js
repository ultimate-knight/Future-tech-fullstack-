/**
 * Central place for admission fee amounts (in INR, whole rupees).
 * Values come from .env so pricing can change without touching code.
 * All amounts here are treated as the SOURCE OF TRUTH - the frontend
 * only ever sends *what was selected* (e.g. a program level), never
 * an amount. The server always looks the price up itself so a client
 * can never manipulate how much they pay.
 *
 * INDIVIDUAL (parent) fees are MONTHLY, and the amount charged is always
 * derived: monthly fee x payment period (see calculateIndividualFee below).
 * The program runs for 5 months, and 5 months is the only payment period
 * currently accepted:
 *   Level 1: Rs 500/month  -> Rs 2,500        Level 3: Rs 1,000/month -> Rs 5,000
 *   Level 2: Rs 800/month  -> Rs 4,000        Level 4: Rs 1,200/month -> Rs 6,000
 *
 * The old FEE_LEVEL_1..4 variables (one lump-sum price per level) are NO
 * LONGER READ - they are replaced by FEE_MONTHLY_LEVEL_1..4. Leaving the old
 * ones in .env is harmless; config/validateEnv.js prints a warning.
 */
const PROGRAM_MONTHS = 5;

// Payment periods (in months) the backend will accept. Adding e.g. 1 or 3
// here is all that is needed to offer shorter periods later - the amount,
// validation and payment record already carry the period.
const ALLOWED_PAYMENT_MONTHS = [PROGRAM_MONTHS];

function monthlyFromEnv(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
}

const monthlyFees = {
  level1: monthlyFromEnv("FEE_MONTHLY_LEVEL_1", 500),
  level2: monthlyFromEnv("FEE_MONTHLY_LEVEL_2", 800),
  level3: monthlyFromEnv("FEE_MONTHLY_LEVEL_3", 1000),
  level4: monthlyFromEnv("FEE_MONTHLY_LEVEL_4", 1200),
};

/**
 * Works out what an individual admission must pay.
 *
 * @param {string} level   "level1".."level4"
 * @param {*} [months]     payment period in months; omitted/blank = the full 5-month program
 * @returns {{level, months, monthlyFee, total} | {error: string}}
 */
function calculateIndividualFee(level, months) {
  if (!Object.prototype.hasOwnProperty.call(monthlyFees, level)) {
    return { error: "Invalid program level." };
  }
  const period = months === undefined || months === null || months === "" ? PROGRAM_MONTHS : Number(months);
  if (!Number.isInteger(period) || !ALLOWED_PAYMENT_MONTHS.includes(period)) {
    return { error: `Invalid payment period. Allowed: ${ALLOWED_PAYMENT_MONTHS.join(", ")} month(s).` };
  }
  const monthlyFee = monthlyFees[level];
  if (!Number.isInteger(monthlyFee) || monthlyFee <= 0) {
    return { error: "Fee for this level is not configured correctly. Please contact support." };
  }
  return { level, months: period, monthlyFee, total: monthlyFee * period };
}

// Total for the full program per level - kept under the old name because
// GET /api/config exposes it as fees.level1..4 ("what a parent pays").
const individualLevelFees = {};
Object.keys(monthlyFees).forEach((level) => {
  individualLevelFees[level] = monthlyFees[level] * PROGRAM_MONTHS;
});

module.exports = {
  programMonths: PROGRAM_MONTHS,
  allowedPaymentMonths: ALLOWED_PAYMENT_MONTHS,
  monthlyFees,
  individualLevelFees,
  calculateIndividualFee,

  bulkPerStudent: Number(process.env.FEE_BULK_PER_STUDENT || 3999),
  bulkMinimum: Number(process.env.FEE_BULK_MINIMUM || 19999),
  currency: "INR",

  // Platform's cut (0-100) when a payment is split to a school's Razorpay
  // Route Linked Account. The remainder settles to the school. Only takes
  // effect for schools with razorpaySettlementStatus = "active" - see
  // RAZORPAY_ROUTE.md. A school-specific School.commissionPercentOverride
  // takes priority over this if set.
  platformCommissionPercent: Number(process.env.PLATFORM_COMMISSION_PERCENT || 0),
};
