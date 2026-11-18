#!/usr/bin/env node
// safety-eval (plan B15). M0 carries slice D, static hygiene with mutant
// proofs; slice A (parity) is scripts/check-wasm.mjs, and slices B, C and E
// arrive with the UI, storage and accessibility milestones.
//
// Slice D proves that each static rule actually fires, so a passing build
// means something:
//   D.clean.*    the real tree passes every rule (web sources, template,
//                styles, every Rust file, the unsafe locations).
//   D.mutant.*   each rule refuses a minimal violating input, including the
//                cases that slipped through the old comment strippers
//                (`x = "a//"; el.innerHTML = y;` in JS, `"http://x"; unsafe {`
//                in Rust).
//   D.e2e.*      the real scripts refuse mutants end to end: build-web on a
//                mutant web tree and on an engine with a local path,
//                check-wasm on that engine, check-unsafe on a mutant Rust
//                tree. All under target/safety-eval/; dist/ is never touched.
//   D.dist.*     when dist/ exists: no built file (and not the engine inside
//                the single file) contains a local path of this machine, and
//                the built JS passes the script rules.
//
//   node scripts/safety-eval.mjs [--json <path>]
//
// Exit 0 only when every check passes (a D.dist check with no dist/ is
// reported as skipped).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { CARGO_HOME, ROOT, findLocalPath } from "./lib/local-paths.mjs";
import { forbidRootProblems, rustSourceProblems, wasmRootProblems } from "./lib/rust-hygiene.mjs";
import { JS_BANS, lineEndingProblems, scriptProblems, styleProblems, templateProblems, TOKENS_FILE } from "./lib/web-hygiene.mjs";

const WEB = join(ROOT, "web");
const DIST = join(ROOT, "dist");
const WORK = join(ROOT, "target", "safety-eval");
const WASM_ROOT = "crates/pcalc-wasm/src/lib.rs";

const checks = [];
function check(id, ok, detail = "") {
  checks.push({ id, status: ok ? "pass" : "fail", detail });
}
function skip(id, detail) {
  checks.push({ id, status: "skip", detail });
}

const read = (path) => readFileSync(path, "utf8");
const manifest = JSON.parse(read(join(WEB, "build-manifest.json")));
const webScripts = manifest.scripts.filter((s) => s !== "@build");

// ---------------------------------------------------------------------------
// D.clean: the real tree passes
// ---------------------------------------------------------------------------

function* walk(dir, accept) {
  for (const name of readdirSync(dir)) {
    if (name === "target" || name === "gen" || name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path, accept);
    else if (accept(name)) yield path;
  }
}

{
  const problems = [];
  for (const rel of webScripts) {
    const text = read(join(WEB, rel));
    problems.push(...lineEndingProblems(rel, text), ...scriptProblems(rel, text));
  }
  check("D.clean.web-scripts", problems.length === 0, problems.join("; ") || `${webScripts.length} scripts`);
}
{
  const problems = [];
  for (const rel of manifest.styles) {
    const text = read(join(WEB, rel));
    problems.push(...lineEndingProblems(rel, text), ...styleProblems(rel, text));
  }
  const template = read(join(WEB, "index.template.html"));
  problems.push(...templateProblems("index.template.html", template));
  check("D.clean.web-styles-template", problems.length === 0, problems.join("; ") || `${manifest.styles.length} styles + template`);
}
const rustFiles = [...walk(join(ROOT, "crates"), (n) => n.endsWith(".rs")), ...walk(join(ROOT, "src-tauri"), (n) => n.endsWith(".rs"))].map((p) =>
  relative(ROOT, p).split("\\").join("/")
);
{
  const problems = [];
  for (const rel of rustFiles) problems.push(...rustSourceProblems(rel, read(join(ROOT, rel)), { allowUnsafeAttr: rel === WASM_ROOT }));
  problems.push(...wasmRootProblems(WASM_ROOT, read(join(ROOT, WASM_ROOT))).problems);
  check("D.clean.rust", problems.length === 0, problems.join("; ") || `${rustFiles.length} Rust files`);
}

// ---------------------------------------------------------------------------
// D.mutant: each rule fires
// ---------------------------------------------------------------------------

const domJs = read(join(WEB, "src/core/dom.js"));
const JS_MUTANTS = [
  ["innerHTML", "el.innerHTML = y;"],
  ["innerHTML-after-string-with-slashes", 'const x = "a//"; el.innerHTML = y;'],
  ["innerHTML-after-url-string", "const u = 'https://example.invalid/'; el.innerHTML = y;"],
  ["outerHTML-after-template-with-slashes", "const t = `//`; el.outerHTML = y;"],
  ["sink-in-line-comment", "// el.innerHTML = y;"],
  ["sink-after-block-comment", '/* ok */ el.insertAdjacentHTML("beforeend", y);'],
  ["sink-in-block-comment", "/* el.outerHTML = y; */"],
  ["document.write", "document.write(y);"],
  ["document.writeln-spaced", "document . writeln(y);"],
  ["eval", 'eval("1");'],
  ["window.eval", "window.eval(y);"],
  ["indirect-eval", "(0, eval)(y);"],
  ["new-Function", 'new Function("return 1");'],
  ["Function-call", 'const f = Function("return 1");'],
  ["string-setTimeout", 'setTimeout("y()", 1);'],
  ["style-property", 'el.style.color = "red";'],
  ["style-spaced", "el . style . display = y;"],
  ["style-bracket", 'el["style"].display = y;'],
  ["setAttribute-style", 'el.setAttribute("style", y);'],
  ["setAttribute-style-spaced", "el.setAttribute ( 'style', y);"],
  ["cssText", "el.cssText = y;"],
  ["closing-script-tag", 'const s = "</script>";']
];
for (const [name, line] of JS_MUTANTS) {
  const problems = scriptProblems("src/core/dom.js", domJs + "\n" + line + "\n");
  check(`D.mutant.js.${name}`, problems.length > 0, problems[0] || `not refused: ${line}`);
}
check("D.mutant.js.cr", lineEndingProblems("x.js", "a;\r\nb;\n").length > 0);
{
  // Every ban has at least one mutant, so no rule can be added unproven.
  const unproven = JS_BANS.filter(([re]) => !JS_MUTANTS.some(([, line]) => re.test(line))).map(([, name]) => name);
  check("D.mutant.js.every-ban-has-a-mutant", unproven.length === 0, unproven.join(", ") || `${JS_BANS.length} bans`);
}

const componentsCss = read(join(WEB, "styles/components.css"));
const CSS_MUTANTS = [
  ["hex3", ".x { color: #fff; }"],
  ["hex6-upper", ".x { color: #A1B2C3; }"],
  ["hex8", ".x { color: #11223344; }"],
  ["rgb", ".x { color: rgb(1 2 3); }"],
  ["rgba", ".x { color: rgba(1, 2, 3, 0.5); }"],
  ["hsl", ".x { color: hsl(1 2% 3%); }"],
  ["oklch", ".x { color: oklch(50% 0.1 30); }"],
  ["color-fn", ".x { color: color(srgb 1 0 0); }"],
  ["in-comment", "/* #fff */"],
  ["closing-style-tag", '.x::after { content: "</style>"; }']
];
for (const [name, line] of CSS_MUTANTS) {
  const problems = styleProblems("styles/components.css", componentsCss + "\n" + line + "\n");
  check(`D.mutant.css.${name}`, problems.length > 0, problems[0] || `not refused: ${line}`);
}
{
  const tokens = read(join(WEB, TOKENS_FILE));
  check("D.control.css.tokens-may-hold-colours", styleProblems(TOKENS_FILE, tokens + "\n:root { --x: #fff; }\n").length === 0);
}

const template = read(join(WEB, "index.template.html"));
const TEMPLATE_MUTANTS = [
  ["style-attribute", '<main id="app" style="color: red"></main>'],
  ["handler-attribute", '<main id="app" onclick="x()"></main>'],
  ["inline-script", "<script>x()</script>"],
  ["inline-style", "<style>.x{}</style>"],
  ["colour", '<meta name="theme-color" content="#000000">']
];
for (const [name, line] of TEMPLATE_MUTANTS) {
  const problems = templateProblems("index.template.html", template.replace("</body>", line + "\n</body>"));
  check(`D.mutant.template.${name}`, problems.length > 0, problems[0] || `not refused: ${line}`);
}

const calcCore = read(join(ROOT, "crates/calc-core/src/lib.rs"));
check(
  "D.mutant.rust.forbid-root-missing",
  forbidRootProblems("crates/calc-core/src/lib.rs", calcCore.replace(/^#!\[forbid\(unsafe_code\)\]\s*$/m, "")).length > 0
);
check(
  "D.mutant.rust.forbid-root-commented-out",
  forbidRootProblems("x.rs", calcCore.replace(/^#!\[forbid\(unsafe_code\)\]\s*$/m, "// #![forbid(unsafe_code)]")).length > 0
);
const wasmRoot = read(join(ROOT, WASM_ROOT));
const WASM_MUTANTS = [
  ["deny-missing", wasmRoot.replace("#![deny(unsafe_code)]\n", "")],
  ["allow-not-on-export", wasmRoot.replace("#[allow(unsafe_code)]\n#[unsafe(no_mangle)]\npub extern \"C\" fn pc_abi", "#[allow(unsafe_code)]\n/// moved\n#[unsafe(no_mangle)]\npub extern \"C\" fn pc_abi")],
  ["fifth-allow", wasmRoot + "\n#[allow(unsafe_code)]\n#[unsafe(no_mangle)]\npub extern \"C\" fn pc_extra() -> u32 { 0 }\n"],
  ["crate-level-allow", wasmRoot.replace("#![deny(unsafe_code)]\n", "#![deny(unsafe_code)]\n#![allow(unsafe_code)]\n")],
  ["expect-attr", wasmRoot + "\n#[expect(unsafe_code)]\nfn x() {}\n"]
];
for (const [name, text] of WASM_MUTANTS) {
  const ok = text !== wasmRoot && wasmRootProblems(WASM_ROOT, text).problems.length > 0;
  check(`D.mutant.rust.wasm-${name}`, ok);
}
const lengthRs = read(join(ROOT, "crates/units-core/src/length.rs"));
const RUST_MUTANTS = [
  ["block", "fn f() { unsafe { g() } }"],
  ["fn", "unsafe fn f() {}"],
  ["impl", "unsafe impl Send for X {}"],
  ["trait", "unsafe trait T {}"],
  ["extern", 'unsafe extern "C" { fn g(); }'],
  ["block-after-url-string", 'fn f() { let u = "http://x"; unsafe { g() } }'],
  ["in-comment", "// unsafe { g() }"],
  ["allow-attr-outside-wasm", "#[allow(unsafe_code)]"],
  ["cfg-attr-allow", "#[cfg_attr(test, allow(unsafe_code))]"]
];
for (const [name, line] of RUST_MUTANTS) {
  const problems = rustSourceProblems("crates/units-core/src/length.rs", lengthRs + "\n" + line + "\n");
  check(`D.mutant.rust.${name}`, problems.length > 0, problems[0] || `not refused: ${line}`);
}

// A minimal valid module: header + one custom section holding `payload`.
function wasmWith(payload) {
  const name = Buffer.from("safety-eval");
  const body = Buffer.concat([Buffer.from([name.length]), name, Buffer.from(payload, "utf8")]);
  const leb = [];
  let n = body.length;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    leb.push(byte);
  } while (n);
  return Buffer.concat([Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0]), Buffer.from(leb), body]);
}
{
  const home = homedir();
  const forms = [
    ["home-backslash", `panicked at ${home}\\.cargo\\registry\\src\\x.rs`],
    ["home-forward-slash", `panicked at ${home.split("\\").join("/")}/.cargo/registry/src/x.rs`],
    ["home-escaped", `${home.split("\\").join("\\\\")}\\\\.cargo`],
    ["home-other-case", `${home.toUpperCase()}/x`],
    ["cargo-home", `${CARGO_HOME}/registry/src/x.rs`],
    ["repo-root", `${ROOT}/crates/pcalc-api/src/lib.rs`]
  ];
  for (const [name, payload] of forms) check(`D.mutant.leak.${name}`, findLocalPath(wasmWith(payload)) !== null);
  check("D.control.leak.remapped-paths-pass", findLocalPath(wasmWith("/cargo/registry/src/x.rs /src/crates/x.rs /rustc/abc/library")) === null);
}

// ---------------------------------------------------------------------------
// D.e2e: the real scripts refuse mutants
// ---------------------------------------------------------------------------

function node(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}
const lastLine = (text) => text.trim().split("\n").pop() || "";

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
{
  const leaky = join(WORK, "leaky.wasm");
  const clean = join(WORK, "clean.wasm");
  writeFileSync(leaky, wasmWith(`panicked at ${CARGO_HOME}\\registry\\src\\x.rs`));
  writeFileSync(clean, wasmWith("/cargo/registry/src/x.rs"));

  const leakOut = join(WORK, "dist-leaky");
  const r1 = node(["scripts/build-web.mjs", "--wasm", leaky, "--out", leakOut]);
  check(
    "D.e2e.build-web-refuses-engine-with-local-path",
    r1.status === 1 && /local path/.test(r1.out) && !existsSync(join(leakOut, "web")) && !existsSync(join(leakOut, "Portable-Calculator-Tool-Mobile.html")),
    lastLine(r1.out)
  );
  const cleanOut = join(WORK, "dist-clean");
  const r2 = node(["scripts/build-web.mjs", "--wasm", clean, "--out", cleanOut]);
  check("D.control.build-web-accepts-clean-engine", r2.status === 0 && existsSync(join(cleanOut, "web", "index.html")), lastLine(r2.out));

  const r3 = node(["scripts/check-wasm.mjs", "--wasm", leaky, "--no-build"]);
  check("D.e2e.check-wasm-refuses-engine-with-local-path", r3.status === 1 && /local path/.test(r3.out), lastLine(r3.out));
}
{
  const webCopy = join(WORK, "web-mutant");
  cpSync(WEB, webCopy, { recursive: true });
  const r0 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-control")]);
  check("D.control.build-web-accepts-web-copy", r0.status === 0, lastLine(r0.out));
  writeFileSync(join(webCopy, "src/core/dom.js"), domJs + '\nconst x = "a//"; document.body.innerHTML = x;\n');
  const r1 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-mutant")]);
  check("D.e2e.build-web-refuses-sink-after-string-with-slashes", r1.status === 1 && /innerHTML/.test(r1.out), lastLine(r1.out));
  writeFileSync(join(webCopy, "src/core/dom.js"), domJs);
  writeFileSync(join(webCopy, "styles/components.css"), componentsCss + "\n.x { color: #fff; }\n");
  const r2 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-mutant")]);
  check("D.e2e.build-web-refuses-colour-literal", r2.status === 1 && /colour literal/.test(r2.out), lastLine(r2.out));
}
{
  const rustCopy = join(WORK, "rust-mutant");
  for (const rel of rustFiles) {
    mkdirSync(dirname(join(rustCopy, rel)), { recursive: true });
    writeFileSync(join(rustCopy, rel), read(join(ROOT, rel)));
  }
  const r0 = node(["scripts/check-unsafe.mjs", "--root", rustCopy]);
  check("D.control.check-unsafe-accepts-copy", r0.status === 0, lastLine(r0.out));
  writeFileSync(join(rustCopy, "crates/units-core/src/length.rs"), lengthRs + '\nfn f() { let u = "http://x"; unsafe { g() } }\n');
  const r1 = node(["scripts/check-unsafe.mjs", "--root", rustCopy]);
  check("D.e2e.check-unsafe-refuses-block-after-url-string", r1.status === 1 && /unsafe code/.test(r1.out), lastLine(r1.out));
  writeFileSync(join(rustCopy, "crates/units-core/src/length.rs"), lengthRs);
  writeFileSync(join(rustCopy, "crates/calc-core/src/lib.rs"), calcCore.replace(/^#!\[forbid\(unsafe_code\)\]\s*$/m, ""));
  const r2 = node(["scripts/check-unsafe.mjs", "--root", rustCopy]);
  check("D.e2e.check-unsafe-refuses-missing-forbid", r2.status === 1 && /missing #!\[forbid/.test(r2.out), lastLine(r2.out));
}
rmSync(WORK, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// D.dist: the built output, when there is one
// ---------------------------------------------------------------------------

if (!existsSync(join(DIST, "build-info.json"))) {
  skip("D.dist.no-local-paths", "no dist/ (run node scripts/build-web.mjs)");
  skip("D.dist.built-js-rules", "no dist/");
} else {
  const leaks = [];
  for (const path of walk(DIST, () => true)) {
    const leak = findLocalPath(readFileSync(path));
    if (leak) leaks.push(relative(DIST, path));
  }
  const single = join(DIST, "Portable-Calculator-Tool-Mobile.html");
  let singleEngine = "no single-file build";
  if (existsSync(single)) {
    const m = /<script type="application\/octet-stream" id="engineWasm">([A-Za-z0-9+/=]+)<\/script>/.exec(read(single));
    if (!m) leaks.push("single file: no engineWasm block");
    else if (findLocalPath(Buffer.from(m[1], "base64"))) leaks.push("single file: embedded engine.wasm");
    else singleEngine = "embedded engine clean";
  }
  check("D.dist.no-local-paths", leaks.length === 0, leaks.join(", ") || singleEngine);

  const info = JSON.parse(read(join(DIST, "build-info.json")));
  const problems = [];
  for (const part of [info.desktop, info.web].filter(Boolean)) {
    if (part.js) problems.push(...scriptProblems(part.js.file, read(join(DIST, part.js.file))));
    if (part.css) problems.push(...styleProblems(part.css.file, read(join(DIST, part.css.file))).filter((p) => !/colour literal/.test(p)));
  }
  check("D.dist.built-js-rules", problems.length === 0, problems.join("; ") || "built JS clean");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const count = (s) => checks.filter((c) => c.status === s).length;
const summary = { slice: "D", passed: count("pass"), failed: count("fail"), skipped: count("skip"), checks };
for (const c of checks) if (c.status !== "pass") console.log(`${c.status.toUpperCase()} ${c.id}${c.detail ? ": " + c.detail : ""}`);
const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0) {
  const out = resolve(process.argv[jsonAt + 1] || "");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
}
console.log(
  `safety-eval slice D: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped` +
    (summary.failed === 0 ? " (OK)" : " (FAILED)")
);
process.exit(summary.failed === 0 ? 0 : 1);
