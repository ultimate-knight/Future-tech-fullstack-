/**
 * Runs async functions one-at-a-time PER KEY (first come, first served);
 * different keys run in parallel. Used so two simultaneous requests for the
 * same admission (a double-clicked "Submit & Pay", two open tabs) can't both
 * "check, find nothing, create" and end up with two Payment rows.
 *
 * In-process only: it protects a single Node process (which is how this app
 * is deployed - see the comment in utils/receiptNumber.js). If the app is
 * ever run as several processes, add the optional database unique index
 * (npm run db:add-payment-unique-index) as the cross-process guard.
 */
const tails = new Map();

async function withLock(key, fn) {
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  tails.set(key, tail);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

module.exports = { withLock };
