// safety-eval slices B and C for the Percentage tool (M2c), ported from
// Percentage Calculator Tool v2.3.0's behaviour (the eight cards, swap,
// tax mode, tip presets, paste cleaning, history on Calculate / Enter /
// Copy, layout) onto the shell: the real web sources and the real
// engine.wasm in the mini-DOM (scripts/lib/mini-dom.mjs), under the web
// adapter (IndexedDB) and the desktop adapter (a fake Tauri bridge), with
// a fixed clock.
//
//   B.percent-*  the cards' live results, formulas and result lines (and
//                their parity with the engine's own label / liveResult /
//                copyText), no markup ever interpreted from the engine's
//                "<br>" labels, errors and out-of-range, swap, presets and
//                people, tax mode, paste cleaning, an IPC race, the history
//                hook, the session model, the layout and its Reset, the
//                desktop adapter, results spoken once, text fields with
//                Arabic-Indic digits and LTR runs, Clear all on a phone
//   C.percent-*  settings.percent in the "settings" document: the layout a
//                launch restores, and a read-only document never written
// Each rule has a mutant in PERCENT_MUTANTS that the same test must catch.
import { createOrigin, tick, until } from "./mini-dom.mjs";
import { bootApp, fakeTauri } from "./web-harness.mjs";

const NOW = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
const KEYS = ["change", "percent", "what", "discount", "base", "markup", "tax", "tip"];
const TOOL = "src/tools/percent/percent-tool.js";

function input(app, id, value) {
  const n = app.byId(id);
  n.value = value;
  n.dispatchEvent(new app.window.Event("input"));
}

const settle = async (app) => {
  await app.PCalc.percentTool.ready();
  await tick(60);
};
const text = (app, id) => (app.byId(id) ? app.byId(id).textContent : null);
const attr = (n, a) => (n ? n.getAttribute(a) : null);
// The result box's lines (main, then subs), as shown.
const lines = (app, key) => app.byId(key + "Result").children.filter((c) => /result-(main|sub)/.test(c.className)).map((c) => c.textContent);
const formula = (app, key) => app.byId(key + "Formula").children.map((li) => li.textContent);
const order = (app) => app.byId("percentCards").children.map((c) => c.getAttribute("data-card")).join(",");

// Every card filled with the PCT examples.
const FILL = [
  ["changeOrig", "150"], ["changeNew", "180"], ["isWhatX", "50"], ["isWhatY", "200"], ["whatX", "20"], ["whatY", "500"],
  ["discountPrice", "79.99"], ["discountPercent", "20"], ["baseX", "50"], ["baseY", "25"], ["markupCost", "80"], ["markupPrice", "100"],
  ["taxAmount", "100"], ["taxRate", "15"], ["tipBill", "100"], ["tipPercent", "20"], ["tipPeople", "3"]
];
async function fillAll(app) {
  for (const [id, v] of FILL) input(app, id, v);
  await until(() => KEYS.every((k) => text(app, k + "Live") !== "→ —"), 3000);
  await tick(80);
}

async function engineResult(app, op, req) {
  const r = JSON.parse(await app.PCalc.platforms.web.engine(op, JSON.stringify(req)));
  return r.ok === "true" ? r.result : r;
}

// ---------------------------------------------------------------------------
// Slice B
// ---------------------------------------------------------------------------

export function percentBTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/percent", ...o });

  return {
    async "percent-cards-live"(src) {
      // Eight cards, each idle at first, then the PCT v2.3.0 results for
      // its examples: live line, result lines and the filled-in formula.
      const app = await boot({ overrides: src });
      await settle(app);
      const cards = app.document.querySelectorAll(".tool-card").length === 8 && order(app) === KEYS.join();
      const idle = KEYS.every((k) => text(app, k + "Live") === "→ —" && text(app, k + "Result") === "=—");
      const idleFormula = formula(app, "markup").join(" | ") === "profit = price − cost | markup = (profit / cost) × 100 | margin = (profit / price) × 100";
      await fillAll(app);
      const got = Object.fromEntries(KEYS.map((k) => [k, { live: text(app, k + "Live"), lines: lines(app, k), formula: formula(app, k) }]));
      const want = {
        change: ["→ 20.00% increase", ["20.00% increase"], ["((180 − 150) / 150) × 100"]],
        percent: ["→ 25.00%", ["25.00%"], ["(50 / 200) × 100"]],
        what: ["→ 100.00", ["100.00"], ["(20 / 100) × 500"]],
        discount: ["→ final: 63.99 | saved: 16.00", ["Final: 63.99", "Saved: 16.00"], ["final = 79.99 × (1 − 20/100) = 63.99", "saved = 79.99 × 20/100 = 16.00"]],
        base: ["→ 200.00", ["200.00"], ["50 / (25 / 100)"]],
        markup: ["→ Profit: 20.00 | Markup: 25.00% | Margin: 20.00%", ["Profit: 20.00", "Markup: 25.00% · Margin: 20.00%"],
          ["profit = 100 − 80 = 20.00", "markup = (20.00 / 80) × 100 = 25.00%", "margin = (20.00 / 100) × 100 = 20.00%"]],
        tax: ["→ Total: 115.00 | Tax: 15.00", ["Total: 115.00", "Tax: 15.00 (Net: 100.00)"], ["tax = 100 × (15 / 100) = 15.00", "total = 100 + 15.00 = 115.00"]],
        tip: ["→ Each: 40.00 · Total: 120.00", ["Each: 40.00", "Total: 120.00 · Tip: 20.00"],
          ["Tip = 100 × (20 / 100) = 20.00", "Total = 100 + 20.00 = 120.00", "Each (÷3) = 120.00 / 3 = 40.00"]]
      };
      const bad = KEYS.filter((k) => got[k].live !== want[k][0] || got[k].lines.join("|") !== want[k][1].join("|") || got[k].formula.join("|") !== want[k][2].join("|"));
      // A negative number in a formula is parenthesised (PCT fmtFormulaNum).
      input(app, "changeOrig", "-50");
      await until(() => text(app, "changeLive") !== "→ 20.00% increase", 2000);
      const negative = formula(app, "change")[0] === "((180 − (-50)) / (-50)) × 100" && text(app, "changeLive") === "→ 460.00% decrease";
      const ok = cards && idle && idleFormula && bad.length === 0 && negative;
      return { ok, detail: JSON.stringify({ cards, idle, idleFormula, bad: bad.map((k) => ({ k, ...got[k] })), negative }) };
    },

    async "percent-text-parity"(src) {
      // The lines this view builds from the engine's structured fields are
      // the engine's own text: result lines joined by "<br>" equal its
      // label, the live line its liveResult (Discount: PCT's own
      // "final: … | saved: …"), the copy its copyText; in both tax modes.
      const app = await boot({ overrides: src, seed: (w) => { w.navigator.clipboard = { writeText: async () => undefined }; } });
      await settle(app);
      await fillAll(app);
      const checks = [];
      const compare = async (key, op, req) => {
        const r = await engineResult(app, op, req);
        const live = key === "discount" ? `→ final: ${r.finalText} | saved: ${r.savedText}` : "→ " + r.liveResult;
        app.byId(key + "CalcBtn").click();
        await tick(60);
        const entry = app.PCalc.history.recorded().pop();
        checks.push({ key, label: lines(app, key).join("<br>") === r.label, live: text(app, key + "Live") === live, copy: entry && entry.copyText === (typeof r.copyText === "string" ? r.copyText : r.label) });
      };
      await compare("change", "percent.change", { originalValue: 150, newValue: 180 });
      await compare("discount", "percent.discount", { price: 79.99, discountPercent: 20 });
      await compare("markup", "percent.markup", { cost: 80, sellingPrice: 100 });
      await compare("tax", "percent.tax", { amount: 100, ratePercent: 15, mode: "add" });
      await compare("tip", "percent.tip", { bill: 100, tipPercent: 20, people: 3 });
      app.byId("taxMode-extract").click();
      await until(() => lines(app, "tax")[0] === "Net: 86.96", 2000);
      await compare("tax", "percent.tax", { amount: 100, ratePercent: 15, mode: "extract" });
      // Every error field's wording is the engine's message.
      const errs = [
        ["percent.change", { originalValue: 0, newValue: 1 }, "originalValue"], ["percent.percent", { part: 1, total: 0 }, "total"],
        ["percent.base", { value: 1, percent: 0 }, "percent"], ["percent.markup", { cost: 0, sellingPrice: 1 }, "cost"],
        ["percent.markup", { cost: 1, sellingPrice: 0 }, "sellingPrice"], ["percent.tax", { amount: 1, ratePercent: -100, mode: "extract" }, "ratePercent"],
        ["percent.tip", { bill: -1, tipPercent: 1, people: 1 }, "bill"], ["percent.tip", { bill: 1, tipPercent: -1, people: 1 }, "tipPercent"],
        ["percent.tip", { bill: 1, tipPercent: 1, people: 0 }, "people"]
      ];
      const catalog = app.PCalc.catalogs.en;
      const errBad = [];
      for (const [op, req, field] of errs) {
        const r = await engineResult(app, op, req);
        if (!(r.ok === "false" && r.error.field === field && catalog["percent.error." + field] === r.error.message)) errBad.push(field);
      }
      const ok = checks.every((c) => c.label && c.live && c.copy) && errBad.length === 0 && Object.keys(catalog).length > 0;
      return { ok, detail: JSON.stringify({ checks: checks.filter((c) => !(c.label && c.live && c.copy)), errBad }) };
    },

    async "percent-no-markup"(src) {
      // percent-core's discount, markup, tax and tip labels contain a
      // literal "<br>". The view never shows that field for them and never
      // turns text into markup: no "<" anywhere in the tool, each result
      // line is a span of text (and value isolates), no <br> element.
      const app = await boot({ overrides: src });
      await settle(app);
      await fillAll(app);
      const root = app.byId("percentTool");
      const noAngle = !root.textContent.includes("<") && !root.textContent.includes("br>");
      const noBr = app.document.querySelectorAll("br").length === 0;
      const tags = new Set();
      for (const key of ["discount", "markup", "tax", "tip"]) {
        const walk = (n) => {
          for (const c of n.children) {
            tags.add(c.localName);
            walk(c);
          }
        };
        walk(app.byId(key + "Result"));
      }
      const onlyText = [...tags].every((tag) => tag === "span" || tag === "bdi");
      const two = ["discount", "markup", "tax", "tip"].every((k) => lines(app, k).length === 2);
      const ok = noAngle && noBr && onlyText && two;
      return { ok, detail: JSON.stringify({ noAngle, noBr, tags: [...tags], two, discount: lines(app, "discount") }) };
    },

    async "percent-errors"(src) {
      // Engine errors show the catalog wording in the result, "→ invalid"
      // and the PCT note in the formula; 1e400 is "Value out of range"
      // without an engine call; a valid value recovers.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "changeOrig", "0");
      input(app, "changeNew", "5");
      await until(() => text(app, "changeLive") === "→ invalid", 2000);
      const zero = text(app, "changeResult") === "=Original value cannot be zero" && formula(app, "change")[0] === "((new − original) / original) × 100 (original cannot be zero)" &&
        app.byId("changeResult").querySelector(".error-text") !== null;
      input(app, "markupCost", "10");
      input(app, "markupPrice", "0");
      await until(() => text(app, "markupLive") === "→ invalid", 2000);
      const markup = text(app, "markupResult") === "=Selling price cannot be zero" && formula(app, "markup").join("|") === "markup = (price − cost) / cost × 100 (selling price cannot be zero)";
      app.byId("taxMode-extract").click();
      input(app, "taxAmount", "100");
      input(app, "taxRate", "-100");
      await until(() => text(app, "taxLive") === "→ invalid", 2000);
      const tax = text(app, "taxResult") === "=Tax rate cannot be -100%" && formula(app, "tax")[0] === "net = total / (1 + rate/100) (tax rate cannot be -100%)";
      input(app, "tipBill", "50");
      input(app, "tipPercent", "10");
      input(app, "tipPeople", "2.5");
      await until(() => text(app, "tipLive") === "→ invalid", 2000);
      const people = text(app, "tipResult") === "=People must be a whole number (1 or more)";
      input(app, "tipPeople", "0");
      await tick(80);
      const peopleZero = text(app, "tipResult") === "=People must be a whole number (1 or more)";
      input(app, "whatX", "1e400");
      input(app, "whatY", "5");
      await until(() => text(app, "whatLive") === "→ invalid", 2000);
      const range = text(app, "whatResult") === "=Value out of range" && formula(app, "what")[0] === "(X / 100) × Y";
      input(app, "changeOrig", "100");
      await until(() => text(app, "changeLive") === "→ 95.00% decrease", 2000);
      const recovered = text(app, "changeResult") === "=95.00% decrease";
      const ok = zero && markup && tax && people && peopleZero && range && recovered;
      return { ok, detail: JSON.stringify({ zero, markup, tax, people, peopleZero, range, recovered, change: text(app, "changeResult"), what: text(app, "whatResult") }) };
    },

    async "percent-swap-presets-clear"(src) {
      // Swap exchanges a card's two values and recomputes (on all eight
      // cards); a tip preset fills Tip % and shows pressed; Clear empties
      // a card (people back to 1); Clear all empties every card.
      const app = await boot({ overrides: src });
      await settle(app);
      await fillAll(app);
      const swapped = [];
      for (const key of KEYS) {
        const [a, b] = { change: ["changeOrig", "changeNew"], percent: ["isWhatX", "isWhatY"], what: ["whatX", "whatY"], discount: ["discountPrice", "discountPercent"],
          base: ["baseX", "baseY"], markup: ["markupCost", "markupPrice"], tax: ["taxAmount", "taxRate"], tip: ["tipBill", "tipPercent"] }[key];
        const before = [app.byId(a).value, app.byId(b).value];
        app.byId(key + "SwapBtn").click();
        if (app.byId(a).value !== before[1] || app.byId(b).value !== before[0]) swapped.push(key);
      }
      await until(() => text(app, "changeLive") === "→ 16.67% decrease", 2000);
      const recomputed = text(app, "changeLive") === "→ 16.67% decrease" && text(app, "percentLive") === "→ 400.00%";
      app.byId("tipSwapBtn").click();
      app.byId("tipPreset-15").click();
      await until(() => text(app, "tipLive") === "→ Each: 38.33 · Total: 115.00", 2000);
      const pressed = ["10", "15", "18", "20"].map((p) => app.byId("tipPreset-" + p).getAttribute("aria-pressed")).join(",") === "false,true,false,false" &&
        app.byId("tipPercent").value === "15";
      input(app, "tipPercent", "18");
      await tick(40);
      const follows = app.byId("tipPreset-18").getAttribute("aria-pressed") === "true" && app.byId("tipPreset-15").getAttribute("aria-pressed") === "false";
      app.byId("tipClearBtn").click();
      await tick(60);
      const cleared = app.byId("tipBill").value === "" && app.byId("tipPercent").value === "" && app.byId("tipPeople").value === "1" && text(app, "tipLive") === "→ —";
      app.byId("percentClearAllBtn").click();
      await tick(80);
      const all = KEYS.every((k) => text(app, k + "Live") === "→ —") && app.byId("changeOrig").value === "" && app.document.activeElement === app.byId("changeOrig");
      const ok = swapped.length === 0 && recomputed && pressed && follows && cleared && all;
      return { ok, detail: JSON.stringify({ notSwapped: swapped, recomputed, pressed, follows, cleared, all, change: text(app, "changeLive"), tip: text(app, "tipLive") }) };
    },

    async "percent-tax-mode"(src) {
      // Add / Extract: aria-pressed, the amount's label and example, the
      // formula and the result follow the mode; the mode is in the request
      // and in the history entry.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "taxAmount", "115");
      input(app, "taxRate", "15");
      await until(() => text(app, "taxLive") === "→ Total: 132.25 | Tax: 17.25", 2000);
      app.byId("taxMode-extract").click();
      await until(() => text(app, "taxLive") === "→ Net: 100.00 | Tax: 15.00", 2000);
      const pressed = app.byId("taxMode-extract").getAttribute("aria-pressed") === "true" && app.byId("taxMode-add").getAttribute("aria-pressed") === "false";
      const label = text(app, "taxAmountLabel") === "Total amount (tax-inclusive)" && app.byId("taxAmount").getAttribute("placeholder") === "e.g., 115";
      const shown = lines(app, "tax").join("|") === "Net: 100.00|Tax: 15.00 (Total: 115.00)" && formula(app, "tax").join("|") === "net = 115 / (1 + 15/100) = 100.00|tax = 115 − 100.00 = 15.00";
      app.byId("taxCalcBtn").click();
      await until(() => app.PCalc.history.recorded().length === 1, 2000);
      const e = app.PCalc.history.recorded()[0];
      const entry = e.calculatorLabel === "Tax / VAT (Extract)" && e.inputs.mode === "extract" && e.inputsText === "115 incl. 15% tax" && e.resultText === "Net: 100.00 · Tax: 15.00";
      app.byId("taxMode-add").click();
      await until(() => text(app, "taxLive") === "→ Total: 132.25 | Tax: 17.25", 2000);
      const back = text(app, "taxAmountLabel") === "Net amount (before tax)" && app.byId("taxAmount").getAttribute("placeholder") === "e.g., 100";
      const ok = pressed && label && shown && entry && back;
      return { ok, detail: JSON.stringify({ pressed, label, shown, entry, back, lines: lines(app, "tax"), e }) };
    },

    async "percent-paste"(src) {
      // A pasted "$1,234.50" becomes 1234.50 and recomputes; Arabic-Indic
      // digits are read; a paste that is no number is blocked.
      const app = await boot({ overrides: src });
      await settle(app);
      const paste = (id, data) => {
        const ev = new app.window.Event("paste", { props: { clipboardData: { getData: () => data } } });
        app.byId(id).dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      input(app, "discountPercent", "10");
      const blockedMoney = paste("discountPrice", "$1,234.50");
      await until(() => text(app, "discountLive") === "→ final: 1111.05 | saved: 123.45", 2000);
      const money = blockedMoney && app.byId("discountPrice").value === "1234.50";
      const plain = paste("discountPrice", "42") === false;
      const blockedWord = paste("discountPrice", "abc") && app.byId("discountPrice").value === "1234.50";
      input(app, "whatX", "١٠");
      input(app, "whatY", "٥٠");
      await until(() => text(app, "whatLive") === "→ 5.00", 2000);
      const arabic = text(app, "whatLive") === "→ 5.00";
      const ok = money && plain && blockedWord && arabic;
      return { ok, detail: JSON.stringify({ money, plain, blockedWord, arabic, value: app.byId("discountPrice").value, what: text(app, "whatLive") }) };
    },

    async "percent-ipc-race"(src) {
      // A slow engine answer for an older keystroke never overwrites the
      // newer result, and a slow answer after Clear leaves the card idle.
      const holder = await bootApp({ web, engine, now: NOW, href: "https://example.test/p/#/about" });
      const w = holder.window.PCalc;
      let slow = null;
      const call = async (op, req) => {
        const answer = await w.platforms.web.engine(op, req);
        if (slow && slow(op, req)) await tick(250);
        return answer;
      };
      const tauri = fakeTauri(call, w.store.createDocStore, w.store.memoryBackend);
      const app = await boot({ overrides: src, tauri });
      await settle(app);
      input(app, "whatY", "100");
      await tick(40);
      slow = (op, req) => op === "percent.what" && JSON.parse(req).percent === 1;
      input(app, "whatX", "1");
      input(app, "whatX", "2");
      await tick(400);
      const newer = text(app, "whatLive") === "→ 2.00";
      input(app, "whatX", "1");
      app.byId("whatClearBtn").click();
      await tick(400);
      const idle = text(app, "whatLive") === "→ —" && app.byId("whatX").value === "";
      return { ok: newer && idle, detail: `newer kept=${newer} (${text(app, "whatLive")}) idle after clear=${idle}` };
    },

    async "percent-history-hook"(src) {
      // Calculate, Enter and a successful Copy record (queued until M3);
      // typing never does. Entries carry the raw inputs (inputC for Tip).
      const copied = [];
      const app = await boot({ overrides: src, seed: (w) => { w.navigator.clipboard = { writeText: async (s) => { copied.push(s); } }; } });
      await settle(app);
      const n = () => app.PCalc.history.recorded().length;
      await fillAll(app);
      app.byId("tipSwapBtn").click();
      app.byId("tipSwapBtn").click();
      await tick(80);
      const live = n() === 0;
      app.byId("discountCalcBtn").click();
      await until(() => n() === 1, 1500);
      app.byId("tipPeople").focus();
      app.document.press("Enter");
      await until(() => n() === 2, 1500);
      app.byId("markupCopyBtn").click();
      await until(() => n() === 3, 1500);
      const feedback = text(app, "markupCopyBtn") === "Copied";
      const [d, t, mk] = app.PCalc.history.recorded();
      const shape = d.tool === "percent" && d.calculator === "discount" && d.calculatorLabel === "Discount" && d.inputs.inputA === "79.99" && d.inputs.inputB === "20" &&
        !("inputC" in d.inputs) && d.inputsText === "79.99 (−20%)" && d.resultText === "Final: 63.99 · Saved: 16.00" && d.copyText === "Final: 63.99\nSaved: 16.00" && d.timestampMs === NOW &&
        t.calculator === "tip" && t.inputs.inputC === "3" && t.inputsText === "Bill 100 + 20% tip ÷ 3" && t.resultText === "Tip: 20.00 · Total: 120.00 · Each: 40.00" &&
        mk.calculatorLabel === "Markup & Margin" && mk.inputsText === "Cost 80 → Price 100" && copied[0] === "Profit: 20.00\nMarkup: 25.00%\nMargin: 20.00%";
      // A failed copy records nothing; an idle card records nothing.
      app.window.navigator.clipboard = { writeText: async () => { throw new Error("denied"); } };
      app.byId("changeCopyBtn").click();
      await tick(60);
      app.byId("baseClearBtn").click();
      await tick(40);
      app.byId("baseCalcBtn").click();
      await tick(60);
      const none = n() === 3;
      const ok = live && shape && feedback && none;
      return { ok, detail: JSON.stringify({ live, shape, feedback, none, count: n(), first: d, copied }) };
    },

    async "percent-session-model"(src) {
      // Field values and the tax mode survive leaving the route and coming
      // back (the session model), and are recomputed on return.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "baseX", "30");
      input(app, "baseY", "60");
      app.byId("taxMode-extract").click();
      await until(() => text(app, "baseLive") === "→ 50.00", 2000);
      await app.window.location.assignHash("#/date");
      await until(() => app.html.getAttribute("data-route") === "date", 2000);
      const gone = app.byId("percentTool") === null;
      app.window.location.assignHash("#/percent");
      await until(() => app.html.getAttribute("data-route") === "percent", 2000);
      await settle(app);
      const kept = app.byId("baseX").value === "30" && text(app, "baseLive") === "→ 50.00" && app.byId("taxMode-extract").getAttribute("aria-pressed") === "true" &&
        text(app, "taxAmountLabel") === "Total amount (tax-inclusive)";
      return { ok: gone && kept, detail: JSON.stringify({ gone, kept, base: app.byId("baseX").value, live: text(app, "baseLive") }) };
    },

    async "percent-layout"(src) {
      // The shared card layout: collapse keeps values and live results and
      // is saved in settings.percent.collapsedCards; ArrowUp on a handle
      // moves the card and saves settings.percent.cardOrder (Date's order
      // untouched); Settings > Percentage > Layout > Reset restores the
      // default, expands every card, keeps every value and says so.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin });
      await settle(app);
      input(app, "whatX", "10");
      input(app, "whatY", "50");
      app.byId("card-what").querySelector(".card-collapse").click();
      await until(() => text(app, "whatLive") === "→ 5.00", 2000);
      const collapsed = app.byId("card-what").classList.contains("is-collapsed") && app.byId("card-what-body").hasAttribute("hidden");
      input(app, "whatY", "70");
      await until(() => text(app, "whatLive") === "→ 7.00", 2000);
      app.byId("card-tip").querySelector(".card-handle").focus();
      app.document.press("ArrowUp");
      const moved = order(app) === "change,percent,what,discount,base,markup,tip,tax";
      const doc = () => {
        const s = origin.indexedDB.peek("pcalc", "settings");
        return s ? JSON.parse(s) : null;
      };
      await until(() => {
        const d = doc();
        return d && d.percent.cardOrder.join() === "change,percent,what,discount,base,markup,tip,tax" && d.percent.collapsedCards.join() === "what";
      }, 2000);
      const saved = doc().percent.collapsedCards.join() === "what" && doc().date.cardOrder.join() === "between,add,business,age,info,countdown";
      await app.window.location.assignHash("#/settings");
      await until(() => app.html.getAttribute("data-route") === "settings", 2000);
      const panel = app.byId("settingsPercentLayout") !== null && text(app, "settingsPercentTitle") === "Percentage";
      app.byId("percentLayoutResetBtn").click();
      await until(() => {
        const d = doc();
        return d && d.percent.cardOrder.join() === KEYS.join() && d.percent.collapsedCards.length === 0;
      }, 2000);
      await tick(40);
      const note = text(app, "percentLayoutNote") === "Card order reset and every card expanded.";
      app.window.location.assignHash("#/percent");
      await until(() => app.html.getAttribute("data-route") === "percent", 2000);
      await settle(app);
      const view = order(app) === KEYS.join() && app.document.querySelectorAll(".tool-card.is-collapsed").length === 0 && app.byId("whatY").value === "70";
      const ok = collapsed && moved && saved && panel && note && view;
      return { ok, detail: JSON.stringify({ collapsed, moved, saved, panel, note, view, order: order(app) }) };
    },

    async "percent-desktop-adapter"(src) {
      // The same tool under the desktop adapter: every card's op goes
      // through engine_call and the layout through store_save.
      const holder = await bootApp({ web, engine, now: NOW, href: "https://example.test/p/#/about" });
      const w = holder.window.PCalc;
      const tauri = fakeTauri((op, req) => w.platforms.web.engine(op, req), w.store.createDocStore, w.store.memoryBackend);
      const app = await boot({ overrides: src, tauri });
      await settle(app);
      await fillAll(app);
      app.byId("card-base").querySelector(".card-collapse").click();
      await until(() => tauri.log.some((l) => l.cmd === "store_save" && l.args.name === "settings"), 2000);
      const ops = new Set(tauri.log.filter((l) => l.cmd === "engine_call").map((l) => l.args.op));
      const all = ["change", "percent", "what", "discount", "base", "markup", "tax", "tip"].every((k) => ops.has("percent." + k));
      const shown = text(app, "tipLive") === "→ Each: 40.00 · Total: 120.00" && lines(app, "discount").join("|") === "Final: 63.99|Saved: 16.00";
      const ok = app.html.getAttribute("data-store") === "file" && all && shown;
      return { ok, detail: `store=${app.html.getAttribute("data-store")} ops=${[...ops].join(",")} shown=${shown}` };
    },

    async "percent-results-spoken-once"(src) {
      // Plan B16: no result box is a live region (150 then 180 typed into
      // Percentage Change showed six answers); the tool's one polite region
      // speaks the result once typing pauses, at once on Enter, never on
      // mount.
      const app = await boot({ overrides: src });
      await settle(app);
      const region = app.byId("percentResultLive");
      const boxes = KEYS.every((k) => !app.byId(k + "Result").hasAttribute("role") && !app.byId(k + "Result").hasAttribute("aria-live"));
      const mount = attr(region, "aria-live") === "polite" && region.textContent === "";
      for (const v of ["1", "15", "150"]) input(app, "changeOrig", v);
      for (const v of ["1", "18", "180"]) {
        input(app, "changeNew", v);
        await tick(40);
      }
      await until(() => text(app, "changeLive") === "→ 20.00% increase", 2000);
      const whileTyping = region.textContent === "";
      await until(() => region.textContent !== "", 2000);
      const paused = region.textContent === "20.00% increase";
      app.byId("changeNew").focus();
      app.document.press("Enter");
      await until(() => region.textContent !== "20.00% increase", 400);
      const enter = region.textContent === "20.00% increase ";
      const ok = boxes && mount && whileTyping && paused && enter;
      return { ok, detail: JSON.stringify({ boxes, mount, whileTyping, paused, enter, region: region.textContent }) };
    },

    async "percent-ltr-and-digits"(src) {
      // B5c: the fields are text fields with a numeric keypad (a number
      // field drops typed Arabic-Indic digits in Chromium), dir="ltr" so
      // "-200" never shows as "200-"; Arabic-Indic digits compute; engine
      // text is a <bdi dir="ltr"> run and formula numbers are LTR values;
      // the tip presets follow Settings > Digits.
      const app = await boot({ overrides: src });
      await settle(app);
      const ids = ["changeOrig", "changeNew", "isWhatX", "isWhatY", "whatX", "whatY", "discountPrice", "discountPercent", "baseX", "baseY", "markupCost", "markupPrice", "taxAmount", "taxRate", "tipBill", "tipPercent", "tipPeople"];
      const fields = ids.every((id) => {
        const n = app.byId(id);
        const mode = id === "tipPeople" ? "numeric" : "decimal";
        return attr(n, "type") === "text" && attr(n, "inputmode") === mode && attr(n, "dir") === "ltr" && attr(n, "enterkeyhint") === "done";
      });
      input(app, "isWhatX", "٥٠");
      input(app, "isWhatY", "٢٠٠");
      input(app, "changeOrig", "-200");
      input(app, "changeNew", "150");
      await until(() => text(app, "percentLive") === "→ 25.00%" && text(app, "changeLive") !== "→ —", 2000);
      const ltrRun = (n) => Boolean(n) && n.localName === "bdi" && attr(n, "dir") === "ltr";
      const arabic = lines(app, "percent").join() === "25.00%";
      const main = ltrRun(app.byId("changeResult").querySelector(".result-main").children[0]);
      const formulaNums = app.byId("changeFormula").querySelectorAll("bdi").length >= 2 && Array.from(app.byId("changeFormula").querySelectorAll("bdi")).every((b) => ltrRun(b) && b.className === "num");
      const liveRun = app.byId("changeLive").children.some(ltrRun);
      app.window.location.assignHash("#/settings");
      await until(() => app.byId("digitsSelect"), 2000);
      const digits = app.byId("digitsSelect");
      digits.value = "arabic-indic";
      digits.dispatchEvent(new app.window.Event("change"));
      await tick(60);
      app.window.location.assignHash("#/percent");
      await until(() => app.byId("tipPreset-10"), 2000);
      await settle(app);
      const presets = text(app, "tipPreset-10") === "١٠%" && text(app, "tipPreset-18") === "١٨%";
      const got = { fields, arabic, main, formulaNums, liveRun, presets };
      return { ok: Object.values(got).every(Boolean), detail: JSON.stringify(got) };
    },

    async "percent-clear-all-phone"(src) {
      // Clear all on a phone (coarse pointer) keeps focus on the button (a
      // focused number field would raise the keypad and hide the bottom
      // bar); a mouse moves focus to the first field. Both say it politely.
      const phone = await boot({ overrides: src, coarse: true });
      await settle(phone);
      input(phone, "changeOrig", "150");
      phone.byId("percentClearAllBtn").focus();
      phone.byId("percentClearAllBtn").click();
      await tick(60);
      const kept = phone.document.activeElement === phone.byId("percentClearAllBtn") && phone.byId("changeOrig").value === "" &&
        phone.byId("percentResultLive").textContent === "All cards cleared.";
      const desk = await boot({ overrides: src });
      await settle(desk);
      desk.byId("percentClearAllBtn").click();
      await tick(60);
      const moved = desk.document.activeElement === desk.byId("changeOrig") && desk.byId("percentResultLive").textContent === "All cards cleared.";
      return { ok: kept && moved, detail: JSON.stringify({ kept, moved }) };
    }
  };
}

// ---------------------------------------------------------------------------
// Slice C: settings.percent in the "settings" document
// ---------------------------------------------------------------------------

function putRaw(app, name, text) {
  return new Promise((resolve, reject) => {
    const req = app.window.indexedDB.open("pcalc");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").put(text, name);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export function percentCTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/percent", ...o });
  const seeded = async (settings, src) => {
    const origin = createOrigin();
    const s = await bootApp({ web, engine, origin, now: NOW, href: "https://example.test/p/#/about" });
    const doc = s.PCalc.prefs.copy(s.PCalc.prefs.DEFAULT_SETTINGS);
    settings(doc);
    await putRaw(s, "settings", JSON.stringify(doc));
    const app = await boot({ overrides: src, origin });
    await settle(app);
    return { app, origin };
  };

  return {
    async "percent-layout-launch-restore"(src) {
      // A saved settings.percent (order and collapsed cards) is what the
      // next launch shows; the launch itself writes nothing.
      const order = ["tip", "tax", "change", "percent", "what", "discount", "base", "markup"];
      const { app, origin } = await seeded((d) => {
        d.percent.cardOrder = order;
        d.percent.collapsedCards = ["markup", "change"];
      }, src);
      const before = origin.indexedDB.peek("pcalc", "settings");
      await tick(80);
      const shown = app.byId("percentCards").children.map((c) => c.getAttribute("data-card")).join() === order.join() &&
        app.document.querySelectorAll(".tool-card.is-collapsed").map((c) => c.getAttribute("data-card")).sort().join() === "change,markup";
      const unwritten = origin.indexedDB.peek("pcalc", "settings") === before;
      return { ok: shown && unwritten, detail: JSON.stringify({ shown, unwritten, order: app.byId("percentCards").children.map((c) => c.getAttribute("data-card")) }) };
    },

    async "percent-layout-read-only"(src) {
      // A settings document from a newer app is read-only: collapsing and
      // moving still work for the session, the document is never written,
      // and Settings > Percentage > Layout says the layout is session-only.
      const origin = createOrigin();
      const s = await bootApp({ web, engine, origin, now: NOW, href: "https://example.test/p/#/about" });
      const newer = JSON.stringify(Object.assign(s.PCalc.prefs.copy(s.PCalc.prefs.DEFAULT_SETTINGS), { schemaVersion: 99 }));
      await putRaw(s, "settings", newer);
      const app = await boot({ overrides: src, origin });
      await settle(app);
      app.byId("card-change").querySelector(".card-collapse").click();
      app.byId("card-tip").querySelector(".card-handle").focus();
      app.document.press("ArrowUp");
      await tick(120);
      const session = app.byId("card-change").classList.contains("is-collapsed") && app.byId("percentCards").children[6].getAttribute("data-card") === "tip";
      const untouched = origin.indexedDB.peek("pcalc", "settings") === newer;
      await app.window.location.assignHash("#/settings");
      await until(() => app.html.getAttribute("data-route") === "settings", 2000);
      const note = text(app, "percentLayoutNote") === "Card order and collapsed cards last for this session only: settings cannot be saved here.";
      return { ok: session && untouched && note, detail: JSON.stringify({ session, untouched, note: text(app, "percentLayoutNote") }) };
    }
  };
}

// Each mutant breaks one rule; the named test must fail on it.
export const PERCENT_MUTANTS = [
  ["B", "percent-cards-live", TOOL, "return n < 0 ? \"(\" + n + \")\" : String(n);", "return String(n);"],
  ["B", "percent-cards-live", TOOL, "formula: [[\"percent.formula.change.live\", { orig: fnum(orig), next: fnum(next) }]],", "formula: [[\"percent.formula.change.live\", { orig: fnum(next), next: fnum(orig) }]],"],
  ["B", "percent-text-parity", TOOL, "        result: [[\"percent.result.markup.1\", v], [\"percent.result.markup.2\", v]],", "        result: [[\"percent.result.markup.1\", v]],"],
  ["B", "percent-text-parity", TOOL, "        copyText: str(r.copyText)\n      };\n    },\n    base:", "        copyText: m.t(\"percent.history.discount\", v)\n      };\n    },\n    base:"],
  ["B", "percent-no-markup", TOOL, "        result: [[\"percent.result.discount.1\", v], [\"percent.result.discount.2\", v]],", "        result: [str(r.label)],"],
  ["B", "percent-no-markup", TOOL, "        result: [[\"percent.result.markup.1\", v], [\"percent.result.markup.2\", v]],", "        result: [str(r.label)],"],
  ["B", "percent-errors", TOOL, "    if (!nums.every(Number.isFinite)) {\n      cardOutOfRange(key);\n      return null;\n    }\n", ""],
  ["B", "percent-errors", TOOL, "    formulaError(key, m.t(field ? \"percent.note.\" + field : \"percent.note.other\"));", "    setFormula(key, defaultLines(key));"],
  ["B", "percent-errors", TOOL, "    if (key === \"markup\") first = m.t(\"percent.formula.markup.error\");\n", ""],
  ["B", "percent-swap-presets-clear", TOOL, "    setField(b[0], x);\n    return update(key);", "    setField(b[0], x);\n    return Promise.resolve();"],
  ["B", "percent-swap-presets-clear", TOOL, "    for (const [id] of CARDS[key].fields) setField(id, id === \"tipPeople\" ? \"1\" : \"\");", "    for (const [id] of CARDS[key].fields) setField(id, \"\");"],
  ["B", "percent-swap-presets-clear", TOOL, "    syncPresets(key);\n", ""],
  ["B", "percent-tax-mode", TOOL, "    if (mode) req.mode = mode;\n", ""],
  ["B", "percent-tax-mode", TOOL, "    if (label) label.textContent = m.t(\"percent.field.taxAmount.\" + model.taxMode);\n", ""],
  ["B", "percent-tax-mode", TOOL, "    if (mode) inputs.mode = mode;\n", ""],
  ["B", "percent-paste", TOOL, "    let cleaned = trimmed.replace(/[\\s_,$€£¥₹₩₽₺₫₪₱฿%]+/g, \"\");", "    let cleaned = trimmed;"],
  ["B", "percent-paste", TOOL, "    const trimmed = ns.format.normalizeDigits(raw).trim();", "    const trimmed = raw.trim();"],
  ["B", "percent-paste", TOOL, "    event.preventDefault();\n    const cleaned = sanitize(trimmed);", "    const cleaned = sanitize(trimmed);"],
  ["B", "percent-ipc-race", TOOL, "    const current = ticket === m.seq[key];", "    const current = true;\n    void ticket;"],
  ["B", "percent-history-hook", TOOL, "    recordEntry(entry);\n    m.say.now(() => speech(key));", "    m.say.now(() => speech(key));"],
  ["B", "percent-history-hook", TOOL, "    if (!ok || !m) return false;\n    const label", "    record(key);\n    if (!ok || !m) return false;\n    const label"],
  ["B", "percent-history-hook", TOOL, "    if (spec.fields[i]) inputs[name] = sanitize(raw(spec.fields[i][0]));", "    if (spec.fields[i] && i < 2) inputs[name] = sanitize(raw(spec.fields[i][0]));"],
  ["B", "percent-session-model", TOOL, "    if (id && FIELD_IDS.includes(id)) model.fields[id] = target.value;", "    void id;"],
  ["B", "percent-layout", TOOL, "    ctx.settings.percent.collapsedCards = s.collapsedCards;\n", ""],
  ["B", "percent-layout", TOOL, "    return saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: [] }, { reset: true });", "    return saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: ctx.settings.percent.collapsedCards }, { reset: true });"],
  ["B", "percent-layout", TOOL, "      await resetLayout(ctx);\n", ""],
  ["B", "percent-desktop-adapter", TOOL, "      const r = JSON.parse(await m.ctx.platform.engine(op, JSON.stringify(req)));", "      const r = JSON.parse(await ns.platforms.web.engine(op, JSON.stringify(req)));"],
  ["B", "percent-results-spoken-once", TOOL, 'el("div", { className: "result", attrs: { id: key + "Result" } }', 'el("div", { className: "result", attrs: { id: key + "Result", role: "status", "aria-live": "polite" } }'],
  ["B", "percent-results-spoken-once", TOOL, "          m.say.soon(() => speech(key));", "          m.say.now(() => speech(key));"],
  ["B", "percent-results-spoken-once", TOOL, "    recordEntry(entry);\n    m.say.now(() => speech(key));", "    recordEntry(entry);"],
  ["B", "percent-ltr-and-digits", TOOL, 'const attrs = { id, type: "text", ', 'const attrs = { id, type: "number", '],
  ["B", "percent-ltr-and-digits", TOOL, 'inputmode: id === "tipPeople" ? "numeric" : "decimal", dir: "ltr", ', 'inputmode: id === "tipPeople" ? "numeric" : "decimal", '],
  ["B", "percent-ltr-and-digits", TOOL, "    return typeof line === \"string\" ? ltrNodes(line) : withValues(lineText(line));", "    return typeof line === \"string\" ? [document.createTextNode(line)] : withValues(lineText(line));"],
  ["B", "percent-ltr-and-digits", TOOL, "    for (const [k, v] of Object.entries(line[1] || {})) params[k] = ltrValue(v);", "    for (const [k, v] of Object.entries(line[1] || {})) params[k] = ltrValue(v).replace(/[\\uE004\\uE005]/g, \"\");"],
  ["B", "percent-ltr-and-digits", TOOL, "    if (typeof line === \"string\") return ltr(line);", "    if (typeof line === \"string\") return line;"],
  ["B", "percent-ltr-and-digits", TOOL, '{ value: ns.format.formatNumber(p, m.ctx.lang, { digits: m.ctx.digits, grouping: "none" }) }', "{ value: p }"],
  ["B", "percent-ltr-and-digits", TOOL, "    const trimmed = ns.format.normalizeDigits(raw).trim();", "    const trimmed = raw.trim();"],
  ["B", "percent-clear-all-phone", TOOL, 'const first = coarse ? byId("percentClearAllBtn") : firstFocus();', "const first = firstFocus();"],
  ["B", "percent-clear-all-phone", TOOL, '    m.say.say(m.t("tool.cleared"));\n', "\n"],
  ["C", "percent-layout-launch-restore", TOOL, "      state: ns.cardLayout.normalise(KEYS, ctx.settings.percent),", "      state: ns.cardLayout.normalise(KEYS, null),"],
  ["C", "percent-layout-read-only", TOOL, "      if (ctx.store.kind === \"memory\" || (o && o.readOnly)) return t(\"layout.note.session\");\n", ""]
];
