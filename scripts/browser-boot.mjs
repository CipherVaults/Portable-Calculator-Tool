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
// compiling), no horizontal scroll at a 390 px phone viewport. A positive
// control then injects an inline script into each booted page: it must be
// blocked and must be seen by both detectors (violation event and console
// error), so "zero" above means something.
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
// Timing: each good build is booted --runs times (default 5) in fresh tabs;
// data-boot-ms (navigation start to verdict, measured in the page) is
// reported as first / median / max.
//
//   node scripts/browser-boot.mjs [--dist <dir>] [--edge <path>] [--runs N] [--json <path>]
//
// Edge: --edge, else $PCALC_EDGE, else the usual install paths. WebKit
// (Safari/iOS) and Gecko (Firefox) are not driven here; they stay manual
// checks on real devices (plan B15 "Manual"). WebView2 is the desktop smoke
// test (cargo run -p portable-calculator-tool -- --smoke-test).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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
  const opts = { dist: join(ROOT, "dist"), edge: process.env.PCALC_EDGE || null, runs: 5, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") opts.dist = resolve(argv[++i] || fail("--dist needs a path"));
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
    checksPassed: document.querySelectorAll(".check.pass").length,
    checksFailed: document.querySelectorAll(".check.fail").length,
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
async function openPage(edge, url, { keepOpen = false } = {}) {
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
  const tab = {
    sessionId,
    logs,
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
  expect(`${name}.checks`, state.checksPassed === 5 && state.checksFailed === 0, `${state.checksPassed} passed, ${state.checksFailed} failed`);
  expect(`${name}.no-csp-violations`, Array.isArray(state.violations) && state.violations.length === 0, JSON.stringify(state.violations));
  expect(`${name}.no-console-errors`, errorCount(logs) === 0, describeLogs(logs));
  expect(`${name}.engine-sha256-verified`, state.engine === "wasm" && state.engineSha256 === engineSha, `engine=${state.engine} sha256=${state.engineSha256}`);
  expect(`${name}.phone-no-horizontal-scroll`, state.scrollWidth <= state.innerWidth, `scrollWidth ${state.scrollWidth}, viewport ${state.innerWidth}`);
}

// The positive control: an injected inline script must be blocked and seen.
async function expectControl(name, edge, url) {
  const { tab } = await openPage(edge, url, { keepOpen: true });
  const ran = await tab.evaluate(`(() => { const s = document.createElement("script"); s.textContent = "window.__pcalcInjected = 1"; document.body.append(s); return window.__pcalcInjected === 1; })()`);
  await new Promise((r) => setTimeout(r, 300));
  const state = JSON.parse(await tab.evaluate(STATE));
  const seen = (state.violations || []).filter((v) => v.directive === "script-src-elem" || v.directive === "script-src");
  const logged = tab.logs.logErrors.filter((e) => /Content Security Policy/i.test(e.text)).length + tab.logs.consoleErrors.filter((t) => /Content Security Policy/i.test(t)).length;
  await tab.close();
  expect(`${name}.control-inline-script-blocked-and-detected`, ran === false && seen.length >= 1 && logged >= 1, `ran=${ran} violations=${seen.length} logged=${logged}`);
}

function expectRescue(name, state, logs, wantBoot, wantError, allow) {
  expect(`${name}.boot-${wantBoot}`, state.boot === wantBoot && state.bootError === wantError, `data-boot=${state.boot} error=${state.bootError}`);
  expect(`${name}.rescue-shown`, state.rescue !== null && state.checksPassed === 0, `rescue=${JSON.stringify(state.rescue)} title=${state.title}`);
  expect(`${name}.no-csp-violations`, Array.isArray(state.violations) && state.violations.length === 0, JSON.stringify(state.violations));
  expect(`${name}.no-console-errors`, errorCount(logs, allow) === 0, describeLogs(logs));
  expect(`${name}.phone-no-horizontal-scroll`, state.scrollWidth <= state.innerWidth, `scrollWidth ${state.scrollWidth}, viewport ${state.innerWidth}`);
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
  await Promise.all([good.close(), tampered.close(), blocked.close()]);

  const failed = results.filter((r) => r.status === "fail");
  for (const r of results) console.log(`${r.status === "pass" ? "PASS" : "FAIL"} ${r.id}${r.status === "pass" ? "" : ": " + r.detail}`);
  console.log(`browser: ${browser} (${edgePath}), headless, throwaway profile, ${PHONE.width}x${PHONE.height} phone viewport`);
  console.log(`engine: ${info.web.wasm.file} ${info.web.wasm.bytes} B sha256 ${engineSha}; single file ${info.single.html.bytes} B`);
  for (const [name, t] of Object.entries(timing)) {
    console.log(`boot ${name}: data-boot-ms first ${t.bootMs.first}, median ${t.bootMs.median}, max ${t.bootMs.max} over ${t.bootMs.runs} runs (first navigate-to-verdict ${t.wallFirstMs} ms)`);
  }
  const summary = { browser, edgePath, passed: results.length - failed.length, failed: failed.length, timing, engine: info.web.wasm, single: info.single.html, results };
  if (opts.json) {
    mkdirSync(dirname(opts.json), { recursive: true });
    writeFileSync(opts.json, JSON.stringify(summary, null, 2) + "\n");
  }
  console.log(`browser-boot: ${summary.passed} passed, ${summary.failed} failed` + (failed.length === 0 ? " (OK)" : " (FAILED)"));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
