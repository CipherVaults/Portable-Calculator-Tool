// Loader for engine.wasm's raw ABI (plan B3). No wasm-bindgen glue:
//   pc_abi() -> 1
//   pc_in(len) -> input address (0 = refused, too large)
//   pc_call(opLen, reqLen) -> envelope length
//   pc_out() -> envelope address
// The bytes are integrity-checked (SHA-256 against the build-time constant)
// before compiling. memory.buffer is re-read after every export call because
// the memory may grow. A trap re-instantiates the module on the next call
// and answers this one with the `internal` envelope.
(function () {
  "use strict";
  const ABI_VERSION = 1;
  const envelope = (code, message) =>
    '{"ok":"false","error":{"code":"' + code + '","field":null,"message":"' + message + '"}}';
  const INTERNAL = envelope("internal", "Internal error.");
  const TOO_LARGE = envelope("request_too_large", "Request is too large.");
  const INVALID = envelope("invalid_request", "Invalid request.");

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function instantiate(module) {
    const instance = await WebAssembly.instantiate(module, {});
    const e = instance.exports;
    for (const name of ["pc_abi", "pc_in", "pc_call", "pc_out"]) {
      if (typeof e[name] !== "function") throw new Error("engine export missing: " + name);
    }
    if (!(e.memory instanceof WebAssembly.Memory)) throw new Error("engine memory missing");
    if (e.pc_abi() !== ABI_VERSION) throw new Error("engine ABI mismatch");
    return e;
  }

  // Resolves to {call(op, req) -> Promise<envelope string>}, or rejects when
  // WebAssembly is missing, the hash differs or the module is not ours.
  async function create(bytes, expectedSha256Hex) {
    if (typeof WebAssembly !== "object" || WebAssembly === null) {
      throw new Error("WebAssembly is not available");
    }
    const actual = await sha256Hex(bytes);
    if (actual !== expectedSha256Hex) throw new Error("engine integrity check failed");
    const module = await WebAssembly.compile(bytes);
    let exports = await instantiate(module);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8");

    function callNow(e, op, req) {
      const opBytes = encoder.encode(op);
      const reqBytes = encoder.encode(req);
      const total = opBytes.length + reqBytes.length;
      const inAddr = e.pc_in(total) >>> 0;
      if (inAddr === 0) return TOO_LARGE;
      const input = new Uint8Array(e.memory.buffer, inAddr, total);
      input.set(opBytes, 0);
      input.set(reqBytes, opBytes.length);
      const outLen = e.pc_call(opBytes.length, reqBytes.length) >>> 0;
      const outAddr = e.pc_out() >>> 0;
      const output = new Uint8Array(e.memory.buffer, outAddr, outLen).slice();
      return decoder.decode(output);
    }

    async function call(op, req) {
      if (typeof op !== "string" || typeof req !== "string") return INVALID;
      try {
        if (exports === null) exports = await instantiate(module);
        return callNow(exports, op, req);
      } catch (_) {
        exports = null;
        return INTERNAL;
      }
    }

    return Object.freeze({ call });
  }

  window.PCalc.engineWeb = Object.freeze({ create, sha256Hex, ABI_VERSION });
})();
