// Service worker (plan B3, B18 risk 6). scripts/build-web.mjs prepends
// `const BUILD = {...}` with this build's cache name, file list and hashes:
//   BUILD.cacheName  "pcalc-v<app>-<buildhash>"
//   BUILD.assets     every file of the build (index.html, the hashed app
//                    JS, CSS and engine, the web manifest and the icons)
//   BUILD.sha256     each asset's SHA-256 (hex)
//
//   install    fetches ALL assets past the HTTP cache, checks each one's
//              bytes against BUILD.sha256 and only then caches them into
//              BUILD.cacheName. A CDN edge can still serve an older
//              index.html (or any other file) next to this new sw.js: then
//              the install fails, the new cache is dropped, the old worker
//              and its complete cache stay in charge, and the browser tries
//              the update again later. Then takes over at once.
//   activate   deletes only caches whose name starts with "pcalc-" and is
//              not this build's (other apps' caches on the same origin are
//              never touched), then claims the open pages.
//   fetch      navigations: network first; offline (or an error page)
//              falls back to THIS build's cached index.html. Build assets:
//              cache first from THIS build's cache only, never revalidated
//              in place; a missing one is fetched and stored there only
//              when its bytes match. Other requests (api.github.com,
//              anything else) pass through.
// An index.html of build N only ever references build N's hashed files, so
// an old and a new build can never be mixed on one page.
"use strict";

const PREFIX = "pcalc-";
const SCOPE = new URL("./", self.location.href);
const INDEX_URL = new URL("index.html", SCOPE).href;
const ASSET_URLS = new Set(BUILD.assets.map((a) => new URL(a, SCOPE).href));
const HASH_BY_URL = new Map(BUILD.assets.map((a) => [new URL(a, SCOPE).href, BUILD.sha256[a]]));

async function hexSha256(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Fetches `url` past the HTTP cache and resolves a Response holding the
// verified bytes, or rejects (network error, HTTP error, wrong bytes).
async function fetchVerified(url) {
  const response = await fetch(new Request(url, { cache: "reload" }));
  if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
  const bytes = await response.arrayBuffer();
  const want = HASH_BY_URL.get(url);
  if (typeof want !== "string" || (await hexSha256(bytes)) !== want) throw new Error("not this build's bytes: " + url);
  // Only the type travels with the bytes (the body is already decoded, so
  // the server's Content-Encoding and Content-Length no longer apply).
  const type = response.headers.get("Content-Type") || "application/octet-stream";
  return new Response(bytes, { status: 200, headers: { "Content-Type": type } });
}

async function install() {
  const urls = BUILD.assets.map((a) => new URL(a, SCOPE).href);
  // Everything is fetched and checked before anything is cached.
  const verified = await Promise.all(urls.map((url) => fetchVerified(url)));
  try {
    const cache = await caches.open(BUILD.cacheName);
    await Promise.all(urls.map((url, i) => cache.put(url, verified[i])));
  } catch (err) {
    await caches.delete(BUILD.cacheName);
    throw err;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== BUILD.cacheName).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function fromNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) return response;
    const cached = await caches.open(BUILD.cacheName).then((c) => c.match(INDEX_URL));
    return cached || response;
  } catch (err) {
    const cached = await caches.open(BUILD.cacheName).then((c) => c.match(INDEX_URL));
    if (cached) return cached;
    throw err;
  }
}

async function fromBuildCache(request, url) {
  const cache = await caches.open(BUILD.cacheName);
  const hit = await cache.match(url);
  if (hit) return hit;
  try {
    const response = await fetchVerified(url);
    await cache.put(url, response.clone());
    return response;
  } catch (_) {
    // Not cacheable as this build's file: answer from the network as is.
    return fetch(request);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fromNetworkFirst(request));
    return;
  }
  url.hash = "";
  url.search = "";
  if (ASSET_URLS.has(url.href) && url.href !== INDEX_URL) event.respondWith(fromBuildCache(request, url.href));
});
