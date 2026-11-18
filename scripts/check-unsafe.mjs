#!/usr/bin/env node
// The unsafe-location check (plan B1, B3, B14):
// - every crate root except pcalc-wasm has #![forbid(unsafe_code)];
// - pcalc-wasm has #![deny(unsafe_code)], and each #[allow(unsafe_code)] in
//   it sits directly on an #[unsafe(no_mangle)] export attribute;
// - no other Rust line anywhere uses an `unsafe` block, fn, impl, trait or
//   extern block, and no other file allows unsafe_code.
// The rules live in scripts/lib/rust-hygiene.mjs; scripts/safety-eval.mjs
// (slice D) proves each one fires on a violating input.
//
//   node scripts/check-unsafe.mjs [--root <dir inside target/>]
//
// --root checks another copy of the tree (safety-eval's mutants).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { forbidRootProblems, rustSourceProblems, wasmRootProblems } from "./lib/rust-hygiene.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = rootArg(process.argv.slice(2));
const problems = [];

function rootArg(argv) {
  if (argv.length === 0) return REPO;
  const full = argv[0] === "--root" && argv[1] ? resolve(argv[1]) : null;
  if (argv.length !== 2 || !full || !full.startsWith(join(REPO, "target") + sep)) {
    console.error("check-unsafe: usage: check-unsafe.mjs [--root <dir inside target/>]");
    process.exit(2);
  }
  return full;
}

const FORBID_ROOTS = [
  "crates/date-core/src/lib.rs",
  "crates/percent-core/src/lib.rs",
  "crates/calc-num/src/lib.rs",
  "crates/calc-core/src/lib.rs",
  "crates/units-core/src/lib.rs",
  "crates/graph-core/src/lib.rs",
  "crates/pcalc-api/src/lib.rs",
  "crates/pcalc-store/src/lib.rs",
  "src-tauri/src/main.rs"
];
const WASM_ROOT = "crates/pcalc-wasm/src/lib.rs";
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

for (const rel of FORBID_ROOTS) problems.push(...forbidRootProblems(rel, read(rel)));
const wasm = wasmRootProblems(WASM_ROOT, read(WASM_ROOT));
problems.push(...wasm.problems);

function* rustFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "target" || name === "gen" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* rustFiles(path);
    else if (name.endsWith(".rs")) yield path;
  }
}

let files = 0;
for (const top of ["crates", "src-tauri"]) {
  for (const path of rustFiles(join(ROOT, top))) {
    files++;
    const rel = relative(ROOT, path).split("\\").join("/");
    problems.push(...rustSourceProblems(rel, readFileSync(path, "utf8"), { allowUnsafeAttr: rel === WASM_ROOT }));
  }
}

for (const p of problems) console.log("FAIL " + p);
console.log(
  problems.length === 0
    ? `check-unsafe: OK (${files} Rust files; ${FORBID_ROOTS.length} forbid roots; pcalc-wasm has ${wasm.allows} allowed exports)`
    : "check-unsafe: FAILED"
);
process.exit(problems.length === 0 ? 0 : 1);
