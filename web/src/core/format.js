// Number and date formatting tables (plan B5c). Built-in tables, not Intl,
// so results are identical on every device. Engines return plain values
// (decimal strings such as "-1234.5", ISO dates); the UI formats them here.
//
// Per language: decimal and group separators (with Arabic-Indic digits,
// Arabic uses ٫ and ٬), the default digits, the date pattern and the
// default first day of the week (monday or sunday, the two date-core
// supports). Month and weekday names are English for every language until
// the translated catalogs arrive (M9a); only the structure is per language.
//
// Input accepts both digit systems everywhere: normalizeDigits() maps
// Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits and the Arabic
// separators to ASCII.
(function () {
  "use strict";

  const NBSP = " ";
  const NNBSP = " ";
  const LOCALES = Object.freeze({
    en: { decimal: ".", group: ",", date: "{y}-{m}-{d}", firstDay: "monday" },
    ar: { decimal: ".", group: ",", arabicDecimal: "٫", arabicGroup: "٬", date: "{d}/{m}/{y}", firstDay: "sunday", digits: "arabic-indic" },
    es: { decimal: ",", group: ".", date: "{d}/{m}/{y}", firstDay: "monday" },
    fr: { decimal: ",", group: NNBSP, date: "{d}/{m}/{y}", firstDay: "monday" },
    de: { decimal: ",", group: ".", date: "{d}.{m}.{y}", firstDay: "monday" },
    "pt-BR": { decimal: ",", group: ".", date: "{d}/{m}/{y}", firstDay: "sunday" },
    it: { decimal: ",", group: ".", date: "{d}/{m}/{y}", firstDay: "monday" },
    ru: { decimal: ",", group: NBSP, date: "{d}.{m}.{y}", firstDay: "monday" },
    tr: { decimal: ",", group: ".", date: "{d}.{m}.{y}", firstDay: "monday" },
    "zh-Hans": { decimal: ".", group: ",", date: "{y}/{m}/{d}", firstDay: "monday" },
    ja: { decimal: ".", group: ",", date: "{y}/{m}/{d}", firstDay: "sunday" },
    ko: { decimal: ".", group: ",", date: "{y}. {m}. {d}.", firstDay: "sunday" }
  });
  const MONTHS = Object.freeze(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
  const WEEKDAYS = Object.freeze(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  const ARABIC_INDIC_ZERO = 0x0660;
  const EXTENDED_ZERO = 0x06f0;

  const locale = (lang) => LOCALES[lang === "en-XA" || lang === "ar-XB" ? "en" : lang] || LOCALES.en;

  // The digits to show: an explicit setting, or the language default.
  function digitsFor(lang, setting) {
    if (setting === "western" || setting === "arabic-indic") return setting;
    return locale(lang).digits || "western";
  }

  function toDigits(text, digits) {
    if (digits !== "arabic-indic") return text;
    return String(text).replace(/[0-9]/g, (d) => String.fromCharCode(ARABIC_INDIC_ZERO + Number(d)));
  }

  // Both digit systems to ASCII; Arabic separators to "." and ",".
  function normalizeDigits(text) {
    return String(text).replace(/[٠-٩۰-۹٫٬]/g, (ch) => {
      const c = ch.charCodeAt(0);
      if (c === 0x066b) return ".";
      if (c === 0x066c) return ",";
      return String(c >= EXTENDED_ZERO ? c - EXTENDED_ZERO : c - ARABIC_INDIC_ZERO);
    });
  }

  // Formats a plain decimal ("-1234.5", "0.25", "1e21" is refused and
  // returned unchanged) with the language's separators. grouping: "comma"
  // (the language's group separator), "thin" (a thin space) or "none".
  function formatNumber(value, lang, opts) {
    const o = opts || {};
    const text = typeof value === "number" ? String(value) : String(value);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) return text;
    const loc = locale(lang);
    const digits = digitsFor(lang, o.digits);
    const arabic = digits === "arabic-indic" && loc.arabicDecimal;
    const decimal = arabic ? loc.arabicDecimal : loc.decimal;
    const groupChar = o.grouping === "none" ? "" : o.grouping === "thin" ? " " : arabic ? loc.arabicGroup : loc.group;
    let int = m[2];
    if (groupChar) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupChar);
    const out = (m[1] ? "-" : "") + int + (m[3] !== undefined ? decimal + m[3] : "");
    return toDigits(out, digits);
  }

  // Formats {y, m, d} (or "YYYY-MM-DD") with the language's date pattern.
  function formatDate(date, lang, opts) {
    let y;
    let mo;
    let d;
    if (typeof date === "string") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) return date;
      [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    } else {
      ({ y, m: mo, d } = date);
    }
    const pad = (n, w) => String(n).padStart(w, "0");
    const text = locale(lang).date.replace("{y}", pad(y, 4)).replace("{m}", pad(mo, 2)).replace("{d}", pad(d, 2));
    return toDigits(text, digitsFor(lang, (opts || {}).digits));
  }

  // Wraps text in Unicode isolation (LRI ... PDI), so a number or a Latin
  // name keeps its left-to-right order inside right-to-left text.
  const isolate = (text) => "⁦" + text + "⁩";

  window.PCalc.format = Object.freeze({
    LOCALES,
    formatNumber,
    formatDate,
    digitsFor,
    toDigits,
    normalizeDigits,
    isolate,
    firstDayOfWeek: (lang) => locale(lang).firstDay,
    monthName: (m) => MONTHS[m - 1] || "",
    weekdayName: (isoDay) => WEEKDAYS[isoDay - 1] || "",
    // Bytes as "12.3 KB" / "4.0 MB" (decimal units), formatted per language.
    bytes: (n, lang, opts) => {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let v = Math.max(0, Number(n) || 0);
      let u = 0;
      while (v >= 1000 && u < units.length - 1) {
        v /= 1000;
        u++;
      }
      const text = u === 0 ? String(Math.round(v)) : v.toFixed(1);
      return formatNumber(text, lang, opts) + " " + units[u];
    }
  });
})();
