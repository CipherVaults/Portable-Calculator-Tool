// Message formatting (plan B5c). Catalogs are flat JSON files
// (web/i18n/<lang>.json); a message is text with {name} placeholders, or a
// plural object keyed by CLDR category ("zero", "one", "two", "few",
// "many", "other") chosen by the `count` parameter. No Intl and no
// dependency: the plural rules are a hand-written table for the 12 v1.0
// languages (CLDR cardinal rules, with the operands n, i, v, f), so every
// device chooses the same form. scripts/check-i18n.mjs unit-tests it.
//
// Two pseudo-locales exist for layout testing (Settings > Developer):
//   en-XA  English, accented and about 35% longer, in [brackets]
//   ar-XB  English forced right-to-left (bidi override), dir="rtl"
// Placeholder values are never altered; in ar-XB they are isolated LTR.
(function () {
  "use strict";

  const LANGUAGES = Object.freeze(["en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko"]);
  const PSEUDO = Object.freeze(["en-XA", "ar-XB"]);
  const RTL = new Set(["ar", "ar-XB"]);
  // Each language in its own script, for the language picker.
  const NATIVE_NAMES = Object.freeze({
    en: "English", ar: "العربية", es: "Español", fr: "Français", de: "Deutsch", "pt-BR": "Português (Brasil)",
    it: "Italiano", ru: "Русский", tr: "Türkçe", "zh-Hans": "简体中文", ja: "日本語", ko: "한국어",
    "en-XA": "English (pseudo, long)", "ar-XB": "English (pseudo, RTL)"
  });

  const CATEGORIES = Object.freeze({
    en: ["one", "other"], de: ["one", "other"], tr: ["one", "other"],
    es: ["one", "many", "other"], fr: ["one", "many", "other"], "pt-BR": ["one", "many", "other"], it: ["one", "many", "other"],
    ru: ["one", "few", "many", "other"],
    ar: ["zero", "one", "two", "few", "many", "other"],
    "zh-Hans": ["other"], ja: ["other"], ko: ["other"]
  });

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const baseLanguage = (lang) => (lang === "en-XA" || lang === "ar-XB" ? "en" : lang);

  // CLDR plural operands of a count given as a number or a decimal string
  // ("1.50" keeps v = 2). iText: the integer digits without leading zeros;
  // v: the number of visible fraction digits; integral: the fraction is
  // all zeros (so n is a whole number); i10, i100, i1e6: i % 10, % 100,
  // % 1000000 (taken from the digits, so long numbers stay exact).
  // Returns null for anything that is not a plain decimal.
  function operands(count) {
    let text;
    if (typeof count === "number") {
      if (!Number.isFinite(count)) return null;
      text = String(Math.abs(count));
      if (/e/i.test(text)) {
        if (!Number.isInteger(Math.abs(count))) return null;
        text = BigInt(Math.abs(count)).toString();
      }
    } else if (typeof count === "string") {
      text = count.trim().replace(/^[-+]/, "");
    } else {
      return null;
    }
    const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
    if (!m) return null;
    const iText = m[1].replace(/^0+(?=\d)/, "");
    const fDigits = m[2] || "";
    const tail = (k) => Number(iText.slice(-k));
    return { iText, i10: tail(1), i100: tail(2), i1e6: tail(6), v: fDigits.length, integral: /^0*$/.test(fDigits) };
  }

  // n = k for a small whole k (1.0 counts as 1, as in CLDR).
  const nIs = (o, k) => o.integral && o.iText === String(k);
  // i = k (the fraction does not matter).
  const iIs = (o, k) => o.iText === String(k);
  // "many" for es, fr, it, pt: e = 0 and i != 0 and i % 1000000 = 0 and v = 0.
  const millions = (o) => o.iText !== "0" && o.i1e6 === 0 && o.v === 0;

  // The CLDR cardinal category of `count` in `lang` ("other" when the
  // count is not a plain decimal).
  function pluralCategory(lang, count) {
    const o = operands(count);
    if (o === null) return "other";
    switch (baseLanguage(lang)) {
      case "ar": {
        // n % 100 = 3..10 and 11..99 hold for whole numbers only.
        const n100 = o.integral ? o.i100 : -1;
        if (nIs(o, 0)) return "zero";
        if (nIs(o, 1)) return "one";
        if (nIs(o, 2)) return "two";
        if (n100 >= 3 && n100 <= 10) return "few";
        if (n100 >= 11 && n100 <= 99) return "many";
        return "other";
      }
      case "ru":
        if (o.v !== 0) return "other";
        if (o.i10 === 1 && o.i100 !== 11) return "one";
        if (o.i10 >= 2 && o.i10 <= 4 && !(o.i100 >= 12 && o.i100 <= 14)) return "few";
        return "many";
      case "fr":
      case "pt-BR":
        // i = 0,1 (fr) and i = 0..1 (pt) are the same set.
        if (iIs(o, 0) || iIs(o, 1)) return "one";
        return millions(o) ? "many" : "other";
      case "es":
        if (nIs(o, 1)) return "one";
        return millions(o) ? "many" : "other";
      case "it":
        if (iIs(o, 1) && o.v === 0) return "one";
        return millions(o) ? "many" : "other";
      case "tr":
        return nIs(o, 1) ? "one" : "other";
      case "zh-Hans":
      case "ja":
      case "ko":
        return "other";
      default:
        // en, de: i = 1 and v = 0
        return iIs(o, 1) && o.v === 0 ? "one" : "other";
    }
  }

  function categories(lang) {
    return CATEGORIES[baseLanguage(lang)] || CATEGORIES.en;
  }

  // ---- pseudo-locales ------------------------------------------------------

  const ACCENTS = {
    a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
    n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "û", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
    A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
    N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž"
  };
  const FILLER = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

  // Splits a template into text and placeholder parts.
  function parts(template) {
    const out = [];
    let last = 0;
    for (const m of template.matchAll(PLACEHOLDER)) {
      if (m.index > last) out.push({ text: template.slice(last, m.index) });
      out.push({ name: m[1], raw: m[0] });
      last = m.index + m[0].length;
    }
    if (last < template.length) out.push({ text: template.slice(last) });
    return out;
  }

  function accent(text) {
    let out = "";
    for (const ch of text) out += own(ACCENTS, ch) ? ACCENTS[ch] : ch;
    return out;
  }

  // en-XA: accented text, padded with filler words to about +35%.
  function expand(text) {
    const target = Math.ceil(text.length * 0.35);
    const words = [];
    let len = 0;
    for (let k = 0; len < target; k++) {
      const w = FILLER[k % FILLER.length];
      words.push(w);
      len += w.length + 1;
    }
    return "[" + text + (words.length ? " " + words.join(" ") : "") + "]";
  }

  function fill(template, params, lang) {
    const value = (p) => (params && own(params, p.name) ? String(params[p.name]) : p.raw);
    const list = parts(template);
    if (lang === "en-XA") {
      const visible = list.map((p) => (p.text !== undefined ? accent(p.text) : value(p))).join("");
      return expand(visible);
    }
    if (lang === "ar-XB") {
      // Right-to-left override for the words, LTR isolates for the values.
      return "‮" + list.map((p) => (p.text !== undefined ? p.text : "⁦" + value(p) + "⁩")).join("") + "‬";
    }
    return list.map((p) => (p.text !== undefined ? p.text : value(p))).join("");
  }

  // Returns t(key, params): the catalog text for `key` in `lang`, falling
  // back to English, then to the key itself (never markup, never throws).
  // `lang` may be a pseudo-locale (it formats the English catalog).
  function create(catalogs, lang) {
    const base = baseLanguage(lang);
    const primary = catalogs[base] || {};
    const fallback = catalogs.en || {};
    const t = function t(key, params) {
      if (typeof key !== "string" || key.charAt(0) === "_") return String(key);
      let msg = own(primary, key) ? primary[key] : own(fallback, key) ? fallback[key] : undefined;
      if (msg === undefined) return key;
      if (typeof msg === "object" && msg !== null) {
        // `plural` (a number) picks the form when {count} shows formatted
        // text (grouped digits, Arabic-Indic digits, a dom.value mark).
        const by = params && own(params, "plural") ? params.plural : params ? params.count : undefined;
        const cat = pluralCategory(base, by);
        msg = own(msg, cat) ? msg[cat] : msg.other;
      }
      return typeof msg === "string" ? fill(msg, params, lang) : key;
    };
    t.lang = lang;
    t.dir = RTL.has(lang) ? "rtl" : "ltr";
    return t;
  }

  // The language to show: an explicit code, or "auto" resolved from the
  // browser's preferred languages against the catalogs that exist.
  function resolve(code, preferred, available) {
    const have = new Set(available);
    if (code !== "auto" && have.has(code)) return code;
    for (const raw of preferred || []) {
      const tag = String(raw);
      const lower = tag.toLowerCase();
      for (const lang of LANGUAGES) {
        if (!have.has(lang)) continue;
        const l = lang.toLowerCase();
        if (lower === l) return lang;
        if (lang === "zh-Hans" && /^zh(-(cn|sg|hans)\b|$)/.test(lower)) return lang;
        if (lang === "pt-BR" && /^pt(-br\b|$)/.test(lower)) return lang;
        if (lower.split("-")[0] === l && !l.includes("-")) return lang;
      }
    }
    return "en";
  }

  window.PCalc.i18n = Object.freeze({
    LANGUAGES, PSEUDO, NATIVE_NAMES,
    create, pluralCategory, categories, operands, resolve,
    dirOf: (lang) => (RTL.has(lang) ? "rtl" : "ltr"),
    parts
  });
})();
