// Settings and state documents (plan B11): the defaults and small helpers.
// The schemas are enforced by the engine (settings.validate,
// state.validate in crates/pcalc-api/src/store.rs); these defaults must
// pass them (scripts/safety-eval.mjs checks it through the real engine).
(function () {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: 1,
    checkUpdatesOnStartup: false,
    history: { enabled: true },
    display: { grouping: "comma" },
    calculator: { angleUnit: "deg", wordSize: "qword", base: "dec", shiftMode: "arithmetic" },
    date: {
      firstDayOfWeek: "monday",
      calendar: {},
      cardOrder: ["between", "add", "business", "age", "info", "countdown"],
      collapsedCards: []
    },
    percent: {
      cardOrder: ["change", "percent", "what", "discount", "base", "markup", "tax", "tip"],
      collapsedCards: []
    },
    appearance: { theme: "system" },
    language: { code: "auto", digits: "auto" }
  });

  const DEFAULT_STATE = Object.freeze({
    schemaVersion: 1,
    route: "standard",
    pane: { open: false, tab: "history" },
    dev: { pseudoLocale: "off" }
  });

  // A deep, mutable copy (documents are plain JSON).
  const copy = (value) => JSON.parse(JSON.stringify(value));

  // The document from a load outcome, or a fresh default copy.
  function fromOutcome(outcome, defaults) {
    if (outcome && outcome.status === "ok" && typeof outcome.doc === "string") {
      try {
        return JSON.parse(outcome.doc);
      } catch (_) {
        return copy(defaults);
      }
    }
    return copy(defaults);
  }

  window.PCalc.prefs = Object.freeze({ DEFAULT_SETTINGS, DEFAULT_STATE, copy, fromOutcome });
})();
