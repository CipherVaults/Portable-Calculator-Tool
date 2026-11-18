// Boots the real web sources (web/build-manifest.json order, plus a build
// chunk like scripts/build-web.mjs writes) in a mini-DOM window
// (scripts/lib/mini-dom.mjs), with the real engine.wasm behind the web
// adapter or a fake Tauri bridge behind the desktop adapter. Used by
// scripts/safety-eval.mjs slices B and C.
//
//   const app = await bootApp({ web, engine, origin, width, overrides, ... });
//   app.html.getAttribute("data-boot") === "ok"
//
// `overrides` maps a source path (e.g. "src/shell/shell.js") to replacement
// text, which is how the mutant proofs run a broken copy of one file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createOrigin, createWindow, until } from "./mini-dom.mjs";

export function readSources(web, overrides = {}) {
  const manifest = JSON.parse(readFileSync(join(web, "build-manifest.json"), "utf8"));
  const text = (rel) => (Object.prototype.hasOwnProperty.call(overrides, rel) ? overrides[rel] : readFileSync(join(web, rel), "utf8"));
  const catalogs = {};
  for (const lang of manifest.catalogs) catalogs[lang] = JSON.parse(text(`i18n/${lang}.json`));
  return { manifest, text, catalogs };
}

function buildChunk(build, catalogs) {
  return [
    "(function () {",
    '  "use strict";',
    `  window.PCalc.build = Object.freeze(${JSON.stringify(build)});`,
    `  const catalogs = ${JSON.stringify(catalogs)};`,
    "  for (const lang of Object.keys(catalogs)) Object.freeze(catalogs[lang]);",
    "  window.PCalc.catalogs = Object.freeze(catalogs);",
    "})();"
  ].join("\n");
}

// A fake Tauri core: engine_call through `engineCall` (the WASM engine is
// byte-identical to native, check-wasm proves it), store_* through a web
// document store over memory (the same outcome shapes as pcalc-store's
// LoadOutcome; pcalc-store's own semantics are its cargo tests). `log`
// records every invoke.
export function fakeTauri(engineCall, createDocStore, memoryBackend) {
  const log = [];
  const store = createDocStore(memoryBackend(), engineCall, null, () => 0);
  const invoke = async (cmd, args = {}) => {
    log.push({ cmd, args });
    switch (cmd) {
      case "engine_call":
        return engineCall(args.op, args.req);
      case "store_load":
        if (!["settings", "state", "history", "countdowns"].includes(args.name)) throw "unknown_doc";
        return store.load(args.name);
      case "store_save": {
        const r = await store.save(args.name, args.text);
        if (!r.ok) throw r.code === "invalid" ? "invalid" : r.code;
        return r.text;
      }
      case "store_clear": {
        const r = await store.clear(args.name);
        if (!r.ok) throw r.code;
        return r.backup;
      }
      case "is_smoke_test":
        return false;
      case "report_smoke_result":
        return null;
      default:
        throw `unknown command ${cmd}`;
    }
  };
  return { core: { invoke }, log, store };
}

// Boots one window. Options:
//   web          the web/ folder
//   engine       Uint8Array of engine.wasm (required for the web adapter)
//   origin       shared origin (createOrigin()), for multi-window tests
//   width, light, languages, href, noIndexedDB, noBroadcastChannel, noWasm
//   overrides    {rel: text} source replacements (mutants)
//   tauri        a fakeTauri(...) object: boot under the desktop adapter
//   seed(win)    called before the scripts run (e.g. localStorage values)
export async function bootApp(opts) {
  const origin = opts.origin || createOrigin();
  const w = createWindow({ ...opts, origin });
  const { manifest, text, catalogs } = readSources(opts.web, opts.overrides || {});
  const build = { appVersion: manifest.appVersion, target: opts.tauri ? "desktop" : "web", cssFile: null };
  if (opts.engine) {
    const sha = createHash("sha256").update(opts.engine).digest("hex");
    build.engineFile = `engine.${sha.slice(0, 16)}.wasm`;
    build.engineSha256 = sha;
    origin.files.set(build.engineFile, opts.engine);
  }
  if (opts.tauri) w.window.__TAURI__ = opts.tauri;
  const { el } = { el: (tag, id, cls) => {
    const n = w.document.createElement(tag);
    n.setAttribute("id", id);
    n.setAttribute("class", cls);
    return n;
  } };
  w.document.body.append(el("div", "app", "app"), el("footer", "appFooter", "app-footer"));
  if (opts.seed) opts.seed(w.window);
  w.run(text(manifest.prepaint), manifest.prepaint);
  for (const rel of manifest.scripts) {
    w.run(rel === "@build" ? buildChunk(build, catalogs) : text(rel), rel);
  }
  const html = w.document.documentElement;
  await until(() => {
    const b = html.getAttribute("data-boot");
    return b && b !== "checking";
  }, opts.timeoutMs || 10000);
  // Let the first saves and the persist() request settle.
  await until(() => false, 30);
  return { ...w, html, build, byId: (id) => w.document.getElementById(id), PCalc: w.window.PCalc };
}
