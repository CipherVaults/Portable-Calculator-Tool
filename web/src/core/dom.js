// DOM helpers. The only ways UI code changes the page: textContent,
// createElement, setAttribute (allowlisted), classList and replaceChildren.
// Never innerHTML/outerHTML/insertAdjacentHTML/document.write, never .style.
(function () {
  "use strict";
  const ALLOWED_ATTRS = new Set([
    "id", "role", "title", "lang", "dir", "type", "for", "name", "value",
    "tabindex", "hidden", "disabled", "aria-label", "aria-live", "aria-hidden",
    "aria-describedby", "aria-expanded", "aria-controls", "aria-current",
    "aria-pressed", "data-check", "data-state"
  ]);

  // Creates <tag> with optional className, text and allowlisted attributes,
  // then appends children (nodes or strings, strings become text nodes).
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    const o = opts || {};
    if (o.className) node.className = o.className;
    if (o.text !== undefined && o.text !== null) node.textContent = String(o.text);
    if (o.attrs) {
      for (const [name, value] of Object.entries(o.attrs)) {
        if (!ALLOWED_ATTRS.has(name)) throw new Error("attribute not allowed: " + name);
        node.setAttribute(name, String(value));
      }
    }
    for (const child of children || []) {
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  // Replaces every child of `node` with `children`.
  function show(node, children) {
    node.replaceChildren(...children);
  }

  window.PCalc.dom = Object.freeze({ el, byId, show });
})();
