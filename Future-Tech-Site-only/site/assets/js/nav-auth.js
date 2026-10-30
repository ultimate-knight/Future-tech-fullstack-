/**
 * FTNavAuth - small, defensive helper for pages that reference a logged-in
 * school session (sessionStorage key "ft_backend_school_token").
 *
 * This file intentionally does nothing destructive: it only touches DOM
 * elements that opt in via specific IDs/classes, so it's safe to include
 * on any page even if those elements don't exist there.
 *
 * Opt-in hooks (add these to a page's nav if you want live login state):
 *   - Any element with [data-ft-auth="logged-out"]  -> hidden when logged in
 *   - Any element with [data-ft-auth="logged-in"]   -> hidden when logged out
 *   - Any element with [data-ft-auth-logout]        -> click clears the
 *                                                       session and redirects
 *                                                       to index.html
 */
(function () {
  const SCHOOL_TOKEN_KEY = "ft_backend_school_token";

  function isLoggedIn() {
    try {
      return !!sessionStorage.getItem(SCHOOL_TOKEN_KEY);
    } catch (e) {
      return false;
    }
  }

  function applyAuthVisibility() {
    const loggedIn = isLoggedIn();
    document.querySelectorAll('[data-ft-auth="logged-out"]').forEach(function (el) {
      el.style.display = loggedIn ? "none" : "";
    });
    document.querySelectorAll('[data-ft-auth="logged-in"]').forEach(function (el) {
      el.style.display = loggedIn ? "" : "none";
    });
  }

  function wireLogoutButtons() {
    document.querySelectorAll("[data-ft-auth-logout]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        try {
          sessionStorage.removeItem(SCHOOL_TOKEN_KEY);
        } catch (err) {
          /* ignore */
        }
        window.location.href = "school-login.html";
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyAuthVisibility();
      wireLogoutButtons();
    });
  } else {
    applyAuthVisibility();
    wireLogoutButtons();
  }

  window.FTNavAuth = { isLoggedIn: isLoggedIn };
})();
