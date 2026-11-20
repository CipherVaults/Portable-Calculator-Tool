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
    "aria-pressed", "aria-selected", "aria-orientation", "aria-disabled", "aria-atomic",
    "aria-invalid", "min", "max", "step", "maxlength", "placeholder", "inputmode",
    "autocomplete", "spellcheck", "enterkeyhint", "accept", "readonly",
    "data-check", "data-state", "data-route", "data-tab", "data-doc", "data-value",
    "data-card", "data-date", "data-focus-key"
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
  //
  // Two more marks keep left-to-right text in order inside right-to-left
  // text (plan B5c: numbers and expressions stay LTR): ltrValue() is a
  // value that is also forced LTR (<bdi class="num" dir="ltr">, a signed
  // number or a formula operand), ltr() a run of engine English that may
  // wrap (<bdi class="ltr" dir="ltr">: "2026-11-19 - 5 days = 2026-11-14").
  const MARKS = /[\uE000-\uE005]/g;
  const mark = (open, text) => open + String(text).replace(MARKS, "") + String.fromCharCode(open.charCodeAt(0) + 1);
  const value = (text) => mark("\uE000", text);
  const ltr = (text) => mark("\uE002", text);
  const ltrValue = (text) => mark("\uE004", text);
  const KINDS = { "\uE000": ["num", null], "\uE002": ["ltr", "ltr"], "\uE004": ["num", "ltr"] };
  function withValues(text) {
    const s = String(text);
    const out = [];
    const re = /([\uE000\uE002\uE004])([^\uE000-\uE005]*)([\uE001\uE003\uE005])/g;
    let last = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (m[3].charCodeAt(0) !== m[1].charCodeAt(0) + 1) continue;
      if (m.index > last) out.push(document.createTextNode(s.slice(last, m.index).replace(MARKS, "")));
      const [className, dir] = KINDS[m[1]];
      out.push(el("bdi", { className, text: m[2], attrs: { dir } }));
      last = re.lastIndex;
    }
    if (last < s.length) out.push(document.createTextNode(s.slice(last).replace(MARKS, "")));
    return out;
  }
  // Engine English as one left-to-right run (a node list for show()/el()).
  const ltrNodes = (text) => [el("bdi", { className: "ltr", text: String(text), attrs: { dir: "ltr" } })];

  // Hands the user a file (an export, plan B10): the text as a Blob behind
  // a temporary object URL on a hidden <a download>, revoked a little
  // later. The link only ever holds a blob: URL this function made. Returns
  // false where the browser cannot (no Blob or object URLs).
  function download(text, fileName, type) {
    try {
      const U = window.URL;
      if (typeof Blob !== "function" || !U || typeof U.createObjectURL !== "function") return false;
      const url = String(U.createObjectURL(new Blob([String(text)], { type: type + ";charset=utf-8" })));
      if (!/^blob:/.test(url)) return false;
      const a = document.createElement("a");
      a.href = url;
      a.download = String(fileName);
      a.className = "sr-only";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => U.revokeObjectURL(url), 60000);
      return true;
    } catch (_) {
      return false;
    }
  }

  window.PCalc.dom = Object.freeze({ el, byId, show, setAttr, flag, value, ltr, ltrValue, withValues, ltrNodes, download });
})();
