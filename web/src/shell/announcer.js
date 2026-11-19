// One polite live region per tool for its results (plan B16: the result is
// announced on "=" only). The result boxes themselves are not live: they
// change on every keystroke and a screen reader would read each
// intermediate answer. A tool says its result here:
//   now(read)    on Calculate or Enter
//   soon(read)   after typing, once it has paused for PAUSE_MS
//   say(text)    a fixed message ("All cards cleared.")
// never on mount, a tick or a keystroke. `read` is called when the words
// are due, so they are the result shown then; "" says nothing.
(function () {
  "use strict";
  const ns = window.PCalc;
  const PAUSE_MS = 750;

  function create(region) {
    let timer = 0;

    function say(text) {
      const words = String(text || "").trim();
      if (!words || !region) return;
      // The same words again are still a change (a no-break space toggles).
      region.textContent = region.textContent === words ? words + " " : words;
    }
    function cancel() {
      if (timer) window.clearTimeout(timer);
      timer = 0;
    }
    function soon(read) {
      cancel();
      timer = window.setTimeout(() => {
        timer = 0;
        say(read());
      }, PAUSE_MS);
    }
    function now(read) {
      cancel();
      say(read());
    }
    return { say, soon, now, cancel };
  }

  // The words of a result box: its main line, its other lines or its error.
  function resultWords(box) {
    if (!box) return "";
    return Array.from(box.querySelectorAll(".result-main, .result-sub, .error-text")).map((n) => n.textContent.trim()).filter(Boolean).join(". ");
  }

  ns.announcer = Object.freeze({ PAUSE_MS, create, resultWords });
})();
