// The Percentage tool (plan B9, M2c): the eight cards of Percentage
// Calculator Tool v2.3.0 (Percentage Change, Percentage of Total, Calculate
// Percentage, Discount, Find Original Value, Markup & Profit Margin, Reverse
// Tax / VAT with Add and Extract, Tip & Bill Split with 10/15/18/20 % presets
// and whole people from 1), each with a live result, a live-formula panel,
// a swap button, Calculate, Clear and Copy; the card layout (collapse,
// reorder, Move menu) kept in settings.percent.cardOrder / collapsedCards;
// and Settings > Percentage > Layout > Reset.
//
// All arithmetic and every number's text come from the engine (percent.*
// ops through the platform adapter), so the results are percent-core's to
// the byte. The engine's `label` joins its lines with a literal "<br>"
// (percent-core output stays byte-identical); this view never uses that
// field for a multi-line result and never interprets markup anywhere: it
// builds each line from the engine's structured fields (finalText,
// savedText, profitText, ...) inside catalog text, as text nodes. The one-
// line labels (Percentage Change's "12.50% increase", the plain numbers)
// and the copied text are engine English, shown as is until the translated
// catalogs (M9a); every other word comes from the catalog.
//
// History: Calculate, Enter and Copy record through PCalc.history (a queue
// until M3); live updates never record. Per-card sequence counters keep a
// slower answer from overwriting a newer keystroke or a Clear. Field
// values and the tax mode live in `model` for the session, so leaving the
// route and coming back (or a language change) keeps them.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, show, ltr, ltrValue, ltrNodes, withValues } = ns.dom;
  const KEYS = Object.freeze(["change", "percent", "what", "discount", "base", "markup", "tax", "tip"]);
  const COPY_FEEDBACK_MS = 1200;
  const TIP_PRESETS = Object.freeze(["10", "15", "18", "20"]);
  const FINITE_DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const PLAIN_NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

  // Per card: the op, its inputs as [element id, request field, example],
  // and the result's number and text fields (all must be finite / free of
  // "Infinity", as in PCT's allFiniteValues).
  const CARDS = Object.freeze({
    change: { op: "percent.change", fields: [["changeOrig", "originalValue", "150"], ["changeNew", "newValue", "180"]], nums: ["value"], texts: ["label", "liveResult"] },
    percent: { op: "percent.percent", fields: [["isWhatX", "part", "50"], ["isWhatY", "total", "200"]], nums: ["value"], texts: ["label", "liveResult"] },
    what: { op: "percent.what", fields: [["whatX", "percent", "20"], ["whatY", "number", "500"]], nums: ["value"], texts: ["label", "liveResult"] },
    discount: { op: "percent.discount", fields: [["discountPrice", "price", "79.99"], ["discountPercent", "discountPercent", "20"]], nums: ["finalPrice", "saved"], texts: ["finalText", "savedText", "label", "copyText"] },
    base: { op: "percent.base", fields: [["baseX", "value", "50"], ["baseY", "percent", "25"]], nums: ["value"], texts: ["label", "liveResult"] },
    markup: { op: "percent.markup", fields: [["markupCost", "cost", "80"], ["markupPrice", "sellingPrice", "100"]], nums: ["profit", "markup", "margin"], texts: ["profitText", "markupText", "marginText", "label", "liveResult", "copyText"] },
    tax: { op: "percent.tax", fields: [["taxAmount", "amount", "100"], ["taxRate", "ratePercent", "15"]], nums: ["net", "tax", "total"], texts: ["netText", "taxText", "totalText", "label", "liveResult", "copyText"] },
    tip: { op: "percent.tip", fields: [["tipBill", "bill", "100"], ["tipPercent", "tipPercent", "20"], ["tipPeople", "people", null]], nums: ["tipAmount", "totalBill", "perPerson"], texts: ["tipText", "totalText", "perPersonText", "label", "liveResult", "copyText"] }
  });
  const FIELD_IDS = Object.freeze(KEYS.flatMap((k) => CARDS[k].fields.map((f) => f[0])));
  // The default formula's line count per card (catalog percent.formula.<key>.<n>).
  const LINES = Object.freeze({ change: 1, percent: 1, what: 1, discount: 2, base: 1, markup: 3, tax: 2, tip: 3 });
  // Engine error fields that have their own wording (percent.error.<field>).
  const ERROR_FIELDS = Object.freeze(["originalValue", "total", "percent", "cost", "sellingPrice", "ratePercent", "bill", "tipPercent", "people"]);

  // The session model (see the header).
  const model = { fields: { tipPeople: "1" }, taxMode: "add" };

  let m = null; // the mounted view, or null

  // Lookups stay inside this view: while a re-render builds the new view,
  // the old one (same ids) is still in the document.
  function byId(id) {
    if (m && m.root) {
      const n = m.root.querySelector("#" + id);
      if (n) return n;
    }
    return document.getElementById(id);
  }

  const str = (v) => (typeof v === "string" ? v : "");

  // ---- numbers (PCT v2.3.0 sanitizeNumericString / getNumber) ------------------

  // "$1,234.50", "€ 20", "15%", "USD-3" and Arabic-Indic digits become a
  // plain decimal; anything else stays as typed (and is not a number).
  function sanitize(raw) {
    if (typeof raw !== "string") return "";
    const trimmed = ns.format.normalizeDigits(raw).trim();
    if (!trimmed) return "";
    let cleaned = trimmed.replace(/[\s_,$€£¥₹₩₽₺₫₪₱฿%]+/g, "");
    cleaned = cleaned.replace(
      /^(?:([+-])(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|INR)(?=\d|\.)|(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|INR)(?=[+-]?(?:\d|\.)))/i,
      "$1"
    );
    if (/^\+(?:\d|\.)/.test(cleaned)) cleaned = cleaned.slice(1);
    return cleaned;
  }
  const isFiniteDecimal = (v) => typeof v === "string" && FINITE_DECIMAL_RE.test(v) && Number.isFinite(Number(v));

  const raw = (id) => {
    const n = byId(id);
    return n && typeof n.value === "string" ? n.value : "";
  };
  // null while empty or not a number; may be ±Infinity ("1e400": out of range).
  function readNumber(id) {
    const cleaned = sanitize(raw(id));
    if (cleaned === "" || !FINITE_DECIMAL_RE.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isNaN(n) ? null : n;
  }

  // A number inside a formula: negatives in parentheses (PCT fmtFormulaNum).
  function fnum(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return String(n);
    if (n === 0) return "0";
    return n < 0 ? "(" + n + ")" : String(n);
  }
  // An engine text inside a formula, the same way (PCT fmtFormulaText).
  function ftext(text) {
    const trimmed = str(text).trim();
    return trimmed.startsWith("-") ? "(" + trimmed + ")" : trimmed;
  }

  function allFinite(r, spec) {
    return Boolean(r) && typeof r === "object" &&
      spec.nums.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]) && Number.isFinite(r[k] * 100)) &&
      spec.texts.every((k) => typeof r[k] === "string" && !r[k].includes("Infinity"));
  }

  // ---- engine ------------------------------------------------------------------

  async function envelope(op, req) {
    try {
      const r = JSON.parse(await m.ctx.platform.engine(op, JSON.stringify(req)));
      return r && typeof r === "object" ? r : null;
    } catch (_) {
      return null;
    }
  }

  // ---- result, formula, live ---------------------------------------------------

  // Lines are a string (engine English, shown as is in one left-to-right
  // run) or [key, params] (catalog text whose params are numbers and
  // engine number texts, each kept left-to-right as a value; plan B5c).
  function lineText(line) {
    if (typeof line === "string") return ltr(line);
    const params = {};
    for (const [k, v] of Object.entries(line[1] || {})) params[k] = ltrValue(v);
    return m.t(line[0], params);
  }
  function lineNodes(line) {
    return typeof line === "string" ? ltrNodes(line) : withValues(lineText(line));
  }

  function setResult(key, lines) {
    const box = byId(key + "Result");
    if (!box) return;
    const nodes = [el("span", { className: "result-prefix", text: "=" })];
    lines.forEach((line, i) => nodes.push(el("span", { className: i === 0 ? "result-main" : "result-sub" }, lineNodes(line))));
    show(box, nodes);
  }
  function resultIdle(key) {
    const box = byId(key + "Result");
    if (box) show(box, [el("span", { className: "result-prefix", text: "=" }), "—"]);
  }
  function resultError(key, message) {
    const box = byId(key + "Result");
    if (box) show(box, [el("span", { className: "result-prefix", text: "=" }), el("span", { className: "error-text", text: message })]);
  }

  function defaultLines(key) {
    const base = key === "tax" ? "percent.formula.tax." + model.taxMode : "percent.formula." + key;
    const out = [];
    for (let i = 1; i <= LINES[key]; i++) out.push([base + "." + i]);
    return out;
  }
  function setFormula(key, lines) {
    const list = byId(key + "Formula");
    if (list) show(list, lines.map((line) => el("li", {}, lineNodes(line))));
  }
  function formulaError(key, note) {
    const list = byId(key + "Formula");
    if (!list) return;
    let first = m.t(defaultLines(key)[0][0]);
    if (key === "markup") first = m.t("percent.formula.markup.error");
    if (key === "tax") first = m.t("percent.formula.tax.extract.1");
    show(list, [el("li", {}, [first + " ", el("span", { className: "error-text", text: note })])]);
  }
  function live(key, text) {
    const n = byId(key + "Live");
    if (n) show(n, withValues(text));
  }

  function cardIdle(key) {
    m.last[key] = null;
    setFormula(key, defaultLines(key));
    live(key, m.t("percent.live.idle"));
    resultIdle(key);
  }
  function cardOutOfRange(key) {
    m.last[key] = null;
    setFormula(key, defaultLines(key));
    live(key, m.t("percent.live.invalid"));
    resultError(key, m.t("percent.error.range"));
  }
  function cardError(key, error) {
    m.last[key] = null;
    const field = error && typeof error.field === "string" && ERROR_FIELDS.includes(error.field) ? error.field : "";
    const message = field ? m.t("percent.error." + field)
      : error && typeof error.message === "string" && error.message.trim() ? error.message : m.t("percent.error.failed");
    formulaError(key, m.t(field ? "percent.note." + field : "percent.note.other"));
    live(key, m.t("percent.live.invalid"));
    resultError(key, message);
  }

  // ---- the cards' answers --------------------------------------------------------

  // Each returns { result: [lines], formula: [lines], live, history }.
  const VIEW = {
    change: (r, [orig, next]) => ({
      result: [str(r.label)],
      formula: [["percent.formula.change.live", { orig: fnum(orig), next: fnum(next) }]],
      live: str(r.liveResult),
      inputsText: m.t("percent.inputs.change", { orig: String(orig), next: String(next) }),
      resultText: str(r.label),
      copyText: str(r.label)
    }),
    percent: (r, [x, y]) => ({
      result: [str(r.label)],
      formula: [["percent.formula.percent.live", { x: fnum(x), y: fnum(y) }]],
      live: str(r.label),
      inputsText: m.t("percent.inputs.percent", { x: String(x), y: String(y) }),
      resultText: str(r.label),
      copyText: str(r.label)
    }),
    what: (r, [x, y]) => ({
      result: [str(r.label)],
      formula: [["percent.formula.what.live", { x: fnum(x), y: fnum(y) }]],
      live: str(r.label),
      inputsText: m.t("percent.inputs.what", { x: String(x), y: String(y) }),
      resultText: str(r.label),
      copyText: str(r.label)
    }),
    discount: (r, [price, disc]) => {
      const v = { final: r.finalText, saved: r.savedText };
      return {
        result: [["percent.result.discount.1", v], ["percent.result.discount.2", v]],
        formula: [
          ["percent.formula.discount.live.1", { price: fnum(price), disc: fnum(disc), final: r.finalText }],
          ["percent.formula.discount.live.2", { price: fnum(price), disc: fnum(disc), saved: r.savedText }]
        ],
        live: ["percent.live.discount", v],
        inputsText: m.t("percent.inputs.discount", { price: String(price), disc: String(disc) }),
        resultText: m.t("percent.history.discount", v),
        copyText: str(r.copyText)
      };
    },
    base: (r, [x, y]) => ({
      result: [str(r.label)],
      formula: [["percent.formula.base.live", { x: fnum(x), y: fnum(y) }]],
      live: str(r.label),
      inputsText: m.t("percent.inputs.base", { x: String(x), y: String(y) }),
      resultText: str(r.label),
      copyText: str(r.label)
    }),
    markup: (r, [cost, price]) => {
      const v = { profit: r.profitText, markup: r.markupText, margin: r.marginText };
      const pf = ftext(r.profitText);
      return {
        result: [["percent.result.markup.1", v], ["percent.result.markup.2", v]],
        formula: [
          ["percent.formula.markup.live.1", { price: fnum(price), cost: fnum(cost), profit: r.profitText }],
          ["percent.formula.markup.live.2", { profitF: pf, cost: fnum(cost), markup: r.markupText }],
          ["percent.formula.markup.live.3", { profitF: pf, price: fnum(price), margin: r.marginText }]
        ],
        live: ["percent.live.markup", v],
        inputsText: m.t("percent.inputs.markup", { cost: String(cost), price: String(price) }),
        resultText: m.t("percent.history.markup", v),
        copyText: str(r.copyText)
      };
    },
    tax: (r, [amount, rate], mode) => {
      const v = { net: r.netText, tax: r.taxText, total: r.totalText };
      const a = fnum(amount);
      const formula = mode === "extract"
        ? [["percent.formula.tax.extract.live.1", { amount: a, rate: fnum(rate), net: r.netText }],
          ["percent.formula.tax.extract.live.2", { amount: a, netF: ftext(r.netText), tax: r.taxText }]]
        : [["percent.formula.tax.add.live.1", { amount: a, rate: fnum(rate), tax: r.taxText }],
          ["percent.formula.tax.add.live.2", { amount: a, taxF: ftext(r.taxText), total: r.totalText }]];
      return {
        result: [["percent.result.tax." + mode + ".1", v], ["percent.result.tax." + mode + ".2", v]],
        formula,
        live: ["percent.live.tax." + mode, v],
        inputsText: m.t("percent.inputs.tax." + mode, { amount: String(amount), rate: String(rate) }),
        resultText: m.t("percent.history.tax." + mode, v),
        copyText: str(r.copyText)
      };
    },
    tip: (r, [bill, tip, people]) => {
      const v = { tip: r.tipText, total: r.totalText, each: r.perPersonText };
      return {
        result: [["percent.result.tip.1", v], ["percent.result.tip.2", v]],
        formula: [
          ["percent.formula.tip.live.1", { bill: fnum(bill), tipP: fnum(tip), tip: r.tipText }],
          ["percent.formula.tip.live.2", { bill: fnum(bill), tipF: ftext(r.tipText), total: r.totalText }],
          ["percent.formula.tip.live.3", { people: fnum(people), totalF: ftext(r.totalText), each: r.perPersonText }]
        ],
        live: ["percent.live.tip", v],
        inputsText: m.t("percent.inputs.tip", { bill: String(bill), tip: String(tip), people: String(people) }),
        resultText: m.t("percent.history.tip", v),
        copyText: str(r.copyText)
      };
    }
  };

  function historyLabel(key, mode) {
    if (key === "tax") return m.t("percent.history.label.tax." + mode);
    if (key === "markup") return m.t("percent.history.label.markup");
    return m.t("percent.card." + key);
  }

  async function update(key) {
    if (!m) return;
    const ticket = ++m.seq[key];
    const spec = CARDS[key];
    const mode = key === "tax" ? model.taxMode : null;
    const nums = spec.fields.map(([id]) => readNumber(id));
    m.last[key] = null;
    syncPresets(key);
    if (nums.some((n) => n === null)) return cardIdle(key);
    if (!nums.every(Number.isFinite)) return cardOutOfRange(key);
    const req = {};
    spec.fields.forEach(([, name], i) => {
      req[name] = nums[i];
    });
    if (mode) req.mode = mode;
    const res = await envelope(spec.op, req);
    if (!m || ticket !== m.seq[key]) return;
    if (!res) return cardOutOfRange(key);
    if (res.ok === "false") return cardError(key, res.error);
    const r = res.ok === "true" ? res.result : null;
    if (!allFinite(r, spec)) return cardOutOfRange(key);
    const view = VIEW[key](r, nums, mode);
    setFormula(key, view.formula);
    live(key, m.t("percent.live.value", { value: lineText(view.live) }));
    setResult(key, view.result);
    const inputs = {};
    ["inputA", "inputB", "inputC"].forEach((name, i) => {
      if (spec.fields[i]) inputs[name] = sanitize(raw(spec.fields[i][0]));
    });
    if (mode) inputs.mode = mode;
    m.last[key] = {
      calculator: key,
      calculatorLabel: historyLabel(key, mode),
      inputs,
      inputsText: view.inputsText,
      resultText: view.resultText,
      copyText: view.copyText
    };
  }

  function record(key) {
    const last = m && m.last[key];
    if (!last || !last.copyText) return false;
    return ns.history.record(Object.assign({ tool: "percent" }, last));
  }

  async function calculateAndRecord(key) {
    await update(key);
    if (!m) return;
    record(key);
    m.say.now(() => speech(key));
  }
  const speech = (key) => ns.announcer.resultWords(byId(key + "Result"));

  async function copyResult(key, button) {
    const last = m && m.last[key];
    if (!last || !last.copyText) return false;
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(last.copyText);
        ok = true;
      }
    } catch (_) {
      ok = false;
    }
    if (!ok || !m) return false;
    const label = m.t("percent.copy");
    button.textContent = m.t("percent.copied");
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = label;
    }, COPY_FEEDBACK_MS);
    record(key);
    return true;
  }

  // ---- fields ---------------------------------------------------------------------

  function setField(id, v) {
    const n = byId(id);
    const text = typeof v === "string" ? v : "";
    if (n) n.value = text;
    model.fields[id] = text;
  }

  function resetCard(key) {
    for (const [id] of CARDS[key].fields) setField(id, id === "tipPeople" ? "1" : "");
    resultIdle(key);
    return update(key);
  }

  // A phone (coarse pointer) keeps focus on Clear all: focusing a field
  // would raise the on-screen keyboard and hide the bottom bar.
  function clearAll() {
    const done = Promise.all(KEYS.map((k) => resetCard(k)));
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const first = coarse ? byId("percentClearAllBtn") : firstFocus();
    if (first) first.focus({ preventScroll: coarse });
    m.say.say(m.t("tool.cleared"));
    return done;
  }

  function firstFocus() {
    const order = m.layout.order();
    const key = order.find((k) => !m.layout.isCollapsed(k));
    if (key) return byId(CARDS[key].fields[0][0]);
    const card = byId("card-" + order[0]);
    return card ? card.querySelector(".card-collapse") : null;
  }

  function swap(key) {
    const [a, b] = CARDS[key].fields;
    const x = raw(a[0]);
    setField(a[0], raw(b[0]));
    setField(b[0], x);
    return update(key);
  }

  function setTaxMode(mode, recompute) {
    model.taxMode = mode === "extract" ? "extract" : "add";
    for (const value of ["add", "extract"]) {
      const b = byId("taxMode-" + value);
      if (!b) continue;
      const on = value === model.taxMode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    const label = byId("taxAmountLabel");
    if (label) label.textContent = m.t("percent.field.taxAmount." + model.taxMode);
    const input = byId("taxAmount");
    if (input) input.setAttribute("placeholder", m.t("percent.example", { value: model.taxMode === "extract" ? "115" : "100" }));
    return recompute === false ? Promise.resolve() : update("tax");
  }

  // A preset shows as pressed while the tip field holds its value.
  function syncPresets(key) {
    if (key !== "tip") return;
    const current = sanitize(raw("tipPercent"));
    for (const p of TIP_PRESETS) {
      const b = byId("tipPreset-" + p);
      if (b) b.setAttribute("aria-pressed", current !== "" && Number(current) === Number(p) ? "true" : "false");
    }
  }

  // A pasted "$1,234.50" becomes 1234.50; a paste that is no number is blocked.
  function onPaste(event, input) {
    const text = event.clipboardData && typeof event.clipboardData.getData === "function" ? event.clipboardData.getData("text") : null;
    if (typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed || (PLAIN_NUMBER_RE.test(trimmed) && Number.isFinite(Number(trimmed)))) return;
    event.preventDefault();
    const cleaned = sanitize(trimmed);
    if (isFiniteDecimal(cleaned)) {
      input.value = cleaned;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ---- building ---------------------------------------------------------------------

  // A text field with a numeric keypad, not type="number": Chromium drops
  // Arabic-Indic digits typed into a number field before .value sees them,
  // and B5c accepts both digit systems everywhere (sanitize() normalises
  // them). Numbers stay left-to-right in a right-to-left page (dir="ltr").
  function numberInput(id, example) {
    const attrs = { id, type: "text", inputmode: id === "tipPeople" ? "numeric" : "decimal", dir: "ltr", autocomplete: "off", spellcheck: "false", enterkeyhint: "done" };
    if (id !== "tipPeople") attrs.placeholder = m.t("percent.example", { value: example });
    return el("input", { className: "input", attrs });
  }

  function field(id, example) {
    const labelKey = id === "taxAmount" ? "percent.field.taxAmount." + model.taxMode : "percent.field." + id;
    return el("div", { className: "tool-field" }, [
      el("label", { className: "field-label", text: m.t(labelKey), attrs: { for: id, id: id + "Label" } }),
      numberInput(id, example)
    ]);
  }

  function actionButtons(key) {
    const calc = el("button", { className: "button primary", text: m.t("percent.calc"), attrs: { type: "button", id: key + "CalcBtn" } });
    const clear = el("button", { className: "button", text: m.t("percent.clear"), attrs: { type: "button", id: key + "ClearBtn" } });
    const copy = el("button", { className: "button", text: m.t("percent.copy"), attrs: { type: "button", id: key + "CopyBtn" } });
    calc.addEventListener("click", () => calculateAndRecord(key));
    clear.addEventListener("click", () => resetCard(key));
    copy.addEventListener("click", () => copyResult(key, copy));
    return el("div", { className: "button-row" }, [calc, clear, copy]);
  }

  function buildCard(key) {
    const t = m.t;
    const fields = CARDS[key].fields;
    const swapBtn = el("button", { className: "button swap-button", text: t("percent.swap"), attrs: { type: "button", id: key + "SwapBtn", title: t("percent.swap.title." + key) } });
    swapBtn.addEventListener("click", () => swap(key));
    const inputs = [];
    if (key === "tax") {
      const modes = ["add", "extract"].map((mode) => {
        const on = mode === model.taxMode;
        const b = el("button", { className: on ? "button mode-button active" : "button mode-button", text: t("percent.tax.mode." + mode), attrs: { type: "button", id: "taxMode-" + mode, "aria-pressed": on ? "true" : "false" } });
        b.addEventListener("click", () => setTaxMode(mode));
        return b;
      });
      inputs.push(el("div", { className: "toggle-group", attrs: { role: "group", "aria-label": t("percent.tax.mode") } }, modes));
    }
    inputs.push(field(fields[0][0], fields[0][2]), el("div", { className: "swap-row" }, [swapBtn]), field(fields[1][0], fields[1][2]));
    if (key === "tip") {
      const presets = TIP_PRESETS.map((p) => {
        const b = el("button", { className: "button chip-button", text: t("percent.tip.preset", { value: ns.format.formatNumber(p, m.ctx.lang, { digits: m.ctx.digits, grouping: "none" }) }), attrs: { type: "button", id: "tipPreset-" + p, "aria-pressed": "false" } });
        b.addEventListener("click", () => {
          setField("tipPercent", p);
          update("tip");
        });
        return b;
      });
      inputs.push(el("div", { className: "chip-row", attrs: { role: "group", "aria-label": t("percent.tip.presets") } }, presets), field(fields[2][0], fields[2][2]));
    }
    // Not a live region (it changes per keystroke): percentResultLive speaks it.
    inputs.push(actionButtons(key), el("div", { className: "result", attrs: { id: key + "Result" } }, [el("span", { className: "result-prefix", text: "=" }), "—"]));
    const formula = el("div", { className: "formula" }, [
      el("p", { className: "formula-title", text: t("percent.formula") }),
      el("ul", { className: "trace formula-lines", attrs: { id: key + "Formula", "aria-label": t("percent.formula.label", { title: t("percent.card." + key) }) } }),
      el("p", { className: "live-result", text: t("percent.live.idle"), attrs: { id: key + "Live" } })
    ]);
    return m.layout.card(key, t("percent.card." + key), t("percent.card." + key + ".sub"), [
      el("div", { className: "card-grid" }, [el("div", { className: "card-inputs" }, inputs), formula])
    ]);
  }

  function bind(root) {
    root.addEventListener("input", (e) => remember(e.target));
    for (const key of KEYS) {
      for (const [id] of CARDS[key].fields) {
        const n = byId(id);
        if (!n) continue;
        n.addEventListener("input", () => {
          update(key);
          // Spoken once typing pauses, never per keystroke.
          m.say.soon(() => speech(key));
        });
        n.addEventListener("paste", (e) => onPaste(e, n));
        n.addEventListener("keydown", (e) => {
          if (e.key === "Enter") calculateAndRecord(key);
        });
      }
    }
  }

  function remember(target) {
    const id = target && typeof target.getAttribute === "function" ? target.getAttribute("id") : null;
    if (id && FIELD_IDS.includes(id)) model.fields[id] = target.value;
  }

  function restoreModel() {
    for (const id of FIELD_IDS) {
      const n = byId(id);
      if (n && typeof model.fields[id] === "string") n.value = model.fields[id];
    }
  }

  function render(ctx) {
    leave();
    const t = ctx.t;
    const liveRegion = el("p", { className: "sr-only", attrs: { id: "percentLayoutLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const resultLive = el("p", { className: "sr-only", attrs: { id: "percentResultLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const container = el("div", { className: "tool-cards", attrs: { id: "percentCards" } });
    m = { ctx, t, seq: Object.fromEntries(KEYS.map((k) => [k, 0])), last: {}, say: ns.announcer.create(resultLive) };
    m.layout = ns.cardLayout.create({
      container,
      keys: KEYS.slice(),
      title: (key) => t("percent.card." + key),
      t,
      state: ns.cardLayout.normalise(KEYS, ctx.settings.percent),
      live: liveRegion,
      hintId: "percentCardMoveHint",
      onChange: (s, o) => saveLayout(ctx, s, o)
    });
    container.replaceChildren(...KEYS.map((k) => buildCard(k)));
    const clearAllBtn = el("button", { className: "button", text: t("percent.clearAll"), attrs: { type: "button", id: "percentClearAllBtn" } });
    clearAllBtn.addEventListener("click", () => clearAll());
    const root = el("div", { className: "percent-tool", attrs: { id: "percentTool" } }, [
      el("div", { className: "tool-bar" }, [el("p", { className: "hint tool-bar-text", text: t("percent.toolHint") }), clearAllBtn]),
      el("p", { className: "sr-only", text: t("layout.moveHint"), attrs: { id: "percentCardMoveHint" } }),
      liveRegion,
      resultLive,
      container
    ]);
    m.root = root;
    restoreModel();
    m.layout.mount();
    bind(root);
    setTaxMode(model.taxMode, false);
    const mine = m;
    m.ready = (async () => {
      await Promise.resolve();
      if (mine !== m) return;
      await Promise.all(KEYS.map((k) => update(k)));
    })();
    return [root];
  }

  function saveLayout(ctx, s, o) {
    ctx.settings.percent.cardOrder = s.cardOrder;
    ctx.settings.percent.collapsedCards = s.collapsedCards;
    ctx.percentLayoutNote = o && o.reset ? "reset" : null;
    return ctx.saveSettings();
  }

  // Leaving the route (or re-rendering it): drop the document listeners and
  // a pending announcement.
  function leave() {
    if (!m) return;
    m.say.cancel();
    m.layout.destroy();
    m = null;
  }

  // Settings > Percentage > Layout > Reset card order & expand all.
  function resetLayout(ctx) {
    if (m) {
      m.layout.reset();
      return Promise.resolve();
    }
    return saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: [] }, { reset: true });
  }

  // The Settings sections: Percentage > Layout.
  function settingsPanels(ctx) {
    const t = ctx.t;
    const reset = el("button", { className: "button", text: t("layout.reset"), attrs: { type: "button", id: "percentLayoutResetBtn" } });
    const note = el("p", { className: "status", attrs: { id: "percentLayoutNote", role: "status", "aria-live": "polite" } });
    const noteText = () => {
      const o = ctx.outcomes.settings;
      if (ctx.store.kind === "memory" || (o && o.readOnly)) return t("layout.note.session");
      return t(ctx.percentLayoutNote === "reset" ? "layout.note.reset" : "layout.note.saved");
    };
    note.textContent = noteText();
    reset.addEventListener("click", async () => {
      await resetLayout(ctx);
      note.textContent = noteText();
    });
    return [
      el("h2", { className: "settings-group-title", text: t("percent.set.group"), attrs: { id: "settingsPercentTitle" } }),
      el("section", { className: "panel", attrs: { id: "settingsPercentLayout" } }, [
        el("h2", { className: "panel-title", text: t("layout.title") }),
        el("div", { className: "button-row" }, [reset]),
        note
      ])
    ];
  }

  ns.percentTool = Object.freeze({
    KEYS,
    render,
    leave,
    resetLayout,
    settingsPanels,
    ready: () => (m ? m.ready : Promise.resolve()),
    model: () => JSON.parse(JSON.stringify(model))
  });
})();
