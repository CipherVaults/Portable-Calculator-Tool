// Service worker (plan B3, B18 risk 6). scripts/build-web.mjs prepends
// `const BUILD = {...}` with this build's cache name and file list:
//   BUILD.cacheName  "pcalc-v<app>-<buildhash>"
//   BUILD.assets     every file of the build (index.html, the hashed app
//                    JS, CSS and engine, the web manifest and the icons)
//
//   install    caches ALL assets into BUILD.cacheName in one cache.addAll
//              (atomic: all or nothing, fetched past the HTTP cache), then
//              takes over at once.
//   activate   deletes only caches whose name starts with "pcalc-" and is
//              not this build's (other apps' caches on the same origin are
//              never touched), then claims the open pages.
//   fetch      navigations: network first; offline (or an error page)
//              falls back to THIS build's cached index.html. Build assets:
//              cache first from THIS build's cache only, never revalidated
//              in place; a missing one is fetched and stored there. Other
//              requests (api.github.com, anything else) pass through.
// An index.html of build N only ever references build N's hashed files, so
// an old and a new build can never be mixed on one page.
"use strict";

const PREFIX = "pcalc-";
const SCOPE = new URL("./", self.location.href);
const INDEX_URL = new URL("index.html", SCOPE).href;
const ASSET_URLS = new Set(BUILD.assets.map((a) => new URL(a, SCOPE).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(BUILD.cacheName)
      .then((cache) => cache.addAll(BUILD.assets.map((a) => new Request(new URL(a, SCOPE).href, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
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

async function fromBuildCache(request) {
  const cache = await caches.open(BUILD.cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
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
  if (ASSET_URLS.has(url.href) && url.href !== INDEX_URL) event.respondWith(fromBuildCache(request));
});
