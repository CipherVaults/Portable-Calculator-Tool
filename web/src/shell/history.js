// The history hook (plan B10). Tools call history.record(entry) on the
// explicit actions only (Calculate, Enter, Copy); live updates never
// record. Until M3 plugs in the history store, entries wait in a small
// in-memory queue (this session only, never written anywhere); M3 calls
// attach(sink) and the queue drains into it in order.
//
// entry: {tool, calculator, inputs: {name: string}, inputsText,
//         resultText, copyText}; timestampMs is added here.
(function () {
  "use strict";
  const QUEUE_MAX = 50;
  const TOOLS = new Set(["standard", "scientific", "programmer", "graphing", "converter", "percent", "date"]);
  const queue = [];
  let sink = null;

  const text = (v) => typeof v === "string";

  function valid(e) {
    if (!e || typeof e !== "object" || !TOOLS.has(e.tool) || !text(e.calculator)) return false;
    if (!e.inputs || typeof e.inputs !== "object") return false;
    if (!Object.values(e.inputs).every(text)) return false;
    return [e.inputsText, e.resultText, e.copyText].every((v) => text(v) && v.trim() !== "");
  }

  // Returns true when the entry was taken (queued or handed to the store).
  function record(entry) {
    if (!valid(entry)) return false;
    const copy = JSON.parse(JSON.stringify(entry));
    copy.timestampMs = Date.now();
    if (sink) {
      sink(copy);
      return true;
    }
    queue.push(copy);
    if (queue.length > QUEUE_MAX) queue.shift();
    return true;
  }

  // M3: the history store takes over; queued entries go first, in order.
  function attach(fn) {
    if (typeof fn !== "function") throw new Error("history sink must be a function");
    sink = fn;
    while (queue.length) sink(queue.shift());
  }

  window.PCalc.history = Object.freeze({
    record,
    attach,
    pending: () => queue.map((e) => JSON.parse(JSON.stringify(e)))
  });
})();
