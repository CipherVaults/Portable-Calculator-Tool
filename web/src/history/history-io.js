// Export and import (plan B10, M3).
//
// Export JSON: {"format": "portable-calculator-export", "formatVersion": 1,
// appVersion, exportedAtMs, history, countdowns, settings}, with every
// history entry shown (unsaved ones included, so a failed write can be
// rescued). Export CSV: the engine's history.export_csv (a cell starting
// with = + - @ tab or CR gets a ' first), with a UTF-8 byte order mark
// so spreadsheet apps read the text right.
//   - web: a Blob download named Portable-Calculator-<yyyymmdd-hhmmss>.json
//     (or .csv), and "Copy export to clipboard" for browsers that cannot
//     save a file (an iOS home-screen app);
//   - desktop: export_file writes a new file of that name into the
//     Downloads folder (never overwriting one) and the panel shows its
//     full path. No dialog plugin (crates/pcalc-store/src/export.rs).
// Import: a file of at most 8 MiB (<input type="file">, both surfaces)
// -> history.import_preview checks each entry ("N new · M duplicates · K
// rejected"); Import then adds the new entries in one write (merged by id:
// an entry that exists is never replaced). Countdowns and settings in the
// file are not imported (they would replace this device's own).
(function () {
  "use strict";
  const ns = window.PCalc;
  const FORMAT = "portable-calculator-export";
  const FORMAT_VERSION = 1;
  const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

  // Local time as yyyymmdd-hhmmss.
  function stamp() {
    const now = ns.clock.nowMoment();
    return now.date.replace(/-/g, "") + "-" + now.time.replace(/:/g, "");
  }

  function exportObject(ctx) {
    const countdowns = ns.countdowns && typeof ns.countdowns.list === "function" ? { schemaVersion: 1, items: ns.countdowns.list() } : null;
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      appVersion: ns.build.appVersion,
      exportedAtMs: Date.now(),
      history: ns.historyStore.doc(),
      countdowns,
      settings: JSON.parse(JSON.stringify(ctx.settings))
    };
  }

  const jsonText = (ctx) => JSON.stringify(exportObject(ctx)) + "\n";

  // -> {ok, path (desktop) | null (web), name, kind} or {ok: false, code}
  async function exportJson(ctx) {
    const s = stamp();
    const r = await ctx.platform.exportFile("json", s, jsonText(ctx));
    return Object.assign({ kind: "json", name: "Portable-Calculator-" + s + ".json" }, r);
  }

  async function exportCsv(ctx) {
    let res = null;
    try {
      res = JSON.parse(await ctx.platform.engine("history.export_csv", JSON.stringify(ns.historyStore.doc())));
    } catch (_) {
      res = null;
    }
    if (!res || res.ok !== "true") return { ok: false, code: "export_failed", kind: "csv" };
    const s = stamp();
    const r = await ctx.platform.exportFile("csv", s, "\uFEFF" + res.result.csv);
    return Object.assign({ kind: "csv", name: "Portable-Calculator-" + s + ".csv", rows: res.result.rows }, r);
  }

  async function copyExport(ctx) {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return { ok: false, code: "no_clipboard" };
      await navigator.clipboard.writeText(jsonText(ctx));
      return { ok: true };
    } catch (_) {
      return { ok: false, code: "no_clipboard" };
    }
  }

  // A picked file -> the import preview (history-store.js previewImport).
  async function previewFile(file) {
    if (!file || typeof file.size !== "number") return { error: "invalid" };
    if (file.size > IMPORT_MAX_BYTES) return { error: "too_large" };
    let text;
    try {
      text = await file.text();
    } catch (_) {
      return { error: "unreadable" };
    }
    return ns.historyStore.previewImport(text);
  }

  ns.historyIO = Object.freeze({ FORMAT, FORMAT_VERSION, IMPORT_MAX_BYTES, stamp, exportObject, exportJson, exportCsv, copyExport, previewFile });
})();
