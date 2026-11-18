// Pre-paint (plan B5b, B5c): the first script in <head>, before any CSS
// paints. It sets data-theme, lang and dir on <html> from the two mirrors
// the app keeps in localStorage ("pcalc.theme", "pcalc.lang"), so there is
// no flash of the wrong theme or direction. IndexedDB (the real settings
// store) is asynchronous and cannot be read this early.
//
// Inline and pinned by its sha256 in the web and single-file CSPs; an
// external file on the desktop (whose CSP is script-src 'self'). Values
// from storage are only ever used as keys of the closed tables below.
(function () {
  "use strict";
  var root = document.documentElement;
  var THEMES = { system: 1, terminal: 1, daylight: 1, retro: 1 };
  var DIRS = {
    en: "ltr", ar: "rtl", es: "ltr", fr: "ltr", de: "ltr", "pt-BR": "ltr", it: "ltr",
    ru: "ltr", tr: "ltr", "zh-Hans": "ltr", ja: "ltr", ko: "ltr", "en-XA": "ltr", "ar-XB": "rtl"
  };
  var own = function (table, key) {
    return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key);
  };
  var pref = null;
  var lang = null;
  try {
    pref = window.localStorage.getItem("pcalc.theme");
    lang = window.localStorage.getItem("pcalc.lang");
  } catch (_) {
    // Storage blocked: the defaults below apply.
  }
  if (!own(THEMES, pref)) pref = "system";
  var theme = pref;
  if (theme === "system") {
    var light = false;
    try {
      light = window.matchMedia("(prefers-color-scheme: light)").matches;
    } catch (_) {
      light = false;
    }
    theme = light ? "daylight" : "terminal";
  }
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-pref", pref);
  if (own(DIRS, lang)) {
    root.setAttribute("lang", lang);
    root.setAttribute("dir", DIRS[lang]);
  }
})();
