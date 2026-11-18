#!/usr/bin/env node
// Zero-dependency web build (plan B3, B4). Reads web/build-manifest.json and
// writes, deterministically (no timestamps, LF only):
//
//   dist/desktop/   index.html, app.<hash>.js, app.<hash>.css
//                   (the Tauri frontendDist; no WASM, the desktop engine is native)
//   dist/web/       index.html (meta CSP), app.<hash>.js, app.<hash>.css,
//                   engine.<hash>.wasm   (GitHub Pages, multi-file)
//   dist/Portable-Calculator-Tool-Mobile.html
//                   single file: inline CSS and JS (CSP sha256 hashes) and the
//                   WASM as base64 in <script type="application/octet-stream">
//   dist/build-info.json   versions, file names, sizes and SHA-256 of all of it
//
// Static checks run first and fail the build: LF-only sources, no DOM sinks
// (innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new
// Function), no .style writes, no raw colour literal outside tokens.css,
// no "</script" inside inlined JS.
//
//   node scripts/build-web.mjs                 # everything (needs engine.wasm)
//   node scripts/build-web.mjs --desktop-only  # just dist/desktop (no WASM needed)
//   node scripts/build-web.mjs --wasm <path>   # use another engine.wasm
//
// engine.wasm comes from (PowerShell):
//   cargo build -p pcalc-wasm --target wasm32-unknown-unknown --profile wasm --locked
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const DIST = join(ROOT, "dist");
const DEFAULT_WASM = join(ROOT, "target", "wasm32-unknown-unknown", "wasm", "pcalc_wasm.wasm");
const SINGLE_NAME = "Portable-Calculator-Tool-Mobile.html";

const WASM_BUDGET = 1_500_000; // plan B3: <= 1.5 MB
const SINGLE_BUDGET = 2_000_000; // plan B3: <= 2 MB

// The Pages CSP of plan B3, verbatim (no frame-ancestors in a meta CSP).
const WEB_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function fail(msg) {
  console.error(`build-web: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { desktopOnly: false, wasm: DEFAULT_WASM };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--desktop-only") opts.desktopOnly = true;
    else if (a === "--wasm") opts.wasm = resolve(argv[++i] || fail("--wasm needs a path"));
    else fail(`unknown argument ${a}`);
  }
  return opts;
}

const sha256 = (data) => createHash("sha256").update(data).digest();
const hex = (data) => sha256(data).toString("hex");
const short = (data) => hex(data).slice(0, 16);
const b64sha = (text) => "sha256-" + sha256(Buffer.from(text, "utf8")).toString("base64");

function readText(rel) {
  const path = join(WEB, rel);
  const text = readFileSync(path, "utf8");
  if (text.includes("\r")) fail(`${rel} has CR characters; LF only (see .gitattributes)`);
  return text;
}

// ---------------------------------------------------------------------------
// Static checks
// ---------------------------------------------------------------------------

const JS_BANS = [
  [/\binnerHTML\b/, "innerHTML"],
  [/\bouterHTML\b/, "outerHTML"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
  [/\bdocument\.write(ln)?\b/, "document.write"],
  [/(^|[^.\w])eval\s*\(/, "eval("],
  [/\bnew\s+Function\b/, "new Function"],
  [/\.style\b/, ".style (toggle classes instead)"],
  [/setAttribute\(\s*["']style["']/, "setAttribute(\"style\")"],
  [/\.cssText\b/, "cssText"]
];

// Hex colours, rgb()/hsl() and friends.
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;

function checkScript(rel, text) {
  // Comments may mention the banned names; strip them before scanning.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  for (const [re, name] of JS_BANS) {
    if (re.test(code)) fail(`${rel}: forbidden ${name}`);
  }
}

function checkStyle(rel, text) {
  if (rel === "styles/tokens.css") return;
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = code.match(COLOUR_LITERAL);
  if (m) fail(`${rel}: raw colour literal ${m[0]} (use a token from styles/tokens.css)`);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function loadManifest() {
  const manifest = JSON.parse(readText("build-manifest.json"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.appVersion || "")) fail("manifest appVersion is not x.y.z");
  if (!Array.isArray(manifest.scripts) || manifest.scripts.filter((s) => s === "@build").length !== 1) {
    fail('manifest scripts must contain "@build" exactly once');
  }
  if (manifest.scripts[0] !== "src/core/ns.js") fail("src/core/ns.js must load first");
  return manifest;
}

function loadCatalogs(manifest) {
  const catalogs = {};
  for (const lang of manifest.catalogs) {
    if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang)) fail(`bad catalog code ${lang}`);
    const catalog = JSON.parse(readText(`i18n/${lang}.json`));
    for (const [key, value] of Object.entries(catalog)) {
      const texts = typeof value === "string" ? [value] : key === "_meta" ? [] : Object.values(value);
      for (const text of texts) {
        if (typeof text !== "string") fail(`i18n/${lang}.json: ${key} is not text`);
        if (/[<>]/.test(text)) fail(`i18n/${lang}.json: ${key} contains markup characters`);
      }
    }
    catalogs[lang] = catalog;
  }
  if (!catalogs.en) fail("the en catalog is required");
  return catalogs;
}

// JSON as a JS expression that is also safe inside an inline <script>.
const jsLiteral = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

function buildChunk(manifest, catalogs, target, engine) {
  const build = { appVersion: manifest.appVersion, target };
  if (engine) {
    build.engineFile = engine.file;
    build.engineSha256 = engine.sha256;
  }
  return [
    "// Generated by scripts/build-web.mjs. Do not edit.",
    "(function () {",
    '  "use strict";',
    `  window.PCalc.build = Object.freeze(${jsLiteral(build)});`,
    `  const catalogs = ${jsLiteral(catalogs)};`,
    "  for (const lang of Object.keys(catalogs)) Object.freeze(catalogs[lang]);",
    "  window.PCalc.catalogs = Object.freeze(catalogs);",
    "})();",
    ""
  ].join("\n");
}

function assembleJs(manifest, sources, chunk) {
  return manifest.scripts
    .map((rel) => (rel === "@build" ? chunk : `// ---- web/${rel}\n${sources.get(rel)}`))
    .map((part) => (part.endsWith("\n") ? part : part + "\n"))
    .join("");
}

function render(template, values) {
  // One pass over the template only, so inserted CSS/JS is never rescanned
  // or changed after it was hashed. An empty value removes its line.
  const seen = new Set();
  const out = template.replace(/\{\{([A-Z_]+)\}\}(\n?)/g, (_, name, nl) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) fail(`template placeholder {{${name}}} has no value`);
    seen.add(name);
    return values[name] === "" ? "" : values[name] + nl;
  });
  for (const name of Object.keys(values)) {
    if (!seen.has(name)) fail(`template has no {{${name}}}`);
  }
  return out;
}

function writeOut(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  return { file: relative(DIST, join(dir, name)).split("\\").join("/"), bytes: Buffer.byteLength(data), sha256: hex(data) };
}

function cleanDist(names) {
  for (const name of names) {
    const target = join(DIST, name);
    if (!target.startsWith(DIST)) fail("refusing to clean outside dist/");
    rmSync(target, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const catalogs = loadCatalogs(manifest);
  const template = readText("index.template.html");

  const sources = new Map();
  for (const rel of manifest.scripts) {
    if (rel === "@build") continue;
    const text = readText(rel);
    checkScript(rel, text);
    sources.set(rel, text);
  }
  const css = manifest.styles
    .map((rel) => {
      const text = readText(rel);
      checkStyle(rel, text);
      return `/* ---- web/${rel} */\n${text.endsWith("\n") ? text : text + "\n"}`;
    })
    .join("");

  const info = { appVersion: manifest.appVersion, desktop: {}, web: null, single: null };
  cleanDist(["desktop", "web", SINGLE_NAME, "build-info.json"]);

  // Desktop: external files only (desktop CSP: script-src/style-src 'self').
  {
    const js = assembleJs(manifest, sources, buildChunk(manifest, catalogs, "desktop", null));
    const jsName = `app.${short(js)}.js`;
    const cssName = `app.${short(css)}.css`;
    const dir = join(DIST, "desktop");
    const html = render(template, {
      CSP_META: "",
      STYLES: `<link rel="stylesheet" href="${cssName}">`,
      APP_VERSION: manifest.appVersion,
      ENGINE_DATA: "",
      SCRIPTS: `<script src="${jsName}"></script>`
    });
    info.desktop = {
      html: writeOut(dir, "index.html", html),
      js: writeOut(dir, jsName, js),
      css: writeOut(dir, cssName, css)
    };
  }

  if (!opts.desktopOnly) {
    if (!existsSync(opts.wasm)) {
      fail(
        `engine.wasm not found at ${opts.wasm}\n` +
          "Build it first (PowerShell): cargo build -p pcalc-wasm --target wasm32-unknown-unknown --profile wasm --locked\n" +
          "or run with --desktop-only."
      );
    }
    const wasm = readFileSync(opts.wasm);
    if (wasm.length > WASM_BUDGET) fail(`engine.wasm is ${wasm.length} bytes, over the ${WASM_BUDGET} budget`);
    const engineName = `engine.${short(wasm)}.wasm`;
    const engine = { file: engineName, sha256: hex(wasm) };

    // Pages: multi-file, content-hashed.
    {
      const js = assembleJs(manifest, sources, buildChunk(manifest, catalogs, "web", engine));
      const jsName = `app.${short(js)}.js`;
      const cssName = `app.${short(css)}.css`;
      const dir = join(DIST, "web");
      const html = render(template, {
        CSP_META: `<meta http-equiv="Content-Security-Policy" content="${WEB_CSP}">`,
        STYLES: `<link rel="stylesheet" href="${cssName}">`,
        APP_VERSION: manifest.appVersion,
        ENGINE_DATA: "",
        SCRIPTS: `<script src="${jsName}"></script>`
      });
      info.web = {
        csp: WEB_CSP,
        html: writeOut(dir, "index.html", html),
        js: writeOut(dir, jsName, js),
        css: writeOut(dir, cssName, css),
        wasm: writeOut(dir, engineName, wasm)
      };
    }

    // Single file: everything inline, pinned by hashes.
    {
      const js = assembleJs(manifest, sources, buildChunk(manifest, catalogs, "single", engine));
      if (/<\/script/i.test(js)) fail("inlined JS contains </script");
      if (/<\/style/i.test(css)) fail("inlined CSS contains </style");
      const csp = [
        "default-src 'none'",
        `script-src '${b64sha(js)}' 'wasm-unsafe-eval'`,
        `style-src '${b64sha(css)}'`,
        "img-src data:",
        "connect-src https://api.github.com",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join("; ");
      const html = render(template, {
        CSP_META: `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        STYLES: `<style>${css}</style>`,
        APP_VERSION: manifest.appVersion,
        ENGINE_DATA: `<script type="application/octet-stream" id="engineWasm">${wasm.toString("base64")}</script>`,
        SCRIPTS: `<script>${js}</script>`
      });
      if (Buffer.byteLength(html) > SINGLE_BUDGET) {
        fail(`${SINGLE_NAME} is ${Buffer.byteLength(html)} bytes, over the ${SINGLE_BUDGET} budget`);
      }
      info.single = { csp, html: writeOut(DIST, SINGLE_NAME, html) };
    }
  }

  writeOut(DIST, "build-info.json", JSON.stringify(info, null, 2) + "\n");

  const lines = [`build-web: app ${manifest.appVersion}`];
  lines.push(`  desktop  ${info.desktop.js.file} (${info.desktop.js.bytes} B), ${info.desktop.css.file}`);
  if (info.web) {
    lines.push(`  web      ${info.web.js.file}, ${info.web.wasm.file} (${info.web.wasm.bytes} B, budget ${WASM_BUDGET})`);
    lines.push(`  single   ${info.single.html.file} (${info.single.html.bytes} B, budget ${SINGLE_BUDGET})`);
  } else {
    lines.push("  web and single-file skipped (--desktop-only)");
  }
  console.log(lines.join("\n"));
}

main();
