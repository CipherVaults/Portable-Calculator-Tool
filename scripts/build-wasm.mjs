#!/usr/bin/env node
// Builds engine.wasm reproducibly (plan B3, B14):
//
//   cargo build -p pcalc-wasm --target wasm32-unknown-unknown --profile wasm --locked
//
// with the machine-specific source paths that rustc embeds in panic
// locations remapped (the cargo home -> /cargo, this repository -> /src).
// Without the remap the module carries the builder's home directory (and so
// the user name), and two machines produce different bytes. Stable Cargo has
// no `trim-paths` yet, so the remap goes through the target-specific
// CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS (host build scripts are not
// affected).
//
// The verified module is copied to target/engine/engine.wasm, the only file
// build-web.mjs and check-wasm.mjs use by default. Cargo's own output path is
// never shipped: a bare `cargo build` writes there too, unremapped. The copy
// is removed first and written only after the leak scan (and, with
// --check-twice, the reproducibility check) passed.
//
//   node scripts/build-wasm.mjs [--check-twice]
//
// --check-twice builds, records the SHA-256, then builds again from scratch
// in a separate, freshly emptied target directory (target/wasm-repro, so no
// dependency artefact is reused) and fails unless both modules are
// byte-identical.
//
// Windows: run from PowerShell (Git Bash's /usr/bin/link shadows the MSVC
// linker that the host build scripts need).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { CARGO_HOME, ENGINE_WASM, ROOT, findLocalPath } from "./lib/local-paths.mjs";

const TARGET = join(ROOT, "target");
const REPRO_TARGET = join(TARGET, "wasm-repro");
const wasmIn = (targetDir) => join(targetDir, "wasm32-unknown-unknown", "wasm", "pcalc_wasm.wasm");
const WASM = wasmIn(TARGET);

function cargo(args, env) {
  const r = spawnSync("cargo", args, { cwd: ROOT, env, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function buildOnce(targetDir) {
  const remaps = [`--remap-path-prefix=${CARGO_HOME}=/cargo`, `--remap-path-prefix=${ROOT}=/src`];
  const key = "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS";
  const existing = process.env[key] ? process.env[key].split(" ").filter(Boolean) : [];
  const env = { ...process.env, [key]: [...existing, ...remaps].join(" "), CARGO_TARGET_DIR: targetDir };
  if (/\s/.test(CARGO_HOME) || /\s/.test(ROOT)) {
    // RUSTFLAGS is space-separated; use the encoded form for paths with spaces.
    delete env[key];
    env.CARGO_ENCODED_RUSTFLAGS = [...existing, ...remaps].join("\x1f");
  }
  cargo(["build", "-p", "pcalc-wasm", "--target", "wasm32-unknown-unknown", "--profile", "wasm", "--locked"], env);
  const wasmPath = wasmIn(targetDir);
  const bytes = readFileSync(wasmPath);
  const leak = findLocalPath(bytes);
  if (leak) {
    console.error(`build-wasm: ${wasmPath} still contains the local path ${leak}`);
    process.exit(1);
  }
  return { sha: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

const twice = process.argv.includes("--check-twice");
rmSync(ENGINE_WASM, { force: true });
const first = buildOnce(TARGET);
console.log(`build-wasm: ${WASM} ${first.size} bytes sha256 ${first.sha}`);
if (twice) {
  if (!REPRO_TARGET.startsWith(TARGET)) throw new Error("repro target outside target/");
  rmSync(REPRO_TARGET, { recursive: true, force: true });
  const second = buildOnce(REPRO_TARGET);
  if (second.sha !== first.sha) {
    console.error(`build-wasm: builds differ: ${first.sha} vs ${second.sha}`);
    process.exit(1);
  }
  console.log(`build-wasm: an independent from-scratch build in ${REPRO_TARGET} is byte-identical`);
}
mkdirSync(dirname(ENGINE_WASM), { recursive: true });
copyFileSync(WASM, ENGINE_WASM);
const copied = createHash("sha256").update(readFileSync(ENGINE_WASM)).digest("hex");
if (copied !== first.sha) {
  console.error(`build-wasm: ${ENGINE_WASM} does not match the verified build`);
  process.exit(1);
}
console.log(`build-wasm: wrote ${ENGINE_WASM} (the engine build-web.mjs ships)`);
