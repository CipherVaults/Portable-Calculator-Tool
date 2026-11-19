// The history hook (plan B10). Tools call history.record(entry) on the
// explicit actions only (Calculate, Enter, Copy); live updates never
// record. The history store (web/src/history/history-store.js, M3)
// attaches itself as the sink at boot; entries recorded before that (none
// in practice: the tools render after the store) wait in a small
// in-memory queue and drain into it in order.
//
// entry: {tool, calculator, calculatorLabel?, inputs: {name: string},
//         expressionText?, inputsText, resultText, copyText};
// timestampMs is added here. recorded() lists what this session handed on
// (the newest 50; tests and the desktop smoke run read it).
(function () {
  "use strict";
  const QUEUE_MAX = 50;
  const TOOLS = new Set(["standard", "scientific", "programmer", "graphing", "converter", "percent", "date"]);
  const queue = [];
  const log = [];
  let sink = null;

  const text = (v) => typeof v === "string";

  function valid(e) {
    if (!e || typeof e !== "object" || !TOOLS.has(e.tool) || !text(e.calculator)) return false;
    if (!e.inputs || typeof e.inputs !== "object") return false;
    if (!Object.values(e.inputs).every(text)) return false;
    return [e.inputsText, e.resultText, e.copyText].every((v) => text(v) && v.trim() !== "");
  }

  function remember(entry) {
    log.push(entry);
    if (log.length > QUEUE_MAX) log.shift();
  }

  // Returns true when the entry was taken (queued or handed to the store).
  function record(entry) {
    if (!valid(entry)) return false;
    const copy = JSON.parse(JSON.stringify(entry));
    copy.timestampMs = Date.now();
    remember(copy);
    if (sink) {
      sink(JSON.parse(JSON.stringify(copy)));
      return true;
    }
    queue.push(copy);
    if (queue.length > QUEUE_MAX) queue.shift();
    return true;
  }

  // The history store takes over; queued entries go first, in order.
  function attach(fn) {
    if (typeof fn !== "function") throw new Error("history sink must be a function");
    sink = fn;
    while (queue.length) sink(queue.shift());
  }

  window.PCalc.history = Object.freeze({
    record,
    attach,
    pending: () => queue.map((e) => JSON.parse(JSON.stringify(e))),
    recorded: () => log.map((e) => JSON.parse(JSON.stringify(e)))
  });
})();
