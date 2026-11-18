#!/usr/bin/env node
// The unsafe-location check (plan B1, B3, B14):
// - every crate root except pcalc-wasm has #![forbid(unsafe_code)];
// - pcalc-wasm has #![deny(unsafe_code)], and each #[allow(unsafe_code)] in
//   it sits directly on an #[unsafe(no_mangle)] export attribute;
// - no other Rust line anywhere uses an `unsafe` block, fn, impl or trait.
//
//   node scripts/check-unsafe.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

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

for (const rel of FORBID_ROOTS) {
  if (!/^#!\[forbid\(unsafe_code\)\]$/m.test(readFileSync(join(ROOT, rel), "utf8"))) {
    problems.push(`${rel}: missing #![forbid(unsafe_code)]`);
  }
}

const wasm = readFileSync(join(ROOT, WASM_ROOT), "utf8").split("\n");
if (!wasm.includes("#![deny(unsafe_code)]")) problems.push(`${WASM_ROOT}: missing #![deny(unsafe_code)]`);
let allows = 0;
wasm.forEach((line, i) => {
  if (line.trim() === "#[allow(unsafe_code)]") {
    allows++;
    if ((wasm[i + 1] || "").trim() !== "#[unsafe(no_mangle)]") {
      problems.push(`${WASM_ROOT}:${i + 1}: #[allow(unsafe_code)] not directly on #[unsafe(no_mangle)]`);
    }
  }
});
if (allows !== 4) problems.push(`${WASM_ROOT}: expected 4 allowed exports, found ${allows}`);

function* rustFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "target" || name === "gen" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* rustFiles(path);
    else if (name.endsWith(".rs")) yield path;
  }
}

const UNSAFE_USE = /\bunsafe\s*(\{|fn\b|impl\b|trait\b|extern\b)/;
let files = 0;
for (const top of ["crates", "src-tauri"]) {
  for (const path of rustFiles(join(ROOT, top))) {
    files++;
    readFileSync(path, "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (UNSAFE_USE.test(code)) problems.push(`${relative(ROOT, path)}:${i + 1}: unsafe code`);
    });
  }
}

for (const p of problems) console.log("FAIL " + p);
console.log(
  problems.length === 0
    ? `check-unsafe: OK (${files} Rust files; ${FORBID_ROOTS.length} forbid roots; pcalc-wasm has ${allows} allowed exports)`
    : "check-unsafe: FAILED"
);
process.exit(problems.length === 0 ? 0 : 1);
