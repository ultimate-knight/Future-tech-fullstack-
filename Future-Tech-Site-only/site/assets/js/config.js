/**
 * Frontend configuration for talking to the Future Tech backend API.
 *
 * Auto-detects the environment, so the SAME file works on your laptop and
 * on the live server - nothing to switch before deploying:
 *   - opened from localhost / 127.0.0.1  -> backend at http://localhost:5000/api
 *   - anywhere else (live domain)        -> "/api" (same domain, proxied
 *                                           to the backend by your web server)
 *
 * If your local backend uses a different port, change LOCAL_BACKEND below.
 */
(function () {
  var LOCAL_BACKEND = "http://localhost:5000/api";
  var host = window.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1";
  window.FT_CONFIG = {
    API_BASE_URL: isLocal ? LOCAL_BACKEND : "/api",
  };
})();
