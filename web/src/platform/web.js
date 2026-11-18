// Web / PWA adapter (plan B4): the engine is engine.wasm. Multi-file builds
// fetch the content-hashed file; the single-file build embeds it as base64
// in <script type="application/octet-stream" id="engineWasm">.
(function () {
  "use strict";
  let engine = null;

  function base64ToBytes(text) {
    const bin = atob(text.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function loadBytes(build) {
    const inline = document.getElementById("engineWasm");
    if (inline) return base64ToBytes(inline.textContent || "");
    const response = await fetch(build.engineFile, { credentials: "same-origin" });
    if (!response.ok) throw new Error("engine download failed: " + response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function init() {
    const build = window.PCalc.build;
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
    isSmokeTest: async () => false,
    reportSmoke: async () => undefined
  });
})();
