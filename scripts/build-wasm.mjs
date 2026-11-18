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
import { readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "target");
const REPRO_TARGET = join(TARGET, "wasm-repro");
const wasmIn = (targetDir) => join(targetDir, "wasm32-unknown-unknown", "wasm", "pcalc_wasm.wasm");
const WASM = wasmIn(TARGET);
const CARGO_HOME = resolve(process.env.CARGO_HOME || join(homedir(), ".cargo"));

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
  const text = bytes.toString("latin1");
  for (const leak of [CARGO_HOME, ROOT, homedir()]) {
    for (const form of [leak, leak.split("\\").join("/")]) {
      if (form.length > 3 && text.includes(form)) {
        console.error(`build-wasm: ${wasmPath} still contains the local path ${form}`);
        process.exit(1);
      }
    }
  }
  return createHash("sha256").update(bytes).digest("hex");
}

const twice = process.argv.includes("--check-twice");
const first = buildOnce(TARGET);
console.log(`build-wasm: ${WASM} ${statSync(WASM).size} bytes sha256 ${first}`);
if (twice) {
  if (!REPRO_TARGET.startsWith(TARGET)) throw new Error("repro target outside target/");
  rmSync(REPRO_TARGET, { recursive: true, force: true });
  const second = buildOnce(REPRO_TARGET);
  if (second !== first) {
    console.error(`build-wasm: builds differ: ${first} vs ${second}`);
    process.exit(1);
  }
  console.log(`build-wasm: an independent from-scratch build in ${REPRO_TARGET} is byte-identical`);
}
