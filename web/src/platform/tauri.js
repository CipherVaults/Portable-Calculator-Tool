// Desktop adapter (plan B4): the engine is native, reached through the one
// Tauri command engine_call(op, req). The desktop CSP stays connect-src
// 'none' with no 'wasm-unsafe-eval'.
(function () {
  "use strict";
  function core() {
    const t = window.__TAURI__;
    return t && t.core && typeof t.core.invoke === "function" ? t.core : null;
  }

  window.PCalc.platforms.tauri = Object.freeze({
    name: "tauri",
    available: () => core() !== null,
    init: async () => undefined,
    engine: (op, req) => core().invoke("engine_call", { op, req }),
    engineInfo: () => ({ kind: "native", sha256: null }),
    isSmokeTest: () => core().invoke("is_smoke_test"),
    reportSmoke: (passed, details) => core().invoke("report_smoke_result", { passed, details })
  });
})();
