// Hash routes (plan B5): #/standard, #/date, #/converter/length, #/settings …
// The list is closed: an unknown hash falls back to the default route and
// nothing in the hash is ever evaluated or inserted as markup.
(function () {
  "use strict";
  const CONVERTERS = Object.freeze([
    "volume", "length", "mass", "temperature", "energy", "area",
    "speed", "time", "power", "data", "pressure", "angle"
  ]);
  // Drawer groups, in order (plan B5).
  const GROUPS = Object.freeze([
    { key: "calculator", routes: ["standard", "scientific", "graphing", "programmer"] },
    { key: "tools", routes: ["date", "percent"] },
    { key: "converter", routes: CONVERTERS.map((c) => "converter/" + c) }
  ]);
  const ROUTES = Object.freeze([
    "standard", "scientific", "graphing", "programmer", "date", "percent",
    ...CONVERTERS.map((c) => "converter/" + c),
    "settings", "about", "mini"
  ]);
  const DEFAULT_ROUTE = "standard";
  // Alt+1 … Alt+6 (plan B5).
  const SHORTCUTS = Object.freeze(["standard", "scientific", "graphing", "programmer", "date", "percent"]);
  const listeners = [];

  const known = (route) => typeof route === "string" && ROUTES.includes(route);

  function parse(hash) {
    const route = String(hash || "").replace(/^#\/?/, "");
    return known(route) ? route : DEFAULT_ROUTE;
  }

  // Whether the address names a known route (an empty or unknown hash does not).
  function explicit() {
    return known(String(window.location.hash || "").replace(/^#\/?/, ""));
  }

  function current() {
    return parse(window.location.hash);
  }

  function go(route) {
    if (!known(route)) throw new Error("unknown route: " + route);
    if (current() === route && explicit()) {
      for (const fn of listeners) fn(route);
      return;
    }
    window.location.hash = "#/" + route;
  }

  // Shows `route` without a new history entry (the restored last route).
  function replace(route) {
    if (!known(route)) throw new Error("unknown route: " + route);
    const url = window.location.href.replace(/#.*$/, "") + "#/" + route;
    window.history.replaceState(null, "", url);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  window.addEventListener("hashchange", () => {
    const route = current();
    for (const fn of listeners) fn(route);
  });

  window.PCalc.router = Object.freeze({
    ROUTES, GROUPS, CONVERTERS, SHORTCUTS, DEFAULT_ROUTE,
    known, parse, explicit, current, go, replace, onChange
  });
})();
