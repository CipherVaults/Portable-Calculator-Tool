// DOM helpers. The only ways UI code changes the page: textContent,
// createElement, setAttribute (allowlisted), classList and replaceChildren.
// Never an HTML sink or an inline style write (scripts/lib/web-hygiene.mjs).
(function () {
  "use strict";
  const ALLOWED_ATTRS = new Set([
    "id", "role", "title", "lang", "dir", "type", "for", "name", "value", "href",
    "tabindex", "hidden", "disabled", "inert", "checked", "selected",
    "aria-label", "aria-labelledby", "aria-live", "aria-hidden", "aria-modal",
    "aria-describedby", "aria-expanded", "aria-controls", "aria-current",
    "aria-pressed", "aria-selected", "aria-orientation",
    "data-check", "data-state", "data-route", "data-tab", "data-doc", "data-value"
  ]);
  // Links only ever point at an app route.
  const SAFE_HREF = /^#\/[a-z/]*$/;

  function setAttr(node, name, value) {
    if (!ALLOWED_ATTRS.has(name)) throw new Error("attribute not allowed: " + name);
    const text = String(value);
    if (name === "href" && !SAFE_HREF.test(text)) throw new Error("href not allowed: " + text);
    node.setAttribute(name, text);
  }

  // Creates <tag> with optional className, text and allowlisted attributes,
  // then appends children (nodes or strings, strings become text nodes).
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    const o = opts || {};
    if (o.className) node.className = o.className;
    if (o.text !== undefined && o.text !== null) node.textContent = String(o.text);
    if (o.attrs) {
      for (const [name, value] of Object.entries(o.attrs)) {
        if (value === false || value === null || value === undefined) continue;
        setAttr(node, name, value === true ? "" : value);
      }
    }
    for (const child of children || []) {
      if (child === null || child === undefined || child === false) continue;
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

  // Sets or removes a boolean attribute such as hidden or inert.
  function flag(node, name, on) {
    if (on) setAttr(node, name, "");
    else node.removeAttribute(name);
  }

  // Formatted values (numbers, dates, sizes) inside translated text: mark
  // each one with value() before t() fills it in, then withValues() turns
  // the text into text nodes and <bdi class="num"> elements, which never
  // break across lines (styles: .num). The marks are two private-use
  // characters that no catalog or formatter produces.
  const OPEN = "\uE000";
  const CLOSE = "\uE001";
  const MARKS = /[\uE000\uE001]/g;
  const value = (text) => OPEN + String(text).replace(MARKS, "") + CLOSE;
  function withValues(text) {
    const s = String(text);
    const out = [];
    const re = /\uE000([^\uE000\uE001]*)\uE001/g;
    let last = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index).replace(MARKS, "")));
      out.push(el("bdi", { className: "num", text: m[1] }));
      last = re.lastIndex;
    }
    if (last < s.length) out.push(document.createTextNode(s.slice(last).replace(MARKS, "")));
    return out;
  }

  window.PCalc.dom = Object.freeze({ el, byId, show, setAttr, flag, value, withValues });
})();
