// safety-eval slices B (the shell's UI under both adapters) and C (the
// document stores' durability paths), run in the mini-DOM
// (scripts/lib/mini-dom.mjs) with the real web sources and the real
// engine.wasm. Each important rule also has a mutant: a one-line break of
// the source it protects, which the same test must catch.
//
// export async function runShellSlices({ web, engine, check, skip })
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Event, createOrigin, createWindow, tick, until } from "./mini-dom.mjs";
import { bootApp, fakeTauri, readSources } from "./web-harness.mjs";
import { catalogProblems, loadModules, unitResults, usageProblems } from "../check-i18n.mjs";

const RLO = "‮";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const attr = (node, name) => (node ? node.getAttribute(name) : null);
const inside = (container, node) => Boolean(container && node && container.contains(node));

async function clickLink(app, route) {
  const link = app.document.querySelector(`a[data-route='${route}']`);
  link.click();
  await until(() => app.html.getAttribute("data-route") === route, 2000);
}

async function go(app, route) {
  app.window.location.hash = "#/" + route;
  await until(() => app.html.getAttribute("data-route") === route, 2000);
  await tick(5);
}

// A store kit: ns + bus + store + the loader in a window, with the engine
// created through the real loader. Returns {store, engine, origin, win}.
async function storeKit(web, engineBytes, overrides = {}, opts = {}) {
  const origin = opts.origin || createOrigin();
  const w = createWindow({ origin, noIndexedDB: opts.noIndexedDB });
  const { text } = readSources(web, overrides);
  for (const rel of ["src/core/ns.js", "src/core/bus.js", "src/core/engine-web.js", "src/core/store.js"]) w.run(text(rel), rel);
  const sha = createHash("sha256").update(engineBytes).digest("hex");
  const engine = await w.window.PCalc.engineWeb.create(new Uint8Array(engineBytes), sha);
  const call = opts.brokenEngine ? async () => { throw new Error("engine down"); } : (op, req) => engine.call(op, req);
  const S = w.window.PCalc.store;
  const db = await S.openIdb(w.window.indexedDB);
  const backend = opts.memory ? S.memoryBackend() : db ? S.idbBackend(db) : S.memoryBackend();
  let now = 1000;
  const store = S.createDocStore(backend, call, null, () => now++);
  return { store, S, origin, idb: origin.indexedDB, call, win: w };
}

const VALID = {
  settings: null, // filled from DEFAULT_SETTINGS
  state: '{"schemaVersion":1,"route":"date","pane":{"open":false,"tab":"history"},"dev":{"pseudoLocale":"off"}}',
  history: '{"schemaVersion":1,"entries":[]}',
  countdowns: '{"schemaVersion":1,"items":[]}'
};

// ---------------------------------------------------------------------------
// Slice B tests. Each returns {ok, detail}; `src` = source overrides.
// ---------------------------------------------------------------------------

function B_tests(web, engine) {
  const boot = (o = {}) => bootApp({ web, engine, ...o });
  return {
    async "router-closed-list"(src) {
      const app = await boot({ overrides: src, href: "https://example.test/p/#/converter/length" });
      const R = app.PCalc.router;
      const bad = ["#/<img src=x onerror=alert(1)>", "#/__proto__", "#/constructor", "#/converter/", "#/STANDARD", "#/standard/x", "#//", "javascript:alert(1)"];
      const wrong = bad.filter((h) => R.parse(h) !== R.DEFAULT_ROUTE);
      const ok = wrong.length === 0 && R.ROUTES.length === 21 && R.GROUPS[2].routes.length === 12 && R.parse("#/converter/length") === "converter/length";
      return { ok, detail: wrong.length ? `accepted ${wrong.join(" ")}` : `${R.ROUTES.length} routes, ${bad.length} bad hashes fall back` };
    },
    async "last-route-restored"(src) {
      const origin = createOrigin();
      const a = await boot({ overrides: src, origin });
      await clickLink(a, "converter/length");
      await until(() => {
        const s = origin.indexedDB.peek("pcalc", "state");
        return s && JSON.parse(s).route === "converter/length";
      }, 2000);
      const b = await boot({ overrides: src, origin });
      const c = await boot({ overrides: src, origin, href: "https://example.test/Portable-Calculator-Tool/#/about" });
      const ok = b.window.location.hash === "#/converter/length" && b.byId("routeTitle").textContent === "Length" && c.byId("routeTitle").textContent === "About";
      return { ok, detail: `restored ${b.window.location.hash} "${b.byId("routeTitle").textContent}", explicit #/about "${c.byId("routeTitle").textContent}"` };
    },
    async "placeholders-and-about"(src) {
      const app = await boot({ overrides: src });
      const missing = [];
      for (const r of app.PCalc.router.ROUTES) {
        await go(app, r);
        const title = app.byId("routeTitle").textContent;
        if (!title || title.startsWith("route.")) missing.push(r + " title");
        if (!["settings", "about"].includes(r) && !app.document.querySelector("section[data-state='placeholder']")) missing.push(r + " placeholder");
      }
      await go(app, "about");
      const pass = app.document.querySelectorAll(".check.pass").length;
      return { ok: missing.length === 0 && pass === 5, detail: missing.join(", ") || `21 routes render; about ${pass}/5 checks` };
    },
    async "drawer-modal-inert"(src) {
      const app = await boot({ overrides: src, width: 390 });
      const toggle = app.byId("drawerToggle");
      const drawer = app.byId("drawer");
      toggle.focus();
      toggle.click();
      const others = ["topbar", "view", "pane", "appFooter"].map((id) => app.byId(id));
      const ok =
        attr(app.html, "data-modal") === "drawer" &&
        !drawer.hasAttribute("hidden") &&
        attr(drawer, "role") === "dialog" &&
        attr(drawer, "aria-modal") === "true" &&
        attr(toggle, "aria-expanded") === "true" &&
        others.every((n) => n.hasAttribute("inert") && attr(n, "aria-hidden") === "true") &&
        !app.byId("scrim").hasAttribute("hidden") &&
        inside(drawer, app.document.activeElement);
      return { ok, detail: `role=${attr(drawer, "role")} inert=${others.map((n) => n.hasAttribute("inert")).join(",")} focus=${app.document.activeElement.id || app.document.activeElement.localName}` };
    },
    async "drawer-focus-trap"(src) {
      const app = await boot({ overrides: src, width: 390 });
      const toggle = app.byId("drawerToggle");
      toggle.focus();
      toggle.click();
      const drawer = app.byId("drawer");
      let escaped = 0;
      // More presses than the drawer has stops (21), both ways, so every
      // wrap-around edge is crossed.
      for (let i = 0; i < 60; i++) {
        app.document.press("Tab", { shift: i >= 30 });
        if (!inside(drawer, app.document.activeElement)) escaped++;
      }
      return { ok: escaped === 0, detail: `focus left the open drawer ${escaped} times in 60 Tab/Shift+Tab presses` };
    },
    async "drawer-escape-restores-focus"(src) {
      const app = await boot({ overrides: src, width: 390 });
      const toggle = app.byId("drawerToggle");
      toggle.focus();
      toggle.click();
      app.document.press("Tab");
      app.document.press("Escape");
      const drawer = app.byId("drawer");
      const ok = drawer.hasAttribute("hidden") && !app.byId("view").hasAttribute("inert") && app.document.activeElement === toggle && attr(toggle, "aria-expanded") === "false";
      return { ok, detail: `hidden=${drawer.hasAttribute("hidden")} focus=${app.document.activeElement.id || app.document.activeElement.localName}` };
    },
    async "drawer-link-navigates"(src) {
      const app = await boot({ overrides: src, width: 390 });
      app.byId("drawerToggle").focus();
      app.byId("drawerToggle").click();
      await clickLink(app, "converter/pressure");
      const ok = app.window.location.hash === "#/converter/pressure" && app.byId("routeTitle").textContent === "Pressure" && app.byId("drawer").hasAttribute("hidden") && app.document.activeElement === app.byId("view");
      return { ok, detail: `${app.window.location.hash} focus=${app.document.activeElement.id}` };
    },
    async "drawer-pinned-when-wide"(src) {
      const app = await boot({ overrides: src, width: 1280 });
      const drawer = app.byId("drawer");
      const ok = !drawer.hasAttribute("hidden") && app.byId("drawerToggle").hasAttribute("hidden") && attr(drawer, "role") === null && attr(app.byId("shell"), "data-layout") === "wide";
      app.setWidth(390);
      const narrow = drawer.hasAttribute("hidden") && !app.byId("drawerToggle").hasAttribute("hidden");
      return { ok: ok && narrow, detail: `wide pinned=${ok}, narrow hidden=${narrow}` };
    },
    async "shortcuts-alt-digits"(src) {
      const app = await boot({ overrides: src });
      const want = ["standard", "scientific", "graphing", "programmer", "date", "percent"];
      const got = [];
      for (const [i, route] of want.entries()) {
        app.document.press(String(i + 1), { alt: true });
        await until(() => app.html.getAttribute("data-route") === route, 1000);
        got.push(app.html.getAttribute("data-route"));
      }
      return { ok: got.join() === want.join(), detail: got.join(" ") };
    },
    async "shortcuts-skip-fields-and-composition"(src) {
      // macOS types characters with Option+digit and Ctrl+H deletes in a
      // field: the shortcuts stay out of selects, text fields and an input
      // method's composition, and still work everywhere else.
      const app = await boot({ overrides: src, width: 390 });
      await go(app, "settings");
      app.byId("digitsSelect").focus();
      app.document.press("5", { alt: true });
      app.document.press("h", { ctrl: true });
      await tick(10);
      const inSelect = app.html.getAttribute("data-route") === "settings" && app.byId("pane").hasAttribute("hidden");
      app.byId("digitsSelect").blur();
      app.document.press("5", { alt: true, composing: true });
      await tick(10);
      const composing = app.html.getAttribute("data-route") === "settings";
      app.document.press("5", { alt: true });
      await until(() => app.html.getAttribute("data-route") === "date", 1000);
      const plain = app.html.getAttribute("data-route") === "date";
      return { ok: inSelect && composing && plain, detail: `in a select ignored=${inSelect}, composing ignored=${composing}, on the page works=${plain}` };
    },
    async "settings-change-keeps-focus"(src) {
      // Digits re-render the route; language and the pseudo-locale rebuild
      // the shell. The select that changed keeps focus (WCAG 2.4.3, 3.2.2).
      const app = await boot({ overrides: src, width: 390 });
      await go(app, "settings");
      const got = [];
      for (const [id, value] of [["digitsSelect", "arabic-indic"], ["pseudoSelect", "en-XA"], ["pseudoSelect", "off"], ["digitsSelect", "western"]]) {
        const before = app.byId(id);
        before.focus();
        before.value = value;
        before.dispatchEvent(new Event("change"));
        await tick(20);
        const now = app.document.activeElement;
        got.push({ id, value, ok: Boolean(now) && now.id === id && app.byId(id).value === value, focus: now ? now.id || now.localName : null });
      }
      return { ok: got.every((g) => g.ok), detail: got.map((g) => `${g.id}=${g.value} focus ${g.focus}`).join(", ") };
    },
    async "modal-opener-without-focus"(src) {
      // Safari does not focus a button on tap or click: the toggle opened
      // the modal while <body> had focus. Closing still returns to it.
      const app = await boot({ overrides: src, width: 390 });
      const runs = [];
      for (const [toggle, close] of [["drawerToggle", "Escape"], ["drawerToggle", "drawerClose"], ["paneToggle", "Escape"], ["paneToggle", "paneClose"]]) {
        if (app.document.activeElement) app.document.activeElement.blur();
        app.byId(toggle).click();
        const opened = app.document.activeElement !== app.document.body;
        if (close === "Escape") app.document.press("Escape");
        else app.byId(close).click();
        await tick(5);
        const at = app.document.activeElement;
        runs.push({ toggle, close, ok: opened && at === app.byId(toggle), focus: at ? at.id || at.localName : null });
      }
      return { ok: runs.every((r) => r.ok), detail: runs.map((r) => `${r.toggle}/${r.close} -> ${r.focus}`).join(", ") };
    },
    async "pane-bottom-sheet"(src) {
      const app = await boot({ overrides: src, width: 390 });
      app.byId("paneToggle").focus();
      app.document.press("h", { ctrl: true });
      const pane = app.byId("pane");
      const open = !pane.hasAttribute("hidden") && attr(pane, "role") === "dialog" && attr(app.byId("view"), "inert") !== null && app.document.activeElement === app.byId("paneTab-history");
      app.document.press("ArrowRight");
      const moved = app.document.activeElement === app.byId("paneTab-memory") && attr(app.byId("paneTab-memory"), "aria-selected") === "true";
      let escaped = 0;
      for (let i = 0; i < 12; i++) {
        app.document.press("Tab");
        if (!inside(pane, app.document.activeElement)) escaped++;
      }
      app.document.press("Escape");
      const closed = pane.hasAttribute("hidden") && app.document.activeElement === app.byId("paneToggle");
      await until(() => {
        const s = app.origin.indexedDB.peek("pcalc", "state");
        return s && JSON.parse(s).pane.tab === "memory";
      }, 1500);
      const saved = JSON.parse(app.origin.indexedDB.peek("pcalc", "state") || "{}");
      const ok = open && moved && escaped === 0 && closed && saved.pane && saved.pane.tab === "memory" && saved.pane.open === false;
      return { ok, detail: `open=${open} arrow=${moved} escaped=${escaped} closed=${closed} saved=${JSON.stringify(saved.pane)}` };
    },
    async "pane-docked-when-wide"(src) {
      const app = await boot({ overrides: src, width: 1280 });
      app.document.press("h", { ctrl: true });
      const pane = app.byId("pane");
      const ok = !pane.hasAttribute("hidden") && attr(pane, "role") === null && app.byId("scrim").hasAttribute("hidden") && !app.byId("view").hasAttribute("inert");
      return { ok, detail: `role=${attr(pane, "role")} scrim hidden=${app.byId("scrim").hasAttribute("hidden")}` };
    },
    async "theme-switch-instant-and-saved"(src) {
      const app = await boot({ overrides: src });
      await go(app, "settings");
      app.byId("theme-retro").click();
      const instant = app.html.getAttribute("data-theme") === "retro" && app.html.getAttribute("data-theme-pref") === "retro";
      const mirror = app.window.localStorage.getItem("pcalc.theme");
      await until(() => {
        const s = app.origin.indexedDB.peek("pcalc", "settings");
        return s && JSON.parse(s).appearance.theme === "retro";
      }, 1500);
      const stored = JSON.parse(app.origin.indexedDB.peek("pcalc", "settings") || "{}");
      const ok = instant && mirror === "retro" && stored.appearance && stored.appearance.theme === "retro";
      return { ok, detail: `data-theme=${app.html.getAttribute("data-theme")} mirror=${mirror} stored=${stored.appearance && stored.appearance.theme}` };
    },
    async "theme-system-follows-os"(src) {
      const app = await boot({ overrides: src, light: true });
      const light = app.html.getAttribute("data-theme");
      app.setLight(false);
      const dark = app.html.getAttribute("data-theme");
      return { ok: light === "daylight" && dark === "terminal", detail: `light OS ${light}, dark OS ${dark}` };
    },
    async "prepaint"(src) {
      const { manifest, text } = readSources(web, src);
      const code = text(manifest.prepaint);
      const run = (opts, store) => {
        const w = createWindow(opts);
        if (store === "blocked") w.origin.localStorage.blocked = true;
        else for (const [k, v] of Object.entries(store || {})) w.origin.localStorage.setItem(k, v);
        w.run(code, "prepaint.js");
        const h = w.document.documentElement;
        return [h.getAttribute("data-theme"), h.getAttribute("dir") || "-", h.getAttribute("lang") || "-"].join(" ");
      };
      const cases = [
        [{}, { "pcalc.theme": "retro" }, "retro - -"],
        [{}, { "pcalc.theme": "daylight", "pcalc.lang": "ar" }, "daylight rtl ar"],
        [{ light: true }, {}, "daylight - -"],
        [{}, {}, "terminal - -"],
        [{ light: true }, { "pcalc.theme": "system" }, "daylight - -"],
        [{}, { "pcalc.theme": "__proto__", "pcalc.lang": "constructor" }, "terminal - -"],
        [{}, { "pcalc.theme": "<b>", "pcalc.lang": "ar-XB" }, "terminal rtl ar-XB"],
        [{}, "blocked", "terminal - -"]
      ];
      const wrong = cases.map(([o, s, want]) => [JSON.stringify(s), run(o, s), want]).filter(([, got, want]) => got !== want);
      return { ok: wrong.length === 0, detail: wrong.map(([s, got, want]) => `${s}: ${got}, want ${want}`).join("; ") || `${cases.length} cases` };
    },
    async "prepaint-mirror-follows-store"(src) {
      // The settings document wins at boot and refreshes the mirror the
      // next pre-paint reads.
      const origin = createOrigin();
      const a = await boot({ overrides: src, origin });
      await go(a, "settings");
      a.byId("theme-daylight").click();
      await until(() => (origin.indexedDB.peek("pcalc", "settings") || "").includes('"daylight"'), 1500);
      origin.localStorage.removeItem("pcalc.theme");
      const b = await boot({ overrides: src, origin });
      const ok = b.html.getAttribute("data-theme") === "daylight" && origin.localStorage.getItem("pcalc.theme") === "daylight";
      return { ok, detail: `theme ${b.html.getAttribute("data-theme")} mirror ${origin.localStorage.getItem("pcalc.theme")}` };
    },
    async "pseudo-locales"(src) {
      const app = await boot({ overrides: src });
      await go(app, "settings");
      const pick = (value) => {
        const select = app.byId("pseudoSelect");
        select.value = value;
        select.dispatchEvent(new Event("change"));
      };
      pick("ar-XB");
      const rtl = app.html.getAttribute("dir") === "rtl" && app.html.getAttribute("lang") === "ar-XB" && app.byId("routeTitle").textContent.startsWith(RLO);
      pick("en-XA");
      const title = app.byId("routeTitle").textContent;
      const xa = app.html.getAttribute("dir") === "ltr" && title.startsWith("[") && title.endsWith("]") && !/[a-z]/.test(title.slice(1, 9));
      pick("off");
      const back = app.byId("routeTitle").textContent === "Settings" && app.html.getAttribute("lang") === "en";
      return { ok: rtl && xa && back, detail: `ar-XB rtl=${rtl}, en-XA "${title}", off=${back}` };
    },
    async "i18n-catalog-and-units"(src) {
      const { text, catalogs } = readSources(web, src);
      const P = loadModules(web, { "src/core/i18n.js": text("src/core/i18n.js"), "src/core/format.js": text("src/core/format.js") });
      const units = unitResults(P);
      const failed = units.filter((u) => !u.ok);
      const problems = catalogProblems(catalogs, P.i18n.categories);
      return { ok: failed.length === 0 && problems.length === 0, detail: failed.length || problems.length ? [...failed.map((u) => u.name), ...problems].slice(0, 3).join("; ") : `${units.length} units, catalogs clean` };
    },
    async "broadcast-sync"(src) {
      const origin = createOrigin();
      const a = await boot({ overrides: src, origin });
      const b = await boot({ overrides: src, origin });
      await go(a, "settings");
      a.byId("theme-daylight").click();
      await until(() => b.html.getAttribute("data-theme") === "daylight", 2000);
      const writesAfterSync = origin.indexedDB.writes;
      await tick(50);
      const ok = b.html.getAttribute("data-theme") === "daylight" && origin.hub.delivered > 0 && origin.indexedDB.writes === writesAfterSync;
      return { ok, detail: `other window theme ${b.html.getAttribute("data-theme")}, messages ${origin.hub.delivered}, extra writes ${origin.indexedDB.writes - writesAfterSync}` };
    },
    async "no-broadcast-channel"(src) {
      const app = await boot({ overrides: src, noBroadcastChannel: true });
      return { ok: app.html.getAttribute("data-boot") === "ok" && app.PCalc.bus.available === false, detail: `boot ${app.html.getAttribute("data-boot")}` };
    },
    async "desktop-adapter"(src) {
      const { text } = readSources(web, src);
      const kit = await storeKit(web, engine);
      const tauri = fakeTauri(kit.call, kit.S.createDocStore, kit.S.memoryBackend);
      const app = await bootApp({ web, engine: null, tauri, overrides: src });
      await go(app, "settings");
      app.byId("theme-retro").click();
      await until(() => tauri.log.some((l) => l.cmd === "store_save" && l.args.name === "settings"), 1500);
      const loads = tauri.log.filter((l) => l.cmd === "store_load").map((l) => l.args.name).sort().join(",");
      const saved = await tauri.store.load("settings");
      const ok =
        app.html.getAttribute("data-boot") === "ok" &&
        app.html.getAttribute("data-engine") === "native" &&
        app.html.getAttribute("data-store") === "file" &&
        loads === "countdowns,history,settings,state" &&
        saved.status === "ok" &&
        JSON.parse(saved.doc).appearance.theme === "retro" &&
        !text("src/platform/tauri.js").includes("indexedDB");
      // An invoke refusal is a {ok:false, code} answer, never a throw.
      const refused = await app.PCalc.platforms.tauri.openStore().then((s) => s.save("nope", "{}"));
      return { ok: ok && refused.ok === false && refused.code === "unknown_doc", detail: `boot ${app.html.getAttribute("data-boot")} engine ${app.html.getAttribute("data-engine")} store ${app.html.getAttribute("data-store")} loads ${loads} refusal ${JSON.stringify(refused)}` };
    }
  };
}

// ---------------------------------------------------------------------------
// Slice C tests (durability)
// ---------------------------------------------------------------------------

function C_tests(web, engine) {
  const kit = (src, opts) => storeKit(web, engine, src, opts);
  return {
    async "defaults-pass-the-validators"(src) {
      const k = await kit(src);
      const app = await bootApp({ web, engine, overrides: src });
      const P = app.PCalc.prefs;
      const s = JSON.parse(await k.call("settings.validate", JSON.stringify(P.DEFAULT_SETTINGS)));
      const t = JSON.parse(await k.call("state.validate", JSON.stringify(P.DEFAULT_STATE)));
      return { ok: s.ok === "true" && s.result.status === "ok" && t.ok === "true" && t.result.status === "ok", detail: `settings ${s.ok}, state ${t.ok}` };
    },
    async "empty-then-canonical-round-trip"(src) {
      const k = await kit(src);
      const out = [];
      for (const name of k.S.NAMES) out.push((await k.store.load(name)).status);
      const r = await k.store.save("state", VALID.state.replace("{", "{ "));
      const back = await k.store.load("state");
      const writes = k.idb.writes;
      await k.store.save("countdowns", VALID.countdowns);
      const ok = out.every((s) => s === "empty") && r.ok && back.status === "ok" && back.doc === r.text && !r.text.includes("{ ") && k.idb.writes === writes + 1;
      return { ok, detail: `loads ${out.join(",")}; saved canonical ${r.ok}; one write per save ${k.idb.writes - writes}` };
    },
    async "corrupt-backup-first-then-read-only"(src) {
      const k = await kit(src);
      await k.store.save("history", VALID.history);
      k.idb.poke("pcalc", "history", '{"schemaVersion":1,"entries":[{]}');
      const o = await k.store.load("history");
      const bak = k.idb.peek("pcalc", "history.bak.1");
      const refused = await k.store.save("history", VALID.history);
      const kept = k.idb.peek("pcalc", "history");
      const again = await k.store.load("history");
      const ok =
        o.status === "corrupt" && o.readOnly && o.backup === "history.bak.1" && bak && bak.raw === '{"schemaVersion":1,"entries":[{]}' && typeof bak.atMs === "number" &&
        refused.code === "read_only" && kept === '{"schemaVersion":1,"entries":[{]}' && again.backup === null && k.idb.peek("pcalc", "history.bak.2") === undefined;
      return { ok, detail: `status ${o.status} backup ${o.backup} refused ${refused.code} untouched ${kept === '{"schemaVersion":1,"entries":[{]}'} second backup ${again.backup}` };
    },
    async "field-level-corruption-reports-the-path"(src) {
      const k = await kit(src);
      await k.store.save("state", VALID.state);
      k.idb.poke("pcalc", "state", VALID.state.replace('"open":false', '"open":1'));
      const o = await k.store.load("state");
      return { ok: o.status === "corrupt" && o.field === "pane.open", detail: `${o.status} at ${o.field}` };
    },
    async "non-text-value-is-corrupt-with-backup"(src) {
      const k = await kit(src);
      await k.store.save("countdowns", VALID.countdowns);
      k.idb.poke("pcalc", "countdowns", { schemaVersion: 1, items: [] });
      const o = await k.store.load("countdowns");
      const bak = k.idb.peek("pcalc", "countdowns.bak.1");
      return { ok: o.status === "corrupt" && o.readOnly && bak && typeof bak.raw === "object", detail: `${o.status} backup ${JSON.stringify(bak && bak.raw)}` };
    },
    async "backups-keep-the-newest-three"(src) {
      const k = await kit(src);
      await k.store.save("history", VALID.history);
      for (let i = 1; i <= 5; i++) {
        k.idb.poke("pcalc", "history", `bad ${i}`);
        await k.store.load("history");
      }
      const got = [1, 2, 3, 4].map((n) => (k.idb.peek("pcalc", "history.bak." + n) || { raw: "-" }).raw);
      return { ok: got.join("|") === "bad 5|bad 4|bad 3|-", detail: got.join(" | ") };
    },
    async "newer-is-read-only-without-backup"(src) {
      const k = await kit(src);
      await k.store.load("settings");
      k.idb.poke("pcalc", "settings", '{"schemaVersion":7,"fromTheFuture":true}');
      const o = await k.store.load("settings");
      const refused = await k.store.save("settings", "{}");
      const ok = o.status === "newer" && o.readOnly && o.schemaVersion === 7 && o.backup === null && k.idb.peek("pcalc", "settings.bak.1") === undefined && refused.code === "read_only" && k.idb.peek("pcalc", "settings") === '{"schemaVersion":7,"fromTheFuture":true}';
      return { ok, detail: `${o.status} v${o.schemaVersion} backup ${o.backup} refused ${refused.code}` };
    },
    async "too-large-is-read-only-never-corrupt"(src) {
      const k = await kit(src);
      const atCap = VALID.state + " ".repeat(256 * 1024 - VALID.state.length);
      k.idb.poke("pcalc", "state", atCap);
      const edge = await k.store.load("state");
      const over = atCap + " ";
      k.idb.poke("pcalc", "state", over);
      const o = await k.store.load("state");
      const refused = await k.store.save("state", VALID.state);
      const ok = edge.status === "ok" && o.status === "tooLarge" && o.readOnly && o.backup === null && k.idb.peek("pcalc", "state.bak.1") === undefined && refused.code === "read_only" && k.idb.peek("pcalc", "state") === over;
      return { ok, detail: `at cap ${edge.status}, cap+1 ${o.status} backup ${o.backup}` };
    },
    async "unreadable-then-retry"(src) {
      const k = await kit(src);
      await k.store.save("state", VALID.state);
      k.idb.failReads = true;
      const o = await k.store.load("state");
      const refused = await k.store.save("state", VALID.state);
      k.idb.failReads = false;
      const retry = await k.store.load("state");
      const after = await k.store.save("state", VALID.state);
      const ok = o.status === "unreadable" && o.readOnly && refused.code === "read_only" && retry.status === "ok" && !retry.readOnly && after.ok;
      return { ok, detail: `${o.status}, retry ${retry.status}, save ${after.ok}` };
    },
    async "engine-down-is-unvalidated-read-only"(src) {
      const k = await kit(src, { brokenEngine: true });
      const raw = VALID.state;
      // Seed through a working store first.
      const good = await kit(src, { origin: k.origin });
      await good.store.save("state", raw);
      const o = await k.store.load("state");
      const refused = await k.store.save("state", raw);
      return { ok: o.status === "unvalidated" && o.readOnly && refused.code === "read_only" && k.idb.peek("pcalc", "state.bak.1") === undefined, detail: `${o.status} ${refused.code}` };
    },
    async "quota-keeps-the-old-value"(src) {
      // Both ways browsers report it: the put request fails (Gecko; the
      // error event reaches the transaction before tx.error is set) and the
      // commit aborts with tx.error (Chromium).
      const got = [];
      for (const hook of ["quotaExceeded", "quotaAtCommit"]) {
        const k = await kit(src);
        await k.store.save("state", VALID.state);
        k.idb[hook] = true;
        const r = await k.store.save("state", VALID.state.replace("date", "about"));
        k.idb[hook] = false;
        const kept = JSON.parse(k.idb.peek("pcalc", "state")).route;
        got.push({ hook, ok: r.ok === false && r.code === "quota" && kept === "date", text: `${hook}: ${r.code}, stored route ${kept}` });
      }
      return { ok: got.every((g) => g.ok), detail: got.map((g) => g.text).join("; ") };
    },
    async "save-before-load-never-overwrites-unseen"(src) {
      // As the desktop DocStore: a save of a document this store has not
      // loaded loads it first, so corrupt, newer or too-large data is
      // protected (and a corrupt one backed up), never overwritten.
      const seeds = {
        settings: "{damaged",
        history: '{"schemaVersion":9}',
        state: VALID.state + " ".repeat(256 * 1024)
      };
      const k = await kit(src);
      for (const [name, raw] of Object.entries(seeds)) k.idb.poke("pcalc", name, raw);
      const fresh = await kit(src, { origin: k.origin });
      const results = [];
      for (const [name, raw] of Object.entries(seeds)) {
        const r = await fresh.store.save(name, name === "settings" ? JSON.stringify((await bootApp({ web, engine, overrides: src })).PCalc.prefs.DEFAULT_SETTINGS) : name === "history" ? VALID.history : VALID.state);
        results.push({ name, ok: r.ok === false && r.code === "read_only" && k.idb.peek("pcalc", name) === raw });
      }
      const bak = k.idb.peek("pcalc", "settings.bak.1");
      const noOtherBackups = k.idb.peek("pcalc", "history.bak.1") === undefined && k.idb.peek("pcalc", "state.bak.1") === undefined;
      const missing = await fresh.store.save("countdowns", VALID.countdowns);
      const ok = results.every((r) => r.ok) && bak && bak.raw === "{damaged" && noOtherBackups && missing.ok;
      return { ok, detail: results.map((r) => `${r.name} ${r.ok ? "protected" : "OVERWRITTEN"}`).join(", ") + `; corrupt backed up ${Boolean(bak)}; missing doc written ${missing.ok}` };
    },
    async "newer-is-never-cleared"(src) {
      const k = await kit(src);
      const newer = '{"schemaVersion":9,"fromTheFuture":true}';
      k.idb.poke("pcalc", "settings", newer);
      const unseen = await k.store.clear("settings");
      await k.store.load("settings");
      const seen = await k.store.clear("settings");
      // Replaced by a newer app after a corrupt load here.
      k.idb.poke("pcalc", "state", "{bad");
      await k.store.load("state");
      k.idb.poke("pcalc", "state", '{"schemaVersion":5}');
      const later = await k.store.clear("state");
      const ok = [unseen, seen, later].every((r) => r.ok === false && r.code === "read_only") &&
        k.idb.peek("pcalc", "settings") === newer && k.idb.peek("pcalc", "settings.bak.1") === undefined &&
        k.idb.peek("pcalc", "state") === '{"schemaVersion":5}';
      return { ok, detail: `unseen ${unseen.code}, loaded ${seen.code}, replaced later ${later.code}` };
    },
    async "clear-backs-up-then-starts-fresh"(src) {
      const k = await kit(src);
      await k.store.save("countdowns", VALID.countdowns);
      k.idb.poke("pcalc", "countdowns", "[broken");
      await k.store.load("countdowns");
      const c = await k.store.clear("countdowns");
      const fresh = await k.store.load("countdowns");
      const saved = await k.store.save("countdowns", VALID.countdowns);
      const ok = c.ok && c.backup === null && fresh.status === "empty" && saved.ok && k.idb.peek("pcalc", "countdowns.bak.1").raw === "[broken" && k.idb.peek("pcalc", "countdowns.bak.2") === undefined;
      return { ok, detail: `clear ${c.ok} (backup ${c.backup}, the corrupt load already made one), then ${fresh.status}, save ${saved.ok}` };
    },
    async "indexeddb-unavailable-falls-back-to-memory"(src) {
      const results = [];
      for (const mode of [null, "error", "blocked"]) {
        const origin = createOrigin();
        origin.indexedDB.failOpen = mode;
        const app = await bootApp({ web, engine, overrides: src, origin, noIndexedDB: mode === null });
        results.push(`${mode || "missing"}:${app.html.getAttribute("data-store")}:${app.document.querySelector("p[data-state='memory']") ? "banner" : "no-banner"}`);
      }
      return { ok: results.every((r) => r.endsWith(":memory:banner")), detail: results.join(" ") };
    },
    async "ui-read-only-banner-and-start-fresh"(src) {
      const origin = createOrigin();
      const a = await bootApp({ web, engine, overrides: src, origin });
      await go(a, "settings");
      a.byId("theme-retro").click();
      await until(() => (origin.indexedDB.peek("pcalc", "settings") || "").includes("retro"), 1500);
      origin.indexedDB.poke("pcalc", "settings", "{damaged");
      const b = await bootApp({ web, engine, overrides: src, origin });
      const banner = b.document.querySelector("div[data-doc='settings']");
      const corrupt = banner && attr(banner, "data-state") === "corrupt";
      await go(b, "settings");
      b.byId("theme-daylight").click();
      await tick(40);
      const untouched = origin.indexedDB.peek("pcalc", "settings") === "{damaged";
      const reset = () => b.document.querySelectorAll("button[data-doc='settings']").find((n) => attr(n, "data-state") === "idle" || attr(n, "data-state") === "armed");
      reset().click();
      const armed = attr(reset(), "data-state") === "armed" && origin.indexedDB.peek("pcalc", "settings") === "{damaged";
      reset().click();
      await until(() => !b.document.querySelector("div[data-doc='settings']"), 1500);
      await until(() => (origin.indexedDB.peek("pcalc", "settings") || "").startsWith('{"schemaVersion":1'), 1500);
      const fresh = (origin.indexedDB.peek("pcalc", "settings") || "").includes('"daylight"');
      const bak = origin.indexedDB.peek("pcalc", "settings.bak.1");
      const ok = corrupt && untouched && armed && fresh && bak && bak.raw === "{damaged";
      return { ok, detail: `banner corrupt=${corrupt} untouched=${untouched} needs-confirm=${armed} fresh=${fresh} backup=${bak && bak.raw}` };
    },
    async "ui-newer-banner"(src) {
      const origin = createOrigin();
      await bootApp({ web, engine, overrides: src, origin });
      origin.indexedDB.poke("pcalc", "state", '{"schemaVersion":2}');
      const b = await bootApp({ web, engine, overrides: src, origin });
      await clickLink(b, "about");
      await tick(30);
      const banner = b.document.querySelector("div[data-doc='state']");
      // Retry only: "Start fresh" would back up and replace the newer
      // app's live document (B10: never written, never backed up).
      const buttons = banner ? banner.querySelectorAll("button").map((n) => n.textContent) : [];
      const ok = banner && attr(banner, "data-state") === "newer" && buttons.join() === "Retry" && origin.indexedDB.peek("pcalc", "state") === '{"schemaVersion":2}' && origin.indexedDB.peek("pcalc", "state.bak.1") === undefined;
      return { ok, detail: `banner ${banner && attr(banner, "data-state")}, buttons [${buttons.join(", ")}], state untouched ${origin.indexedDB.peek("pcalc", "state") === '{"schemaVersion":2}'}` };
    },
    async "ui-save-failure-is-shown"(src) {
      const origin = createOrigin();
      const app = await bootApp({ web, engine, overrides: src, origin });
      await go(app, "settings");
      origin.indexedDB.quotaExceeded = true;
      app.byId("theme-retro").click();
      await until(() => app.document.querySelector("p[data-state='save-failed']"), 1500);
      const shown = Boolean(app.document.querySelector("p[data-state='save-failed']"));
      return { ok: shown && app.html.getAttribute("data-theme") === "retro", detail: `banner ${shown}` };
    },
    async "rescue-reads-without-creating"(src) {
      const origin = createOrigin();
      const a = await bootApp({ web, engine, overrides: src, origin, noWasm: true });
      const empty = a.byId("rescue") && attr(a.byId("rescue"), "data-state") === "0" && !origin.indexedDB.dbs.has("pcalc");
      const b = await bootApp({ web, engine, overrides: src, origin });
      await go(b, "settings");
      b.byId("theme-retro").click();
      await until(() => origin.indexedDB.peek("pcalc", "settings"), 1500);
      origin.indexedDB.poke("pcalc", "history", "{raw history");
      const writes = origin.indexedDB.writes;
      const c = await bootApp({ web, engine, overrides: src, origin, noWasm: true });
      const keys = c.document.querySelectorAll(".rescue-key").map((n) => n.textContent);
      const values = c.document.querySelectorAll(".rescue-value").map((n) => n.textContent);
      const ok = empty && c.html.getAttribute("data-boot") === "unsupported" && keys.includes("history") && values.includes("{raw history") && keys.includes("pcalc.theme") && origin.indexedDB.writes === writes;
      return { ok, detail: `empty-not-created=${empty} keys=${keys.join(",")} writes during rescue ${origin.indexedDB.writes - writes}` };
    }
  };
}

// ---------------------------------------------------------------------------
// Mutants: [slice, test, file, from, to]
// ---------------------------------------------------------------------------

export const MUTANTS = [
  ["B", "drawer-focus-trap", "src/shell/shell.js", "      trap(e);\n", "\n"],
  ["B", "drawer-escape-restores-focus", "src/shell/shell.js", 'if (e.key === "Escape" && modal) {', 'if (e.key === "Esc" && modal) {'],
  ["B", "drawer-modal-inert", "src/shell/shell.js", 'flag(n, "inert", on);', "void on;"],
  ["B", "router-closed-list", "src/core/router.js", "return known(route) ? route : DEFAULT_ROUTE;", "return route || DEFAULT_ROUTE;"],
  ["B", "broadcast-sync", "src/core/bus.js", "if (channel) channel.postMessage({ v: 1, type });", "void channel;"],
  ["B", "prepaint", "src/prepaint.js", 'pref = window.localStorage.getItem("pcalc.theme");', "pref = null;"],
  ["B", "theme-switch-instant-and-saved", "src/core/theme.js", "writeMirror(MIRROR, current);", "void MIRROR;"],
  ["B", "i18n-catalog-and-units", "src/core/i18n.js", "if (o.i10 >= 2 && o.i10 <= 4 && !(o.i100 >= 12 && o.i100 <= 14)) return \"few\";", "if (o.i10 >= 2 && o.i10 <= 4) return \"few\";"],
  ["B", "last-route-restored", "src/boot.js", "ns.router.replace(last);", "void last;"],
  ["B", "drawer-modal-inert", "src/shell/shell.js", 'nodes.pane, byId("appFooter")]', "nodes.pane]"],
  ["B", "drawer-modal-inert", "src/shell/shell.js", 'document.documentElement.setAttribute("data-modal", name);', "void name;"],
  ["B", "shortcuts-skip-fields-and-composition", "src/shell/shell.js", "if (e.isComposing || editable(e.target)) return;", ""],
  ["B", "settings-change-keeps-focus", "src/shell/shell.js", "if (again && again !== document.activeElement) again.focus({ preventScroll: true });", "void again;"],
  ["B", "modal-opener-without-focus", "src/shell/shell.js", "return toggle;", "return active;"],
  ["C", "ui-newer-banner", "src/shell/shell.js", 'if (o.status === "newer") {', "if (false) {"],
  ["C", "corrupt-backup-first-then-read-only", "src/core/store.js", "const wrote = await backend.rotate(name, entry, (old) => old && sameRaw(old.raw, raw));", "const wrote = false && entry;"],
  ["C", "corrupt-backup-first-then-read-only", "src/core/store.js", 'if (readOnly.has(name)) return { ok: false, code: "read_only" };', ""],
  ["C", "too-large-is-read-only-never-corrupt", "src/core/store.js", 'if (code === "request_too_large") return outcome(name, "tooLarge");', ""],
  ["C", "newer-is-read-only-without-backup", "src/core/store.js", 'if (r.status === "newer") return outcome(name, "newer", { schemaVersion: r.schemaVersion });', ""],
  ["C", "backups-keep-the-newest-three", "src/core/store.js", "const BACKUPS = 3;", "const BACKUPS = 4;"],
  ["C", "ui-read-only-banner-and-start-fresh", "src/shell/shell.js", "if (resetArmed === name) {", "if (true) {"],
  ["C", "rescue-reads-without-creating", "src/rescue.js", "req.transaction.abort();", "void req;"],
  ["C", "quota-keeps-the-old-value", "src/core/store.js", "tx.onerror = (e) => reject((e && e.target && e.target.error) || tx.error", "tx.onerror = () => reject(tx.error"],
  ["C", "save-before-load-never-overwrites-unseen", "src/core/store.js", "      if (!loaded.has(name)) await load(name);\n      if (readOnly.has(name))", "      if (readOnly.has(name))"],
  ["C", "newer-is-never-cleared", "src/core/store.js", 'if (env && env.ok === "true" && env.result && env.result.status === "newer") {', "if (false) {"]
];

export async function runShellSlices({ web, engine, check, skip }) {
  if (!engine) {
    skip("B.*", "needs target/engine/engine.wasm (node scripts/build-wasm.mjs)");
    skip("C.*", "needs target/engine/engine.wasm");
    return;
  }
  const suites = { B: B_tests(web, engine), C: C_tests(web, engine) };
  for (const [slice, tests] of Object.entries(suites)) {
    for (const [name, fn] of Object.entries(tests)) {
      let r;
      try {
        r = await fn({});
      } catch (err) {
        r = { ok: false, detail: `threw ${err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : err}` };
      }
      check(`${slice}.${name}`, r.ok, r.detail);
    }
  }
  const seen = new Map();
  for (const [slice, test, file, from, to] of MUTANTS) {
    const original = readFileSync(join(web, file), "utf8");
    const base = `${slice}.mutant.${test}.${file.split("/").pop()}`;
    seen.set(base, (seen.get(base) || 0) + 1);
    const id = seen.get(base) > 1 ? `${base}#${seen.get(base)}` : base;
    if (!original.includes(from)) {
      check(id, false, `mutation site not found in ${file}: ${from.trim()}`);
      continue;
    }
    let r;
    try {
      r = await suites[slice][test]({ [file]: original.replace(from, to) });
    } catch (err) {
      r = { ok: false, detail: `threw ${err && err.message}` };
    }
    check(id, !r.ok, r.ok ? `NOT caught: ${r.detail}` : `caught: ${r.detail}`);
  }
}
