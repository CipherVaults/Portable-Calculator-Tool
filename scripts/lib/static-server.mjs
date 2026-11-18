// Zero-dependency, read-only static server for the built web app, shared by
// scripts/serve-web.mjs (manual use) and scripts/browser-boot.mjs (tests).
//
// Serves `dir` under `base` (default /Portable-Calculator-Tool/, the GitHub
// Pages path, so service-worker and manifest scopes behave as on Pages).
// Binds to 127.0.0.1 only. GET and HEAD, regular files inside `dir` only,
// no directory listings, no symlinks out of the folder.
//
// Test hooks (browser-boot only): `transform(rel, bytes)` may return other
// bytes for a file (a tampered engine), and returning null answers 404 (a
// blocked engine). Every served path is counted in `server.hits`.
import { createServer } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

export const HOST = "127.0.0.1";
export const BASE = "/Portable-Calculator-Tool/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  res.end(text);
}

// Maps a request path to {rel, path} of a regular file inside root, or null.
function resolveFile(root, base, pathname) {
  if (!pathname.startsWith(base)) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return null;
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const candidate = resolve(root, rel);
  if (!candidate.startsWith(root + sep)) return null;
  try {
    const real = realpathSync(candidate);
    if (!real.startsWith(root + sep)) return null;
    return statSync(real).isFile() ? { rel, path: real } : null;
  } catch {
    return null;
  }
}

// Starts the server; resolves to {server, url, port, hits, setDir(dir),
// close()}. setDir switches the served folder on the same origin (the
// browser-boot upgrade test serves build N, then build N+1); close() stops
// listening (the same test's "offline").
export function startStaticServer({ dir, base = BASE, port = 0, transform = null }) {
  let root = realpathSync(dir);
  const hits = new Map();
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
      return;
    }
    let url;
    try {
      url = new URL(req.url, `http://${HOST}`);
    } catch {
      send(res, 400, "Bad Request\n");
      return;
    }
    if (url.pathname === "/" || url.pathname === base.slice(0, -1)) {
      send(res, 302, `Found: ${base}\n`, { Location: base });
      return;
    }
    const file = resolveFile(root, base, url.pathname);
    if (!file) {
      send(res, 404, "Not Found\n");
      return;
    }
    hits.set(file.rel, (hits.get(file.rel) || 0) + 1);
    let body = readFileSync(file.path);
    if (transform) {
      const changed = transform(file.rel, body);
      if (changed === null) {
        send(res, 404, "Not Found\n");
        return;
      }
      if (changed !== undefined) body = changed;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file.path).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(body.length),
      // Revalidate every load, like a fresh deploy: the service worker owns caching.
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      resolveStart({
        server,
        port: actual,
        url: `http://${HOST}:${actual}${base}`,
        hits,
        setDir: (next) => {
          root = realpathSync(next);
        },
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          })
      });
    });
  });
}
