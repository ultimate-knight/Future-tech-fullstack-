const express = require("express");
const fees = require("../config/fees");

const router = express.Router();

// GET /api/config
// Public, non-secret values the frontend needs: the current fee table, so
// the UI can show prices before payment. (Payment itself - the UPI VPA,
// payee name, and QR code - is handed back per-order by
// POST /api/payments/create-order, not exposed here.)
router.get("/", (req, res) => {
  res.json({
    fees: {
      level1: fees.individualLevelFees.level1,
      level2: fees.individualLevelFees.level2,
      level3: fees.individualLevelFees.level3,
      level4: fees.individualLevelFees.level4,
      // Individual fees: level1..4 above are the TOTAL for the full program
      // (monthly fee x programMonths); monthly is the per-month price.
      monthly: fees.monthlyFees,
      programMonths: fees.programMonths,
      bulkPerStudent: fees.bulkPerStudent,
      bulkMinimum: fees.bulkMinimum,
      currency: fees.currency,
    },
  });
});

module.exports = router;
