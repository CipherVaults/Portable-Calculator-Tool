// Desktop adapter (plan B4): the engine is native, reached through the one
// Tauri command engine_call(op, req). The desktop CSP stays connect-src
// 'none' with no 'wasm-unsafe-eval'. The documents live in
// %APPDATA%\com.portablecalculator.tool through store_load / store_save /
// store_save_if / store_clear (crates/pcalc-store/src/docs.rs), with the
// same outcomes as the web store (web/src/core/store.js). Exports go
// through export_file: a new Portable-Calculator-<yyyymmdd-hhmmss>.json
// (or .csv) in the Downloads folder, whose full path is shown (plan B10;
// no dialog plugin: crates/pcalc-store/src/export.rs).
(function () {
  "use strict";
  function core() {
    const t = window.__TAURI__;
    return t && t.core && typeof t.core.invoke === "function" ? t.core : null;
  }
  const code = (err) => (typeof err === "string" ? err : "write_failed");

  const store = Object.freeze({
    kind: "file",
    load: (name) => core().invoke("store_load", { name }),
    save: (name, text) =>
      core().invoke("store_save", { name, text }).then(
        (canonical) => {
          if (window.PCalc.bus) window.PCalc.bus.post(name + "-changed");
          return { ok: true, text: canonical };
        },
        (err) => ({ ok: false, code: code(err) })
      ),
    saveIf: (name, expected, text) =>
      core().invoke("store_save_if", { name, expected: expected === undefined ? null : expected, text }).then(
        (canonical) => {
          if (window.PCalc.bus) window.PCalc.bus.post(name + "-changed");
          return { ok: true, text: canonical };
        },
        (err) => ({ ok: false, code: code(err) })
      ),
    clear: (name) =>
      core().invoke("store_clear", { name }).then(
        (backup) => ({ ok: true, backup: backup || null }),
        (err) => ({ ok: false, code: code(err) })
      )
  });

  window.PCalc.platforms.tauri = Object.freeze({
    name: "tauri",
    available: () => core() !== null,
    init: async () => undefined,
    engine: (op, req) => core().invoke("engine_call", { op, req }),
    engineInfo: () => ({ kind: "native", sha256: null }),
    openStore: async () => store,
    persist: async () => null,
    // -> {ok: true, path} or {ok: false, code}; kind "json" | "csv",
    // stamp "yyyymmdd-hhmmss" (local time).
    exportFile: (kind, stamp, text) =>
      core().invoke("export_file", { kind, stamp, text }).then(
        (path) => ({ ok: true, path: String(path) }),
        (err) => ({ ok: false, code: typeof err === "string" ? err : "export_failed" })
      ),
    estimate: async () => null,
    isSmokeTest: () => core().invoke("is_smoke_test"),
    reportSmoke: (passed, details) => core().invoke("report_smoke_result", { passed, details })
  });
})();
