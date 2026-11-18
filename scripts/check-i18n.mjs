#!/usr/bin/env node
// Catalog and formatter checks (plan B5c). No dependencies.
//
// Catalogs (web/i18n/<lang>.json for every language in the build manifest):
//   keys          every key of en.json exists in every catalog, and no
//                 catalog has a key en.json lacks; _meta has language, dir
//                 (ltr|rtl) and reviewed (boolean)
//   placeholders  each message uses exactly the {placeholders} of the
//                 English source (plural forms: each form a subset, all
//                 forms together the same set)
//   plurals       a plural message has exactly the CLDR categories of its
//                 language (web/src/core/i18n.js) and uses {count}
//   markup        no <, > or &entity; in any text, no control characters
//   unused        every key is used by the web sources: a string literal
//                 equal to the key, or starting with a dynamic prefix the
//                 sources build keys from (a literal ending in "." that is
//                 followed by +). Every key passed to t("…") exists.
// Units (web/src/core/i18n.js and web/src/core/format.js run in a VM):
//   the plural table for all 12 languages on CLDR sample values (integers,
//   decimals with visible zeros, millions, long digit strings), operands,
//   placeholder filling, fallback to English, the en-XA and ar-XB
//   pseudo-locales, language resolution, number separators per language,
//   Arabic-Indic digits, digit normalisation, date patterns and RTL
//   isolation.
//
//   node scripts/check-i18n.mjs [--web <dir>] [--json <path>]
//
// scripts/safety-eval.mjs (slice D) proves each catalog rule fires on a mutant.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- loading the browser modules in a VM -------------------------------------

// `overrides` maps a source path to replacement text (safety-eval mutants).
export function loadModules(web, overrides = {}) {
  const window = { PCalc: {} };
  const context = vm.createContext({ window, console, BigInt, Math, Number, String, Object, Array, Set, Map, JSON, RegExp, Error });
  for (const rel of ["src/core/i18n.js", "src/core/format.js"]) {
    const text = Object.prototype.hasOwnProperty.call(overrides, rel) ? overrides[rel] : readFileSync(join(web, rel), "utf8");
    vm.runInContext(text, context, { filename: rel });
  }
  return window.PCalc;
}

// ---- catalog rules -----------------------------------------------------------

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const placeholders = (text) => new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function forms(value) {
  return typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value) : [];
}

export function catalogProblems(catalogs, categories) {
  const problems = [];
  const en = catalogs.en;
  if (!en) return ["the en catalog is missing"];
  for (const [lang, cat] of Object.entries(catalogs)) {
    const meta = cat._meta;
    if (!meta || typeof meta.language !== "string" || !["ltr", "rtl"].includes(meta.dir) || typeof meta.reviewed !== "boolean") {
      problems.push(`${lang}: _meta needs language, dir (ltr|rtl) and reviewed (boolean)`);
    }
    for (const key of Object.keys(en)) if (key !== "_meta" && !(key in cat)) problems.push(`${lang}: missing key ${key}`);
    for (const key of Object.keys(cat)) if (key !== "_meta" && !(key in en)) problems.push(`${lang}: key ${key} is not in en.json`);
    for (const [key, value] of Object.entries(cat)) {
      if (key === "_meta") continue;
      if (!/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/.test(key)) problems.push(`${lang}: key ${key} is not a dotted catalog key`);
      const list = forms(value);
      if (typeof value !== "string") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          problems.push(`${lang}: ${key} is neither text nor a plural object`);
          continue;
        }
        const want = categories(lang);
        const have = Object.keys(value);
        if (!sameSet(new Set(have), new Set(want))) problems.push(`${lang}: ${key} has plural forms ${have.join(",")}, want ${want.join(",")}`);
        if (!list.some((f) => typeof f === "string" && placeholders(f).has("count"))) problems.push(`${lang}: plural ${key} never uses {count}`);
      }
      for (const f of list) {
        if (typeof f !== "string") {
          problems.push(`${lang}: ${key} has a form that is not text`);
          continue;
        }
        if (/[<>]|&[a-zA-Z#][a-zA-Z0-9]*;/.test(f)) problems.push(`${lang}: ${key} contains markup`);
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f]/.test(f)) problems.push(`${lang}: ${key} contains a control character`);
      }
      const enValue = en[key];
      if (enValue === undefined) continue;
      const enSet = new Set(forms(enValue).flatMap((f) => (typeof f === "string" ? [...placeholders(f)] : [])));
      const all = new Set(list.flatMap((f) => (typeof f === "string" ? [...placeholders(f)] : [])));
      if (!sameSet(all, enSet)) problems.push(`${lang}: ${key} placeholders {${[...all].join("},{")}} differ from en {${[...enSet].join("},{")}}`);
      for (const f of list) {
        if (typeof f === "string" && [...placeholders(f)].some((p) => !enSet.has(p))) problems.push(`${lang}: ${key} uses a placeholder en does not have`);
      }
    }
  }
  return problems;
}

// Keys the sources use: literal keys and dynamic prefixes.
export function usageProblems(en, sourceTexts) {
  const problems = [];
  const literals = new Set();
  const prefixes = new Set();
  const called = new Set();
  for (const text of sourceTexts) {
    for (const m of text.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)*\.?)"/g)) literals.add(m[1]);
    for (const m of text.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)*\.)"\s*\+/g)) prefixes.add(m[1]);
    for (const m of text.matchAll(/\bt{1,2}(?:\(\))?\(\s*"([^"]+)"/g)) called.add(m[1]);
  }
  for (const key of Object.keys(en)) {
    if (key === "_meta") continue;
    if (literals.has(key)) continue;
    if ([...prefixes].some((p) => key.startsWith(p))) continue;
    problems.push(`en: unused key ${key}`);
  }
  for (const key of called) if (!key.endsWith(".") && !(key in en)) problems.push(`sources call t("${key}") but en.json has no such key`);
  return problems;
}

// ---- unit tests ---------------------------------------------------------------

export function unitResults(P) {
  const results = [];
  const eq = (name, got, want) => results.push({ name, ok: Object.is(got, want) || got === want, got, want });
  const { pluralCategory: cat, categories, operands, create, resolve: res } = P.i18n;

  const PLURALS = {
    en: [[1, "one"], [0, "other"], [2, "other"], ["1.0", "other"], [1.5, "other"], [21, "other"]],
    de: [[1, "one"], ["1.0", "other"], [0, "other"], [101, "other"]],
    tr: [[1, "one"], ["1.0", "one"], [0, "other"], [2, "other"]],
    es: [[1, "one"], ["1.0", "one"], [0, "other"], [2, "other"], [1000000, "many"], [2000000, "many"], [1000001, "other"], ["1000000.0", "other"],
      ["1000000000000000000001", "other"], ["5000000000000000000000000", "many"], [1e21, "many"]],
    fr: [[0, "one"], [1, "one"], [1.5, "one"], ["0.5", "one"], [2, "other"], [1000000, "many"], [1000002, "other"]],
    "pt-BR": [[0, "one"], [1, "one"], [1.75, "one"], [2, "other"], [1000000, "many"], [10, "other"]],
    it: [[1, "one"], ["1.0", "other"], [0, "other"], [1000000, "many"], [11, "other"]],
    ru: [[1, "one"], [21, "one"], [101, "one"], [11, "many"], [111, "many"], [2, "few"], [22, "few"], [24, "few"], [12, "many"], [14, "many"],
      [5, "many"], [0, "many"], [100, "many"], [1.5, "other"], ["2.0", "other"]],
    ar: [[0, "zero"], [1, "one"], [2, "two"], [3, "few"], [10, "few"], [103, "few"], [110, "few"], [11, "many"], [99, "many"], [111, "many"],
      [100, "other"], [101, "other"], [102, "other"], [1.5, "other"], ["3.0", "few"], ["0.0", "zero"], ["1.0", "one"], ["2.5", "other"]],
    "zh-Hans": [[0, "other"], [1, "other"], [2, "other"], [1.5, "other"]],
    ja: [[1, "other"], [1000000, "other"]],
    ko: [[1, "other"], [2, "other"]]
  };
  for (const [lang, cases] of Object.entries(PLURALS)) {
    for (const [n, want] of cases) eq(`plural ${lang} ${JSON.stringify(n)}`, cat(lang, n), want);
    // Every category the language declares is reached by some sample.
    const reached = new Set(cases.map(([n]) => cat(lang, n)));
    eq(`plural ${lang} reaches every category`, categories(lang).every((c) => reached.has(c)), true);
  }
  eq("plural NaN is other", cat("en", NaN), "other");
  eq("plural Infinity is other", cat("ar", Infinity), "other");
  eq("plural junk is other", cat("ar", "3 apples"), "other");
  eq("plural negative uses the absolute value", cat("ru", -21), "one");
  eq("plural pseudo-locale uses en", cat("en-XA", 1), "one");
  eq("operands of 1.50: v", operands("1.50").v, 2);
  eq("operands of 007: i", operands("007").iText, "7");
  eq("operands of 1e21: digits", operands(1e21).iText, "1000000000000000000000");
  eq("operands of 1e-7 refused", operands(1e-7), null);

  const catalogs = {
    en: { "a.b": "Hello {name}", "a.c": { one: "{count} item", other: "{count} items" }, "a.d": "Only English", "a.e": "100% {x} {y}" },
    ar: { "a.b": "مرحبا {name}", "a.c": { zero: "لا عناصر", one: "عنصر واحد", two: "عنصران", few: "{count} عناصر", many: "{count} عنصرًا", other: "{count} عنصر" } }
  };
  const t = create(catalogs, "en");
  eq("fill", t("a.b", { name: "Ada" }), "Hello Ada");
  eq("fill keeps an unknown placeholder", t("a.b", {}), "Hello {name}");
  eq("fill values are not re-expanded", t("a.b", { name: "{count}" }), "Hello {count}");
  eq("plural one", t("a.c", { count: 1 }), "1 item");
  eq("plural other", t("a.c", { count: 2 }), "2 items");
  eq("missing key returns the key", t("a.zzz"), "a.zzz");
  eq("_meta keys are never shown", t("_meta"), "_meta");
  eq("t has lang and dir", t.lang + " " + t.dir, "en ltr");
  const ta = create(catalogs, "ar");
  eq("ar plural zero", ta("a.c", { count: 0 }), "لا عناصر");
  eq("ar plural few", ta("a.c", { count: 5 }), "5 عناصر");
  eq("ar plural many", ta("a.c", { count: 11 }), "11 عنصرًا");
  eq("ar falls back to en per key", ta("a.d"), "Only English");
  eq("ar is rtl", ta.dir, "rtl");

  const xa = create(catalogs, "en-XA");
  const long = xa("a.d");
  const accented = long.slice(1, 1 + "Only English".length);
  eq("en-XA brackets", long.startsWith("[") && long.endsWith("]"), true);
  eq("en-XA accents every letter", /[A-Za-z]/.test(accented), false);
  eq("en-XA is at least 35% longer", long.length >= Math.ceil("Only English".length * 1.35), true);
  eq("en-XA keeps values unchanged", xa("a.b", { name: "Ada 0.1.0" }).includes("Ada 0.1.0"), true);
  eq("en-XA plural uses en rules", xa("a.c", { count: 1 }).includes("1"), true);
  const xb = create(catalogs, "ar-XB");
  const rtl = xb("a.b", { name: "Ada" });
  eq("ar-XB right-to-left override", rtl.startsWith("‮") && rtl.endsWith("‬"), true);
  eq("ar-XB isolates values left-to-right", rtl.includes("⁦Ada⁩"), true);
  eq("ar-XB is rtl", xb.dir, "rtl");

  eq("resolve explicit", res("en", ["de"], ["en"]), "en");
  eq("resolve auto from browser", res("auto", ["ar-EG", "en"], ["en", "ar"]), "ar");
  eq("resolve auto zh-CN", res("auto", ["zh-CN"], ["en", "zh-Hans"]), "zh-Hans");
  eq("resolve auto pt", res("auto", ["pt"], ["en", "pt-BR"]), "pt-BR");
  eq("resolve auto unknown falls back to en", res("auto", ["xx-YY"], ["en"]), "en");
  eq("resolve explicit but missing catalog", res("de", [], ["en"]), "en");

  const F = P.format;
  const n = "1234567.89";
  eq("number en", F.formatNumber(n, "en"), "1,234,567.89");
  eq("number en negative", F.formatNumber("-1234", "en"), "-1,234");
  eq("number en small", F.formatNumber("123", "en"), "123");
  eq("number grouping none", F.formatNumber(n, "en", { grouping: "none" }), "1234567.89");
  eq("number grouping thin", F.formatNumber(n, "en", { grouping: "thin" }), "1 234 567.89");
  eq("number de", F.formatNumber(n, "de"), "1.234.567,89");
  eq("number es", F.formatNumber(n, "es"), "1.234.567,89");
  eq("number fr", F.formatNumber(n, "fr"), "1 234 567,89");
  eq("number ru", F.formatNumber(n, "ru"), "1 234 567,89");
  eq("number ja", F.formatNumber(n, "ja"), "1,234,567.89");
  eq("number ar default digits", F.formatNumber(n, "ar"), "١٬٢٣٤٬٥٦٧٫٨٩");
  eq("number ar western digits", F.formatNumber(n, "ar", { digits: "western" }), "1,234,567.89");
  eq("number en arabic-indic digits", F.formatNumber(n, "en", { digits: "arabic-indic" }), "١,٢٣٤,٥٦٧.٨٩");
  eq("number not a decimal is unchanged", F.formatNumber("1e21", "de"), "1e21");
  eq("digits default en", F.digitsFor("en", "auto"), "western");
  eq("digits default ar", F.digitsFor("ar", "auto"), "arabic-indic");
  eq("normalize Arabic-Indic", F.normalizeDigits("١٢٣٫٤٥"), "123.45");
  eq("normalize Extended Arabic-Indic", F.normalizeDigits("۱۲۳"), "123");
  eq("normalize Arabic group", F.normalizeDigits("١٬٠٠٠"), "1,000");
  eq("normalize leaves ASCII", F.normalizeDigits("2+2=4"), "2+2=4");
  eq("round trip ar", F.normalizeDigits(F.formatNumber(n, "ar")), "1,234,567.89");
  eq("date en (ISO)", F.formatDate("2026-11-18", "en"), "2026-11-18");
  eq("date ar", F.formatDate("2026-11-18", "ar"), "١٨/١١/٢٠٢٦");
  eq("date ar western", F.formatDate("2026-11-18", "ar", { digits: "western" }), "18/11/2026");
  eq("date fr", F.formatDate({ y: 2026, m: 1, d: 5 }, "fr"), "05/01/2026");
  eq("date de", F.formatDate("2026-11-18", "de"), "18.11.2026");
  eq("date ja", F.formatDate("2026-11-18", "ja"), "2026/11/18");
  eq("date ko", F.formatDate("2026-11-18", "ko"), "2026. 11. 18.");
  eq("date year padding", F.formatDate({ y: 5, m: 1, d: 1 }, "en"), "0005-01-01");
  eq("first day ar", F.firstDayOfWeek("ar"), "sunday");
  eq("first day de", F.firstDayOfWeek("de"), "monday");
  eq("month name", F.monthName(11), "November");
  eq("weekday name (ISO)", F.weekdayName(7), "Sunday");
  eq("isolate", F.isolate("12"), "⁦12⁩");
  eq("bytes", F.bytes(73700, "en"), "73.7 KB");
  eq("bytes de", F.bytes(6900000000, "de"), "6,9 GB");
  return results;
}

// ---- main ------------------------------------------------------------------------

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (name.endsWith(".js")) yield p;
  }
}

function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? resolve(args[i + 1]) : null;
  };
  const web = opt("--web") || join(ROOT, "web");
  const jsonPath = opt("--json");
  const manifest = JSON.parse(readFileSync(join(web, "build-manifest.json"), "utf8"));
  const catalogs = {};
  for (const lang of manifest.catalogs) catalogs[lang] = JSON.parse(readFileSync(join(web, "i18n", `${lang}.json`), "utf8"));
  for (const name of readdirSync(join(web, "i18n"))) {
    const lang = name.replace(/\.json$/, "");
    if (!(lang in catalogs)) catalogs[lang] = JSON.parse(readFileSync(join(web, "i18n", name), "utf8"));
  }
  const P = loadModules(web);
  const problems = [
    ...catalogProblems(catalogs, P.i18n.categories),
    ...usageProblems(catalogs.en, [...jsFiles(join(web, "src"))].map((p) => readFileSync(p, "utf8")))
  ];
  const units = unitResults(P);
  const failedUnits = units.filter((u) => !u.ok);
  for (const p of problems) console.log(`FAIL ${p}`);
  for (const u of failedUnits) console.log(`FAIL unit ${u.name}: got ${JSON.stringify(u.got)}, want ${JSON.stringify(u.want)}`);
  const keys = Object.keys(catalogs.en).length - 1;
  console.log(`catalogs: ${Object.keys(catalogs).join(", ")} (${keys} keys); units: ${units.length - failedUnits.length}/${units.length} passed`);
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ problems, units }, null, 2) + "\n");
  }
  const ok = problems.length === 0 && failedUnits.length === 0;
  console.log(ok ? "check-i18n: OK" : "check-i18n: FAILED");
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && existsSync(ROOT)) main();
