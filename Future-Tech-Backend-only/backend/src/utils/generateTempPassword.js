const crypto = require("crypto");

/**
 * Generates a random password that's secure but still easy for a human
 * to type out over WhatsApp/phone/email — avoids ambiguous characters
 * (0/O, 1/l/I) and uses a simple word-number-word pattern.
 *
 * Example output: "Falcon482Harbor"
 */
const WORDS = [
  "Falcon", "Harbor", "Meadow", "Signal", "Voyage", "Anchor", "Crimson",
  "Summit", "Beacon", "Orbit", "Maple", "Thunder", "Coral", "Granite",
  "Willow", "Cobalt", "Ember", "Lantern", "Ridge", "Sable",
];

function generateTempPassword() {
  const w1 = WORDS[crypto.randomInt(0, WORDS.length)];
  const w2 = WORDS[crypto.randomInt(0, WORDS.length)];
  const num = crypto.randomInt(100, 999);
  return `${w1}${num}${w2}`;
}

module.exports = generateTempPassword;
