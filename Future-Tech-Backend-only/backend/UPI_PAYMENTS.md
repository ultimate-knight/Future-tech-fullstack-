# UPI QR Payments

How payments work now that Razorpay checkout has been removed: the payer
scans a UPI QR code and pays directly into your bank account, and an
admin manually confirms each payment from the dashboard.

## Why this instead of a payment gateway

No gateway account, KYC, or per-transaction fee — payments go straight
from the payer's bank to yours over UPI, which is free and instant in
India. The tradeoff is that there's no automated proof-of-payment step;
see "The tradeoff: no automatic fraud protection" below.

## Setup

Two levels of UPI ID, in priority order:

1. **Per-school (preferred for schools with their own account).** Set from
   the admin dashboard: **School Accounts** tab -> QR-code icon on a
   school -> enter their UPI ID (and, optionally, the payee name to show
   in the payer's UPI app — defaults to the school's name). From that
   point on, every payment for a student/enrollment tied to that school
   pays directly into the school's own account. This is exactly how a
   school like "Chaitanya School" gets onboarded: create their School
   Account, hand them the login, set their UPI ID once, and every
   student who registers under them from then on pays them directly.
2. **Platform-wide fallback**, in `.env`:

   ```bash
   UPI_VPA=yourschool@okhdfcbank   # your platform's own UPI ID
   UPI_PAYEE_NAME=Future Tech School Program   # shown in the payer's UPI app
   ```

   Used for any admission not tied to a school with its own UPI ID set
   (a bulk/organization enquiry submitted without a logged-in school
   account, or a school that hasn't been set up yet). If you expect
   every payment to always go through a school's own account, these can
   be left unset — but then make sure every school actually has its own
   UPI ID configured, since a payment for one that doesn't will fail to
   generate a QR code at all (a clear error is shown either way, so
   nothing silently goes to the wrong place).

`POST /api/payments/create-order` fails with a clear error if neither is
available for a given payment, and the server refuses to start in
production (`NODE_ENV=production`) without the platform-wide fallback set
(see `src/config/validateEnv.js`) — since it's the one that has to work
for *any* admission, even one with no school attached.

**If this is an existing deployment with payment rows already in the
database** (i.e. not a brand new empty database), run this once before
`npm run db:init`:

```bash
npm run migrate:upi-payments
```

Without it, `db:init` fails with a MySQL/Postgres error trying to add
the new `payments.status` enum value over old `'created'` rows (a
`NOT NULL UNIQUE` add hitting the same wall is why `referenceId` is
nullable at the schema level instead — see the comment on that field in
`src/models/Payment.js`). The migration script widens the enum, moves
old `'created'` rows to `'pending'`, then narrows it back down. It's
safe to run against a brand-new empty database too — it just won't find
anything to do.

Optionally, afterwards:

```bash
npm run backfill:payment-refs
```

gives old payment rows a placeholder reference (`FTPAY-2026-LEGACY-000004`)
instead of a blank one in the admin Payments tab. Purely cosmetic — skip
it if you don't care about old rows having a reference.

That's the entire setup otherwise. No dashboard signup, no webhook, no
API keys.

## How it works end to end

1. **Order creation** — `POST /api/payments/create-order` computes the
   fee server-side (never trusted from the browser), creates a `pending`
   `Payment` row with a generated reference like `FTPAY-2026-000123`
   (`src/utils/paymentReference.js`), and builds a UPI deep link for that
   exact amount (`src/services/upiService.js`) — paid to the admission's
   **school's own UPI ID** if one is set (`School.upiVpa`), otherwise the
   platform-wide fallback.

   ```
   upi://pay?pa=chaitanyaschool@okhdfcbank&pn=Chaitanya+School&am=4999&cu=INR&tr=FTPAY-2026-000123&tn=FTPAY-2026-000123+Jane+Doe
   ```

   That URI is rendered as a QR code (`qrcode` npm package) and returned
   as a base64 PNG, along with which account it's paying into (`vpa`/
   `payeeName` in the response) — shown to the payer under the QR.

2. **Payer scans & pays** — `assets/js/payment-flow.js` shows the QR in
   a modal. Any UPI app (Google Pay, PhonePe, Paytm, BHIM, a bank's own
   app) can scan it; the amount and a reference note are pre-filled, so
   the payer can't accidentally pay the wrong amount, and the reference
   travels with the transaction into their own UPI app's history too.

3. **Confirmation — by whoever actually receives the money.** While the
   modal is open, the browser polls `GET /api/payments/:id/status`.
   Separately:
   - For a payment that went to a **school's own UPI account**, that
     **school** confirms it themselves, from their own portal
     (School Portal -> Mark as Paid next to the pending payment) —
     `POST /api/schools/me/payments/:id/mark-paid`. They're the ones who
     can actually see the money land, so they're the ones who confirm
     it; a school can only ever confirm its own payments (enforced
     server-side).
   - For a payment that fell back to the **platform's own account**
     (no school attached, or a school with no UPI ID configured yet),
     the **platform admin** confirms it from the central Payments tab —
     `POST /api/admin/payments/:id/mark-paid`.

   Either way, confirming flips the payment + admission to paid,
   generates the PDF receipt, and is what the next status poll picks up
   — the payer's browser then shows the receipt download link
   automatically, with no other action needed on their end. The admin's
   Payments tab still lists every payment platform-wide regardless of
   who's meant to confirm it, for oversight — an admin can always step
   in and confirm/reject on a school's behalf too.

4. If a claimed payment never actually shows up after a reasonable wait,
   whoever would have confirmed it (the school, or the admin) can click
   **Mark as Failed** instead
   (`POST /api/schools/me/payments/:id/mark-failed` or
   `POST /api/admin/payments/:id/mark-failed`) to close it out.

## Reconciling against your bank statement

Every payment's reference id (`FTPAY-2026-000123`-style) is:

- shown to the payer in the QR modal,
- baked into the UPI transaction note (`tn=`) so it's usually visible in
  the payer's own UPI app history, and
- often (not guaranteed — depends on the payer's bank/app) preserved in
  *your* bank statement's transaction remarks too.

Search your statement for the reference or the amount + rough time to
match it to the pending payment in the admin dashboard.

## The tradeoff: no automatic fraud protection — and now, self-reported for school payments

Razorpay's checkout cryptographically verified that a payment actually
happened before marking anything paid. There is no equivalent here — a
payer could, in principle, open the QR modal and claim they paid without
actually doing so, and the only thing standing between that and a free
admission is whoever's confirming it actually checking the account first.

For a school-routed payment specifically, this means **the school is
confirming its own money arrived** — they have every incentive to check
carefully (it's their revenue), but they're also the one party with a
motive to skip the check and mark a struggling family's payment "paid"
anyway, or make a mistake under time pressure. This was a deliberate
choice, not an oversight: the platform is selling this application to
schools, and it's the school's own decision who they extend that trust
to — a school choosing to wave through a payment (accidentally or not)
is now their call to make on their own account, the same way it would be
if they were collecting cash at their front desk.

Mitigations built in:

- The QR modal doesn't unlock anything by itself — `paymentStatus` only
  flips once a human explicitly confirms it, never automatically.
- The reference id makes checking fast (search-and-match, not
  eyeballing amounts and timestamps).
- **Mark as Failed** exists specifically so a false claim can be closed
  out cleanly instead of sitting as "pending" forever.
- Every confirmation records *who* did it — `Payment.markedPaidByAdminId`
  or `Payment.markedPaidBySchoolId` (never both) — so a school's
  confirmation history is fully auditable from the admin Payments tab if
  a dispute ever comes up.
- The platform admin can still see and confirm/reject **every** payment
  platform-wide, school-routed or not — a school's ability to confirm
  its own payments doesn't take that oversight away.

What's not built in, and worth deciding on your end: whether to
periodically spot-check a sample of school-confirmed payments, and what
happens if a school is found to be confirming payments that didn't
happen (this is a policy/contract question, not a code one).

## What still works exactly as before

Everything downstream of `Payment.status === "paid"` is untouched —
receipt generation, LMS access unlocking, School Settlement Invoices,
and Payment Statements all key off that same field and don't know or
care whether it was set by a gateway webhook or an admin clicking a
button.
