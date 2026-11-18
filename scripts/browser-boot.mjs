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
//              focus through the re-render its change causes (ArrowDown)
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
//              ar-XB the drawer opens from the right. At 900 px the pane is
//              an overlay from the inline end; at 1280 px the drawer is
//              pinned and the pane docked (all three themes each); crossing
//              900 -> 1280 px keeps the pane open and focus on its tab.
//              No formatted value (.num) wraps and no word of a title, tab
//              or nav label breaks mid-word; a clamped title is never cut.
//              With --shots <dir> each case is saved as a PNG screenshot
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
//
// Edge: --edge, else $PCALC_EDGE, else the usual install paths. WebKit
// (Safari/iOS) and Gecko (Firefox) are not driven here; they stay manual
// checks on real devices (plan B15 "Manual"). WebView2 is the desktop smoke
// test (cargo run -p portable-calculator-tool -- --smoke-test).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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
      const KEYS = { Tab: [9, "Tab"], Escape: [27, "Escape"], ArrowRight: [39, "ArrowRight"], ArrowLeft: [37, "ArrowLeft"], ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"] };
      const [vk, code] = KEYS[key] || (/^\d$/.test(key) ? [48 + Number(key), "Digit" + key] : [key.toUpperCase().charCodeAt(0), "Key" + key.toUpperCase()]);
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, sessionId);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
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
        if (Date.now() > deadline) throw new Error(`no data-boot verdict within ${BOOT_TIMEOUT_MS} ms at ${target}`);
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

// What a layout check needs: overflow, boxes outside the viewport, small
// targets and clipped text.
const LAYOUT = `(() => {
  const vw = document.documentElement.clientWidth;
  const name = (n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).join(".") : "");
  const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== "hidden"; };
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
  for (const n of document.querySelectorAll(".topbar-title, .pane-tab, .nav-link, .drawer-title, .pane-title")) {
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
    // The selected pane tab is bold and wider: select the longest label
    // (Countdowns) once, so every pane case below shows the worst case.
    await tab.viewport(360, 800);
    await goRoute(tab, "date");
    await tab.key("h", { ctrl: true });
    await tab.tap("#paneTab-countdowns");
    await tab.key("Escape");
    for (const width of [360, 390, 440]) {
      await tab.viewport(width, 800);
      for (const route of ["standard", "settings", "about", "converter/temperature"]) {
        await goRoute(tab, route);
        await record(`${width}.${route.replace("/", "-")}`);
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
        await record(`${width}.settings-${theme}`);
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
        await record(`${width}.en-XA-${route.replace("/", "-")}`);
      }
      await openDrawer();
      await record(`${width}.en-XA-drawer`);
      await tab.key("Escape");
      await goRoute(tab, "date");
      await tab.key("h", { ctrl: true });
      await record(`${width}.en-XA-pane-open`);
      await tab.key("Escape");
      await pickPseudo(tab, "ar-XB");
      await record(`${width}.ar-XB-settings`, (l) => (l.dir === "rtl" ? null : `dir ${l.dir}`));
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
    // Overlay pane (760-1100) and the docked layout (>= 1100).
    await tab.viewport(900, 800, false);
    await goRoute(tab, "about");
    await tab.key("h", { ctrl: true });
    await record("900.pane-overlay", async () => {
      const p = await json(tab, BOX("pane"));
      return p.role === "dialog" && Math.abs(p.right - p.vw) <= 0.5 && p.top <= 0.5 && Math.abs(p.bottom - p.vh) <= 1 && p.width <= 320.5 ? null : JSON.stringify(p);
    });
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
  if (opts.upgrade) await upgradeChecks(edgePath, opts.dist, info);

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

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
