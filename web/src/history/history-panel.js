// The History panel (plan B10, M3): the History tab of the History |
// Memory | Countdowns pane (a bottom sheet on phones, an overlay or a
// docked column on wider screens).
//
//   - "Saved locally on this device." (or why not), then a search field:
//     case-insensitive, digits normalised (Western, Arabic-Indic and
//     Persian digits all match each other), every word must match;
//   - filter chips All / Pinned / one per tool that records history;
//   - the entries grouped Today / Yesterday / This week / Earlier by the
//     LOCAL calendar day (today is passed in: groupOf(ms, todayIso));
//   - each row: the tool tag, the calculator, muted inputs (and the
//     expression), the result in gold, the note; the row itself is the
//     Restore button (Enter or a tap): the owning tool opens with the
//     stored inputs and computes again, so the result reads in the current
//     language; Copy, Use result (the value into the current tool's
//     focused or first compatible field), Pin, Note (at most 200, dir=auto)
//     and Delete with a 5 s Undo;
//   - Export JSON / CSV, Copy export (web), Import (preview, then one
//     write), and Clear all (confirmed with the count; "Keep pinned" on by
//     default; also undoable for 5 s).
// Rendering is windowed: the first PAGE rows of the filtered list, then
// "Show more" (and, where IntersectionObserver exists, more as the end of
// the list scrolls into view), so 2,200 entries stay quick on a phone.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, show, flag, value, withValues } = ns.dom;
  const PAGE = 60;
  const UNDO_MS = 5000;
  // The tools that record history today (their filter chips).
  const TOOLS = Object.freeze(["date", "percent"]);
  const DAY_MS = 86400000;

  // Session state (kept while the pane re-renders).
  const ui = { query: "", filter: "all", limit: PAGE, noteFor: null, clearing: false, keepPinned: true, preview: null, undo: null, message: null };
  let ctx = null;
  let mounted = null; // {panel, unsubscribe, observer, say}
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
  const keys = new WeakMap();
  function searchKey(entry, toolName) {
    let k = keys.get(entry);
    if (k === undefined) {
      k = norm([toolName, entry.calculatorLabel, entry.expressionText, entry.inputsText, entry.resultText, entry.note || ""].join("\n"));
      keys.set(entry, k);
    }
    return k;
  }
  function matches(entry, words, toolName) {
    if (words.length === 0) return true;
    const k = searchKey(entry, toolName);
    return words.every((w) => k.includes(w));
  }

  // The value "Use result" inserts: {kind: "date", text: "2026-02-26"} or
  // {kind: "number", text: "115.00"}, or null.
  function resultValue(entry) {
    const res = ns.format.normalizeDigits(entry.resultText || "");
    if (entry.tool === "date" && (entry.calculator === "add" || entry.calculator === "info")) {
      const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(res) || /\b(\d{4}-\d{2}-\d{2})\b/.exec(ns.format.normalizeDigits(entry.copyText || ""));
      return m ? { kind: "date", text: m[1] } : null;
    }
    const m = /([-\u2212]?)(\d[\d,]*(?:\.\d+)?)/.exec(res);
    if (!m) return null;
    const text = (m[1] ? "-" : "") + m[2].replace(/,/g, "");
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
    if (ctx.shell && ctx.shell.modal() === "pane") ctx.shell.closeModal({ restoreFocus: false });
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
    return true;
  }

  function startUndo(entries, key) {
    if (ui.undo) window.clearTimeout(ui.undo.timer);
    const undo = { entries, key, timer: 0 };
    undo.timer = window.setTimeout(() => {
      if (ui.undo === undo) {
        ui.undo = null;
        renderUndo();
      }
    }, UNDO_MS);
    ui.undo = undo;
    renderUndo();
  }

  async function undoNow() {
    const u = ui.undo;
    if (!u) return;
    window.clearTimeout(u.timer);
    ui.undo = null;
    renderUndo();
    await ns.historyStore.putBack(u.entries);
    message("history.msg.restored", { count: fmtNum(u.entries.length), plural: u.entries.length });
  }

  async function remove(entry) {
    const list = ns.historyStore.entries();
    const i = list.findIndex((e) => e.id === entry.id);
    const next = list[i + 1] || list[i - 1] || null;
    if (ui.noteFor === entry.id) ui.noteFor = null;
    startUndo([entry], "history.undo.one");
    await ns.historyStore.remove([entry.id]);
    focusRow(next ? next.id : null);
  }

  async function togglePin(entry) {
    await ns.historyStore.pin(entry.id, !entry.pinned);
    const s = ns.historyStore.status();
    if (!entry.pinned && s.lastApplied && s.lastApplied.pinLimit) message("history.msg.pinLimit", { max: fmtNum(200) });
    else message(entry.pinned ? "history.msg.unpinned" : "history.msg.pinned");
    focusRow(entry.id, "pin");
  }

  async function saveNote(entry, text) {
    ui.noteFor = null;
    await ns.historyStore.note(entry.id, text);
    message("history.msg.noteSaved");
    focusRow(entry.id, "note");
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

  function actionButton(key, text, entry, onClick, extra) {
    const b = el("button", { className: "button hist-action", text, attrs: Object.assign({ type: "button", "data-value": key, "aria-describedby": "hist-r-" + entry.id }, extra || {}) });
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

  function row(entry, group) {
    const t = ctx.t;
    const main = el("button", { className: "hist-main", attrs: { type: "button", "data-value": "restore", "aria-describedby": "historyRestoreHint" } }, [
      el("span", { className: "hist-meta" }, [
        el("span", { className: "hist-tag", text: toolName(entry.tool) }),
        el("span", { className: "hist-label", text: entry.calculatorLabel, attrs: { dir: "auto" } }),
        entry.pinned ? el("span", { className: "hist-pin", text: t("history.pinnedMark") }) : null,
        el("span", { className: "hist-time", text: timeText(entry.timestampMs, group) })
      ]),
      entry.expressionText ? el("span", { className: "hist-inputs", text: entry.expressionText, attrs: { dir: "auto" } }) : null,
      el("span", { className: "hist-inputs", text: entry.inputsText, attrs: { dir: "auto" } }),
      el("span", { className: "hist-result", text: entry.resultText, attrs: { dir: "auto", id: "hist-r-" + entry.id } }),
      entry.note ? el("span", { className: "hist-note", text: entry.note, attrs: { dir: "auto" } }) : null
    ]);
    main.addEventListener("click", () => restore(entry));
    const children = [main];
    if (ui.noteFor === entry.id) children.push(noteEditor(entry));
    else {
      const usable = resultValue(entry) !== null;
      children.push(el("div", { className: "hist-actions" }, [
        actionButton("copy", t("history.copy"), entry, (e) => copy(entry, e.currentTarget)),
        actionButton("use", t("history.use"), entry, () => useResult(entry), { disabled: !usable }),
        actionButton("pin", t(entry.pinned ? "history.unpin" : "history.pin"), entry, () => togglePin(entry), { "aria-pressed": entry.pinned ? "true" : "false" }),
        actionButton("note", t("history.note"), entry, () => {
          ui.noteFor = entry.id;
          renderList();
          const n = mounted && mounted.panel.querySelector("#historyNoteInput");
          if (n) n.focus();
        }),
        actionButton("delete", t("history.delete"), entry, () => remove(entry))
      ]));
    }
    return el("li", { className: entry.pinned ? "hist-row is-pinned" : "hist-row", attrs: { "data-value": entry.id } }, children);
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
    for (const e of page) {
      const g = groupOf(e.timestampMs, today);
      if (groups.length === 0 || groups[groups.length - 1].key !== g) groups.push({ key: g, rows: [] });
      groups[groups.length - 1].rows.push(row(e, g));
    }
    if (all.length === 0) show(list, [el("p", { className: "hist-empty", text: t("history.empty") })]);
    else if (shown.length === 0) show(list, [el("p", { className: "hist-empty", text: t("history.noMatch") })]);
    else {
      show(list, groups.map((g) => el("section", { className: "hist-group", attrs: { "data-value": g.key } }, [
        el("h3", { className: "hist-group-title", text: t("history.group." + g.key) }),
        el("ul", { className: "hist-rows" }, g.rows)
      ])));
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
    show(node, [el("span", {}, withValues(ctx.t(ui.undo.key, { count: fmtNum(n), plural: n }))), b]);
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
      const gone = ns.historyStore.entries().filter((e) => !ui.keepPinned || !e.pinned);
      ui.clearing = false;
      if (gone.length > 0) {
        startUndo(gone, "history.undo.many");
        await ns.historyStore.remove(gone.map((e) => e.id));
      }
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
    if (kind === "copy") message(r.ok ? "history.msg.copiedExport" : "history.msg.copyFailed");
    else if (!r.ok) message("history.msg.exportFailed");
    else if (r.path) message("history.msg.savedTo", { path: ns.dom.ltr(r.path) });
    else message("history.msg.downloaded", { name: ns.dom.ltr(r.name) });
    return r;
  }

  async function pickedFile(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    ui.clearing = false;
    renderClear();
    ui.preview = await ns.historyIO.previewFile(file);
    renderPreview();
    const target = mounted && (mounted.panel.querySelector("#historyImportConfirm") || mounted.panel.querySelector("#historyImportCancel"));
    if (target) target.focus();
  }

  // ---- mount -----------------------------------------------------------------------------

  function render(panel, c) {
    leave();
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
    const live = el("p", { className: "sr-only", attrs: { id: "historyLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const root = el("div", { className: "hist", attrs: { id: "historyPanel" } }, [
      el("p", { className: "hint hist-subtitle", text: subtitle, attrs: { id: "historySubtitle" } }),
      ctx.settings.history.enabled === false ? el("p", { className: "hint", text: t("history.off"), attrs: { id: "historyOff" } }) : null,
      el("label", { className: "sr-only", text: t("history.search"), attrs: { for: "historySearch" } }),
      search,
      chipRow,
      el("p", { className: "status hist-count", attrs: { id: "historyCount" } }),
      el("p", { className: "sr-only", text: t("history.restoreHint"), attrs: { id: "historyRestoreHint" } }),
      el("div", { className: "hist-undo", attrs: { id: "historyUndo", role: "status", hidden: true } }),
      el("div", { className: "hist-list", attrs: { id: "historyList" } }),
      more,
      el("section", { className: "hist-data", attrs: { "aria-labelledby": "historyDataTitle" } }, [
        el("h3", { className: "hist-group-title", text: t("history.data"), attrs: { id: "historyDataTitle" } }),
        el("div", { className: "button-row" }, dataButtons),
        fileInput,
        el("div", { className: "hist-box", attrs: { id: "historyImportBox", hidden: true } }),
        el("div", { className: "hist-box", attrs: { id: "historyClearBox", hidden: true } })
      ]),
      el("p", { className: "status", attrs: { id: "historyStatus", role: "status", "aria-live": "polite" } }),
      live
    ]);
    search.addEventListener("input", () => {
      ui.query = search.value;
      ui.limit = PAGE;
      renderList();
      mounted.say.soon(() => mounted.panel.querySelector("#historyCount").textContent);
    });
    show(panel, [root]);
    mounted = { panel: root, chips, observer: null, say: ns.announcer.create(live), unsubscribe: ns.historyStore.subscribe(() => {
      const active = document.activeElement;
      const li = active && typeof active.closest === "function" ? active.closest("li.hist-row") : null;
      const which = active && typeof active.getAttribute === "function" ? active.getAttribute("data-value") : null;
      const inList = Boolean(li && root.contains(li));
      renderList();
      renderUndo();
      if (inList && !root.contains(document.activeElement)) focusRow(li.getAttribute("data-value"), which);
    }) };
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
