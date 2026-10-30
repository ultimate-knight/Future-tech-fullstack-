/**
 * FTStore - lightweight localStorage-backed data layer used to capture
 * form submissions across the site (Contact, Individual Admissions,
 * Bulk Admissions) so they can be reviewed on the Admin page.
 *
 * NOTE: This is a static (no-backend) website, so submissions are stored
 * in the visitor's own browser (localStorage). This is fine for demos /
 * local review, but for a real production deployment you should replace
 * FTStore.save() with a call to a real backend / form service (e.g. a
 * Google Sheet, Formspree, or your own API) so submissions from every
 * visitor land in one place.
 */
const FTStore = (function () {
  const PREFIX = "ft_submissions_";

  function key(type) {
    return PREFIX + type;
  }

  function uid() {
    return (
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
    );
  }

  function getAll(type) {
    try {
      const raw = localStorage.getItem(key(type));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("FTStore.getAll error", e);
      return [];
    }
  }

  function save(type, data) {
    const list = getAll(type);
    const record = Object.assign(
      {
        id: uid(),
        submittedAt: new Date().toISOString(),
      },
      data
    );
    list.unshift(record);
    localStorage.setItem(key(type), JSON.stringify(list));
    return record;
  }

  function remove(type, id) {
    const list = getAll(type).filter((r) => r.id !== id);
    localStorage.setItem(key(type), JSON.stringify(list));
  }

  function clear(type) {
    localStorage.removeItem(key(type));
  }

  function count(type) {
    return getAll(type).length;
  }

  /**
   * Generic helper: scrape label + input/select/textarea pairs found
   * inside a root element and return them as a plain object keyed by
   * the label text. Checkboxes are collected separately as an array of
   * their (checked) label texts under the given groupKey.
   */
  function collectFields(root) {
    const data = {};
    if (!root) return data;

    root.querySelectorAll("input, select, textarea").forEach((el) => {
      if (el.type === "checkbox" || el.type === "radio" || el.type === "file") {
        return;
      }
      const wrapper = el.closest("div");
      const label = wrapper ? wrapper.querySelector("label") : null;
      let labelText = label
        ? label.textContent.replace(/\*/g, "").trim()
        : el.name || el.placeholder || el.id || "Field";
      // avoid collisions
      let finalKey = labelText;
      let i = 2;
      while (data.hasOwnProperty(finalKey)) {
        finalKey = labelText + " (" + i + ")";
        i++;
      }
      data[finalKey] = el.value ? el.value.trim() : "";
    });

    return data;
  }

  function collectCheckedLabels(root) {
    const checked = [];
    if (!root) return checked;
    root
      .querySelectorAll('input[type="checkbox"]:checked')
      .forEach((el) => {
        const wrapper = el.closest("div");
        const label = wrapper ? wrapper.querySelector("label") : null;
        checked.push(
          label ? label.textContent.trim() : el.name || el.value || "Selected"
        );
      });
    return checked;
  }

  return {
    save,
    getAll,
    remove,
    clear,
    count,
    collectFields,
    collectCheckedLabels,
  };
})();

/**
 * FTAuth - lightweight localStorage-backed account system for the
 * "School Login" area. Lets a school register an account (org name,
 * email, password) and log in to a simple portal.
 *
 * NOTE: Same caveat as FTStore - this is a static, no-backend site, so
 * accounts and passwords are stored in the browser's own localStorage,
 * in plain text. This is fine for a demo / prototype, but it is NOT
 * secure enough for real school data. Before going live, replace this
 * with real authentication against a backend (hashed + salted
 * passwords, HTTPS, server-side session handling, etc).
 */
const FTAuth = (function () {
  const ACCOUNTS_KEY = "ft_school_accounts";
  const SESSION_KEY = "ft_school_session";

  function getAccounts() {
    try {
      const raw = localStorage.getItem(ACCOUNTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("FTAuth.getAccounts error", e);
      return [];
    }
  }

  function saveAccounts(list) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  }

  function normalizeEmail(email) {
    return (email || "").trim().toLowerCase();
  }

  function findByEmail(email) {
    const e = normalizeEmail(email);
    return getAccounts().find((a) => a.email === e) || null;
  }

  /**
   * Register a new school account.
   * Returns { ok: true, account } or { ok: false, error }.
   */
  function register({ schoolName, contactName, email, phone, password }) {
    email = normalizeEmail(email);
    if (!schoolName || !email || !password) {
      return { ok: false, error: "Please fill in the required fields." };
    }
    if (password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters." };
    }
    if (findByEmail(email)) {
      return { ok: false, error: "An account with this email already exists. Please log in instead." };
    }

    const accounts = getAccounts();
    const account = {
      id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      schoolName: schoolName.trim(),
      contactName: (contactName || "").trim(),
      email: email,
      phone: (phone || "").trim(),
      password: password, // plain text - see security note above
      createdAt: new Date().toISOString(),
    };
    accounts.push(account);
    saveAccounts(accounts);
    return { ok: true, account };
  }

  /**
   * Attempt login. Returns { ok: true, account } or { ok: false, error }.
   */
  function login(email, password) {
    const account = findByEmail(email);
    if (!account || account.password !== password) {
      return { ok: false, error: "Incorrect email or password." };
    }
    sessionStorage.setItem(SESSION_KEY, account.email);
    return { ok: true, account };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function currentAccount() {
    const email = sessionStorage.getItem(SESSION_KEY);
    if (!email) return null;
    return findByEmail(email);
  }

  return {
    register,
    login,
    logout,
    currentAccount,
    findByEmail,
  };
})();
