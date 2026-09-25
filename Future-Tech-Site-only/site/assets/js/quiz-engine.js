/**
 * FTQuiz - shared client-side scoring + results UI for the MCQ quiz pages
 * (level*-module*-quiz.html).
 *
 * Usage on a quiz page (after the questions markup, before </body>):
 *
 *   <script src="assets/js/quiz-engine.js"></script>
 *   <script>
 *     FTQuiz.init({
 *       formId: "quizForm",
 *       submitBtnId: "quizSubmitBtn",
 *       retakeBtnId: "quizRetakeBtn",
 *       nextBtnId: "quizNextBtn",
 *       resultBoxId: "quizResult",
 *       passPercent: 60,
 *       // Optional — if provided (and FTApi + a logged-in student token
 *       // are available on the page), the result is saved to the backend
 *       // via POST /api/quiz-results so it shows up in the student's
 *       // "Progress Tracking" on student-portal.html. Safe to omit; the
 *       // quiz still grades and displays a result locally either way.
 *       level: "level1",
 *       module: "module1",
 *       quizId: "module1-quiz",
 *       questions: [
 *         { name: "one", correct: "1" },
 *         { name: "two", correct: "2" },
 *         // ...one entry per question, in any order
 *       ]
 *     });
 *   </script>
 *
 * Markup expectations per question:
 *   <div class="ms-5 mb-3" data-question="one">
 *     <p class="mb-2 fs-5 fw-semibold">1. Question text</p>
 *     <div class="d-flex flex-column">
 *       <p><input type="radio" id="one-0" name="one" value="0"><label for="one-0">Option A</label></p>
 *       <p><input type="radio" id="one-1" name="one" value="1"><label for="one-1">Option B</label></p>
 *       ...
 *     </div>
 *   </div>
 *
 * Each radio's `value` is its 0-based option index; `correct` in the config
 * is that same index as a string, matching whichever option is right.
 */
const FTQuiz = (function () {
  function byId(id) {
    return document.getElementById(id);
  }

  function clearHighlights(form) {
    form.querySelectorAll("label").forEach(function (label) {
      label.classList.remove("text-success", "text-danger", "fw-bold");
    });
  }

  function init(config) {
    const form = byId(config.formId);
    const submitBtn = byId(config.submitBtnId);
    const retakeBtn = byId(config.retakeBtnId);
    const nextBtn = byId(config.nextBtnId);
    const resultBox = byId(config.resultBoxId);
    const passPercent = config.passPercent || 60;
    const questions = config.questions || [];

    if (!form || !submitBtn || !resultBox) {
      // Page isn't wired up correctly - fail quietly rather than break the page.
      return;
    }

    // Best-effort save to the backend so the score shows up in the
    // student's Progress Tracking. Never blocks or breaks the on-screen
    // result if the API is unreachable, the student is a guest, or the
    // page didn't configure level/module/quizId.
    function saveResultIfPossible(percent, correctCount, total, passed) {
      if (!config.level || !config.module) return;
      const token = window.FT_STUDENT_TOKEN;
      if (!token || typeof FTApi === "undefined" || !FTApi.saveQuizResult) return;

      FTApi.saveQuizResult(
        {
          level: config.level,
          module: config.module,
          quizId: config.quizId || "module-quiz",
          score: percent,
          correctCount: correctCount,
          totalQuestions: total,
          passed: passed,
        },
        token
      ).catch(function (err) {
        console.warn("Could not save quiz result to your account:", err.message);
      });
    }

    function showMessage(message, variant) {
      resultBox.className = "alert alert-" + variant + " mx-auto mt-4 text-center";
      resultBox.style.maxWidth = "700px";
      resultBox.textContent = message;
      resultBox.classList.remove("d-none");
    }

    function handleSubmit() {
      const unanswered = [];
      let correctCount = 0;

      clearHighlights(form);

      questions.forEach(function (q) {
        const checked = form.querySelector('input[name="' + q.name + '"]:checked');
        const wrapper = form.querySelector('[data-question="' + q.name + '"]');
        if (!checked) {
          unanswered.push(q.name);
          if (wrapper) wrapper.classList.add("border", "border-danger", "rounded", "p-2");
          return;
        }
        if (wrapper) wrapper.classList.remove("border", "border-danger", "rounded", "p-2");

        const isCorrect = checked.value === String(q.correct);
        if (isCorrect) correctCount++;

        const chosenLabel = form.querySelector('label[for="' + checked.id + '"]');
        if (chosenLabel) {
          chosenLabel.classList.add(isCorrect ? "text-success" : "text-danger", "fw-bold");
        }
        if (!isCorrect && wrapper) {
          const correctInput = wrapper.querySelector('input[value="' + q.correct + '"]');
          const correctLabel = correctInput && form.querySelector('label[for="' + correctInput.id + '"]');
          if (correctLabel) correctLabel.classList.add("text-success", "fw-bold");
        }
      });

      if (unanswered.length) {
        showMessage(
          "Please answer all questions before submitting (" + unanswered.length + " remaining).",
          "warning"
        );
        resultBox.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const total = questions.length;
      const percent = Math.round((correctCount / total) * 100);
      const passed = percent >= passPercent;

      resultBox.className = "ft-quiz-result mx-auto mt-4";
      resultBox.style.maxWidth = "700px";
      resultBox.innerHTML =
        '<div class="alert ' + (passed ? "alert-success" : "alert-danger") + ' text-center">' +
        "<h4 class=\"mb-2\">" + (passed ? "🎉 You Passed!" : "Keep Practicing") + "</h4>" +
        '<p class="mb-1 fs-5">Score: <strong>' + correctCount + " / " + total + "</strong> (" + percent + "%)</p>" +
        '<p class="mb-0">' +
        (passed
          ? "Great job! Correct answers are highlighted in green. You can move on to the practical section."
          : "You need at least " + passPercent + "% to pass. Correct answers are highlighted in green - review them and try again.") +
        "</p></div>";
      resultBox.classList.remove("d-none");

      saveResultIfPossible(percent, correctCount, total, passed);

      form.querySelectorAll('input[type="radio"]').forEach(function (input) {
        input.disabled = true;
      });
      submitBtn.classList.add("d-none");
      if (retakeBtn) retakeBtn.classList.remove("d-none");
      if (nextBtn && passed) nextBtn.classList.remove("d-none");

      resultBox.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function handleRetake() {
      form.reset();
      form.querySelectorAll('input[type="radio"]').forEach(function (input) {
        input.disabled = false;
      });
      form.querySelectorAll('[data-question]').forEach(function (wrapper) {
        wrapper.classList.remove("border", "border-danger", "rounded", "p-2");
      });
      clearHighlights(form);
      resultBox.classList.add("d-none");
      resultBox.innerHTML = "";
      submitBtn.classList.remove("d-none");
      if (retakeBtn) retakeBtn.classList.add("d-none");
      if (nextBtn) nextBtn.classList.add("d-none");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    submitBtn.addEventListener("click", function (e) {
      e.preventDefault();
      handleSubmit();
    });
    if (retakeBtn) retakeBtn.addEventListener("click", handleRetake);
  }

  return { init: init };
})();
