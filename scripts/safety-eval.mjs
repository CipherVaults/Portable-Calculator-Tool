#!/usr/bin/env node
// safety-eval (plan B15). Slice A (parity) is scripts/check-wasm.mjs; this
// script runs slices B, C and D. Slice E (the accessibility audit) is M9.
//
// Slices B and C run the real web sources in a mini-DOM
// (scripts/lib/mini-dom.mjs: a small DOM, a fake IndexedDB, localStorage
// and a BroadcastChannel hub shared by several windows) with the real
// engine.wasm, through scripts/lib/eval-shell.mjs:
//   B.*          the shell under both adapters (web: WASM + IndexedDB;
//                desktop: a fake Tauri bridge): the closed route list, the
//                last route restored, drawer and bottom sheet as modals
//                (inert background, focus trap, Esc, focus return), the
//                phone bottom bar (☰, quick switch and pane buttons moved
//                there below 760 px and back from 760 px, kept modals and
//                focus across the crossing, hidden while a keyboard field
//                has focus, the quick switch back), pinned
//                and docked layouts when wide, Alt+1..6 and Ctrl+H, the
//                theme switch and its pre-paint mirror, System following
//                the OS, pseudo-locales, the i18n units and catalogs, and
//                BroadcastChannel sync between two windows
//   C.*          the document store's durability paths: canonical round
//                trips, corrupt = backup first then read-only, newest 3
//                backups, newer = read-only without a backup,
//                request_too_large = read-only and never corrupt,
//                unreadable and Retry, engine down, quota, Start fresh, no
//                IndexedDB = memory + banner, the banners in the UI, and the
//                rescue view reading without creating the database
//   B.date-*     the Date tool (scripts/lib/eval-date.mjs, ported from Date
//                Calculator v1.2.0): the six cards' live results, an IPC
//                race, the clickable calendars (click, keyboard with one
//                tab stop, out-of-range days, the view following a click),
//                the Business Days start/end pick, the card layout
//                (collapse, keyboard and pointer reorder with the touch
//                threshold, the Move menu, Reset), the calendar settings,
//                the history hook and the desktop adapter
//   C.countdowns-* the countdown list in the "countdowns" document: launch
//                restore ("restored", then counting down), finished while
//                closed (finishedSeenAtMs written once, only when visible),
//                no write on a tick, input or page hide, the cap of 20 and
//                Delete, a newer document never written, another tab's
//                change adopted without writing
//   B.percent-*  the Percentage tool (scripts/lib/eval-percent.mjs, PCT v2.3.0
//                behaviour): the eight cards' live results, formulas and
//                result lines, their parity with the engine's label,
//                liveResult and copyText, no markup ever taken from the
//                engine's "<br>" labels, errors and out of range, swap, tip
//                presets and people, tax mode, paste cleaning, an IPC race,
//                the history hook, the session model, the layout and Reset,
//                and the desktop adapter
//   C.percent-*  settings.percent: the layout a launch restores (without a
//                write), and a read-only settings document never written
//   B/C.mutant.* each important rule broken by a one-line mutant that the
//                same test must catch
// Slice D proves that each static rule actually fires, so a passing build
// means something:
//   D.clean.*    the real tree passes every rule (web sources, the pre-paint
//                script, the service-worker template, styles, template,
//                every Rust file, the unsafe locations, catalog usage, AA
//                contrast of every theme).
//   D.mutant.*   each rule refuses a minimal violating input, including the
//                cases that slipped through the old comment strippers
//                (`x = "a//"; el.innerHTML = y;` in JS, `"http://x"; unsafe {`
//                in Rust), a panicking call (unwrap, expect, panic! and the
//                like) in engine code above its tests, physical left/right
//                in layout CSS, catalog
//                markup, placeholders, plurals and unused keys
//                (check-i18n), contrast and token sets (check-web) and the
//                CSP pinning of the built pages (check-web).
//   D.e2e.*      the real scripts refuse mutants end to end: build-web on a
//                mutant web tree (sink, colour, physical side, catalog
//                markup, pre-paint script) and on an engine with a local
//                path, check-wasm on that engine, check-wasm's random
//                native-vs-WASM diff on a loader mutant (skipped when the
//                engine or the release api_bridge is not built),
//                check-unsafe on a mutant Rust tree (incl. percent-core
//                with its pre-M2c expect calls back). All under
//                target/safety-eval/; dist/ is never touched.
//   D.dist.*     when dist/ exists: no built file (and not the engine inside
//                the single file) contains a local path of this machine, the
//                built JS passes the script rules, every inline block is
//                pinned by its page's CSP, and sw.js caches exactly this
//                build.
//
//   node scripts/safety-eval.mjs [--json <path>]
//
// Exit 0 only when every check passes (B/C without an engine and D.dist
// without dist/ are reported as skipped).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { CARGO_HOME, ENGINE_WASM, ROOT, findLocalPath } from "./lib/local-paths.mjs";
import { enginePanicProblems, forbidRootProblems, isEngineSource, rustSourceProblems, wasmRootProblems } from "./lib/rust-hygiene.mjs";
import { JS_BANS, PHYSICAL_SIDES, lineEndingProblems, scriptProblems, styleProblems, templateProblems, TOKENS_FILE } from "./lib/web-hygiene.mjs";
import { runShellSlices } from "./lib/eval-shell.mjs";
import { catalogProblems, loadModules, usageProblems } from "./check-i18n.mjs";
import { cspProblems, themeProblems } from "./check-web.mjs";

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
const webScripts = [...manifest.scripts.filter((s) => s !== "@build"), manifest.prepaint, manifest.serviceWorker];

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
  ["closing-style-tag", '.x::after { content: "</style>"; }'],
  ["physical-margin-left", ".x { margin-left: 1rem; }"],
  ["physical-padding-right", ".x{padding-right:0}"],
  ["physical-border-left-color", ".x { border-left-color: var(--border); }"],
  ["physical-left-offset", ".x { position: fixed; left: 0; }"],
  ["physical-right-offset", ".x { right : 0; }"],
  ["physical-corner-radius", ".x { border-top-left-radius: 0; }"],
  ["physical-text-align", ".x { text-align: left; }"],
  ["physical-float", ".x { float: right; }"],
  ["physical-scroll-margin", ".x { scroll-margin-left: 0; }"],
  ["physical-ok-without-reason", ".x { left: 0; } /* physical-ok: */"]
];
for (const [name, line] of CSS_MUTANTS) {
  const problems = styleProblems("styles/components.css", componentsCss + "\n" + line + "\n");
  check(`D.mutant.css.${name}`, problems.length > 0, problems[0] || `not refused: ${line}`);
}
{
  const tokens = read(join(WEB, TOKENS_FILE));
  check("D.control.css.tokens-may-hold-colours", styleProblems(TOKENS_FILE, tokens + "\n:root { --x: #fff; }\n").length === 0);
  const logical =
    ".x { margin-inline-start: 1rem; inset-inline-end: 0; text-align: start; border-start-start-radius: 0; }\n.y { inset: 0; }\n.z { left: 0; } /* physical-ok: a test of the opt-out */";
  const logicalProblems = styleProblems("styles/components.css", logical);
  check("D.control.css.logical-properties-pass", logicalProblems.length === 0, logicalProblems.join("; "));
  const unproven = PHYSICAL_SIDES.filter(([re]) => !CSS_MUTANTS.some(([, line]) => re.test(line))).map(([, what]) => what);
  check("D.mutant.css.every-physical-rule-has-a-mutant", unproven.length === 0, unproven.join(", ") || `${PHYSICAL_SIDES.length} rules`);
}

// check-i18n's catalog rules, each on a minimal mutant: a German catalog
// copied from en.json, then broken one way.
{
  const en = JSON.parse(read(join(WEB, "i18n/en.json")));
  const P = loadModules(WEB);
  const de = () => ({ ...JSON.parse(JSON.stringify(en)), _meta: { language: "Deutsch", dir: "ltr", reviewed: false } });
  check("D.control.i18n.copy-of-en-passes", catalogProblems({ en, de: de() }, P.i18n.categories).length === 0);
  const I18N_MUTANTS = [
    ["markup-tag", (c) => (c["app.title"] = "Portable <b>Calculator</b>")],
    ["markup-entity", (c) => (c["app.title"] = "Portable &amp; Calculator")],
    ["control-character", (c) => (c["app.title"] = "Portable\u0007")],
    ["missing-key", (c) => delete c["route.date"]],
    ["extra-key", (c) => (c["route.nope"] = "Nope")],
    ["placeholder-renamed", (c) => (c["app.footer"] = "Portable Calculator Tool v{versio}")],
    ["placeholder-dropped", (c) => (c["app.footer"] = "Portable Calculator Tool")],
    ["plural-category-missing", (c) => (c["boot.passed"] = { other: "{count} Prüfungen" })],
    ["plural-category-extra", (c) => (c["boot.passed"] = { one: "{count}", few: "{count}", other: "{count}" })],
    ["plural-without-count", (c) => (c["boot.passed"] = { one: "eine", other: "viele" })],
    ["meta-missing", (c) => delete c._meta]
  ];
  for (const [name, mutate] of I18N_MUTANTS) {
    const cat = de();
    mutate(cat);
    const problems = catalogProblems({ en, de: cat }, P.i18n.categories);
    check(`D.mutant.i18n.${name}`, problems.length > 0, problems[0] || "not refused");
  }
  const sources = [...walk(join(WEB, "src"), (n) => n.endsWith(".js"))].map((p) => read(p));
  const usage = usageProblems(en, sources);
  check("D.clean.i18n-usage", usage.length === 0, usage.join("; ") || `${Object.keys(en).length - 1} keys, all used`);
  const unused = usageProblems({ ...en, "settings.neverUsed": "x" }, sources);
  check("D.mutant.i18n.unused-key", unused.some((p) => /unused key settings\.neverUsed/.test(p)), unused[0] || "not refused");
  const unknown = usageProblems(en, [...sources, 't("settings.noSuchKey")']);
  check("D.mutant.i18n.call-to-a-missing-key", unknown.some((p) => /noSuchKey/.test(p)), unknown[0] || "not refused");
}

// check-web: the token sets and AA contrast of every theme.
{
  const tokens = read(join(WEB, TOKENS_FILE));
  const clean = themeProblems(tokens);
  check("D.clean.themes-aa-contrast", clean.problems.length === 0, clean.problems.join("; ") || `${clean.rows.length} pairs`);
  const daylight = tokens.indexOf('[data-theme="daylight"]');
  const retro = tokens.indexOf('[data-theme="retro"]');
  const inBlock = (at, from, to) => tokens.slice(0, at) + tokens.slice(at).replace(from, to);
  const THEME_MUTANTS = [
    ["daylight-muted-too-light", inBlock(daylight, "--muted: #5D6475;", "--muted: #9AA0AC;")],
    ["terminal-focus-ring-too-dim", tokens.replace("--focus-ring: var(--gold);", "--focus-ring: #30333b;")],
    ["retro-bar-gradient-end-as-first-planned", inBlock(retro, "--bar-bg-end: #0f78bd;", "--bar-bg-end: #1084D0;")],
    ["retro-selected-focus-ring-black-on-navy", inBlock(retro, "--focus-ring-selected: #FFFFFF;", "--focus-ring-selected: #000000;")],
    ["retro-token-missing", inBlock(retro, "  --selected-text: #FFFFFF;\n", "")],
    ["theme-block-missing", tokens.replace('[data-theme="retro"] {', '[data-theme="retro-old"] {')]
  ];
  for (const [name, text] of THEME_MUTANTS) {
    const r = text === tokens ? { problems: [] } : themeProblems(text);
    check(`D.mutant.web.${name}`, text !== tokens && r.problems.length > 0, r.problems[0] || "not refused (or the mutation site is gone)");
  }
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
// Engines never panic: each panicking call above the tests is refused; the
// same call inside #[cfg(test)], in a test file or a non-engine crate is not.
const percentRs = read(join(ROOT, "crates/percent-core/src/lib.rs"));
const testsAt = percentRs.indexOf("#[cfg(test)]");
check("D.control.rust.panic-engines-clean",
  testsAt > 0 && enginePanicProblems("crates/percent-core/src/lib.rs", percentRs).length === 0 &&
  isEngineSource("crates/percent-core/src/lib.rs") && isEngineSource("crates/pcalc-api/src/percent.rs") &&
  !isEngineSource("crates/pcalc-store/src/docs.rs") && !isEngineSource("crates/percent-core/tests/golden_parity.rs"));
const PANIC_MUTANTS = [
  ["unwrap", "fn f(x: Option<u8>) -> u8 { x.unwrap() }"],
  ["expect", 'fn f(s: &str) -> i32 { s.parse().expect("exponent") }'],
  ["panic", 'fn f() { panic!("no") }'],
  ["unreachable", "fn f() { unreachable!() }"],
  ["todo", "fn f() { todo!() }"],
  ["unimplemented", "fn f() { unimplemented!() }"]
];
for (const [name, line] of PANIC_MUTANTS) {
  const above = percentRs.slice(0, testsAt) + line + "\n" + percentRs.slice(testsAt);
  const below = percentRs + "\n" + line + "\n";
  const problems = enginePanicProblems("crates/percent-core/src/lib.rs", above);
  const testOnly = enginePanicProblems("crates/percent-core/src/lib.rs", below);
  check(`D.mutant.rust.panic-${name}`, problems.length > 0 && testOnly.length === 0, problems[0] || `not refused: ${line}`);
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
  // The random native-vs-WASM diff catches a loader that answers differently
  // from native: this mutant cuts every byte-path request at 64 KiB, so the
  // cap+1 edges stop being request_too_large on the WASM side only.
  const bridge = join(ROOT, "target", "release", "examples", "api_bridge" + (process.platform === "win32" ? ".exe" : ""));
  if (!existsSync(bridge) || !existsSync(ENGINE_WASM)) {
    skip("D.e2e.check-wasm-random-diff-catches-loader-mutant", "needs target/engine/engine.wasm and the release api_bridge (run check-wasm first)");
  } else {
    const loader = read(join(WEB, "src/core/engine-web.js"));
    const mutant = loader.replace("return invoke(opBytes, reqBytes);", "return invoke(opBytes, reqBytes.subarray(0, 65536));");
    const mutantPath = join(WORK, "engine-web-mutant.js");
    writeFileSync(mutantPath, mutant);
    const r = node(["scripts/check-wasm.mjs", "--no-build", "--wasm", ENGINE_WASM, "--loader", mutantPath, "--random", "2000"]);
    check(
      "D.e2e.check-wasm-random-diff-catches-loader-mutant",
      mutant !== loader && r.status === 1 && /random #\d+ \(cap-edge[^)]*\) native\/wasm differ/.test(r.out),
      (r.out.match(/random: [^\n]*mismatches \d+/) || [lastLine(r.out)])[0]
    );
  }
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
  writeFileSync(join(webCopy, "styles/components.css"), componentsCss);
  const shellCss = read(join(WEB, "styles/shell.css"));
  writeFileSync(join(webCopy, "styles/shell.css"), shellCss.replace("inset-inline-start: 0;", "left: 0;"));
  const r3 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-mutant")]);
  check("D.e2e.build-web-refuses-physical-side", shellCss.includes("inset-inline-start: 0;") && r3.status === 1 && /physical side/.test(r3.out), lastLine(r3.out));
  writeFileSync(join(webCopy, "styles/shell.css"), shellCss);
  const en = read(join(WEB, "i18n/en.json"));
  writeFileSync(join(webCopy, "i18n/en.json"), en.replace('"Standard"', '"<i>Standard</i>"'));
  const r4 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-mutant")]);
  check("D.e2e.build-web-refuses-catalog-markup", r4.status === 1 && /markup/.test(r4.out), lastLine(r4.out));
  writeFileSync(join(webCopy, "i18n/en.json"), en);
  const prepaint = read(join(WEB, manifest.prepaint));
  writeFileSync(join(webCopy, manifest.prepaint), prepaint + "\ndocument.body.innerHTML = '';\n");
  const r5 = node(["scripts/build-web.mjs", "--desktop-only", "--web", webCopy, "--out", join(WORK, "dist-web-mutant")]);
  check("D.e2e.build-web-checks-the-prepaint-script", r5.status === 1 && /innerHTML/.test(r5.out), lastLine(r5.out));
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
  writeFileSync(join(rustCopy, "crates/calc-core/src/lib.rs"), calcCore);
  // percent-core's js_exponential as it was before M2c: two expect calls.
  const OLD_EXP = [
    "    let (mantissa, exp) = s.split_once('e').expect(\"scientific notation\");",
    "    let exp_num: i32 = exp.parse().expect(\"exponent\");",
    "    let exp_sign = if exp_num >= 0 { '+' } else { '-' };",
    "    format!(\"{sign}{mantissa}e{exp_sign}{}\", exp_num.unsigned_abs())",
    "}"
  ].join("\n");
  const oldExp = percentRs.replace(/    match s\.split_once\('e'\) \{[\s\S]*?\n    \}\n\}/, () => OLD_EXP);
  writeFileSync(join(rustCopy, "crates/percent-core/src/lib.rs"), oldExp);
  const r3 = node(["scripts/check-unsafe.mjs", "--root", rustCopy]);
  const refused = r3.out.split("\n").filter((l) => /percent-core\/src\/lib\.rs:\d+: panicking call/.test(l)).length;
  check("D.e2e.check-unsafe-refuses-engine-expect", oldExp !== percentRs && r3.status === 1 && refused === 2, `${refused} refused; ${lastLine(r3.out)}`);
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

  const pages = [];
  const cspFound = [];
  for (const [part, inlineAllowed] of [[info.desktop, false], [info.web, true], [info.single, true]]) {
    if (!part || !part.html) continue;
    pages.push(part.html.file);
    cspFound.push(...cspProblems(part.html.file, read(join(DIST, part.html.file)), { inlineAllowed }));
  }
  check("D.dist.csp-pins-every-inline-block", cspFound.length === 0, cspFound.join("; ") || pages.join(", "));
  if (info.web && info.web.sw) {
    const html = read(join(DIST, info.web.html.file));
    const CSP_MUTANTS = [
      ["stale-hash", html.replace(/'sha256-[^']+'/, "'sha256-AAAA'")],
      ["unpinned-inline-script", html.replace("</head>", "<script>void 0</script>\n</head>")],
      ["frame-ancestors", html.replace("form-action 'none'", "form-action 'none'; frame-ancestors 'none'")]
    ];
    for (const [name, text] of CSP_MUTANTS) {
      const found = text === html ? [] : cspProblems(info.web.html.file, text, { inlineAllowed: true });
      check(`D.mutant.web.csp-${name}`, found.length > 0, found[0] || "not refused (or the mutation site is gone)");
    }
    const sw = read(join(DIST, info.web.sw.file));
    const m = /const BUILD = Object\.freeze\((\{.*?\})\);/.exec(sw);
    const build = m ? JSON.parse(m[1]) : null;
    const files = [info.web.html, info.web.js, info.web.css, info.web.wasm, info.web.manifest, ...info.web.icons].map((f) => f.file.replace(/^web\//, "")).sort();
    const ok =
      build !== null &&
      build.cacheName === `pcalc-v${info.appVersion}-${info.web.buildHash}` &&
      JSON.stringify([...build.assets].sort()) === JSON.stringify(files) &&
      !build.assets.includes("sw.js");
    check("D.dist.service-worker-caches-exactly-this-build", ok, build ? `${build.cacheName}, ${build.assets.length} files` : "no BUILD block in sw.js");
  }
}

// ---------------------------------------------------------------------------
// Slices B and C: the shell and the stores in the mini-DOM
// ---------------------------------------------------------------------------

await runShellSlices({ web: WEB, engine: existsSync(ENGINE_WASM) ? readFileSync(ENGINE_WASM) : null, check, skip });

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const count = (s) => checks.filter((c) => c.status === s).length;
const perSlice = (p) => checks.filter((c) => c.id.startsWith(p + ".") && c.status === "pass").length;
const summary = {
  slices: "B C D",
  passed: count("pass"),
  failed: count("fail"),
  skipped: count("skip"),
  bySlice: { B: perSlice("B"), C: perSlice("C"), D: perSlice("D") },
  checks
};
for (const c of checks) if (c.status !== "pass") console.log(`${c.status.toUpperCase()} ${c.id}${c.detail ? ": " + c.detail : ""}`);
const jsonAt = process.argv.indexOf("--json");
if (jsonAt >= 0) {
  const out = resolve(process.argv[jsonAt + 1] || "");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
}
console.log(
  `safety-eval slices B, C, D: ${summary.passed} passed (B ${summary.bySlice.B}, C ${summary.bySlice.C}, D ${summary.bySlice.D}), ${summary.failed} failed, ${summary.skipped} skipped` +
    (summary.failed === 0 ? " (OK)" : " (FAILED)")
);
process.exit(summary.failed === 0 ? 0 : 1);
