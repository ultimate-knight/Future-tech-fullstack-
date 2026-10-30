/**
 * FTFees - shows the individual-admission fees and the confirmed-enrolment
 * counts on the admission pages, straight from the backend so the numbers on
 * the page can never drift from what the server actually charges:
 *   GET /api/config                        -> monthly fee + 5-month total per level
 *   GET /api/admissions/individual/stats   -> number of PAID enrolments per level
 *
 * Requires assets/js/config.js and assets/js/api-client.js. Every render
 * function quietly does nothing if its target element is not on the page, and
 * if the backend can't be reached the cards say so instead of showing
 * invented numbers.
 */
const FTFees = (function () {
  const LEVELS = [
    { key: "level1", label: "Level 1", grades: "5th\u20136th" },
    { key: "level2", label: "Level 2", grades: "7th\u20138th" },
    { key: "level3", label: "Level 3", grades: "9th\u201310th" },
    { key: "level4", label: "Level 4", grades: "11th\u201312th" },
  ];
  let fees = null; // { monthly: {level1..}, level1..level4 (totals), programMonths }

  const rupees = (n) => "\u20B9" + Number(n).toLocaleString("en-IN");

  async function load() {
    if (fees) return fees;
    const cfg = await FTApi.getConfig();
    if (!cfg || !cfg.fees || !cfg.fees.monthly) throw new Error("Fee details unavailable");
    fees = cfg.fees;
    return fees;
  }

  /** Total for the full program for a level key, or null if not loaded / unknown. */
  function total(levelKey) {
    return fees && Number.isInteger(fees[levelKey]) ? fees[levelKey] : null;
  }
  function months() {
    return fees ? fees.programMonths : null;
  }

  async function renderFeeCard(el) {
    if (!el) return;
    try {
      await load();
      el.innerHTML = "";
      LEVELS.forEach(function (lv) {
        const row = document.createElement("div");
        row.className = "d-flex justify-content-between align-items-baseline py-1 border-bottom";
        const left = document.createElement("span");
        left.className = "fw-semibold";
        left.textContent = lv.label;
        const right = document.createElement("span");
        right.className = "text-end";
        right.innerHTML = "<strong></strong> <small class=\"text-muted\">/ month</small>";
        right.querySelector("strong").textContent = rupees(fees.monthly[lv.key]);
        row.appendChild(left);
        row.appendChild(right);
        el.appendChild(row);
      });
      const note = document.createElement("div");
      note.className = "small text-muted mt-2";
      note.textContent = "The program runs " + fees.programMonths + " months. You pay the full " + fees.programMonths + "-month fee once, when you register (e.g. Level 1: " + rupees(fees[LEVELS[0].key]) + ").";
      el.appendChild(note);
    } catch (e) {
      el.textContent = "Fee details could not be loaded right now. They will be shown on the payment screen before you pay.";
    }
  }

  /** Keeps `el` showing "Level 2: ₹800 × 5 months = ₹4,000" for the level selected in `selectEl`. */
  async function bindPreview(selectEl, el) {
    if (!selectEl || !el) return;
    const update = function () {
      const key = selectEl.value;
      if (!fees || total(key) === null) { el.classList.add("d-none"); return; }
      const lv = LEVELS.find((l) => l.key === key);
      el.innerHTML = "";
      el.appendChild(document.createTextNode((lv ? lv.label : "Selected level") + " fee: " + rupees(fees.monthly[key]) + " \u00d7 " + fees.programMonths + " months = "));
      const strong = document.createElement("strong");
      strong.textContent = rupees(fees[key]);
      el.appendChild(strong);
      el.classList.remove("d-none");
    };
    selectEl.addEventListener("change", update);
    try {
      await load();
      // Put the monthly fee right in the dropdown, so it is visible at the
      // moment of choosing even on phones, where the fee card sits far below.
      // (Only the visible text changes; each option's value is untouched.)
      Array.from(selectEl.options).forEach(function (opt) {
        if (Object.prototype.hasOwnProperty.call(fees.monthly, opt.value) && !opt.dataset.ftBase) {
          opt.dataset.ftBase = opt.textContent.trim();
          opt.textContent = opt.dataset.ftBase + " \u2014 " + rupees(fees.monthly[opt.value]) + "/month";
        }
      });
      update();
    } catch (e) { /* preview stays hidden */ }
  }

  /**
   * Confirmed (paid) enrolments per level. The card is revealed only when
   * there is real data and at least one confirmed enrolment - an all-zeros
   * or failed-to-load counter would only hurt credibility.
   */
  async function renderCounts(cardEl, rowsEl) {
    if (!cardEl || !rowsEl) return;
    try {
      const stats = await FTApi.getIndividualAdmissionStats();
      if (!stats || !stats.total) return;
      rowsEl.innerHTML = "";
      LEVELS.forEach(function (lv) {
        const row = document.createElement("div");
        row.className = "d-flex justify-content-between py-1";
        const a = document.createElement("span");
        a.className = "fw-semibold";
        a.textContent = lv.label;
        const b = document.createElement("span");
        b.textContent = Number(stats.levels[lv.key] || 0).toLocaleString("en-IN");
        row.appendChild(a);
        row.appendChild(b);
        rowsEl.appendChild(row);
      });
      const sum = document.createElement("div");
      sum.className = "d-flex justify-content-between pt-2 mt-1 border-top fw-bold";
      sum.innerHTML = "<span>Total</span><span></span>";
      sum.lastChild.textContent = Number(stats.total).toLocaleString("en-IN");
      rowsEl.appendChild(sum);
      cardEl.classList.remove("d-none");
    } catch (e) {
      /* leave the card hidden */
    }
  }

  return { load, total, months, renderFeeCard, bindPreview, renderCounts };
})();
