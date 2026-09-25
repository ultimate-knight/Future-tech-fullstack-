/**
 * FTPayment - drives the full "pay now" flow shared by the individual
 * and bulk admission pages:
 *   1. Create an admission record on the backend (already done by caller)
 *   2. Ask the backend to create a payment + get back a UPI QR code for
 *      the exact amount
 *   3. Show the QR in a modal and poll the backend for its status
 *   4. An admin manually confirms the payment from the admin dashboard
 *      once they've checked it landed in the bank account
 *   5. The moment that happens, this picks it up and hands back the
 *      receipt download link - same external result as before, just no
 *      payment gateway in the middle.
 *
 * Requires assets/js/config.js, assets/js/api-client.js, and Bootstrap 5
 * (bootstrap.bundle.min.js, for the modal) to be loaded on the page
 * before this file.
 */
const FTPayment = (function () {
  const POLL_INTERVAL_MS = 6000;
  const MODAL_ID = "ftUpiPaymentModal";

  function formatRupees(amount) {
    return "Rs. " + Number(amount || 0).toLocaleString("en-IN");
  }

  function ensureModal() {
    let modalEl = document.getElementById(MODAL_ID);
    if (modalEl) return modalEl;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div class="modal fade" id="${MODAL_ID}" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title fw-bold mb-0"><i class="bi bi-qr-code-scan me-2"></i>Scan &amp; Pay via UPI</h5>
              <button type="button" class="btn-close" id="ftUpiCloseBtn" aria-label="Close"></button>
            </div>
            <div class="modal-body text-center">
              <div id="ftUpiLoading" class="py-4">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-3 mb-0 text-muted">Generating your payment QR code&hellip;</p>
              </div>
              <div id="ftUpiContent" class="d-none">
                <p class="mb-2 text-muted">Scan with any UPI app &mdash; Google Pay, PhonePe, Paytm, BHIM, or your bank's app.</p>
                <img id="ftUpiQrImg" src="" alt="UPI QR code" class="img-fluid border rounded p-2 mb-3" style="width: 220px; height: 220px;">
                <div class="fs-3 fw-bold text-primary" id="ftUpiAmount">Rs. 0</div>
                <div class="small text-muted mb-1">to <strong id="ftUpiPayee">-</strong> (<span id="ftUpiVpa">-</span>)</div>
                <div class="small text-muted mb-3">
                  Reference: <span class="fw-semibold" id="ftUpiRef">-</span>
                  <button type="button" class="btn btn-sm btn-link p-0 ms-1" id="ftUpiCopyBtn">copy</button>
                </div>
                <div class="alert alert-warning small d-flex align-items-center gap-2 mb-2" id="ftUpiWaitingAlert">
                  <span class="spinner-border spinner-border-sm"></span>
                  <span>Waiting for payment confirmation&hellip; please keep this window open.</span>
                </div>
                <div class="alert alert-danger small d-none mb-2" id="ftUpiErrorAlert"></div>
                <button type="button" class="btn btn-primary btn-sm d-none mb-2" id="ftUpiRetryBtn">
                  <i class="bi bi-arrow-clockwise me-1"></i>Try Payment Again
                </button>
                <p class="small text-muted mb-0">
                  After you pay, our team verifies it and confirms it here &mdash; usually within a few minutes.
                  Already paid but nothing's changed? Don't pay again &mdash; contact us with the reference number above.
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
   * @param {Function} opts.onSuccess  (result: { receiptNumber, downloadUrl }) => void
   * @param {Function} opts.onError    (message: string) => void
   * @param {Function} [opts.onDismiss] called if the user closes the QR modal before paying
   */
  async function payForAdmission(opts) {
    const { type, admissionId, payer, onSuccess, onError, onDismiss } = opts;

    const modalEl = ensureModal();
    const loadingEl = document.getElementById("ftUpiLoading");
    const contentEl = document.getElementById("ftUpiContent");
    const setupErrorEl = document.getElementById("ftUpiSetupError");
    const waitingAlert = document.getElementById("ftUpiWaitingAlert");
    const errorAlert = document.getElementById("ftUpiErrorAlert");

    loadingEl.classList.remove("d-none");
    contentEl.classList.add("d-none");
    setupErrorEl.classList.add("d-none");
    waitingAlert.classList.remove("d-none");
    errorAlert.classList.add("d-none");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    let pollTimer = null;
    let paidOrFailed = false;
    let userDismissed = true; // assume dismissal unless we close it ourselves

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    function onHidden() {
      stopPolling();
      modalEl.removeEventListener("hidden.bs.modal", onHidden);
      if (!paidOrFailed && userDismissed && onDismiss) onDismiss();
    }
    modalEl.addEventListener("hidden.bs.modal", onHidden);
    document.getElementById("ftUpiCloseBtn").onclick = function () {
      userDismissed = true;
      modal.hide();
    };

    modal.show();

    const retryBtn = document.getElementById("ftUpiRetryBtn");

    async function startOrder() {
      loadingEl.classList.remove("d-none");
      contentEl.classList.add("d-none");
      setupErrorEl.classList.add("d-none");
      waitingAlert.classList.remove("d-none");
      errorAlert.classList.add("d-none");
      retryBtn.classList.add("d-none");
      paidOrFailed = false;
      stopPolling();

      try {
        const order = await FTApi.createPaymentOrder({
          type,
          admissionId,
          payerName: payer.name,
          payerEmail: payer.email,
          payerPhone: payer.phone,
        });

        loadingEl.classList.add("d-none");
        contentEl.classList.remove("d-none");

        document.getElementById("ftUpiQrImg").src = order.qrCodeDataUrl;
        document.getElementById("ftUpiAmount").textContent = formatRupees(order.amount);
        document.getElementById("ftUpiPayee").textContent = order.payeeName || "-";
        document.getElementById("ftUpiVpa").textContent = order.vpa || "-";
        document.getElementById("ftUpiRef").textContent = order.referenceId || "-";

        document.getElementById("ftUpiCopyBtn").onclick = function () {
          if (navigator.clipboard && order.referenceId) {
            navigator.clipboard.writeText(order.referenceId).catch(() => {});
          }
        };

        async function checkStatus() {
          try {
            const status = await FTApi.getPaymentStatus(order.paymentId);
            if (status.status === "paid") {
              paidOrFailed = true;
              userDismissed = false;
              stopPolling();
              modal.hide();
              onSuccess({ receiptNumber: status.receiptNumber, downloadUrl: status.downloadUrl });
            } else if (status.status === "failed") {
              // Deliberately NOT setting paidOrFailed = true here - that flag
              // controls whether onDismiss fires when the modal closes, and
              // a failed payment should still count as a dismissal (so the
              // underlying registration page re-enables its own button)
              // if the parent just closes the modal instead of retrying.
              stopPolling();
              waitingAlert.classList.add("d-none");
              errorAlert.textContent =
                "This payment could not be confirmed. You can try again below, or contact support with your reference number if you believe this is a mistake.";
              errorAlert.classList.remove("d-none");
              retryBtn.classList.remove("d-none");
            }
          } catch (e) {
            // transient network/error - just keep polling, don't interrupt the payer
          }
        }

        pollTimer = setInterval(checkStatus, POLL_INTERVAL_MS);
        checkStatus(); // also check right away in case it was already confirmed super fast
      } catch (err) {
        loadingEl.classList.add("d-none");
        setupErrorEl.textContent = err.message || "Could not start payment. Please try again.";
        setupErrorEl.classList.remove("d-none");
        onError(err.message || "Could not start payment. Please try again.");
      }
    }

    retryBtn.onclick = function () {
      startOrder();
    };

    startOrder();
  }

  return { payForAdmission };
})();
