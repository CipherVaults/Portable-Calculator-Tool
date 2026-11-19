// Countdowns (plan B9, B11; Date Calculator v1.1.0 plan A2): a list of up to
// 20 labelled countdowns in the "countdowns" document,
//   {schemaVersion: 1, items: [{id, label (<= 60), targetDate, targetTime
//    ("" or HH:MM), createdAtMs, savedAtMs, finishedSeenAtMs (null or ms)}]}
// validated by the engine (countdowns.validate) like every document.
//
// Rules carried over from A2:
//   - saved on commit only (a change, a quick pill, Today, a calendar
//     click, the page-hide flush of a typed target); never on input or a
//     tick, and an empty or invalid field never clears anything
//   - the one tick-time write: the first VISIBLE render of a finished
//     target records finishedSeenAtMs, at most once per target
//   - wording: "restored" on the first render after launch (future), then
//     "counting down"; "finished while closed" for a target that passed
//     while the app was closed (finishedSeenAtMs null at launch); plain
//     "finished" otherwise (also on the next launch)
//   - ticks recompute from absolute time, land just after each whole
//     second and pause while the page is hidden
//   - a document the store keeps read-only (newer, corrupt, unreadable) is
//     never written; the list then lasts for this session only
//   - another tab's change is adopted without writing, also while focus is
//     in the Countdown card (the card keeps the fields being edited); every
//     write first reads the stored list and merges it by id, so a countdown
//     another tab added, changed or deleted is never undone here: an id in
//     both keeps the stored copy unless this tab changed it since (then the
//     copy saved last), an id only stored stays unless it was deleted here,
//     an id only here stays unless it was stored before (then another tab
//     deleted it). The last writer wins only for one record.
//   - a label is cut at 60 characters (code points, as the engine counts);
//     a target the engine would refuse never enters the list, so one bad
//     item can never block every later save
//
// Viewers (the Countdowns pane, the Date tool's Countdown card) register
// with watch({visible(), render(now)}); one ticker serves them all.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, show, flag, value, withValues } = ns.dom;
  const MAX = 20;
  const LABEL_MAX = 60;
  const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

  let ctx = null;
  let items = [];
  // Per item, this session only: restoredPending (the "restored" render is
  // still due), closedFinish (it passed while the app was closed).
  const flags = new Map();
  let blocked = false; // the store keeps the document read-only
  let writeFailed = false;
  let chain = Promise.resolve();
  let lastStored = new Set(); // ids in the stored list at the last read or write
  const deleted = new Set(); // ids deleted here this session (never brought back)
  const dirty = new Set(); // ids changed here and not yet written
  let writes = 0; // successful writes this session (tests read it)
  const viewers = new Set();
  const listeners = new Set();
  let timer = 0;
  let pane = null; // {panel, viewer}

  const pair = (date, time) => date + "|" + time;
  // A real calendar date 0001-01-01 ..= 9999-12-31, as date-core parses it.
  function isDate(v) {
    const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  }
  const isTime = (v) => v === "" || (typeof v === "string" && TIME_RE.test(v));
  const hidden = () => document.visibilityState === "hidden";
  const idsOf = (list) => new Set(list.map((i) => i.id));

  // At most LABEL_MAX code points (the engine counts chars, not UTF-16
  // units); a lone surrogate (never valid JSON for the engine) becomes U+FFFD.
  function cleanLabel(raw) {
    const chars = Array.from(String(raw || "").trim()).map((c) => (c.length === 1 && c >= "\uD800" && c <= "\uDFFF" ? "\uFFFD" : c));
    return chars.slice(0, LABEL_MAX).join("");
  }

  async function call(op, req) {
    try {
      return JSON.parse(await ctx.platform.engine(op, JSON.stringify(req)));
    } catch (_) {
      return null;
    }
  }

  function readOutcome(o) {
    blocked = Boolean(o && o.readOnly);
    let list = [];
    if (o && o.status === "ok" && typeof o.doc === "string") {
      try {
        const doc = JSON.parse(o.doc);
        if (doc && Array.isArray(doc.items)) list = doc.items;
      } catch (_) {
        list = [];
      }
    }
    return list.map((i) => Object.assign({}, i));
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (_) {
        // One broken listener must not stop the others.
      }
    }
  }

  // The engine's countdown for an item at `now` ({date, time, offset}).
  function evaluate(item, now) {
    return call("date.countdown", {
      now,
      target: { date: item.targetDate, time: item.targetTime, utcOffsetMinutes: ns.clock.offsetAt(item.targetDate, item.targetTime) }
    });
  }

  const finished = (r) => Boolean(r && r.ok === "true" && (r.result.status === "past" || r.result.status === "now"));

  // Launch: every stored item is "restored"; one that is already finished
  // and was never seen finished passed while the app was closed.
  async function classify(list, fresh) {
    const now = ns.clock.nowMoment();
    for (const item of list) {
      if (flags.has(item.id) && !fresh) continue;
      const r = await evaluate(item, now);
      flags.set(item.id, { restoredPending: fresh, closedFinish: fresh && finished(r) && item.finishedSeenAtMs === null });
    }
  }

  async function init(c) {
    ctx = c;
    items = readOutcome(ctx.outcomes.countdowns);
    lastStored = idsOf(items);
    flags.clear();
    await classify(items, true);
    ns.bus.on("countdowns-changed", () => adoptOther());
    document.addEventListener("visibilitychange", () => {
      if (hidden()) {
        stopTimer();
        for (const fn of flushers) fn();
      } else {
        tick();
      }
    });
    window.addEventListener("pagehide", () => {
      for (const fn of flushers) fn();
    });
    window.addEventListener("pageshow", (e) => {
      if (e && e.persisted) tick();
    });
  }

  // After Retry or Start fresh in the banner: the document is read again.
  async function reload() {
    items = readOutcome(ctx.outcomes.countdowns);
    lastStored = idsOf(items);
    flags.clear();
    await classify(items, true);
    writeFailed = false;
    notify();
    tick();
  }

  // This tab's list merged with the stored one (see the header).
  function merge(mine, stored) {
    const own = new Map(mine.map((i) => [i.id, i]));
    const out = [];
    for (const s of stored) {
      if (deleted.has(s.id)) continue;
      const here = own.get(s.id);
      if (!here) {
        out.push(s);
        continue;
      }
      own.delete(s.id);
      // A copy this tab did not change is only a cache of the stored one.
      let pick = dirty.has(s.id) ? (here.savedAtMs >= s.savedAtMs ? here : s) : s;
      const other = pick === here ? s : here;
      if (pick.finishedSeenAtMs === null && other.finishedSeenAtMs !== null && pair(pick.targetDate, pick.targetTime) === pair(other.targetDate, other.targetTime)) {
        pick = Object.assign({}, pick, { finishedSeenAtMs: other.finishedSeenAtMs });
      }
      out.push(pick);
    }
    for (const here of mine) if (own.has(here.id) && !lastStored.has(here.id)) out.push(here);
    // Two tabs adding at once can pass the cap: the stored ones stay.
    return out.slice(0, MAX);
  }

  function ensureFlags() {
    for (const item of items) if (!flags.has(item.id)) flags.set(item.id, { restoredPending: false, closedFinish: false });
  }

  // Runs `fn` after every queued write and adoption (they never interleave).
  function queue(fn) {
    const result = chain.then(fn, fn);
    chain = result.then(() => undefined, () => undefined);
    return result;
  }

  // Another tab wrote the document: merge it in without writing. The card
  // keeps the fields being edited (date-tool's onCountdownsChanged).
  function adoptOther() {
    return queue(async () => {
      const o = await ctx.store.load("countdowns");
      ctx.outcomes.countdowns = o;
      const stored = readOutcome(o);
      // A list the store now keeps read-only lasts for this session only.
      if (!(o && o.readOnly)) {
        items = merge(items, stored);
        lastStored = idsOf(stored);
      }
      await classify(items, false);
      ensureFlags();
      notify();
      tick();
    });
  }

  // ---- writing ----------------------------------------------------------------

  function canWrite() {
    if (blocked) return false;
    const o = ctx.outcomes.countdowns;
    return !(o && o.readOnly);
  }

  // Writes run one at a time, in order; each reads the stored list first and
  // writes the merge (see the header). The returned promise settles with
  // this write's outcome (true = saved) and the chain never rejects.
  function write() {
    if (!canWrite()) return Promise.resolve(false);
    return queue(async () => {
      if (!canWrite()) return false;
      const o = await ctx.store.load("countdowns");
      if (o && o.readOnly) {
        ctx.outcomes.countdowns = o;
        blocked = true;
        notify();
        return false;
      }
      const stored = readOutcome(o);
      items = merge(items, stored);
      lastStored = idsOf(stored);
      ensureFlags();
      const written = items;
      const r = await ctx.store.save("countdowns", JSON.stringify({ schemaVersion: 1, items: written }));
      if (r.ok) {
        writes++;
        writeFailed = false;
        lastStored = idsOf(written);
        // Written: unless changed again meanwhile, the stored copy rules.
        for (const item of written) if (items.includes(item)) dirty.delete(item.id);
        ctx.outcomes.countdowns = { name: "countdowns", status: "ok", readOnly: false, doc: r.text, schemaVersion: null, backup: null, field: null };
      } else if (r.code === "read_only") {
        blocked = true;
      } else {
        writeFailed = true;
      }
      notify();
      return r.ok;
    });
  }

  function newId() {
    const taken = new Set(items.map((i) => i.id));
    for (let k = 0; k < 50; k++) {
      const n = window.crypto && window.crypto.getRandomValues ? window.crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 0x100000000);
      const id = "cd-" + Date.now().toString(36) + "-" + n.toString(16).padStart(8, "0");
      if (!taken.has(id)) return id;
    }
    return null;
  }

  // Saves {label, targetDate, targetTime} into item `id`, or a new item when
  // id is null. Returns {id, saved} ({id: null} when nothing was taken).
  function upsert(id, fields) {
    const label = cleanLabel(fields.label);
    if (!isDate(fields.targetDate) || !isTime(fields.targetTime)) return { id: null, saved: Promise.resolve(false) };
    const now = Date.now();
    let item = id ? items.find((i) => i.id === id) : null;
    if (item) {
      const samePair = pair(item.targetDate, item.targetTime) === pair(fields.targetDate, fields.targetTime);
      if (samePair && item.label === label) return { id: item.id, saved: Promise.resolve(true) };
      const next = Object.assign({}, item, { label, targetDate: fields.targetDate, targetTime: fields.targetTime, savedAtMs: now });
      if (!samePair) {
        next.finishedSeenAtMs = null;
        flags.set(item.id, { restoredPending: false, closedFinish: false });
      }
      items = items.map((i) => (i.id === item.id ? next : i));
      dirty.add(item.id);
      item = next;
    } else {
      if (items.length >= MAX) return { id: null, full: true, saved: Promise.resolve(false) };
      const newIdValue = newId();
      if (!newIdValue) return { id: null, saved: Promise.resolve(false) };
      item = { id: newIdValue, label, targetDate: fields.targetDate, targetTime: fields.targetTime, createdAtMs: now, savedAtMs: now, finishedSeenAtMs: null };
      items = items.concat(item);
      dirty.add(item.id);
      flags.set(item.id, { restoredPending: false, closedFinish: false });
    }
    notify();
    const saved = write();
    schedule();
    return { id: item.id, saved };
  }

  function remove(id) {
    if (!items.some((i) => i.id === id)) return Promise.resolve(false);
    items = items.filter((i) => i.id !== id);
    deleted.add(id);
    flags.delete(id);
    notify();
    return write();
  }

  // The one tick-time write: a finished target first seen on a visible
  // screen records when, once.
  function markSeen(id) {
    const item = items.find((i) => i.id === id);
    if (!item || item.finishedSeenAtMs !== null || hidden() || !canWrite()) return;
    const next = Object.assign({}, item, { finishedSeenAtMs: Date.now() });
    items = items.map((i) => (i.id === id ? next : i));
    dirty.add(id);
    write();
  }

  // ---- phases -------------------------------------------------------------------

  // The phase of an item for a result: restored, counting, finished or
  // finishedClosed.
  function phaseOf(item, r) {
    const f = flags.get(item.id) || { restoredPending: false, closedFinish: false };
    if (finished(r)) return f.closedFinish ? "finishedClosed" : "finished";
    return f.restoredPending ? "restored" : "counting";
  }

  // After a visible render: "restored" was shown once; a finished target
  // has been seen.
  function rendered(item, r) {
    const f = flags.get(item.id);
    if (f && f.restoredPending) f.restoredPending = false;
    if (finished(r)) markSeen(item.id);
  }

  function whenText(r) {
    return r.targetDate + " " + r.targetTime + " (" + r.targetWeekday + ")";
  }

  function statusText(t, phase, r) {
    const when = whenText(r);
    if (phase === "finishedClosed") return t("date.cd.finishedClosed", { when });
    if (phase === "finished") return t("date.cd.finished", { when });
    if (phase === "restored") return t("date.cd.restored", { left: r.text, when });
    return t("date.cd.counting", { when });
  }

  // ---- the ticker ---------------------------------------------------------------

  function stopTimer() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  function schedule() {
    stopTimer();
    if (hidden()) return;
    let any = false;
    for (const v of viewers) if (v.visible()) any = true;
    if (!any) return;
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
  }

  let ticking = false;
  let again = false; // a tick was asked for while one was running
  async function tick() {
    stopTimer();
    if (hidden()) return;
    if (ticking) {
      again = true;
      return;
    }
    ticking = true;
    again = false;
    try {
      const now = ns.clock.nowMoment();
      for (const v of Array.from(viewers)) {
        if (!v.visible()) continue;
        try {
          await v.render(now);
        } catch (_) {
          // A failed render waits for the next tick.
        }
      }
    } finally {
      ticking = false;
    }
    if (again) tick();
    else schedule();
  }

  function watch(viewer) {
    viewers.add(viewer);
    return () => {
      viewers.delete(viewer);
      schedule();
    };
  }

  // Page hide: the card flushes a typed but uncommitted target.
  const flushers = new Set();
  function onFlush(fn) {
    flushers.add(fn);
    return () => flushers.delete(fn);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // ---- the Countdowns pane -------------------------------------------------------

  function note(t) {
    const o = ctx.outcomes.countdowns;
    if (o && o.status === "newer") return t("date.cd.note.newer");
    if (blocked || (o && o.readOnly)) return t("date.cd.note.unreadable");
    if (writeFailed) return t("date.cd.note.writeFailed");
    if (ctx.store.kind === "memory") return t("date.cd.note.session");
    return items.length ? t("date.cd.note.saved") : "";
  }

  function labelOf(t, item) {
    return item.label || t("date.cd.untitled");
  }

  function renderPane(panel) {
    leavePane();
    const t = ctx.t;
    const list = el("ul", { className: "cd-list", attrs: { id: "countdownList", "aria-label": t("pane.tab.countdowns") } });
    const count = el("p", { className: "status", attrs: { id: "countdownCount" } });
    const noteNode = el("p", { className: "hint", attrs: { id: "countdownPaneNote" } });
    const rows = new Map();

    function build() {
      const tt = ctx.t;
      const fmt = (v) => value(ns.format.formatNumber(String(v), ctx.lang, { digits: ctx.digits, grouping: "none" }));
      show(count, withValues(tt("date.cd.count", { count: fmt(items.length), max: fmt(MAX) })));
      const n = note(tt);
      noteNode.textContent = n;
      flag(noteNode, "hidden", n === "");
      rows.clear();
      if (items.length === 0) {
        show(list, [el("li", { className: "cd-empty", text: tt("date.cd.paneEmpty") })]);
        return;
      }
      const sorted = items.slice().sort((a, b) => (a.targetDate + a.targetTime < b.targetDate + b.targetTime ? -1 : 1));
      show(list, sorted.map((item) => {
        const chip = el("span", { className: "cd-phase", attrs: { hidden: true } });
        const clock = el("p", { className: "cd-row-clock", text: "—" });
        const status = el("p", { className: "cd-row-status" });
        const open = el("button", { className: "button", text: tt("date.cd.open"),
          attrs: { type: "button", "aria-label": tt("date.cd.openLabel", { label: labelOf(tt, item) }) } });
        open.addEventListener("click", () => {
          if (ns.dateTool) ns.dateTool.selectCountdown(item.id);
          if (ctx.shell) {
            if (ctx.shell.modal() === "pane") ctx.shell.closeModal({ restoreFocus: false });
            ctx.shell.navigate("date", { focus: true });
          }
        });
        const row = el("li", { className: "cd-row", attrs: { "data-value": item.id } }, [
          el("div", { className: "cd-row-head" }, [el("bdi", { className: "cd-row-label", text: labelOf(tt, item), attrs: { dir: "auto" } }), chip]),
          clock,
          status,
          el("div", { className: "button-row" }, [open])
        ]);
        rows.set(item.id, { chip, clock, status, item });
        return row;
      }));
    }

    async function render(now) {
      const tt = ctx.t;
      for (const [, row] of rows) {
        const r = await evaluate(row.item, now);
        if (!r || r.ok !== "true") {
          row.clock.textContent = "—";
          row.status.textContent = tt("date.error.failed");
          continue;
        }
        const res = r.result;
        const phase = phaseOf(row.item, r);
        row.clock.textContent = res.clockText;
        row.clock.classList.toggle("is-past", res.status === "past");
        row.status.textContent = statusText(tt, phase, res);
        row.chip.textContent = tt("date.cd.phase." + phase);
        flag(row.chip, "hidden", false);
        row.chip.classList.toggle("is-finished", phase === "finished" || phase === "finishedClosed");
        rendered(row.item, r);
      }
    }

    show(panel, [count, noteNode, list]);
    build();
    const viewer = {
      visible: () => panel.isConnected && !panel.closest("[hidden]") && list.isConnected,
      render
    };
    const unwatch = watch(viewer);
    const unsubscribe = subscribe(() => {
      if (!list.isConnected) return;
      build();
      if (viewer.visible()) render(ns.clock.nowMoment());
    });
    pane = { unwatch, unsubscribe };
    tick();
  }

  function leavePane() {
    if (!pane) return;
    pane.unwatch();
    pane.unsubscribe();
    pane = null;
  }

  window.PCalc.countdowns = Object.freeze({
    MAX,
    LABEL_MAX,
    init,
    reload,
    list: () => items.map((i) => Object.assign({}, i)),
    get: (id) => {
      const i = items.find((x) => x.id === id);
      return i ? Object.assign({}, i) : null;
    },
    upsert,
    remove,
    evaluate,
    phaseOf,
    rendered,
    statusText,
    watch,
    tick,
    // Starts the ticker for a viewer that has just rendered (no render now).
    wake: () => schedule(),
    onFlush,
    subscribe,
    note: (t) => note(t),
    writable: () => canWrite(),
    writes: () => writes,
    renderPane,
    leavePane
  });
})();
