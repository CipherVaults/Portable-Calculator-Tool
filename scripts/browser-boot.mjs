#!/usr/bin/env node
// Browser boot proof (plan B3, B14, M1): drives headless Microsoft Edge over
// the Chrome DevTools Protocol (Node's built-in WebSocket; no npm) with a
// throwaway --user-data-dir profile that is deleted afterwards, and proves
// that the built web app boots under its real CSP:
//
//   served     dist/web over 127.0.0.1 (scripts/lib/static-server.mjs), the
//              multi-file Pages build with script-src 'self' 'wasm-unsafe-eval'
//   single     dist/Portable-Calculator-Tool-Mobile.html over file://, the
//              single file whose inline JS/CSS are pinned by sha256 hashes
//              and whose engine is a <script type="application/octet-stream">
//              data block (plan B3's [A]: script-src does not apply to it)
//
// For both: <html data-boot="ok">, every boot check passed, zero
// securitypolicyviolation events, zero console errors and uncaught
// exceptions, data-engine="wasm" with data-engine-sha256 equal to the
// build's engine hash (the loader reports the hash it verified before
// compiling), no horizontal scroll at a 390 px phone viewport. Positive
// controls then inject an inline script into each booted page (it must be
// blocked and seen by both detectors: violation event and console error)
// and call an HTML sink (Trusted Types must refuse it), so "zero" above
// means something.
//
// Failure paths, each with the read-only rescue view and zero violations:
//   tampered   served, one engine byte flipped: data-boot="integrity" (the
//              SHA-256 check refuses it before compiling)
//   blocked    served, the engine answers 404: data-boot="load-failed"
//   no-wasm    a second Edge whose tabs have no WebAssembly object at all
//              (like iOS Lockdown Mode): the global is deleted by a CDP
//              script that runs before any page script, because Edge 157
//              ignores --js-flags=--noexpose_wasm (checked: typeof
//              WebAssembly stays "object" with it). Both builds show
//              data-boot="unsupported" and never fetch the engine; with a
//              raw value seeded in localStorage the rescue view lists it
//              byte for byte and leaves storage unchanged
//
// The shell (M2a), on the served build in its own throwaway profile:
//   shell      at a 390 px phone: a real tap opens the ☰ drawer as a modal
//              inside the viewport, Tab stays in it, Esc closes it and
//              gives focus back; a drawer link navigates; Alt+5 and Ctrl+H
//              work; the pane is a bottom sheet (full width, at the bottom,
//              within 75% of the height, 44 px close button); while a modal
//              is open the footer is inert and the page does not scroll;
//              opened by a click that does not focus (Safari), closing
//              still returns focus to the toggle; a Settings select keeps
//              focus through the re-render its change causes (ArrowDown).
//              Bottom bar: ☰, the quick switch and the pane button sit at
//              the bottom edge in thumb reach (44 px targets, full width,
//              the top bar holds only the title); a tapped text field hides
//              the bar and nothing covers the field, tapping away shows it
//              again; the quick switch goes back to the previous tool; a
//              phone turned to landscape (390x844 -> 844x390) keeps the
//              open drawer and its focus, Esc returns focus to ☰ in the top
//              bar, and turning back moves the focused ☰ into the bottom
//              bar without losing focus (Chromium blurs a moved element)
//   theme      Settings > Appearance switches data-theme and the --bg
//              colour at once; after a reload the pre-paint script has set
//              the theme before <body> exists and the first frame already
//              has the theme's background (no flash); the last route
//              (Settings) reopens; settings and state are in IndexedDB
//   sync       a second tab follows a theme change through
//              BroadcastChannel("pcalc")
//   layout     at 360, 390 and 440 px (phone emulation): every route
//              family, the open drawer and the open pane, the Daylight and
//              Retro themes, and the en-XA (+35%) and ar-XB (RTL)
//              pseudo-locales: no horizontal scroll, nothing outside the
//              viewport, every visible control at least 44 px tall; in
//              ar-XB the drawer opens from the right. On every phone width
//              the bottom bar is at the bottom edge with 44x44 px buttons
//              and the page's last line (the footer) ends above it. Phone
//              landscape: 740x360 keeps the bottom bar, 844x390 has the
//              tablet layout (buttons in the top bar). At 900 px the pane is
//              an overlay from the inline end; at 1280 px the drawer is
//              pinned and the pane docked (all three themes each); crossing
//              900 -> 1280 px keeps the pane open and focus on its tab.
//              No formatted value (.num) wraps and no word of a title, tab
//              or nav label breaks mid-word; a clamped title is never cut.
//              With --shots <dir> each case is saved as a PNG screenshot
//   date       the Date tool at 390 px (and 360, 440, 1280): every card
//              filled and looked at, a real tap on Business Days calendar
//              days (start, then end), arrow keys with one tab stop, the
//              Move menu from a tap, a real mouse drag of a card, every
//              card collapsed, the layout and the countdown restored after
//              a reload, Settings > Reset, the Countdowns pane ticking and
//              its Open (the card scrolled into view, its title focused),
//              two tabs editing the countdown list at once, the Egypt
//              preset (Fri/Sat, Hijri offset), all three themes (the tool
//              hint and placeholders at AA as rendered) and both
//              pseudo-locales (ar-XB: engine English and number fields
//              left-to-right, calendar arrows mirrored once); each case is a layout check (and a
//              screenshot with --shots). --date-only runs just this group
//   percent    the Percentage tool at 390 px (and 360, 440, 1280): real taps
//              and typing on Discount (two text lines, no <br>, no "<"),
//              Enter records history, every card's live result as
//              Percentage Calculator v2.3.0 shows it, a tip preset, the
//              tax mode and a swap by tap, the Move menu, every card
//              collapsed, a reload restoring the layout, Settings > Reset,
//              results spoken once (on Enter, after a typing pause),
//              Arabic-Indic digits typed, all three themes (contrast as
//              rendered) and both pseudo-locales (ar-XB: "-200" and
//              "175.00% decrease" keep their order); each case is a
//              layout check (and a screenshot with --shots).
//              --percent-only runs just this group
//   history    the History panel (plan B10, M3) at 390 px with 2,200
//              entries (2,000 unpinned + 200 pinned) seeded into IndexedDB:
//              the panel's render, a search keystroke and Show more timed
//              in the page under 4x CPU throttling (a phone), each within
//              its stated budget (HISTORY_BUDGET_MS); layout at 360, 390 and
//              440 px (pane open on History, a note being edited, Clear all
//              asked, ar-XB, an import preview, both tools with their ±
//              keys); Export JSON and CSV as real downloads (a file named
//              Portable-Calculator-<yyyymmdd-hhmmss>.json lands in the
//              download folder holding the export); "Copy export to
//              clipboard" read back from the clipboard; Import through the
//              file input (DevTools sets the file): "N new · M duplicates ·
//              K rejected", then one write; Restore by a real tap; a second
//              tab follows a recorded entry over BroadcastChannel; the ± key
//              by a real tap keeps the field's focus and is a 44 px target.
//              --history-only runs just this group
//   upgrade    build N+1 (a copy of web/ with one changed byte, built into
//              target/browser-boot/) on the same origin as build N: boot N
//              and let its service worker take over, switch the server to
//              N+1 and reload online (boots N+1 with only N+1 assets, the
//              worker updates and deletes N's cache), then stop the server
//              and reload offline (boots N+1 from the cache, the same
//              assets): no mixed assets at any step. Before that, a stale
//              index.html (build N's, as a CDN edge may still serve) next to
//              N+1's sw.js must fail the install and leave N's cache and
//              boot intact. A theme and route saved in N survive into N+1
//              byte for byte, with no backup written, and a second N tab
//              left open across the activation stays usable
//
// Timing: each good build is booted --runs times (default 5) in fresh tabs;
// data-boot-ms (navigation start to verdict, measured in the page) is
// reported as first / median / max.
//
//   node scripts/browser-boot.mjs [--dist <dir>] [--edge <path>] [--runs N]
//                                 [--json <path>] [--shots <dir>] [--skip-upgrade]
//                                 [--date-only] [--percent-only] [--history-only]
//
// Edge: --edge, else $PCALC_EDGE, else the usual install paths. WebKit
// (Safari/iOS) and Gecko (Firefox) are not driven here; they stay manual
// checks on real devices (plan B15 "Manual"). WebView2 is the desktop smoke
// test (cargo run -p portable-calculator-tool -- --smoke-test).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startStaticServer } from "./lib/static-server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SINGLE_NAME = "Portable-Calculator-Tool-Mobile.html";
const BOOT_TIMEOUT_MS = 20000;
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const RAW_STORED = '{"schemaVersion":1,"entries":[{"id":"r-1","expr":"2+2","note":"\\u00e9 \\"raw\\""}]}\n  trailing text kept';

function fail(msg) {
  console.error(`browser-boot: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dist: join(ROOT, "dist"), edge: process.env.PCALC_EDGE || null, runs: 5, json: null, shots: null, upgrade: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") opts.dist = resolve(argv[++i] || fail("--dist needs a path"));
    else if (a === "--shots") opts.shots = resolve(argv[++i] || fail("--shots needs a path"));
    else if (a === "--skip-upgrade") opts.upgrade = false;
    else if (a === "--date-only") opts.dateOnly = true;
    else if (a === "--percent-only") opts.percentOnly = true;
    else if (a === "--history-only") opts.historyOnly = true;
    else if (a === "--edge") opts.edge = resolve(argv[++i] || fail("--edge needs a path"));
    else if (a === "--json") opts.json = resolve(argv[++i] || fail("--json needs a path"));
    else if (a === "--runs") {
      opts.runs = Number(argv[++i]);
      if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 50) fail("--runs needs 1..50");
    } else fail(`unknown argument ${a}`);
  }
  return opts;
}

function findEdge(explicit) {
  const env = process.env;
  const candidates = explicit
    ? [explicit]
    : [
        env["PROGRAMFILES(X86)"] && join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
        env.PROGRAMFILES && join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
        env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/opt/microsoft/msedge/msedge",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) fail(`Microsoft Edge not found (tried ${candidates.join(", ")}); pass --edge <path>`);
  return found;
}

// ---------------------------------------------------------------------------
// Edge + CDP
// ---------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolveCall, rejectCall, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rejectCall(new Error(`${method}: ${msg.error.message}`));
        else resolveCall(msg.result);
      } else if (msg.method) {
        for (const listener of this.listeners) listener(msg);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolveCall, rejectCall) => {
      this.pending.set(id, { resolveCall, rejectCall, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

async function launchEdge(edgePath, extraArgs, { noWasm = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "pcalc-boot-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--mute-audio",
    ...extraArgs,
    "about:blank"
  ];
  const proc = spawn(edgePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
    let text = "";
    const timer = setTimeout(() => rejectUrl(new Error(`Edge did not start within 30 s:\n${text.slice(-800)}`)), 30000);
    proc.stderr.on("data", (d) => {
      text += d.toString("utf8");
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) {
        clearTimeout(timer);
        resolveUrl(m[1]);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`Edge exited (${code}) before DevTools was ready:\n${text.slice(-800)}`));
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket failed")), { once: true });
  });
  const cdp = new Cdp(ws);
  const version = await cdp.send("Browser.getVersion");
  async function close() {
    try {
      await Promise.race([cdp.send("Browser.close"), new Promise((r) => setTimeout(r, 3000))]);
    } catch (_) {
      // already gone
    }
    if (proc.exitCode === null) {
      await new Promise((r) => {
        const timer = setTimeout(() => {
          proc.kill();
          r();
        }, 5000);
        proc.once("exit", () => {
          clearTimeout(timer);
          r();
        });
      });
    }
    try {
      ws.close();
    } catch (_) {
      // closed
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  return { cdp, version, close, profile, noWasm };
}

// Runs in the page before any page script (CDP injection is not subject to
// the page CSP): records every securitypolicyviolation event.
const PROBE = `(() => {
  const violations = [];
  Object.defineProperty(window, "__pcalcBootProbe", { value: { violations }, enumerable: false });
  document.addEventListener("securitypolicyviolation", (e) => {
    violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: e.sample, line: e.lineNumber });
  }, true);
})();`;

// The no-WASM browser: no WebAssembly global before the page runs.
const NO_WASM = `(() => { delete globalThis.WebAssembly; })();`;

// What the page looks like once it has a verdict.
const STATE = `JSON.stringify((() => {
  const root = document.documentElement;
  const rescue = document.getElementById("rescue");
  return {
    boot: root.dataset.boot || null,
    bootError: root.dataset.bootError || null,
    engine: root.dataset.engine || null,
    engineSha256: root.dataset.engineSha256 || null,
    bootMs: Number(root.dataset.bootMs),
    bootChecks: root.dataset.bootChecks || null,
    store: root.dataset.store || null,
    assets: root.dataset.assets || null,
    route: root.dataset.route || null,
    rescue: rescue ? { state: rescue.dataset.state, keys: [...rescue.querySelectorAll(".rescue-key")].map((n) => n.textContent),
      values: [...rescue.querySelectorAll(".rescue-value")].map((n) => n.textContent), buttons: rescue.querySelectorAll("button").length } : null,
    title: (document.querySelector("h1") || {}).textContent || "",
    violations: window.__pcalcBootProbe ? window.__pcalcBootProbe.violations : null,
    scrollWidth: root.scrollWidth,
    innerWidth: window.innerWidth,
    hasWasm: typeof WebAssembly !== "undefined"
  };
})())`;

const STORAGE_SNAPSHOT = `JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))`;

async function evaluate(cdp, sessionId, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
  return r.result.value;
}

// Opens a tab, navigates, waits for data-boot, returns {state, logs, tab}.
async function openPage(edge, url, { keepOpen = false, preScripts = [] } = {}) {
  const noWasm = edge.noWasm === true;
  const { cdp } = edge;
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const logs = { consoleErrors: [], exceptions: [], logErrors: [] };
  const off = cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    const p = msg.params;
    if (msg.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) {
      logs.consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? "").join(" "));
    } else if (msg.method === "Runtime.exceptionThrown") {
      logs.exceptions.push(p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text);
    } else if (msg.method === "Log.entryAdded" && p.entry.level === "error") {
      logs.logErrors.push({ source: p.entry.source, text: p.entry.text, url: p.entry.url || "" });
    }
  });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Log.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", PHONE, sessionId);
  if (noWasm) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: NO_WASM }, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE }, sessionId);
  for (const source of preScripts) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source }, sessionId);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  const tab = {
    sessionId,
    logs,
    async viewport(width, height = 800, mobile = width < 760) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile }, sessionId);
      await new Promise((r) => setTimeout(r, 120));
    },
    // A key press as the browser delivers it (keydown + keyup).
    async key(key, { alt = false, ctrl = false, shift = false } = {}) {
      const KEYS = { Tab: [9, "Tab"], Enter: [13, "Enter"], Escape: [27, "Escape"], ArrowRight: [39, "ArrowRight"], ArrowLeft: [37, "ArrowLeft"], ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"] };
      const [vk, code] = KEYS[key] || (/^\d$/.test(key) ? [48 + Number(key), "Digit" + key] : [key.toUpperCase().charCodeAt(0), "Key" + key.toUpperCase()]);
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, sessionId);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
      await new Promise((r) => setTimeout(r, 30));
    },
    // Text typed into the focused field (as a keyboard or IME inserts it).
    async type(text) {
      await cdp.send("Input.insertText", { text }, sessionId);
      await new Promise((r) => setTimeout(r, 30));
    },
    // A real tap (mouse press and release) at the centre of `selector`.
    async tap(selector) {
      const box = await evaluate(cdp, sessionId, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!box) throw new Error(`tap: no element ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
      }
      await new Promise((r) => setTimeout(r, 60));
    },
    // A mouse event at (x, y) (pressed and moved carry the left button).
    async mouse(type, x, y) {
      await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1 }, sessionId);
      await new Promise((r) => setTimeout(r, 16));
    },
    async screenshot(path) {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(data, "base64"));
    },
    async navigate(target) {
      const started = performance.now();
      await cdp.send("Page.navigate", { url: target }, sessionId);
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      for (;;) {
        let boot = null;
        try {
          boot = await evaluate(cdp, sessionId, "document.documentElement && document.documentElement.dataset.boot || null");
        } catch (_) {
          boot = null; // navigation in progress
        }
        if (boot && boot !== "checking") break;
        if (Date.now() > deadline) throw new Error(`no data-boot verdict within ${BOOT_TIMEOUT_MS} ms at ${target}: ${describeLogs(logs)}`);
        await new Promise((r) => setTimeout(r, 25));
      }
      const wallMs = performance.now() - started;
      // Let late events (a violation reported after the verdict) arrive.
      await new Promise((r) => setTimeout(r, 150));
      return { ...JSON.parse(await evaluate(cdp, sessionId, STATE)), wallMs };
    },
    evaluate: (expression) => evaluate(cdp, sessionId, expression),
    async close() {
      off();
      await cdp.send("Target.closeTarget", { targetId });
    }
  };
  const state = await tab.navigate(url);
  if (!keepOpen) await tab.close();
  return { state, logs, tab };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const results = [];
function expect(id, ok, detail) {
  results.push({ id, status: ok ? "pass" : "fail", detail });
}

const errorCount = (logs, allow = () => false) =>
  logs.consoleErrors.length + logs.exceptions.length + logs.logErrors.filter((e) => !allow(e)).length;
const describeLogs = (logs) =>
  JSON.stringify({ console: logs.consoleErrors.slice(0, 3), exceptions: logs.exceptions.slice(0, 3), log: logs.logErrors.slice(0, 3) });

function expectGoodBoot(name, state, logs, engineSha) {
  expect(`${name}.boot-ok`, state.boot === "ok", `data-boot=${state.boot} error=${state.bootError}`);
  expect(`${name}.checks`, state.bootChecks === "5/5", `data-boot-checks=${state.bootChecks}`);
  expect(`${name}.store-and-assets`, (state.store === "indexeddb" || (name === "single" && state.store === "memory")) && state.assets === "consistent", `data-store=${state.store} data-assets=${state.assets}`);
  expect(`${name}.shell-on-default-route`, state.route === "standard" && state.title === "Standard", `route=${state.route} h1=${state.title}`);
  expect(`${name}.no-csp-violations`, Array.isArray(state.violations) && state.violations.length === 0, JSON.stringify(state.violations));
  expect(`${name}.no-console-errors`, errorCount(logs) === 0, describeLogs(logs));
  expect(`${name}.engine-sha256-verified`, state.engine === "wasm" && state.engineSha256 === engineSha, `engine=${state.engine} sha256=${state.engineSha256}`);
  expect(`${name}.phone-no-horizontal-scroll`, state.scrollWidth <= state.innerWidth, `scrollWidth ${state.scrollWidth}, viewport ${state.innerWidth}`);
}

// The positive controls, so that "zero violations" means something:
//   - an injected inline script must not run and must be seen by both
//     detectors (violation event and console error). Under Trusted Types
//     writing the script's text is itself refused, so the text goes in as a
//     text node, and Trusted Types (require-trusted-types-for) blocks it;
//   - a dynamic import of a data: URL (not a Trusted Types sink) must be
//     refused by script-src itself, and be seen the same two ways;
//   - an HTML sink (DOMParser) must throw and be reported as a Trusted
//     Types violation.
const CSP_LOG = /Content Security Policy|Trusted ?(Types?|Script|HTML)/i;
async function expectControl(name, edge, url) {
  const { tab } = await openPage(edge, url, { keepOpen: true });
  const violations = async () => JSON.parse(await tab.evaluate(STATE)).violations || [];
  const logged = () => tab.logs.logErrors.filter((e) => CSP_LOG.test(e.text)).length + tab.logs.consoleErrors.filter((t) => CSP_LOG.test(t)).length;
  const settle = () => new Promise((r) => setTimeout(r, 300));

  const ran = await tab.evaluate(`(() => {
    const s = document.createElement("script");
    const code = "window.__pcalcInjected = 1";
    try { s.textContent = code; } catch (_) { s.append(document.createTextNode(code)); }
    document.body.append(s);
    return window.__pcalcInjected === 1;
  })()`);
  await settle();
  const v1 = await violations();
  const l1 = logged();
  const seen1 = v1.filter((v) => ["script-src-elem", "script-src", "require-trusted-types-for"].includes(v.directive));
  expect(`${name}.control-inline-script-blocked-and-detected`, ran === false && seen1.length >= 1 && l1 >= 1, `ran=${ran} violations=${JSON.stringify(seen1.map((v) => v.directive))} logged=${l1}`);

  const imported = await tab.evaluate(`import("data:text/javascript,window.__pcalcImported=1").then(() => window.__pcalcImported === 1, () => false)`);
  await settle();
  const v2 = (await violations()).slice(v1.length);
  const l2 = logged() - l1;
  const seen2 = v2.filter((v) => v.directive === "script-src-elem" || v.directive === "script-src");
  expect(`${name}.control-script-src-blocks-a-data-import`, imported === false && seen2.length >= 1 && l2 >= 1, `ran=${imported} violations=${JSON.stringify(v2.map((v) => v.directive))} logged=${l2}`);

  const sink = await tab.evaluate(`(() => { try { new DOMParser().parseFromString("<b>x</b>", "text/html"); return "allowed"; } catch (e) { return e.name; } })()`);
  await settle();
  const v3 = (await violations()).slice(v1.length + v2.length);
  const tt = v3.filter((v) => v.directive === "require-trusted-types-for");
  expect(`${name}.control-html-sink-refused-by-trusted-types`, sink === "TypeError" && tt.length >= 1, `DOMParser -> ${sink}, trusted-types violations ${tt.length}`);
  await tab.close();
}

function expectRescue(name, state, logs, wantBoot, wantError, allow) {
  expect(`${name}.boot-${wantBoot}`, state.boot === wantBoot && state.bootError === wantError, `data-boot=${state.boot} error=${state.bootError}`);
  expect(`${name}.rescue-shown`, state.rescue !== null && state.bootChecks === null, `rescue=${JSON.stringify(state.rescue)} title=${state.title}`);
  expect(`${name}.no-csp-violations`, Array.isArray(state.violations) && state.violations.length === 0, JSON.stringify(state.violations));
  expect(`${name}.no-console-errors`, errorCount(logs, allow) === 0, describeLogs(logs));
  expect(`${name}.phone-no-horizontal-scroll`, state.scrollWidth <= state.innerWidth, `scrollWidth ${state.scrollWidth}, viewport ${state.innerWidth}`);
}

// ---------------------------------------------------------------------------
// The shell (M2a): interaction, theme and pre-paint, sync, layout, upgrade
// ---------------------------------------------------------------------------

// Records the theme when <body> is created (the pre-paint script in <head>
// has run by then) and the page background of the first rendered frame.
const FIRST_PAINT = `(() => {
  const rec = { themeAtBody: null, themeAtFirstFrame: null, bgAtFirstFrame: null };
  Object.defineProperty(window, "__pcalcFirstPaint", { value: rec });
  const obs = new MutationObserver(() => {
    if (document.body && rec.themeAtBody === null) {
      rec.themeAtBody = document.documentElement.getAttribute("data-theme") || "";
      obs.disconnect();
    }
  });
  obs.observe(document, { childList: true, subtree: true });
  requestAnimationFrame(() => {
    rec.themeAtFirstFrame = document.documentElement.getAttribute("data-theme");
    rec.bgAtFirstFrame = getComputedStyle(document.documentElement).backgroundColor;
  });
})();`;

const json = async (tab, expression) => JSON.parse(await tab.evaluate(`(async () => JSON.stringify(await (${expression})))()`));

// Box and modal state of the drawer or the pane.
const BOX = (id) => `(() => {
  const n = document.getElementById(${JSON.stringify(id)});
  const r = n.getBoundingClientRect();
  const a = document.activeElement;
  return { hidden: n.hidden, role: n.getAttribute("role"), left: r.left, right: r.right, top: r.top, bottom: r.bottom,
    width: r.width, height: r.height, vw: document.documentElement.clientWidth, vh: innerHeight, focusInside: n.contains(a), active: a ? a.id || a.getAttribute("data-route") || a.tagName : null,
    viewInert: document.getElementById("view").inert, route: document.documentElement.dataset.route };
})()`;

// The bottom bar and the top bar's visible children; with end = true the
// page is scrolled to its end first (and back after) to see whether the
// footer ends above the bar (getBoundingClientRect lays out at once).
const BAR = (end = false) => `(() => {
  const bar = document.getElementById("bottombar");
  const footer = document.getElementById("appFooter");
  const y = scrollY;
  if (${end}) scrollTo(0, document.documentElement.scrollHeight);
  const r = bar.getBoundingClientRect();
  const f = footer.getBoundingClientRect();
  const buttons = [...bar.querySelectorAll("button")].filter((b) => getComputedStyle(b).display !== "none").map((b) => {
    const q = b.getBoundingClientRect();
    return { id: b.id, w: Math.round(q.width * 10) / 10, h: Math.round(q.height * 10) / 10, top: q.top };
  });
  const out = { shown: getComputedStyle(bar).display !== "none", top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    vw: document.documentElement.clientWidth, vh: innerHeight, buttons, footerBottom: f.bottom,
    topbar: [...document.getElementById("topbar").children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.id) };
  if (${end}) scrollTo(0, y);
  return out;
})()`;

// A phone's bottom bar: at the bottom edge, full width, ☰ and the pane
// button (and the quick switch when shown) at least 44x44 px, the top bar
// holding only the title, and (scrolled to the end) the footer above it.
function phoneBarProblem(b) {
  const ids = b.buttons.map((x) => x.id);
  const bad = [];
  if (!b.shown) bad.push("bar hidden");
  if (Math.abs(b.bottom - b.vh) > 1 || b.left > 0.5 || Math.abs(b.right - b.vw) > 0.5) bad.push(`bar box ${Math.round(b.left)}..${Math.round(b.right)} x ${Math.round(b.top)}..${Math.round(b.bottom)} in ${b.vw}x${b.vh}`);
  if (!ids.includes("drawerToggle") || !ids.includes("paneToggle")) bad.push("buttons " + ids.join(","));
  for (const x of b.buttons) if (x.w < 44 || x.h < 44) bad.push(`${x.id} ${x.w}x${x.h}`);
  if (b.topbar.join() !== "routeTitle") bad.push("top bar " + b.topbar.join(","));
  if (b.footerBottom > b.top + 0.5) bad.push(`footer ends at ${Math.round(b.footerBottom)}, bar starts at ${Math.round(b.top)}`);
  return bad.length ? bad.join("; ") : null;
}

// What a layout check needs: overflow, boxes outside the viewport, small
// targets and clipped text.
const LAYOUT = `(() => {
  const vw = document.documentElement.clientWidth;
  const name = (n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).join(".") : "");
  // Visually hidden text for screen readers (.sr-only) is not laid out for the eye.
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden" && !n.closest(".sr-only"); };
  const out = { vw, vh: innerHeight, scrollWidth: document.documentElement.scrollWidth, outside: [], small: [], clipped: [], broken: [], dir: document.documentElement.dir, theme: document.documentElement.dataset.theme };
  for (const n of document.querySelectorAll("body *")) {
    if (!shown(n)) continue;
    const r = n.getBoundingClientRect();
    if (r.left < -0.5 || r.right > vw + 0.5) out.outside.push(name(n) + " " + Math.round(r.left) + ".." + Math.round(r.right));
    const cs = getComputedStyle(n);
    if ((cs.overflowX === "hidden" || cs.overflowX === "clip") && n.scrollWidth > n.clientWidth + 1) out.clipped.push(name(n));
    // Clamped lines (the top-bar title takes at most two) must all fit.
    if ((cs.overflowY === "hidden" || cs.overflowY === "clip") && n.scrollHeight > n.clientHeight + 1) out.clipped.push(name(n) + " (cut vertically)");
  }
  // The lines a text range lies on (distinct line tops).
  const lines = (range) => new Set([...range.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.top))).size;
  // A formatted value never breaks across lines.
  for (const n of document.querySelectorAll(".num")) {
    if (!shown(n)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    if (lines(range) > 1) out.broken.push(name(n) + " " + JSON.stringify(n.textContent) + " wraps");
  }
  // No word of a title, tab or nav label breaks in the middle.
  for (const n of document.querySelectorAll(".topbar-title, .pane-tab, .nav-link, .drawer-title, .pane-title, .bar-label")) {
    if (!shown(n)) continue;
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      for (const m of t.data.matchAll(/\\S+/g)) {
        const range = document.createRange();
        range.setStart(t, m.index);
        range.setEnd(t, m.index + m[0].length);
        if (lines(range) > 1) out.broken.push(name(n) + " " + JSON.stringify(m[0]) + " breaks mid-word");
      }
    }
  }
  for (const n of document.querySelectorAll("#app button, #app a[href], #app select, #app .choice")) {
    if (!shown(n)) continue;
    const r = n.getBoundingClientRect();
    if (r.height < 43.5) out.small.push(name(n) + " " + r.height.toFixed(1) + "px");
  }
  return out;
})()`;

// One IndexedDB document's raw stored value (read-only; null when absent).
const IDB_GET = (key) => `new Promise((done) => {
  const r = indexedDB.open("pcalc");
  r.onerror = () => done(null);
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("docs")) { db.close(); return done(null); }
    const g = db.transaction("docs").objectStore("docs").get(${JSON.stringify(key)});
    g.onsuccess = () => { db.close(); done(g.result === undefined ? null : g.result); };
    g.onerror = () => { db.close(); done(null); };
  };
})`;

// Every key in the IndexedDB "docs" store (read-only; [] when absent).
const IDB_KEYS = `new Promise((done) => {
  const r = indexedDB.open("pcalc");
  r.onerror = () => done([]);
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("docs")) { db.close(); return done([]); }
    const g = db.transaction("docs").objectStore("docs").getAllKeys();
    g.onsuccess = () => { db.close(); done(g.result.map(String)); };
    g.onerror = () => { db.close(); done([]); };
  };
})`;

async function waitFor(tab, expression, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try {
      v = await tab.evaluate(expression);
    } catch (_) {
      v = null;
    }
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function goRoute(tab, route) {
  await tab.evaluate(`location.hash = "#/${route}"; true`);
  await waitFor(tab, `document.documentElement.dataset.route === ${JSON.stringify(route)}`);
  await new Promise((r) => setTimeout(r, 60));
}

async function pickTheme(tab, pref) {
  await goRoute(tab, "settings");
  await tab.tap(`#theme-${pref}`);
  await waitFor(tab, `document.documentElement.dataset.themePref === ${JSON.stringify(pref)}`);
}

async function pickPseudo(tab, value) {
  await goRoute(tab, "settings");
  await tab.evaluate(`(() => { const s = document.getElementById("pseudoSelect"); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event("change")); return true; })()`);
  await new Promise((r) => setTimeout(r, 120));
}

async function shellChecks(edgePath, url) {
  const edge = await launchEdge(edgePath, []);
  try {
    const { tab, state } = await openPage(edge, url, { keepOpen: true, preScripts: [FIRST_PAINT] });
    await tab.viewport(390, 844);
    expect("shell.boot", state.boot === "ok" && state.route === "standard", `data-boot=${state.boot} route=${state.route}`);

    // Drawer: a real tap, a modal inside the viewport, Tab trapped, Esc.
    await tab.evaluate(`document.getElementById("drawerToggle").focus(); true`);
    await tab.tap("#drawerToggle");
    const open = await json(tab, BOX("drawer"));
    expect("shell.drawer-opens-as-modal", !open.hidden && open.role === "dialog" && open.focusInside && open.viewInert && open.left >= 0 && open.right <= open.vw && open.width <= open.vw * 0.86 + 1, JSON.stringify(open));
    // Behind the modal: the footer is inert too and the page does not scroll.
    const behind = await json(tab, `(() => { const f = document.getElementById("appFooter"); return { footerInert: f.inert, footerHidden: f.getAttribute("aria-hidden"), overflow: getComputedStyle(document.documentElement).overflowY }; })()`);
    expect("shell.modal-locks-footer-and-scroll", behind.footerInert === true && behind.footerHidden === "true" && behind.overflow === "hidden", JSON.stringify(behind));
    let escaped = 0;
    for (let i = 0; i < 25; i++) {
      await tab.key("Tab", { shift: i >= 12 });
      if (!(await json(tab, BOX("drawer"))).focusInside) escaped++;
    }
    expect("shell.drawer-traps-tab", escaped === 0, `focus left the drawer ${escaped} times in 25 presses`);
    await tab.key("Escape");
    const closed = await json(tab, BOX("drawer"));
    expect("shell.drawer-escape-returns-focus", closed.hidden && closed.active === "drawerToggle" && !closed.viewInert, JSON.stringify(closed));
    await tab.tap("#drawerToggle");
    await tab.tap("a[data-route='converter/temperature']");
    await waitFor(tab, `document.documentElement.dataset.route === "converter/temperature"`);
    const nav = await json(tab, `({ hash: location.hash, title: document.getElementById("routeTitle").textContent, drawerHidden: document.getElementById("drawer").hidden })`);
    expect("shell.drawer-link-navigates", nav.hash === "#/converter/temperature" && nav.title === "Temperature" && nav.drawerHidden, JSON.stringify(nav));

    // Shortcuts.
    await tab.key("5", { alt: true });
    await waitFor(tab, `document.documentElement.dataset.route === "date"`);
    await tab.key("2", { alt: true });
    const sc = await waitFor(tab, `document.documentElement.dataset.route === "scientific" && document.getElementById("routeTitle").textContent`);
    expect("shell.alt-digit-shortcuts", sc === "Scientific", `Alt+5 then Alt+2 -> ${sc}`);

    // The pane is a bottom sheet on a phone.
    await tab.key("h", { ctrl: true });
    const pane = await json(tab, BOX("pane"));
    const close = await json(tab, `(() => { const r = document.getElementById("paneClose").getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top }; })()`);
    expect(
      "shell.pane-bottom-sheet",
      !pane.hidden && pane.role === "dialog" && Math.abs(pane.bottom - pane.vh) <= 1 && pane.left <= 0.5 && Math.abs(pane.right - pane.vw) <= 0.5 && pane.top >= pane.vh * 0.25 - 1 && pane.focusInside && close.w >= 44 && close.h >= 44,
      JSON.stringify({ pane, close })
    );
    await tab.key("Escape");
    const paneClosed = await json(tab, BOX("pane"));
    expect("shell.pane-escape-closes", paneClosed.hidden && !paneClosed.focusInside && !paneClosed.viewInert, JSON.stringify(paneClosed));

    // Safari does not focus a button on tap or click: open with a click
    // that leaves focus on <body>; closing must still return to the toggle.
    const openers = [];
    for (const [toggle, close] of [["drawerToggle", "Escape"], ["drawerToggle", "drawerClose"], ["paneToggle", "Escape"], ["paneToggle", "paneClose"]]) {
      await tab.evaluate(`(() => { if (document.activeElement) document.activeElement.blur(); document.getElementById(${JSON.stringify(toggle)}).click(); return true; })()`);
      await new Promise((r) => setTimeout(r, 60));
      if (close === "Escape") await tab.key("Escape");
      else await tab.evaluate(`document.getElementById(${JSON.stringify(close)}).click(); true`);
      await new Promise((r) => setTimeout(r, 60));
      const at = await tab.evaluate(`(document.activeElement && document.activeElement.id) || (document.activeElement ? document.activeElement.tagName : null)`);
      openers.push({ toggle, close, at });
    }
    expect("shell.focus-returns-without-a-focusing-tap", openers.every((o) => o.at === o.toggle), openers.map((o) => `${o.toggle}/${o.close} -> ${o.at}`).join(", "));

    // The bottom bar: in thumb reach, 44 px targets, top bar = title only.
    const bar = await json(tab, BAR(true));
    const reach = bar.buttons.every((x) => x.top >= bar.vh * 0.8);
    const barProblem = phoneBarProblem(bar);
    expect("shell.bottom-bar-in-thumb-reach", !barProblem && reach, barProblem || JSON.stringify(bar));

    // A text field (the calculators' fields arrive later; one is added
    // here) hides the bar while it has focus; tapping away shows it again.
    await tab.evaluate(`(() => { const i = document.createElement("input"); i.type = "text"; i.id = "bootTyping"; i.className = "select"; document.getElementById("viewBody").append(i); return true; })()`);
    await tab.tap("#bootTyping");
    const typing = await json(tab, `(() => { const i = document.getElementById("bootTyping"); const r = i.getBoundingClientRect();
      return { focused: document.activeElement === i, barShown: getComputedStyle(document.getElementById("bottombar")).display !== "none", onTop: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === i }; })()`);
    await tab.tap("#routeTitle");
    const away = await json(tab, `({ barShown: getComputedStyle(document.getElementById("bottombar")).display !== "none", active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) })`);
    await tab.evaluate(`document.getElementById("bootTyping").remove(); true`);
    expect("shell.bottom-bar-steps-aside-while-typing", typing.focused && !typing.barShown && typing.onTop && away.barShown && away.active !== "bootTyping", JSON.stringify({ typing, away }));

    // The quick switch goes back to the previous tool.
    const before = await tab.evaluate(`document.documentElement.dataset.route`);
    await goRoute(tab, "percent");
    const label = await tab.evaluate(`document.getElementById("quickSwitch").textContent`);
    await tab.tap("#quickSwitch");
    const switched = await waitFor(tab, `document.documentElement.dataset.route === ${JSON.stringify(before)} && document.getElementById("quickSwitch").getAttribute("aria-label")`);
    expect("shell.quick-switch-goes-back", switched === "Back to Percentage" && label.includes(await tab.evaluate(`document.getElementById("routeTitle").textContent`)), `from percent back to ${before}: label "${label}", now "${switched}"`);

    // A phone turned to landscape with the drawer open, then back.
    await tab.tap("#drawerToggle");
    await tab.viewport(844, 390, true);
    const turned = await json(tab, BOX("drawer"));
    await tab.key("Escape");
    const esc = await json(tab, `(() => { const a = document.activeElement; return { active: a && a.id, inTop: document.getElementById("topbar").contains(a), barShown: getComputedStyle(document.getElementById("bottombar")).display !== "none" }; })()`);
    await tab.viewport(390, 844, true);
    const back = await json(tab, `(() => { const a = document.activeElement; return { active: a && a.id, inBar: document.getElementById("bottombar").contains(a) }; })()`);
    expect(
      "shell.turning-the-phone-keeps-drawer-and-focus",
      !turned.hidden && turned.role === "dialog" && turned.focusInside && esc.active === "drawerToggle" && esc.inTop && !esc.barShown && back.active === "drawerToggle" && back.inBar,
      JSON.stringify({ turned, esc, back })
    );

    // A Settings select that re-labels the app keeps focus: ArrowDown on a
    // closed select changes it on every press (Windows), so a keyboard user
    // must be able to press twice.
    await goRoute(tab, "settings");
    const scrollBefore = await tab.evaluate(`(() => { document.getElementById("digitsSelect").focus(); return scrollY; })()`);
    await tab.key("ArrowDown");
    await new Promise((r) => setTimeout(r, 150));
    await tab.key("ArrowDown");
    await new Promise((r) => setTimeout(r, 150));
    const digits = await json(tab, `({ value: document.getElementById("digitsSelect").value, active: document.activeElement && document.activeElement.id, scrollY })`);
    await tab.evaluate(`document.getElementById("pseudoSelect").focus(); true`);
    await tab.key("ArrowDown");
    await new Promise((r) => setTimeout(r, 150));
    const pseudo = await json(tab, `({ value: document.getElementById("pseudoSelect").value, active: document.activeElement && document.activeElement.id, lang: document.documentElement.lang })`);
    expect(
      "shell.settings-select-keeps-focus",
      digits.value === "arabic-indic" && digits.active === "digitsSelect" && pseudo.value !== "off" && pseudo.active === "pseudoSelect",
      JSON.stringify({ scrollBefore, digits, pseudo })
    );
    await pickPseudo(tab, "off");
    await tab.evaluate(`(() => { const s = document.getElementById("digitsSelect"); s.value = "western"; s.dispatchEvent(new Event("change")); return true; })()`);
    await new Promise((r) => setTimeout(r, 120));
    await goRoute(tab, "standard");

    // Theme: instant switch, saved, pre-painted on the next load.
    await pickTheme(tab, "retro");
    const now = await json(tab, `({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.documentElement).backgroundColor, token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(), mirror: localStorage.getItem("pcalc.theme") })`);
    expect("theme.switch-is-instant", now.theme === "retro" && now.bg === "rgb(0, 128, 128)" && now.token.toUpperCase() === "#008080" && now.mirror === "retro", JSON.stringify(now));
    const stored = await waitFor(tab, `${IDB_GET("settings")}.then((v) => v && v.includes('"theme":"retro"') ? v : null)`);
    expect("theme.saved-in-indexeddb", Boolean(stored), String(stored).slice(0, 80));
    const reloaded = await tab.navigate(url);
    const fp = await json(tab, "window.__pcalcFirstPaint");
    expect("theme.prepainted-no-flash", fp.themeAtBody === "retro" && fp.themeAtFirstFrame === "retro" && fp.bgAtFirstFrame === "rgb(0, 128, 128)", JSON.stringify(fp));
    expect("shell.last-route-restored", reloaded.boot === "ok" && reloaded.route === "settings" && reloaded.title === "Settings", `route=${reloaded.route} title=${reloaded.title}`);
    const docs = await json(tab, `Promise.all(["settings", "state"].map((k) => ${IDB_GET("k").replace('"k"', "k")}))`);
    expect("store.indexeddb-holds-settings-and-state", docs.every((d) => typeof d === "string" && d.startsWith('{"schemaVersion":1')), docs.map((d) => String(d).slice(0, 40)).join(" | "));

    // Sync: a second tab follows the theme through BroadcastChannel.
    const second = await openPage(edge, url, { keepOpen: true });
    await pickTheme(tab, "daylight");
    const follows = await waitFor(second.tab, `document.documentElement.dataset.theme === "daylight"`, 3000);
    expect("sync.second-tab-follows-theme", follows === true, `second tab theme ${await second.tab.evaluate("document.documentElement.dataset.theme")}`);
    await second.tab.close();
    await pickTheme(tab, "system");
    expect("shell.no-console-errors", errorCount(tab.logs) === 0, describeLogs(tab.logs));
    await tab.close();
  } finally {
    await edge.close();
  }
}

async function layoutChecks(edgePath, url, shots) {
  const edge = await launchEdge(edgePath, []);
  const saved = [];
  try {
    const { tab } = await openPage(edge, url, { keepOpen: true });
    const record = async (id, extra = () => null) => {
      const l = await json(tab, LAYOUT);
      const more = await extra(l);
      const ok = l.scrollWidth <= l.vw && l.outside.length === 0 && l.small.length === 0 && l.clipped.length === 0 && l.broken.length === 0 && !more;
      expect(`layout.${id}`, ok, JSON.stringify({ scrollWidth: l.scrollWidth, vw: l.vw, outside: l.outside.slice(0, 4), small: l.small.slice(0, 4), clipped: l.clipped.slice(0, 4), broken: l.broken.slice(0, 4), more }));
      if (shots) {
        const path = join(shots, `${id.replace(/[^a-z0-9-]+/gi, "_")}.png`);
        await tab.screenshot(path);
        saved.push(path);
      }
    };
    const openDrawer = async () => {
      await tab.evaluate(`document.getElementById("drawerToggle").focus(); true`);
      await tab.tap("#drawerToggle");
    };
    const phoneBar = async () => phoneBarProblem(await json(tab, BAR(true)));
    const topBarOnly = async () => {
      const b = await json(tab, BAR());
      return !b.shown && b.topbar.join() === "drawerToggle,routeTitle,paneToggle" ? null : JSON.stringify(b);
    };
    // The selected pane tab is bold and wider: select the longest label
    // (Countdowns) once, so every pane case below shows the worst case.
    await tab.viewport(360, 800);
    await goRoute(tab, "date");
    await tab.key("h", { ctrl: true });
    await tab.tap("#paneTab-countdowns");
    await tab.key("Escape");
    for (const width of [360, 390, 440]) {
      await tab.viewport(width, 800);
      for (const route of ["standard", "date", "settings", "about", "converter/temperature"]) {
        await goRoute(tab, route);
        await record(`${width}.${route.replace("/", "-")}`, phoneBar);
      }
      await goRoute(tab, "standard");
      await openDrawer();
      await record(`${width}.drawer-open`);
      await tab.key("Escape");
      await goRoute(tab, "date");
      await tab.key("h", { ctrl: true });
      await record(`${width}.pane-open`);
      await tab.key("Escape");
      for (const theme of ["daylight", "retro"]) {
        await pickTheme(tab, theme);
        await record(`${width}.settings-${theme}`, phoneBar);
        await openDrawer();
        await record(`${width}.drawer-${theme}`);
        await tab.key("Escape");
      }
      await pickTheme(tab, "terminal");
      await pickPseudo(tab, "en-XA");
      await record(`${width}.en-XA-settings`);
      await goRoute(tab, "about");
      await record(`${width}.en-XA-about`);
      // The longest titles (two lines in the top bar, never cut).
      for (const route of ["converter/mass", "mini"]) {
        await goRoute(tab, route);
        await record(`${width}.en-XA-${route.replace("/", "-")}`, phoneBar);
      }
      // The longest quick-switch label (en-XA "Weight and mass"), two lines.
      await goRoute(tab, "converter/mass");
      await goRoute(tab, "standard");
      await record(`${width}.en-XA-quick-switch`, phoneBar);
      await openDrawer();
      await record(`${width}.en-XA-drawer`);
      await tab.key("Escape");
      await goRoute(tab, "date");
      await tab.key("h", { ctrl: true });
      await record(`${width}.en-XA-pane-open`);
      await tab.key("Escape");
      await pickPseudo(tab, "ar-XB");
      await record(`${width}.ar-XB-settings`, async (l) => (l.dir === "rtl" ? phoneBar() : `dir ${l.dir}`));
      await openDrawer();
      await record(`${width}.ar-XB-drawer`, async () => {
        const d = await json(tab, BOX("drawer"));
        return Math.abs(d.right - d.vw) <= 0.5 && d.left > 0 ? null : `drawer not at the right edge: ${Math.round(d.left)}..${Math.round(d.right)}`;
      });
      await tab.key("Escape");
      await goRoute(tab, "date");
      await tab.key("h", { ctrl: true });
      await record(`${width}.ar-XB-pane-open`);
      await tab.key("Escape");
      await pickPseudo(tab, "off");
    }
    // Phone landscape: 740x360 (a small phone) keeps the bottom bar,
    // 844x390 (iPhone 13/14) has the tablet layout with the buttons in the
    // top bar; the drawer and the pane open from there.
    for (const [w, h, bottom] of [[740, 360, true], [844, 390, false]]) {
      await tab.viewport(w, h, true);
      const barCheck = bottom ? phoneBar : topBarOnly;
      for (const route of ["standard", "settings"]) {
        await goRoute(tab, route);
        await record(`landscape-${w}x${h}.${route}`, barCheck);
      }
      await openDrawer();
      await record(`landscape-${w}x${h}.drawer-open`, async () => {
        const d = await json(tab, BOX("drawer"));
        return !d.hidden && d.role === "dialog" && d.focusInside ? null : JSON.stringify(d);
      });
      await tab.key("Escape");
      await goRoute(tab, "date");
      await tab.key("h", { ctrl: true });
      await record(`landscape-${w}x${h}.pane-open`, async () => {
        const p = await json(tab, BOX("pane"));
        const sheet = Math.abs(p.bottom - p.vh) <= 1 && p.left <= 0.5;
        const overlay = Math.abs(p.right - p.vw) <= 0.5 && p.top <= 0.5;
        return !p.hidden && p.role === "dialog" && (bottom ? sheet : overlay) ? null : JSON.stringify(p);
      });
      await tab.key("Escape");
    }

    // Overlay pane (760-1100) and the docked layout (>= 1100).
    await tab.viewport(900, 800, false);
    await goRoute(tab, "about");
    await tab.key("h", { ctrl: true });
    await record("900.pane-overlay", async () => {
      const p = await json(tab, BOX("pane"));
      return p.role === "dialog" && Math.abs(p.right - p.vw) <= 0.5 && p.top <= 0.5 && Math.abs(p.bottom - p.vh) <= 1 && p.width <= 320.5 ? null : JSON.stringify(p);
    });
    await tab.key("Escape");
    await record("900.top-bar", topBarOnly);
    await tab.key("h", { ctrl: true });
    await tab.key("Escape");
    // A tablet turned (or a window widened) while the overlay pane has
    // focus: the pane stays open, now docked, and focus moves to its
    // selected tab instead of falling to <body>.
    await tab.key("h", { ctrl: true });
    await tab.viewport(1280, 800, false);
    const crossed = await json(tab, `(() => { const p = document.getElementById("pane"); const a = document.activeElement;
      return { hidden: p.hidden, role: p.getAttribute("role"), active: a ? a.id || a.tagName : null, selected: a ? a.getAttribute("aria-selected") : null, modal: document.documentElement.hasAttribute("data-modal") }; })()`);
    expect("layout.900-to-1280-keeps-pane-and-focus", !crossed.hidden && crossed.role === null && /^paneTab-/.test(crossed.active || "") && crossed.selected === "true" && !crossed.modal, JSON.stringify(crossed));
    await goRoute(tab, "settings");
    const docked = async () => {
      const d = await json(tab, BOX("drawer"));
      const p = await json(tab, BOX("pane"));
      const toggle = await tab.evaluate(`document.getElementById("drawerToggle").hidden`);
      return !d.hidden && d.role === null && !p.hidden && p.role === null && toggle && !p.viewInert ? null : JSON.stringify({ d, p, toggle });
    };
    await record("1280.docked", docked);
    for (const theme of ["daylight", "retro", "terminal"]) {
      await pickTheme(tab, theme);
      await record(`1280.docked-${theme}`, docked);
    }
    await tab.viewport(900, 800, false);
    for (const theme of ["daylight", "retro", "terminal"]) {
      await pickTheme(tab, theme);
      await tab.key("h", { ctrl: true });
      await record(`900.pane-overlay-${theme}`);
      await tab.key("Escape");
    }
    expect("layout.no-console-errors", errorCount(tab.logs) === 0, describeLogs(tab.logs));
    await tab.close();
  } finally {
    await edge.close();
  }
  return saved;
}

// ---------------------------------------------------------------------------
// The Date tool (M2b) in a real browser at phone widths
// ---------------------------------------------------------------------------

// Sets a field's value as typing would (input, then change).
const PUT = (id, value) => `(() => { const n = document.getElementById(${JSON.stringify(id)}); n.value = ${JSON.stringify(value)};
  n.dispatchEvent(new Event("input", { bubbles: true })); n.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
const TEXT = (id) => `(document.getElementById(${JSON.stringify(id)}) || { textContent: null }).textContent`;
// Rendered WCAG contrast of the tool hint above the cards (on the page
// background) and of a field's placeholder (on the field), in this theme.
const CONTRAST = (fieldId) => `(() => {
  const lum = (c) => { const v = c.match(/[\\d.]+/g).map(Number).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a); const y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100; };
  const bgOf = (n) => { for (; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "transparent" && !/rgba\\([^)]*,\\s*0\\)$/.test(c)) return c; } return "rgb(255, 255, 255)"; };
  const hint = document.querySelector(".tool-bar-text");
  const field = document.getElementById(${JSON.stringify(fieldId)});
  return { hint: ratio(getComputedStyle(hint).color, bgOf(hint)), placeholder: ratio(getComputedStyle(field, "::placeholder").color, bgOf(field)) };
})()`;
// Where a substring of a text node sits on screen (its first character's left edge).
const LEFT_OF = (selector, needle, last = false) => `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null;
  const t = n.firstChild; const at = ${last ? "t.textContent.lastIndexOf" : "t.textContent.indexOf"}(${JSON.stringify(needle)}); if (at < 0) return null;
  const r = document.createRange(); r.setStart(t, at); r.setEnd(t, at + 1); return r.getBoundingClientRect().left; })()`;
const ORDER = `[...document.getElementById("dateCards").children].map((c) => c.dataset.card).join(",")`;
const CARDS = ["between", "add", "business", "age", "info", "countdown"];

async function dateChecks(edgePath, url, shots) {
  const edge = await launchEdge(edgePath, []);
  const saved = [];
  try {
    const { tab } = await openPage(edge, url + "#/date", { keepOpen: true });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = async (id) => {
      if (!shots) return;
      const path = join(shots, `date-${id.replace(/[^a-z0-9-]+/gi, "_")}.png`);
      await tab.screenshot(path);
      saved.push(path);
    };
    const record = async (id, extra = () => null) => {
      const l = await json(tab, LAYOUT);
      const more = await extra(l);
      const ok = l.scrollWidth <= l.vw && l.outside.length === 0 && l.small.length === 0 && l.clipped.length === 0 && l.broken.length === 0 && !more;
      expect(`date.layout.${id}`, ok, JSON.stringify({ scrollWidth: l.scrollWidth, vw: l.vw, outside: l.outside.slice(0, 4), small: l.small.slice(0, 4), clipped: l.clipped.slice(0, 4), broken: l.broken.slice(0, 4), more }));
      await shot(id);
    };
    // The element's top just under the sticky top bar.
    const scrollTo = (sel) => tab.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); n.scrollIntoView({ block: "start" });
      scrollBy(0, -(document.getElementById("topbar").getBoundingClientRect().height + 8)); return true; })()`);
    const phoneBar = async () => phoneBarProblem(await json(tab, BAR(true)));

    await tab.viewport(390, 844);
    await goRoute(tab, "date");
    await waitFor(tab, `document.getElementById("infoCalGrid") && document.getElementById("infoCalGrid").children.length === 42`);
    await record("390.top", phoneBar);
    // Fill every card the way a person would, then look at each.
    for (const [id, v] of [["betweenStart", "2024-01-01"], ["betweenEnd", "2024-12-31"], ["addStart", "2024-01-31"], ["addMonths", "1"],
      ["bizStart", "2026-12-21"], ["bizEnd", "2027-01-08"], ["ageBirth", "1990-02-28"], ["infoDate", "2026-12-25"], ["cdLabel", "Launch"], ["cdTarget", "2030-01-01"], ["cdTime", "09:30"]]) {
      await tab.evaluate(PUT(id, v));
    }
    await waitFor(tab, `${TEXT("countdownLive")} !== "→ —" && ${TEXT("businessLive")} !== "→ —" && ${TEXT("infoLive")} !== "→ —"`, 4000);
    const lives = await json(tab, `["betweenLive", "addLive", "businessLive", "ageLive", "infoLive", "countdownLive"].map((id) => document.getElementById(id).textContent)`);
    expect("date.live-results", lives[0] === "→ 365 days" && lives[1] === "→ 2024-02-29 (Thursday)" && /business days/.test(lives[2]) && /years/.test(lives[3]) && /Friday/.test(lives[4]) && /\d/.test(lives[5]), JSON.stringify(lives));
    await tab.evaluate(`document.activeElement.blur(); true`);
    for (const key of CARDS) {
      await scrollTo(`#card-${key}`);
      await record(`390.${key}`, phoneBar);
    }
    // The business calendar: a real tap sets the start, the next tap the end.
    await scrollTo("#bizCalGrid");
    await tab.evaluate(`document.getElementById("bizPickStart").click(); true`);
    const cell = (iso) => `#bizCalGrid button[data-date="${iso}"]`;
    await tab.tap(cell("2026-12-22"));
    await waitFor(tab, `document.getElementById("bizStart").value === "2026-12-22"`);
    await tab.tap(cell("2026-12-30"));
    await waitFor(tab, `document.getElementById("bizEnd").value === "2026-12-30"`);
    const picks = await json(tab, `({ start: document.getElementById("bizStart").value, end: document.getElementById("bizEnd").value,
      marked: [...document.querySelectorAll("#bizCalGrid .pick-start, #bizCalGrid .pick-end")].map((n) => n.dataset.date + ":" + n.getAttribute("aria-pressed")).join(","),
      hint: document.getElementById("bizCalHint").textContent, cell: (() => { const r = document.querySelector(${JSON.stringify(cell("2026-12-22"))}).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() })`);
    expect("date.calendar-tap-picks", picks.start === "2026-12-22" && picks.end === "2026-12-30" && picks.marked === "2026-12-22:true,2026-12-30:true" && picks.hint === "Next click sets the start date." && picks.cell[1] >= 44 && picks.cell[0] >= 40, JSON.stringify(picks));
    // Arrow keys move focus (one tab stop) without selecting.
    await tab.evaluate(`document.querySelector(${JSON.stringify(cell("2026-12-30"))}).focus(); true`);
    await tab.key("ArrowRight");
    await tab.key("ArrowDown");
    const keys = await json(tab, `({ focus: document.activeElement.dataset.date, stops: document.querySelectorAll("#bizCalGrid [tabindex='0']").length, end: document.getElementById("bizEnd").value })`);
    expect("date.calendar-keyboard", keys.focus === "2027-01-07" && keys.stops === 1 && keys.end === "2026-12-30", JSON.stringify(keys));
    await record("390.business-picked", phoneBar);

    // The Move menu: a tap on a handle opens Move up / Move down / Done.
    await scrollTo("#card-age");
    await tab.tap("#card-age .card-handle");
    const menu = await json(tab, `(() => { const m = document.getElementById("cardMoveMenu"); const b = [...m.querySelectorAll("button")].map((x) => Math.round(x.getBoundingClientRect().height));
      return { open: !m.hidden, inAge: document.getElementById("card-age").contains(m), heights: b, focus: document.activeElement.dataset.value }; })()`);
    expect("date.move-menu-tap", menu.open && menu.inAge && menu.heights.every((h) => h >= 44) && menu.focus === "up", JSON.stringify(menu));
    await record("390.move-menu", phoneBar);
    await tab.tap("#cardMoveMenu button[data-value=up]");
    const moved = await tab.evaluate(ORDER);
    expect("date.move-menu-moves", moved === "between,add,age,business,info,countdown", moved);
    await tab.tap("#cardMoveMenu button[data-value=done]");
    // A real mouse drag on a handle (pointer events): Countdown to the top.
    for (const key of CARDS) await tab.evaluate(`document.querySelector("#card-${key} .card-collapse").click(); true`);
    await tab.evaluate(`scrollTo(0, 0); true`);
    const drag = await json(tab, `(() => { const r = document.querySelector("#card-countdown .card-handle").getBoundingClientRect(); const t = document.getElementById("card-between").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, to: t.top + 6 }; })()`);
    await tab.mouse("mousePressed", drag.x, drag.y);
    for (let step = 1; step <= 12; step++) await tab.mouse("mouseMoved", drag.x, drag.y + (drag.to - drag.y) * (step / 12));
    await tab.mouse("mouseReleased", drag.x, drag.to);
    await wait(150);
    const dragged = await tab.evaluate(ORDER);
    const leftover = await tab.evaluate(`document.querySelectorAll(".is-dragging, .drop-before, .drop-after").length`);
    expect("date.pointer-drag-reorders", dragged.startsWith("countdown,") && leftover === 0, `${dragged} leftover=${leftover}`);
    await record("390.all-collapsed", phoneBar);
    await wait(200);
    const stored = await json(tab, IDB_GET("settings"));
    const date = stored ? JSON.parse(stored).date : null;
    expect("date.layout-persisted", Boolean(date && date.cardOrder[0] === "countdown" && date.collapsedCards.length === 6), JSON.stringify(date && { order: date.cardOrder, collapsed: date.collapsedCards }));
    // Reload: the order, the collapsed set and the countdown come back.
    await tab.navigate(url + "#/date");
    await waitFor(tab, `document.getElementById("dateCards") && document.getElementById("cdSelect") && document.getElementById("cdTarget").value !== ""`);
    const after = await json(tab, `({ order: ${ORDER}, collapsed: document.querySelectorAll(".tool-card.is-collapsed").length, label: document.getElementById("cdLabel").value, target: document.getElementById("cdTarget").value })`);
    expect("date.reload-restores", after.order.startsWith("countdown,") && after.collapsed === 6 && after.label === "Launch" && after.target === "2030-01-01", JSON.stringify(after));
    // Settings > Layout > Reset.
    await goRoute(tab, "settings");
    await tab.evaluate(`document.getElementById("dateLayoutResetBtn").click(); true`);
    await wait(150);
    await goRoute(tab, "date");
    const reset = await json(tab, `({ order: ${ORDER}, collapsed: document.querySelectorAll(".tool-card.is-collapsed").length })`);
    expect("date.layout-reset", reset.order === CARDS.join() && reset.collapsed === 0, JSON.stringify(reset));

    // The Countdowns pane: the saved countdown, ticking.
    await tab.key("h", { ctrl: true });
    await tab.tap("#paneTab-countdowns");
    await waitFor(tab, `document.querySelector(".cd-row-clock") && /\\d/.test(document.querySelector(".cd-row-clock").textContent)`);
    const c1 = await tab.evaluate(`document.querySelector(".cd-row-clock").textContent`);
    await wait(1300);
    const c2 = await tab.evaluate(`document.querySelector(".cd-row-clock").textContent`);
    const chip = await tab.evaluate(`document.querySelector(".cd-row .cd-phase").textContent`);
    expect("date.pane-countdowns-tick", c1 !== c2 && /restored|counting down/.test(chip), `${c1} -> ${c2} chip=${chip}`);
    await record("390.pane-countdowns");
    // Open: the sheet closes and the Countdown card (the last of six, about
    // five screens down) is scrolled under the top bar with its title focused.
    await tab.tap(".cd-row .button-row button");
    await waitFor(tab, `document.activeElement && document.activeElement.id === "card-countdown-title"`, 2000);
    await wait(150);
    const opened = await json(tab, `(() => { const r = document.getElementById("card-countdown").getBoundingClientRect(); const bar = document.getElementById("topbar").getBoundingClientRect();
      return { focus: document.activeElement.id, top: Math.round(r.top), barBottom: Math.round(bar.bottom), vh: innerHeight, paneHidden: document.getElementById("pane").hidden, y: Math.round(scrollY),
        label: document.getElementById("cdLabel").value }; })()`);
    expect("date.pane-open-shows-card", opened.focus === "card-countdown-title" && opened.paneHidden && opened.top >= opened.barBottom - 1 && opened.top < opened.vh / 2 && opened.y > 0 && opened.label === "Launch", JSON.stringify(opened));
    await record("390.after-open", phoneBar);

    // Two tabs: A has focus in its label while B adds a countdown; A's next
    // label commit must not drop B's countdown, and B's list follows A.
    {
      const { tab: other } = await openPage(edge, url + "#/date", { keepOpen: true });
      await other.viewport(390, 844);
      await waitFor(other, `document.getElementById("cdSelect") && document.getElementById("cdSelect").children.length >= 2`);
      await tab.evaluate(`document.getElementById("cdLabel").focus(); true`);
      await other.evaluate(`document.getElementById("countdownClearBtn").click(); true`);
      await other.evaluate(PUT("cdLabel", "FromTabB"));
      await other.evaluate(PUT("cdTarget", "2031-02-02"));
      const seen = await waitFor(tab, `window.PCalc.countdowns.list().some((x) => x.label === "FromTabB")`, 3000);
      await tab.evaluate(PUT("cdLabel", "Launch!"));
      const both = await waitFor(tab, `(async () => { const d = JSON.parse(await (${IDB_GET("countdowns")})); const l = d.items.map((x) => x.label); return l.includes("Launch!") && l.includes("FromTabB"); })()`, 3000);
      const followed = await waitFor(other, `window.PCalc.countdowns.list().some((x) => x.label === "Launch!")`, 3000);
      const stored = await json(tab, `(async () => JSON.parse(await (${IDB_GET("countdowns")})).items.map((x) => x.label).sort().join(","))()`);
      const kept = await tab.evaluate(`document.activeElement.id + ":" + document.getElementById("cdLabel").value`);
      expect("date.two-tabs-keep-both-countdowns", Boolean(seen) && Boolean(both) && Boolean(followed) && kept === "cdLabel:Launch!", JSON.stringify({ seen, both, followed, stored, kept }));
      expect("date.two-tabs-no-console-errors", errorCount(other.logs) === 0, describeLogs(other.logs));
      await other.close();
    }
    await tab.evaluate(`document.activeElement.blur(); true`);

    // Settings: the Date sections, Egypt (Fri/Sat and the Hijri offset).
    await goRoute(tab, "settings");
    await tab.evaluate(`(() => { const s = document.getElementById("holidayPresetSelect"); s.value = "eg"; s.dispatchEvent(new Event("change")); return true; })()`);
    await waitFor(tab, `!document.getElementById("hijriBlock").hidden && document.querySelectorAll("#holidayPreviewList .holiday-row").length > 5`, 4000);
    const eg = await json(tab, `(async () => JSON.parse(await (${IDB_GET("settings")})).date.calendar.weekend.join(","))()`);
    expect("date.settings-egypt-weekend", eg === "5,6", eg);
    await scrollTo("#settingsDateWeekend");
    await record("390.settings-weekend", phoneBar);
    await scrollTo("#settingsDateHolidays");
    await record("390.settings-holidays", phoneBar);
    await scrollTo("#settingsDateCustom");
    await record("390.settings-custom", phoneBar);
    await tab.evaluate(`(() => { const s = document.getElementById("holidayPresetSelect"); s.value = "none"; s.dispatchEvent(new Event("change")); return true; })()`);
    await wait(300);

    // 360 and 440 px, the other themes and the pseudo-locales.
    for (const width of [360, 440]) {
      await tab.viewport(width, 800);
      await goRoute(tab, "date");
      await scrollTo("#card-business");
      await record(`${width}.business`, phoneBar);
      await scrollTo("#card-countdown");
      await record(`${width}.countdown`, phoneBar);
    }
    await tab.viewport(390, 844);
    for (const theme of ["daylight", "retro", "terminal"]) {
      await pickTheme(tab, theme);
      await goRoute(tab, "date");
      await scrollTo("#bizCalGrid");
      await record(`390.${theme}-calendar`, phoneBar);
      const c = await json(tab, CONTRAST("addDays"));
      expect(`date.contrast.${theme}-hint-and-placeholder`, c.hint >= 4.5 && c.placeholder >= 4.5, JSON.stringify(c));
    }
    for (const pseudo of ["en-XA", "ar-XB"]) {
      await pickPseudo(tab, pseudo);
      await goRoute(tab, "date");
      await tab.evaluate(`scrollTo(0, 0); true`);
      await record(`390.${pseudo}-top`, phoneBar);
      await scrollTo("#card-business");
      await record(`390.${pseudo}-business`, phoneBar);
      await scrollTo("#card-countdown");
      await record(`390.${pseudo}-countdown`, phoneBar);
    }
    // ar-XB is still on: engine English and number fields keep their
    // left-to-right order; the calendar arrows are mirrored by bidi alone.
    await tab.evaluate(`document.getElementById("addModeSubtractBtn").click(); true`);
    for (const [id, v] of [["addStart", "2026-11-19"], ["addYears", ""], ["addMonths", ""], ["addWeeks", ""], ["addDays", "5"]]) await tab.evaluate(PUT(id, v));
    await waitFor(tab, `${TEXT("addLive")}.includes("2026-11-14")`);
    await scrollTo("#card-add");
    const rtl = await json(tab, `(() => { const dir = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).direction : null; };
      const prev = document.getElementById("bizCalPrevBtn").getBoundingClientRect(); const next = document.getElementById("bizCalNextBtn").getBoundingClientRect();
      return { page: document.documentElement.dir, main: dir("#addResult .result-main bdi"), expr: dir("#addResult .result-sub bdi.ltr"), trace: dir("#addTrace li bdi"), live: dir("#addLive bdi"),
        amount: dir("#addDays"), navTransform: getComputedStyle(document.getElementById("bizCalPrevBtn")).transform, prevOnRight: prev.left > next.left,
        exprText: (document.querySelector("#addResult .result-sub bdi.ltr") || {}).textContent }; })()`);
    const first = await tab.evaluate(LEFT_OF("#addResult .result-sub bdi.ltr", "2026-11-19"));
    const lastDate = await tab.evaluate(LEFT_OF("#addResult .result-sub bdi.ltr", "2026-11-14", true));
    expect("date.ar-XB-ltr-runs", rtl.page === "rtl" && [rtl.main, rtl.expr, rtl.trace, rtl.live, rtl.amount].every((d) => d === "ltr") && first !== null && lastDate !== null && first < lastDate,
      JSON.stringify({ ...rtl, first, lastDate }));
    expect("date.ar-XB-calendar-arrows-mirrored-once", rtl.navTransform === "none" && rtl.prevOnRight, JSON.stringify(rtl));
    await record("390.ar-XB-add", phoneBar);
    await pickPseudo(tab, "off");
    // Wider: two columns inside a card at 1280 px (drawer pinned).
    await tab.viewport(1280, 900, false);
    await goRoute(tab, "date");
    await scrollTo("#card-business");
    await record("1280.business");
    expect("date.no-console-errors", errorCount(tab.logs) === 0, describeLogs(tab.logs));
    await tab.close();
  } finally {
    await edge.close();
  }
  return saved;
}

// ---------------------------------------------------------------------------
// The Percentage tool (M2c) in a real browser at phone widths
// ---------------------------------------------------------------------------

const P_ORDER = `[...document.getElementById("percentCards").children].map((c) => c.dataset.card).join(",")`;
const P_CARDS = ["change", "percent", "what", "discount", "base", "markup", "tax", "tip"];
const P_LINES = (key) => `[...document.querySelectorAll("#${key}Result .result-main, #${key}Result .result-sub")].map((n) => n.textContent)`;

// The History panel (plan B10, M3), its budgets, export, import and the ± key.
// Under 4x CPU throttling (a mid-range phone): about 60, 60 and 40 ms on
// one unthrottled desktop core, with room for a slower CI runner.
const HISTORY_BUDGET_MS = { render: 250, search: 250, more: 150 };
const SEED_HISTORY = `(async () => {
  const NOW = Date.now();
  const entries = [];
  let pinned = 0;
  let unpinned = 0;
  for (let i = 0; pinned + unpinned < 2200; i++) {
    const pin = i % 11 === 3 && pinned < 200;
    if (!pin && unpinned >= 2000) continue;
    if (pin) pinned++;
    else unpinned++;
    const ts = NOW - 60000 - i * 41 * 60000;
    const id = "h-" + ts + "-" + i;
    entries.push(i % 2 === 0
      ? { id, timestampMs: ts, tool: "percent", calculator: "change", calculatorLabel: "Percentage Change", inputs: { inputA: String(100 + i), inputB: String(200 + i) },
          expressionText: "", inputsText: (100 + i) + " → " + (200 + i), resultText: "Result " + i + " increase", copyText: "Result " + i, pinned: pin, note: i % 50 === 0 ? "Note " + i : null, engine: "percent-core 2.3.0" }
      : { id, timestampMs: ts, tool: "date", calculator: "info", calculatorLabel: "Date Info", inputs: { date: "2026-11-19" }, expressionText: "",
          inputsText: "2026-11-19", resultText: "Date result " + i, copyText: "Date result " + i, pinned: pin, note: null, engine: "date-core 1.0.0" });
  }
  const doc = JSON.stringify({ schemaVersion: 1, entries });
  await new Promise((done, failed) => {
    const r = indexedDB.open("pcalc");
    r.onerror = () => failed(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction("docs", "readwrite");
      tx.objectStore("docs").put(doc, "history");
      tx.oncomplete = () => { db.close(); done(); };
      tx.onerror = () => failed(tx.error);
    };
  });
  return { count: entries.length, pinned, bytes: doc.length };
})()`;
// Runs `body` in the page and forces style and layout of the panel before
// the clock stops, so the time is what a user waits for.
const TIMED = (body) => `(() => {
  const t0 = performance.now();
  ${body}
  const list = document.getElementById("historyList");
  void (list && list.getBoundingClientRect().height);
  const rows = document.querySelectorAll(".hist-row");
  void (rows.length && rows[rows.length - 1].getBoundingClientRect().bottom);
  return { ms: Math.round((performance.now() - t0) * 10) / 10, rows: rows.length };
})()`;
let historyTimings = null;

async function historyChecks(edgePath, url, shots) {
  const edge = await launchEdge(edgePath, []);
  const saved = [];
  const downloads = mkdtempSync(join(tmpdir(), "pcalc-dl-"));
  const timings = {};
  try {
    await edge.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
    const origin = new URL(url).origin;
    await edge.cdp.send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    const { tab } = await openPage(edge, url + "#/percent", { keepOpen: true });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = async (id) => {
      if (!shots) return;
      const path = join(shots, `history-${id.replace(/[^a-z0-9-]+/gi, "_")}.png`);
      await tab.screenshot(path);
      saved.push(path);
    };
    const record = async (id, extra = () => null) => {
      const l = await json(tab, LAYOUT);
      const more = await extra(l);
      const ok = l.scrollWidth <= l.vw && l.outside.length === 0 && l.small.length === 0 && l.clipped.length === 0 && l.broken.length === 0 && !more;
      expect(`history.layout.${id}`, ok, JSON.stringify({ scrollWidth: l.scrollWidth, vw: l.vw, outside: l.outside.slice(0, 4), small: l.small.slice(0, 4), clipped: l.clipped.slice(0, 4), broken: l.broken.slice(0, 4), more }));
      await shot(id);
    };
    const smallInputs = async () => {
      const small = await json(tab, `[...document.querySelectorAll("#historyPanel input:not([type=file]), #historyPanel button")].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height < 43.5; }).map((n) => n.id || n.className)`);
      return small.length ? "small " + small.slice(0, 4).join(",") : null;
    };
    const openHistory = async () => {
      const open = await tab.evaluate(`!document.getElementById("pane").hidden`);
      if (!open) await tab.tap("#paneToggle");
      await waitFor(tab, `document.getElementById("historyPanel") && !document.getElementById("pane").hidden`);
      await wait(80);
    };
    const closePane = async () => {
      await tab.evaluate(`(() => { const p = document.getElementById("pane"); if (!p.hidden) document.getElementById("paneClose").click(); return true; })()`);
      await wait(80);
    };

    await tab.viewport(390, 844);
    // ---- 2,200 entries: boot, first render, search, Show more (4x CPU) ----
    const seeded = await json(tab, SEED_HISTORY);
    await edge.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }, tab.sessionId);
    // A new document (the same URL with only a hash would not reload).
    const booted = await tab.navigate(url + "?seeded=1#/percent");
    await waitFor(tab, `window.PCalc.historyStore.entries().length === 2200`, 8000);
    timings.bootMs = booted.bootMs;
    await tab.tap("#paneToggle");
    await waitFor(tab, `document.getElementById("historyPanel")`);
    await wait(100);
    // The panel's render: leave the tab and come back (the tab renders it).
    await tab.evaluate(`document.getElementById("paneTab-countdowns").click(); true`);
    await wait(100);
    const render = await json(tab, TIMED(`document.getElementById("paneTab-history").click();`));
    const search = await json(tab, TIMED(`const s = document.getElementById("historySearch"); s.value = "result 7"; s.dispatchEvent(new Event("input"));`));
    await tab.evaluate(`(() => { const s = document.getElementById("historySearch"); s.value = ""; s.dispatchEvent(new Event("input")); return true; })()`);
    const more = await json(tab, TIMED(`document.getElementById("historyMore").click();`));
    await edge.cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }, tab.sessionId);
    Object.assign(timings, { renderMs: render.ms, searchMs: search.ms, moreMs: more.ms, rows: render.rows, budget: HISTORY_BUDGET_MS, cpu: "4x throttled" });
    const count = await tab.evaluate(`document.getElementById("historyCount").textContent`);
    expect("history.2200-entries-loaded", seeded.count === 2200 && seeded.pinned === 200 && count === "2,200 entries" && booted.boot === "ok", JSON.stringify({ seeded, count, boot: booted.boot }));
    expect("history.2200-render-within-budget", render.rows === 60 && render.ms <= HISTORY_BUDGET_MS.render, JSON.stringify(render) + ` budget ${HISTORY_BUDGET_MS.render} ms`);
    expect("history.2200-search-within-budget", search.ms <= HISTORY_BUDGET_MS.search && search.rows > 0, JSON.stringify(search) + ` budget ${HISTORY_BUDGET_MS.search} ms`);
    expect("history.2200-show-more-within-budget", more.rows === 120 && more.ms <= HISTORY_BUDGET_MS.more, JSON.stringify(more) + ` budget ${HISTORY_BUDGET_MS.more} ms`);

    // ---- layout at 360 / 390 / 440, plus a note, Clear all and ar-XB ----
    for (const w of [360, 390, 440]) {
      await tab.viewport(w, 844);
      await openHistory();
      await record(`${w}.pane-history`, smallInputs);
    }
    await tab.viewport(390, 844);
    await openHistory();
    await tab.evaluate(`document.querySelector(".hist-row button[data-value='note']").click(); true`);
    await wait(60);
    await record("390.note-editing", async () => {
      const n = await json(tab, `(() => { const i = document.getElementById("historyNoteInput"); return i ? { dir: i.dir, max: i.maxLength, focused: document.activeElement === i } : null; })()`);
      return n && n.dir === "auto" && n.max === 200 && n.focused ? smallInputs() : "note input " + JSON.stringify(n);
    });
    await tab.evaluate(`document.getElementById("historyNoteCancel").click(); true`);
    await tab.evaluate(`document.getElementById("historyClearBtn").click(); true`);
    await wait(60);
    await record("390.clear-asked", async () => {
      const c = await json(tab, `({ keep: document.getElementById("historyKeepPinned").checked, text: document.getElementById("historyClearConfirm").textContent })`);
      return c.keep && c.text === "Delete 2,000 entries" ? null : JSON.stringify(c);
    });
    await tab.evaluate(`document.getElementById("historyClearCancel").click(); true`);
    await closePane();
    await pickPseudo(tab, "ar-XB");
    await goRoute(tab, "percent");
    await openHistory();
    await record("390.ar-XB", async () => ((await tab.evaluate(`document.documentElement.dir`)) === "rtl" ? smallInputs() : "not rtl"));
    await closePane();
    await pickPseudo(tab, "off");
    await goRoute(tab, "percent");

    // ---- Restore by a real tap ----
    await openHistory();
    const target = await json(tab, `(() => { const e = window.PCalc.historyStore.entries().find((x) => x.tool === "percent" && !x.pinned); return { id: e.id, a: e.inputs.inputA, b: e.inputs.inputB }; })()`);
    await tab.tap(`li[data-value='${target.id}'] .hist-main`);
    await waitFor(tab, `document.getElementById("changeOrig") && document.getElementById("changeOrig").value === ${JSON.stringify(target.a)}`);
    await wait(100);
    const restored = await json(tab, `({ a: document.getElementById("changeOrig").value, b: document.getElementById("changeNew").value, pane: document.getElementById("pane").hidden, focus: document.activeElement.id, live: document.getElementById("changeLive").textContent })`);
    expect("history.restore-by-tap", restored.a === target.a && restored.b === target.b && restored.pane === true && restored.focus === "card-change-title" && restored.live.startsWith("→ ") && restored.live !== "→ —", JSON.stringify(restored));

    // ---- the ± key by real taps ----
    await tab.evaluate(`(() => { document.getElementById("changeOrig").scrollIntoView({ block: "center" }); return true; })()`);
    await tab.tap("#changeOrig");
    const sign = await json(tab, `(() => { const r = document.getElementById("changeOrigSign").getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
    const beforeSign = await tab.evaluate(`document.getElementById("changeOrig").value`);
    await tab.tap("#changeOrigSign");
    await wait(150);
    const afterSign = await json(tab, `({ value: document.getElementById("changeOrig").value, focus: document.activeElement.id, mode: document.getElementById("changeOrig").inputMode })`);
    expect("history.sign-key-real-tap", afterSign.value === "-" + beforeSign && afterSign.focus === "changeOrig" && afterSign.mode === "decimal" && sign.w >= 44 && sign.h >= 44, JSON.stringify({ beforeSign, afterSign, sign }));
    await tab.tap("#changeOrigSign");
    await tab.evaluate(`document.activeElement.blur(); true`);
    await wait(100);
    await record("390.percent-with-sign-keys");
    await goRoute(tab, "date");
    await record("390.date-with-sign-keys", async () => {
      const s = await json(tab, `[...document.querySelectorAll("#dateTool .sign-button")].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); })`);
      return s.length === 4 && s.every((x) => x >= 44) ? null : "sign keys " + JSON.stringify(s);
    });
    await goRoute(tab, "percent");

    // ---- Export JSON and CSV as real downloads ----
    await openHistory();
    const listDir = () => (existsSync(downloads) ? readdirSync(downloads).filter((n) => !n.endsWith(".crdownload")) : []);
    const waitFile = async (re) => {
      for (let i = 0; i < 100; i++) {
        const f = listDir().find((n) => re.test(n));
        if (f) return f;
        await wait(50);
      }
      return null;
    };
    await tab.evaluate(`document.getElementById("historyExportJson").click(); true`);
    const jsonName = await waitFile(/^Portable-Calculator-\d{8}-\d{6}\.json$/);
    let exported = null;
    try {
      exported = jsonName ? JSON.parse(readFileSync(join(downloads, jsonName), "utf8")) : null;
    } catch (_) {
      exported = null;
    }
    const status = await tab.evaluate(`document.getElementById("historyStatus").textContent`);
    expect("history.export-json-download", Boolean(exported) && exported.format === "portable-calculator-export" && exported.formatVersion === 1 && exported.history.entries.length === 2200 &&
      Boolean(exported.countdowns) && Boolean(exported.settings) && status === "Downloaded " + jsonName && tab.logs.consoleErrors.length === 0,
      JSON.stringify({ jsonName, status, entries: exported && exported.history.entries.length, errors: tab.logs.consoleErrors.slice(0, 2) }));
    await tab.evaluate(`document.getElementById("historyExportCsv").click(); true`);
    const csvName = await waitFile(/^Portable-Calculator-\d{8}-\d{6}.*\.csv$/);
    const csv = csvName ? readFileSync(join(downloads, csvName)) : null;
    expect("history.export-csv-download", Boolean(csv) && csv[0] === 0xef && csv[1] === 0xbb && csv[2] === 0xbf && csv.toString("utf8").split("\r\n").length === 2202, JSON.stringify({ csvName, lines: csv ? csv.toString("utf8").split("\r\n").length : 0 }));
    // ---- Copy export to clipboard (the iOS home-screen fallback) ----
    await tab.evaluate(`document.getElementById("historyExportCopy").focus(); document.getElementById("historyExportCopy").click(); true`);
    await waitFor(tab, `document.getElementById("historyStatus").textContent.startsWith("Export copied")`);
    const clip = await json(tab, `navigator.clipboard.readText().then((t) => { const j = JSON.parse(t); return { format: j.format, n: j.history.entries.length }; }, (e) => ({ error: String(e) }))`);
    expect("history.export-clipboard-fallback", clip.format === "portable-calculator-export" && clip.n === 2200, JSON.stringify(clip));

    // ---- Import: preview counts, then one write ----
    const importFile = join(downloads, "import-test.json");
    if (exported) {
      const extra = exported.history.entries.slice(0, 3).map((e, i) => ({ ...e, id: "h-1000000000000-" + (900 + i), timestampMs: 1000000000000 + i, pinned: false }));
      const bad = { ...exported.history.entries[5], tool: "standard", id: "h-1000000000000-999" };
      writeFileSync(importFile, JSON.stringify({ ...exported, history: { schemaVersion: 1, entries: [...exported.history.entries.slice(0, 10), ...extra, bad] } }));
    }
    const { root } = await edge.cdp.send("DOM.getDocument", { depth: 0 }, tab.sessionId);
    const { nodeId } = await edge.cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#historyImportFile" }, tab.sessionId);
    await edge.cdp.send("DOM.setFileInputFiles", { nodeId, files: [importFile] }, tab.sessionId);
    await waitFor(tab, `document.getElementById("historyImportSummary")`);
    const summary = await tab.evaluate(`(document.getElementById("historyImportSummary") || { textContent: "" }).textContent`);
    await record("390.import-preview", smallInputs);
    await tab.tap("#historyImportConfirm");
    await waitFor(tab, `document.getElementById("historyStatus").textContent.includes("imported")`, 5000);
    const afterImport = await json(tab, `(async () => { const d = JSON.parse(await ${IDB_GET("history")}); return { n: d.entries.length, has: d.entries.some((e) => e.id === "h-1000000000000-900") }; })()`);
    // At the 2,000 unpinned cap the three new entries (older than every
    // other) are the ones evicted again: the document stays at 2,200, every
    // pinned entry kept; the preview said so.
    expect("history.import-preview-and-commit", summary === "3 new · 10 duplicates · 1 rejected" && afterImport.n === 2200, JSON.stringify({ summary, afterImport }));

    // ---- A second tab follows a recorded entry (BroadcastChannel) ----
    const second = await openPage(edge, url + "#/about", { keepOpen: true });
    const other = second.tab;
    await waitFor(other, `window.PCalc.historyStore.entries().length > 0`, 5000);
    await closePane();
    await tab.evaluate(`(() => { for (const [id, v] of [["discountPrice", "50"], ["discountPercent", "10"]]) { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event("input", { bubbles: true })); } return true; })()`);
    await waitFor(tab, `document.getElementById("discountLive").textContent.includes("45.00")`);
    await tab.evaluate(`document.getElementById("discountCalcBtn").click(); true`);
    const synced = await waitFor(other, `window.PCalc.historyStore.entries()[0].calculator === "discount" && window.PCalc.historyStore.entries()[0].resultText.includes("45.00")`, 5000);
    expect("history.second-tab-follows", Boolean(synced), "second tab sees the new discount entry");
    await other.close();
  } finally {
    await edge.close();
    rmSync(downloads, { recursive: true, force: true });
  }
  console.log(`history timings: ${JSON.stringify(timings)}`);
  historyTimings = timings;
  return saved;
}

async function percentChecks(edgePath, url, shots) {
  const edge = await launchEdge(edgePath, []);
  const saved = [];
  try {
    const { tab } = await openPage(edge, url + "#/percent", { keepOpen: true });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = async (id) => {
      if (!shots) return;
      const path = join(shots, `percent-${id.replace(/[^a-z0-9-]+/gi, "_")}.png`);
      await tab.screenshot(path);
      saved.push(path);
    };
    const record = async (id, extra = () => null) => {
      const l = await json(tab, LAYOUT);
      const more = await extra(l);
      const ok = l.scrollWidth <= l.vw && l.outside.length === 0 && l.small.length === 0 && l.clipped.length === 0 && l.broken.length === 0 && !more;
      expect(`percent.layout.${id}`, ok, JSON.stringify({ scrollWidth: l.scrollWidth, vw: l.vw, outside: l.outside.slice(0, 4), small: l.small.slice(0, 4), clipped: l.clipped.slice(0, 4), broken: l.broken.slice(0, 4), more }));
      await shot(id);
    };
    const scrollTo = (sel) => tab.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); n.scrollIntoView({ block: "start" });
      scrollBy(0, -(document.getElementById("topbar").getBoundingClientRect().height + 8)); return true; })()`);
    const phoneBar = async () => phoneBarProblem(await json(tab, BAR(true)));
    // Inputs and buttons at least 44 px tall (the layout probe covers buttons only).
    const fields = async () => {
      const small = await json(tab, `[...document.querySelectorAll("#percentTool input")].filter((n) => n.getBoundingClientRect().height < 43.5).map((n) => n.id)`);
      return small.length ? "small inputs " + small.join(",") : null;
    };

    await tab.viewport(390, 844);
    await goRoute(tab, "percent");
    await waitFor(tab, `document.getElementById("percentCards") && document.getElementById("percentCards").children.length === 8`);
    await record("390.top", async () => (await phoneBar()) || (await fields()));
    // Real taps and typing on Discount: the two lines are text, never "<br>".
    await scrollTo("#card-discount");
    await tab.tap("#discountPrice");
    await tab.type("79.99");
    await tab.tap("#discountPercent");
    await tab.type("20");
    await waitFor(tab, `${TEXT("discountLive")} === "→ final: 63.99 | saved: 16.00"`);
    const disc = await json(tab, `({ lines: ${P_LINES("discount")}, br: document.querySelectorAll("#percentTool br").length, angle: document.getElementById("percentTool").textContent.includes("<"),
      formula: [...document.querySelectorAll("#discountFormula li")].map((n) => n.textContent) })`);
    expect("percent.discount-typed-text-only", disc.lines.join("|") === "Final: 63.99|Saved: 16.00" && disc.br === 0 && !disc.angle &&
      disc.formula.join("|") === "final = 79.99 × (1 − 20/100) = 63.99|saved = 79.99 × 20/100 = 16.00", JSON.stringify(disc));
    // Enter in a field records history; typing alone did not.
    const before = await tab.evaluate(`window.PCalc.history.recorded().length`);
    await tab.key("Enter");
    await waitFor(tab, `window.PCalc.history.recorded().length === ${before + 1}`);
    const entry = await json(tab, `window.PCalc.history.recorded().pop()`);
    expect("percent.enter-records", before === 0 && entry.tool === "percent" && entry.calculator === "discount" && entry.copyText === "Final: 63.99\nSaved: 16.00", JSON.stringify({ before, entry }));
    // Enter spoke the result in the tool's one polite region; the result boxes are not live.
    const spoken = await json(tab, `({ region: document.getElementById("percentResultLive").textContent.trim(), live: document.querySelectorAll("#percentTool .result[aria-live], #percentTool .result[role]").length })`);
    expect("percent.enter-speaks-once", spoken.region === "Final: 63.99. Saved: 16.00" && spoken.live === 0, JSON.stringify(spoken));
    // Typing 150 then 180 key by key: nothing is spoken until the typing pauses.
    await scrollTo("#card-change");
    const quiet = await tab.evaluate(`document.getElementById("percentResultLive").textContent`);
    await tab.tap("#changeOrig");
    for (const k of ["1", "5", "0"]) await tab.type(k);
    await tab.tap("#changeNew");
    for (const k of ["1", "8", "0"]) await tab.type(k);
    const typing = await tab.evaluate(`document.getElementById("percentResultLive").textContent`);
    await waitFor(tab, `document.getElementById("percentResultLive").textContent === "20.00% increase"`, 2000);
    const said = await tab.evaluate(`document.getElementById("percentResultLive").textContent`);
    expect("percent.typing-speaks-after-pause", typing === quiet && said === "20.00% increase", JSON.stringify({ quiet, typing, said }));
    // Arabic-Indic digits typed into a field (as an Arabic keyboard sends them) compute.
    await scrollTo("#card-percent");
    await tab.tap("#isWhatX");
    await tab.type("٥٠");
    await tab.tap("#isWhatY");
    await tab.type("٢٠٠");
    await waitFor(tab, `${TEXT("percentLive")} === "→ 25.00%"`);
    const typedArabic = await json(tab, `({ x: document.getElementById("isWhatX").value, y: document.getElementById("isWhatY").value, live: ${TEXT("percentLive")}, lines: ${P_LINES("percent")} })`);
    expect("percent.arabic-indic-digits-typed", typedArabic.x === "٥٠" && typedArabic.y === "٢٠٠" && typedArabic.live === "→ 25.00%" && typedArabic.lines.join() === "25.00%", JSON.stringify(typedArabic));
    await tab.evaluate(`document.activeElement.blur(); true`);
    // Every other card filled; each live result as Percentage Calculator v2.3.0 shows it.
    for (const [id, v] of [["changeOrig", "150"], ["changeNew", "180"], ["isWhatX", "50"], ["isWhatY", "200"], ["whatX", "20"], ["whatY", "500"],
      ["baseX", "50"], ["baseY", "25"], ["markupCost", "80"], ["markupPrice", "100"], ["taxAmount", "100"], ["taxRate", "15"], ["tipBill", "100"], ["tipPercent", "20"], ["tipPeople", "3"]]) {
      await tab.evaluate(PUT(id, v));
    }
    await waitFor(tab, `${TEXT("tipLive")} !== "→ —" && ${TEXT("markupLive")} !== "→ —"`, 4000);
    const lives = await json(tab, `${JSON.stringify(P_CARDS)}.map((k) => document.getElementById(k + "Live").textContent)`);
    expect("percent.live-results", lives.join("|") === ["→ 20.00% increase", "→ 25.00%", "→ 100.00", "→ final: 63.99 | saved: 16.00", "→ 200.00",
      "→ Profit: 20.00 | Markup: 25.00% | Margin: 20.00%", "→ Total: 115.00 | Tax: 15.00", "→ Each: 40.00 · Total: 120.00"].join("|"), JSON.stringify(lives));
    await tab.evaluate(`document.activeElement.blur(); true`);
    for (const key of P_CARDS) {
      await scrollTo(`#card-${key}`);
      await record(`390.${key}`, async () => (await phoneBar()) || (await fields()));
    }
    // Real taps: a tip preset, the tax mode, a swap.
    await scrollTo("#card-tip");
    await tab.tap("#tipPreset-15");
    await waitFor(tab, `${TEXT("tipLive")} === "→ Each: 38.33 · Total: 115.00"`);
    const preset = await json(tab, `({ value: document.getElementById("tipPercent").value, pressed: document.getElementById("tipPreset-15").getAttribute("aria-pressed"),
      h: Math.round(document.getElementById("tipPreset-15").getBoundingClientRect().height) })`);
    expect("percent.tip-preset-tap", preset.value === "15" && preset.pressed === "true" && preset.h >= 44, JSON.stringify(preset));
    await record("390.tip-preset", phoneBar);
    await scrollTo("#card-tax");
    await tab.tap("#taxMode-extract");
    await waitFor(tab, `${TEXT("taxLive")} === "→ Net: 86.96 | Tax: 13.04"`);
    const mode = await json(tab, `({ label: document.getElementById("taxAmountLabel").textContent, pressed: document.getElementById("taxMode-extract").getAttribute("aria-pressed"), lines: ${P_LINES("tax")} })`);
    expect("percent.tax-mode-tap", mode.label === "Total amount (tax-inclusive)" && mode.pressed === "true" && mode.lines.join("|") === "Net: 86.96|Tax: 13.04 (Total: 100.00)", JSON.stringify(mode));
    await record("390.tax-extract", phoneBar);
    await scrollTo("#card-change");
    await tab.tap("#changeSwapBtn");
    await waitFor(tab, `${TEXT("changeLive")} === "→ 16.67% decrease"`);
    expect("percent.swap-tap", (await tab.evaluate(`document.getElementById("changeOrig").value + "," + document.getElementById("changeNew").value`)) === "180,150", "");
    // The Move menu from a tap, then every card collapsed and a reload.
    await scrollTo("#card-markup");
    await tab.tap("#card-markup .card-handle");
    const menu = await json(tab, `(() => { const m = document.getElementById("cardMoveMenu"); return { open: !m.hidden, inMarkup: document.getElementById("card-markup").contains(m),
      heights: [...m.querySelectorAll("button")].map((x) => Math.round(x.getBoundingClientRect().height)) }; })()`);
    expect("percent.move-menu-tap", menu.open && menu.inMarkup && menu.heights.every((h) => h >= 44), JSON.stringify(menu));
    await record("390.move-menu", phoneBar);
    await tab.tap("#cardMoveMenu button[data-value=up]");
    await tab.tap("#cardMoveMenu button[data-value=done]");
    const moved = await tab.evaluate(P_ORDER);
    expect("percent.move-menu-moves", moved === "change,percent,what,discount,markup,base,tax,tip", moved);
    for (const key of P_CARDS) await tab.evaluate(`document.querySelector("#card-${key} .card-collapse").click(); true`);
    await tab.evaluate(`scrollTo(0, 0); true`);
    await record("390.all-collapsed", phoneBar);
    await wait(250);
    const stored = await json(tab, IDB_GET("settings"));
    const pct = stored ? JSON.parse(stored).percent : null;
    expect("percent.layout-persisted", Boolean(pct && pct.cardOrder.join() === "change,percent,what,discount,markup,base,tax,tip" && pct.collapsedCards.length === 8), JSON.stringify(pct));
    await tab.navigate(url + "#/percent");
    await waitFor(tab, `document.getElementById("percentCards") && document.getElementById("percentCards").children.length === 8`);
    const after = await json(tab, `({ order: ${P_ORDER}, collapsed: document.querySelectorAll(".tool-card.is-collapsed").length })`);
    expect("percent.reload-restores", after.order === "change,percent,what,discount,markup,base,tax,tip" && after.collapsed === 8, JSON.stringify(after));
    // Settings > Percentage > Layout > Reset.
    await goRoute(tab, "settings");
    await scrollTo("#settingsPercentLayout");
    await record("390.settings-layout", phoneBar);
    await tab.tap("#percentLayoutResetBtn");
    await wait(150);
    await goRoute(tab, "percent");
    const reset = await json(tab, `({ order: ${P_ORDER}, collapsed: document.querySelectorAll(".tool-card.is-collapsed").length })`);
    expect("percent.layout-reset", reset.order === P_CARDS.join() && reset.collapsed === 0, JSON.stringify(reset));
    // Fill again (a reload starts a new session) for the other widths, themes and languages.
    for (const [id, v] of [["markupCost", "80"], ["markupPrice", "100"], ["tipBill", "1234567.89"], ["tipPercent", "18"], ["tipPeople", "7"]]) await tab.evaluate(PUT(id, v));
    await waitFor(tab, `${TEXT("tipLive")} !== "→ —"`);
    for (const width of [360, 440]) {
      await tab.viewport(width, 800);
      await goRoute(tab, "percent");
      await scrollTo("#card-tax");
      await record(`${width}.tax`, phoneBar);
      await scrollTo("#card-tip");
      await record(`${width}.tip`, phoneBar);
    }
    await tab.viewport(390, 844);
    for (const theme of ["daylight", "retro", "terminal"]) {
      await pickTheme(tab, theme);
      await goRoute(tab, "percent");
      await scrollTo("#card-tip");
      await record(`390.${theme}-tip`, phoneBar);
      const c = await json(tab, CONTRAST("tipBill"));
      expect(`percent.contrast.${theme}-hint-and-placeholder`, c.hint >= 4.5 && c.placeholder >= 4.5, JSON.stringify(c));
    }
    for (const pseudo of ["en-XA", "ar-XB"]) {
      await pickPseudo(tab, pseudo);
      await goRoute(tab, "percent");
      await tab.evaluate(`scrollTo(0, 0); true`);
      await record(`390.${pseudo}-top`, phoneBar);
      await scrollTo("#card-markup");
      await record(`390.${pseudo}-markup`, phoneBar);
      await scrollTo("#card-tip");
      await record(`390.${pseudo}-tip`, phoneBar);
    }
    // ar-XB is still on: a -200 in a field reads "-200" (a left-to-right
    // field), and "175.00% decrease" keeps its order (a left-to-right run).
    await tab.evaluate(PUT("changeOrig", "-200"));
    await tab.evaluate(PUT("changeNew", "150"));
    await waitFor(tab, `${TEXT("changeLive")}.includes("175.00% decrease")`);
    await scrollTo("#card-change");
    const prtl = await json(tab, `(() => { const s = getComputedStyle(document.getElementById("changeOrig")); const b = document.querySelector("#changeResult .result-main bdi");
      return { page: document.documentElement.dir, field: s.direction, align: s.textAlign, main: b ? getComputedStyle(b).direction : null, text: b ? b.textContent : null }; })()`);
    const num = await tab.evaluate(LEFT_OF("#changeResult .result-main bdi", "175"));
    const word = await tab.evaluate(LEFT_OF("#changeResult .result-main bdi", "decrease"));
    expect("percent.ar-XB-ltr-runs", prtl.page === "rtl" && prtl.field === "ltr" && prtl.main === "ltr" && prtl.text === "175.00% decrease" && num !== null && word !== null && num < word,
      JSON.stringify({ ...prtl, num, word }));
    await record("390.ar-XB-change", phoneBar);
    await pickPseudo(tab, "off");
    // Wider: inputs and the live formula side by side at 1280 px.
    await tab.viewport(1280, 900, false);
    await goRoute(tab, "percent");
    await scrollTo("#card-markup");
    const sideBySide = await json(tab, `(() => { const g = document.querySelector("#card-markup .card-grid"); const [a, b] = g.children; return a.getBoundingClientRect().top === b.getBoundingClientRect().top; })()`);
    expect("percent.wide-two-columns", sideBySide === true, String(sideBySide));
    await record("1280.markup");
    expect("percent.no-console-errors", errorCount(tab.logs) === 0, describeLogs(tab.logs));
    await tab.close();
  } finally {
    await edge.close();
  }
  return saved;
}

// Build N+1: a copy of web/ with one changed byte, built into target/.
function buildNext(dist, info) {
  const work = join(ROOT, "target", "browser-boot");
  rmSync(work, { recursive: true, force: true });
  cpSync(join(ROOT, "web"), join(work, "web-next"), { recursive: true });
  const css = join(work, "web-next", "styles", "components.css");
  writeFileSync(css, readFileSync(css, "utf8") + "\n/* upgrade test: build N+1 */\n");
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "build-web.mjs"), "--web", join(work, "web-next"), "--out", join(work, "dist-next"), "--wasm", join(dist, info.web.wasm.file)],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(`building N+1 failed: ${r.stdout}${r.stderr}`);
  return { dir: join(work, "dist-next"), info: JSON.parse(readFileSync(join(work, "dist-next", "build-info.json"), "utf8")) };
}

const CACHES_SETTLED = (want) => `(async () => {
  const end = Date.now() + 15000;
  for (;;) {
    const keys = (await caches.keys()).filter((k) => k.startsWith("pcalc-"));
    if (navigator.serviceWorker.controller && keys.length === 1 && keys[0] === ${JSON.stringify(want)}) return keys;
    if (Date.now() > end) return keys;
    await new Promise((r) => setTimeout(r, 100));
  }
})()`;

const LOADED = `(() => ({ cssFile: window.PCalc.build.cssFile, assets: document.documentElement.dataset.assets,
  files: performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname.split("/").pop()).filter((f) => /^(app|engine)\\./.test(f)) }))()`;

async function upgradeChecks(edgePath, dist, info) {
  const n = info.web;
  const next = buildNext(dist, info);
  const n1 = next.info.web;
  const css = (w) => w.css.file.replace(/^web\//, "");
  const assetSet = (w) => new Set(w.assets);
  expect("upgrade.builds-differ", n.cacheName !== n1.cacheName && css(n) !== css(n1) && n.wasm.file === n1.wasm.file, `${n.cacheName} -> ${n1.cacheName}`);

  const server = await startStaticServer({ dir: join(dist, "web") });
  const edge = await launchEdge(edgePath, []);
  let open = true;
  try {
    const { tab, state } = await openPage(edge, server.url, { keepOpen: true });
    const keysN = await json(tab, CACHES_SETTLED(n.cacheName));
    expect("upgrade.n-boots-and-caches", state.boot === "ok" && keysN.length === 1 && keysN[0] === n.cacheName, `boot ${state.boot}, caches ${keysN.join(",")}`);

    // The user's data in build N: a non-default theme and route.
    await pickTheme(tab, "retro");
    await goRoute(tab, "date");
    await waitFor(tab, `${IDB_GET("state")}.then((v) => v && v.includes('"route":"date"') ? v : null)`);
    const settingsN = await json(tab, IDB_GET("settings"));
    // A second tab of build N stays open across the whole upgrade.
    const oldTab = (await openPage(edge, server.url, { keepOpen: true })).tab;

    // A CDN edge still serves build N's index.html next to N+1's sw.js: the
    // N+1 install must fail on the hash check, and N's cache must survive
    // and keep booting N (its hashed files are gone from the server).
    server.setDir(join(next.dir, "web"));
    const staleIndex = readFileSync(join(dist, "web", "index.html"));
    server.setTransform((rel) => (rel === "index.html" ? staleIndex : undefined));
    await tab.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r && r.update()).then(() => true, () => true)`);
    const failed = await json(tab, `(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      const end = Date.now() + 15000;
      while (r && r.installing && Date.now() < end) await new Promise((d) => setTimeout(d, 100));
      return { installing: Boolean(r && r.installing), waiting: Boolean(r && r.waiting), caches: (await caches.keys()).filter((k) => k.startsWith("pcalc-")) };
    })()`);
    expect(
      "upgrade.stale-index-fails-the-install",
      !failed.installing && !failed.waiting && failed.caches.length === 1 && failed.caches[0] === n.cacheName,
      JSON.stringify(failed)
    );
    // (With a worker that cached the stale index, its hashed files are
    // nowhere and the page never reaches a verdict: report, do not crash.)
    const stale = await tab.navigate(server.url).catch((err) => ({ boot: `none (${err.message})` }));
    const loadedStale = stale.boot === "ok" ? await json(tab, LOADED) : {};
    expect(
      "upgrade.stale-index-still-boots-n-from-its-cache",
      stale.boot === "ok" && loadedStale.cssFile === css(n) && loadedStale.assets === "consistent",
      `boot ${stale.boot}, css ${loadedStale.cssFile}, assets ${loadedStale.assets}`
    );
    server.setTransform(null);

    const online = await tab.navigate(server.url);
    const loadedOnline = await json(tab, LOADED);
    const mixedOnline = loadedOnline.files.filter((f) => !assetSet(n1).has(f));
    expect(
      "upgrade.n1-online-boots-with-only-its-assets",
      online.boot === "ok" && loadedOnline.cssFile === css(n1) && loadedOnline.assets === "consistent" && mixedOnline.length === 0,
      `boot ${online.boot}, css ${loadedOnline.cssFile}, foreign files ${mixedOnline.join(",") || "none"}`
    );
    const themeOnline = await tab.evaluate(`document.documentElement.dataset.theme`);
    expect("upgrade.n1-online-keeps-theme-and-route", online.route === "date" && themeOnline === "retro", `route ${online.route}, theme ${themeOnline}`);
    await tab.evaluate(`navigator.serviceWorker.getRegistration().then((r) => r && r.update()).then(() => true, () => true)`);
    const keysN1 = await json(tab, CACHES_SETTLED(n1.cacheName));
    expect("upgrade.worker-replaces-the-old-cache", keysN1.length === 1 && keysN1[0] === n1.cacheName, `caches ${keysN1.join(",")}`);

    // The build-N tab, now controlled by N+1's worker, still works.
    await goRoute(oldTab, "about");
    const oldState = await json(oldTab, `({ route: document.documentElement.dataset.route, title: document.getElementById("routeTitle").textContent, boot: document.documentElement.dataset.boot })`);
    expect("upgrade.open-n-tab-stays-usable", oldState.boot === "ok" && oldState.route === "about" && oldState.title === "About" && errorCount(oldTab.logs) === 0, `${JSON.stringify(oldState)} ${describeLogs(oldTab.logs)}`);
    await oldTab.close();

    await server.close();
    open = false;
    const offline = await tab.navigate(server.url + "#/about");
    const loadedOffline = await json(tab, LOADED);
    const mixedOffline = loadedOffline.files.filter((f) => !assetSet(n1).has(f));
    expect(
      "upgrade.n1-offline-boots-from-its-cache",
      offline.boot === "ok" && offline.route === "about" && loadedOffline.cssFile === css(n1) && loadedOffline.assets === "consistent" && mixedOffline.length === 0,
      `boot ${offline.boot}, route ${offline.route}, css ${loadedOffline.cssFile}, foreign files ${mixedOffline.join(",") || "none"}`
    );
    // The data written in N is untouched by the upgrade: same settings
    // bytes, the theme still applied, and no backup was ever needed.
    const after = await json(tab, `(async () => ({ theme: document.documentElement.dataset.theme, settings: await ${IDB_GET("settings")}, keys: await ${IDB_KEYS} }))()`);
    expect(
      "upgrade.user-data-survives",
      after.settings === settingsN && after.theme === "retro" && after.keys.every((k) => !k.includes(".bak")),
      JSON.stringify({ theme: after.theme, settingsSame: after.settings === settingsN, keys: after.keys })
    );
    // Offline, the browser logs the failed network attempts the worker
    // falls back from; nothing else may be logged.
    const other = tab.logs.consoleErrors.length + tab.logs.exceptions.length + tab.logs.logErrors.filter((e) => e.source !== "network").length;
    expect("upgrade.no-console-errors", other === 0, describeLogs(tab.logs));
    await tab.close();
  } finally {
    await edge.close();
    if (open) await server.close();
  }
}

function stats(list) {
  const sorted = list.slice().sort((a, b) => a - b);
  return { first: list[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted[sorted.length - 1], runs: list.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const infoPath = join(opts.dist, "build-info.json");
  if (!existsSync(infoPath)) fail(`${infoPath} not found (run node scripts/build-web.mjs)`);
  const info = JSON.parse(readFileSync(infoPath, "utf8"));
  if (!info.web || !info.single) fail("build-info.json has no web/single build (run the full node scripts/build-web.mjs)");
  const engineSha = info.web.wasm.sha256;
  const engineFile = info.web.wasm.file.replace(/^web\//, "");
  const singleUrl = pathToFileURL(join(opts.dist, info.single.html.file)).href;
  const edgePath = findEdge(opts.edge);
  const timing = {};

  if (opts.percentOnly) {
    const server = await startStaticServer({ dir: join(opts.dist, "web") });
    let shots = [];
    try {
      shots = await percentChecks(edgePath, server.url, opts.shots);
    } finally {
      await server.close();
    }
    return report(opts, "Edge", edgePath, timing, info, engineSha, shots);
  }
  if (opts.historyOnly) {
    const server = await startStaticServer({ dir: join(opts.dist, "web") });
    let shots = [];
    try {
      shots = await historyChecks(edgePath, server.url, opts.shots);
    } finally {
      await server.close();
    }
    return report(opts, "Edge", edgePath, timing, info, engineSha, shots);
  }
  if (opts.dateOnly) {
    const server = await startStaticServer({ dir: join(opts.dist, "web") });
    let shots = [];
    try {
      shots = await dateChecks(edgePath, server.url, opts.shots);
    } finally {
      await server.close();
    }
    return report(opts, "Edge", edgePath, timing, info, engineSha, shots);
  }
  const good = await startStaticServer({ dir: join(opts.dist, "web") });
  const tampered = await startStaticServer({
    dir: join(opts.dist, "web"),
    transform: (rel, bytes) => {
      if (rel !== engineFile) return undefined;
      const copy = Buffer.from(bytes);
      copy[copy.length >> 1] ^= 0x01;
      return copy;
    }
  });
  const blocked = await startStaticServer({ dir: join(opts.dist, "web"), transform: (rel) => (rel === engineFile ? null : undefined) });

  let edge = await launchEdge(edgePath, []);
  const browser = edge.version.product;
  try {
    for (const [name, url] of [["served", good.url], ["single", singleUrl]]) {
      const boots = [];
      for (let run = 0; run < opts.runs; run++) {
        const { state, logs } = await openPage(edge, url);
        if (run === 0) expectGoodBoot(name, state, logs, engineSha);
        else if (state.boot !== "ok" || errorCount(logs) > 0 || (state.violations || []).length > 0) {
          expect(`${name}.repeat-boot-${run}`, false, `data-boot=${state.boot} ${describeLogs(logs)}`);
        }
        boots.push(state.bootMs);
        if (run === 0) timing[name] = { wallFirstMs: Math.round(state.wallMs) };
      }
      timing[name] = { ...timing[name], bootMs: stats(boots) };
      await expectControl(name, edge, url);
    }
    expect("served.engine-fetched", (good.hits.get(engineFile) || 0) >= 1, `${engineFile} served ${good.hits.get(engineFile) || 0} times`);

    {
      const { state, logs } = await openPage(edge, tampered.url);
      expectRescue("tampered", state, logs, "integrity", "integrity", () => false);
    }
    {
      // The 404 itself is logged by the browser as a network error.
      const { state, logs } = await openPage(edge, blocked.url);
      expectRescue("blocked", state, logs, "load-failed", "load", (e) => e.source === "network" && e.url.endsWith(engineFile));
    }
  } finally {
    await edge.close();
  }

  // No WebAssembly at all (a fresh profile, so no storage is shared).
  edge = await launchEdge(edgePath, [], { noWasm: true });
  try {
    const before = good.hits.get(engineFile) || 0;
    const first = await openPage(edge, good.url, { keepOpen: true });
    expect("no-wasm.webassembly-absent", first.state.hasWasm === false, `typeof WebAssembly ${first.state.hasWasm ? "defined" : "undefined"}`);
    expectRescue("no-wasm.served", first.state, first.logs, "unsupported", "no_wasm", () => false);
    expect("no-wasm.served.rescue-empty", first.state.rescue && first.state.rescue.state === "0", JSON.stringify(first.state.rescue));
    // Seed raw data (one app key, one foreign key) and reload: the rescue
    // view lists only the app key, byte for byte, and writes nothing.
    await first.tab.evaluate(`localStorage.setItem("pcalc.rescue-test", ${JSON.stringify(RAW_STORED)}); localStorage.setItem("other-app", "x"); true`);
    const snapshot = await first.tab.evaluate(STORAGE_SNAPSHOT);
    const again = await first.tab.navigate(good.url);
    const after = await first.tab.evaluate(STORAGE_SNAPSHOT);
    await first.tab.evaluate(`localStorage.removeItem("pcalc.rescue-test"); localStorage.removeItem("other-app"); true`);
    await first.tab.close();
    const r = again.rescue;
    expect(
      "no-wasm.served.rescue-lists-raw-data",
      again.boot === "unsupported" && r && r.state === "1" && r.keys[0] === "pcalc.rescue-test" && r.values[0] === RAW_STORED && r.buttons === 2,
      JSON.stringify(r)
    );
    expect("no-wasm.served.rescue-is-read-only", snapshot === after, `before ${snapshot.length} chars, after ${after.length} chars`);
    expect("no-wasm.served.engine-not-fetched", (good.hits.get(engineFile) || 0) === before, `engine requests during no-WASM boots: ${(good.hits.get(engineFile) || 0) - before}`);
    expect("no-wasm.served.no-csp-violations-with-data", (again.violations || []).length === 0, JSON.stringify(again.violations));

    const single = await openPage(edge, singleUrl);
    expectRescue("no-wasm.single", single.state, single.logs, "unsupported", "no_wasm", () => false);
  } finally {
    await edge.close();
  }
  // The shell, its layouts and the service-worker upgrade, each in its own
  // throwaway profile on its own origin.
  await shellChecks(edgePath, good.url);
  await Promise.all([good.close(), tampered.close(), blocked.close()]);
  const layoutServer = await startStaticServer({ dir: join(opts.dist, "web") });
  let screenshots = [];
  try {
    screenshots = await layoutChecks(edgePath, layoutServer.url, opts.shots);
  } finally {
    await layoutServer.close();
  }
  const dateServer = await startStaticServer({ dir: join(opts.dist, "web") });
  try {
    screenshots = screenshots.concat(await dateChecks(edgePath, dateServer.url, opts.shots));
  } finally {
    await dateServer.close();
  }
  const percentServer = await startStaticServer({ dir: join(opts.dist, "web") });
  try {
    screenshots = screenshots.concat(await percentChecks(edgePath, percentServer.url, opts.shots));
  } finally {
    await percentServer.close();
  }
  const historyServer = await startStaticServer({ dir: join(opts.dist, "web") });
  try {
    screenshots = screenshots.concat(await historyChecks(edgePath, historyServer.url, opts.shots));
  } finally {
    await historyServer.close();
  }
  if (opts.upgrade) await upgradeChecks(edgePath, opts.dist, info);
  return report(opts, browser, edgePath, timing, info, engineSha, screenshots);
}

function report(opts, browser, edgePath, timing, info, engineSha, screenshots) {
  const failed = results.filter((r) => r.status === "fail");
  for (const r of results) console.log(`${r.status === "pass" ? "PASS" : "FAIL"} ${r.id}${r.status === "pass" ? "" : ": " + r.detail}`);
  console.log(`browser: ${browser} (${edgePath}), headless, throwaway profile, ${PHONE.width}x${PHONE.height} phone viewport`);
  console.log(`engine: ${info.web.wasm.file} ${info.web.wasm.bytes} B sha256 ${engineSha}; single file ${info.single.html.bytes} B`);
  for (const [name, t] of Object.entries(timing)) {
    console.log(`boot ${name}: data-boot-ms first ${t.bootMs.first}, median ${t.bootMs.median}, max ${t.bootMs.max} over ${t.bootMs.runs} runs (first navigate-to-verdict ${t.wallFirstMs} ms)`);
  }
  if (screenshots.length) console.log(`screenshots: ${screenshots.length} PNG files in ${opts.shots}`);
  const summary = { browser, edgePath, passed: results.length - failed.length, failed: failed.length, timing, engine: info.web.wasm, single: info.single.html, screenshots, results };
  if (opts.json) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(opts.json, JSON.stringify(summary, null, 2) + "\n");
  }
  console.log(`browser-boot: ${summary.passed} passed, ${summary.failed} failed` + (failed.length === 0 ? " (OK)" : " (FAILED)"));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  // What passed and failed before the error, then the error.
  for (const r of results) console.log(`${r.status === "pass" ? "PASS" : "FAIL"} ${r.id}${r.status === "pass" ? "" : ": " + r.detail}`);
  fail(err && err.stack ? err.stack : String(err));
});
