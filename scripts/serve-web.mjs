#!/usr/bin/env node
// Zero-dependency local server for the built web app (dist/web).
//
// Serves dist/web at http://127.0.0.1:8788/Portable-Calculator-Tool/ so the
// service-worker scope, manifest scope and install flow behave as they do on
// GitHub Pages (https://ciphervaults.github.io/Portable-Calculator-Tool/).
// Binds to 127.0.0.1 only. Read-only: GET and HEAD, regular files inside
// dist/web/ only, no directory listings, no symlinks out of the folder (the
// server itself is scripts/lib/static-server.mjs, shared with
// scripts/browser-boot.mjs).
// Build first: node scripts/build-web.mjs
//
//   node scripts/serve-web.mjs [--port N]
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "./lib/static-server.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parsePort(argv) {
  const i = argv.indexOf("--port");
  if (i < 0) return 8788;
  const n = Number.parseInt(argv[i + 1], 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error("--port needs a number between 1 and 65535");
  }
  return n;
}

const dir = join(ROOT, "dist", "web");
const served = await startStaticServer({ dir, port: parsePort(process.argv.slice(2)) });
console.log(`Serving ${dir} at ${served.url}`);
console.log("Press Ctrl+C to stop.");
