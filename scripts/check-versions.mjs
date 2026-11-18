#!/usr/bin/env node
// Locks the APP version (plan B1) across every place it is written:
//   src-tauri/tauri.conf.json, the src-tauri / pcalc-api / pcalc-wasm
//   Cargo.toml files, their Cargo.lock entries, web/build-manifest.json
//   (appVersion, which the build stamps into PCalc.build and the footers),
//   and, when dist/ exists, every built index.html footer, build-info.json
//   and the service worker's cache name.
// Engine versions are deliberately NOT checked here: each engine asserts
// ENGINE_VERSION == CARGO_PKG_VERSION in its own tests and changes only with
// engine behaviour.
//
//   node scripts/check-versions.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function cargoVersion(rel) {
  const text = read(rel);
  const pkg = text.split(/^\[/m).find((s) => s.startsWith("package]"));
  const m = pkg && /^version\s*=\s*"([^"]+)"/m.exec(pkg);
  return m ? m[1] : null;
}

function lockVersion(name) {
  const lock = read("Cargo.lock");
  const head = `[[package]]\nname = "${name}"\nversion = "`;
  const at = lock.indexOf(head);
  if (at < 0) return null;
  const start = at + head.length;
  return lock.slice(start, lock.indexOf('"', start));
}

const found = [
  ["src-tauri/tauri.conf.json version", JSON.parse(read("src-tauri/tauri.conf.json")).version],
  ["src-tauri/Cargo.toml", cargoVersion("src-tauri/Cargo.toml")],
  ["crates/pcalc-api/Cargo.toml", cargoVersion("crates/pcalc-api/Cargo.toml")],
  ["crates/pcalc-wasm/Cargo.toml", cargoVersion("crates/pcalc-wasm/Cargo.toml")],
  ["Cargo.lock portable-calculator-tool", lockVersion("portable-calculator-tool")],
  ["Cargo.lock pcalc-api", lockVersion("pcalc-api")],
  ["Cargo.lock pcalc-wasm", lockVersion("pcalc-wasm")],
  ["web/build-manifest.json appVersion", JSON.parse(read("web/build-manifest.json")).appVersion]
];

const footerVersion = (rel) => {
  const m = /data-app-version="([^"]*)"/.exec(read(rel));
  return m ? m[1] : null;
};
for (const rel of ["dist/desktop/index.html", "dist/web/index.html", "dist/Portable-Calculator-Tool-Mobile.html"]) {
  if (existsSync(join(ROOT, rel))) found.push([`${rel} footer`, footerVersion(rel)]);
}
if (existsSync(join(ROOT, "dist/build-info.json"))) {
  found.push(["dist/build-info.json appVersion", JSON.parse(read("dist/build-info.json")).appVersion]);
}
// The service worker's CACHE_NAME "pcalc-v<app>-<buildhash>" (plan B3).
if (existsSync(join(ROOT, "dist/web/sw.js"))) {
  const m = /"cacheName":"pcalc-v(\d+\.\d+\.\d+)-[0-9a-f]{16}"/.exec(read("dist/web/sw.js"));
  found.push(["dist/web/sw.js cache name", m ? m[1] : null]);
}

const want = found[0][1];
let ok = /^\d+\.\d+\.\d+$/.test(want || "");
for (const [where, version] of found) {
  const good = version === want;
  ok = ok && good;
  console.log(`${good ? "ok  " : "FAIL"} ${where}: ${version}`);
}
console.log(ok ? `check-versions: OK, app ${want} everywhere (${found.length} places)` : "check-versions: FAILED");
process.exit(ok ? 0 : 1);
