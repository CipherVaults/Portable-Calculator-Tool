// safety-eval slices B and C for the Date tool (M2b), ported from Date
// Calculator v1.2.0's safety-eval (calendar-click-*, biz-range-pick,
// calendar-keyboard, calendar-out-of-range-disabled, layout-*, countdown-*)
// onto the shell: the real web sources and the real engine.wasm in the
// mini-DOM (scripts/lib/mini-dom.mjs), under the web adapter (IndexedDB)
// and the desktop adapter (a fake Tauri bridge). The clock is fixed
// (createWindow's `now`), so every expectation is exact.
//
//   B.date-*        the cards, calendars, business pick, layout, settings
//                   the history hook, results spoken once, LTR runs and
//                   Clear all on a phone
//   C.countdowns-*  the countdown list in the "countdowns" document:
//                   restore, finished while closed, no write on a tick,
//                   the cap of 20, read-only documents, other tabs (merge
//                   on write by id), labels by code points, the pane's Open
// Each rule has a mutant in DATE_MUTANTS that the same test must catch.
import { createOrigin, tick, until } from "./mini-dom.mjs";
import { bootApp, fakeTauri } from "./web-harness.mjs";

// 2026-11-19 12:00:00 local time (a Thursday), the fixed "now".
const NOW = new Date(2026, 10, 19, 12, 0, 0, 0).getTime();
const KEYS = ["between", "add", "business", "age", "info", "countdown"];
const attr = (n, a) => (n ? n.getAttribute(a) : null);

function countdownsDoc(items) {
  return JSON.stringify({ schemaVersion: 1, items });
}
function item(over) {
  return Object.assign({ id: "cd-a", label: "Trip", targetDate: "2026-12-31", targetTime: "09:00", createdAtMs: NOW - 5000, savedAtMs: NOW - 5000, finishedSeenAtMs: null }, over);
}

// Writes a raw value under `name` in pcalc/docs (as another app version
// or another tab would), bypassing the validators.
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

function input(app, id, value, types = ["input"]) {
  const n = app.byId(id);
  n.value = value;
  for (const type of types) n.dispatchEvent(new app.window.Event(type));
}

const settle = async (app) => {
  await app.PCalc.dateTool.ready();
  await tick(60);
};

const cellOf = (app, grid, iso) => app.byId(grid).children.find((c) => c.getAttribute("data-date") === iso) || null;

// ---------------------------------------------------------------------------
// Slice B
// ---------------------------------------------------------------------------

export function dateBTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/date", ...o });

  return {
    async "date-cards-live"(src) {
      // Every card renders the engine's live result, trace and result
      // text; Arabic-Indic digits in an amount become ASCII.
      const app = await boot({ overrides: src });
      await settle(app);
      const idle = KEYS.every((k) => app.byId(k + "Live").textContent === "→ —");
      // Date Calculator v1.2.0's own wording (B9: ported unchanged).
      const addHint = app.byId("addTrace").textContent === "date ± years, months (clamped to month end) → ± weeks, days = result";
      input(app, "betweenStart", "2024-01-01");
      input(app, "betweenEnd", "2024-12-31");
      input(app, "addStart", "2024-01-31");
      input(app, "addMonths", "١");
      input(app, "bizStart", "2026-11-02");
      input(app, "bizEnd", "2026-11-20");
      input(app, "ageBirth", "2000-02-29");
      input(app, "infoDate", "2024-02-29");
      input(app, "cdTarget", "2026-11-20");
      input(app, "cdTime", "12:00");
      await until(() => app.byId("countdownLive").textContent !== "→ —" && app.byId("infoLive").textContent !== "→ —", 3000);
      await tick(120);
      const got = {
        between: app.byId("betweenLive").textContent,
        add: app.byId("addLive").textContent,
        amount: app.byId("addMonths").value,
        clamp: app.byId("addResult").textContent.includes("The day was moved to the last day of the month."),
        business: app.byId("businessLive").textContent,
        age: app.byId("ageLive").textContent,
        info: app.byId("infoLive").textContent,
        clock: app.byId("cdClock").textContent,
        trace: app.byId("betweenTrace").children.length > 1,
        hours: app.byId("betweenResult").textContent.includes("8,760 hours"),
        nextBirthday: /^next birthday \w{3} 2027-02-28 · in /.test(app.byId("ageResult").children[2].textContent)
      };
      input(app, "bizStart", "2026-11-20");
      input(app, "bizEnd", "2026-11-02");
      await until(() => app.byId("businessResult").textContent.includes("before"), 3000);
      got.backward = app.byId("businessResult").textContent.includes(" · end date is before the start date");
      got.addHint = addHint;
      const ok = got.addHint && got.nextBirthday && got.backward && idle && got.between === "→ 365 days" && got.add === "→ 2024-02-29 (Thursday)" && got.amount === "1" && got.clamp &&
        got.business === "→ 14 business days" && got.age === "→ 26 years, 8 months, 21 days" && got.info === "→ Thursday · 2024-W09-4" &&
        got.clock === "1d 00h 00m 00s" && got.trace && got.hours;
      return { ok, detail: JSON.stringify({ idle, ...got }) };
    },

    async "date-ipc-race"(src) {
      // A slow engine answer for an older keystroke never overwrites the
      // newer result (per-card sequence counters), and a slow answer after
      // Clear leaves the card idle.
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
      input(app, "addStart", "2024-01-31");
      await tick(60);
      slow = (op, req) => op === "date.add_subtract" && JSON.parse(req).months === "1";
      input(app, "addMonths", "1");
      input(app, "addMonths", "2");
      await tick(400);
      const newer = app.byId("addLive").textContent === "→ 2024-03-31 (Sunday)";
      input(app, "addMonths", "1");
      app.byId("addClearBtn").click();
      await tick(400);
      const idle = app.byId("addLive").textContent === "→ —" && app.byId("addStart").value === "";
      return { ok: newer && idle, detail: `newer kept=${newer} (${app.byId("addLive").textContent}) idle after clear=${idle}` };
    },

    async "date-calendar-click"(src) {
      // A Date Info calendar: 42 <button> days, one tab stop, today marked;
      // a click fills the date, recomputes and marks the day selected
      // (aria-pressed, ", selected") without recording history; an
      // out-of-month day moves the view; Today changes the view only.
      const app = await boot({ overrides: src });
      await settle(app);
      const grid = app.byId("infoCalGrid");
      const cells = grid.children;
      const shape = cells.length === 42 && cells.every((c) => c.localName === "button") && grid.querySelectorAll("[tabindex='0']").length === 1;
      const today = cellOf(app, "infoCalGrid", "2026-11-19");
      const todayOk = attr(today, "aria-current") === "date";
      cellOf(app, "infoCalGrid", "2026-11-10").click();
      await until(() => app.byId("infoLive").textContent.includes("Tuesday"), 2000);
      await tick(40);
      const picked = cellOf(app, "infoCalGrid", "2026-11-10");
      const selected = app.byId("infoDate").value === "2026-11-10" && picked.classList.contains("selected") && attr(picked, "aria-pressed") === "true" && attr(picked, "aria-label").endsWith(", selected");
      const noHistory = app.PCalc.history.pending().length === 0;
      cellOf(app, "infoCalGrid", "2026-12-01").click();
      await until(() => app.byId("infoCalTitle").textContent === "December 2026", 2000);
      const moved = app.byId("infoDate").value === "2026-12-01";
      app.byId("infoCalNextBtn").click();
      await until(() => app.byId("infoCalTitle").textContent === "January 2027", 2000);
      app.byId("infoCalTodayBtn").click();
      await until(() => app.byId("infoCalTitle").textContent === "November 2026", 2000);
      const viewOnly = app.byId("infoDate").value === "2026-12-01";
      const ok = shape && todayOk && selected && noHistory && moved && viewOnly;
      return { ok, detail: JSON.stringify({ shape, todayOk, selected, noHistory, moved, viewOnly }) };
    },

    async "date-calendar-keyboard"(src) {
      // Arrows, Home/End and PageUp/PageDown (Shift = a year, month ends
      // clamped) move focus without selecting, across months, with exactly
      // one tabindex=0 on the focused day; Enter selects and keeps focus.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "infoDate", "2026-01-31");
      await until(() => app.byId("infoCalTitle").textContent === "January 2026", 2000);
      await tick(40);
      cellOf(app, "infoCalGrid", "2026-01-20").focus();
      const pointerStop = attr(cellOf(app, "infoCalGrid", "2026-01-20"), "tabindex") === "0" && app.byId("infoCalGrid").querySelectorAll("[tabindex='0']").length === 1;
      cellOf(app, "infoCalGrid", "2026-01-31").focus();
      const steps = [];
      const at = () => (app.document.activeElement.getAttribute ? app.document.activeElement.getAttribute("data-date") : null);
      const press = async (key, mods) => {
        app.document.press(key, mods);
        await tick(60);
        await until(() => app.byId("infoCalGrid").contains(app.document.activeElement), 1000);
        steps.push(key + (mods && mods.shift ? "+shift" : "") + "=" + at());
      };
      await press("ArrowRight");
      await press("ArrowLeft");
      await press("ArrowDown");
      await press("ArrowUp");
      await press("Home");
      await press("End");
      await press("PageUp");
      await press("PageDown", { shift: true });
      const want = ["ArrowRight=2026-02-01", "ArrowLeft=2026-01-31", "ArrowDown=2026-02-07", "ArrowUp=2026-01-31", "Home=2026-01-26", "End=2026-02-01", "PageUp=2026-01-01", "PageDown+shift=2027-01-01"];
      const stops = app.byId("infoCalGrid").querySelectorAll("[tabindex='0']");
      const oneStop = stops.length === 1 && stops[0] === app.document.activeElement;
      const notSelected = app.byId("infoDate").value === "2026-01-31";
      app.document.press("Enter");
      await until(() => app.byId("infoDate").value === "2027-01-01", 1500);
      await tick(80);
      const entered = app.byId("infoDate").value === "2027-01-01" && at() === "2027-01-01";
      const ok = pointerStop && steps.join() === want.join() && oneStop && notSelected && entered;
      return { ok, detail: JSON.stringify({ pointerStop, steps, oneStop, notSelected, entered }) };
    },

    async "date-calendar-out-of-range"(src) {
      // Days after 9999-12-31 are disabled (and only they are): no click,
      // no focus move onto them; the next-month button stops there.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "infoDate", "9999-12-29");
      await until(() => app.byId("infoCalTitle").textContent === "December 9999", 2000);
      await tick(60);
      const cells = app.byId("infoCalGrid").children;
      const disabled = cells.filter((c) => c.hasAttribute("disabled")).map((c) => c.getAttribute("data-date"));
      const onlyAfter = disabled.length === 9 && disabled.every((d) => d.startsWith("10000-"));
      const nextOff = app.byId("infoCalNextBtn").hasAttribute("disabled");
      cells[cells.length - 1].click();
      await tick(60);
      const noPick = app.byId("infoDate").value === "9999-12-29";
      cellOf(app, "infoCalGrid", "9999-12-31").focus();
      app.document.press("ArrowRight");
      await tick(80);
      const stayed = app.document.activeElement.getAttribute("data-date") === "9999-12-31";
      const ok = onlyAfter && nextOff && noPick && stayed;
      return { ok, detail: JSON.stringify({ disabled: disabled.length, onlyAfter, nextOff, noPick, stayed }) };
    },

    async "date-biz-pick"(src) {
      // Business Days picks go start -> end -> start; Shift+click sets the
      // end; focusing an input picks its target; typing a start moves the
      // target to the empty end; marks come from the fields (the end is
      // marked even when the engine range stops a day earlier).
      const app = await boot({ overrides: src });
      await settle(app);
      const hint = () => app.byId("bizCalHint").textContent;
      const first = hint() === "Next click sets the start date." && app.byId("bizPickStart").checked;
      cellOf(app, "bizCalGrid", "2026-11-09").click();
      await until(() => app.byId("bizStart").value === "2026-11-09", 1500);
      const toEnd = hint() === "Next click sets the end date." && app.byId("bizPickEnd").checked;
      cellOf(app, "bizCalGrid", "2026-11-13").click();
      await until(() => app.byId("bizEnd").value === "2026-11-13", 1500);
      await until(() => app.byId("businessLive").textContent !== "→ —", 1500);
      await tick(80);
      const back = hint() === "Next click sets the start date.";
      const end = cellOf(app, "bizCalGrid", "2026-11-13");
      const start = cellOf(app, "bizCalGrid", "2026-11-09");
      const marks = start.classList.contains("pick-start") && end.classList.contains("pick-end") && attr(end, "aria-label").endsWith(", end") && !end.classList.contains("in-range");
      const shiftEv = new app.window.Event("click", { props: { shiftKey: true } });
      cellOf(app, "bizCalGrid", "2026-11-20").dispatchEvent(shiftEv);
      await until(() => app.byId("bizEnd").value === "2026-11-20", 1500);
      const shift = app.byId("bizStart").value === "2026-11-09";
      app.byId("bizEnd").focus();
      const focusEnd = hint() === "Next click sets the end date.";
      app.byId("bizStart").focus();
      const focusStart = hint() === "Next click sets the start date.";
      app.byId("businessClearBtn").click();
      await tick(60);
      input(app, "bizStart", "2026-11-02", ["input", "change"]);
      await tick(60);
      const typed = hint() === "Next click sets the end date.";
      const ok = first && toEnd && back && marks && shift && focusEnd && focusStart && typed;
      return { ok, detail: JSON.stringify({ first, toEnd, back, marks, shift, focusEnd, focusStart, typed }) };
    },

    async "date-calendar-view-follows-click"(src) {
      // A click on another month's day moves the Business Days view there;
      // typed input keeps the earlier-date anchoring.
      const app = await boot({ overrides: src });
      await settle(app);
      input(app, "bizStart", "2026-10-05");
      input(app, "bizEnd", "2026-11-20");
      await until(() => app.byId("bizCalTitle").textContent === "October 2026", 2000);
      const typed = app.byId("bizCalTitle").textContent === "October 2026";
      app.byId("bizCalNextBtn").click();
      await until(() => app.byId("bizCalTitle").textContent === "November 2026", 2000);
      app.byId("bizPickEnd").click();
      cellOf(app, "bizCalGrid", "2026-12-02").click();
      await until(() => app.byId("bizEnd").value === "2026-12-02", 1500);
      await until(() => app.byId("bizCalTitle").textContent === "December 2026", 2000);
      await tick(80);
      const followed = app.byId("bizCalTitle").textContent === "December 2026";
      return { ok: typed && followed, detail: `typed anchor=${typed} click follows=${followed} title=${app.byId("bizCalTitle").textContent}` };
    },

    async "date-layout-collapse-persist"(src) {
      // Every card has a ⠿ handle and a collapse button (aria-expanded,
      // aria-controls); collapsing hides only the body (inputs keep their
      // values, live results keep updating), saves settings.date, and the
      // next launch restores it without writing.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin });
      await settle(app);
      const heads = KEYS.every((k) => {
        const card = app.byId("card-" + k);
        const h = card.querySelector(".card-handle");
        const c = card.querySelector(".card-collapse");
        return h && c && attr(h, "aria-label") === "Move " + app.byId("card-" + k + "-title").textContent && attr(c, "aria-controls") === "card-" + k + "-body" && attr(c, "aria-expanded") === "true";
      });
      input(app, "betweenStart", "2024-01-01");
      app.byId("card-between").querySelector(".card-collapse").click();
      input(app, "betweenEnd", "2024-12-31");
      await until(() => app.byId("betweenLive").textContent === "→ 365 days", 1500);
      const hidden = app.byId("card-between-body").hasAttribute("hidden") && attr(app.byId("card-between").querySelector(".card-collapse"), "aria-expanded") === "false" && app.byId("betweenStart").value === "2024-01-01";
      await until(() => {
        const s = origin.indexedDB.peek("pcalc", "settings");
        return s && JSON.parse(s).date.collapsedCards.includes("between");
      }, 2000);
      const before = origin.indexedDB.peek("pcalc", "settings");
      const writes = origin.indexedDB.writes;
      const again = await boot({ overrides: src, origin });
      await settle(again);
      const restored = again.byId("card-between-body").hasAttribute("hidden") && again.byId("card-between").classList.contains("is-collapsed");
      const quiet = origin.indexedDB.peek("pcalc", "settings") === before;
      const ok = heads && hidden && restored && quiet;
      return { ok, detail: JSON.stringify({ heads, hidden, restored, quiet, writesBefore: writes }) };
    },

    async "date-layout-keyboard-reorder"(src) {
      // ArrowUp/ArrowDown on a focused handle move its card one place, save,
      // keep focus on the handle and announce the position; at an end
      // nothing moves and the position is announced again.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin });
      await settle(app);
      const order = () => app.byId("dateCards").children.map((c) => c.getAttribute("data-card")).join(",");
      const h = app.byId("card-age").querySelector(".card-handle");
      h.focus();
      app.document.press("ArrowUp");
      const up = order() === "between,add,age,business,info,countdown" && app.document.activeElement === h && app.byId("dateLayoutLive").textContent === "Moved Age to position 3 of 6.";
      const top = app.byId("card-between").querySelector(".card-handle");
      top.focus();
      app.document.press("ArrowUp");
      const edgeText = "Moved Days Between Two Dates to position 1 of 6.";
      const atEdge = order().startsWith("between,") && app.byId("dateLayoutLive").textContent === edgeText;
      // The same words again are announced again (cleared, then set).
      app.document.press("ArrowUp");
      const edge = atEdge && order().startsWith("between,") && app.byId("dateLayoutLive").textContent === "";
      await tick(90);
      const again = app.byId("dateLayoutLive").textContent === edgeText;
      app.document.press("ArrowDown", { shift: true });
      const modified = order().startsWith("between,");
      await until(() => {
        const s = origin.indexedDB.peek("pcalc", "settings");
        return s && JSON.parse(s).date.cardOrder.join() === "between,add,age,business,info,countdown";
      }, 2000);
      const saved = JSON.parse(origin.indexedDB.peek("pcalc", "settings")).date.cardOrder.join() === "between,add,age,business,info,countdown";
      const ok = up && edge && again && modified && saved;
      return { ok, detail: JSON.stringify({ up, edge, again, modified, saved, order: order() }) };
    },

    async "date-layout-pointer-reorder"(src) {
      // Phone first: a touch that wobbles 8 px starts no drag; 14 px does,
      // and the drop reorders and saves; a mouse starts after 4 px; a
      // pointercancel, a secondary button and a non-primary pointer move
      // nothing; no drag class or drop line is left behind.
      const app = await boot({ overrides: src });
      await settle(app);
      const cards = app.byId("dateCards");
      const order = () => cards.children.map((c) => c.getAttribute("data-card")).join(",");
      const layoutRects = () => {
        cards.children.forEach((c, i) => {
          c.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 90, left: 0, right: 390, width: 390, height: 90 });
        });
        cards.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 390, width: 390, height: 600 });
      };
      layoutRects();
      const ev = (type, props) => new app.window.Event(type, { props: Object.assign({ pointerId: 7, isPrimary: true, button: 0 }, props) });
      const handle = (key) => app.byId("card-" + key).querySelector(".card-handle");
      const gesture = (key, pointerType, points, end = "pointerup", extra = {}) => {
        const h = handle(key);
        h.dispatchEvent(ev("pointerdown", Object.assign({ pointerType, clientX: points[0][0], clientY: points[0][1] }, extra)));
        for (const [x, y] of points.slice(1)) h.dispatchEvent(ev("pointermove", { pointerType, clientX: x, clientY: y }));
        const [x, y] = points[points.length - 1];
        h.dispatchEvent(ev(end, { pointerType, clientX: x, clientY: y }));
      };
      const start = order();
      const ih = handle("info");
      ih.dispatchEvent(ev("pointerdown", { pointerType: "touch", clientX: 20, clientY: 445 }));
      ih.dispatchEvent(ev("pointermove", { pointerType: "touch", clientX: 24, clientY: 449 }));
      ih.dispatchEvent(ev("pointermove", { pointerType: "touch", clientX: 20, clientY: 437 }));
      const noDragClass = !app.byId("card-info").classList.contains("is-dragging");
      ih.dispatchEvent(ev("pointerup", { pointerType: "touch", clientX: 20, clientY: 437 }));
      ih.click();
      const tapOpens = app.byId("cardMoveMenu") && !app.byId("cardMoveMenu").hasAttribute("hidden");
      app.document.press("Escape");
      const wobble = order() === start && noDragClass && tapOpens;
      gesture("info", "touch", [[20, 445], [20, 431], [20, 150], [20, 120]]);
      const touchMoved = order() === "between,info,add,business,age,countdown";
      layoutRects();
      gesture("countdown", "mouse", [[20, 545], [20, 551], [20, 300], [20, 10]], "pointercancel");
      const cancelled = order() === "between,info,add,business,age,countdown";
      gesture("countdown", "mouse", [[20, 545], [20, 40], [20, 10]], "pointerup", { button: 2 });
      const secondary = order() === "between,info,add,business,age,countdown";
      gesture("countdown", "touch", [[20, 545], [20, 40], [20, 10]], "pointerup", { isPrimary: false });
      const second = order() === "between,info,add,business,age,countdown";
      gesture("countdown", "mouse", [[20, 545], [20, 540], [20, 300], [20, 10]]);
      const mouseMoved = order().startsWith("countdown,");
      const clean = app.document.querySelectorAll(".is-dragging").length === 0 && app.document.querySelectorAll(".drop-before").length === 0 && app.document.querySelectorAll(".drop-after").length === 0;
      await tick(60);
      const saved = app.window.PCalc ? true : false;
      const ok = wobble && touchMoved && cancelled && secondary && second && mouseMoved && clean && saved;
      return { ok, detail: JSON.stringify({ wobble, touchMoved, cancelled, secondary, second, mouseMoved, clean, order: order() }) };
    },

    async "date-layout-move-menu"(src) {
      // WCAG 2.5.7: a tap on a handle opens one Move up / Move down / Done
      // group under that card's title row with focus on Move up; the ends
      // are aria-disabled (focus stays); each move keeps focus on the
      // pressed button; Done, a second tap and Escape close it onto the
      // handle; the click that ends a real drag opens nothing.
      const app = await boot({ overrides: src });
      await settle(app);
      const order = () => app.byId("dateCards").children.map((c) => c.getAttribute("data-card")).join(",");
      const menu = () => app.byId("cardMoveMenu");
      const h = app.byId("card-between").querySelector(".card-handle");
      h.focus();
      h.click();
      const opened = menu() && !menu().hasAttribute("hidden") && attr(menu(), "role") === "group" && attr(menu(), "aria-label") === "Move Days Between Two Dates" &&
        app.byId("card-between").contains(menu()) && app.document.activeElement.getAttribute("data-value") === "up";
      const up = menu().querySelector("button[data-value='up']");
      const down = menu().querySelector("button[data-value='down']");
      const edgeMarked = attr(up, "aria-disabled") === "true" && attr(down, "aria-disabled") === null;
      up.click();
      const stayed = order().startsWith("between,") && app.document.activeElement === up;
      down.click();
      const moved = order().startsWith("add,between,") && app.document.activeElement === down && app.byId("dateLayoutLive").textContent === "Moved Days Between Two Dates to position 2 of 6." && attr(up, "aria-disabled") === null;
      menu().querySelector("button[data-value='done']").click();
      const done = menu().hasAttribute("hidden") && app.document.activeElement === h;
      h.click();
      h.click();
      const toggled = menu().hasAttribute("hidden") && app.document.activeElement === h;
      h.click();
      app.document.press("Escape");
      const escaped = menu().hasAttribute("hidden") && app.document.activeElement === h;
      h.click();
      h.focus();
      app.document.press("Escape");
      const escOnHandle = menu().hasAttribute("hidden") && app.document.activeElement === h;
      // A real drag ends with a click on the handle: no menu.
      const cards = app.byId("dateCards");
      cards.children.forEach((c, i) => {
        c.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 90, left: 0, right: 390, width: 390, height: 90 });
      });
      cards.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 390, width: 390, height: 600 });
      const ev = (type, y) => new app.window.Event(type, { props: { pointerId: 3, pointerType: "mouse", isPrimary: true, button: 0, clientX: 10, clientY: y } });
      const ah = app.byId("card-age").querySelector(".card-handle");
      ah.dispatchEvent(ev("pointerdown", 345));
      ah.dispatchEvent(ev("pointermove", 300));
      ah.dispatchEvent(ev("pointermove", 10));
      ah.dispatchEvent(ev("pointerup", 10));
      ah.click();
      const noMenuAfterDrag = menu().hasAttribute("hidden");
      const ok = opened && edgeMarked && stayed && moved && done && toggled && escaped && escOnHandle && noMenuAfterDrag;
      return { ok, detail: JSON.stringify({ opened, edgeMarked, stayed, moved, done, toggled, escaped, escOnHandle, noMenuAfterDrag }) };
    },

    async "date-layout-reset"(src) {
      // Settings > Layout > Reset restores the default order and expands
      // every card without touching any input, saves the defaults and says
      // so; the next launch reads them.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin });
      await settle(app);
      input(app, "infoDate", "2024-02-29");
      app.byId("card-info").querySelector(".card-handle").focus();
      app.document.press("ArrowUp");
      app.byId("card-age").querySelector(".card-collapse").click();
      await app.window.location.assignHash("#/settings");
      await until(() => app.html.getAttribute("data-route") === "settings", 2000);
      app.byId("dateLayoutResetBtn").click();
      await until(() => {
        const s = origin.indexedDB.peek("pcalc", "settings");
        const d = s && JSON.parse(s).date;
        return d && d.cardOrder.join() === KEYS.join() && d.collapsedCards.length === 0;
      }, 2000);
      await tick(40);
      const note = app.byId("dateLayoutNote").textContent === "Card order reset and every card expanded.";
      app.window.location.assignHash("#/date");
      await until(() => app.html.getAttribute("data-route") === "date", 2000);
      await settle(app);
      const view = app.byId("dateCards").children.map((c) => c.getAttribute("data-card")).join() === KEYS.join() && app.document.querySelectorAll(".tool-card.is-collapsed").length === 0;
      const kept = app.byId("infoDate").value === "2024-02-29";
      const next = await boot({ overrides: src, origin });
      await settle(next);
      const launch = next.byId("dateCards").children.map((c) => c.getAttribute("data-card")).join() === KEYS.join();
      const ok = note && view && kept && launch;
      return { ok, detail: JSON.stringify({ note, view, kept, launch }) };
    },

    async "date-settings-calendar"(src) {
      // Weekend presets and custom days save through the engine check (a
      // seven-day weekend is refused, nothing saved); Egypt switches the
      // weekend to Fri/Sat and shows the Hijri offset (bounded at ±2);
      // leaving Egypt keeps the weekend; a hostile custom-holiday name
      // stays literal text; a holiday can be switched off; the first day
      // of the week reaches the mini calendars.
      const origin = createOrigin();
      const app = await boot({ overrides: src, origin, href: "https://example.test/p/#/settings" });
      await until(() => app.byId("weekendNote") && app.byId("weekendNote").textContent !== "", 3000);
      const cal = () => JSON.parse(origin.indexedDB.peek("pcalc", "settings") || "{}").date.calendar;
      const done = () => app.PCalc.dateSettings.ready();
      app.byId("weekend-friSat").click();
      await done();
      const fri = cal().weekend.join() === "5,6";
      app.byId("weekend-custom").click();
      for (const d of [1, 2, 3, 4]) {
        const box = app.byId("weekendDay" + d);
        box.checked = true;
        box.dispatchEvent(new app.window.Event("change"));
        await done();
      }
      const six = cal().weekend.join() === "1,2,3,4,5,6" && app.byId("weekendNote").textContent === "1 working day per week.";
      const seventh = app.byId("weekendDay7");
      seventh.checked = true;
      seventh.dispatchEvent(new app.window.Event("change"));
      await done();
      const refused = cal().weekend.join() === "1,2,3,4,5,6" && app.byId("weekendError").textContent === "The weekend cannot cover all seven days." && !seventh.checked;
      app.byId("weekend-satSun").click();
      await done();
      const preset = app.byId("holidayPresetSelect");
      preset.value = "eg";
      preset.dispatchEvent(new app.window.Event("change"));
      await done();
      const egypt = cal().preset === "eg" && cal().weekend.join() === "5,6" && !app.byId("hijriBlock").hasAttribute("hidden");
      for (let i = 0; i < 4; i++) {
        app.byId("hijriPlusBtn").click();
        await done();
      }
      const bounded = cal().hijriOffsetDays === 2 && app.byId("hijriOffsetValue").textContent === "+2" && app.byId("hijriPlusBtn").hasAttribute("disabled");
      preset.value = "uk";
      preset.dispatchEvent(new app.window.Event("change"));
      await done();
      await until(() => app.byId("holidayPreviewList").querySelectorAll("input").length > 3, 2000);
      const keepsWeekend = cal().preset === "uk" && cal().weekend.join() === "5,6";
      const box = app.byId("holidayPreviewList").querySelector("input");
      box.checked = false;
      box.dispatchEvent(new app.window.Event("change"));
      await done();
      const excluded = cal().excludedHolidays.uk.length === 1;
      const hostile = "<img src=x onerror=alert(1)>";
      app.byId("customHolidayName").value = hostile;
      app.byId("customHolidayDate").value = "2026-12-02";
      app.byId("customHolidayAddBtn").click();
      await until(() => cal().customHolidays.length === 1, 2000);
      await tick(20);
      const literal = app.byId("customHolidayList").textContent.includes(hostile) && app.byId("customHolidayList").querySelectorAll("img").length === 0;
      const fdw = app.byId("firstDayOfWeekSelect");
      fdw.value = "sunday";
      fdw.dispatchEvent(new app.window.Event("change"));
      await until(() => JSON.parse(origin.indexedDB.peek("pcalc", "settings")).date.firstDayOfWeek === "sunday", 2000);
      app.window.location.assignHash("#/date");
      await until(() => app.html.getAttribute("data-route") === "date", 2000);
      await settle(app);
      const sunday = app.byId("infoCalWeekdays").children[0].textContent === "Sun";
      const ok = fri && six && refused && egypt && bounded && keepsWeekend && excluded && literal && sunday;
      return { ok, detail: JSON.stringify({ fri, six, refused, egypt, bounded, keepsWeekend, excluded, literal, sunday }) };
    },

    async "date-history-hook"(src) {
      // Calculate, Enter and Copy record through history.record (queued
      // until M3); live typing and calendar picks never record.
      const app = await boot({
        overrides: src,
        seed: (w) => {
          w.navigator.clipboard = { writeText: async () => undefined };
        }
      });
      await settle(app);
      const n = () => app.PCalc.history.pending().length;
      input(app, "betweenStart", "2024-01-01");
      input(app, "betweenEnd", "2024-12-31");
      cellOf(app, "infoCalGrid", "2026-11-10").click();
      await tick(120);
      const live = n() === 0;
      app.byId("betweenCalcBtn").click();
      await until(() => n() === 1, 1500);
      app.byId("betweenEnd").focus();
      app.document.press("Enter");
      await until(() => n() === 2, 1500);
      app.byId("infoCopyBtn").click();
      await until(() => n() === 3, 1500);
      const entries = app.PCalc.history.pending();
      const shape = entries[0].tool === "date" && entries[0].calculator === "between" && entries[0].inputs.startDate === "2024-01-01" && entries[2].calculator === "info" && entries[0].timestampMs === NOW;
      const ok = live && n() === 3 && shape;
      return { ok, detail: JSON.stringify({ live, count: n(), first: entries[0] }) };
    },

    async "date-desktop-adapter"(src) {
      // The same tool under the desktop adapter: engine calls go through
      // engine_call, the layout and a countdown through store_save.
      const holder = await bootApp({ web, engine, now: NOW, href: "https://example.test/p/#/about" });
      const w = holder.window.PCalc;
      const tauri = fakeTauri((op, req) => w.platforms.web.engine(op, req), w.store.createDocStore, w.store.memoryBackend);
      const app = await boot({ overrides: src, tauri });
      await settle(app);
      input(app, "betweenStart", "2024-01-01");
      input(app, "betweenEnd", "2024-12-31");
      input(app, "cdTarget", "2027-01-01", ["input", "change"]);
      app.byId("card-age").querySelector(".card-collapse").click();
      await until(() => app.byId("betweenLive").textContent === "→ 365 days", 2000);
      await until(() => tauri.log.some((l) => l.cmd === "store_save" && l.args.name === "countdowns"), 2000);
      await tick(60);
      const ops = new Set(tauri.log.filter((l) => l.cmd === "engine_call").map((l) => l.args.op));
      const saves = tauri.log.filter((l) => l.cmd === "store_save").map((l) => l.args.name);
      const ok = app.html.getAttribute("data-store") === "file" && ops.has("date.days_between") && ops.has("date.month_grid") && ops.has("date.countdown") &&
        saves.includes("countdowns") && saves.includes("settings");
      return { ok, detail: `store=${app.html.getAttribute("data-store")} ops=${[...ops].join(",")} saves=${saves.join(",")}` };
    },

    async "date-results-spoken-once"(src) {
      // Plan B16: no result box is a live region (each changes per
      // keystroke); the tool's one polite region speaks a result once
      // typing pauses, at once on Enter or Calculate, never on mount.
      const app = await boot({ overrides: src });
      await settle(app);
      const region = app.byId("dateResultLive");
      const boxes = KEYS.every((k) => !app.byId(k + "Result").hasAttribute("role") && !app.byId(k + "Result").hasAttribute("aria-live"));
      const mount = attr(region, "aria-live") === "polite" && region.textContent === "";
      input(app, "betweenStart", "2024-01-01");
      input(app, "betweenEnd", "2024-12-30");
      await until(() => app.byId("betweenLive").textContent === "→ 364 days", 2000);
      input(app, "betweenEnd", "2024-12-31");
      await until(() => app.byId("betweenLive").textContent === "→ 365 days", 2000);
      const whileTyping = region.textContent === "";
      await until(() => region.textContent !== "", 2000);
      const words = app.PCalc.announcer.resultWords(app.byId("betweenResult"));
      const first = region.textContent === words && words.includes("365 days");
      // Spoken once: no second (stale) timer speaks again later.
      await tick(900);
      const paused = first && region.textContent === words;
      app.byId("betweenEnd").focus();
      app.document.press("Enter");
      await until(() => region.textContent !== words, 400);
      // The same words again: a no-break space marks the change.
      const enter = region.textContent !== words && region.textContent.trim() === words;
      const ok = boxes && mount && whileTyping && paused && enter;
      return { ok, detail: JSON.stringify({ boxes, mount, whileTyping, paused, enter, region: region.textContent }) };
    },

    async "date-ltr-isolation"(src) {
      // Plan B5c: engine English (results, expressions, trace and live
      // lines, holiday dates) sits in <bdi dir="ltr"> runs and the amount
      // fields are dir="ltr", so a right-to-left page never reorders
      // "2026-11-19 - 5 days = 2026-11-14" or shows "-5" as "5-".
      const app = await boot({ overrides: src, href: "https://example.test/p/#/settings" });
      await until(() => app.byId("holidayPresetSelect"), 3000);
      const preset = app.byId("holidayPresetSelect");
      preset.value = "us";
      preset.dispatchEvent(new app.window.Event("change"));
      await app.PCalc.dateSettings.ready();
      app.window.location.assignHash("#/date");
      await until(() => app.html.getAttribute("data-route") === "date", 2000);
      await settle(app);
      app.byId("addModeSubtractBtn").click();
      input(app, "addStart", "2026-11-19");
      input(app, "addDays", "5");
      input(app, "bizStart", "2026-12-21");
      input(app, "bizEnd", "2027-01-08");
      await until(() => app.byId("addLive").textContent === "→ 2026-11-14 (Saturday)" && !app.byId("bizHolidayHits").hasAttribute("hidden"), 3000);
      const ltrRun = (n) => Boolean(n) && n.localName === "bdi" && attr(n, "dir") === "ltr";
      const box = app.byId("addResult");
      const got = {
        main: ltrRun(box.querySelector(".result-main").children[0]),
        expression: ltrRun(box.querySelector(".result-sub").children[0]) && box.querySelector(".result-sub").textContent.includes("2026-11-14"),
        trace: app.byId("addTrace").children.length > 0 && app.byId("addTrace").children.every((li) => li.children.some(ltrRun)),
        live: app.byId("addLive").children.some(ltrRun),
        hits: app.document.querySelectorAll(".hit-date").length > 0 && Array.from(app.document.querySelectorAll(".hit-date")).every(ltrRun),
        amounts: ["addYears", "addMonths", "addWeeks", "addDays"].every((id) => attr(app.byId(id), "dir") === "ltr")
      };
      const ok = Object.values(got).every(Boolean);
      return { ok, detail: JSON.stringify(got) };
    },

    async "date-clear-all-phone"(src) {
      // Clear all on a phone (coarse pointer) keeps focus on the button: a
      // focused field would raise the keyboard and hide the bottom bar. A
      // mouse still moves focus to the first field. Both say it politely.
      const phone = await boot({ overrides: src, coarse: true });
      await settle(phone);
      input(phone, "betweenStart", "2024-01-01");
      phone.byId("dateClearAllBtn").focus();
      phone.byId("dateClearAllBtn").click();
      await tick(60);
      const kept = phone.document.activeElement === phone.byId("dateClearAllBtn") && phone.byId("betweenStart").value === "" &&
        phone.byId("dateResultLive").textContent === "All cards cleared.";
      const desk = await boot({ overrides: src });
      await settle(desk);
      desk.byId("dateClearAllBtn").click();
      await tick(60);
      const moved = desk.document.activeElement === desk.byId("betweenStart") && desk.byId("dateResultLive").textContent === "All cards cleared.";
      return { ok: kept && moved, detail: JSON.stringify({ kept, moved, phone: phone.document.activeElement.id }) };
    }
  };
}

// ---------------------------------------------------------------------------
// Slice C: the countdown list in the "countdowns" document
// ---------------------------------------------------------------------------

export function dateCTests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, now: NOW, width: 390, href: "https://example.test/p/#/date", ...o });
  const seeded = async (docs, src, extra = {}) => {
    const origin = createOrigin();
    const s = await bootApp({ web, engine, origin, now: NOW, href: "https://example.test/p/#/about" });
    for (const [name, text] of Object.entries(docs)) await putRaw(s, name, text);
    const app = await boot({ overrides: src, origin, ...extra });
    await settle(app);
    await tick(80);
    return { app, origin };
  };
  const doc = (origin) => origin.indexedDB.peek("pcalc", "countdowns");

  return {
    async "countdowns-restore-future"(src) {
      // A saved future countdown is restored at launch with its label and
      // the exact time left on the first render, the restored chip and
      // "Countdown restored: … left until …", without writing; the next
      // tick says counting down; the pane lists every countdown, ticking.
      const items = [item({ id: "cd-a", label: "Trip", savedAtMs: NOW - 9000 }), item({ id: "cd-b", label: "Exam", targetDate: "2027-06-01", targetTime: "", savedAtMs: NOW - 1000 })];
      const raw = countdownsDoc(items);
      const { app, origin } = await seeded({ countdowns: raw }, src);
      const first = {
        label: app.byId("cdLabel").value,
        target: app.byId("cdTarget").value,
        chip: app.byId("cdPhase").textContent,
        status: app.byId("cdStatus").textContent,
        clock: app.byId("cdClock").textContent
      };
      const restored = first.label === "Exam" && first.target === "2027-06-01" && first.chip === "restored" && first.status.startsWith("Countdown restored: ") && first.status.includes(" left until 2027-06-01") && first.clock !== "—";
      await app.PCalc.countdowns.tick();
      await tick(40);
      const counting = app.byId("cdPhase").textContent === "counting down" && app.byId("cdStatus").textContent.startsWith("Counting down to 2027-06-01");
      app.byId("paneToggle").click();
      app.byId("paneTab-countdowns").click();
      await until(() => app.document.querySelectorAll(".cd-row").length === 2 && /\d/.test(app.document.querySelector(".cd-row-clock").textContent), 2000);
      const pane = app.document.querySelectorAll(".cd-row").length === 2 && app.byId("countdownCount").textContent === "Countdowns: 2 of 20";
      const untouched = doc(origin) === raw || JSON.parse(doc(origin)).items.every((x, i) => x.savedAtMs === items[i].savedAtMs);
      const noWrite = app.PCalc.countdowns.writes() === 0 && untouched;
      const ok = restored && counting && pane && noWrite;
      return { ok, detail: JSON.stringify({ first, counting, pane, noWrite }) };
    },

    async "countdowns-finished-while-closed"(src) {
      // A target that passed while the app was closed (finishedSeenAtMs
      // null) shows "finished while closed" and records finishedSeenAtMs
      // once, on the first visible render; the next launch shows plain
      // finished; a hidden page records nothing.
      const raw = countdownsDoc([item({ targetDate: "2026-11-18", targetTime: "09:00" })]);
      const hiddenRun = await seeded({ countdowns: raw }, src, { seed: (w) => {
        w.document.visibilityState = "hidden";
      } });
      const hiddenNoWrite = hiddenRun.app.PCalc.countdowns.writes() === 0 && doc(hiddenRun.origin) === raw;
      const { app, origin } = await seeded({ countdowns: raw }, src);
      await until(() => JSON.parse(doc(origin)).items[0].finishedSeenAtMs !== null, 2000);
      const chip = app.byId("cdPhase").textContent;
      const status = app.byId("cdStatus").textContent;
      const closed = chip === "finished while closed" && status.startsWith("Finished while the app was closed: 2026-11-18 09:00") && app.byId("cdPhase").classList.contains("is-finished");
      const seenAt = JSON.parse(doc(origin)).items[0].finishedSeenAtMs;
      for (let i = 0; i < 3; i++) {
        app.clock.advance(1000);
        await app.PCalc.countdowns.tick();
        await tick(80);
      }
      const once = app.PCalc.countdowns.writes() === 1 && JSON.parse(doc(origin)).items[0].finishedSeenAtMs === seenAt && seenAt === NOW;
      const next = await boot({ overrides: src, origin });
      await settle(next);
      await tick(80);
      const plain = next.byId("cdPhase").textContent === "finished" && next.byId("cdStatus").textContent.startsWith("Finished: 2026-11-18 09:00");
      const ok = hiddenNoWrite && closed && once && plain;
      return { ok, detail: JSON.stringify({ hiddenNoWrite, chip, status, once, plain }) };
    },

    async "countdowns-no-write-on-tick"(src) {
      // Ticks, input events and a page hide with nothing new never write;
      // only a change commit saves; a cleared or emptied field never
      // changes the saved list.
      const raw = countdownsDoc([item({ targetDate: "2027-03-01", targetTime: "08:00" })]);
      const { app, origin } = await seeded({ countdowns: raw }, src);
      for (let i = 0; i < 3; i++) {
        app.clock.advance(1000);
        await app.PCalc.countdowns.tick();
      }
      input(app, "cdTarget", "2027-03-02");
      input(app, "cdTarget", "2027-03-01");
      await tick(80);
      app.window.dispatchEvent(new app.window.Event("pagehide"));
      app.setVisibility("hidden");
      app.setVisibility("visible");
      await tick(120);
      input(app, "cdTarget", "");
      input(app, "cdTime", "");
      await tick(80);
      const quiet = app.PCalc.countdowns.writes() === 0 && doc(origin) === raw;
      input(app, "cdTarget", "2027-03-05", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items[0].targetDate === "2027-03-05", 2000);
      await tick(60);
      const committed = app.PCalc.countdowns.writes() === 1 && JSON.parse(doc(origin)).items.length === 1;
      input(app, "cdTarget", "", ["input", "change"]);
      await tick(80);
      const kept = JSON.parse(doc(origin)).items[0].targetDate === "2027-03-05" && app.PCalc.countdowns.writes() === 1;
      const ok = quiet && committed && kept;
      return { ok, detail: JSON.stringify({ quiet, committed, kept, writes: app.PCalc.countdowns.writes() }) };
    },

    async "countdowns-list-cap-and-delete"(src) {
      // Up to 20 countdowns with labels (at most 60 characters); the 21st
      // is refused with a note; the selector switches without writing;
      // Clear starts a new one and deletes nothing; Delete removes only the
      // selected one.
      const items = [];
      for (let i = 0; i < 20; i++) items.push(item({ id: "cd-" + i, label: "N" + i, targetDate: "2027-01-" + String(i + 1).padStart(2, "0"), savedAtMs: NOW - 100000 + i }));
      const { app, origin } = await seeded({ countdowns: countdownsDoc(items) }, src);
      app.byId("countdownClearBtn").click();
      await tick(60);
      const cleared = app.byId("cdSelect").value === "" && JSON.parse(doc(origin)).items.length === 20;
      input(app, "cdLabel", "x".repeat(70), ["input"]);
      input(app, "cdTarget", "2028-01-01", ["input", "change"]);
      await tick(120);
      const full = JSON.parse(doc(origin)).items.length === 20 && app.byId("cdSavedNoteText").textContent === "At most 20 countdowns. Delete one to add another.";
      const select = app.byId("cdSelect");
      select.value = "cd-3";
      select.dispatchEvent(new app.window.Event("change"));
      await tick(80);
      const switched = app.byId("cdTarget").value === "2027-01-04" && app.byId("cdLabel").value === "N3" && app.PCalc.countdowns.writes() === 0;
      app.byId("cdDeleteBtn").click();
      await until(() => JSON.parse(doc(origin)).items.length === 19, 2000);
      const deleted = !JSON.parse(doc(origin)).items.some((x) => x.id === "cd-3") && app.byId("cdSelect").value === "";
      input(app, "cdLabel", "y".repeat(70), ["input"]);
      input(app, "cdTarget", "2028-01-01", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items.length === 20, 2000);
      const added = JSON.parse(doc(origin)).items.find((x) => x.targetDate === "2028-01-01");
      const label = added && added.label.length === 60;
      const ok = cleared && full && switched && deleted && label;
      return { ok, detail: JSON.stringify({ cleared, full, switched, deleted, label }) };
    },

    async "countdowns-read-only-never-written"(src) {
      // A countdowns document from a newer version is never written, even
      // by a commit or Delete; the card says why; the list lasts for this
      // session only.
      const raw = JSON.stringify({ schemaVersion: 2, items: [], extra: true });
      const { app, origin } = await seeded({ countdowns: raw }, src);
      input(app, "cdTarget", "2027-01-01", ["input", "change"]);
      await tick(150);
      const note = app.byId("cdSavedNoteText").textContent === "The saved countdowns are from a newer version, so they are left untouched.";
      const untouched = doc(origin) === raw && app.PCalc.countdowns.writes() === 0;
      return { ok: note && untouched, detail: `note="${app.byId("cdSavedNoteText").textContent}" untouched=${untouched}` };
    },

    async "countdowns-other-tab"(src) {
      // Another tab's commit is adopted without writing (the pane and the
      // selector follow), also while focus is in this tab's Countdown card:
      // the list follows, the field being edited keeps its text and focus.
      const origin = createOrigin();
      const a = await boot({ overrides: src, origin });
      const b = await boot({ overrides: src, origin });
      await settle(a);
      await settle(b);
      input(a, "cdLabel", "From A", ["input"]);
      input(a, "cdTarget", "2027-02-02", ["input", "change"]);
      await until(() => b.PCalc.countdowns.list().length === 1, 2000);
      const adopted = b.PCalc.countdowns.list()[0].label === "From A" && b.PCalc.countdowns.writes() === 0 && b.byId("cdSelect").children.length === 2;
      b.byId("cdLabel").focus();
      input(b, "cdLabel", "typing", ["input"]);
      input(a, "cdTarget", "2027-03-03", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items[0].targetDate === "2027-03-03", 2000);
      await until(() => b.PCalc.countdowns.list()[0].targetDate === "2027-03-03", 2000);
      await tick(120);
      const whileEditing = b.PCalc.countdowns.list()[0].targetDate === "2027-03-03" && b.PCalc.countdowns.writes() === 0 &&
        b.byId("cdLabel").value === "typing" && b.document.activeElement === b.byId("cdLabel");
      const ok = adopted && whileEditing;
      return { ok, detail: JSON.stringify({ adopted, whileEditing, list: b.PCalc.countdowns.list().map((x) => x.targetDate) }) };
    },

    async "countdowns-multitab-other-tab-item-survives"(src) {
      // The review case: tab A has focus in its label; tab B saves a new
      // countdown; A then commits a label edit. B's countdown stays on
      // disk, and B's next write keeps A's edit (no whole-list overwrite).
      const raw = countdownsDoc([item({ id: "cd-a", label: "Alpha", targetDate: "2027-01-10", savedAtMs: NOW - 1000 }), item({ id: "cd-b", label: "Beta", targetDate: "2027-01-20", savedAtMs: NOW - 9000 })]);
      const { app: a, origin } = await seeded({ countdowns: raw }, src);
      const b = await boot({ overrides: src, origin });
      await settle(b);
      await tick(80);
      a.byId("cdLabel").focus();
      b.byId("countdownClearBtn").click();
      await tick(60);
      input(b, "cdLabel", "FromTabB", ["input"]);
      input(b, "cdTarget", "2027-04-04", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items.length === 3, 2000);
      await until(() => a.PCalc.countdowns.list().length === 3, 2000);
      const aSees = a.PCalc.countdowns.list().some((x) => x.label === "FromTabB") && a.document.activeElement === a.byId("cdLabel");
      input(a, "cdLabel", "Alpha!", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items.some((x) => x.label === "Alpha!"), 2000);
      await tick(80);
      const afterA = JSON.parse(doc(origin)).items.map((x) => x.label).sort().join(",");
      const keptB = afterA === "Alpha!,Beta,FromTabB";
      await until(() => b.PCalc.countdowns.list().some((x) => x.label === "Alpha!"), 2000);
      input(b, "cdLabel", "FromTabB2", ["input", "change"]);
      await until(() => JSON.parse(doc(origin)).items.some((x) => x.label === "FromTabB2"), 2000);
      await tick(80);
      const afterB = JSON.parse(doc(origin)).items.map((x) => x.label).sort().join(",");
      const keptA = afterB === "Alpha!,Beta,FromTabB2";
      const ok = aSees && keptB && keptA;
      return { ok, detail: JSON.stringify({ aSees, afterA, afterB }) };
    },

    async "countdowns-merge-on-write"(src) {
      // A write first reads the stored list (another tab may have written
      // without this tab hearing of it yet) and merges by id: the copy
      // saved last wins, a countdown only stored stays, one deleted here
      // stays deleted, one deleted elsewhere is not brought back.
      const alpha = item({ id: "cd-a", label: "Alpha", targetDate: "2027-01-10", savedAtMs: NOW - 5000 });
      const beta = item({ id: "cd-b", label: "Beta", targetDate: "2027-01-20", savedAtMs: NOW - 6000 });
      const gamma = item({ id: "cd-c", label: "Gamma", targetDate: "2027-01-30", savedAtMs: NOW - 7000 });
      const { app, origin } = await seeded({ countdowns: countdownsDoc([alpha, beta, gamma]) }, src);
      // Another tab, unheard: Alpha renamed later, Gamma deleted, Raw added.
      const raw = item({ id: "cd-r", label: "Raw", targetDate: "2027-02-02", savedAtMs: NOW + 50 });
      await putRaw(app, "countdowns", countdownsDoc([Object.assign({}, alpha, { label: "Alpha-other", savedAtMs: NOW + 100 }), beta, raw]));
      const saved = await app.PCalc.countdowns.remove("cd-b");
      await tick(60);
      const stored = JSON.parse(doc(origin)).items.map((x) => x.id + ":" + x.label).join(",");
      const memory = app.PCalc.countdowns.list().map((x) => x.id + ":" + x.label).join(",");
      const want = "cd-a:Alpha-other,cd-r:Raw";
      const ok = saved === true && stored === want && memory === want;
      return { ok, detail: JSON.stringify({ saved, stored, memory }) };
    },

    async "countdowns-label-code-points"(src) {
      // Labels are cut by code points, as the engine counts: 59 letters and
      // an astral character (61 UTF-16 units) save and re-save intact, and
      // the next countdown saves too; a lone surrogate is replaced; a date
      // the engine refuses never enters the list.
      const long = "a".repeat(59) + "\u{1F600}";
      const { app, origin } = await seeded({ countdowns: countdownsDoc([item({ id: "cd-a", label: long })]) }, src);
      const cd = app.PCalc.countdowns;
      const edit = await cd.upsert("cd-a", { label: long + "zz", targetDate: "2027-05-05", targetTime: "" }).saved;
      const next = await cd.upsert(null, { label: "Next", targetDate: "2027-06-06", targetTime: "" }).saved;
      const lone = await cd.upsert(null, { label: "x\uD800", targetDate: "2027-07-07", targetTime: "" }).saved;
      const bad = cd.upsert(null, { label: "Bad", targetDate: "2027-02-30", targetTime: "" });
      await tick(60);
      const items = JSON.parse(doc(origin)).items;
      const first = items.find((x) => x.id === "cd-a");
      const note = cd.note((k) => k);
      const ok = edit === true && next === true && lone === true && bad.id === null && items.length === 3 &&
        first.label === long && first.targetDate === "2027-05-05" && items.some((x) => x.label === "x\uFFFD") && note !== "date.cd.note.writeFailed";
      return { ok, detail: JSON.stringify({ edit, next, lone, bad: bad.id, n: items.length, label: first && first.label.length, note }) };
    },

    async "countdowns-pane-open-reveals-card"(src) {
      // The Countdowns pane's Open closes the sheet, then (after the shell
      // has focused the view) expands the Countdown card with that
      // countdown and moves focus to its title, so a phone shows it.
      const raw = countdownsDoc([item({ id: "cd-a", label: "Trip", savedAtMs: NOW - 9000 }), item({ id: "cd-b", label: "Exam", targetDate: "2027-06-01", targetTime: "", savedAtMs: NOW - 1000 })]);
      const { app } = await seeded({ countdowns: raw }, src);
      app.byId("card-countdown").querySelector(".card-collapse").click();
      await tick(40);
      const collapsed = app.byId("card-countdown").classList.contains("is-collapsed");
      app.byId("paneToggle").click();
      app.byId("paneTab-countdowns").click();
      await until(() => app.document.querySelectorAll(".cd-row").length === 2, 2000);
      const row = Array.from(app.document.querySelectorAll(".cd-row")).find((r) => attr(r, "data-value") === "cd-a");
      row.querySelector("button").click();
      await until(() => app.document.activeElement === app.byId("card-countdown-title"), 1000);
      await tick(40);
      const got = {
        collapsed,
        focus: app.document.activeElement === app.byId("card-countdown-title"),
        expanded: !app.byId("card-countdown").classList.contains("is-collapsed"),
        label: app.byId("cdLabel").value,
        paneClosed: app.byId("pane").hasAttribute("hidden")
      };
      const ok = got.collapsed && got.focus && got.expanded && got.label === "Trip" && got.paneClosed;
      return { ok, detail: JSON.stringify(got) };
    }
  };
}

// [slice, test, file, from, to]
export const DATE_MUTANTS = [
  ["B", "date-ipc-race", "src/tools/date/date-tool.js", "if (!m || ticket !== m.seq.add) return;", "if (!m) return;\n    void ticket;"],
  ["B", "date-cards-live", "src/tools/date/date-tool.js", "const normal = ns.format.normalizeDigits(n.value);", "const normal = n.value;"],
  ["B", "date-cards-live", "i18n/en.json", "(clamped to month end)", "(clamped to the month end)"],
  ["B", "date-cards-live", "i18n/en.json", "\"end date is before the start date\"", "\"the end date is before the start date\""],
  ["B", "date-cards-live", "i18n/en.json", "\"next birthday {weekday}", "\"Next birthday {weekday}"],
  ["B", "date-calendar-click", "src/tools/date/date-tool.js", '      setField("infoDate", iso);\n      await updateInfo();', "      await updateInfo();"],
  ["B", "date-calendar-click", "src/tools/date/mini-cal.js", 'suffix += t("date.cal.suffixSelected");', "void t;"],
  ["B", "date-calendar-click", "src/tools/date/mini-cal.js", "    todayBtn.addEventListener(\"click\", () => showToday());\n", "    todayBtn.addEventListener(\"click\", () => opts.onPick(opts.today(), {}));\n"],
  ["B", "date-calendar-keyboard", "src/tools/date/mini-cal.js", "if (hadFocus && stopNode) stopNode.focus({ preventScroll: true });", "void hadFocus;"],
  ["B", "date-calendar-keyboard", "src/tools/date/mini-cal.js", "      view.focusDate = str(c.getAttribute(\"data-date\"));\n      setStop(c);", "      view.focusDate = str(c.getAttribute(\"data-date\"));"],
  ["B", "date-calendar-keyboard", "src/tools/date/mini-cal.js", "const year = event.shiftKey ? 12 : 1;", "const year = 1;"],
  ["B", "date-calendar-out-of-range", "src/tools/date/mini-cal.js", "disabled: c.outOfRange ? true : null", "disabled: null"],
  ["B", "date-biz-pick", "src/tools/date/date-tool.js", 'setBizPick(target === "end" ? "start" : "end");', "void target;"],
  ["B", "date-biz-pick", "src/tools/date/date-tool.js", 'const target = o.shift ? "end" : model.bizPick;', "const target = model.bizPick;"],
  ["B", "date-biz-pick", "src/tools/date/date-tool.js", '      if (read("bizStart") && !read("bizEnd")) setBizPick("end");', ""],
  ["B", "date-biz-pick", "src/tools/date/date-tool.js", 'on("bizEnd", ["focus"], () => setBizPick("end"));', ""],
  ["B", "date-calendar-view-follows-click", "src/tools/date/date-tool.js", "    m.anchor = iso;\n", "\n"],
  ["B", "date-layout-collapse-persist", "src/shell/card-layout.js", 'flag(c.body, "hidden", on);', "void on;"],
  ["B", "date-layout-collapse-persist", "src/shell/card-layout.js", "      if (!on && opts.onExpand) opts.onExpand(key);\n      changed();", "      if (!on && opts.onExpand) opts.onExpand(key);"],
  ["B", "date-layout-keyboard-reorder", "src/shell/card-layout.js", 'moveBy(key, e.key === "ArrowUp" ? -1 : 1, null);', 'moveBy(key, e.key === "ArrowUp" ? 1 : -1, null);'],
  ["B", "date-layout-keyboard-reorder", "src/shell/card-layout.js", "      live.textContent = \"\";\n      announceTimer", "      void live;\n      announceTimer"],
  ["B", "date-layout-pointer-reorder", "src/shell/card-layout.js", 'const threshold = drag.pointerType === "mouse" ? DRAG_START_PX : DRAG_START_TOUCH_PX;', "const threshold = DRAG_START_PX;"],
  ["B", "date-layout-pointer-reorder", "src/shell/card-layout.js", 'listen(document, "pointercancel", (e) => finishDrag(true, e));', 'listen(document, "pointercancel", (e) => finishDrag(false, e));'],
  ["B", "date-layout-pointer-reorder", "src/shell/card-layout.js", "if (drag || (event.button || 0) !== 0 || event.isPrimary === false) return;", "if (drag) return;"],
  ["B", "date-layout-move-menu", "src/shell/card-layout.js", 'if (edge) b.setAttribute("aria-disabled", "true");', "if (edge) void b;"],
  ["B", "date-layout-move-menu", "src/shell/card-layout.js", "          if (clickGuard === c.handle) {\n            clickGuard = null;\n            return;\n          }\n", ""],
  ["B", "date-layout-move-menu", "src/shell/card-layout.js", "if (menu.contains(e.target) || e.target === handle) {", "if (menu.contains(e.target)) {"],
  ["B", "date-layout-reset", "src/tools/date/date-tool.js", "saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: [] }, { reset: true });", "saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: ctx.settings.date.collapsedCards }, { reset: true });"],
  ["B", "date-settings-calendar", "src/tools/date/date-settings.js", '        if (v === "eg") next.weekend = WEEKENDS.friSat.slice();\n', ""],
  ["B", "date-settings-calendar", "src/tools/date/date-settings.js", "if (picked.length === 7) {", "if (false) {"],
  ["B", "date-settings-calendar", "src/tools/date/date-settings.js", 'flag(byId("hijriPlusBtn"), "disabled", offset >= HIJRI_OFFSET_MAX);', "void offset;"],
  ["B", "date-history-hook", "src/tools/date/date-tool.js", "    if (!m) return;\n    record(key);\n", "    if (!m) return;\n"],
  ["B", "date-results-spoken-once", "src/tools/date/date-tool.js", 'attrs: { id: key + "Result" } }', 'attrs: { id: key + "Result", role: "status", "aria-live": "polite" } }'],
  ["B", "date-results-spoken-once", "src/tools/date/date-tool.js", 'on(id, ["input"], () => m.say.soon(() => speech(key)));', 'on(id, ["input"], () => m.say.now(() => speech(key)));'],
  ["B", "date-results-spoken-once", "src/tools/date/date-tool.js", "    record(key);\n    m.say.now(() => speech(key));\n", "    record(key);\n"],
  ["B", "date-results-spoken-once", "src/shell/announcer.js", "    function soon(read) {\n      cancel();", "    function soon(read) {"],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", 'el("span", { className: "result-main" }, ltrNodes(main))', 'el("span", { className: "result-main", text: main })'],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", "const subs = [eng(r.expressionText), ", "const subs = [str(r.expressionText), "],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", ': el("li", {}, ltrNodes(l)));', ': el("li", { text: l }));'],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", "    if (n) show(n, withValues(text));", "    if (n) n.textContent = text;"],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", 'inputmode: "numeric", dir: "ltr", ', 'inputmode: "numeric", '],
  ["B", "date-ltr-isolation", "src/tools/date/date-tool.js", 'el("bdi", { className: "hit-date", text: str(h.date), attrs: { dir: "ltr" } })', 'el("span", { className: "hit-date", text: str(h.date) })'],
  ["B", "date-ltr-isolation", "src/core/dom.js", 'const KINDS = { "\\uE000": ["num", null], "\\uE002": ["ltr", "ltr"],', 'const KINDS = { "\\uE000": ["num", null], "\\uE002": ["ltr", null],'],
  ["B", "date-clear-all-phone", "src/tools/date/date-tool.js", 'const first = coarse ? byId("dateClearAllBtn") : firstFocus();', "const first = firstFocus();"],
  ["B", "date-clear-all-phone", "src/tools/date/date-tool.js", '    m.say.say(m.t("tool.cleared"));\n', "\n"],
  ["B", "date-history-hook", "src/tools/date/date-tool.js", "      await updateInfo();\n      return;\n    }\n    if (calKey === \"cd\") {", "      await updateInfo();\n      record(\"info\");\n      return;\n    }\n    if (calKey === \"cd\") {"],
  ["C", "countdowns-restore-future", "src/tools/date/countdowns.js", "flags.set(item.id, { restoredPending: fresh,", "flags.set(item.id, { restoredPending: false,"],
  ["C", "countdowns-restore-future", "src/tools/date/date-tool.js", "    const latest = list.reduce((a, b) => (b.savedAtMs > a.savedAtMs ? b : a));", "    const latest = list[0];"],
  ["C", "countdowns-finished-while-closed", "src/tools/date/countdowns.js", "closedFinish: fresh && finished(r) && item.finishedSeenAtMs === null", "closedFinish: false"],
  ["C", "countdowns-finished-while-closed", "src/tools/date/countdowns.js", "if (!item || item.finishedSeenAtMs !== null || hidden() || !canWrite()) return;", "if (!item || hidden() || !canWrite()) return;"],
  ["C", "countdowns-finished-while-closed", "src/tools/date/countdowns.js", "if (!item || item.finishedSeenAtMs !== null || hidden() || !canWrite()) return;", "if (!item || item.finishedSeenAtMs !== null || !canWrite()) return;"],
  ["C", "countdowns-no-write-on-tick", "src/tools/date/date-tool.js", 'for (const id of ["cdTarget", "cdTime", "cdLabel"]) on(id, ["change"], () => commitCountdown(true));', 'for (const id of ["cdTarget", "cdTime", "cdLabel"]) on(id, ["input", "change"], () => commitCountdown(true));'],
  ["C", "countdowns-no-write-on-tick", "src/tools/date/countdowns.js", "      if (samePair && item.label === label) return { id: item.id, saved: Promise.resolve(true) };\n", "\n"],
  ["C", "countdowns-list-cap-and-delete", "src/tools/date/countdowns.js", "if (items.length >= MAX) return { id: null, full: true, saved: Promise.resolve(false) };", ""],
  ["C", "countdowns-list-cap-and-delete", "src/tools/date/countdowns.js", "return chars.slice(0, LABEL_MAX).join(\"\");", "return chars.join(\"\");"],
  ["C", "countdowns-read-only-never-written", "src/tools/date/countdowns.js", 'if (o && o.status === "newer") return t("date.cd.note.newer");', ""],
  ["C", "countdowns-other-tab", "src/tools/date/countdowns.js", "    return queue(async () => {\n      const o = await ctx.store.load(\"countdowns\");\n      ctx.outcomes.countdowns = o;",
    "    const card = document.getElementById(\"card-countdown\");\n    if (card && card.contains(document.activeElement)) return Promise.resolve();\n    return queue(async () => {\n      const o = await ctx.store.load(\"countdowns\");\n      ctx.outcomes.countdowns = o;"],
  ["C", "countdowns-multitab-other-tab-item-survives", "src/tools/date/countdowns.js", "    return out.slice(0, MAX);", "    void out;\n    return mine.slice(0, MAX);"],
  ["C", "countdowns-merge-on-write", "src/tools/date/countdowns.js", "      items = merge(items, stored);\n      lastStored = idsOf(stored);\n      ensureFlags();", "      void stored;\n      ensureFlags();"],
  ["C", "countdowns-merge-on-write", "src/tools/date/countdowns.js", "    deleted.add(id);\n", ""],
  ["C", "countdowns-merge-on-write", "src/tools/date/countdowns.js", "if (own.has(here.id) && !lastStored.has(here.id)) out.push(here);", "if (own.has(here.id)) out.push(here);"],
  ["C", "countdowns-merge-on-write", "src/tools/date/countdowns.js", "let pick = dirty.has(s.id) ? (here.savedAtMs >= s.savedAtMs ? here : s) : s;", "let pick = here;"],
  ["C", "countdowns-other-tab", "src/tools/date/countdowns.js", "let pick = dirty.has(s.id) ? (here.savedAtMs >= s.savedAtMs ? here : s) : s;", "let pick = here.savedAtMs >= s.savedAtMs ? here : s;"],
  ["C", "countdowns-multitab-other-tab-item-survives", "src/tools/date/countdowns.js", "      dirty.add(item.id);\n      item = next;", "      item = next;"],
  ["C", "countdowns-pane-open-reveals-card", "src/tools/date/date-tool.js", "      window.setTimeout(() => revealCountdown(mine), 0);\n", "\n"],
  ["C", "countdowns-pane-open-reveals-card", "src/tools/date/date-tool.js", '    title.focus({ preventScroll: true });\n', "\n"],
  ["C", "countdowns-label-code-points", "src/tools/date/countdowns.js", "return chars.slice(0, LABEL_MAX).join(\"\");","return String(raw || \"\").trim().slice(0, LABEL_MAX);"],
  ["C", "countdowns-label-code-points", "src/tools/date/countdowns.js", "    const m = typeof v === \"string\" ? /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v) : null;\n    if (!m) return false;", "    if (ns.miniCal.parseIso(v) !== null) return true;\n    const m = typeof v === \"string\" ? /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v) : null;\n    if (!m) return false;"]
];

