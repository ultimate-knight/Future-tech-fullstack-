/**
 * Level-gated page guard for student LMS content pages
 * (level*-module*.html, level*-module*-quiz.html, level*-module*-pratical.html).
 *
 * How to use on a page:
 *   1. Before this script, set:  <script>window.FT_REQUIRED_LEVEL = "level1";</script>
 *   2. Include config.js and api-client.js BEFORE this file.
 *   3. Include this file.
 *
 * What it does:
 *   - If the visitor has no student login token, the page content is
 *     replaced with an "access restricted" message and a link to login.
 *   - If they ARE logged in but their registered programLevel does not
 *     match FT_REQUIRED_LEVEL, they're blocked the same way (a level-1
 *     student cannot view level-3 content just by guessing the URL).
 *   - On success, window.FT_STUDENT and window.FT_STUDENT_TOKEN are set
 *     for the page's own scripts to use (e.g. building PDF download links).
 *
 * NOTE: this is a client-side convenience gate for page content (quiz
 * questions, layout, etc). It intentionally does NOT protect the PDFs
 * directly — those are served by a separate, authenticated backend route
 * (/api/content/pdf/:level/:module/:filename) which re-checks the
 * student's level server-side on every download, so the real protection
 * doesn't depend on this script running.
 */
(function () {
  var STUDENT_TOKEN_KEY = "ft_backend_student_token";
  var token = sessionStorage.getItem(STUDENT_TOKEN_KEY);
  var requiredLevel = window.FT_REQUIRED_LEVEL;

  function blockAccess(message) {
    document.documentElement.innerHTML =
      '<head><meta charset="UTF-8"><title>Access restricted | Future Tech School Program</title></head>' +
      '<body style="font-family:sans-serif;background:#f5f7fb;">' +
      '<div style="max-width:480px;margin:90px auto;text-align:center;background:#fff;' +
      'padding:40px 30px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08);">' +
      '<h3 style="margin-bottom:10px;">Access restricted</h3>' +
      '<p style="color:#555;">' + message + '</p>' +
      '<a href="student-login.html" style="display:inline-block;margin-top:14px;padding:10px 24px;' +
      'background:#0d6efd;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">' +
      'Go to Student Login</a></div></body>';
  }

  if (!token) {
    blockAccess("Please log in to your student account to view this content.");
    return;
  }

  if (typeof FTApi === "undefined") {
    // config.js / api-client.js weren't loaded before this script.
    blockAccess("This page isn't configured correctly. Please contact support.");
    return;
  }

  window.FT_STUDENT_TOKEN = token;

  FTApi.studentMe(token)
    .then(function (student) {
      if (requiredLevel && student.programLevel !== requiredLevel) {
        blockAccess(
          "This content is for " + requiredLevel + " students. " +
          "Your account is registered for " + (student.programLevel || "a different level") + "."
        );
        return;
      }
      window.FT_STUDENT = student;
      document.dispatchEvent(new CustomEvent("ft-access-granted", { detail: student }));
    })
    .catch(function () {
      sessionStorage.removeItem(STUDENT_TOKEN_KEY);
      blockAccess("Your session has expired. Please log in again.");
    });
})();
