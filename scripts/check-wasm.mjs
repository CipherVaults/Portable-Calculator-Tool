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
//                       cap at exactly cap and cap+1, inputs over the WASM
//                       input limit (an unknown op is still unknown_op, a
//                       known one request_too_large, as on native), and
//                       last-bit float round trips (float_roundtrip in
//                       pcalc-api).
//   random              200,000 seeded random requests (scripts/lib/
//                       random-requests.mjs) over every op pcalc-api knows
//                       (read from crates/pcalc-api/src/op.rs) plus unknown
//                       ops: mutated date requests, percent number tokens,
//                       meta bodies, malformed JSON, invalid UTF-8 in the op
//                       and the request, valid non-ASCII text, and every op
//                       at cap-1, cap and cap+1. Native api_bridge and WASM
//                       answers are byte-compared; every answer must be an
//                       envelope (never `internal`, i.e. never a trap), and
//                       the cap edges must answer request_too_large exactly
//                       past the cap. Text requests go through the loader's
//                       call(), invalid UTF-8 (and one in eight others)
//                       through its callBytes() and the bridge's hex form.
// The parent then checks all three time zones produced the same digests.
//
//   node scripts/check-wasm.mjs [--wasm <path>] [--bridges <dir>] [--no-build]
//                               [--seed <uint32>] [--random <count>]
//                               [--loader <path inside target/>]
//
// The seed defaults to DEFAULT_SEED and is printed, so a run is repeatable;
// --random 0 skips the random requests. --loader replaces
// web/src/core/engine-web.js (scripts/safety-eval.mjs runs a loader mutant
// through it to prove the random diff catches a divergence).
//
// Defaults: the engine named in dist/build-info.json (else
// target/engine/engine.wasm from build-wasm.mjs) and the release example
// binaries in target/release/examples. The parent first runs
//   cargo build --release --locked -p pcalc-api -p date-core -p percent-core --examples
// so the native side is never stale (a no-op when it is current); --no-build
// or --bridges <dir> skips that. Any engine that contains a local path of
// this machine is refused. Build the engine first, and on Windows run this
// from PowerShell (it runs Cargo):
//   node scripts/build-wasm.mjs
import { isUtf8 } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { ENGINE_WASM, findLocalPath } from "./lib/local-paths.mjs";
import { randomRequests } from "./lib/random-requests.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const TIME_ZONES = ["UTC", "America/New_York", "Africa/Cairo"];
const CAP_ENGINE = 64 * 1024;
const CAP_STORE = 256 * 1024;
const CAP_HISTORY_VALIDATE = 4 * 1024 * 1024 + 512 * 1024;
const CAP_IMPORT = 8 * 1024 * 1024;
// Plan B2's per-op caps (pcalc-api's Op::request_cap; its tests pin every
// op, and the cap edges of the random diff re-prove them byte for byte).
const capOf = (op) =>
  op === "history.apply" || op === "history.import_preview"
    ? CAP_IMPORT
    : op === "history.validate" || op === "history.export_csv"
      ? CAP_HISTORY_VALIDATE
      : /^[a-z]+\.validate$/.test(op)
        ? CAP_STORE
        : CAP_ENGINE;
// pcalc_wasm::MAX_INPUT_BYTES: MAX_OP_BYTES (64) + MAX_REQUEST_BYTES (8 MiB).
const MAX_INPUT_BYTES = 64 + 8 * 1024 * 1024;
const BRIDGE_BUILD = ["build", "--release", "--locked", "-p", "pcalc-api", "-p", "date-core", "-p", "percent-core", "--examples"];
const EXE = process.platform === "win32" ? ".exe" : "";
const DEFAULT_SEED = 20261118;
const DEFAULT_RANDOM = 200_000;
const DEFAULT_LOADER = join(ROOT, "web", "src", "core", "engine-web.js");

function fail(msg) {
  console.error(`check-wasm: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    wasm: null,
    bridges: join(ROOT, "target", "release", "examples"),
    child: false,
    build: true,
    seed: DEFAULT_SEED,
    random: DEFAULT_RANDOM,
    loader: DEFAULT_LOADER
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wasm") opts.wasm = resolve(argv[++i] || fail("--wasm needs a path"));
    else if (a === "--bridges") {
      opts.bridges = resolve(argv[++i] || fail("--bridges needs a path"));
      opts.build = false;
    } else if (a === "--no-build") opts.build = false;
    else if (a === "--seed") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) fail("--seed needs an integer from 0 to 4294967295");
      opts.seed = n;
    } else if (a === "--loader") {
      const path = resolve(argv[++i] || fail("--loader needs a path"));
      if (!path.startsWith(join(ROOT, "target") + sep)) fail("--loader must be inside target/");
      opts.loader = path;
    } else if (a === "--random") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0 || n > 5_000_000) fail("--random needs a count from 0 to 5000000");
      opts.random = n;
    }
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
  return { path: ENGINE_WASM, sha256: null };
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
    // Over the WASM input limit, where pc_in refuses before any op lookup:
    // the loader must still answer unknown_op for an unknown op (B2 order).
    { op: "nope", req: " ".repeat(MAX_INPUT_BYTES + 100), expectCode: "unknown_op" },
    { op: "date.age", req: " ".repeat(MAX_INPUT_BYTES + 100), expectCode: "request_too_large" },
    { op: "x".repeat(MAX_INPUT_BYTES + 1), req: "{}", expectCode: "unknown_op" },
    { op: "date.month_grid", req: '{"year":2026,"month":11,"firstDayOfWeek":"monday","today":"2026-11-18","calendar":{"preset":"eg"}}', expectCode: null },
    ...floats.map((text) => ({ op: "percent.what", req: `{"percent":100,"number":${text}}`, expectCode: null, floatText: text }))
  ];
}

// Every op name in pcalc-api's closed table (crates/pcalc-api/src/op.rs),
// so a new op is covered by the random requests without editing this file.
function knownOps() {
  const text = readFileSync(join(ROOT, "crates", "pcalc-api", "src", "op.rs"), "utf8");
  const table = /const TABLE: \[\(&str, Op\); (\d+)\] = \[([\s\S]*?)\n\];/.exec(text);
  if (!table) fail("cannot find the op TABLE in crates/pcalc-api/src/op.rs");
  const names = [...table[2].matchAll(/\(\s*"([a-z_.]+)",\s*Op::/g)].map((m) => m[1]);
  if (names.length !== Number(table[1])) fail(`op TABLE declares ${table[1]} ops but lists ${names.length}`);
  return names;
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

function refuseLocalPaths(wasmPath, bytes) {
  const leak = findLocalPath(bytes);
  if (leak) fail(`${wasmPath} contains the local path ${leak}; build it with node scripts/build-wasm.mjs`);
}

async function loadEngine(wasmPath, expectedSha, loaderPath) {
  const bytes = new Uint8Array(readFileSync(wasmPath));
  refuseLocalPaths(wasmPath, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha && sha !== expectedSha) fail(`${wasmPath} sha256 ${sha} != build-info ${expectedSha}`);
  // Run the real loader in a sandbox shaped like a browser window.
  const sandbox = { crypto: globalThis.crypto, WebAssembly, TextEncoder, TextDecoder, Uint8Array, Array, Error, Object };
  sandbox.window = sandbox;
  sandbox.window.PCalc = { platforms: {} };
  vm.createContext(sandbox);
  const loader = readFileSync(loaderPath, "utf8");
  vm.runInContext(loader, sandbox, { filename: "engine-web.js" });
  const engine = await sandbox.PCalc.engineWeb.create(bytes, sha);
  // A wrong hash must be refused before compiling, as "integrity".
  let refusal = null;
  try {
    await sandbox.PCalc.engineWeb.create(bytes, "0".repeat(64));
  } catch (err) {
    refusal = err && err.code;
  }
  if (refusal !== "integrity") fail(`engine-web.js did not refuse a wrong SHA-256 as integrity (got ${refusal})`);
  if (engine.sha256 !== sha) fail("engine-web.js does not report the hash it verified");
  return { engine, sha, size: bytes.length };
}

async function child(opts) {
  const wasmInfo = opts.wasm ? { path: opts.wasm, sha256: null } : defaultWasm();
  if (!existsSync(wasmInfo.path)) fail(`engine.wasm not found at ${wasmInfo.path} (run node scripts/build-wasm.mjs)`);
  const { engine, sha, size } = await loadEngine(wasmInfo.path, wasmInfo.sha256, opts.loader);

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
      report(`native/wasm differ for ${c.op.slice(0, 80)} ${c.req.slice(0, 120)}\n native ${apiNative[i].slice(0, 200)}\n wasm   ${wasmOut[i].slice(0, 200)}`);
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
    if (code !== c.expectCode) report(`extra ${c.op.slice(0, 80)} ${c.req.slice(0, 80)}: code ${code}, want ${c.expectCode}`);
    if (c.floatText !== undefined && !Object.is(out.result.value, Number(c.floatText))) {
      report(`float ${c.floatText}: got ${out.result.value}`);
    }
  });

  const formatBase = extraBase + extras.length;
  formatApi.forEach((c, k) => {
    const out = JSON.parse(wasmOut[formatBase + k]);
    if (out.ok !== "true" || out.result.label !== c.want) report(`formatDecimal(${c.a}) via percent.what = ${JSON.stringify(out)} want ${c.want}`);
  });

  const random = await randomDiff(opts, engine, bridge("api_bridge"), date, report);

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
    random,
    problems,
    digest
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
  process.exit(problems.length === 0 && random.mismatches === 0 ? 0 : 1);
}

// The random differential: native api_bridge vs engine.wasm, byte for byte.
async function randomDiff(opts, engine, apiBridge, dateCasesList, report) {
  if (opts.random === 0) return { count: 0, seed: opts.seed, mismatches: 0, digest: "" };
  const ops = knownOps();
  const started = performance.now();
  const cases = randomRequests({
    seed: opts.seed,
    count: opts.random,
    knownOps: ops,
    capOf,
    dateSeeds: dateCasesList.map((c) => ({ op: c.op, req: c.req }))
  });
  const generatedMs = performance.now() - started;
  const line = (c) => {
    if (!c.viaBytes) return JSON.stringify({ op: c.op.toString("utf8"), req: c.req.toString("utf8") });
    const op = isUtf8(c.op) ? { op: c.op.toString("utf8") } : { opHex: c.op.toString("hex") };
    return JSON.stringify({ ...op, reqHex: c.req.toString("hex") });
  };

  const known = new Set(ops);
  const codes = {};
  const kinds = {};
  const perOp = {};
  let mismatches = 0;
  let viaBytes = 0;
  let invalidUtf8 = 0;
  let nativeMs = 0;
  let wasmMs = 0;
  let answerBytes = 0;
  const hash = createHash("sha256");
  const show = (b) => JSON.stringify(b.toString("latin1").slice(0, 100));
  const check = (c, i, nativeAnswer, wasmAnswer) => {
    const opText = c.op.toString("utf8");
    const isKnown = known.has(opText) && isUtf8(c.op);
    kinds[c.kind] = (kinds[c.kind] || 0) + 1;
    if (isKnown) perOp[opText] = (perOp[opText] || 0) + 1;
    if (c.viaBytes) viaBytes++;
    if (!isUtf8(c.op) || !isUtf8(c.req)) invalidUtf8++;
    answerBytes += wasmAnswer.length;
    hash.update(wasmAnswer + "\n");
    if (wasmAnswer !== nativeAnswer) {
      mismatches++;
      report(`random #${i} (${c.kind}, seed ${opts.seed}) native/wasm differ for op ${show(c.op)} req ${show(c.req)}\n native ${nativeAnswer.slice(0, 200)}\n wasm   ${wasmAnswer.slice(0, 200)}`);
      return;
    }
    let out;
    try {
      out = JSON.parse(wasmAnswer);
    } catch (_) {
      report(`random #${i} (${c.kind}) answer is not JSON: ${wasmAnswer.slice(0, 200)}`);
      return;
    }
    const ok = out && (out.ok === "true" || out.ok === "false");
    const code = out && out.ok === "true" ? "ok" : out && out.error && out.error.code;
    if (!ok || typeof code !== "string" || code === "internal") report(`random #${i} (${c.kind}) bad envelope: ${wasmAnswer.slice(0, 200)}`);
    codes[code] = (codes[code] || 0) + 1;
    if (c.kind === "cap-edge") {
      // Unknown ops: unknown_op at every size. Known ops: request_too_large
      // past the cap; at or under it the request is parsed (junk and 0xFF
      // are invalid_request, padded JSON is whatever the op answers).
      const want = !isKnown ? "unknown_op" : c.req.length > capOf(opText) ? "request_too_large" : c.req[0] === 0x7b ? null : "invalid_request";
      const wrong = want ? code !== want : code === "request_too_large" || code === "unknown_op";
      if (wrong) report(`cap edge ${opText} ${c.req.length} B (first byte ${c.req[0]}): ${code}, want ${want || "parsed (not too large)"}`);
    }
  };

  // Batches keep memory flat: successful month grids and holiday lists are
  // large, and 200,000 answers on both sides do not fit in one string.
  const BATCH = 10_000;
  for (let from = 0; from < cases.length; from += BATCH) {
    const batch = cases.slice(from, from + BATCH);
    const t0 = performance.now();
    const native = runBridge(apiBridge, batch.map(line));
    const t1 = performance.now();
    const wasm = [];
    for (const c of batch) {
      wasm.push(c.viaBytes ? await engine.callBytes(c.op, c.req) : await engine.call(c.op.toString("utf8"), c.req.toString("utf8")));
    }
    const t2 = performance.now();
    nativeMs += t1 - t0;
    wasmMs += t2 - t1;
    batch.forEach((c, k) => check(c, from + k, native[k], wasm[k]));
  }
  for (const op of ops) {
    if ((perOp[op] || 0) < 500) report(`random requests reached ${op} only ${perOp[op] || 0} times`);
  }
  return {
    seed: opts.seed,
    count: cases.length,
    viaBytes,
    invalidUtf8,
    kinds,
    codes,
    ops: ops.length,
    minPerOp: Math.min(...ops.map((op) => perOp[op] || 0)),
    mismatches,
    answerBytes,
    ms: { generate: Math.round(generatedMs), native: Math.round(nativeMs), wasm: Math.round(wasmMs) },
    digest: hash.digest("hex")
  };
}

function singleFileEngineMatches(wasmSha) {
  const single = join(ROOT, "dist", "Portable-Calculator-Tool-Mobile.html");
  if (!existsSync(single)) return null;
  const html = readFileSync(single, "utf8");
  const m = /<script type="application\/octet-stream" id="engineWasm">([A-Za-z0-9+/=]+)<\/script>/.exec(html);
  if (!m) fail("single-file build has no engineWasm block");
  return createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") === wasmSha;
}

function buildBridges() {
  const r = spawnSync("cargo", BRIDGE_BUILD, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  if (r.error) fail(`cargo ${BRIDGE_BUILD.join(" ")}: ${r.error.message}`);
  if (r.status !== 0) fail(`cargo ${BRIDGE_BUILD.join(" ")} exited ${r.status}`);
}

// Runs one time zone's child and resolves to {status, stdout, stderr}.
function runChild(args, tz) {
  return new Promise((resolveChild) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, TZ: tz }, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => err.push(Buffer.from(String(e))));
    child.on("close", (status) =>
      resolveChild({ status, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") })
    );
  });
}

async function parent(opts) {
  if (opts.build) buildBridges();
  const results = [];
  const started = performance.now();
  // The three time zones run in parallel (separate processes, no shared state).
  const runs = await Promise.all(
    TIME_ZONES.map((tz) => {
      const args = [SCRIPT, "--child", "--bridges", opts.bridges, "--seed", String(opts.seed), "--random", String(opts.random)];
      if (opts.wasm) args.push("--wasm", opts.wasm);
      if (opts.loader !== DEFAULT_LOADER) args.push("--loader", opts.loader);
      return runChild(args, tz);
    })
  );
  for (const [i, tz] of TIME_ZONES.entries()) {
    const r = runs[i];
    const text = r.stdout.trim();
    if (r.status !== 0 && !text.startsWith("{")) fail(`child (TZ=${tz}) failed:\n${r.stderr}`);
    const summary = JSON.parse(text);
    results.push(summary);
    const c = summary.cases;
    console.log(
      `TZ=${tz.padEnd(16)} ${c.total} cases (date ${c.date}, percent ${c.percentApi} incl. ${c.percentNonFinite} non-finite, ` +
        `formatDecimal ${c.formatDecimal} (${c.formatDecimalViaApi} also via API/WASM), extras ${c.extras}; ${c.apiTotal} through API/WASM): native/wasm mismatches ${summary.nativeMismatch}, ` +
        `problems ${summary.problems.length}, digest ${summary.digest.slice(0, 16)}`
    );
    const rnd = summary.random;
    if (rnd.count > 0) {
      console.log(
        `  random: seed ${rnd.seed}, ${rnd.count} requests over ${rnd.ops} ops + unknown ops (min ${rnd.minPerOp} per op; ` +
          `${rnd.invalidUtf8} invalid UTF-8, ${rnd.viaBytes} via the byte path, ${(rnd.answerBytes / 1e6).toFixed(1)} MB of answers): mismatches ${rnd.mismatches}, ` +
          `digest ${rnd.digest.slice(0, 16)}, time generate ${rnd.ms.generate} ms, native ${rnd.ms.native} ms, wasm ${rnd.ms.wasm} ms`
      );
      console.log(`  random kinds ${JSON.stringify(rnd.kinds)}`);
      console.log(`  random answers ${JSON.stringify(rnd.codes)}`);
    }
    for (const p of summary.problems) console.log("  - " + p);
  }
  const first = results[0];
  let ok = results.every((r) => r.problems.length === 0 && r.nativeMismatch === 0 && r.random.mismatches === 0);
  if (!results.every((r) => r.digest === first.digest && r.random.digest === first.random.digest)) {
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
  console.log(`time zones checked in parallel in ${((performance.now() - started) / 1000).toFixed(1)} s`);
  console.log(ok ? "check-wasm: OK, native and WASM are byte-identical in every time zone" : "check-wasm: FAILED");
  process.exit(ok ? 0 : 1);
}

const opts = parseArgs(process.argv.slice(2));
if (opts.child) await child(opts);
else await parent(opts);
