// The frozen window.PCalc namespace (plan B4). Classic scripts load in the
// order of web/build-manifest.json; each adds one frozen member, and boot.js
// freezes the namespace itself last.
(function () {
  "use strict";
  if (Object.prototype.hasOwnProperty.call(window, "PCalc")) {
    throw new Error("PCalc loaded twice");
  }
  Object.defineProperty(window, "PCalc", {
    value: { platforms: {} },
    writable: false,
    configurable: false,
    enumerable: false
  });
})();
