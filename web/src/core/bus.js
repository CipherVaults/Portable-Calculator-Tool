// Cross-window change notices over BroadcastChannel("pcalc") (plan B4, B5a).
// Messages are {v:1, type} with a type from a closed list; anything else
// received is ignored. Without BroadcastChannel the bus is a no-op.
(function () {
  "use strict";
  const TYPES = new Set(["history-changed", "settings-changed", "state-changed", "countdowns-changed"]);
  const listeners = new Map();
  let channel = null;
  try {
    if (typeof BroadcastChannel === "function") channel = new BroadcastChannel("pcalc");
  } catch (_) {
    channel = null;
  }
  if (channel) {
    channel.onmessage = (event) => {
      const msg = event.data;
      if (!msg || msg.v !== 1 || typeof msg.type !== "string" || !TYPES.has(msg.type)) return;
      for (const fn of listeners.get(msg.type) || []) {
        try {
          fn();
        } catch (_) {
          // One broken listener must not stop the others.
        }
      }
    };
  }

  function post(type) {
    if (!TYPES.has(type)) throw new Error("unknown bus message: " + type);
    if (channel) channel.postMessage({ v: 1, type });
  }

  function on(type, fn) {
    if (!TYPES.has(type)) throw new Error("unknown bus message: " + type);
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  }

  window.PCalc.bus = Object.freeze({ post, on, available: channel !== null });
})();
