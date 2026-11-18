// Hash routes (plan B5): #/standard, #/date, #/converter/length, #/mini …
// Unknown hashes fall back to the default route; nothing is ever evaluated.
(function () {
  "use strict";
  const CONVERTERS = [
    "volume", "length", "mass", "temperature", "energy", "area",
    "speed", "time", "power", "data", "pressure", "angle"
  ];
  const ROUTES = Object.freeze([
    "standard", "scientific", "graphing", "programmer", "date", "percent", "mini",
    ...CONVERTERS.map((c) => "converter/" + c)
  ]);
  const DEFAULT_ROUTE = "standard";
  const listeners = [];

  function parse(hash) {
    const route = String(hash || "").replace(/^#\/?/, "");
    return ROUTES.includes(route) ? route : DEFAULT_ROUTE;
  }

  function current() {
    return parse(window.location.hash);
  }

  function go(route) {
    if (!ROUTES.includes(route)) throw new Error("unknown route: " + route);
    window.location.hash = "#/" + route;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  window.addEventListener("hashchange", () => {
    const route = current();
    for (const fn of listeners) fn(route);
  });

  window.PCalc.router = Object.freeze({ ROUTES, DEFAULT_ROUTE, parse, current, go, onChange });
})();
