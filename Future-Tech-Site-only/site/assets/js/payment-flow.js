/**
 * FTPayment - drives the full "pay now" flow shared by the individual
 * and bulk admission pages:
 *   1. Create an admission record on the backend (already done by caller)
 *   2. Ask the backend to create a payment + get back a UPI QR code for
 *      the exact amount
 *   3. Show the QR in a modal and poll the backend for its status
 *   4. The school (or an admin) manually confirms the payment once they've
 *      checked it landed in the bank account - nothing in this app can see
 *      the UPI payment itself, so the status only ever changes when a
 *      person confirms it.
 *   5. The moment that happens, this picks it up and hands back the
 *      receipt download link.
 *
 * Because step 4 is done by hand it can take minutes or even a working day,
 * so the modal does NOT spin forever:
 *   - first ~2 minutes: "waiting" spinner, checks every 6 s
 *   - after that: a calm "awaiting verification" message with a "Check
 *     status now" button, checks slow down (15 s, then 30 s) and stop after
 *     30 minutes (the payer can still press the button)
 *   - 429 / network errors / "payment not found" are shown, not swallowed
 *   - for individual admissions the pending payment is remembered in this
 *     browser (localStorage), so closing the window or the tab is safe: the
 *     page offers "Resume payment" next time (see offerResume below).
 *
 * Requires assets/js/config.js, assets/js/api-client.js, and Bootstrap 5
 * (bootstrap.bundle.min.js, for the modal) to be loaded on the page
 * before this file.
 */
const FTPayment = (function () {
  const MODAL_ID = "ftUpiPaymentModal";

  // Polling schedule (milliseconds since the QR was shown)
  const FAST_POLL_MS = 6000;
  const SLOW_POLL_MS = 15000;
  const IDLE_POLL_MS = 30000;
  const SPINNER_PHASE_MS = 2 * 60 * 1000;   // spinner + "keep this window open"
  const SLOW_PHASE_MS = 10 * 60 * 1000;     // then 15 s checks
  const GIVE_UP_MS = 30 * 60 * 1000;        // then stop auto-checking
  const RATE_LIMIT_PAUSE_MS = 60 * 1000;

  const PENDING_KEY = "ft_pending_payment";
  const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  function formatRupees(amount) {
    return "Rs. " + Number(amount || 0).toLocaleString("en-IN");
  }

  // ---- remembered pending payment (this browser only) ----
  function readPending() {
    try {
      const rec = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
      if (!rec || !rec.paymentId || !rec.admissionId) return null;
      if (Date.now() - (rec.savedAt || 0) > PENDING_MAX_AGE_MS) {
        localStorage.removeItem(PENDING_KEY);
        return null;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }
  function savePending(rec) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...rec, savedAt: Date.now() })); } catch (e) { /* storage unavailable - resume just won't be offered */ }
  }
  function clearPending() {
    try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  }

  function ensureModal() {
    let modalEl = document.getElementById(MODAL_ID);
    if (modalEl) return modalEl;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="modal fade" id="${MODAL_ID}" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title fw-bold mb-0"><i class="bi bi-qr-code-scan me-2"></i>Scan &amp; Pay via UPI</h5>
              <button type="button" class="btn-close" id="ftUpiCloseBtn" aria-label="Close"></button>
            </div>
            <div class="modal-body text-center">
              <div id="ftUpiLoading" class="py-4">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-3 mb-0 text-muted" id="ftUpiLoadingText">Generating your payment QR code&hellip;</p>
              </div>
              <div id="ftUpiContent" class="d-none">
                <p class="mb-2 text-muted">Scan with any UPI app &mdash; Google Pay, PhonePe, Paytm, BHIM, or your bank's app.</p>
                <img id="ftUpiQrImg" src="" alt="UPI QR code" class="img-fluid border rounded p-2 mb-3" style="width: 220px; height: 220px;">
                <div class="fs-3 fw-bold text-primary" id="ftUpiAmount">Rs. 0</div>
                <div class="small text-muted" id="ftUpiBreakdown"></div>
                <div class="small text-muted mb-1">to <strong id="ftUpiPayee">-</strong> (<span id="ftUpiVpa">-</span>)</div>
                <div class="small text-muted mb-3">
                  Reference: <span class="fw-semibold" id="ftUpiRef">-</span>
                  <button type="button" class="btn btn-sm btn-link p-0 ms-1" id="ftUpiCopyBtn">copy</button>
                </div>

                <div class="alert alert-warning small d-flex align-items-start gap-2 text-start mb-2" id="ftUpiWaitingAlert" role="status" aria-live="polite">
                  <span class="spinner-border spinner-border-sm mt-1 flex-shrink-0" id="ftUpiWaitingSpinner"></span>
                  <span id="ftUpiWaitingText">Waiting for payment confirmation&hellip; please keep this window open.</span>
                </div>
                <div class="small text-muted mb-2 d-none" id="ftUpiConnNote"></div>
                <div class="alert alert-danger small text-start d-none mb-2" id="ftUpiErrorAlert"></div>

                <div class="d-flex flex-wrap justify-content-center gap-2 mb-2">
                  <button type="button" class="btn btn-outline-primary btn-sm d-none" id="ftUpiCheckBtn">
                    <i class="bi bi-arrow-repeat me-1"></i>Check status now
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm d-none" id="ftUpiLaterBtn">Close &mdash; I'll check later</button>
                  <button type="button" class="btn btn-primary btn-sm d-none" id="ftUpiRetryBtn">
                    <i class="bi bi-arrow-clockwise me-1"></i>Try Payment Again
                  </button>
                </div>
                <div class="small text-muted d-none mb-2" id="ftUpiLastChecked"></div>

                <p class="small text-muted mb-0">
                  Your payment goes straight to the school's bank account. It is confirmed <strong>by hand</strong> after the school
                  sees it there &mdash; scanning the QR alone does not confirm anything.
                  Already paid but nothing's changed? Don't pay again &mdash; contact your school with the reference number above.
                </p>
              </div>
              <div id="ftUpiSetupError" class="d-none alert alert-danger small mb-0"></div>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrapper.firstElementChild);
    return document.getElementById(MODAL_ID);
  }

  /**
   * @param {Object} opts
   * @param {"individual"|"bulk"} opts.type
   * @param {string} opts.admissionId
   * @param {Object} opts.payer  { name, email, phone }
   * @param {number} [opts.months]          payment period in months (individual; server default = 5)
   * @param {number} [opts.expectedAmount]  the amount the page showed; the server refuses if it differs
   * @param {Object} [opts.remember]        { studentName, email } - when given, the pending payment is remembered
   *                                        in this browser so the page can offer "Resume payment" later
   * @param {string} [opts.resumePaymentId] reopen an existing payment: checks its status first
   * @param {Function} opts.onSuccess  (result: { receiptNumber, downloadUrl }) => void
   * @param {Function} opts.onError    (message: string) => void
   * @param {Function} [opts.onDismiss] called if the user closes the QR modal before payment is confirmed
   */
  async function payForAdmission(opts) {
    const { type, admissionId, payer, onSuccess, onError, onDismiss } = opts;
    const canResume = !!opts.remember;

    const modalEl = ensureModal();
    const $ = (id) => document.getElementById(id);
    const loadingEl = $("ftUpiLoading");
    const contentEl = $("ftUpiContent");
    const setupErrorEl = $("ftUpiSetupError");
    const waitingAlert = $("ftUpiWaitingAlert");
    const waitingSpinner = $("ftUpiWaitingSpinner");
    const waitingText = $("ftUpiWaitingText");
    const errorAlert = $("ftUpiErrorAlert");
    const connNote = $("ftUpiConnNote");
    const checkBtn = $("ftUpiCheckBtn");
    const laterBtn = $("ftUpiLaterBtn");
    const retryBtn = $("ftUpiRetryBtn");
    const lastChecked = $("ftUpiLastChecked");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    let order = null;
    let pollTimer = null;
    let stopped = true;        // no automatic polling running
    let checking = false;
    let startedAt = 0;
    let backoffUntil = 0;
    let errorStreak = 0;
    let paidOrFailed = false;
    let userDismissed = true;  // assume dismissal unless we close it ourselves

    function stopPolling() {
      stopped = true;
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    }

    function onVisible() {
      // Payer comes back from their UPI app: check straight away instead of
      // waiting for the next (possibly 30 s away) scheduled check.
      if (document.visibilityState === "visible" && order && !paidOrFailed) checkStatus(false);
    }

    function onHidden() {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisible);
      modalEl.removeEventListener("hidden.bs.modal", onHidden);
      if (!paidOrFailed && userDismissed && onDismiss) onDismiss({ remembered: canResume && !!order });
    }
    modalEl.addEventListener("hidden.bs.modal", onHidden);
    document.addEventListener("visibilitychange", onVisible);

    function dismiss() { userDismissed = true; modal.hide(); }
    $("ftUpiCloseBtn").onclick = dismiss;
    laterBtn.onclick = dismiss;

    // ---------- what the payer sees while waiting ----------
    function setWaitingUi(phase) {
      waitingAlert.classList.remove("d-none", "alert-warning", "alert-info");
      if (phase === "spinner") {
        waitingAlert.classList.add("alert-warning");
        waitingSpinner.classList.remove("d-none");
        waitingText.textContent =
          "Waiting for payment confirmation\u2026 once you have paid, please keep this window open for a moment.";
        checkBtn.classList.add("d-none");
        laterBtn.classList.add("d-none");
      } else if (phase === "awaiting") {
        waitingAlert.classList.add("alert-info");
        waitingSpinner.classList.add("d-none");
        waitingText.textContent = canResume
          ? "Payment submitted \u2014 awaiting verification. Your school confirms payments by hand after checking its bank account, " +
            "which can take from a few minutes up to a working day. You don't need to wait here: close this window and come back to " +
            "this page later \u2014 it will offer \"Resume payment\" and your registration is saved."
          : "Payment submitted \u2014 awaiting verification. It is confirmed by hand after the bank account is checked, which can take " +
            "from a few minutes up to a working day. Keep the reference number above; you can close this window.";
        checkBtn.classList.remove("d-none");
        laterBtn.classList.remove("d-none");
      } else if (phase === "stopped") {
        waitingAlert.classList.add("alert-info");
        waitingSpinner.classList.add("d-none");
        waitingText.textContent =
          "Still awaiting verification. We've stopped checking automatically \u2014 press \"Check status now\" any time" +
          (canResume ? ", or come back to this page later and choose \"Resume payment\"." : ".");
        checkBtn.classList.remove("d-none");
        laterBtn.classList.remove("d-none");
      }
    }

    function updatePhaseUi() {
      const elapsed = Date.now() - startedAt;
      setWaitingUi(elapsed < SPINNER_PHASE_MS ? "spinner" : "awaiting");
    }

    function showConnNote(text) {
      if (text) { connNote.textContent = text; connNote.classList.remove("d-none"); }
      else connNote.classList.add("d-none");
    }

    function showLastChecked() {
      const t = new Date();
      lastChecked.textContent = "Last checked at " + t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " \u2014 still pending.";
      lastChecked.classList.remove("d-none");
    }

    function handleStatus(status) {
      if (status.status === "paid") {
        paidOrFailed = true;
        userDismissed = false;
        stopPolling();
        clearPending();
        modal.hide();
        onSuccess({ receiptNumber: status.receiptNumber, downloadUrl: status.downloadUrl });
        return;
      }
      if (status.status === "failed") {
        // Deliberately NOT setting paidOrFailed = true here - that flag
        // controls whether onDismiss fires when the modal closes, and
        // a failed payment should still count as a dismissal (so the
        // underlying registration page re-enables its own button)
        // if the parent just closes the modal instead of retrying.
        stopPolling();
        waitingAlert.classList.add("d-none");
        checkBtn.classList.add("d-none");
        laterBtn.classList.add("d-none");
        errorAlert.textContent =
          "This payment was marked as NOT received. If you did pay, please don't pay again \u2014 contact your school with the " +
          "reference number above so they can check the bank statement. Otherwise you can try again below.";
        errorAlert.classList.remove("d-none");
        retryBtn.classList.remove("d-none");
      }
    }

    async function checkStatus(manual) {
      if (!order || checking || paidOrFailed) return;
      checking = true;
      if (manual) { checkBtn.disabled = true; checkBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Checking\u2026'; }
      try {
        const status = await FTApi.getPaymentStatus(order.paymentId);
        errorStreak = 0;
        showConnNote("");
        handleStatus(status);
        if (status.status === "pending") {
          if (manual) showLastChecked();
          if (manual && stopped) { startedAt = Date.now() - SPINNER_PHASE_MS; stopped = false; schedule(); }
        }
      } catch (e) {
        errorStreak += 1;
        if (e && e.status === 404) {
          stopPolling();
          clearPending();
          waitingAlert.classList.add("d-none");
          errorAlert.textContent = "We couldn't find this payment any more. Please submit the form again, or contact support with your reference number.";
          errorAlert.classList.remove("d-none");
        } else if (e && e.status === 429) {
          backoffUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
          showConnNote("Too many status checks from this network \u2014 pausing for a minute. Your payment is not affected.");
        } else if (errorStreak >= 3 || manual) {
          showConnNote("Having trouble reaching the server (" + ((e && e.message) || "network error") + "). Your payment is not affected \u2014 we'll keep trying.");
        }
      } finally {
        checking = false;
        if (manual) { checkBtn.disabled = false; checkBtn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Check status now'; }
      }
    }

    function nextDelay() {
      const elapsed = Date.now() - startedAt;
      let d = elapsed < SPINNER_PHASE_MS ? FAST_POLL_MS : elapsed < SLOW_PHASE_MS ? SLOW_POLL_MS : IDLE_POLL_MS;
      if (Date.now() < backoffUntil) d = Math.max(d, backoffUntil - Date.now());
      return d;
    }

    function schedule() {
      if (stopped || paidOrFailed) return;
      if (Date.now() - startedAt > GIVE_UP_MS) {
        stopPolling();
        setWaitingUi("stopped");
        return;
      }
      updatePhaseUi();
      pollTimer = setTimeout(async function () {
        pollTimer = null;
        await checkStatus(false);
        schedule();
      }, nextDelay());
    }

    checkBtn.onclick = function () { checkStatus(true); };

    function resetForNewOrder() {
      loadingEl.classList.remove("d-none");
      contentEl.classList.add("d-none");
      setupErrorEl.classList.add("d-none");
      errorAlert.classList.add("d-none");
      retryBtn.classList.add("d-none");
      lastChecked.classList.add("d-none");
      showConnNote("");
      setWaitingUi("spinner");
      paidOrFailed = false;
      errorStreak = 0;
      backoffUntil = 0;
      stopPolling();
    }

    async function startOrder() {
      resetForNewOrder();
      $("ftUpiLoadingText").textContent = "Generating your payment QR code\u2026";

      try {
        order = await FTApi.createPaymentOrder({
          type,
          admissionId,
          payerName: payer.name,
          payerEmail: payer.email,
          payerPhone: payer.phone,
          // Individual admissions only; the server decides the amount and
          // refuses a mismatch with what the page displayed.
          ...(opts.months ? { months: opts.months } : {}),
          ...(opts.expectedAmount ? { expectedAmount: opts.expectedAmount } : {}),
        });

        loadingEl.classList.add("d-none");
        contentEl.classList.remove("d-none");

        $("ftUpiQrImg").src = order.qrCodeDataUrl;
        $("ftUpiAmount").textContent = formatRupees(order.amount);
        $("ftUpiBreakdown").textContent =
          order.monthlyFee && order.paymentMonths
            ? formatRupees(order.monthlyFee) + " \u00d7 " + order.paymentMonths + " months"
            : "";
        $("ftUpiPayee").textContent = order.payeeName || "-";
        $("ftUpiVpa").textContent = order.vpa || "-";
        $("ftUpiRef").textContent = order.referenceId || "-";

        $("ftUpiCopyBtn").onclick = function () {
          if (navigator.clipboard && order.referenceId) {
            navigator.clipboard.writeText(order.referenceId).catch(() => {});
          }
        };

        if (canResume) {
          savePending({
            paymentId: order.paymentId,
            admissionId,
            type,
            payer,
            amount: order.amount,
            referenceId: order.referenceId,
            studentName: opts.remember.studentName || "",
            email: opts.remember.email || "",
          });
        }

        startedAt = Date.now();
        stopped = false;
        await checkStatus(false); // right away, in case it was already confirmed
        schedule();
      } catch (err) {
        loadingEl.classList.add("d-none");
        setupErrorEl.textContent = err.message || "Could not start payment. Please try again.";
        setupErrorEl.classList.remove("d-none");
        onError(err.message || "Could not start payment. Please try again.");
      }
    }

    retryBtn.onclick = function () { startOrder(); };

    if (opts.resumePaymentId) {
      // Reopening a payment started earlier: it may have been confirmed
      // while the payer was away. Look at its status BEFORE opening the
      // window, so an already-confirmed payment goes straight to the
      // success step without a modal flashing open and shut.
      try {
        const status = await FTApi.getPaymentStatus(opts.resumePaymentId);
        if (status.status === "paid") {
          paidOrFailed = true;
          clearPending();
          document.removeEventListener("visibilitychange", onVisible);
          modalEl.removeEventListener("hidden.bs.modal", onHidden);
          onSuccess({ receiptNumber: status.receiptNumber, downloadUrl: status.downloadUrl });
          return;
        }
      } catch (e) {
        if (e && e.status === 404) clearPending();
        // any other error: fall through - startOrder() surfaces real problems
      }
    }

    modal.show();
    startOrder();
  }

  /**
   * Shows a "you have a payment awaiting verification" banner inside
   * `container` when this browser remembers one (see `remember` above), with a
   * button that reopens it. Checks the status quietly first so the banner
   * can say "confirmed" / "not received" straight away.
   *
   * @param {HTMLElement} container
   * @param {Function} makeOptions  (pending) => payForAdmission options (callbacks etc.), WITHOUT resumePaymentId
   */
  async function offerResume(container, makeOptions) {
    const pending = readPending();
    if (!container || !pending) return;

    let state = "pending";
    try {
      const s = await FTApi.getPaymentStatus(pending.paymentId);
      state = s.status;
    } catch (e) {
      if (e && e.status === 404) { clearPending(); return; }
    }

    const box = document.createElement("div");
    const tone = state === "paid" ? "success" : state === "failed" ? "danger" : "info";
    box.className = "alert alert-" + tone + " d-flex flex-wrap align-items-center justify-content-between gap-2";
    const text = document.createElement("div");
    const who = pending.studentName ? " for " + pending.studentName : "";
    const amt = pending.amount ? formatRupees(pending.amount) : "your fee";
    text.textContent =
      state === "paid"
        ? "Good news \u2014 your payment of " + amt + who + " has been confirmed. Continue to get your receipt and create the student login."
        : state === "failed"
        ? "Your payment of " + amt + who + " (ref " + pending.referenceId + ") was marked as not received. Open it to see your options."
        : "You have a payment of " + amt + who + " (ref " + pending.referenceId + ") awaiting verification by your school. No need to fill the form again.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-" + tone + " btn-sm fw-bold";
    btn.textContent = state === "paid" ? "Continue" : "Resume payment";
    btn.onclick = function () {
      payForAdmission({ ...makeOptions(pending), resumePaymentId: pending.paymentId });
    };
    box.appendChild(text);
    box.appendChild(btn);
    container.innerHTML = "";
    container.appendChild(box);
    container.classList.remove("d-none");
  }

  return { payForAdmission, offerResume, getPending: readPending, clearPending };
})();
