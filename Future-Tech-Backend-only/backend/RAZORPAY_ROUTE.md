# Multi-school settlement with Razorpay Route

By default, every school's payments settle into **one** Razorpay account —
3D WebSoft's. This document walks through turning on automatic, per-school
settlement using Razorpay's **Route** product, so School A's payments settle
to School A's own bank account, School B's to School B's, and so on.

The data model and code for this are already built (see "What's already
built" below). What's *not* done for you, because it isn't something code
can do, is the business/compliance side: getting Route approved, and each
school completing its own KYC. That has to happen per school, in order,
before you flip the switch for that school.

## Step 1 — Get Route enabled on 3D WebSoft's Razorpay account

1. Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Go to **Route** under **Payment Products** (or **Account & Settings ->
   Product Configuration**).
3. If it's not already active, request activation. This may require a short
   review by Razorpay depending on your account's KYC status — it isn't
   instant for every account.

You only do this once for the whole platform.

## Step 2 — Create a Linked Account for a school

Each school is a separate **Linked Account** in Razorpay, with its own KYC
(PAN, business type, bank account). Two ways to create one:

**A. From the Razorpay Dashboard** (simplest, no code):
Route -> Linked Accounts -> Add Linked Account. Fill in the school's legal
name, PAN, and bank account/IFSC. Razorpay will verify these before the
account is usable.

**B. Via the API** (if you want to build a self-serve onboarding form later):

```bash
curl -X POST https://api.razorpay.com/v2/accounts \
  -u RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET \
  -H "Content-type: application/json" \
  -d '{
    "email": "coordinator@schoolA.example.com",
    "phone": "9000090000",
    "type": "route",
    "reference_id": "<this school'"'"'s id in our DB, optional but useful>",
    "legal_business_name": "School A Educational Trust",
    "business_type": "trust",
    "contact_name": "School A Coordinator",
    "profile": {
      "category": "education",
      "subcategory": "school",
      "addresses": { "registered": { "street1": "...", "city": "...", "state": "...", "postal_code": "...", "country": "IN" } }
    },
    "legal_info": { "pan": "SCHOOLPANXX" }
  }'
```

Razorpay returns an `id` like `acc_XXXXXXXXXXXX` — this is the school's
**Linked Account id**. You'll also need to add the school's **bank account**
as a Stakeholder on this Linked Account (Dashboard, or the Stakeholder API)
before it can actually receive settlements.

Either way, this account starts in a **not-yet-verified** state. Razorpay
reviews the KYC — this can take a few business days, same as their normal
merchant onboarding. Do not proceed to Step 4 until the Dashboard shows this
Linked Account as **activated/verified**.

## Step 3 — Decide the platform's commission (optional)

If 3D WebSoft keeps a percentage of each payment (rather than passing 100%
to the school), set it either:
- **Platform-wide default**: `PLATFORM_COMMISSION_PERCENT` in `.env` (e.g.
  `10` for 10%).
- **Per-school override**: pass `commissionPercentOverride` via
  `POST /api/admin/schools/:id/razorpay-account` (see Step 4) — useful if
  different schools negotiated different splits.

Leave at `0` to pass through the full amount to the school.

## Step 4 — Link the school in this platform

Once (and only once) the Linked Account shows as verified in the Razorpay
Dashboard:

1. Log in to the admin panel (`site/admin.html`) -> **School Accounts** tab.
2. Click the bank icon next to the school -> paste in the Linked Account id
   (`acc_...`) -> confirm.

This calls `POST /api/admin/schools/:id/razorpay-account`, which sets:
- `razorpayAccountId` — the `acc_...` id
- `razorpaySettlementStatus` — `"active"`

From that school's **next** payment onward, `POST /api/payments/create-order`
automatically includes a Razorpay Route `transfers` entry splitting the
settlement to the school's account (see `buildSchoolTransfer()` in
`src/services/razorpayService.js`).

## What's already built

- `School.razorpayAccountId` / `razorpaySettlementStatus` /
  `commissionPercentOverride` — per-school settlement config.
- `razorpayService.buildSchoolTransfer()` — computes the transfer split.
- `payments.js` create-order — passes `transfers` automatically for any
  school with `razorpaySettlementStatus: "active"`. Schools without a
  Linked Account are unaffected — their payments settle to the platform
  account exactly as before.
- **Safe fallback**: if Razorpay rejects the order because Route isn't
  actually enabled yet, or a Linked Account got suspended after being
  marked active here, the payment is automatically retried *without* the
  transfer rather than failing the parent's payment. This is logged
  server-side (`console.error`) for you to follow up on — check your logs
  after Step 4 for any school to confirm the split is actually working,
  don't just assume it from silence.
- `Payment.settledToSchool` — records whether a given payment's order was
  created with a transfer, for reconciliation.
- Admin UI: **School Accounts** tab shows each school's settlement status
  (Not set up / Pending KYC / Route active) and a button to link/update
  their account id.

## What is NOT built (and why)

- **Automatic Linked Account creation from this app.** Creating a Linked
  Account via API still requires submitting real KYC documents and a real
  bank account, and Razorpay's review is not instant — there's no safe way
  to make this a single button-click for a school to self-serve without a
  proper onboarding flow (document upload, status polling, error handling
  for rejected KYC, etc.), which is real additional scope. For now, adding
  a school to Route is an admin/staff action (Step 2 + Step 4), not
  something a school does themselves.
- **Refunds and reversals through Route.** If you ever refund a payment
  that was split via `transfers`, Razorpay's reversal behavior for Route
  needs its own handling (whose share the refund comes out of). Not
  implemented — flag any refund on a `settledToSchool: true` payment for
  manual review until this is built.

## Verifying it actually worked

After linking a school (Step 4), have someone make a small **test-mode**
payment for that school and check:
1. The Razorpay Dashboard -> Route -> Transfers shows a transfer to that
   school's Linked Account for that payment.
2. `Payment.settledToSchool` is `true` for that payment in your database.
3. Your server logs show no `"Route transfer failed for school ..."`
   warning for that payment.

Don't mark a school "active" and assume it's working — confirm with a real
test payment first, same as you would with the main Razorpay test-mode
checkout flow.
