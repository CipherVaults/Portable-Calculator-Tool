// Local-path leak scan for built artefacts (plan B3, B14).
//
// A bare `cargo build` of the wasm32 engine embeds absolute source paths
// (the cargo home, so the user name, and this repository) in panic-location
// strings. scripts/build-wasm.mjs remaps them; this scan is the gate that
// build-wasm, build-web and check-wasm all apply to the engine bytes, so a
// leaky module can never reach dist/.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CARGO_HOME = resolve(process.env.CARGO_HOME || join(homedir(), ".cargo"));

// Every spelling a path can take inside a binary or JSON: as is, with
// forward slashes, and with doubled (escaped) backslashes. Compared without
// case, since Windows drive letters and folders are case-insensitive.
export function pathForms(path) {
  const forms = new Set([path, path.split("\\").join("/"), path.split("\\").join("\\\\")]);
  return [...forms].filter((form) => form.length > 3).map((form) => form.toLowerCase());
}

export function localRoots() {
  return [CARGO_HOME, ROOT, homedir()];
}

// Returns the first local path found in `bytes` (Buffer or Uint8Array), or
// null. `roots` defaults to the cargo home, the repository and the home
// directory of the machine running the scan.
export function findLocalPath(bytes, roots = localRoots()) {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1").toLowerCase();
  for (const root of roots) {
    for (const form of pathForms(root)) {
      if (text.includes(form)) return form;
    }
  }
  return null;
}

// The engine that build-wasm.mjs verified (remapped, leak-free). build-web
// and check-wasm use only this file by default, never cargo's own output
// path, which a bare `cargo build` also writes.
export const ENGINE_WASM = join(ROOT, "target", "engine", "engine.wasm");
