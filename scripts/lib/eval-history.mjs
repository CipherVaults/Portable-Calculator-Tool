// safety-eval slices B and C for the history (plan B10, M3) and the ± key:
// the real web sources and the real engine.wasm in the mini-DOM
// (scripts/lib/mini-dom.mjs, whose fake IndexedDB runs readwrite
// transactions one at a time as browsers do), under the web adapter
// (IndexedDB) and the desktop adapter (a fake Tauri bridge), with a fixed
// clock.
//
//   B.history-*  recording on Calculate / Enter / Copy only (and never with
//                history.enabled off), the panel: search (case, Arabic-Indic
//                digits, every word), filters, Today / Yesterday / This week
//                / Earlier, windowed rows (2,200 entries), Restore (inputs,
//                tax mode, the current language), Use result (the focused
//                or first compatible field, nothing when none fits), Pin,
//                Note (dir=auto, 200), Delete with a 5 s Undo, Clear all
//                with "Keep pinned" on by default, the desktop adapter
//                (store_save_if, export_file and the path shown)
//   B.sign-*     the ± key on every signed Percentage and Date amount field
//                (not on the bill, tip % and people), flipping Western and
//                Arabic-Indic numbers and keeping the field's focus
//   C.history-*  the history document's durability: newer = read-only and
//                never written (new entries kept in memory and shown),
//                corrupt or a dropped entry = backup first then read-only,
//                too large = read-only and never corrupt, unreadable then
//                Retry, "Start a new history" confirmed and backed up, a
//                quota failure that keeps every entry and a banner with
//                Export, two windows recording at once (no lost write, a
//                delete not undone, both views in sync over
//                BroadcastChannel), the caps (pinned never evicted), the
//                export / import round trip (preview counts, idempotent,
//                never replacing an entry, refusals) and the CSV export
// Each rule has a mutant in HISTORY_MUTANTS that the same test must catch.
import { createOrigin, tick, until } from "./mini-dom.mjs";
import { bootApp, fakeTauri } from "./web-harness.mjs";

const NOW = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
const HOUR = 3600000;
const DAY = 24 * HOUR;
const STORE = "src/history/history-store.js";
const PANEL = "src/history/history-panel.js";
const IO = "src/history/history-io.js";
const SIGN = "src/shell/sign-toggle.js";

const attr = (n, a) => (n ? n.getAttribute(a) : null);
const text = (app, id) => (app.byId(id) ? app.byId(id).textContent : null);

function input(app, id, value) {
  const n = app.byId(id);
  n.value = value;
  n.dispatchEvent(new app.window.Event("input"));
}

// Valid B10 entries.
function dateInfo(id, ts, date = "2026-11-19", extra = {}) {
  return { id, timestampMs: ts, tool: "date", calculator: "info", calculatorLabel: "Date Info", inputs: { date }, expressionText: "",
    inputsText: date, resultText: "Info for " + date, copyText: "Info for " + date, pinned: false, note: null, engine: "date-core 1.0.0", ...extra };
}
function dateBetween(id, ts, extra = {}) {
  return { id, timestampMs: ts, tool: "date", calculator: "between", calculatorLabel: "Days Between", inputs: { startDate: "2024-01-01", endDate: "2024-12-31", includeEndDay: "false" },
    expressionText: "", inputsText: "2024-01-01 → 2024-12-31", resultText: "365 days · 52 weeks, 1 day", copyText: "365 days", pinned: false, note: null, engine: "date-core 1.0.0", ...extra };
}
function dateAdd(id, ts, extra = {}) {
  return { id, timestampMs: ts, tool: "date", calculator: "add", calculatorLabel: "Add / Subtract", inputs: { date: "2026-01-31", operation: "subtract", years: "", months: "1", weeks: "", days: "", businessDays: "false" },
    expressionText: "", inputsText: "2026-01-31 - 1m", resultText: "2025-12-31 (Wednesday)", copyText: "2026-01-31 - 1 month = 2025-12-31", pinned: false, note: null, engine: "date-core 1.0.0", ...extra };
}
function pctChange(id, ts, extra = {}) {
  return { id, timestampMs: ts, tool: "percent", calculator: "change", calculatorLabel: "Percentage Change", inputs: { inputA: "150", inputB: "180" }, expressionText: "",
    inputsText: "From 150 to 180", resultText: "20.00% increase", copyText: "20.00% increase", pinned: false, note: null, engine: "percent-core 2.3.0", ...extra };
}
function pctTax(id, ts, extra = {}) {
  return { id, timestampMs: ts, tool: "percent", calculator: "tax", calculatorLabel: "Tax / VAT (Extract)", inputs: { inputA: "115", inputB: "15", mode: "extract" }, expressionText: "",
    inputsText: "115 incl. 15% tax", resultText: "Net: 100.00 · Tax: 15.00", copyText: "Net: 100.00", pinned: false, note: null, engine: "percent-core 2.3.0", ...extra };
}
const doc = (entries) => JSON.stringify({ schemaVersion: 1, entries });

const stored = (origin) => {
  const raw = origin.indexedDB.peek("pcalc", "history");
  try {
    return raw === undefined ? null : JSON.parse(raw);
  } catch (_) {
    return raw;
  }
};
const storedIds = (origin) => {
  const d = stored(origin);
  return d && Array.isArray(d.entries) ? d.entries.map((e) => e.id) : [];
};

// 2,000 unpinned + 200 pinned entries, newest first.
function many() {
  const out = [];
  for (let i = 0; i < 2200; i++) {
    const ts = NOW - 1000 - i * 60000;
    const id = `h-${ts}-${i}`;
    out.push(i % 11 === 5 ? dateInfo(id, ts, "2026-11-19", { pinned: true, resultText: "Pinned " + i }) : dateInfo(id, ts, "2026-11-19", { resultText: "Result " + i }));
  }
  return out.filter((e) => e.pinned).slice(0, 200).concat(out.filter((e) => !e.pinned).slice(0, 2000)).sort((a, b) => b.timestampMs - a.timestampMs);
}

async function openPane(app) {
  if (app.byId("pane").hasAttribute("hidden")) app.byId("paneToggle").click();
  if (attr(app.byId("paneTab-history"), "aria-selected") !== "true") app.byId("paneTab-history").click();
  await until(() => app.byId("historyPanel"), 2000);
  await tick(10);
}
const rows = (app) => app.document.querySelectorAll(".hist-row");
const rowIds = (app) => rows(app).map((r) => attr(r, "data-value"));
const rowButton = (app, id, which) => {
  const li = app.document.querySelector(`li[data-value='${id}']`);
  return li ? li.querySelector(`button[data-value='${which}']`) : null;
};
const idle = (app) => app.PCalc.historyStore.idle();

async function engineResult(app, op, req) {
  const r = JSON.parse(await app.PCalc.platforms.web.engine(op, JSON.stringify(req)));
  return r.ok === "true" ? r.result : r;
}

async function settleTool(app, tool) {
  await (tool === "date" ? app.PCalc.dateTool.ready() : app.PCalc.percentTool.ready());
  await tick(40);
}

// ---------------------------------------------------------------------------
// Slice B
// ---------------------------------------------------------------------------

export function historyBTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/percent", ...o });
  async function seeded(entries, o = {}) {
    const origin = o.origin || createOrigin();
    await boot({ origin, overrides: o.overrides });
    origin.indexedDB.poke("pcalc", "history", doc(entries));
    return { app: await boot({ origin, ...o }), origin };
  }

  return {
    async "history-records-explicit-actions"(src) {
      // Typing never records; Calculate writes a full B10 entry; Enter of
      // the same calculation merges with the newest (only the time moves);
      // a new one adds; Copy records; history.enabled off records nothing.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin, seed: (w) => { w.navigator.clipboard = { writeText: async () => undefined }; } });
      await settleTool(app, "percent");
      input(app, "changeOrig", "150");
      input(app, "changeNew", "180");
      await until(() => text(app, "changeLive") === "→ 20.00% increase", 2000);
      await tick(60);
      const typingNone = stored(origin) === null;
      app.byId("changeCalcBtn").click();
      await until(() => storedIds(origin).length === 1, 2000);
      await idle(app);
      const e = stored(origin).entries[0];
      const full = /^h-\d{13}-\d{1,10}$/.test(e.id) && e.timestampMs === NOW && e.tool === "percent" && e.calculator === "change" && e.calculatorLabel === "Percentage Change" &&
        JSON.stringify(e.inputs) === '{"inputA":"150","inputB":"180"}' && e.expressionText === "" && e.resultText === "20.00% increase" && e.pinned === false && e.note === null &&
        /^percent-core \d+\.\d+\.\d+$/.test(e.engine) && Object.keys(e).join() === "id,timestampMs,tool,calculator,calculatorLabel,inputs,expressionText,inputsText,resultText,copyText,pinned,note,engine";
      app.byId("changeNew").focus();
      app.document.press("Enter");
      await tick(80);
      await idle(app);
      const merged = storedIds(origin).length === 1;
      input(app, "changeNew", "210");
      await until(() => text(app, "changeLive") === "→ 40.00% increase", 2000);
      app.document.press("Enter");
      await until(() => storedIds(origin).length === 2, 2000);
      app.byId("whatX").focus();
      input(app, "whatX", "20");
      input(app, "whatY", "500");
      await until(() => text(app, "whatLive") !== "→ —", 2000);
      app.byId("whatCopyBtn").click();
      await until(() => storedIds(origin).length === 3, 2000);
      await idle(app);
      // Settings > History: recording off.
      app.window.location.hash = "#/settings";
      await until(() => app.byId("historyEnabled"), 2000);
      const box = app.byId("historyEnabled");
      const wasOn = box.checked === true;
      box.checked = false;
      box.dispatchEvent(new app.window.Event("change"));
      await tick(40);
      app.window.location.hash = "#/percent";
      await until(() => app.byId("changeCalcBtn"), 2000);
      await settleTool(app, "percent");
      input(app, "changeNew", "240");
      await until(() => text(app, "changeLive") === "→ 60.00% increase", 2000);
      app.byId("changeCalcBtn").click();
      await tick(120);
      await idle(app);
      const offNone = storedIds(origin).length === 3;
      const ok = typingNone && full && merged && wasOn && offNone;
      return { ok, detail: JSON.stringify({ typingNone, full, merged, wasOn, offNone, n: storedIds(origin).length, e }) };
    },

    async "history-search-filters-groups"(src) {
      const entries = [
        dateInfo("h-1-1", NOW - HOUR),
        pctChange("h-1-2", NOW - DAY, { pinned: true, note: "Budget ٣٦٥" }),
        dateBetween("h-1-3", NOW - 3 * DAY),
        pctTax("h-1-4", NOW - 30 * DAY)
      ];
      const { app } = await seeded(entries, { overrides: src });
      await openPane(app);
      const groups = app.document.querySelectorAll(".hist-group").map((g) => attr(g, "data-value")).join();
      const allRows = rowIds(app).join();
      const countAll = text(app, "historyCount");
      const search = async (q) => {
        const s = app.byId("historySearch");
        s.value = q;
        s.dispatchEvent(new app.window.Event("input"));
        await tick(5);
        return rowIds(app).join();
      };
      const arabic = await search("٣٦٥");
      const upper = await search("DAYS");
      const words = await search("365 days");
      const none = await search("zzz");
      const noneText = app.document.querySelector(".hist-empty") ? app.document.querySelector(".hist-empty").textContent : "";
      await search("");
      const chip = async (key) => {
        app.byId("historyFilter-" + key).click();
        await tick(5);
        return rowIds(app).join();
      };
      const pinned = await chip("pinned");
      const pinnedPressed = attr(app.byId("historyFilter-pinned"), "aria-pressed") === "true" && attr(app.byId("historyFilter-all"), "aria-pressed") === "false";
      const dateOnly = await chip("date");
      const pctOnly = await chip("percent");
      const countFiltered = text(app, "historyCount");
      const all = await chip("all");
      const ok = groups === "today,yesterday,week,earlier" && allRows === "h-1-1,h-1-2,h-1-3,h-1-4" && countAll === "4 entries" && arabic === "h-1-2,h-1-3" && upper === "h-1-3" &&
        words === "h-1-3" && none === "" && noneText === "No entry matches." && pinned === "h-1-2" && pinnedPressed && dateOnly === "h-1-1,h-1-3" && pctOnly === "h-1-2,h-1-4" &&
        countFiltered === "2 of 4 entries" && all === allRows;
      return { ok, detail: JSON.stringify({ groups, allRows, countAll, arabic, upper, words, none, noneText, pinned, pinnedPressed, dateOnly, pctOnly, countFiltered, all }) };
    },

    async "history-restore-and-use-result"(src) {
      // Restore opens the tool with the stored inputs (the tax mode too)
      // and computes again, in the CURRENT language; Use result puts the
      // value into the focused field, or the first that fits, or nowhere.
      const entries = [pctTax("h-2-1", NOW - HOUR), dateAdd("h-2-2", NOW - 2 * HOUR)];
      const { app } = await seeded(entries, { overrides: src, href: "https://example.test/p/#/about" });
      await openPane(app);
      rowButton(app, "h-2-1", "restore").click();
      await until(() => app.html.getAttribute("data-route") === "percent", 2000);
      await settleTool(app, "percent");
      await until(() => text(app, "taxLive") === "→ Net: 100.00 | Tax: 15.00", 2000);
      const tax = app.byId("taxAmount").value === "115" && app.byId("taxRate").value === "15" && attr(app.byId("taxMode-extract"), "aria-pressed") === "true" &&
        text(app, "taxLive") === "→ Net: 100.00 | Tax: 15.00" && app.document.activeElement === app.byId("card-tax-title");
      // Use result: whatY had focus last.
      app.byId("whatX").focus();
      input(app, "whatX", "20");
      app.byId("whatY").focus();
      await openPane(app);
      rowButton(app, "h-2-1", "use").click();
      await until(() => text(app, "whatLive") !== "→ —", 2000);
      const used = app.byId("whatY").value === "100.00" && app.byId("changeOrig").value === "" && /100\.00 put into/.test(text(app, "historyStatus") || "");
      // A date has no field on this route.
      await openPane(app);
      rowButton(app, "h-2-2", "use").click();
      await tick(10);
      const noTarget = (text(app, "historyStatus") || "").startsWith("No field here takes this result") && app.byId("changeOrig").value === "" && app.byId("whatY").value === "100.00";
      // Restore the date entry, then use its date in Date Info.
      rowButton(app, "h-2-2", "restore").click();
      await until(() => app.html.getAttribute("data-route") === "date", 2000);
      await settleTool(app, "date");
      await until(() => (text(app, "addLive") || "").includes("2025-12-31"), 2000);
      const date = app.byId("addStart").value === "2026-01-31" && app.byId("addMonths").value === "1" && attr(app.byId("addModeSubtractBtn"), "aria-pressed") === "true";
      app.byId("infoDate").focus();
      await openPane(app);
      rowButton(app, "h-2-2", "use").click();
      await tick(30);
      const dateUsed = app.byId("infoDate").value === "2025-12-31";
      // The current language: a pseudo-locale, then Restore again.
      app.window.location.hash = "#/settings";
      await until(() => app.byId("pseudoSelect"), 2000);
      const sel = app.byId("pseudoSelect");
      sel.value = "en-XA";
      sel.dispatchEvent(new app.window.Event("change"));
      await tick(40);
      await openPane(app);
      rowButton(app, "h-2-1", "restore").click();
      await until(() => app.html.getAttribute("data-route") === "percent", 2000);
      await settleTool(app, "percent");
      const label = text(app, "taxAmountLabel") || "";
      const lang = label !== "" && label !== "Total amount (tax-inclusive)" && app.byId("taxAmount").value === "115";
      const ok = tax && used && noTarget && date && dateUsed && lang;
      return { ok, detail: JSON.stringify({ tax, used, noTarget, date, dateUsed, lang, label, status: text(app, "historyStatus"), whatY: app.byId("whatY").value, addLive: text(app, "addLive") }) };
    },

    async "history-pin-note-delete-undo"(src) {
      const entries = [dateInfo("h-3-1", NOW - HOUR), pctChange("h-3-2", NOW - 2 * HOUR), dateBetween("h-3-3", NOW - 3 * HOUR)];
      const { app, origin } = await seeded(entries, { overrides: src });
      await openPane(app);
      rowButton(app, "h-3-1", "pin").click();
      await until(() => (stored(origin).entries.find((e) => e.id === "h-3-1") || {}).pinned === true, 2000);
      await tick(10);
      const pinBtn = rowButton(app, "h-3-1", "pin");
      const pinned = pinBtn && pinBtn.textContent === "Unpin" && attr(pinBtn, "aria-pressed") === "true" && /is-pinned/.test(attr(app.document.querySelector("li[data-value='h-3-1']"), "class"));
      rowButton(app, "h-3-2", "note").click();
      await tick(5);
      const box = app.byId("historyNoteInput");
      const noteAttrs = box && attr(box, "dir") === "auto" && attr(box, "maxlength") === "200" && app.document.activeElement === box;
      box.value = "  مرحبا 123  ";
      app.document.press("Enter");
      await until(() => (stored(origin).entries.find((e) => e.id === "h-3-2") || {}).note === "مرحبا 123", 2000);
      await tick(10);
      const noteNode = app.document.querySelector("li[data-value='h-3-2']").querySelector(".hist-note");
      const noteShown = Boolean(noteNode) && noteNode.textContent === "مرحبا 123" && attr(noteNode, "dir") === "auto";
      // Delete, Undo within 5 s: the same entry comes back.
      const before = JSON.stringify(stored(origin).entries.find((e) => e.id === "h-3-3"));
      rowButton(app, "h-3-3", "delete").click();
      await until(() => !storedIds(origin).includes("h-3-3"), 2000);
      await tick(10);
      const undoShown = !app.byId("historyUndo").hasAttribute("hidden") && Boolean(app.byId("historyUndoBtn"));
      app.byId("historyUndoBtn").click();
      await until(() => storedIds(origin).includes("h-3-3"), 2000);
      const back = JSON.stringify(stored(origin).entries.find((e) => e.id === "h-3-3")) === before && rowIds(app).includes("h-3-3");
      // Delete again and let the 5 s pass: still offered at 4.7 s, gone at 5.3 s.
      rowButton(app, "h-3-3", "delete").click();
      await until(() => !storedIds(origin).includes("h-3-3"), 2000);
      await tick(4600);
      const still = !app.byId("historyUndo").hasAttribute("hidden");
      await tick(700);
      const expired = app.byId("historyUndo").hasAttribute("hidden") && !storedIds(origin).includes("h-3-3");
      const ok = pinned && noteAttrs && noteShown && undoShown && back && still && expired;
      return { ok, detail: JSON.stringify({ pinned, noteAttrs, noteShown, undoShown, back, still, expired }) };
    },

    async "history-clear-keep-pinned"(src) {
      const entries = [1, 2, 3, 4, 5].map((i) => dateInfo(`h-4-${i}`, NOW - i * HOUR, "2026-11-19", { pinned: i === 2 || i === 4 }));
      const { app, origin } = await seeded(entries, { overrides: src });
      await openPane(app);
      app.byId("historyClearBtn").click();
      await tick(5);
      const keep = app.byId("historyKeepPinned");
      const byDefault = keep && keep.checked === true && /Delete 3 entries/.test(text(app, "historyClearConfirm"));
      keep.checked = false;
      keep.dispatchEvent(new app.window.Event("change"));
      await tick(5);
      const allCount = /Delete 5 entries/.test(text(app, "historyClearConfirm"));
      app.byId("historyKeepPinned").checked = true;
      app.byId("historyKeepPinned").dispatchEvent(new app.window.Event("change"));
      await tick(5);
      const unchanged = storedIds(origin).length === 5;
      app.byId("historyClearConfirm").click();
      await until(() => storedIds(origin).length === 2, 2000);
      const left = storedIds(origin).join() === "h-4-2,h-4-4";
      await tick(10);
      const undoText = (app.byId("historyUndo").textContent || "").includes("3 entries deleted.");
      app.byId("historyUndoBtn").click();
      await until(() => storedIds(origin).length === 5, 2000);
      const ok = byDefault && allCount && unchanged && left && undoText && storedIds(origin).length === 5;
      return { ok, detail: JSON.stringify({ byDefault, allCount, unchanged, left, undoText, ids: storedIds(origin) }) };
    },

    async "history-windowed-2200"(src) {
      // 2,200 entries: one window of rows, then Show more; search still
      // covers every entry.
      const { app } = await seeded(many(), { overrides: src });
      const t0 = Date.now();
      await openPane(app);
      const ms = Date.now() - t0;
      const first = rows(app).length;
      const count = text(app, "historyCount");
      const more = app.byId("historyMore");
      const moreText = more.textContent;
      more.click();
      await tick(5);
      const second = rows(app).length;
      const s = app.byId("historySearch");
      s.value = "Result 1999";
      s.dispatchEvent(new app.window.Event("input"));
      await tick(5);
      const found = rowIds(app).length === 1 && more.hasAttribute("hidden");
      const ok = first === 60 && count === "2,200 entries" && moreText === "Show 60 more (2,140 left)" && second === 120 && found;
      return { ok, detail: JSON.stringify({ first, count, moreText, second, found, ms }) };
    },

    async "history-desktop-adapter"(src) {
      // The desktop adapter: every history write is store_save_if; exports
      // go through export_file and the panel shows the full path.
      const holder = await bootApp({ web, engine, now: NOW, href: "https://example.test/p/#/about" });
      const w = holder.window.PCalc;
      const tauri = fakeTauri((op, req) => w.platforms.web.engine(op, req), w.store.createDocStore, w.store.memoryBackend);
      const app = await boot({ overrides: src, tauri });
      await settleTool(app, "percent");
      input(app, "changeOrig", "150");
      input(app, "changeNew", "180");
      await until(() => text(app, "changeLive") === "→ 20.00% increase", 2000);
      app.byId("changeCalcBtn").click();
      await until(() => tauri.log.some((l) => l.cmd === "store_save_if" && l.args.name === "history"), 2000);
      await idle(app);
      const viaCas = tauri.log.filter((l) => l.cmd === "store_save" && l.args.name === "history").length === 0;
      const savedDoc = await tauri.store.load("history");
      const saved = savedDoc.status === "ok" && JSON.parse(savedDoc.doc).entries.length === 1;
      await openPane(app);
      const noCopy = !app.byId("historyExportCopy");
      app.byId("historyExportJson").click();
      await until(() => tauri.exports.length === 1, 2000);
      await tick(10);
      const ex = tauri.exports[0];
      const json = ex.kind === "json" && /^\d{8}-\d{6}$/.test(ex.stamp) && JSON.parse(ex.text).format === "portable-calculator-export";
      const path = (text(app, "historyStatus") || "").includes("C:\\Users\\someone\\Downloads\\Portable-Calculator-" + ex.stamp + ".json");
      app.byId("historyExportCsv").click();
      await until(() => tauri.exports.length === 2, 2000);
      const csv = tauri.exports[1].kind === "csv" && tauri.exports[1].text.startsWith("\uFEFFid,timeUtc,timestampMs,tool,");
      const ok = viaCas && saved && noCopy && json && path && csv;
      return { ok, detail: JSON.stringify({ viaCas, saved, noCopy, json, path, csv, status: text(app, "historyStatus"), cmds: [...new Set(tauri.log.map((l) => l.cmd))] }) };
    },

    async "sign-toggle"(src) {
      // A ± key beside every field that takes a negative value: 14 in the
      // Percentage tool (not the bill, tip % or people), 4 Date amounts.
      const app = await boot({ overrides: src });
      await settleTool(app, "percent");
      const signs = app.document.querySelectorAll(".sign-button").map((b) => attr(b, "id"));
      const percentIds = signs.length === 14 && !signs.some((id) => /^tip/.test(id)) && signs.includes("changeOrigSign") && signs.includes("taxAmountSign");
      const b = app.byId("changeOrigSign");
      const labelled = attr(b, "aria-label") === "Change the sign of " + text(app, "changeOrigLabel") && attr(b, "aria-controls") === "changeOrig" && attr(b, "type") === "button";
      const mode = attr(app.byId("changeOrig"), "inputmode") === "decimal";
      input(app, "changeOrig", "150");
      input(app, "changeNew", "180");
      await until(() => text(app, "changeLive") === "→ 20.00% increase", 2000);
      app.byId("changeOrig").focus();
      const down = new app.window.Event("pointerdown");
      b.dispatchEvent(down);
      const keepsFocus = down.defaultPrevented === true;
      const wantNeg = "→ " + (await engineResult(app, "percent.change", { originalValue: -150, newValue: 180 })).liveResult;
      b.click();
      await until(() => text(app, "changeLive") === wantNeg, 2000);
      const neg = app.byId("changeOrig").value === "-150" && text(app, "changeLive") === wantNeg;
      b.click();
      await until(() => text(app, "changeLive") === "→ 20.00% increase", 2000);
      const pos = app.byId("changeOrig").value === "150";
      const wantPos = "→ " + (await engineResult(app, "percent.what", { percent: 20, number: 500 })).label;
      const wantMinus = "→ " + (await engineResult(app, "percent.what", { percent: -20, number: 500 })).label;
      input(app, "whatX", "٢٠");
      input(app, "whatY", "500");
      await until(() => text(app, "whatLive") === wantPos, 2000);
      app.byId("whatXSign").click();
      await until(() => text(app, "whatLive") === wantMinus, 2000);
      const arabic = wantPos !== wantMinus && app.byId("whatX").value === "-٢٠" && text(app, "whatLive") === wantMinus;
      app.window.location.hash = "#/date";
      await until(() => app.byId("addDaysSign"), 2000);
      await settleTool(app, "date");
      const dateSigns = app.document.querySelectorAll(".sign-button").map((x) => attr(x, "id")).join();
      input(app, "addStart", "2026-01-31");
      input(app, "addDays", "2");
      await until(() => (text(app, "addLive") || "").includes("2026-02-02"), 2000);
      app.byId("addDaysSign").click();
      await until(() => (text(app, "addLive") || "").includes("2026-01-29"), 2000);
      const date = dateSigns === "addYearsSign,addMonthsSign,addWeeksSign,addDaysSign" && app.byId("addDays").value === "-2" && attr(app.byId("addDays"), "inputmode") === "numeric";
      const ok = percentIds && labelled && mode && keepsFocus && neg && pos && arabic && date;
      return { ok, detail: JSON.stringify({ signs: signs.length, percentIds, labelled, mode, keepsFocus, neg, pos, arabic, date, dateSigns, changeLive: text(app, "changeLive"), whatLive: text(app, "whatLive"), addLive: text(app, "addLive") }) };
    }
  };
}

// ---------------------------------------------------------------------------
// Slice C
// ---------------------------------------------------------------------------

export function historyCTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/percent", ...o });
  async function calc(app, orig, next) {
    await settleTool(app, "percent");
    input(app, "changeOrig", String(orig));
    input(app, "changeNew", String(next));
    await until(() => app.PCalc.percentTool.model().fields.changeNew === String(next), 1000);
    await tick(40);
    app.byId("changeCalcBtn").click();
    await tick(20);
    await idle(app);
  }
  const banner = (app, state) => app.document.querySelector(`div[data-doc='history'][data-state='${state}']`);

  return {
    async "history-newer-is-never-written"(src) {
      // Written by a newer app: read-only, never written, never backed up;
      // new entries are shown and kept in memory with a banner.
      const origin = createOrigin();
      await boot({ origin, overrides: src });
      origin.indexedDB.poke("pcalc", "history", '{"schemaVersion":2,"entries":[]}');
      const app = await boot({ origin, overrides: src });
      const newer = Boolean(banner(app, "newer"));
      const buttons = newer ? banner(app, "newer").querySelectorAll("button").map((b) => b.textContent).join() : "";
      await calc(app, 150, 180);
      const untouched = origin.indexedDB.peek("pcalc", "history") === '{"schemaVersion":2,"entries":[]}' && origin.indexedDB.peek("pcalc", "history.bak.1") === undefined;
      await openPane(app);
      const shown = rows(app).length === 1 && Boolean(banner(app, "memory-only")) && (text(app, "historySubtitle") || "").includes("read-only");
      const ok = newer && buttons === "Retry" && untouched && shown;
      return { ok, detail: JSON.stringify({ newer, buttons, untouched, shown, raw: origin.indexedDB.peek("pcalc", "history") }) };
    },

    async "history-corrupt-backup-then-new-history"(src) {
      // A dropped entry is corruption: backup first, then read-only; a
      // confirmed "Start a new history" keeps a copy and writes the
      // session's entries into a fresh document.
      const origin = createOrigin();
      await boot({ origin, overrides: src });
      const damaged = JSON.stringify({ schemaVersion: 1, entries: [dateInfo("h-5-1", NOW - HOUR), { ...pctChange("h-5-2", NOW - 2 * HOUR), tool: "standard" }] });
      origin.indexedDB.poke("pcalc", "history", damaged);
      const app = await boot({ origin, overrides: src });
      const corrupt = Boolean(app.document.querySelector("div[data-doc='history'][data-state='corrupt']"));
      const bak = origin.indexedDB.peek("pcalc", "history.bak.1");
      const backedUp = bak && bak.raw === damaged;
      await calc(app, 150, 180);
      const untouched = origin.indexedDB.peek("pcalc", "history") === damaged;
      const reset = () => app.document.querySelectorAll("button[data-doc='history']").find((n) => attr(n, "data-state") === "idle" || attr(n, "data-state") === "armed");
      const label = reset() ? reset().textContent : "";
      reset().click();
      const armed = attr(reset(), "data-state") === "armed" && origin.indexedDB.peek("pcalc", "history") === damaged;
      reset().click();
      await until(() => storedIds(origin).length === 1, 2000);
      await idle(app);
      const fresh = stored(origin).entries[0].resultText === "20.00% increase" && origin.indexedDB.peek("pcalc", "history.bak.1").raw === damaged;
      const ok = corrupt && backedUp && untouched && label === "Start a new history" && armed && fresh && !app.document.querySelector("div[data-doc='history'][data-state='corrupt']");
      return { ok, detail: JSON.stringify({ corrupt, backedUp, untouched, label, armed, fresh, ids: storedIds(origin) }) };
    },

    async "history-too-large-and-unreadable"(src) {
      // Over the 4.5 MiB validate cap: read-only, untouched, never corrupt
      // (no backup). Unreadable: read-only; Retry then writes what the
      // session recorded meanwhile.
      const origin = createOrigin();
      await boot({ origin, overrides: src });
      const huge = '{"schemaVersion":1,"entries":[]}' + " ".repeat(4 * 1024 * 1024 + 512 * 1024);
      origin.indexedDB.poke("pcalc", "history", huge);
      const a = await boot({ origin, overrides: src });
      const tooLarge = Boolean(a.document.querySelector("div[data-doc='history'][data-state='tooLarge']")) && origin.indexedDB.peek("pcalc", "history.bak.1") === undefined;
      await calc(a, 150, 180);
      const hugeKept = origin.indexedDB.peek("pcalc", "history") === huge;
      origin.indexedDB.poke("pcalc", "history", doc([dateInfo("h-6-1", NOW - HOUR)]));
      origin.indexedDB.failReads = true;
      const b = await boot({ origin, overrides: src });
      origin.indexedDB.failReads = false;
      const unreadable = Boolean(b.document.querySelector("div[data-doc='history'][data-state='unreadable']"));
      await calc(b, 150, 180);
      const notYet = storedIds(origin).join() === "h-6-1";
      const retry = b.document.querySelectorAll("button[data-doc='history']").find((n) => n.textContent === "Retry");
      retry.click();
      await until(() => storedIds(origin).length === 2, 2000);
      const written = storedIds(origin)[0] !== "h-6-1" && storedIds(origin)[1] === "h-6-1";
      const ok = tooLarge && hugeKept && unreadable && notYet && written;
      return { ok, detail: JSON.stringify({ tooLarge, hugeKept, unreadable, notYet, written, ids: storedIds(origin) }) };
    },

    async "history-quota-keeps-entries"(src) {
      // A failed write (QuotaExceededError, at put or at commit) keeps the
      // entries in memory and on screen with a banner offering Export;
      // Try again writes them.
      const origin = createOrigin();
      const app = await boot({ origin, overrides: src });
      await calc(app, 150, 180);
      const first = storedIds(origin).length === 1;
      origin.indexedDB.quotaExceeded = true;
      await calc(app, 150, 210);
      origin.indexedDB.quotaExceeded = false;
      origin.indexedDB.quotaAtCommit = true;
      await calc(app, 150, 240);
      origin.indexedDB.quotaAtCommit = false;
      const kept = storedIds(origin).length === 1 && app.PCalc.historyStore.entries().length === 3 && app.PCalc.historyStore.status().pending === 2;
      const b = banner(app, "write-failed");
      const bannerOk = Boolean(b) && /storage is full/.test(b.textContent) && /2 new entries/.test(b.textContent) && Boolean(app.byId("historyBannerExport")) && Boolean(app.byId("historyBannerRetry"));
      await openPane(app);
      const shown = rows(app).length === 3;
      app.byId("historyBannerExport").click();
      await until(() => origin.downloads.length === 1, 2000);
      const blob = origin.downloads[0].blob;
      const exported = blob ? JSON.parse(await blob.text()).history.entries.length === 3 : false;
      app.byId("historyBannerRetry").click();
      await until(() => storedIds(origin).length === 3, 2000);
      await idle(app);
      const ok = first && kept && bannerOk && shown && exported && storedIds(origin).length === 3 && !banner(app, "write-failed");
      return { ok, detail: JSON.stringify({ first, kept, bannerOk, shown, exported, ids: storedIds(origin).length, status: app.PCalc.historyStore.status() }) };
    },

    async "history-two-windows"(src) {
      // Two windows recording at the same time: every entry is kept (the
      // compare-and-save re-applies on conflict), both views follow over
      // BroadcastChannel, and a delete in one is not undone by the other.
      const origin = createOrigin();
      const a = await boot({ origin, overrides: src });
      const b = await boot({ origin, overrides: src });
      await settleTool(a, "percent");
      await settleTool(b, "percent");
      input(a, "changeOrig", "100");
      input(b, "changeOrig", "100");
      for (let i = 1; i <= 8; i++) {
        input(a, "changeNew", String(100 + i));
        input(b, "changeNew", String(200 + i));
        await until(() => a.PCalc.percentTool.model().fields.changeNew === String(100 + i) && b.PCalc.percentTool.model().fields.changeNew === String(200 + i), 500);
        await until(() => (text(a, "changeLive") || "").includes(i + ".00%") && (text(b, "changeLive") || "").includes((100 + i) + ".00%"), 2000);
        a.byId("changeCalcBtn").click();
        b.byId("changeCalcBtn").click();
      }
      await until(() => storedIds(origin).length === 16, 4000);
      await Promise.all([idle(a), idle(b)]);
      await until(() => a.PCalc.historyStore.entries().length === 16 && b.PCalc.historyStore.entries().length === 16, 3000);
      const all = storedIds(origin).length === 16;
      const synced = a.PCalc.historyStore.entries().length === 16 && b.PCalc.historyStore.entries().length === 16;
      const victim = storedIds(origin)[5];
      const del = a.PCalc.historyStore.remove([victim]);
      input(b, "changeNew", "999");
      await until(() => (text(b, "changeLive") || "").includes("899.00%"), 2000);
      b.byId("changeCalcBtn").click();
      await del;
      await until(() => storedIds(origin).length === 16 && !storedIds(origin).includes(victim), 3000);
      await Promise.all([idle(a), idle(b)]);
      await until(() => !b.PCalc.historyStore.entries().some((e) => e.id === victim) && a.PCalc.historyStore.entries().length === 16, 3000);
      const deleteKept = !storedIds(origin).includes(victim) && storedIds(origin).length === 16 && !b.PCalc.historyStore.entries().some((e) => e.id === victim);
      const ok = all && synced && deleteKept;
      return { ok, detail: JSON.stringify({ all, synced, deleteKept, stored: storedIds(origin).length, a: a.PCalc.historyStore.entries().length, b: b.PCalc.historyStore.entries().length }) };
    },

    async "history-caps-pinned-never-evicted"(src) {
      // At the caps (2,000 unpinned + 200 pinned) a new entry evicts the
      // oldest unpinned one; every pinned entry stays; pin 201 is refused.
      const origin = createOrigin();
      await boot({ origin, overrides: src });
      const seed = many();
      origin.indexedDB.poke("pcalc", "history", doc(seed));
      const app = await boot({ origin, overrides: src });
      await calc(app, 150, 180);
      await until(() => storedIds(origin).length === 2200, 2000);
      const after = stored(origin).entries;
      const pinnedIds = seed.filter((e) => e.pinned).map((e) => e.id);
      const oldest = seed.filter((e) => !e.pinned).pop().id;
      const caps = after.filter((e) => e.pinned).length === 200 && after.filter((e) => !e.pinned).length === 2000 && pinnedIds.every((id) => after.some((e) => e.id === id)) &&
        !after.some((e) => e.id === oldest) && after[0].resultText === "20.00% increase";
      await openPane(app);
      const target = after.find((e) => !e.pinned);
      rowButton(app, target.id, "pin").click();
      await until(() => (text(app, "historyStatus") || "").startsWith("At most 200"), 2000);
      const refused = (stored(origin).entries.find((e) => e.id === target.id) || {}).pinned === false && (text(app, "historyStatus") || "").startsWith("At most 200 entries can be pinned");
      const ok = caps && refused;
      return { ok, detail: JSON.stringify({ caps, refused, status: text(app, "historyStatus") }) };
    },

    async "history-export-import-round-trip"(src) {
      // Export JSON (download and clipboard) -> import on another device:
      // "N new · M duplicates · K rejected", one write, idempotent, never
      // replacing an entry; refusals for other files.
      const origin = createOrigin();
      let clip = null;
      const a = await boot({ origin, overrides: src, seed: (w) => { w.navigator.clipboard = { writeText: async (s) => { clip = s; } }; } });
      await calc(a, 150, 180);
      await calc(a, 150, 210);
      const ids = storedIds(origin);
      await a.PCalc.historyStore.pin(ids[1], true);
      await a.PCalc.historyStore.note(ids[0], "first");
      await openPane(a);
      a.byId("historyExportJson").click();
      await until(() => origin.downloads.length === 1, 2000);
      const dl = origin.downloads[0];
      const fileText = await dl.blob.text();
      const file = JSON.parse(fileText);
      const shape = /^Portable-Calculator-20261119-120000\.json$/.test(dl.name) && file.format === "portable-calculator-export" && file.formatVersion === 1 && file.appVersion === a.build.appVersion &&
        file.exportedAtMs === NOW && file.history.entries.length === 2 && file.countdowns.schemaVersion === 1 && file.settings.schemaVersion === 1 &&
        JSON.stringify(Object.keys(file)) === '["format","formatVersion","appVersion","exportedAtMs","history","countdowns","settings"]' && (text(a, "historyStatus") || "").includes(dl.name);
      a.byId("historyExportCopy").click();
      await until(() => clip !== null, 2000);
      const clipOk = clip === fileText;
      // Another device with one of the entries already (a different note).
      const other = createOrigin();
      await boot({ origin: other, overrides: src });
      const mine = { ...file.history.entries[0], note: "mine" };
      other.indexedDB.poke("pcalc", "history", doc([mine]));
      const b = await boot({ origin: other, overrides: src });
      await openPane(b);
      const pick = async (blob) => {
        const f = b.byId("historyImportFile");
        f.files = [blob];
        f.dispatchEvent(new b.window.Event("change"));
        await until(() => !b.byId("historyImportBox").hasAttribute("hidden"), 2000);
        await tick(5);
        return text(b, "historyImportBox");
      };
      const bad = { ...file, history: { schemaVersion: 1, entries: [...file.history.entries, { id: "h-9-9", tool: "standard" }] } };
      const summary = await pick(new Blob([JSON.stringify(bad)]));
      const preview = (text(b, "historyImportSummary") || "") === "1 new · 1 duplicates · 1 rejected" && storedIds(other).length === 1;
      b.byId("historyImportConfirm").click();
      await until(() => storedIds(other).length === 2, 2000);
      await idle(b);
      const merged = stored(other).entries.find((e) => e.id === mine.id).note === "mine" && stored(other).entries.some((e) => e.id === file.history.entries[1].id && e.pinned === true);
      const again = await pick(new Blob([fileText]));
      const idem = (text(b, "historyImportSummary") || "") === "0 new · 2 duplicates · 0 rejected" && b.byId("historyImportConfirm").hasAttribute("disabled");
      b.byId("historyImportCancel").click();
      const notExport = await pick(new Blob(['{"hello":1}']));
      const newerFile = await pick(new Blob([JSON.stringify({ ...file, formatVersion: 2 })]));
      // Over 8 MiB: refused from its size, before the file is read.
      let read = false;
      const big = await pick({ size: 8 * 1024 * 1024 + 1, text: async () => { read = true; return "{}"; } });
      const refusals = /not a Portable Calculator export/.test(notExport) && /newer version/.test(newerFile) && /larger than 8 MB/.test(big) && !read && storedIds(other).length === 2;
      const ok = shape && clipOk && preview && merged && idem && refusals;
      return { ok, detail: JSON.stringify({ shape, clipOk, preview, summary, merged, idem, again, refusals, notExport, newerFile, big, name: dl.name }) };
    },

    async "history-csv-export"(src) {
      // CSV: a byte order mark, the header, and a ' before = + - @ cells.
      const origin = createOrigin();
      const app = await boot({ origin, overrides: src });
      await calc(app, -150, 180);
      const id = storedIds(origin)[0];
      await app.PCalc.historyStore.note(id, "=HYPERLINK(\"x\")");
      await openPane(app);
      app.byId("historyExportCsv").click();
      await until(() => origin.downloads.length === 1, 2000);
      const dl = origin.downloads[0];
      // The bytes: Blob.text() would drop the byte order mark.
      const bytes = new Uint8Array(await dl.blob.arrayBuffer());
      const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      const lines = csv.split("\r\n");
      const ok = bom && /^Portable-Calculator-\d{8}-\d{6}\.csv$/.test(dl.name) && lines[0] === "\uFEFFid,timeUtc,timestampMs,tool,calculator,calculatorLabel,expressionText,inputsText,resultText,copyText,pinned,note,engine" &&
        lines[1].includes(",\"'=HYPERLINK(\"\"x\"\")\",") && !lines[1].includes(",=HYPERLINK");
      return { ok, detail: JSON.stringify({ name: dl.name, head: lines[0], row: lines[1] }) };
    }
  };
}

// [slice, test, file, from, to]
export const HISTORY_MUTANTS = [
  ["B", "history-records-explicit-actions", STORE, "if (!ctx || !ctx.settings.history || ctx.settings.history.enabled === false) return Promise.resolve(false);", "if (!ctx) return Promise.resolve(false);"],
  ["B", "history-records-explicit-actions", STORE, "      engine: engineName(e.tool)", "      engine: \"engine\""],
  ["B", "history-records-explicit-actions", "src/tools/percent/percent-tool.js", "    await update(key);\n    if (!m) return;\n    record(key);", "    await update(key);\n    if (!m) return;"],
  ["B", "history-search-filters-groups", PANEL, "const norm = (s) => ns.format.normalizeDigits(String(s || \"\")).toLowerCase();", "const norm = (s) => String(s || \"\").toLowerCase();"],
  ["B", "history-search-filters-groups", PANEL, "const norm = (s) => ns.format.normalizeDigits(String(s || \"\")).toLowerCase();", "const norm = (s) => ns.format.normalizeDigits(String(s || \"\"));"],
  ["B", "history-search-filters-groups", PANEL, "return words.every((w) => k.includes(w));", "return words.some((w) => k.includes(w));"],
  ["B", "history-search-filters-groups", PANEL, "    if (diff === 1) return \"yesterday\";", "    if (diff === 1) return \"week\";"],
  ["B", "history-search-filters-groups", PANEL, "      if (ui.filter === \"pinned\" && !e.pinned) return false;\n", ""],
  ["B", "history-restore-and-use-result", "src/tools/percent/percent-tool.js", "    if (key === \"tax\") model.taxMode = i.mode === \"extract\" ? \"extract\" : \"add\";\n", ""],
  ["B", "history-restore-and-use-result", "src/tools/date/date-tool.js", "        model.addMode = i.operation === \"subtract\" ? \"subtract\" : \"add\";\n", ""],
  ["B", "history-restore-and-use-result", PANEL, "    if (lastField && lastField.isConnected && body.contains(lastField) && !lastField.closest(\"[hidden]\") && accepts(lastField, v)) return lastField;\n", ""],
  ["B", "history-restore-and-use-result", PANEL, "    if (v.kind === \"date\") return type === \"date\";", "    if (v.kind === \"date\") return true;"],
  ["B", "history-restore-and-use-result", "src/tools/percent/percent-tool.js", "      window.setTimeout(() => revealCard(mine, key), 0);", "      void mine;"],
  ["B", "history-pin-note-delete-undo", STORE, "    putBack: (entries) => mutate([{ import: entries.map((e) => JSON.parse(JSON.stringify(e))) }]),", "    putBack: () => mutate([]),"],
  ["B", "history-pin-note-delete-undo", PANEL, "  const UNDO_MS = 5000;", "  const UNDO_MS = 3000;"],
  ["B", "history-pin-note-delete-undo", PANEL, "maxlength: String(ns.historyStore.NOTE_MAX), dir: \"auto\",", "maxlength: String(ns.historyStore.NOTE_MAX),"],
  ["B", "history-pin-note-delete-undo", STORE, "    pin: (id, pinned) => mutate([{ pin: { id, pinned: Boolean(pinned) } }]),", "    pin: (id) => mutate([{ pin: { id, pinned: false } }]),"],
  ["B", "history-clear-keep-pinned", PANEL, "        ui.clearing = true;\n        ui.keepPinned = true;", "        ui.clearing = true;\n        ui.keepPinned = false;"],
  ["B", "history-clear-keep-pinned", PANEL, "      const gone = ns.historyStore.entries().filter((e) => !ui.keepPinned || !e.pinned);", "      const gone = ns.historyStore.entries();"],
  ["B", "history-windowed-2200", PANEL, "  const PAGE = 60;", "  const PAGE = 100000;"],
  ["B", "history-desktop-adapter", "src/platform/tauri.js", "core().invoke(\"store_save_if\", { name, expected: expected === undefined ? null : expected, text })", "core().invoke(\"store_save\", { name, text })"],
  ["B", "history-desktop-adapter", PANEL, "    else if (r.path) message(\"history.msg.savedTo\", { path: ns.dom.ltr(r.path) });\n", ""],
  ["B", "sign-toggle", SIGN, "    if (/^[-\\u2212]/.test(s)) return s.slice(1);\n", ""],
  ["B", "sign-toggle", "src/tools/percent/percent-tool.js", 'FIELD_IDS.filter((id) => !["tipBill", "tipPercent", "tipPeople"].includes(id))', 'FIELD_IDS.filter((id) => id !== "tipPeople")'],
  ["B", "sign-toggle", SIGN, "      if (document.activeElement === input) e.preventDefault();", "      void e;"],
  ["B", "sign-toggle", "src/tools/date/date-tool.js", "ns.signToggle.wrap(amountInput(id), t(\"field.sign\", { field: t(key) }))", "amountInput(id)"],
  ["C", "history-newer-is-never-written", STORE, "    if (pending.length === 0) {\n      view = baseValue", "    if (true) {\n      view = baseValue"],
  ["C", "history-newer-is-never-written", STORE, "    if (!ctx || pending.length === 0 || (!writeError && !blocked())) return [];", "    if (!ctx || pending.length === 0 || !writeError) return [];"],
  ["C", "history-corrupt-backup-then-new-history", "src/boot.js", "\n        if (name === \"history\") await ns.historyStore.reload();", ""],
  ["C", "history-corrupt-backup-then-new-history", "src/shell/shell.js", "const resetKey = name === \"history\" ? (armed ? \"banner.resetHistoryConfirm\" : \"banner.resetHistory\") : ", "const resetKey = "],
  ["C", "history-too-large-and-unreadable", "src/boot.js", "\n      if (name === \"history\") await ns.historyStore.reload();", ""],
  ["C", "history-quota-keeps-entries", STORE, "      writeError = { code: r.code };\n      break;", "      writeError = { code: r.code };\n      pending.length = 0;\n      break;"],
  ["C", "history-quota-keeps-entries", STORE, "      if (ctx.shell) ctx.shell.openPane(\"history\");", "      return;"],
  ["C", "history-two-windows", STORE, "const r = await ctx.store.saveIf(\"history\", base, JSON.stringify(res.result.doc));", "const r = await ctx.store.save(\"history\", JSON.stringify(res.result.doc));"],
  ["C", "history-two-windows", "src/core/store.js", "          if (current === expected) s.put(value, key);", "          if (current === expected || true) s.put(value, key);"],
  ["C", "history-two-windows", STORE, "      ns.bus.on(\"history-changed\", () => enqueue(async () => {", "      ns.bus.on(\"countdowns-changed\", () => enqueue(async () => {"],
  ["C", "history-caps-pinned-never-evicted", PANEL, "    if (!entry.pinned && s.lastApplied && s.lastApplied.pinLimit) message(", "    if (false) message("],
  ["C", "history-export-import-round-trip", IO, "      history: ns.historyStore.doc(),", "      history: { schemaVersion: 1, entries: [] },"],
  ["C", "history-export-import-round-trip", PANEL, "        await ns.historyStore.importEntries(entries);\n", ""],
  ["C", "history-export-import-round-trip", IO, "    if (file.size > IMPORT_MAX_BYTES) return { error: \"too_large\" };\n", ""],
  ["C", "history-export-import-round-trip", STORE, "      duplicates: dry.result.duplicates + p.result.fileDuplicates,", "      duplicates: dry.result.duplicates + p.result.rejected,"],
  ["C", "history-csv-export", IO, "\"\\uFEFF\" + res.result.csv", "res.result.csv"]
];
