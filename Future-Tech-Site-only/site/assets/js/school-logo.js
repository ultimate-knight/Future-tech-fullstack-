/**
 * Shows the logged-in user's OWN school logo at the top-right corner of the
 * header (the Future Tech logo stays top-left).
 *
 *   - logged-in school  -> that school's logo
 *   - logged-in student -> the logo of the school the student belongs to
 *   - nobody logged in / school has no logo -> nothing is shown
 *
 * The logo is fetched with fetch() and shown as a blob, exactly like the
 * School Portal does. (A plain <img src> to the API is blocked by the
 * backend's cross-origin header when the site and API run on different
 * ports/domains, which is what made the logo show as a broken image.)
 * The image is only added to the page after it has loaded, so there is no
 * flash of an empty box.
 *
 * Needs config.js and api-client.js loaded first.
 * Add the attribute  data-manual  to the script tag to skip auto-detection
 * and call  FTSchoolLogo.forStudent(student)  /  forSchool(account)  yourself.
 */
(function () {
  var SCHOOL_KEY = "ft_backend_school_token";
  var STUDENT_KEY = "ft_backend_student_token";
  var used = false;

  function place(blobUrl, name) {
    if (document.querySelector(".ft-school-logo")) return;
    var bar = document.querySelector(".ft-navbar .container-fluid");
    if (!bar) return;

    function make(cls) {
      var img = document.createElement("img");
      img.className = "ft-school-logo rounded-3 bg-white p-1 " + cls;
      img.width = 100;
      img.height = 100;
      img.style.objectFit = "contain";
      img.alt = (name ? name + " " : "School ") + "logo";
      img.src = blobUrl;
      return img;
    }

    var toggler = bar.querySelector(".navbar-toggler");
    var collapse = bar.querySelector(".navbar-collapse");
    var hasMenu = collapse && collapse.querySelector(".navbar-nav");

    if (hasMenu) {
      // Full menu header (home page): desktop copy at the far right of the
      // menu, phone/tablet copy next to the menu button.
      var small = make("d-xl-none ms-auto me-3");
      bar.insertBefore(small, toggler || collapse);
      collapse.appendChild(make("d-none d-xl-block ms-4"));
    } else {
      var one = make("ms-auto me-3 me-xl-0");
      if (toggler) bar.insertBefore(one, toggler);
      else bar.appendChild(one);
    }
  }

  function load(schoolId, name) {
    var base = https://future-tech-fullstack-7.onrender.com/;
    if (used || !schoolId) return;
    used = true;
    fetch(base + "/content/school-logo/" + encodeURIComponent(schoolId), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("no logo"); return r.blob(); })
      .then(function (b) { place(URL.createObjectURL(b), name); })
      .catch(function () { used = false; /* no logo - show nothing */ });
  }

  function forStudent(s) { if (s && s.hasSchoolLogo && s.schoolId) load(s.schoolId, ""); }
  function forSchool(a) { if (a && a.hasLogo && a.id) load(a.id, a.schoolName); }

  window.FTSchoolLogo = { forStudent: forStudent, forSchool: forSchool };

  if (document.currentScript && document.currentScript.hasAttribute("data-manual")) return;

  // Pages protected by level-guard.js hand us the student when access is granted.
  document.addEventListener("ft-access-granted", function (e) { onReady(function () { forStudent(e.detail); }); });

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  onReady(function () {
    if (window.FT_STUDENT) return forStudent(window.FT_STUDENT);
    if (window.FT_REQUIRED_LEVEL) return; // guard page: wait for the event above
    if (typeof FTApi === "undefined") return;
    try {
      var st = sessionStorage.getItem(STUDENT_KEY);
      var sc = sessionStorage.getItem(SCHOOL_KEY);
      if (st) FTApi.studentMe(st).then(forStudent).catch(function () {});
      else if (sc) FTApi.schoolMe(sc).then(forSchool).catch(function () {});
    } catch (e) { /* storage unavailable - no logo */ }
  });
})();
