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

  // The share sheet with the export as a file, where the browser can share
  // files: "shared", "cancelled" (the user closed the sheet) or null (not
  // possible here).
  async function shareFile(text, name, type) {
    try {
      const nav = window.navigator;
      if (typeof nav.share !== "function" || typeof nav.canShare !== "function" || typeof File !== "function") return null;
      const file = new File([String(text)], name, { type });
      if (!nav.canShare({ files: [file] })) return null;
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (err) {
      return err && err.name === "AbortError" ? "cancelled" : null;
    }
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
    // browser's own download folder). An iOS home-screen app (which may
    // ignore a download without a word) offers the file to the share sheet
    // instead, where the browser can share files. A download is only
    // started: the browser may still refuse it, so the panel says
    // "Download started" and also offers "Copy export to clipboard" and, as
    // the last resort, the text itself.
    exportFile: async (kind, stamp, text) => {
      const name = "Portable-Calculator-" + stamp + "." + kind;
      const type = kind === "csv" ? "text/csv" : "application/json";
      if (window.navigator.standalone === true) {
        const shared = await shareFile(text, name, type);
        if (shared === "shared") return { ok: true, path: null, shared: true };
        if (shared === "cancelled") return { ok: false, code: "cancelled" };
      }
      const ok = window.PCalc.dom.download(text, name, type);
      return ok ? { ok: true, path: null } : { ok: false, code: "export_failed" };
    },
    estimate: () => window.PCalc.store.estimate(),
    isSmokeTest: async () => false,
    reportSmoke: async () => undefined
  });
})();
