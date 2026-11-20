// The history store (plan B10, M3; the owner's top priority): the one
// "history" document, {schemaVersion: 1, entries: [...]}, whose entries
// are strict per tool and checked by the engine (history.validate,
// crates/pcalc-api/src/history.rs). Every change is an operation (add,
// import, delete, pin, note) that the engine's history.apply applies to
// the stored document as it is NOW (clear too: "Clear all" with "Keep
// pinned" decides what is pinned at write time, so an entry another window
// pinned meanwhile is kept), then sorts newest first and enforces
// the caps (2,000 unpinned, the oldest evicted; 200 pinned, never evicted;
// 4 MiB; the duplicate-newest merge). The result is written with the
// store's compare-and-save (saveIf: IndexedDB on the web, store_save_if on
// the desktop): when another tab or window wrote in between, the write is
// refused as "conflict", the document is read again and the same
// operations are applied to it. So two windows recording at once both
// keep their entries (the future Mini Calculator windows rely on this),
// and an entry deleted in one window is not brought back by another.
//
// Durability (B10):
//   - the load outcome comes from the store (raw schemaVersion first;
//     newer = read-only and never written; NotFound = empty and writable;
//     any other read error or request_too_large = read-only, untouched;
//     corrupt or a dropped entry = a timestamped backup, then read-only).
//     While read-only, new entries are kept in memory for this session and
//     shown; the shell's banner offers Retry and, unless newer, a confirmed
//     "Start a new history" (the store backs the old document up first, and
//     refuses as "recovered" a document that validates again: then the
//     shell reloads it instead). A reload that finds the document unreadable
//     (another tab's notice during a passing read error) keeps the last good
//     entries on screen and in Export, read-only, instead of an empty list.
//   - a failed write (QuotaExceededError, a file system error, the 4 MiB
//     cap) keeps every pending operation in memory, the entries stay
//     visible, and a banner offers Export and Try again: nothing is
//     dropped silently. The next change or Try again writes them. An
//     operation the engine refuses is dropped on its own (never blocking the
//     others) and counted, and a banner says so. While a dry run of the
//     pending operations fails, the view still shows the entries they add.
//   - history.enabled (Settings) off: nothing new is recorded.
//
// Another tab's notice ("history-changed" on BroadcastChannel("pcalc"))
// re-reads the document; operations still pending here are applied on top.
//
// Entry ids are "h-<ms>-<n>" with a random n per entry, so two windows
// recording in the same millisecond do not collide.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, value, withValues } = ns.dom;
  const TEXT_MAX = 1024;
  const COPY_MAX = 4096;
  const NOTE_MAX = 200;
  const MAX_ATTEMPTS = 12;
  // The engine crate behind each tool's results (meta.versions names).
  const ENGINES = Object.freeze({
    date: "date-core", percent: "percent-core", standard: "calc-core", scientific: "calc-core",
    programmer: "calc-core", converter: "units-core", graphing: "graph-core"
  });

  let ctx = null;
  let base = null; // the stored canonical text as last read or written (null: none)
  let baseValue = null; // the same, parsed
  let pending = []; // operations not written yet, in order
  let view = []; // the entries shown: base + pending, newest first
  let writeError = null; // {code} of the last failed write; null after a success
  let lastApplied = null; // the engine's counts for the last write
  let rejected = 0; // operations the engine refused (dropped; never written)
  let rejectedSeen = 0; // the rejections the banner has been dismissed for
  // Per operation object: what the write that carried it did ({written,
  // missing, removed} or {rejected}); mutate() sums them per call.
  const settled = new WeakMap();
  let writes = 0; // successful writes this session (tests read it)
  let chain = Promise.resolve();
  let started = false;
  const listeners = new Set();

  // ---- helpers ----------------------------------------------------------------

  async function call(op, req) {
    try {
      return JSON.parse(await ctx.platform.engine(op, typeof req === "string" ? req : JSON.stringify(req)));
    } catch (_) {
      return null;
    }
  }

  const blocked = () => {
    const o = ctx && ctx.outcomes.history;
    return Boolean(o && o.readOnly);
  };

  // Bidi marks, embeddings, overrides and isolates and the byte order mark
  // are removed (the engine refuses them: they could make a row show a
  // value other than the stored one); line and paragraph separators become
  // spaces like control characters.
  const HIDDEN = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
  // One line: control characters become spaces; at most `max` code points.
  function line(v, max) {
    const s = Array.from(String(typeof v === "string" ? v : "").replace(HIDDEN, "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " "));
    return s.slice(0, max).join("");
  }
  // copyText keeps line feeds and tabs.
  function multiline(v) {
    const s = Array.from(String(typeof v === "string" ? v : "").replace(HIDDEN, "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, " "));
    return s.slice(0, COPY_MAX).join("");
  }
  const lone = (s) => s.replace(/[\uD800-\uDFFF]/g, (c, i, all) => {
    const code = c.charCodeAt(0);
    const next = all.charCodeAt(i + 1);
    const prev = all.charCodeAt(i - 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return c;
    if (code >= 0xdc00 && prev >= 0xd800 && prev <= 0xdbff) return c;
    return "\uFFFD";
  });

  function randomN() {
    try {
      const a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0];
    } catch (_) {
      return Math.floor(Math.random() * 4294967295);
    }
  }

  function engineName(tool) {
    const crate = ENGINES[tool] || "pcalc-api";
    const versions = ctx.checks && ctx.checks.versions && ctx.checks.versions.engines;
    const v = versions && typeof versions[crate] === "string" ? versions[crate] : "";
    return /^[A-Za-z0-9 ._+-]{1,64}$/.test(crate + " " + v) && v ? crate + " " + v : crate;
  }

  // A hook entry (shell/history.js) -> a full B10 entry.
  function makeEntry(e) {
    const ts = Number.isSafeInteger(e.timestampMs) && e.timestampMs >= 0 ? e.timestampMs : Date.now();
    const ids = new Set(view.map((x) => x.id));
    let id = "h-" + ts + "-" + randomN();
    while (ids.has(id)) id = "h-" + ts + "-" + randomN();
    const inputs = {};
    for (const [k, v] of Object.entries(e.inputs || {})) inputs[k] = lone(String(v));
    return {
      id,
      timestampMs: ts,
      tool: e.tool,
      calculator: e.calculator,
      calculatorLabel: lone(line(e.calculatorLabel || e.calculator, TEXT_MAX)),
      inputs,
      expressionText: lone(line(e.expressionText || "", TEXT_MAX)),
      inputsText: lone(line(e.inputsText, TEXT_MAX)),
      resultText: lone(line(e.resultText, TEXT_MAX)),
      copyText: lone(multiline(e.copyText)),
      pinned: false,
      note: null,
      engine: engineName(e.tool)
    };
  }

  // `parsed`, when given, is the same document already parsed.
  function setBase(text, parsed) {
    base = typeof text === "string" ? text : null;
    try {
      baseValue = base === null ? null : parsed !== undefined ? parsed : JSON.parse(base);
    } catch (_) {
      base = null;
      baseValue = null;
    }
  }

  // The outcome a load returned (ctx.outcomes.history) -> the base. Only
  // "ok" and "empty" say what is stored; any other outcome (unreadable,
  // corrupt, newer, too large) leaves the document read-only and keeps the
  // last good base this tab had (none at boot), so the list and Export do
  // not go empty during a passing read error.
  function adopt(o) {
    if (o && o.status === "ok") setBase(o.doc);
    else if (!o || o.status === "empty") setBase(null);
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (_) {
        // One broken viewer must not stop the others.
      }
    }
    if (ctx && ctx.shell) ctx.shell.renderBanners();
  }

  // Runs `task` after every earlier one (reads, writes and view updates
  // never interleave in this window).
  function enqueue(task) {
    const next = chain.then(task);
    chain = next.catch(() => undefined);
    return next;
  }

  // ---- the view and the writes -----------------------------------------------------

  const baseEntries = () => (baseValue && Array.isArray(baseValue.entries) ? baseValue.entries : []);

  // The history.apply request, built around the stored canonical text (no
  // second serialisation of the whole document).
  const applyRequest = (ops) => '{"doc":' + (base === null ? "null" : base) + ',"ops":' + JSON.stringify(ops) + "}";

  async function refreshView() {
    if (pending.length === 0) {
      view = baseEntries();
    } else {
      const r = await call("history.apply", applyRequest(pending));
      if (r && r.ok === "true") view = r.result.doc.entries;
      else {
        // The dry run failed: the entries the pending operations add stay
        // visible (and in Export) all the same.
        const known = new Set(baseEntries().map((e) => e.id));
        const added = [];
        for (const op of pending) {
          for (const e of op.add ? [op.add] : Array.isArray(op.import) ? op.import : []) {
            if (!known.has(e.id)) {
              known.add(e.id);
              added.push(e);
            }
          }
        }
        view = added.concat(baseEntries()).sort((a, b) => b.timestampMs - a.timestampMs);
      }
    }
    notify();
  }

  async function reloadBase() {
    const o = await ctx.store.load("history");
    ctx.outcomes.history = o;
    adopt(o);
  }

  // The operation at fault in an engine refusal ("ops[3].add.inputs…").
  function faultyOp(res) {
    const field = res && res.ok === "false" && res.error && typeof res.error.field === "string" ? res.error.field : "";
    const m = /^ops\[(\d+)\]/.exec(field);
    return m ? Number(m[1]) : -1;
  }

  // A refusal of the whole batch without an operation index: the first
  // prefix of `ops` the engine refuses ends with the operation at fault.
  // When the stored document itself is refused (no operation applied), no
  // operation is at fault: -1, and every one is kept.
  async function isolate(ops) {
    const none = await call("history.apply", applyRequest([]));
    if (!none || none.ok !== "true") return -1;
    for (let k = 1; k <= ops.length; k++) {
      const r = await call("history.apply", applyRequest(ops.slice(0, k)));
      if (!r) return -1;
      if (r.ok !== "true") return k - 1;
    }
    return -1;
  }

  function drop(i) {
    settled.set(pending[i], { rejected: true });
    pending.splice(i, 1);
    rejected++;
  }

  async function flushNow() {
    let attempts = 0;
    while (pending.length > 0 && !blocked() && attempts < MAX_ATTEMPTS) {
      attempts++;
      const ops = pending.slice();
      const res = await call("history.apply", applyRequest(ops));
      if (!res || res.ok !== "true") {
        let i = faultyOp(res);
        const tooLarge = Boolean(res && res.error && res.error.code === "request_too_large");
        // One operation the engine refuses never blocks the others, even
        // when the refusal names the document rather than an operation.
        if (i < 0 && res && !tooLarge) i = await isolate(ops);
        if (i >= 0 && i < ops.length) {
          drop(i);
          continue;
        }
        writeError = { code: tooLarge ? "too_large" : "invalid" };
        break;
      }
      const sent = JSON.stringify(res.result.doc);
      const r = await ctx.store.saveIf("history", base, sent);
      if (r.ok) {
        setBase(r.text, r.text === sent ? res.result.doc : undefined);
        const per = Array.isArray(res.result.opResults) ? res.result.opResults : [];
        ops.forEach((op, k) => settled.set(op, Object.assign({ written: true }, per[k] || { missing: 0, removed: [] })));
        pending.splice(0, ops.length);
        writeError = null;
        lastApplied = res.result;
        writes++;
        ctx.outcomes.history = { name: "history", status: "ok", readOnly: false, doc: r.text, schemaVersion: null, backup: null, field: null };
        continue;
      }
      if (r.code === "conflict") {
        // Another tab or window wrote: read again, apply the same ops.
        await reloadBase();
        continue;
      }
      if (r.code === "read_only") {
        await reloadBase();
        break;
      }
      writeError = { code: r.code };
      break;
    }
    if (attempts >= MAX_ATTEMPTS && pending.length > 0 && !blocked()) writeError = { code: "conflict" };
    await refreshView();
  }

  // -> after the write: {written (every op), rejected, missing, removed}
  // for these operations (removed: the entries as they were when deleted).
  function mutate(ops) {
    pending.push(...ops);
    return enqueue(flushNow).then(() => {
      const out = { written: true, rejected: 0, missing: 0, removed: [] };
      for (const op of ops) {
        const s = settled.get(op);
        if (!s) out.written = false;
        else if (s.rejected) {
          out.written = false;
          out.rejected++;
        } else {
          out.missing += s.missing || 0;
          if (Array.isArray(s.removed)) out.removed.push(...s.removed);
        }
      }
      return out;
    });
  }

  // ---- public API -----------------------------------------------------------------

  // The hook's sink: an explicit action recorded an entry.
  function record(hookEntry) {
    if (!ctx || !ctx.settings.history || ctx.settings.history.enabled === false) return Promise.resolve(false);
    return mutate([{ add: makeEntry(hookEntry) }]).then((r) => r.rejected === 0);
  }

  async function init(c) {
    ctx = c;
    adopt(ctx.outcomes.history);
    view = baseValue && Array.isArray(baseValue.entries) ? baseValue.entries : [];
    if (!started) {
      started = true;
      ns.bus.on("history-changed", () => enqueue(async () => {
        await reloadBase();
        await flushNow();
      }));
      ns.history.attach((e) => {
        record(e);
      });
    }
  }

  // Retry / Start a new history (the shell) and Try again (the banner).
  function reload() {
    return enqueue(async () => {
      await reloadBase();
      await flushNow();
    });
  }

  // The document to export: everything shown, unsaved entries included.
  const doc = () => ({ schemaVersion: 1, entries: view.map((e) => JSON.parse(JSON.stringify(e))) });

  // An export file's text -> what importing it would do (nothing written).
  async function previewImport(text) {
    const p = await call("history.import_preview", String(text));
    if (!p) return { error: "engine" };
    if (p.ok !== "true") return { error: p.error && p.error.code === "request_too_large" ? "too_large" : "invalid", field: p.error ? p.error.field || null : null };
    if (p.result.status === "newer") return { newer: true, field: p.result.field, version: p.result.version };
    const entries = p.result.entries;
    const dry = await call("history.apply", { doc: doc(), ops: [{ import: entries }] });
    if (!dry || dry.ok !== "true") return { error: dry && dry.ok === "false" && dry.error.code === "request_too_large" ? "too_large" : "invalid", field: null };
    return {
      entries,
      added: dry.result.added,
      duplicates: dry.result.duplicates + p.result.fileDuplicates,
      rejected: p.result.rejected,
      evicted: dry.result.evicted,
      pinLimit: dry.result.pinLimit,
      // Imported all the same (B10), but listed: same calculation within 1 s.
      near: dry.result.nearDuplicates || 0
    };
  }

  // The banner while entries exist only in memory (a failed write, or a
  // read-only document): what happened, and Export / Try again.
  function banners(t) {
    const out = [];
    if (ctx && rejected > rejectedSeen) {
      // An entry the engine refused (it could not be checked as a valid
      // history entry): said once, until dismissed.
      const n = rejected - rejectedSeen;
      const ok = el("button", { className: "button", text: t("history.banner.dismiss"), attrs: { type: "button", id: "historyRejectedOk" } });
      ok.addEventListener("click", () => {
        rejectedSeen = rejected;
        if (ctx.shell) ctx.shell.renderBanners();
      });
      const count = value(ns.format.formatNumber(String(n), ctx.lang, { digits: ctx.digits, grouping: "none" }));
      out.push(el("div", { className: "banner", attrs: { role: "status", "data-doc": "history", "data-state": "rejected" } }, [
        el("p", { className: "banner-text" }, withValues(t("history.banner.rejected", { plural: n, count }))),
        el("div", { className: "button-row" }, [ok])
      ]));
    }
    return out.concat(pendingBanners(t));
  }

  function pendingBanners(t) {
    if (!ctx || pending.length === 0 || (!writeError && !blocked())) return [];
    const n = pending.length;
    const count = value(ns.format.formatNumber(String(n), ctx.lang, { digits: ctx.digits, grouping: "none" }));
    const text = writeError
      ? t("history.banner.writeFailed", { reason: t("history.reason." + ({ quota: "quota", too_large: "tooLarge", conflict: "conflict" }[writeError.code] || "other")), plural: n, count })
      : t("history.banner.memoryOnly", { plural: n, count });
    const exp = el("button", { className: "button", text: t("history.banner.export"), attrs: { type: "button", id: "historyBannerExport" } });
    exp.addEventListener("click", () => {
      // The History panel shows where the file went.
      if (ctx.shell) ctx.shell.openPane("history");
      if (ns.historyPanel) ns.historyPanel.exportNow("json");
      else ns.historyIO.exportJson(ctx);
    });
    const row = [exp];
    if (writeError) {
      const again = el("button", { className: "button", text: t("history.banner.again"), attrs: { type: "button", id: "historyBannerRetry" } });
      again.addEventListener("click", () => reload());
      row.push(again);
    }
    return [el("div", { className: "banner", attrs: { role: "status", "data-doc": "history", "data-state": writeError ? "write-failed" : "memory-only" } }, [
      el("p", { className: "banner-text" }, withValues(text)),
      el("div", { className: "button-row" }, row)
    ])];
  }

  ns.historyStore = Object.freeze({
    init,
    reload,
    record,
    entries: () => view,
    doc,
    status: () => ({
      outcome: ctx && ctx.outcomes.history ? ctx.outcomes.history.status : "empty",
      readOnly: blocked(),
      pending: pending.length,
      writeError: writeError ? writeError.code : null,
      writes,
      rejected,
      lastApplied: lastApplied ? { added: lastApplied.added, merged: lastApplied.merged, duplicates: lastApplied.duplicates, evicted: lastApplied.evicted, pinLimit: lastApplied.pinLimit } : null
    }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    remove: (ids) => mutate([{ delete: ids.slice() }]),
    // Clear all: every entry, or every unpinned one, as stored at write time.
    clearAll: (keepPinned) => mutate([{ clear: { keepPinned: Boolean(keepPinned) } }]),
    // Undo of a delete: the same entries back, ids, pins and notes kept.
    putBack: (entries) => mutate([{ import: entries.map((e) => JSON.parse(JSON.stringify(e))) }]),
    pin: (id, pinned) => mutate([{ pin: { id, pinned: Boolean(pinned) } }]),
    note: (id, text) => {
      const n = lone(line(text, NOTE_MAX)).trim();
      return mutate([{ note: { id, note: n === "" ? null : n } }]);
    },
    importEntries: (entries) => mutate([{ import: entries }]),
    previewImport,
    banners,
    idle: () => chain,
    NOTE_MAX
  });
})();
