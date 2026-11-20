// The History panel (plan B10, M3): the History tab of the History |
// Memory | Countdowns pane (a bottom sheet on phones, an overlay or a
// docked column on wider screens).
//
//   - "Saved locally on this device." (or why not), then a search field:
//     case-insensitive, digits normalised (Western, Arabic-Indic and
//     Persian digits all match each other), every word must match (Esc
//     clears a query first, then closes the pane);
//   - filter chips All / Pinned / one per tool that records history;
//   - the count, and "Your history data" (Export JSON / CSV, Copy export,
//     Import with a preview, Delete history with "Keep pinned" on by
//     default) ABOVE the list, so it is reachable with any number of rows;
//   - the entries grouped Today / Yesterday / This week / Earlier by the
//     LOCAL calendar day (today is passed in: groupOf(ms, todayIso));
//   - each row: the tool tag, the calculator, muted inputs (and the
//     expression), the result in gold, the note; the row itself is the
//     Restore button (Enter or a tap): the owning tool opens with the
//     stored inputs and computes again, so the result reads in the current
//     language. Its "Actions" button opens Copy, Use result (the value into
//     the current tool's focused or first compatible field, which then
//     takes the focus), Pin, Note (at most 200, dir=auto) and Delete;
//   - Undo for a delete or Delete history: a bar at the bottom edge of the
//     sheet, for 10 s, held open while it has focus or the pointer, with
//     Dismiss. It puts back exactly what the write removed.
// Rendering is windowed: the first PAGE rows of the filtered list, then
// "Show more" (and, where IntersectionObserver exists, more as the end of
// the list scrolls into view), so 2,200 entries stay quick on a phone. A
// row whose entry did not change is reused when the list is drawn again, so
// a pin, a note or another tab's write rebuilds one row, not all of them.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, show, flag, value, withValues } = ns.dom;
  const PAGE = 60;
  const UNDO_MS = 10000;
  // The tools that record history today (their filter chips).
  const TOOLS = Object.freeze(["date", "percent"]);
  const DAY_MS = 86400000;

  // Session state (kept while the pane re-renders).
  const ui = { query: "", filter: "all", limit: PAGE, noteFor: null, actionsFor: null, dataOpen: false, clearing: false, keepPinned: true, preview: null, undo: null, message: null };
  let ctx = null;
  let mounted = null; // {panel, unsubscribe, observer, say, rows}
  let lastField = null; // the tool field that last had focus (Use result)
  let watching = false;

  // ---- pure helpers (safety-eval tests them directly) ----------------------------

  // The local calendar day of an instant, as a day number.
  function localDay(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  }
  function isoDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS) : null;
  }
  // "today" | "yesterday" | "week" (2-6 days ago) | "earlier" (and later
  // than today, a clock set back, counts as today).
  function groupOf(ms, todayIso) {
    const today = isoDay(todayIso);
    if (today === null) return "earlier";
    const diff = today - localDay(ms);
    if (diff <= 0) return "today";
    if (diff === 1) return "yesterday";
    if (diff < 7) return "week";
    return "earlier";
  }

  const norm = (s) => ns.format.normalizeDigits(String(s || "")).toLowerCase();
  const terms = (query) => norm(query).split(/\s+/).filter(Boolean);
  // Search keys by entry id (an id's texts never change; its note can).
  const keys = new Map();
  function searchKey(entry, toolName) {
    const c = keys.get(entry.id);
    if (c && c.note === entry.note && c.tool === toolName) return c.key;
    const key = norm([toolName, entry.calculatorLabel, entry.expressionText, entry.inputsText, entry.resultText, entry.note || ""].join("\n"));
    keys.set(entry.id, { note: entry.note, tool: toolName, key });
    return key;
  }
  function matches(entry, words, toolName) {
    if (words.length === 0) return true;
    const k = searchKey(entry, toolName);
    return words.every((w) => k.includes(w));
  }

  // The value "Use result" inserts: {kind: "date", text: "2026-02-26"} or
  // {kind: "number", text: "115.00"}, or null. Groups of three may be
  // separated by a comma, a space, a no-break space or a (narrow) thin
  // space (format.js grouping), and are dropped.
  function resultValue(entry) {
    const res = ns.format.normalizeDigits(entry.resultText || "");
    if (entry.tool === "date" && (entry.calculator === "add" || entry.calculator === "info")) {
      const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(res) || /\b(\d{4}-\d{2}-\d{2})\b/.exec(ns.format.normalizeDigits(entry.copyText || ""));
      return m ? { kind: "date", text: m[1] } : null;
    }
    const m = /([-\u2212]?)((?:\d{1,3}(?:[,\u0020\u00a0\u2009\u202f]\d{3})+|\d+)(?:\.\d+)?)/.exec(res);
    if (!m) return null;
    const text = (m[1] ? "-" : "") + m[2].replace(/[,\u0020\u00a0\u2009\u202f]/g, "");
    return /^-?\d+(?:\.\d+)?$/.test(text) ? { kind: "number", text } : null;
  }

  // A field that can take `v`: a date field for a date; a decimal field
  // for any number; a whole-number field for a whole number.
  function accepts(input, v) {
    if (!input || input.localName !== "input" || input.hasAttribute("disabled") || input.hasAttribute("readonly")) return false;
    const type = String(input.getAttribute("type") || "text").toLowerCase();
    if (v.kind === "date") return type === "date";
    if (type !== "text") return false;
    const mode = input.getAttribute("inputmode");
    if (mode === "decimal") return true;
    return mode === "numeric" && /^-?\d+$/.test(v.text);
  }

  // ---- the target of Use result ---------------------------------------------------

  function watchFields() {
    if (watching) return;
    watching = true;
    document.addEventListener("focusin", (e) => {
      const n = e.target;
      if (n && n.localName === "input" && typeof n.closest === "function" && n.closest("#viewBody")) lastField = n;
    });
  }

  function targetFor(v) {
    const body = document.getElementById("viewBody");
    if (!body) return null;
    if (lastField && lastField.isConnected && body.contains(lastField) && !lastField.closest("[hidden]") && accepts(lastField, v)) return lastField;
    return Array.from(body.querySelectorAll("input")).find((n) => !n.closest("[hidden]") && accepts(n, v)) || null;
  }

  function labelOf(input) {
    const id = input.getAttribute("id");
    const label = id ? document.querySelector("label[for='" + id + "']") : null;
    return label ? label.textContent.trim() : id || "";
  }

  // ---- formatting -------------------------------------------------------------------

  const fmtNum = (n) => value(ns.format.formatNumber(String(n), ctx.lang, { digits: ctx.digits, grouping: ctx.settings.display.grouping }));
  const toolName = (tool) => ctx.t("history.tool." + tool);

  function timeText(ms, group) {
    const d = new Date(ms);
    const pad = ns.clock.pad;
    const hm = ns.format.toDigits(pad(d.getHours()) + ":" + pad(d.getMinutes()), ctx.digits);
    if (group === "today" || group === "yesterday") return hm;
    return ns.format.formatDate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }, ctx.lang, { digits: ctx.digits }) + " " + hm;
  }

  // ---- actions ---------------------------------------------------------------------

  function message(key, params) {
    ui.message = key ? { key, params: params || {} } : null;
    if (!mounted) return;
    const node = mounted.panel.querySelector("#historyStatus");
    if (node) show(node, ui.message ? withValues(ctx.t(ui.message.key, ui.message.params)) : []);
  }

  function restore(entry) {
    const tool = entry.tool === "date" ? ns.dateTool : entry.tool === "percent" ? ns.percentTool : null;
    if (!tool || typeof tool.restore !== "function") return false;
    tool.restore(entry);
    if (ctx.shell) {
      if (ctx.shell.modal() === "pane") ctx.shell.closeModal({ restoreFocus: false });
      ctx.shell.navigate(entry.tool);
    }
    return true;
  }

  async function copy(entry, button) {
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(entry.copyText);
        ok = true;
      }
    } catch (_) {
      ok = false;
    }
    message(ok ? "history.msg.copied" : "history.msg.copyFailed");
    if (ok && button && button.isConnected) {
      button.textContent = ctx.t("history.copied");
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = ctx.t("history.copy");
      }, 1200);
    }
    return ok;
  }

  // The words go to the current tool's own polite region once the pane has
  // closed (the panel's status line is no longer on screen then).
  // (each tool's one polite region is "<route>ResultLive").
  function sayInView(words) {
    const route = ctx.shell && typeof ctx.shell.route === "function" ? ctx.shell.route() : "";
    const region = route ? document.getElementById(route + "ResultLive") : null;
    if (region) ns.announcer.create(region).say(words);
  }

  function useResult(entry) {
    const v = resultValue(entry);
    const target = v ? targetFor(v) : null;
    if (!v || !target) {
      message("history.msg.noTarget");
      return false;
    }
    target.value = v.text;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    message("history.msg.used", { value: ns.dom.ltrValue(v.text), field: labelOf(target) });
    const node = mounted && mounted.panel.querySelector("#historyStatus");
    const words = node ? node.textContent : "";
    if (ctx.shell && ctx.shell.modal() === "pane") ctx.shell.closeModal({ restoreFocus: false });
    // The field takes the focus (and so the phone keyboard comes up).
    if (typeof target.focus === "function") target.focus({ preventScroll: true });
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    sayInView(words);
    return true;
  }

  function stopUndoTimer() {
    if (ui.undo && ui.undo.timer) window.clearTimeout(ui.undo.timer);
    if (ui.undo) ui.undo.timer = 0;
  }

  // The bar closes after UNDO_MS, unless focus or the pointer is on it.
  function armUndoTimer() {
    const undo = ui.undo;
    if (!undo) return;
    stopUndoTimer();
    undo.timer = window.setTimeout(() => {
      if (ui.undo !== undo) return;
      if (undo.held) return;
      closeUndo();
    }, UNDO_MS);
  }

  function closeUndo() {
    stopUndoTimer();
    ui.undo = null;
    renderUndo();
  }

  function startUndo(entries, key) {
    stopUndoTimer();
    ui.undo = { entries, key, timer: 0, held: false };
    armUndoTimer();
    renderUndo();
  }

  async function undoNow() {
    const u = ui.undo;
    if (!u) return;
    closeUndo();
    const ids = u.entries.map((e) => e.id);
    await ns.historyStore.putBack(u.entries);
    message("history.msg.restored", { count: fmtNum(u.entries.length), plural: u.entries.length });
    // Focus the first entry that came back (the Undo button is gone).
    const shown = new Set(ns.historyStore.entries().map((e) => e.id));
    focusRow(ids.find((id) => shown.has(id)) || null);
  }

  async function remove(entry) {
    // The next row on screen (the filter applies) takes the focus.
    const list = filtered().slice(0, ui.limit);
    const i = list.findIndex((e) => e.id === entry.id);
    const next = list[i + 1] || list[i - 1] || null;
    if (ui.noteFor === entry.id) ui.noteFor = null;
    if (ui.actionsFor === entry.id) ui.actionsFor = null;
    const r = await ns.historyStore.remove([entry.id]);
    // Undo puts back what the write removed (another tab's note on it
    // included); unsaved, the entry as shown here.
    const gone = r.written ? r.removed : [entry];
    if (gone.length > 0) {
      startUndo(gone, "history.undo.one");
      message("history.msg.cleared", { count: fmtNum(gone.length), plural: gone.length });
    } else if (r.missing > 0) {
      message("history.msg.missing");
    }
    focusRow(next ? next.id : null);
  }

  async function togglePin(entry) {
    const r = await ns.historyStore.pin(entry.id, !entry.pinned);
    const s = ns.historyStore.status();
    if (r.missing > 0) message("history.msg.missing");
    else if (!entry.pinned && s.lastApplied && s.lastApplied.pinLimit) message("history.msg.pinLimit", { max: fmtNum(200) });
    else message(entry.pinned ? "history.msg.unpinned" : "history.msg.pinned");
    focusRow(entry.id, r.missing > 0 ? null : "pin");
  }

  async function saveNote(entry, text) {
    ui.noteFor = null;
    const r = await ns.historyStore.note(entry.id, text);
    message(r.missing > 0 ? "history.msg.missing" : "history.msg.noteSaved");
    focusRow(entry.id, r.missing > 0 ? null : "note");
  }

  // ---- rendering ---------------------------------------------------------------------

  function filtered() {
    const words = terms(ui.query);
    return ns.historyStore.entries().filter((e) => {
      if (ui.filter === "pinned" && !e.pinned) return false;
      if (ui.filter !== "all" && ui.filter !== "pinned" && e.tool !== ui.filter) return false;
      return matches(e, words, toolName(e.tool));
    });
  }

  // An action of a row, named with its row ("Delete: Percentage Change,
  // 100.00% increase"); Pin keeps its name and says its state by
  // aria-pressed.
  function actionButton(key, text, entry, onClick, extra) {
    const label = ctx.t("history.action.label", { action: text, label: entry.calculatorLabel, result: entry.resultText });
    const b = el("button", { className: "button hist-action", text, attrs: Object.assign({ type: "button", "data-value": key, "aria-label": label }, extra || {}) });
    b.addEventListener("click", onClick);
    return b;
  }

  function noteEditor(entry) {
    const t = ctx.t;
    const input = el("input", { className: "input", attrs: { id: "historyNoteInput", type: "text", maxlength: String(ns.historyStore.NOTE_MAX), dir: "auto", autocomplete: "off", "aria-label": t("history.note.label", { label: entry.calculatorLabel }) } });
    input.value = entry.note || "";
    const save = el("button", { className: "button primary", text: t("history.note.save"), attrs: { type: "button", id: "historyNoteSave" } });
    const cancel = el("button", { className: "button", text: t("history.note.cancel"), attrs: { type: "button", id: "historyNoteCancel" } });
    save.addEventListener("click", () => saveNote(entry, input.value));
    cancel.addEventListener("click", () => {
      ui.noteFor = null;
      renderList();
      focusRow(entry.id, "note");
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveNote(entry, input.value);
      } else if (e.key === "Escape") {
        // Esc closes the note, not the pane.
        e.preventDefault();
        ui.noteFor = null;
        renderList();
        focusRow(entry.id, "note");
      }
    });
    return el("div", { className: "hist-note-edit" }, [input, el("div", { className: "button-row" }, [save, cancel])]);
  }

  function actions(entry) {
    const t = ctx.t;
    const usable = resultValue(entry) !== null;
    return el("div", { className: "hist-actions", attrs: { id: "hist-a-" + entry.id } }, [
      actionButton("copy", t("history.copy"), entry, (e) => copy(entry, e.currentTarget)),
      actionButton("use", t("history.use"), entry, () => useResult(entry), { disabled: !usable }),
      actionButton("pin", t("history.pin"), entry, () => togglePin(entry), { "aria-pressed": entry.pinned ? "true" : "false" }),
      actionButton("note", t("history.note"), entry, () => {
        ui.noteFor = entry.id;
        renderList();
        const n = mounted && mounted.panel.querySelector("#historyNoteInput");
        if (n) n.focus();
      }),
      actionButton("delete", t("history.delete"), entry, () => remove(entry))
    ]);
  }

  // What a drawn row depends on besides its id (texts never change).
  const signature = (entry, group) => [entry.timestampMs, entry.pinned, entry.note, group, ui.noteFor === entry.id, ui.actionsFor === entry.id].join("\u0001");

  function row(entry, group) {
    const sig = signature(entry, group);
    const cached = mounted && mounted.rows.get(entry.id);
    if (cached && cached.sig === sig) return cached.node;
    const node = buildRow(entry, group);
    if (mounted) mounted.rows.set(entry.id, { sig, node });
    return node;
  }

  function buildRow(entry, group) {
    const t = ctx.t;
    const id = entry.id;
    // The Restore button is named by its calculator and result; the tool,
    // time and inputs describe it.
    const main = el("button", { className: "hist-main", attrs: { type: "button", "data-value": "restore", "aria-labelledby": "hist-l-" + id + " hist-r-" + id, "aria-describedby": "hist-m-" + id + " hist-i-" + id + " historyRestoreHint" } }, [
      el("span", { className: "hist-meta" }, [
        el("span", { className: "hist-tag", text: toolName(entry.tool) }),
        el("span", { className: "hist-label", text: entry.calculatorLabel, attrs: { dir: "auto", id: "hist-l-" + id } }),
        entry.pinned ? el("span", { className: "hist-pin", text: t("history.pinnedMark") }) : null,
        el("span", { className: "hist-time", text: timeText(entry.timestampMs, group), attrs: { id: "hist-m-" + id } })
      ]),
      el("span", { className: "hist-inputs", attrs: { dir: "auto", id: "hist-i-" + id } }, [
        entry.expressionText ? el("span", { className: "hist-expr", text: entry.expressionText }) : null,
        el("span", { text: entry.inputsText })
      ]),
      el("span", { className: "hist-result", text: entry.resultText, attrs: { dir: "auto", id: "hist-r-" + id } }),
      entry.note ? el("span", { className: "hist-note", text: entry.note, attrs: { dir: "auto" } }) : null
    ]);
    main.addEventListener("click", () => restore(entry));
    const open = ui.actionsFor === id;
    const more = el("button", { className: "button hist-more-actions", text: t("history.actions"),
      attrs: { type: "button", "data-value": "more", "aria-expanded": open ? "true" : "false", "aria-controls": "hist-a-" + id, "aria-label": t("history.action.label", { action: t("history.actions"), label: entry.calculatorLabel, result: entry.resultText }) } });
    more.addEventListener("click", () => {
      ui.actionsFor = ui.actionsFor === id ? null : id;
      renderList();
      focusRow(id, "more");
    });
    const children = [el("div", { className: "hist-line" }, [main, more])];
    if (ui.noteFor === id) children.push(noteEditor(entry));
    else if (open) children.push(actions(entry));
    return el("li", { className: entry.pinned ? "hist-row is-pinned" : "hist-row", attrs: { "data-value": id } }, children);
  }

  // Makes `parent`'s element children exactly `nodes`, in order, touching
  // only the positions that differ.
  function patch(parent, nodes) {
    const keep = new Set(nodes);
    for (let i = 0; i < nodes.length; i++) {
      const cur = parent.children[i] || null;
      if (cur === nodes[i]) continue;
      parent.insertBefore(nodes[i], cur);
      // A row drawn anew takes its old node's place (the rows after it do
      // not move).
      if (cur && !keep.has(cur)) cur.remove();
    }
    for (let kids = parent.children; kids.length > nodes.length; kids = parent.children) kids[kids.length - 1].remove();
  }

  function renderList() {
    if (!mounted) return;
    const t = ctx.t;
    const panel = mounted.panel;
    const list = panel.querySelector("#historyList");
    const count = panel.querySelector("#historyCount");
    const all = ns.historyStore.entries();
    const shown = filtered();
    const page = shown.slice(0, ui.limit);
    const today = ns.clock.todayIso();
    const groups = [];
    const live = new Set();
    for (const e of page) {
      const g = groupOf(e.timestampMs, today);
      if (groups.length === 0 || groups[groups.length - 1].key !== g) groups.push({ key: g, rows: [] });
      groups[groups.length - 1].rows.push(row(e, g));
      live.add(e.id);
    }
    // Rows no longer drawn are forgotten.
    for (const id of Array.from(mounted.rows.keys())) if (!live.has(id)) mounted.rows.delete(id);
    if (all.length === 0) show(list, [el("p", { className: "hist-empty", text: t("history.empty") })]);
    else if (shown.length === 0) show(list, [el("p", { className: "hist-empty", text: t("history.noMatch") })]);
    else {
      // The groups and rows already on screen stay where they are; only
      // what changed is inserted, moved or removed (a pin, a note or a new
      // entry touches one row, not 2,200).
      const sections = new Map(Array.from(list.children).filter((n) => n.localName === "section").map((n) => [n.getAttribute("data-value"), n]));
      const wanted = groups.map((g) => {
        const section = sections.get(g.key) || el("section", { className: "hist-group", attrs: { "data-value": g.key } }, [
          el("h3", { className: "hist-group-title", text: t("history.group." + g.key) }),
          el("ul", { className: "hist-rows" })
        ]);
        patch(section.querySelector("ul"), g.rows);
        return section;
      });
      patch(list, wanted);
    }
    renderMore(shown.length - page.length);
    const filtering = ui.query.trim() !== "" || ui.filter !== "all";
    show(count, withValues(filtering
      ? t("history.countMatch", { shown: fmtNum(shown.length), count: fmtNum(all.length), plural: all.length })
      : t("history.count", { count: fmtNum(all.length), plural: all.length })));
    for (const [key, b] of mounted.chips) b.setAttribute("aria-pressed", key === ui.filter ? "true" : "false");
    const clearBtn = panel.querySelector("#historyClearBtn");
    if (clearBtn) flag(clearBtn, "disabled", all.length === 0);
    renderClear();
    observe();
  }

  function renderMore(left) {
    const more = mounted.panel.querySelector("#historyMore");
    flag(more, "hidden", left <= 0);
    if (left > 0) show(more, withValues(ctx.t("history.more", { count: fmtNum(Math.min(PAGE, left)), left: fmtNum(left), plural: left })));
  }

  // Show more: the next rows are appended (the rows on screen stay as they
  // are), into the last group when it continues.
  function appendRows(from) {
    const list = mounted.panel.querySelector("#historyList");
    const shown = filtered();
    const today = ns.clock.todayIso();
    let section = list.children[list.children.length - 1] || null;
    for (const e of shown.slice(from, ui.limit)) {
      const g = groupOf(e.timestampMs, today);
      if (!section || section.getAttribute("data-value") !== g) {
        section = el("section", { className: "hist-group", attrs: { "data-value": g } }, [
          el("h3", { className: "hist-group-title", text: ctx.t("history.group." + g) }),
          el("ul", { className: "hist-rows" })
        ]);
        list.append(section);
      }
      section.querySelector("ul").append(row(e, g));
    }
    renderMore(shown.length - Math.min(ui.limit, shown.length));
    observe();
  }

  function renderUndo() {
    if (!mounted) return;
    const node = mounted.panel.querySelector("#historyUndo");
    if (!ui.undo) {
      show(node, []);
      flag(node, "hidden", true);
      return;
    }
    const n = ui.undo.entries.length;
    const b = el("button", { className: "button", text: ctx.t("history.undo"), attrs: { type: "button", id: "historyUndoBtn" } });
    b.addEventListener("click", () => undoNow());
    const dismiss = el("button", { className: "button", text: ctx.t("history.undo.dismiss"), attrs: { type: "button", id: "historyUndoDismiss" } });
    dismiss.addEventListener("click", () => {
      closeUndo();
      const s = mounted && mounted.panel.querySelector("#historySearch");
      if (s) s.focus();
    });
    show(node, [el("span", { className: "hist-undo-text" }, withValues(ctx.t(ui.undo.key, { count: fmtNum(n), plural: n }))), b, dismiss]);
    flag(node, "hidden", false);
  }

  function renderClear() {
    if (!mounted) return;
    const t = ctx.t;
    const box = mounted.panel.querySelector("#historyClearBox");
    if (!ui.clearing) {
      show(box, []);
      flag(box, "hidden", true);
      return;
    }
    const all = ns.historyStore.entries();
    const n = ui.keepPinned ? all.filter((e) => !e.pinned).length : all.length;
    const keep = el("input", { attrs: { id: "historyKeepPinned", type: "checkbox" } });
    keep.checked = ui.keepPinned;
    keep.addEventListener("change", () => {
      ui.keepPinned = keep.checked;
      renderClear();
      const again = mounted && mounted.panel.querySelector("#historyKeepPinned");
      if (again) again.focus();
    });
    const confirm = el("button", { className: "button danger", attrs: { type: "button", id: "historyClearConfirm" } }, withValues(t("history.clear.confirm", { count: fmtNum(n), plural: n })));
    flag(confirm, "disabled", n === 0);
    const cancel = el("button", { className: "button", text: t("history.clear.cancel"), attrs: { type: "button", id: "historyClearCancel" } });
    confirm.addEventListener("click", async () => {
      const keepPinned = ui.keepPinned;
      // What is pinned is decided on the stored document when it is
      // written (an entry pinned in another window meanwhile is kept).
      const before = ns.historyStore.entries().filter((e) => !keepPinned || !e.pinned);
      ui.clearing = false;
      renderClear();
      const r = await ns.historyStore.clearAll(keepPinned);
      const gone = r.written ? r.removed : before;
      if (gone.length > 0) startUndo(gone, "history.undo.many");
      // One message (the Undo bar is not a live region).
      message("history.msg.cleared", { count: fmtNum(gone.length), plural: gone.length });
      const s = mounted && mounted.panel.querySelector("#historySearch");
      if (s) s.focus();
    });
    cancel.addEventListener("click", () => {
      ui.clearing = false;
      renderClear();
      const b = mounted && mounted.panel.querySelector("#historyClearBtn");
      if (b) b.focus();
    });
    show(box, [
      el("p", { className: "status" }, withValues(t("history.clear.question", { count: fmtNum(n), plural: n }))),
      el("label", { className: "choice check-row", attrs: { for: "historyKeepPinned" } }, [keep, el("span", { text: t("history.clear.keepPinned") })]),
      el("div", { className: "button-row" }, [confirm, cancel])
    ]);
    flag(box, "hidden", false);
  }

  function renderPreview() {
    if (!mounted) return;
    const t = ctx.t;
    const box = mounted.panel.querySelector("#historyImportBox");
    const p = ui.preview;
    if (!p) {
      show(box, []);
      flag(box, "hidden", true);
      return;
    }
    const children = [];
    if (p.error || p.newer) {
      children.push(el("p", { className: "status", text: p.newer ? t("history.import.newer") : t("history.import.error." + ({ too_large: "tooLarge", unreadable: "unreadable", engine: "engine" }[p.error] || "invalid")) }));
      const ok = el("button", { className: "button", text: t("history.import.close"), attrs: { type: "button", id: "historyImportCancel" } });
      ok.addEventListener("click", () => closePreview());
      children.push(el("div", { className: "button-row" }, [ok]));
    } else {
      children.push(el("p", { className: "status", attrs: { id: "historyImportSummary" } }, withValues(t("history.import.summary", {
        added: fmtNum(p.added), duplicates: fmtNum(p.duplicates), rejected: fmtNum(p.rejected)
      }))));
      if (p.near > 0) children.push(el("p", { className: "hint", attrs: { id: "historyImportNear" } }, withValues(t("history.import.near", { count: fmtNum(p.near), plural: p.near }))));
      if (p.evicted > 0) children.push(el("p", { className: "hint" }, withValues(t("history.import.evicted", { count: fmtNum(p.evicted), plural: p.evicted }))));
      if (p.pinLimit) children.push(el("p", { className: "hint", text: t("history.import.pinLimit") }));
      const go = el("button", { className: "button primary", attrs: { type: "button", id: "historyImportConfirm" } }, withValues(t("history.import.confirm", { count: fmtNum(p.added), plural: p.added })));
      flag(go, "disabled", p.added === 0);
      const cancel = el("button", { className: "button", text: t("history.import.cancel"), attrs: { type: "button", id: "historyImportCancel" } });
      go.addEventListener("click", async () => {
        const entries = p.entries;
        const added = p.added;
        ui.preview = null;
        renderPreview();
        await ns.historyStore.importEntries(entries);
        const s = ns.historyStore.status();
        message(s.writeError ? "history.msg.importKept" : "history.msg.imported", { count: fmtNum(added), plural: added });
        const b = mounted && mounted.panel.querySelector("#historyImportBtn");
        if (b) b.focus();
      });
      cancel.addEventListener("click", () => closePreview());
      children.push(el("div", { className: "button-row" }, [go, cancel]));
    }
    show(box, children);
    flag(box, "hidden", false);
  }

  function closePreview() {
    ui.preview = null;
    renderPreview();
    const b = mounted && mounted.panel.querySelector("#historyImportBtn");
    if (b) b.focus();
  }

  // The last resort of an export that could not be saved or copied: the
  // text in a read-only field, selected, with Select all.
  function renderExportText(text) {
    if (!mounted) return;
    const box = mounted.panel.querySelector("#historyExportBox");
    if (text === null) {
      show(box, []);
      flag(box, "hidden", true);
      return;
    }
    const area = el("textarea", { className: "input hist-export-text", attrs: { id: "historyExportText", readonly: true, spellcheck: "false", dir: "ltr", "aria-label": ctx.t("history.exportText.label") } });
    area.value = text;
    const select = el("button", { className: "button", text: ctx.t("history.exportText.select"), attrs: { type: "button", id: "historyExportSelect" } });
    select.addEventListener("click", () => {
      area.focus();
      area.select();
    });
    const close = el("button", { className: "button", text: ctx.t("history.import.close"), attrs: { type: "button", id: "historyExportClose" } });
    close.addEventListener("click", () => {
      renderExportText(null);
      const b = mounted && mounted.panel.querySelector("#historyExportJson");
      if (b) b.focus();
    });
    show(box, [el("p", { className: "hint", text: ctx.t("history.exportText.hint") }), area, el("div", { className: "button-row" }, [select, close])]);
    flag(box, "hidden", false);
    area.focus();
    area.select();
  }

  // Focus after a re-render: the row's button `which` (or its Restore),
  // else the search field.
  function focusRow(id, which) {
    if (!mounted) return;
    const panel = mounted.panel;
    const li = id ? panel.querySelector("li[data-value='" + id + "']") : null;
    const target = li ? li.querySelector("button[data-value='" + (which || "restore") + "']") || li.querySelector(".hist-main") : panel.querySelector("#historySearch");
    if (target) target.focus({ preventScroll: false });
  }

  // More rows as the end of the list comes into view (where supported).
  function observe() {
    if (!mounted) return;
    if (mounted.observer) mounted.observer.disconnect();
    mounted.observer = null;
    const more = mounted.panel.querySelector("#historyMore");
    if (typeof window.IntersectionObserver !== "function" || !more || more.hasAttribute("hidden")) return;
    const io = new window.IntersectionObserver((list) => {
      if (list.some((x) => x.isIntersecting)) showMore(false);
    }, { root: mounted.panel.closest(".pane-panel") || null, rootMargin: "200px" });
    io.observe(more);
    mounted.observer = io;
  }

  function showMore(focusNext) {
    if (!mounted) return;
    const before = ui.limit;
    ui.limit += PAGE;
    if (mounted.panel.querySelector(".hist-row")) appendRows(before);
    else renderList();
    if (focusNext && mounted) {
      const rows = mounted.panel.querySelectorAll(".hist-row");
      const first = rows[before];
      if (first) {
        const b = first.querySelector(".hist-main");
        if (b) b.focus();
      }
    }
  }

  async function exportNow(kind) {
    if (!ctx) return null;
    const r = kind === "csv" ? await ns.historyIO.exportCsv(ctx) : kind === "copy" ? await ns.historyIO.copyExport(ctx) : await ns.historyIO.exportJson(ctx);
    renderExportText(null);
    if (kind === "copy") {
      if (r.ok) message("history.msg.copiedExport");
      else {
        // No clipboard (an iOS home-screen app may refuse it): the text
        // itself, selected, is the last way out.
        message("history.msg.exportText");
        ui.dataOpen = true;
        syncData();
        renderExportText(ns.historyIO.jsonText(ctx));
      }
    } else if (!r.ok) {
      message("history.msg.exportFailed");
      ui.dataOpen = true;
      syncData();
      if (kind === "json") renderExportText(ns.historyIO.jsonText(ctx));
    } else if (r.path) message("history.msg.savedTo", { path: ns.dom.ltr(r.path) });
    else if (r.shared) message("history.msg.shared", { name: ns.dom.ltr(r.name) });
    else message("history.msg.downloaded", { name: ns.dom.ltr(r.name) });
    return r;
  }

  async function pickedFile(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    ui.clearing = false;
    ui.dataOpen = true;
    syncData();
    renderClear();
    ui.preview = await ns.historyIO.previewFile(file);
    renderPreview();
    const target = mounted && (mounted.panel.querySelector("#historyImportConfirm") || mounted.panel.querySelector("#historyImportCancel"));
    if (target) target.focus();
  }

  // "Your history data" opens and closes above the list.
  function syncData() {
    if (!mounted) return;
    const toggle = mounted.panel.querySelector("#historyDataToggle");
    const box = mounted.panel.querySelector("#historyData");
    toggle.setAttribute("aria-expanded", ui.dataOpen ? "true" : "false");
    flag(box, "hidden", !ui.dataOpen);
  }

  // ---- mount -----------------------------------------------------------------------------

  function render(panel, c) {
    leave();
    // The pane opens on the newest rows again (the window grows only while
    // it is open), with every row's actions closed.
    ui.limit = PAGE;
    ui.actionsFor = null;
    ctx = c;
    watchFields();
    const t = ctx.t;
    const status = ns.historyStore.status();
    const subtitle = ctx.store.kind === "memory" ? t("history.subtitle.memory")
      : status.readOnly ? t("history.subtitle.readOnly")
        : t("history.subtitle");
    const search = el("input", { className: "input", attrs: { id: "historySearch", type: "search", dir: "auto", autocomplete: "off", spellcheck: "false", maxlength: "200", placeholder: t("history.search.placeholder"), "aria-controls": "historyList" } });
    search.value = ui.query;
    const chips = new Map();
    const chipRow = el("div", { className: "chip-row", attrs: { role: "group", "aria-label": t("history.filter") } },
      ["all", "pinned", ...TOOLS].map((key) => {
        const b = el("button", { className: "button chip-button", text: key === "all" ? t("history.filter.all") : key === "pinned" ? t("history.filter.pinned") : toolName(key),
          attrs: { type: "button", id: "historyFilter-" + key, "aria-pressed": key === ui.filter ? "true" : "false" } });
        b.addEventListener("click", () => {
          ui.filter = key;
          ui.limit = PAGE;
          renderList();
          mounted.say.soon(() => mounted.panel.querySelector("#historyCount").textContent);
        });
        chips.set(key, b);
        return b;
      }));
    const more = el("button", { className: "button hist-more", attrs: { type: "button", id: "historyMore", hidden: true } });
    more.addEventListener("click", () => showMore(true));
    const fileInput = el("input", { attrs: { id: "historyImportFile", type: "file", accept: ".json,application/json", hidden: true, "aria-hidden": "true", tabindex: "-1" } });
    fileInput.addEventListener("change", () => pickedFile(fileInput));
    const btn = (id, key, onClick) => {
      const b = el("button", { className: "button", text: t(key), attrs: { type: "button", id } });
      b.addEventListener("click", onClick);
      return b;
    };
    const importBtn = btn("historyImportBtn", "history.import", () => fileInput.click());
    flag(importBtn, "disabled", status.readOnly);
    const dataButtons = [
      btn("historyExportJson", "history.export.json", () => exportNow("json")),
      btn("historyExportCsv", "history.export.csv", () => exportNow("csv")),
      ctx.platform.name === "web" ? btn("historyExportCopy", "history.export.copy", () => exportNow("copy")) : null,
      importBtn,
      btn("historyClearBtn", "history.clear", () => {
        ui.clearing = true;
        ui.keepPinned = true;
        ui.preview = null;
        renderPreview();
        renderClear();
        const k = mounted.panel.querySelector("#historyKeepPinned");
        if (k) k.focus();
      })
    ];
    const dataToggle = el("button", { className: "button hist-data-toggle", text: t("history.data"), attrs: { type: "button", id: "historyDataToggle", "aria-expanded": "false", "aria-controls": "historyData" } });
    dataToggle.addEventListener("click", () => {
      ui.dataOpen = !ui.dataOpen;
      syncData();
    });
    const undo = el("div", { className: "hist-undo", attrs: { id: "historyUndo", hidden: true } });
    // Held open while it has focus or the pointer (WCAG 2.2.1).
    const hold = (on) => () => {
      if (!ui.undo) return;
      ui.undo.held = on;
      if (!on) armUndoTimer();
    };
    undo.addEventListener("focusin", hold(true));
    undo.addEventListener("focusout", hold(false));
    undo.addEventListener("pointerenter", hold(true));
    undo.addEventListener("pointerleave", hold(false));
    const live = el("p", { className: "sr-only", attrs: { id: "historyLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const root = el("div", { className: "hist", attrs: { id: "historyPanel" } }, [
      el("p", { className: "hint hist-subtitle", text: subtitle, attrs: { id: "historySubtitle" } }),
      ctx.settings.history.enabled === false ? el("p", { className: "hint", text: t("history.off"), attrs: { id: "historyOff" } }) : null,
      el("label", { className: "sr-only", text: t("history.search"), attrs: { for: "historySearch" } }),
      search,
      chipRow,
      el("div", { className: "hist-bar" }, [el("p", { className: "status hist-count", attrs: { id: "historyCount" } }), dataToggle]),
      el("section", { className: "hist-data", attrs: { id: "historyData", "aria-labelledby": "historyDataToggle", hidden: true } }, [
        el("div", { className: "button-row" }, dataButtons),
        fileInput,
        el("div", { className: "hist-box", attrs: { id: "historyImportBox", hidden: true } }),
        el("div", { className: "hist-box", attrs: { id: "historyClearBox", hidden: true } }),
        el("div", { className: "hist-box", attrs: { id: "historyExportBox", hidden: true } })
      ]),
      el("p", { className: "status", attrs: { id: "historyStatus", role: "status", "aria-live": "polite" } }),
      el("p", { className: "sr-only", text: t("history.restoreHint"), attrs: { id: "historyRestoreHint" } }),
      el("div", { className: "hist-list", attrs: { id: "historyList" } }),
      more,
      undo,
      live
    ]);
    search.addEventListener("input", () => {
      ui.query = search.value;
      ui.limit = PAGE;
      renderList();
      mounted.say.soon(() => mounted.panel.querySelector("#historyCount").textContent);
    });
    // Esc in the search field: a query is cleared first (and the field
    // keeps the focus); an empty field closes the pane, focus back on its
    // toggle (the shell's Esc).
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || search.value === "") return;
      e.preventDefault();
      e.stopPropagation();
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    show(panel, [root]);
    mounted = { panel: root, chips, observer: null, rows: new Map(), say: ns.announcer.create(live), unsubscribe: ns.historyStore.subscribe(() => {
      const active = document.activeElement;
      const li = active && typeof active.closest === "function" ? active.closest("li.hist-row") : null;
      const which = active && typeof active.getAttribute === "function" ? active.getAttribute("data-value") : null;
      const inList = Boolean(li && root.contains(li));
      renderList();
      renderUndo();
      if (inList && !root.contains(document.activeElement)) focusRow(li.getAttribute("data-value"), which);
    }) };
    if (ui.preview || ui.clearing) ui.dataOpen = true;
    syncData();
    renderList();
    renderUndo();
    renderPreview();
    if (ui.message) message(ui.message.key, ui.message.params);
  }

  function leave() {
    if (!mounted) return;
    if (mounted.observer) mounted.observer.disconnect();
    mounted.say.cancel();
    mounted.unsubscribe();
    mounted = null;
  }

  ns.historyPanel = Object.freeze({
    render,
    leave,
    exportNow,
    groupOf,
    matches: (entry, query) => matches(entry, terms(query), ctx ? toolName(entry.tool) : entry.tool),
    resultValue,
    PAGE,
    UNDO_MS
  });
})();
