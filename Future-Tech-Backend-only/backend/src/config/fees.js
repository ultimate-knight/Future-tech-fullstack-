/**
 * Central place for admission fee amounts (in INR, whole rupees).
 * Values come from .env so pricing can change without touching code.
 * All amounts here are treated as the SOURCE OF TRUTH — the frontend
 * only ever sends *what was selected* (e.g. a program level), never
 * an amount. The server always looks the price up itself so a client
 * can never manipulate how much they pay.
 */
module.exports = {
  individualLevelFees: {
    level1: Number(process.env.FEE_LEVEL_1 || 4999),
    level2: Number(process.env.FEE_LEVEL_2 || 5999),
    level3: Number(process.env.FEE_LEVEL_3 || 6999),
    level4: Number(process.env.FEE_LEVEL_4 || 7999),
  },
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
