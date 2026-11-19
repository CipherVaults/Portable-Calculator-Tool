// Web / PWA adapter (plan B4): the engine is engine.wasm. Multi-file builds
// fetch the content-hashed file; the single-file build embeds it as base64
// in <script type="application/octet-stream" id="engineWasm">. Documents
// live in IndexedDB (web/src/core/store.js), validated by the engine.
//
// init() rejects with the loader's error codes (engine-web.js), plus "load"
// when the engine file cannot be read at all.
(function () {
  "use strict";
  let engine = null;

  function failure(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  function base64ToBytes(text) {
    const bin = atob(text.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function loadBytes(build) {
    try {
      const inline = document.getElementById("engineWasm");
      if (inline) return base64ToBytes(inline.textContent || "");
      const response = await fetch(build.engineFile, { credentials: "same-origin" });
      if (!response.ok) throw new Error("status " + response.status);
      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      throw failure("load", "engine download failed: " + (err && err.message ? err.message : "unknown"));
    }
  }

  async function init() {
    const build = window.PCalc.build;
    // Check WebAssembly before downloading anything.
    if (typeof WebAssembly !== "object" || WebAssembly === null) {
      throw failure("no_wasm", "WebAssembly is not available");
    }
    const bytes = await loadBytes(build);
    engine = await window.PCalc.engineWeb.create(bytes, build.engineSha256);
  }

  window.PCalc.platforms.web = Object.freeze({
    name: "web",
    available: () => true,
    init,
    engine: (op, req) => {
      if (engine === null) return Promise.reject(new Error("engine not loaded"));
      return engine.call(op, req);
    },
    // What the boot reports on <html>: the engine kind and, for WASM, the
    // SHA-256 the loader verified before compiling.
    engineInfo: () => ({ kind: "wasm", sha256: engine === null ? null : engine.sha256 }),
    openStore: () => window.PCalc.store.openWebStore((op, req) => engine.call(op, req), window.PCalc.bus),
    persist: () => window.PCalc.store.persist(),
    // A Blob download named Portable-Calculator-<stamp>.<kind> (the
    // browser's own download folder or share sheet); the History panel
    // also offers "Copy export to clipboard" (iOS home-screen apps).
    exportFile: async (kind, stamp, text) => {
      const ok = window.PCalc.dom.download(text, "Portable-Calculator-" + stamp + "." + kind, kind === "csv" ? "text/csv" : "application/json");
      return ok ? { ok: true, path: null } : { ok: false, code: "export_failed" };
    },
    estimate: () => window.PCalc.store.estimate(),
    isSmokeTest: async () => false,
    reportSmoke: async () => undefined
  });
})();
