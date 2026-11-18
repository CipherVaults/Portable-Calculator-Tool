#!/usr/bin/env node
// Web checks that need no browser (plan B5b, B14):
//
//   themes     every [data-theme] block of web/styles/tokens.css defines the
//              same token names (switching a theme never leaves a token of
//              another theme behind), and every declared pair below meets
//              WCAG AA in every theme: 4.5:1 for text, 3:1 for UI parts and
//              focus rings (WCAG 2.x relative luminance; var() references
//              are resolved inside the theme).
//   csp        when dist/ exists: every inline <script>/<style> of the web
//              and single-file pages is pinned by a sha256 source in its
//              meta CSP, every hash in the CSP belongs to an inline block
//              (nothing stale), the pre-paint script is the first script
//              in <head>, and the desktop page has no inline script at all
//              (its CSP is script-src 'self').
//
//   node scripts/check-web.mjs [--tokens <path>] [--dist <dir>] [--json <path>]
//
// scripts/safety-eval.mjs (slice D) proves each rule fires on a mutant.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const THEMES = ["terminal", "daylight", "retro"];

// [foreground, background, minimum ratio, what uses it]
export const PAIRS = [
  ["--text", "--surface", 4.5, "body text"],
  ["--text", "--surface-raised", 4.5, "text on raised panels"],
  ["--text-strong", "--surface", 4.5, "headings"],
  ["--text-soft", "--surface", 4.5, "secondary text"],
  ["--muted", "--surface", 4.5, "muted text"],
  ["--muted-2", "--surface", 4.5, "muted text"],
  ["--accent", "--surface", 4.5, "accent titles and values"],
  ["--accent", "--surface-raised", 4.5, "accent on raised panels"],
  ["--ok", "--surface", 4.5, "pass and saved notes"],
  ["--danger", "--surface", 4.5, "errors"],
  ["--chip-text", "--chip-bg", 4.5, "chips"],
  ["--button-text", "--button-bg", 4.5, "buttons"],
  ["--selected-text", "--selected-bg", 4.5, "the current navigation item"],
  ["--banner-text", "--banner-bg", 4.5, "banners"],
  ["--bar-text", "--bar-bg", 4.5, "top bar title"],
  ["--bar-text", "--bar-bg-end", 4.5, "top bar title (gradient end)"],
  ["--on-bg", "--bg", 4.5, "text on the page background"],
  ["--on-bg-muted", "--bg", 4.5, "footer"],
  ["--focus-ring", "--surface", 3, "focus ring on panels"],
  ["--focus-ring", "--bg", 3, "focus ring on the page"],
  ["--focus-ring", "--surface-raised", 3, "focus ring on raised panels"],
  ["--focus-ring-selected", "--selected-bg", 3, "focus ring inside the selected tab and the current link"],
  ["--bar-focus", "--bar-bg", 3, "focus ring in the top bar"],
  ["--control-border", "--surface", 3, "button and field boundaries"],
  ["--control-border", "--button-bg", 3, "button boundaries"],
  ["--text", "--cal-range-bg", 4.5, "calendar days inside a range"],
  ["--muted", "--cal-range-bg", 4.5, "weekend days inside a range"],
  ["--muted-2", "--cal-range-bg", 4.5, "other-month days inside a range"],
  ["--cal-holiday", "--surface", 3, "the holiday marker"],
  ["--cal-holiday", "--cal-range-bg", 3, "the holiday marker inside a range"],
  ["--cal-today", "--surface", 3, "the today ring"],
  ["--cal-today", "--cal-range-bg", 3, "the today ring inside a range"],
  ["--finished-text", "--finished-bg", 4.5, "the finished countdown chip"]
];

// --- parsing -------------------------------------------------------------

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Top-level rule blocks (skips @media blocks entirely).
function topLevelBlocks(css) {
  const text = stripComments(css);
  const blocks = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const selector = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    if (!selector.startsWith("@")) blocks.push({ selector, body: text.slice(open + 1, j - 1) });
    i = j;
  }
  return blocks;
}

function declarations(body) {
  const map = new Map();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

export function themeTokens(css) {
  const out = {};
  for (const { selector, body } of topLevelBlocks(css)) {
    for (const theme of THEMES) {
      if (selector.split(",").map((s) => s.trim()).includes(`[data-theme="${theme}"]`)) out[theme] = declarations(body);
    }
  }
  return out;
}

function resolveVar(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`var() cycle at ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`${name} is not defined`);
  const m = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  return m ? resolveVar(tokens, m[1], seen) : value;
}

function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), alpha };
}

function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- checks --------------------------------------------------------------

export function themeProblems(css) {
  const problems = [];
  const rows = [];
  const themes = themeTokens(css);
  for (const theme of THEMES) if (!themes[theme]) problems.push(`tokens.css has no [data-theme="${theme}"] block`);
  if (problems.length) return { problems, rows };
  const names = (t) => [...themes[t].keys()].sort().join(",");
  for (const theme of THEMES.slice(1)) {
    if (names(theme) !== names(THEMES[0])) {
      const a = new Set(themes[THEMES[0]].keys());
      const b = new Set(themes[theme].keys());
      const missing = [...a].filter((k) => !b.has(k));
      const extra = [...b].filter((k) => !a.has(k));
      problems.push(`theme ${theme} token set differs from ${THEMES[0]}: missing ${missing.join(" ") || "-"}, extra ${extra.join(" ") || "-"}`);
    }
  }
  for (const theme of THEMES) {
    for (const [fg, bg, min, use] of PAIRS) {
      let ratio = null;
      try {
        const f = parseHex(resolveVar(themes[theme], fg));
        const b = parseHex(resolveVar(themes[theme], bg));
        if (!f || !b) throw new Error(`${fg} or ${bg} is not a hex colour`);
        if (f.alpha !== 1 || b.alpha !== 1) throw new Error(`${fg} or ${bg} is translucent`);
        ratio = contrast(f, b);
      } catch (err) {
        problems.push(`${theme}: ${fg} on ${bg}: ${err.message}`);
        continue;
      }
      rows.push({ theme, fg, bg, ratio: Math.round(ratio * 100) / 100, min, use });
      if (ratio < min) problems.push(`${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1 (${use})`);
    }
  }
  return { problems, rows };
}

const sha = (text) => "sha256-" + createHash("sha256").update(text, "utf8").digest("base64");

// Inline <script> and <style> blocks of a page (not data blocks with a
// non-JS type, which script-src does not cover).
function inlineBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const attrs = m[2] || "";
    if (/\ssrc=/.test(attrs)) continue;
    if (m[1] === "script" && /\stype="application\/octet-stream"/.test(attrs)) continue;
    out.push({ kind: m[1], text: m[3] });
  }
  return out;
}

export function cspProblems(name, html, { inlineAllowed }) {
  const problems = [];
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  const blocks = inlineBlocks(html);
  if (!inlineAllowed) {
    if (blocks.some((b) => b.kind === "script")) problems.push(`${name}: inline <script> on a page whose CSP has no hashes`);
    return problems;
  }
  if (!meta) return [`${name}: no meta CSP`];
  const csp = meta[1];
  const directive = (d) => (new RegExp(`(?:^|; )${d} ([^;]*)`).exec(csp) || [, ""])[1].split(" ");
  const scriptSrc = directive("script-src");
  const styleSrc = directive("style-src");
  const used = new Set();
  for (const b of blocks) {
    const h = `'${sha(b.text)}'`;
    const list = b.kind === "script" ? scriptSrc : styleSrc;
    if (!list.includes(h)) problems.push(`${name}: inline <${b.kind}> (${b.text.length} chars) not pinned by ${h}`);
    used.add(h);
  }
  for (const h of [...scriptSrc, ...styleSrc].filter((s) => s.startsWith("'sha256-"))) {
    if (!used.has(h)) problems.push(`${name}: stale CSP hash ${h}`);
  }
  if (/frame-ancestors/.test(csp)) problems.push(`${name}: frame-ancestors in a meta CSP`);
  const head = html.slice(0, html.indexOf("</head>"));
  const firstScript = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/.exec(head);
  if (!firstScript || !/data-theme/.test(firstScript[2])) problems.push(`${name}: the pre-paint theme script is not the first script in <head>`);
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? resolve(args[i + 1]) : fallback;
  };
  const tokensPath = opt("--tokens", join(ROOT, "web", "styles", "tokens.css"));
  const dist = opt("--dist", join(ROOT, "dist"));
  const jsonPath = opt("--json", null);

  const { problems, rows } = themeProblems(readFileSync(tokensPath, "utf8"));
  const csp = [];
  let pages = 0;
  if (existsSync(join(dist, "build-info.json"))) {
    const info = JSON.parse(readFileSync(join(dist, "build-info.json"), "utf8"));
    const page = (rel, inlineAllowed) => {
      const path = join(dist, rel);
      if (!existsSync(path)) return;
      pages++;
      csp.push(...cspProblems(rel, readFileSync(path, "utf8"), { inlineAllowed }));
    };
    page(info.desktop.html.file, false);
    if (info.web) page(info.web.html.file, true);
    if (info.single) page(info.single.html.file, true);
  }
  for (const theme of THEMES) {
    const worst = rows.filter((r) => r.theme === theme).sort((a, b) => a.ratio / a.min - b.ratio / b.min)[0];
    if (worst) console.log(`${theme}: ${rows.filter((r) => r.theme === theme).length} pairs, tightest ${worst.fg} on ${worst.bg} ${worst.ratio}:1 (min ${worst.min})`);
  }
  console.log(`csp: ${pages} built page(s) checked${pages === 0 ? " (no dist/, skipped)" : ""}`);
  const all = [...problems, ...csp];
  for (const p of all) console.log(`FAIL ${p}`);
  if (jsonPath) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ problems: all, contrast: rows, pages }, null, 2) + "\n");
  }
  console.log(all.length === 0 ? `check-web: OK (${THEMES.length} themes x ${PAIRS.length} pairs, ${pages} pages)` : `check-web: FAILED (${all.length})`);
  process.exit(all.length === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
