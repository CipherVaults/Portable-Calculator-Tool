// A small, dependency-free browser stand-in for scripts/safety-eval.mjs
// slices B and C (plan B15: "UI under both adapters, with an IndexedDB fake
// in the mini-DOM"). It is just enough of the platform for the shell's
// classic scripts to run unchanged in a node:vm context:
//
//   Document / Element / Text   createElement, attributes, textContent,
//                               className, append, replaceChildren, a
//                               compound-selector querySelector(All) and
//                               closest, focus with document.activeElement
//                               (focus, focusin, focusout), bubbling
//                               events, click() (radio change),
//                               and a browser-like Tab key that moves focus
//                               in document order (it skips hidden and
//                               disabled elements but, like an older
//                               browser, NOT inert ones, so the shell's own
//                               focus trap is what keeps focus in a modal)
//   window                      location.hash + hashchange, a settable
//                               clock (opts.now), page visibility,
//                               history.replaceState, matchMedia (width and
//                               prefers-color-scheme, both changeable),
//                               localStorage, BroadcastChannel, navigator
//                               (languages, storage), timers, fetch (a map
//                               of URLs to bytes), crypto, WebAssembly
//   FakeIndexedDB               open/upgrade/abort, one object store with
//                               get, put, delete, getAll, getAllKeys,
//                               transactions that commit atomically when no
//                               request is pending and abort on a simulated
//                               quota error; hooks to fail open or reads
//
// Several windows can share one "origin" (IndexedDB, localStorage and the
// BroadcastChannel hub), which is how the cross-tab sync is tested.
// Nothing here parses or renders HTML; there is no HTML sink.
import vm from "node:vm";
import { webcrypto } from "node:crypto";

// ---------------------------------------------------------------------------
// Selectors: compound only (tag, #id, .class, [attr], [attr='v'],
// :not(<compound>)), comma lists. No combinators.
// ---------------------------------------------------------------------------

function parseCompound(text) {
  const parts = { tag: null, id: null, classes: [], attrs: [], nots: [] };
  let s = text.trim();
  const take = (re) => {
    const m = re.exec(s);
    if (!m) return null;
    s = s.slice(m[0].length);
    return m;
  };
  let m = take(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (m) parts.tag = m[0].toLowerCase();
  while (s.length) {
    if ((m = take(/^#([\w-]+)/))) parts.id = m[1];
    else if ((m = take(/^\.([\w-]+)/))) parts.classes.push(m[1]);
    else if ((m = take(/^\[\s*([\w-]+)\s*(?:=\s*(?:'([^']*)'|"([^"]*)"|([\w-]+))\s*)?\]/))) {
      parts.attrs.push({ name: m[1], value: m[2] ?? m[3] ?? m[4] ?? null });
    } else if ((m = take(/^:not\(([^)]*(?:\([^)]*\))?[^)]*)\)/))) parts.nots.push(parseCompound(m[1]));
    else throw new Error(`mini-dom: unsupported selector ${text}`);
  }
  return parts;
}

function matchCompound(el, p) {
  if (el.nodeType !== 1) return false;
  if (p.tag && el.localName !== p.tag) return false;
  if (p.id && el.getAttribute("id") !== p.id) return false;
  const classes = (el.getAttribute("class") || "").split(/\s+/);
  if (p.classes.some((c) => !classes.includes(c))) return false;
  for (const a of p.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== null && el.getAttribute(a.name) !== a.value) return false;
  }
  return !p.nots.some((n) => matchCompound(el, n));
}

const selectorCache = new Map();
function matches(el, selector) {
  if (!selectorCache.has(selector)) selectorCache.set(selector, selector.split(",").map(parseCompound));
  return selectorCache.get(selector).some((p) => matchCompound(el, p));
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export class Event {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.propagationStopped = false;
    Object.assign(this, init.props || {});
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.propagationStopped = true;
  }
}

class Node {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(value) {
    this.replaceChildren(this.ownerDocument.createTextNode(String(value)));
  }
  append(...nodes) {
    for (const n of nodes) {
      const node = typeof n === "string" ? this.ownerDocument.createTextNode(n) : n;
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  replaceChildren(...nodes) {
    for (const old of this.childNodes) old.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
    const doc = this.ownerDocument;
    if (doc.activeElement && doc.activeElement !== doc.body && !doc.documentElement.contains(doc.activeElement)) doc.activeElement = doc.body;
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  *descendants() {
    for (const c of this.childNodes) {
      if (c.nodeType === 1) {
        yield c;
        yield* c.descendants();
      }
    }
  }
  querySelectorAll(selector) {
    return [...this.descendants()].filter((e) => matches(e, selector));
  }
  querySelector(selector) {
    for (const e of this.descendants()) if (matches(e, selector)) return e;
    return null;
  }
  addEventListener(type, fn, opts) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ fn, once: Boolean(opts && opts.once) });
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((l) => l.fn !== fn));
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);
    if (this.ownerDocument && path[path.length - 1] === this.ownerDocument.documentElement) path.push(this.ownerDocument);
    for (const n of event.bubbles ? path : [this]) {
      event.currentTarget = n;
      for (const l of [...(n.listeners.get(event.type) || [])]) {
        if (l.once) n.removeEventListener(event.type, l.fn);
        l.fn.call(n, event);
      }
      if (event.propagationStopped) break;
    }
    return !event.defaultPrevented;
  }
}

class Text extends Node {
  constructor(doc, text) {
    super(doc, 3);
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

const BOOLEAN_PROPS = ["checked", "selected", "disabled", "hidden"];

class Element extends Node {
  constructor(doc, tag) {
    super(doc, 1);
    this.localName = tag.toLowerCase();
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this._checked = false;
    this._selected = false;
    const el = this;
    this.dataset = new Proxy(
      {},
      {
        get: (_, k) => (typeof k === "string" ? el.getAttribute("data-" + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())) ?? undefined : undefined),
        set: (_, k, v) => {
          el.setAttribute("data-" + String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), String(v));
          return true;
        }
      }
    );
  }
  setAttribute(name, value) {
    this.attributes.set(name.toLowerCase(), String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name.toLowerCase()) ? this.attributes.get(name.toLowerCase()) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }
  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
  }
  get id() {
    return this.getAttribute("id") || "";
  }
  set id(v) {
    this.setAttribute("id", v);
  }
  get className() {
    return this.getAttribute("class") || "";
  }
  set className(v) {
    this.setAttribute("class", v);
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list().includes(c),
      add: (...cs) => (el.className = [...new Set([...list(), ...cs])].join(" ")),
      remove: (...cs) => (el.className = list().filter((x) => !cs.includes(x)).join(" ")),
      toggle: (c, force) => {
        const on = force === undefined ? !list().includes(c) : force;
        if (on) el.classList.add(c);
        else el.classList.remove(c);
        return on;
      }
    };
  }
  get checked() {
    return this._checked;
  }
  set checked(v) {
    this._checked = Boolean(v);
    if (this._checked && this.getAttribute("type") === "radio" && this.getAttribute("name")) {
      const root = this.ownerDocument.documentElement;
      for (const other of root.querySelectorAll(`input[name='${this.getAttribute("name")}']`)) if (other !== this) other._checked = false;
    }
  }
  get selected() {
    return this._selected;
  }
  set selected(v) {
    this._selected = Boolean(v);
  }
  get value() {
    if (this.localName === "select") {
      const opts = this.querySelectorAll("option");
      const sel = opts.find((o) => o.selected) || opts[0];
      return sel ? sel.getAttribute("value") ?? sel.textContent : "";
    }
    return this.getAttribute("value") ?? "";
  }
  set value(v) {
    if (this.localName === "select") {
      for (const o of this.querySelectorAll("option")) o.selected = o.getAttribute("value") === String(v);
    } else this.setAttribute("value", v);
  }
  closest(selector) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, selector)) return n;
    return null;
  }
  // Whether this element or an ancestor is hidden (display: none).
  get isHidden() {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute("hidden")) return true;
    return false;
  }
  get isInert() {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute("inert")) return true;
    return false;
  }
  get isConnected() {
    return this.ownerDocument.documentElement.contains(this);
  }
  focus() {
    const doc = this.ownerDocument;
    // Inert is not honoured here either (an older browser without inert):
    // the shell's focus trap must do the work.
    if (!this.isConnected || this.isHidden) return;
    if (!doc.isFocusable(this) && !this.hasAttribute("tabindex")) return;
    const prev = doc.activeElement;
    if (prev === this) return;
    // As a browser: focusout on the old element, then focus and focusin
    // (both bubble but focus), each with the other element as relatedTarget.
    doc.activeElement = this;
    if (prev && prev !== doc.body) prev.dispatchEvent(new Event("focusout", { props: { relatedTarget: this } }));
    this.dispatchEvent(new Event("focus", { bubbles: false }));
    this.dispatchEvent(new Event("focusin", { props: { relatedTarget: prev && prev !== doc.body ? prev : null } }));
  }
  blur() {
    const doc = this.ownerDocument;
    if (doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.dispatchEvent(new Event("focusout", { props: { relatedTarget: null } }));
  }
  click() {
    if (this.hasAttribute("disabled")) return;
    const ev = new Event("click");
    const proceed = this.dispatchEvent(ev);
    if (proceed && this.localName === "input" && this.getAttribute("type") === "radio" && !this.checked) {
      this.checked = true;
      this.dispatchEvent(new Event("change"));
    }
    if (proceed && this.localName === "a" && this.getAttribute("href")) this.ownerDocument.defaultView.location.assignHash(this.getAttribute("href"));
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

class Document extends Node {
  constructor(win) {
    super(null, 9);
    this.ownerDocument = this;
    this.defaultView = win;
    this.documentElement = new Element(this, "html");
    this.head = new Element(this, "head");
    this.body = new Element(this, "body");
    this.documentElement.append(this.head, this.body);
    this.childNodes = [this.documentElement];
    this.documentElement.parentNode = null;
    this.activeElement = this.body;
    this.visibilityState = "visible";
    this.readyState = "complete";
    this.title = "";
  }
  createElement(tag) {
    return new Element(this, tag);
  }
  createTextNode(text) {
    return new Text(this, String(text));
  }
  getElementById(id) {
    for (const e of this.documentElement.descendants()) if (e.getAttribute("id") === id) return e;
    return null;
  }
  querySelectorAll(selector) {
    return [this.documentElement, ...this.documentElement.descendants()].filter((e) => matches(e, selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  contains(node) {
    return this.documentElement.contains(node);
  }
  isFocusable(el) {
    if (el.hasAttribute("disabled")) return false;
    if (["button", "input", "select", "textarea"].includes(el.localName)) return true;
    if (el.localName === "a" && el.hasAttribute("href")) return true;
    return el.hasAttribute("tabindex");
  }
  // The browser's Tab order: document order, tabindex >= 0, not hidden,
  // not disabled. Inert is deliberately ignored (an older browser).
  tabbables() {
    return [...this.documentElement.descendants()].filter(
      (e) => this.isFocusable(e) && !e.isHidden && e.getAttribute("tabindex") !== "-1"
    );
  }
  // A key press: keydown on the focused element, bubbling to document;
  // an unprevented Tab moves focus like a browser.
  press(key, mods = {}) {
    const props = {
      key,
      code: mods.code || (/^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : /^\d$/.test(key) ? "Digit" + key : key),
      altKey: Boolean(mods.alt),
      ctrlKey: Boolean(mods.ctrl),
      metaKey: Boolean(mods.meta),
      shiftKey: Boolean(mods.shift),
      isComposing: Boolean(mods.composing)
    };
    const target = this.activeElement || this.body;
    const ev = new Event("keydown", { props });
    target.dispatchEvent(ev);
    if (!ev.defaultPrevented && key === "Tab") {
      const list = this.tabbables();
      const i = list.indexOf(this.activeElement);
      const next = props.shiftKey ? list[i <= 0 ? list.length - 1 : i - 1] : list[(i + 1) % list.length];
      if (next) next.focus();
    }
    return ev;
  }
}

// ---------------------------------------------------------------------------
// Storage, BroadcastChannel, IndexedDB
// ---------------------------------------------------------------------------

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.blocked = false;
  }
  check() {
    if (this.blocked) {
      const e = new Error("The operation is insecure.");
      e.name = "SecurityError";
      throw e;
    }
  }
  get length() {
    this.check();
    return this.map.size;
  }
  key(i) {
    this.check();
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    this.check();
    return this.map.has(String(k)) ? this.map.get(String(k)) : null;
  }
  setItem(k, v) {
    this.check();
    this.map.set(String(k), String(v));
  }
  removeItem(k) {
    this.check();
    this.map.delete(String(k));
  }
}

class ChannelHub {
  constructor() {
    this.channels = new Set();
    this.delivered = 0;
  }
  make() {
    const hub = this;
    return class BroadcastChannel {
      constructor(name) {
        this.name = String(name);
        this.onmessage = null;
        this.closed = false;
        hub.channels.add(this);
      }
      postMessage(data) {
        const copy = structuredClone(data);
        for (const other of hub.channels) {
          if (other === this || other.closed || other.name !== this.name) continue;
          setTimeout(() => {
            if (!other.closed && typeof other.onmessage === "function") {
              hub.delivered++;
              other.onmessage({ data: structuredClone(copy) });
            }
          }, 0);
        }
      }
      close() {
        this.closed = true;
        hub.channels.delete(this);
      }
    };
  }
}

function domError(name, message) {
  const e = new Error(message || name);
  e.name = name;
  return e;
}

class FakeRequest {
  constructor(tx) {
    this.transaction = tx;
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class FakeTransaction {
  constructor(db, mode) {
    this.db = db;
    this.mode = mode;
    this.pending = 0;
    this.state = "active";
    this.staged = new Map(db.data);
    this.wrote = false;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.queue = Promise.resolve();
    this.scheduleCommit();
  }
  objectStore(name) {
    if (!this.db.stores.has(name)) throw domError("NotFoundError", `no object store ${name}`);
    const tx = this;
    const req = (fn) => {
      if (tx.state !== "active") throw domError("TransactionInactiveError", "transaction is not active");
      const r = new FakeRequest(tx);
      tx.pending++;
      setTimeout(() => {
        tx.pending--;
        if (tx.state !== "active") return;
        try {
          r.result = fn();
          if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
        } catch (err) {
          // As in browsers: the error event fires at the request, then
          // bubbles to the transaction (whose .error is still null), and
          // only then does the transaction abort with the request's error.
          r.error = err;
          const event = { target: r, preventDefault() {} };
          if (typeof r.onerror === "function") r.onerror(event);
          if (typeof tx.onerror === "function") tx.onerror(event);
          tx.abort(err);
          return;
        }
        tx.scheduleCommit();
      }, 0);
      return r;
    };
    const factory = this.db.factory;
    const write = () => {
      if (tx.mode !== "readwrite") throw domError("ReadOnlyError", "read-only transaction");
    };
    return {
      get: (key) =>
        req(() => {
          if (factory.failReads) throw domError("UnknownError", "simulated read failure");
          return tx.staged.has(key) ? structuredClone(tx.staged.get(key)) : undefined;
        }),
      put: (value, key) => {
        write();
        return req(() => {
          if (factory.quotaExceeded) throw domError("QuotaExceededError", "simulated quota");
          tx.wrote = true;
          tx.staged.set(key, structuredClone(value));
          return key;
        });
      },
      delete: (key) => {
        write();
        return req(() => {
          tx.staged.delete(key);
          return undefined;
        });
      },
      getAll: () => req(() => [...tx.staged.keys()].sort().map((k) => structuredClone(tx.staged.get(k)))),
      getAllKeys: () => req(() => [...tx.staged.keys()].sort())
    };
  }
  scheduleCommit() {
    setTimeout(() => {
      if (this.state !== "active" || this.pending > 0) return;
      if (this.mode === "readwrite" && this.db.factory.quotaAtCommit && this.wrote) {
        // Chromium's way: every request succeeded, the commit fails.
        this.abort(domError("QuotaExceededError", "simulated quota at commit"));
        return;
      }
      this.state = "done";
      if (this.mode === "readwrite") {
        this.db.data = this.staged;
        this.db.factory.writes++;
      }
      if (typeof this.oncomplete === "function") this.oncomplete({});
    }, 0);
  }
  abort(err) {
    if (this.state !== "active") return;
    this.state = "aborted";
    this.error = err || domError("AbortError", "aborted");
    // Only "abort" fires at the transaction; a request's "error" (above)
    // has already reached its onerror.
    setTimeout(() => {
      if (typeof this.onabort === "function") this.onabort({ target: this });
    }, 0);
  }
}

class FakeDb {
  constructor(factory, name, record) {
    this.factory = factory;
    this.name = name;
    this.record = record;
    this.onversionchange = null;
    this.closed = false;
  }
  get data() {
    return this.record.data;
  }
  set data(d) {
    this.record.data = d;
  }
  get stores() {
    return this.record.stores;
  }
  get version() {
    return this.record.version;
  }
  get objectStoreNames() {
    const stores = this.record.stores;
    return { contains: (n) => stores.has(n), length: stores.size };
  }
  createObjectStore(name) {
    this.record.stores.add(name);
    return {};
  }
  transaction(store, mode = "readonly") {
    if (this.closed) throw domError("InvalidStateError", "database closed");
    if (!this.record.stores.has(store)) throw domError("NotFoundError", `no object store ${store}`);
    return new FakeTransaction(this, mode);
  }
  close() {
    this.closed = true;
  }
}

// One origin's IndexedDB. Hooks: failOpen ("error" | "blocked" | "hang"),
// failReads, quotaExceeded (the put request fails, as in Gecko) and
// quotaAtCommit (the requests succeed and the commit aborts, as in
// Chromium). `writes` counts committed write transactions.
export class FakeIndexedDB {
  constructor() {
    this.dbs = new Map();
    this.failOpen = null;
    this.failReads = false;
    this.quotaExceeded = false;
    this.quotaAtCommit = false;
    this.writes = 0;
    this.opens = 0;
  }
  // Test helpers (not part of the IndexedDB API).
  peek(dbName, key) {
    const rec = this.dbs.get(dbName);
    return rec && rec.data.has(key) ? structuredClone(rec.data.get(key)) : undefined;
  }
  keys(dbName) {
    const rec = this.dbs.get(dbName);
    return rec ? [...rec.data.keys()].sort() : [];
  }
  poke(dbName, key, value) {
    const rec = this.dbs.get(dbName);
    if (!rec) throw new Error(`no database ${dbName}`);
    rec.data.set(key, structuredClone(value));
  }
  open(name, version) {
    this.opens++;
    const factory = this;
    const req = new FakeRequest(null);
    req.onupgradeneeded = null;
    req.onblocked = null;
    setTimeout(() => {
      if (factory.failOpen === "hang") return;
      if (factory.failOpen === "blocked") {
        if (typeof req.onblocked === "function") req.onblocked({});
        return;
      }
      if (factory.failOpen === "error") {
        req.error = domError("UnknownError", "simulated open failure");
        if (typeof req.onerror === "function") req.onerror({ target: req, preventDefault() {} });
        return;
      }
      const existing = factory.dbs.get(name);
      const want = version === undefined ? (existing ? existing.version : 1) : version;
      if (existing && want < existing.version) {
        req.error = domError("VersionError", "lower version");
        if (typeof req.onerror === "function") req.onerror({ target: req, preventDefault() {} });
        return;
      }
      const record = existing ? existing : { version: 0, stores: new Set(), data: new Map() };
      const db = new FakeDb(factory, name, record);
      req.result = db;
      if (!existing || want > existing.version) {
        let aborted = false;
        const before = { version: record.version, stores: new Set(record.stores) };
        record.version = want;
        req.transaction = {
          abort() {
            aborted = true;
          }
        };
        if (typeof req.onupgradeneeded === "function") req.onupgradeneeded({ target: req });
        if (aborted) {
          record.version = before.version;
          record.stores = before.stores;
          req.result = undefined;
          req.error = domError("AbortError", "upgrade aborted");
          if (typeof req.onerror === "function") req.onerror({ target: req, preventDefault() {} });
          return;
        }
        factory.dbs.set(name, record);
      }
      if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
    }, 0);
    return req;
  }
}

// ---------------------------------------------------------------------------
// Origin and window
// ---------------------------------------------------------------------------

// What several windows of one site share.
export function createOrigin() {
  return { indexedDB: new FakeIndexedDB(), localStorage: new MemoryStorage(), hub: new ChannelHub(), files: new Map() };
}

class MediaQueryList {
  constructor(win, query) {
    this.win = win;
    this.media = query;
    this.listeners = [];
  }
  get matches() {
    return this.win.evaluateMedia(this.media);
  }
  addEventListener(_type, fn) {
    this.listeners.push(fn);
  }
  removeEventListener(_type, fn) {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }
}

// A window: `opts` = {origin, width, light, languages, href, noIndexedDB,
// noBroadcastChannel, noWasm, persisted}. Returns {window, document,
// context, run(code, filename), setWidth(w), setLight(bool), tick(ms)}.
export function createWindow(opts = {}) {
  const origin = opts.origin || createOrigin();
  const media = [];
  const state = { width: opts.width ?? 390, light: Boolean(opts.light) };
  const win = {};
  const doc = new Document(win);
  const location = {
    _href: opts.href || "https://example.test/Portable-Calculator-Tool/",
    get href() {
      return this._href;
    },
    get hash() {
      const i = this._href.indexOf("#");
      return i < 0 ? "" : this._href.slice(i);
    },
    set hash(h) {
      this.assignHash(String(h).startsWith("#") ? String(h) : "#" + h);
    },
    get search() {
      const base = this._href.replace(/#.*$/, "");
      const i = base.indexOf("?");
      return i < 0 ? "" : base.slice(i);
    },
    get protocol() {
      return this._href.slice(0, this._href.indexOf(":") + 1);
    },
    assignHash(h) {
      const old = this._href;
      this._href = this._href.replace(/#.*$/, "") + h;
      if (old !== this._href) setTimeout(() => win.dispatchEvent(new Event("hashchange")), 0);
    }
  };
  const winNode = new Node(doc, 0);
  const storage = { persistCalls: 0 };
  Object.assign(win, {
    document: doc,
    location,
    history: {
      replaceState(_s, _t, url) {
        location._href = String(url);
      }
    },
    navigator: {
      languages: opts.languages || ["en-US", "en"],
      language: (opts.languages || ["en-US"])[0],
      storage: {
        persist: async () => {
          storage.persistCalls++;
          return opts.persisted !== false;
        },
        persisted: async () => false,
        estimate: async () => ({ usage: 73700, quota: 6900000000 })
      }
    },
    localStorage: origin.localStorage,
    indexedDB: opts.noIndexedDB ? undefined : origin.indexedDB,
    matchMedia: (q) => {
      const m = new MediaQueryList(win, q);
      media.push(m);
      return m;
    },
    evaluateMedia(q) {
      let m;
      if ((m = /\(min-width:\s*(\d+)px\)/.exec(q))) return state.width >= Number(m[1]);
      if ((m = /\(max-width:\s*(\d+)px\)/.exec(q))) return state.width <= Number(m[1]);
      if (/prefers-color-scheme:\s*light/.test(q)) return state.light;
      if (/prefers-color-scheme:\s*dark/.test(q)) return !state.light;
      return false;
    },
    addEventListener: (t, f, o) => winNode.addEventListener(t, f, o),
    removeEventListener: (t, f) => winNode.removeEventListener(t, f),
    dispatchEvent: (e) => winNode.dispatchEvent(e),
    scrollTo() {},
    performance: { now: () => performance.now() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    structuredClone,
    crypto: webcrypto,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    fetch: async (url) => {
      const key = String(url);
      if (!origin.files.has(key)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      const bytes = origin.files.get(key);
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
  });
  win.Event = Event;
  // A settable clock (opts.now = ms): Date.now() and new Date() read it;
  // new Date(y, m, ...) and every other use stay real. Timers stay real.
  const clock = { ms: opts.now === undefined ? null : Number(opts.now) };
  if (clock.ms !== null) {
    const Real = Date;
    win.Date = class FakeDate extends Real {
      constructor(...args) {
        if (args.length === 0) super(clock.ms);
        else super(...args);
      }
      static now() {
        return clock.ms;
      }
    };
  }
  if (!opts.noBroadcastChannel) win.BroadcastChannel = origin.hub.make();
  if (!opts.noWasm) win.WebAssembly = WebAssembly;
  win.window = win;
  win.self = win;
  win.top = win;
  win.globalThis = win;
  const context = vm.createContext(win);
  // A vm context has its own WebAssembly intrinsic; "no WebAssembly" (an
  // old browser, iOS Lockdown Mode) removes it, as browser-boot does by CDP.
  if (opts.noWasm) vm.runInContext("delete globalThis.WebAssembly;", context);
  return {
    window: win,
    document: doc,
    origin,
    storage,
    context,
    run(code, filename) {
      return vm.runInContext(code, context, { filename });
    },
    setWidth(w) {
      const before = media.map((m) => m.matches);
      state.width = w;
      media.forEach((m, i) => {
        if (m.matches !== before[i]) for (const fn of m.listeners) fn({ matches: m.matches, media: m.media });
      });
    },
    // The settable clock (only with opts.now).
    clock: {
      now: () => clock.ms,
      set: (ms) => {
        clock.ms = ms;
      },
      advance: (ms) => {
        clock.ms += ms;
      }
    },
    // Page visibility as a browser reports it (visibilitychange on document).
    setVisibility(state) {
      doc.visibilityState = state;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    setLight(light) {
      const before = media.map((m) => m.matches);
      state.light = light;
      media.forEach((m, i) => {
        if (m.matches !== before[i]) for (const fn of m.listeners) fn({ matches: m.matches, media: m.media });
      });
    }
  };
}

// Resolves after `ms` (lets the fake IndexedDB, hashchange and
// BroadcastChannel tasks run).
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Polls `fn` until it returns a truthy value or `timeoutMs` passes.
export async function until(fn, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await tick(5);
  }
}
