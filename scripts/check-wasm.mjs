#!/usr/bin/env node
// Native vs WASM parity (plan B14). Replays every golden case of both
// engines through the native bridges and through the built engine.wasm
// (loaded with the real web loader, web/src/core/engine-web.js) and
// byte-compares the answers, under TZ=UTC, America/New_York and
// Africa/Cairo (the engines take no time zone; this proves it).
//
// Per time zone (a child process each):
//   date-core golden    ~14k cases: date_bridge (date-core's own NDJSON
//                       bridge, calc_* ops) == api_bridge (pcalc_api::call,
//                       date.* ops) == engine.wasm == the stored `res` bytes.
//   percent-core golden ~10k cases: api_bridge == engine.wasm, and the
//                       envelope's fields equal the v1.1 JavaScript results;
//                       non-finite arguments must be invalid_request;
//                       formatDecimal cases go through percent_bridge and,
//                       when finite, through percent.what {percent:100,
//                       number:x} (label == formatDecimal(x), since
//                       (100/100)*x == x exactly) on api_bridge and WASM.
//   extras              meta.versions, unknown ops, invalid JSON, the 64 KiB
//                       cap at exactly cap and cap+1, and last-bit float
//                       round trips (float_roundtrip in pcalc-api).
// The parent then checks all three time zones produced the same digest.
//
//   node scripts/check-wasm.mjs [--wasm <path>] [--bridges <dir>]
//
// Defaults: the engine named in dist/build-info.json (else the cargo output)
// and the release example binaries in target/release/examples. Build them
// first (PowerShell):
//   node scripts/build-wasm.mjs
//   cargo build --release --locked -p pcalc-api -p date-core -p percent-core --examples
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const TIME_ZONES = ["UTC", "America/New_York", "Africa/Cairo"];
const CAP_ENGINE = 64 * 1024;
const EXE = process.platform === "win32" ? ".exe" : "";

function fail(msg) {
  console.error(`check-wasm: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { wasm: null, bridges: join(ROOT, "target", "release", "examples"), child: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wasm") opts.wasm = resolve(argv[++i] || fail("--wasm needs a path"));
    else if (a === "--bridges") opts.bridges = resolve(argv[++i] || fail("--bridges needs a path"));
    else if (a === "--child") opts.child = true;
    else fail(`unknown argument ${a}`);
  }
  return opts;
}

function defaultWasm() {
  const info = join(ROOT, "dist", "build-info.json");
  if (existsSync(info)) {
    const built = JSON.parse(readFileSync(info, "utf8"));
    if (built.web && built.web.wasm) return { path: join(ROOT, "dist", built.web.wasm.file), sha256: built.web.wasm.sha256 };
  }
  return { path: join(ROOT, "target", "wasm32-unknown-unknown", "wasm", "pcalc_wasm.wasm"), sha256: null };
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

// `{"op":"…","req":REQ,"res":RES}` -> raw REQ / RES texts (as the Rust test).
function splitDateLine(line) {
  const body = line.endsWith(",") ? line.slice(0, -1) : line;
  const m = /^\{"op":"([a-z_]+)","req":/.exec(body);
  if (!m) return null;
  const rest = body.slice(m[0].length);
  const at = rest.indexOf(',"res":');
  if (at < 0 || rest.indexOf(',"res":', at + 1) >= 0 || !rest.endsWith("}")) return null;
  return { coreOp: m[1], req: rest.slice(0, at), res: rest.slice(at + 7, -1) };
}

function dateCases() {
  const text = readFileSync(join(ROOT, "crates", "date-core", "tests", "fixtures", "golden.json"), "utf8");
  const lines = text.split("\n").filter((l) => l.startsWith('{"op":'));
  const header = JSON.parse(text.split("\n")[0] + "]}");
  const cases = lines.map((line, i) => {
    const c = splitDateLine(line);
    if (!c) fail(`date golden line ${i + 2} is not a case`);
    return { ...c, op: "date." + c.coreOp.replace(/^calc_/, "") };
  });
  if (cases.length !== header.count) fail(`date golden header count ${header.count} != ${cases.length}`);
  return cases;
}

const PERCENT_OPS = {
  percentageChange: ["percent.change", "originalValue", "newValue"],
  percentageOfTotal: ["percent.percent", "part", "total"],
  percentagePortion: ["percent.what", "percent", "number"],
  originalValue: ["percent.base", "value", "percent"],
  discount: ["percent.discount", "price", "discountPercent"]
};

const jsNum = (s) => (s === "NaN" ? NaN : s === "Infinity" ? Infinity : s === "-Infinity" ? -Infinity : Number(s));

function percentCases() {
  const cases = JSON.parse(readFileSync(join(ROOT, "crates", "percent-core", "tests", "fixtures", "golden.json"), "utf8"));
  const api = [];
  const format = [];
  cases.forEach((c, idx) => {
    if (c.f === "formatDecimal") {
      format.push({ idx, a: c.a[0], want: c.r });
      return;
    }
    const spec = PERCENT_OPS[c.f];
    if (!spec) fail(`unknown percent golden function ${c.f}`);
    const finite = c.a.every((a) => Number.isFinite(jsNum(a)));
    // Finite JS number strings are valid JSON number tokens ("1e+21", "-0");
    // non-finite ones are sent as strings and must be refused.
    const arg = (a) => (finite ? a : JSON.stringify(a));
    const req = `{"${spec[1]}":${arg(c.a[0])},"${spec[2]}":${arg(c.a[1])}}`;
    api.push({ idx, f: c.f, op: spec[0], req, finite, r: c.r });
  });
  return { api, format };
}

function extraCases() {
  const days = '{"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":false}';
  const pad = (n) => days + " ".repeat(n - days.length);
  const floats = [
    "0.1", "2.2250738585072014e-308", "2.2250738585072011e-308", "4.9406564584124654e-324",
    "1.7976931348623157e308", "9007199254740993", "0.30000000000000004", "123456789.12345678",
    "8.98846567431158e307", "1.00000000000000011102230246251565404236316680908203125"
  ];
  return [
    { op: "meta.versions", req: "{}", expectCode: null },
    { op: "meta.versions", req: '{"x":1}', expectCode: "invalid_request" },
    { op: "calc.press", req: "{}", expectCode: "unknown_op" },
    { op: "", req: "{}", expectCode: "unknown_op" },
    { op: "date.age", req: "{", expectCode: "invalid_request" },
    { op: "date.age", req: "[]", expectCode: "invalid_request" },
    { op: "percent.change", req: '{"originalValue":"1","newValue":2}', expectCode: "invalid_request" },
    { op: "percent.tax", req: '{"amount":100,"ratePercent":15,"mode":"add"}', expectCode: null },
    { op: "percent.tip", req: '{"bill":100,"tipPercent":20,"people":3}', expectCode: null },
    { op: "percent.markup", req: '{"cost":80,"sellingPrice":100}', expectCode: null },
    { op: "date.days_between", req: pad(CAP_ENGINE), expectCode: null },
    { op: "date.days_between", req: pad(CAP_ENGINE + 1), expectCode: "request_too_large" },
    { op: "percent.change", req: " ".repeat(CAP_ENGINE + 1), expectCode: "request_too_large" },
    { op: "date.month_grid", req: '{"year":2026,"month":11,"firstDayOfWeek":"monday","today":"2026-11-18","calendar":{"preset":"eg"}}', expectCode: null },
    ...floats.map((text) => ({ op: "percent.what", req: `{"percent":100,"number":${text}}`, expectCode: null, floatText: text }))
  ];
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

function runBridge(exe, lines) {
  if (!existsSync(exe)) {
    fail(
      `missing ${exe}\nBuild the bridges first (PowerShell):\n` +
        "  cargo build --release --locked -p pcalc-api -p date-core -p percent-core --examples"
    );
  }
  const r = spawnSync(exe, [], { input: lines.join("\n") + "\n", maxBuffer: 1 << 30, env: process.env });
  if (r.error) fail(`${exe}: ${r.error.message}`);
  if (r.status !== 0) fail(`${exe} exited ${r.status}: ${String(r.stderr).slice(-400)}`);
  const out = r.stdout.toString("utf8").split("\n");
  if (out[out.length - 1] === "") out.pop();
  if (out.length !== lines.length) fail(`${exe} answered ${out.length} of ${lines.length} lines`);
  return out;
}

async function loadEngine(wasmPath, expectedSha) {
  const bytes = new Uint8Array(readFileSync(wasmPath));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha && sha !== expectedSha) fail(`${wasmPath} sha256 ${sha} != build-info ${expectedSha}`);
  // Run the real loader in a sandbox shaped like a browser window.
  const sandbox = { crypto: globalThis.crypto, WebAssembly, TextEncoder, TextDecoder, Uint8Array, Array, Error, Object };
  sandbox.window = sandbox;
  sandbox.window.PCalc = { platforms: {} };
  vm.createContext(sandbox);
  const loader = readFileSync(join(ROOT, "web", "src", "core", "engine-web.js"), "utf8");
  vm.runInContext(loader, sandbox, { filename: "engine-web.js" });
  const engine = await sandbox.PCalc.engineWeb.create(bytes, sha);
  // A wrong hash must be refused before compiling.
  let refused = false;
  try {
    await sandbox.PCalc.engineWeb.create(bytes, "0".repeat(64));
  } catch (_) {
    refused = true;
  }
  if (!refused) fail("engine-web.js accepted a wrong SHA-256");
  return { engine, sha, size: bytes.length };
}

async function child(opts) {
  const wasmInfo = opts.wasm ? { path: opts.wasm, sha256: null } : defaultWasm();
  if (!existsSync(wasmInfo.path)) fail(`engine.wasm not found at ${wasmInfo.path} (run node scripts/build-wasm.mjs)`);
  const { engine, sha, size } = await loadEngine(wasmInfo.path, wasmInfo.sha256);

  const date = dateCases();
  const percent = percentCases();
  const extras = extraCases();
  const formatApi = percent.format
    .filter((c) => Number.isFinite(jsNum(c.a)))
    .map((c) => ({ op: "percent.what", req: `{"percent":100,"number":${c.a}}`, a: c.a, want: c.want }));
  const apiCases = [...date.map((c) => ({ op: c.op, req: c.req })), ...percent.api, ...extras, ...formatApi];

  const bridge = (name) => join(opts.bridges, name + EXE);
  const apiNative = runBridge(bridge("api_bridge"), apiCases.map((c) => JSON.stringify({ op: c.op, req: c.req })));
  const dateNative = runBridge(bridge("date_bridge"), date.map((c) => `{"op":"${c.coreOp}","req":${c.req}}`));
  const formatNative = runBridge(
    bridge("percent_bridge"),
    percent.format.map((c) => JSON.stringify({ surface: "core", op: "format_decimal", a: c.a }))
  );

  const wasmOut = [];
  for (const c of apiCases) wasmOut.push(await engine.call(c.op, c.req));

  const problems = [];
  const report = (msg) => {
    if (problems.length < 20) problems.push(msg);
  };

  // 1. WASM == native api_bridge, byte for byte, for every request.
  let nativeMismatch = 0;
  apiCases.forEach((c, i) => {
    if (wasmOut[i] !== apiNative[i]) {
      nativeMismatch++;
      report(`native/wasm differ for ${c.op} ${c.req.slice(0, 120)}\n native ${apiNative[i].slice(0, 200)}\n wasm   ${wasmOut[i].slice(0, 200)}`);
    }
  });

  // 2. date: date_bridge == stored bytes == api/wasm.
  date.forEach((c, i) => {
    if (dateNative[i] !== c.res) report(`date_bridge differs from golden for ${c.coreOp} ${c.req.slice(0, 120)}`);
    if (wasmOut[i] !== c.res) report(`wasm differs from golden for ${c.op} ${c.req.slice(0, 120)}`);
  });

  // 3. percent: envelope fields == v1.1 JavaScript results.
  const same = (got, want) => (Number.isFinite(want) ? typeof got === "number" && Object.is(got, want) || got === want : got === null);
  percent.api.forEach((c, k) => {
    const out = JSON.parse(wasmOut[date.length + k]);
    const ctx = `percent golden #${c.idx} ${c.op} ${c.req}`;
    if (!c.finite) {
      if (out.ok !== "false" || out.error.code !== "invalid_request") report(`${ctx}: non-finite input not refused`);
      return;
    }
    if (c.f === "discount") {
      const r = out.result || {};
      if (out.ok !== "true" || "ok" in r) report(`${ctx}: bad discount envelope`);
      if (!same(r.finalPrice, jsNum(c.r.finalPrice)) || !same(r.saved, jsNum(c.r.saved))) report(`${ctx}: numbers differ`);
      if (r.label !== c.r.label || r.copyText !== c.r.copyText) report(`${ctx}: text differs`);
    } else if (c.r.ok === true) {
      const r = out.result || {};
      const want = jsNum(c.r.value);
      const wantLive = c.f === "percentageChange" && Number.isNaN(want) ? "?% no change" : c.r.label;
      if (out.ok !== "true" || !same(r.value, want) || r.label !== c.r.label || r.liveResult !== wantLive) {
        report(`${ctx}: got ${JSON.stringify(out).slice(0, 200)}`);
      }
    } else if (out.ok !== "false" || out.error.message !== c.r.error || out.error.code !== "zero_divisor") {
      report(`${ctx}: error differs: ${JSON.stringify(out)}`);
    }
  });
  percent.format.forEach((c, i) => {
    const out = JSON.parse(formatNative[i]);
    if (out.ok !== true || out.result !== c.want) report(`formatDecimal(${c.a}) = ${JSON.stringify(out)} want ${c.want}`);
  });

  // 4. extras.
  const extraBase = date.length + percent.api.length;
  extras.forEach((c, k) => {
    const out = JSON.parse(wasmOut[extraBase + k]);
    const code = out.ok === "true" ? null : out.error && out.error.code;
    if (code !== c.expectCode) report(`extra ${c.op} ${c.req.slice(0, 80)}: code ${code}, want ${c.expectCode}`);
    if (c.floatText !== undefined && !Object.is(out.result.value, Number(c.floatText))) {
      report(`float ${c.floatText}: got ${out.result.value}`);
    }
  });

  const formatBase = extraBase + extras.length;
  formatApi.forEach((c, k) => {
    const out = JSON.parse(wasmOut[formatBase + k]);
    if (out.ok !== "true" || out.result.label !== c.want) report(`formatDecimal(${c.a}) via percent.what = ${JSON.stringify(out)} want ${c.want}`);
  });

  const digest = createHash("sha256").update(wasmOut.join("\n")).digest("hex");
  const summary = {
    tz: process.env.TZ || "",
    wasm: { path: wasmInfo.path, bytes: size, sha256: sha },
    cases: {
      date: date.length,
      percentApi: percent.api.length,
      percentNonFinite: percent.api.filter((c) => !c.finite).length,
      formatDecimal: percent.format.length,
      formatDecimalViaApi: formatApi.length,
      extras: extras.length,
      apiTotal: apiCases.length,
      total: apiCases.length + percent.format.length
    },
    nativeMismatch,
    problems,
    digest
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
  process.exit(problems.length === 0 ? 0 : 1);
}

function singleFileEngineMatches(wasmSha) {
  const single = join(ROOT, "dist", "Portable-Calculator-Tool-Mobile.html");
  if (!existsSync(single)) return null;
  const html = readFileSync(single, "utf8");
  const m = /<script type="application\/octet-stream" id="engineWasm">([A-Za-z0-9+/=]+)<\/script>/.exec(html);
  if (!m) fail("single-file build has no engineWasm block");
  return createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") === wasmSha;
}

function parent(opts) {
  const results = [];
  for (const tz of TIME_ZONES) {
    const args = [SCRIPT, "--child", "--bridges", opts.bridges];
    if (opts.wasm) args.push("--wasm", opts.wasm);
    const r = spawnSync(process.execPath, args, { env: { ...process.env, TZ: tz }, maxBuffer: 1 << 26 });
    const text = r.stdout.toString("utf8").trim();
    if (r.status !== 0 && !text.startsWith("{")) fail(`child (TZ=${tz}) failed:\n${r.stderr.toString("utf8")}`);
    const summary = JSON.parse(text);
    results.push(summary);
    const c = summary.cases;
    console.log(
      `TZ=${tz.padEnd(16)} ${c.total} cases (date ${c.date}, percent ${c.percentApi} incl. ${c.percentNonFinite} non-finite, ` +
        `formatDecimal ${c.formatDecimal} (${c.formatDecimalViaApi} also via API/WASM), extras ${c.extras}; ${c.apiTotal} through API/WASM): native/wasm mismatches ${summary.nativeMismatch}, ` +
        `problems ${summary.problems.length}, digest ${summary.digest.slice(0, 16)}`
    );
    for (const p of summary.problems) console.log("  - " + p);
  }
  const first = results[0];
  let ok = results.every((r) => r.problems.length === 0 && r.nativeMismatch === 0);
  if (!results.every((r) => r.digest === first.digest)) {
    console.log("FAIL: outputs differ between time zones");
    ok = false;
  }
  const single = singleFileEngineMatches(first.wasm.sha256);
  if (single === false) {
    console.log("FAIL: the single-file build embeds a different engine.wasm");
    ok = false;
  }
  console.log(
    `engine ${first.wasm.path} ${first.wasm.bytes} bytes sha256 ${first.wasm.sha256}` +
      (single === null ? " (no single-file build to compare)" : ", identical in the single-file build")
  );
  console.log(ok ? "check-wasm: OK, native and WASM are byte-identical in every time zone" : "check-wasm: FAILED");
  process.exit(ok ? 0 : 1);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.child) await child(opts);
else parent(opts);
