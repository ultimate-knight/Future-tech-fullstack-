# Future Tech School Program — Backend

A proper Node.js/Express backend for the website: admissions (individual &
bulk/school), a contact form, school accounts, an admin dashboard, and UPI
QR-code payments (manually confirmed by an admin) with automatic PDF
receipt generation.

```
backend/
  src/
    config/      Database connection (switchable) + fee table
    models/      Sequelize models (School, Admin, ContactMessage,
                  IndividualAdmission, BulkAdmission, Payment, Student,
                  QuizResult)
    routes/      Express routes, one file per resource
    middleware/  JWT auth guards (school + admin + student)
    services/    UPI QR generator, PDF receipt generator
    scripts/     One-off scripts (init DB, seed admin)
    app.js       Express app wiring
    server.js    Entry point
  data/          SQLite file lives here if you use DB_DIALECT=sqlite
  receipts/      Generated PDF receipts are saved here
  .env.example   Copy to .env and fill in real values
```

## 1. Install dependencies

```bash
cd backend
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

- **Database** — `DB_DIALECT` can be `sqlite` (zero setup, good for local
  dev/testing), `postgres`, or `mysql` (recommended for production —
  fill in `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`).
- **JWT_SECRET** — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- **ADMIN_EMAIL / ADMIN_PASSWORD** — the first admin account is created
  automatically from these the first time the server starts. Log in and
  use the "Change Password" option on the admin dashboard
  (`POST /api/admin/me/change-password`) to set your own password right
  away — `db:reset-admin` (below) is also available as a break-glass
  option if you ever get locked out.
- **UPI_VPA / UPI_PAYEE_NAME** — the UPI ID (VPA) that should receive
  payments (e.g. `yourschool@okhdfcbank`) and the name shown in the
  payer's UPI app when they scan the code. See [`UPI_PAYMENTS.md`](./UPI_PAYMENTS.md)
  for how the whole flow works end to end.
- **FEE_* values** — your real pricing, in whole rupees.
- **CORS_ORIGIN** — the URL(s) your frontend is served from, comma
  separated (e.g. `http://localhost:8080` while testing locally, your
  real domain in production).

## 3. Start the server

```bash
npm start          # production-style start
npm run dev         # auto-restarts on file changes (Node 18+)
```

On first run you'll see:

```
Database connected (sqlite).
Database synced.
----------------------------------------------------------
No admin account found — created one from .env:
  Email:    admin@futuretech.org
  ...
Future Tech backend listening on http://localhost:5000
```

Verify it's alive:

```bash
curl http://localhost:5000/api/health
```

## 4. Point the frontend at the backend

Edit `site/assets/js/config.js`:

```js
window.FT_CONFIG = {
  API_BASE_URL: "http://localhost:5000/api", // change to your deployed URL
};
```

Serve the `site/` folder with any static file server (or your existing
hosting) — it's still a plain static frontend, it just now talks to this
API instead of the browser's local storage.

## Switching database engines

This project uses [Sequelize](https://sequelize.org), so moving from
SQLite to PostgreSQL or MySQL for production is just a `.env` change —
no code changes needed:

```bash
DB_DIALECT=postgres
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=future_tech
DB_USER=your_user
DB_PASSWORD=your_password
```

(`DB_DIALECT=mysql` works the same way, on the default MySQL port 3306.)

Run `npm run db:init` any time to (re)create/update tables for whichever
database is currently configured.

## How the payment + receipt flow works

Payments are collected via **UPI QR code, confirmed manually by an
admin** — there is no payment gateway in the loop. Full details and the
tradeoffs of this approach are in [`UPI_PAYMENTS.md`](./UPI_PAYMENTS.md);
short version:

1. Frontend calls `POST /api/admissions/individual` (or `/bulk`) —
   this saves the admission and returns the **server-computed** fee.
   The amount is never trusted from the browser.
2. Frontend calls `POST /api/payments/create-order` — the backend
   creates a `pending` `Payment` row with its own reference id
   (`FTPAY-2026-000123`-style) and returns a UPI deep link + QR code
   for that exact amount, built from `UPI_VPA`/`UPI_PAYEE_NAME`.
3. Frontend shows the QR in a modal (`assets/js/payment-flow.js`) and
   polls `GET /api/payments/:id/status` every few seconds. The payer
   scans it with any UPI app and pays directly into the bank account —
   the money never passes through this server or a gateway.
4. **An admin manually checks the bank account/UPI app**, matches the
   transaction by amount + the reference id (also shown as the UPI
   transaction note, for exactly this purpose), and clicks **Mark as
   Paid** on the Payments tab (`POST /api/admin/payments/:id/mark-paid`).
5. That marks the payment + admission paid, generates a PDF receipt
   with [pdfkit], and the next status poll from the still-open browser
   tab picks it up and shows the receipt download link automatically.
   The admin can instead click **Mark as Failed** to reject a claimed
   payment that never actually shows up.

There is intentionally no automatic verification step — see the
"fraud protection tradeoff" note in `UPI_PAYMENTS.md` for what that
means in practice and how to mitigate it.

## Admin dashboard

Log in at `site/admin.html` with the admin email/password from your
`.env`. From there you can see contact messages, individual admissions,
bulk/school enquiries, all payments, and registered school accounts,
with search, CSV export, and delete.

## School accounts

Schools can register/log in at `site/school-login.html` and see their
own bulk admission enquiries + payment/receipt status at
`site/school-portal.html`. If a school is logged in when they submit the
bulk admission form, their enquiry is automatically linked to their
account.

## Student LMS accounts

`site/student-login.html` and `site/student-registration-form.html` use a
real `Student` model and dedicated endpoints
(`POST /api/auth/student/register`, `POST /api/auth/student/login`,
`GET /api/students/me`) — this is separate from the `School` account
system. Registration is gated server-side on a **paid** `IndividualAdmission`
(you cannot create a student account for an admission that hasn't been
paid for, and only one student account can ever be created per paid
admission). Level-gated content (`GET /api/content/pdf/...`) and quiz
results (`/api/quiz-results`) both re-check the logged-in student's
`programLevel` against the requested level server-side on every request —
the client-side gate in `level-guard.js` is a UX convenience only, not the
real access control.

## School Settlement Invoices (GST)

The admin panel can generate a **School Settlement Invoice** PDF for any
school: Schools tab -> receipt icon on a school -> optionally set a date
range -> set the platform commission % and GST % -> Generate.

This computes: `Total Collected − Platform Commission − GST on Commission
= Net Payable to School`, lists every payment it covers, and saves the
PDF under `backend/invoices/`. Each payment is locked to the invoice it
was billed on (`Payment.schoolInvoiceId`) so re-running this later never
double-counts the same collection — leaving the date range blank always
picks up exactly what's new since the last invoice for that school.

**This computes the arithmetic only — it is not verified tax advice.**
GST rate, applicability, and invoice-format requirements depend on your
actual registration and agreement with each school; have your
accountant/CA confirm before treating a generated PDF as an official tax
invoice. The commission % defaults to a school's
`commissionPercentOverride` (or `PLATFORM_COMMISSION_PERCENT`) but can be
overridden per invoice in the modal.

## Multi-school settlement (legacy Razorpay Route — no longer active)

Before the switch to UPI QR payments, the platform supported splitting
settlement directly to a school's own bank account at the moment of
payment via Razorpay **Route** (Linked Accounts) —
`School.razorpayAccountId`/`razorpaySettlementStatus`, an admin UI to
link each school's account, and `razorpayService.buildSchoolTransfer()`
which ran automatically on every order.

**This no longer does anything.** All payments now go through one UPI ID
into one bank account (there's no gateway "order" for a transfer to
attach to), so Route can't run regardless of whether a school is linked.
The `School.razorpayAccountId`/`razorpaySettlementStatus` fields, the
admin UI to set them, and [`RAZORPAY_ROUTE.md`](./RAZORPAY_ROUTE.md)
are kept only so nothing breaks for existing data — they're safe to
ignore, and safe to remove later if you want to clean them up.

**Every school is now settled the same way:** manually, through the
**School Settlement Invoice** feature described above.

## Security notes

- Passwords are hashed with bcrypt — never stored in plain text.
- JWTs are used for both school and admin sessions; keep `JWT_SECRET`
  secret and don't commit `.env`.
- Payment amounts are always recomputed server-side from the fee table
  — a client can never manipulate what they pay.
- No payment credentials of any kind are held by this server — only a
  public UPI ID/payee name, used to build the QR code. There is nothing
  equivalent to a gateway secret key to protect here, but see
  `UPI_PAYMENTS.md` for the fraud-protection tradeoff this brings.
- **Security headers** are set via [helmet](https://helmetjs.github.io/).
- **Rate limiting** ([express-rate-limit](https://www.npmjs.com/package/express-rate-limit))
  is applied: a general cap across `/api/*`, tighter caps on
  `/api/auth/*` (login/register), `POST /api/payments/create-order`, and
  `/api/contact`, and a separate, more generous cap on
  `GET /api/payments/:id/status` (polled repeatedly by the QR modal).
- **CORS** is locked to the origins listed in `CORS_ORIGIN` — requests
  from any other origin are rejected.
- Responses are gzip-compressed (`compression`) and requests are logged
  (`morgan` — concise in dev, Apache-combined in production).
- The server shuts down gracefully on `SIGTERM`/`SIGINT` (closes the DB
  connection cleanly) so process managers/containers can restart it
  without dropping in-flight requests.
- HTTPS itself is **not** terminated by this app — put it behind a
  reverse proxy (Nginx, Caddy, or your hosting provider's load balancer)
  that handles TLS. `trust proxy` is already enabled so client IPs /
  rate limiting behave correctly behind one.
- `npm install` again after pulling these changes — `helmet`,
  `compression`, `morgan`, and `express-rate-limit` are new dependencies.

## Production deployment checklist

1. **Rotate secrets.** The `.env` in this project was used for local
   development — before going live, generate a fresh `JWT_SECRET`,
   set a strong `ADMIN_PASSWORD`, fill in your real `UPI_VPA`/
   `UPI_PAYEE_NAME`, and use a real database password (not `aniketh`).
   Never commit `.env` — it's already in `.gitignore`.
2. **Database.** Use `DB_DIALECT=mysql` (or `postgres`) pointed at a
   real managed database, not SQLite, for anything beyond local testing.
   Run `npm run db:init` once against it, then keep
   `NODE_ENV=production` set so the server never runs `sync({ alter:
   true })` automatically against production data — use proper
   migrations for schema changes from here on. **If you're redeploying
   onto an existing database after pulling in the UPI payment changes**
   (`Payment.referenceId`/`markedPaidByAdminId`/`markedPaidAt`, the
   removed `razorpayOrderId`/`razorpayPaymentId`/`razorpaySignature`
   columns, and the `status` enum narrowing from `created` to `pending`),
   run `npm run migrate:upi-payments` **first** (handles the enum change
   safely against existing rows), then `npm run db:init` — see
   `UPI_PAYMENTS.md` for exactly why the extra step is needed.
3. **Environment.** Set `NODE_ENV=production` and a correct
   `CORS_ORIGIN` (your real site domain, not localhost).
4. **Process manager.** Run the server under something that restarts it
   on crash and on reboot, e.g. [PM2](https://pm2.keymetrics.io/):
   ```bash
   npm install -g pm2
   cd backend
   pm2 start src/server.js --name future-tech-backend
   pm2 save
   pm2 startup   # follow the printed instructions to run on boot
   ```
5. **Reverse proxy + HTTPS.** Put Nginx (or similar) in front, terminate
   TLS (e.g. via [Let's Encrypt](https://letsencrypt.org)/Certbot), and
   proxy to the Node process:
   ```nginx
   server {
       listen 443 ssl;
       server_name api.yourdomain.com;

       ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:5000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   Serve the static `site/` folder either from the same Nginx (a
   separate `server` block / `location` pointing at the `site/`
   directory) or from any static host (Netlify, Vercel, S3+CloudFront,
   GitHub Pages, etc.) — just make sure `site/assets/js/config.js`
   points `API_BASE_URL` at `https://api.yourdomain.com/api`, and that
   the site's real origin is added to `CORS_ORIGIN`.
6. **Backups.** Set up regular backups for your production database and
   for the `backend/receipts/` folder (or move receipt storage to
   object storage like S3 if you're running multiple server instances —
   right now receipts are written to local disk, which doesn't work
   across multiple stateless instances behind a load balancer without a
   shared/networked filesystem).
7. **Monitoring.** At minimum, watch the process (PM2 has a `pm2 monit` /
   `pm2 logs`) and set up uptime checks against `GET /api/health`.
