// Themes (plan B5b): applies a preference (system, terminal, daylight,
// retro) to <html data-theme> at once, with no reload, and keeps the
// "pcalc.theme" localStorage mirror that the pre-paint script reads before
// the next first paint. "system" follows prefers-color-scheme live.
(function () {
  "use strict";
  const PREFS = Object.freeze(["system", "terminal", "daylight", "retro"]);
  const MIRROR = "pcalc.theme";
  const LANG_MIRROR = "pcalc.lang";
  let media = null;
  let current = "system";

  function systemTheme() {
    try {
      if (!media) media = window.matchMedia("(prefers-color-scheme: light)");
      return media.matches ? "daylight" : "terminal";
    } catch (_) {
      return "terminal";
    }
  }

  function resolve(pref) {
    return pref === "system" ? systemTheme() : pref;
  }

  function writeMirror(key, value) {
    try {
      if (window.localStorage.getItem(key) !== value) window.localStorage.setItem(key, value);
    } catch (_) {
      // Storage blocked: only the next first paint is affected.
    }
  }

  // Applies `pref` now; returns the concrete theme shown.
  function apply(pref) {
    current = PREFS.includes(pref) ? pref : "system";
    const theme = resolve(current);
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-pref", current);
    writeMirror(MIRROR, current);
    return theme;
  }

  // Follows the OS while the preference is "system".
  function watchSystem() {
    try {
      if (!media) media = window.matchMedia("(prefers-color-scheme: light)");
      media.addEventListener("change", () => {
        if (current === "system") apply("system");
      });
    } catch (_) {
      // No matchMedia events: the theme updates on the next launch.
    }
  }

  // lang and dir on <html>, plus the pre-paint mirror.
  function applyLanguage(lang, dir) {
    const root = document.documentElement;
    root.setAttribute("lang", lang);
    root.setAttribute("dir", dir);
    writeMirror(LANG_MIRROR, lang);
  }

  window.PCalc.theme = Object.freeze({ PREFS, MIRROR, LANG_MIRROR, apply, resolve, watchSystem, applyLanguage, current: () => current });
})();
