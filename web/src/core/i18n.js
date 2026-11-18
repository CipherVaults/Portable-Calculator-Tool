// Message formatting (plan B5c, M0 stub): flat catalog keys, {name}
// placeholders and CLDR plural categories from a hand-written table (no
// Intl, so every device formats identically). Plural messages are objects
// keyed by category ("zero", "one", "two", "few", "many", "other").
(function () {
  "use strict";

  // Integer-count plural rules for the 12 v1.0 languages (CLDR cardinals,
  // integer operands only; decimal operands arrive with M9a).
  function pluralCategory(lang, count) {
    const n = Math.abs(Math.trunc(Number(count)));
    if (!Number.isFinite(n)) return "other";
    const mod10 = n % 10;
    const mod100 = n % 100;
    switch (lang) {
      case "ar":
        if (n === 0) return "zero";
        if (n === 1) return "one";
        if (n === 2) return "two";
        if (mod100 >= 3 && mod100 <= 10) return "few";
        if (mod100 >= 11 && mod100 <= 99) return "many";
        return "other";
      case "ru":
        if (mod10 === 1 && mod100 !== 11) return "one";
        if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "few";
        return "many";
      case "fr":
      case "pt-BR":
        return n === 0 || n === 1 ? "one" : "other";
      case "zh-Hans":
      case "ja":
      case "ko":
        return "other";
      default:
        // en, es, de, it, tr
        return n === 1 ? "one" : "other";
    }
  }

  function fill(template, params) {
    return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name) =>
      params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
    );
  }

  // Returns t(key, params): the catalog text for `key` in `lang`, falling
  // back to English, then to the key itself (never markup, never throws).
  function create(catalogs, lang) {
    const primary = catalogs[lang] || {};
    const fallback = catalogs.en || {};
    return function t(key, params) {
      let msg = Object.prototype.hasOwnProperty.call(primary, key) ? primary[key] : fallback[key];
      if (msg === undefined || key.charAt(0) === "_") return key;
      if (typeof msg === "object" && msg !== null) {
        const count = params && params.count;
        const cat = pluralCategory(lang, count);
        msg = msg[cat] !== undefined ? msg[cat] : msg.other;
      }
      return typeof msg === "string" ? fill(msg, params) : key;
    };
  }

  window.PCalc.i18n = Object.freeze({ create, pluralCategory });
})();
