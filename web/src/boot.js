// Boot (plan B3, B4, M2a): picks the platform adapter, loads the engine,
// runs the engine self-checks, opens the document store, loads settings
// and state, applies the theme and language, and starts the shell on the
// last route. On the desktop `--smoke-test` run it then drives the shell
// (every route, the store round trips, the theme switch), times engine_call
// round trips and reports the verdict to the native side.
//
// For the headless checks (scripts/browser-boot.mjs) it sets on <html>:
//   data-boot         ok | error | unsupported | integrity | load-failed | framed
//   data-boot-error   the engine's failure code (engine-web.js, web.js)
//   data-boot-checks  "<passed>/<total>" engine self-checks
//   data-engine       wasm | native
//   data-engine-sha256  the SHA-256 the loader verified (web only)
//   data-store        indexeddb | file | memory
//   data-assets       consistent | mixed (the stylesheet is this build's)
//   data-boot-ms      milliseconds from navigation start to the verdict
// When the engine cannot start, the read-only rescue view (rescue.js) is
// shown instead of the shell.
(function () {
  "use strict";
  const ns = window.PCalc;
  Object.freeze(ns.platforms);
  Object.freeze(ns);

  const { el, byId, show } = ns.dom;
  const root = document.documentElement;
  const catalogs = ns.catalogs;
  let t = ns.i18n.create(catalogs, "en");

  const DAYS_REQ = '{"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":false}';
  // CAP_ENGINE (64 KiB) + 1 byte: refused before parsing.
  const OVERSIZED_REQ = DAYS_REQ + " ".repeat(65536 + 1 - DAYS_REQ.length);
  // Exactly CAP_ENGINE: the largest request an engine op accepts.
  const CAP_REQ = DAYS_REQ + " ".repeat(65536 - DAYS_REQ.length);

  // Engine failure code -> boot state (and rescue view wording).
  const FAILURE_STATE = {
    no_wasm: "unsupported",
    no_crypto: "unsupported",
    instantiate: "unsupported",
    integrity: "integrity",
    load: "load-failed"
  };

  const CHECKS = [
    {
      key: "check.metaVersions",
      op: "meta.versions",
      req: "{}",
      ok: (r) => r.ok === "true" && r.result.api === 1 && r.result.app === ns.build.appVersion
    },
    {
      key: "check.dateDaysBetween",
      op: "date.days_between",
      req: DAYS_REQ,
      ok: (r) => r.ok === "true" && r.result.totalDays === 365
    },
    {
      key: "check.percentChange",
      op: "percent.change",
      req: '{"originalValue":150,"newValue":180}',
      ok: (r) => r.ok === "true" && r.result.label === "20.00% increase"
    },
    {
      key: "check.unknownOp",
      op: "calc.nope",
      req: "{}",
      ok: (r) => r.ok === "false" && r.error.code === "unknown_op"
    },
    {
      key: "check.requestTooLarge",
      op: "date.days_between",
      req: OVERSIZED_REQ,
      ok: (r) => r.ok === "false" && r.error.code === "request_too_large"
    }
  ];

  function pickPlatform() {
    return ns.platforms.tauri.available() ? ns.platforms.tauri : ns.platforms.web;
  }

  async function runChecks(platform) {
    const rows = [];
    let versions = null;
    for (const check of CHECKS) {
      let passed = false;
      try {
        const res = JSON.parse(await platform.engine(check.op, check.req));
        passed = Boolean(check.ok(res));
        if (check.op === "meta.versions" && passed) versions = res.result;
      } catch (_) {
        passed = false;
      }
      rows.push({ key: check.key, passed });
    }
    return { rows, versions };
  }

  // Whether the page's stylesheet belongs to this script's build (a stale
  // service worker must never pair an index of one version with assets of
  // another; plan B18 risk 6).
  function assetsConsistent() {
    if (!ns.build.cssFile) return true;
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    if (links.length === 0) return true; // inline styles (single file)
    return links.every((l) => String(l.getAttribute("href")).split("/").pop() === ns.build.cssFile);
  }

  // ---- the app context -------------------------------------------------------

  function makeContext(platform, store, outcomes, checks) {
    const p = ns.prefs;
    const ctx = {
      platform,
      store,
      outcomes,
      checks,
      build: ns.build,
      settings: p.fromOutcome(outcomes.settings, p.DEFAULT_SETTINGS),
      state: p.fromOutcome(outcomes.state, p.DEFAULT_STATE),
      devTools: /^0\./.test(ns.build.appVersion) || /[?&]dev(=|&|$)/.test(window.location.search),
      lastSaveError: null,
      t,
      lang: "en",
      digits: "western",
      shell: null
    };

    const saving = { settings: Promise.resolve(), state: Promise.resolve() };
    async function save(name) {
      // One write at a time per document, in order.
      const next = saving[name].then(async () => {
        if (store.isReadOnly && store.isReadOnly(name)) return;
        if (ctx.outcomes[name] && ctx.outcomes[name].readOnly) return;
        const r = await store.save(name, JSON.stringify(ctx[name]));
        if (r.ok) {
          ctx.outcomes[name] = { name, status: "ok", readOnly: false, doc: r.text, schemaVersion: null, backup: null, field: null };
          if (ctx.lastSaveError && ctx.lastSaveError.name === name) {
            ctx.lastSaveError = null;
            if (ctx.shell) ctx.shell.renderBanners();
          }
        } else if (r.code !== "read_only") {
          ctx.lastSaveError = { name, code: r.code };
          if (ctx.shell) ctx.shell.renderBanners();
        }
      });
      saving[name] = next.catch(() => undefined);
      return next;
    }
    ctx.saveSettings = () => save("settings");
    ctx.saveState = () => save("state");
    ctx.flush = () => Promise.all([saving.settings, saving.state]);

    // Language: an explicit code, "auto", or a pseudo-locale (developer).
    ctx.applyLanguage = () => {
      const pseudo = ctx.state.dev.pseudoLocale;
      const lang = pseudo !== "off" && ns.i18n.PSEUDO.includes(pseudo)
        ? pseudo
        : ns.i18n.resolve(ctx.settings.language.code, navigator.languages || [navigator.language], Object.keys(catalogs));
      ctx.lang = lang;
      ctx.digits = ns.format.digitsFor(lang, ctx.settings.language.digits);
      t = ns.i18n.create(catalogs, lang);
      ctx.t = t;
      ns.theme.applyLanguage(lang, t.dir);
      const footer = byId("appFooter");
      if (footer) footer.textContent = t("app.footer", { version: ns.build.appVersion });
    };

    ctx.setTheme = (pref) => {
      if (!ns.theme.PREFS.includes(pref)) return;
      ctx.settings.appearance.theme = pref;
      ns.theme.apply(pref);
      return ctx.saveSettings();
    };
    ctx.setLanguage = (code) => {
      ctx.settings.language.code = code;
      ctx.applyLanguage();
      if (ctx.shell) ctx.shell.rebuild();
      return ctx.saveSettings();
    };
    ctx.setDigits = (digits) => {
      ctx.settings.language.digits = digits;
      ctx.applyLanguage();
      if (ctx.shell) ctx.shell.refresh();
      return ctx.saveSettings();
    };
    ctx.setPseudo = (pseudo) => {
      ctx.state.dev.pseudoLocale = pseudo;
      ctx.applyLanguage();
      if (ctx.shell) ctx.shell.rebuild();
      return ctx.saveState();
    };

    // Retry: reload the document; a good load leaves read-only.
    ctx.retry = async (name) => {
      const o = await store.load(name);
      ctx.outcomes[name] = o;
      if (name === "countdowns") await ns.countdowns.reload();
      if (o.status === "ok" && (name === "settings" || name === "state")) {
        ctx[name] = p.fromOutcome(o, name === "settings" ? p.DEFAULT_SETTINGS : p.DEFAULT_STATE);
        if (name === "settings") ns.theme.apply(ctx.settings.appearance.theme);
        ctx.applyLanguage();
        if (ctx.shell) ctx.shell.rebuild();
      } else if (ctx.shell) {
        ctx.shell.renderBanners();
        if (ctx.shell.route() === "settings") ctx.shell.refresh();
      }
      return o;
    };
    // Start fresh (confirmed in the banner): backup, remove, write anew.
    ctx.reset = async (name) => {
      const r = await store.clear(name);
      if (!r.ok) {
        ctx.lastSaveError = { name, code: r.code };
      } else {
        ctx.outcomes[name] = { name, status: "empty", readOnly: false, doc: null, schemaVersion: null, backup: r.backup || null, field: null };
        if (name === "settings" || name === "state") await save(name);
        if (name === "countdowns") await ns.countdowns.reload();
      }
      if (ctx.shell) {
        ctx.shell.renderBanners();
        if (ctx.shell.route() === "settings") ctx.shell.refresh();
      }
      return r;
    };

    // Storage facts for Settings (asynchronous; filled in when known).
    ctx.describeStorage = async (estimateNode, persistNode) => {
      const [persisted, estimate] = await Promise.all([ctx.persisted, platform.estimate()]);
      if (persisted === true || persisted === false) persistNode.textContent = t("settings.storage.persist." + String(persisted));
      if (estimate && estimate.quota > 0) {
        show(estimateNode, ns.dom.withValues(t("settings.storage.estimate", {
          used: ns.dom.value(ns.format.bytes(estimate.usage, ctx.lang, { digits: ctx.digits })),
          quota: ns.dom.value(ns.format.bytes(estimate.quota, ctx.lang, { digits: ctx.digits }))
        })));
      }
    };
    return ctx;
  }

  // Another tab saved a document: reload and apply it (never save back).
  function listen(ctx) {
    const p = ns.prefs;
    ns.bus.on("settings-changed", async () => {
      const o = await ctx.store.load("settings");
      ctx.outcomes.settings = o;
      if (o.status !== "ok") {
        if (ctx.shell) ctx.shell.renderBanners();
        return;
      }
      const before = JSON.stringify(ctx.settings);
      ctx.settings = p.fromOutcome(o, p.DEFAULT_SETTINGS);
      if (JSON.stringify(ctx.settings) === before) return;
      ns.theme.apply(ctx.settings.appearance.theme);
      ctx.applyLanguage();
      if (ctx.shell) ctx.shell.rebuild();
    });
    ns.bus.on("state-changed", async () => {
      // The route and pane are per window; only the pseudo-locale follows.
      const o = await ctx.store.load("state");
      ctx.outcomes.state = o;
      if (o.status !== "ok") return;
      const other = p.fromOutcome(o, p.DEFAULT_STATE);
      if (other.dev.pseudoLocale !== ctx.state.dev.pseudoLocale) {
        ctx.state.dev.pseudoLocale = other.dev.pseudoLocale;
        ctx.applyLanguage();
        if (ctx.shell) ctx.shell.rebuild();
      }
    });
  }

  // ---- service worker (web, served over http(s) only) ---------------------------

  // Under the web CSP's Trusted Types the registration needs a script URL
  // from the one policy, which passes "sw.js" and nothing else.
  function workerUrl() {
    const tt = window.trustedTypes;
    if (!tt || typeof tt.createPolicy !== "function") return "sw.js";
    const policy = tt.createPolicy("pcalc", {
      createScriptURL: (url) => {
        if (url !== "sw.js") throw new TypeError("script URL not allowed");
        return url;
      }
    });
    return policy.createScriptURL("sw.js");
  }

  function registerServiceWorker() {
    if (ns.build.target !== "web" || !("serviceWorker" in navigator)) return;
    const proto = window.location.protocol;
    if (proto !== "https:" && proto !== "http:") return;
    let url;
    try {
      url = workerUrl();
    } catch (_) {
      root.setAttribute("data-sw", "failed");
      return;
    }
    navigator.serviceWorker.register(url, { scope: "./" }).then(
      () => root.setAttribute("data-sw", "registered"),
      () => root.setAttribute("data-sw", "failed")
    );
  }

  // ---- desktop smoke test ---------------------------------------------------------

  // Times `count` sequential engine calls; every answer must be a 365-day
  // result. Returns "<count>x <label> total=… median=… p95=… max=… ms".
  async function timeCalls(platform, count, label, req) {
    const times = [];
    for (let i = 0; i < count; i++) {
      const start = performance.now();
      const answer = await platform.engine("date.days_between", req);
      times.push(performance.now() - start);
      const res = JSON.parse(answer);
      if (res.ok !== "true" || res.result.totalDays !== 365) throw new Error("bad answer during timing");
    }
    const sorted = times.slice().sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const ms = (x) => x.toFixed(3);
    const total = times.reduce((a, b) => a + b, 0);
    return count + "x " + label + " total=" + ms(total) + " median=" + ms(at(0.5)) + " p95=" + ms(at(0.95)) + " max=" + ms(sorted[sorted.length - 1]) + " ms";
  }

  const nextFrame = () => new Promise((r) => setTimeout(r, 30));

  // The shell under the desktop adapter: every route renders its title,
  // the store round-trips settings and state through store_save and
  // store_load, an invalid document is refused, and each theme switches
  // <html data-theme> and the --bg token.
  async function smokeShell(ctx) {
    const fails = [];
    for (const r of ns.router.ROUTES) {
      ctx.shell.navigate(r);
      await nextFrame();
      const title = byId("routeTitle");
      if (ctx.shell.route() !== r || !title || title.textContent !== t(ns.views.titleKey(r))) fails.push("route " + r);
    }
    // The Date tool through this adapter's engine: a live result and a
    // mini calendar grid of 42 days.
    ctx.shell.navigate("date");
    await nextFrame();
    const put = (id, v) => {
      const n = byId(id);
      if (!n) return;
      n.value = v;
      n.dispatchEvent(new Event("input", { bubbles: true }));
    };
    put("betweenStart", "2024-01-01");
    put("betweenEnd", "2024-12-31");
    put("infoDate", "2024-02-29");
    const liveText = () => (byId("betweenLive") ? byId("betweenLive").textContent : "");
    for (let i = 0; i < 40 && !/365/.test(liveText()); i++) await nextFrame();
    const cells = byId("infoCalGrid") ? byId("infoCalGrid").children.length : 0;
    if (!/365/.test(liveText()) || cells !== 42) fails.push("date tool live=" + liveText() + " cells=" + cells);
    put("betweenStart", "");
    put("betweenEnd", "");
    put("infoDate", "");
    // The Percentage tool through this adapter's engine: eight cards, and
    // Discount's two result lines built from the engine's fields as text
    // (its "<br>" label is never shown).
    ctx.shell.navigate("percent");
    await nextFrame();
    put("discountPrice", "79.99");
    put("discountPercent", "20");
    const pctLive = () => (byId("discountLive") ? byId("discountLive").textContent : "");
    for (let i = 0; i < 40 && !/63\.99/.test(pctLive()); i++) await nextFrame();
    const pctCards = byId("percentCards") ? byId("percentCards").children.length : 0;
    const pctLines = byId("discountResult") ? byId("discountResult").querySelectorAll(".result-main, .result-sub").length : 0;
    const pctAngle = byId("percentTool") ? byId("percentTool").textContent.includes("<") : true;
    if (!/63\.99/.test(pctLive()) || pctCards !== 8 || pctLines !== 2 || pctAngle) fails.push("percent tool live=" + pctLive() + " cards=" + pctCards + " lines=" + pctLines);
    put("discountPrice", "");
    put("discountPercent", "");
    for (const pref of ["daylight", "retro", "terminal"]) {
      await ctx.setTheme(pref);
      const bg = getComputedStyle(root).getPropertyValue("--bg").trim().toUpperCase();
      const want = { daylight: "#F4F1EA", retro: "#008080", terminal: "#0E0F12" }[pref];
      if (root.getAttribute("data-theme") !== pref || bg !== want) fails.push("theme " + pref + " bg " + bg);
    }
    await ctx.setTheme("system");
    ctx.shell.navigate("about");
    await nextFrame();
    await ctx.flush();
    // What store_load returns is exactly the canonical text the last
    // store_save wrote (the engine normalises, e.g. the date calendar).
    for (const name of ["settings", "state"]) {
      const o = await ctx.store.load(name);
      const saved = ctx.outcomes[name];
      if (o.status !== "ok" || !saved || o.doc !== saved.doc) fails.push("round trip " + name);
    }
    let storedTheme = null;
    try {
      storedTheme = JSON.parse((await ctx.store.load("settings")).doc).appearance.theme;
    } catch (_) {
      storedTheme = null;
    }
    if (storedTheme !== "system") fails.push("theme not saved: " + storedTheme);
    const bad = await ctx.store.save("settings", '{"schemaVersion":1}');
    if (bad.ok || bad.code !== "invalid") fails.push("invalid save not refused");
    const countdowns = '{"schemaVersion":1,"items":[{"id":"c-1","label":"Smoke","targetDate":"2026-12-31","targetTime":"09:00","createdAtMs":1,"savedAtMs":2,"finishedSeenAtMs":null}]}';
    const saved = await ctx.store.save("countdowns", countdowns);
    const back = await ctx.store.load("countdowns");
    if (!saved.ok || back.status !== "ok" || JSON.parse(back.doc).items[0].label !== "Smoke") fails.push("round trip countdowns");
    return { ok: fails.length === 0, text: "shell " + (fails.length === 0 ? "ok (" + ns.router.ROUTES.length + " routes, the Date and Percentage tools live, 3 themes + System, 3 store round trips)" : "FAILED: " + fails.join(", ")) };
  }

  async function measureIpc(platform) {
    try {
      const small = await timeCalls(platform, 100, "engine_call(date.days_between, 72 B)", DAYS_REQ);
      const large = await timeCalls(platform, 20, "engine_call(date.days_between, 64 KiB)", CAP_REQ);
      return { ok: true, text: "ipc " + small + "; " + large };
    } catch (_) {
      return { ok: false, text: "ipc timing failed" };
    }
  }

  function showMessage(titleKey, bodyKey) {
    show(byId("app"), [
      el("section", { className: "rescue" }, [
        el("h1", { className: "title", text: t(titleKey) }),
        el("p", { className: "status", text: t(bodyKey) })
      ])
    ]);
  }

  // ---- boot -------------------------------------------------------------------------

  async function boot() {
    const footer = byId("appFooter");
    if (footer) footer.textContent = t("app.footer", { version: ns.build.appVersion });

    // The meta CSP cannot carry frame-ancestors, so the page refuses to run
    // inside a frame itself (plan B3).
    if (window.top !== window.self) {
      showMessage("app.title", "framed.body");
      root.dataset.boot = "framed";
      return;
    }
    const finish = (state) => {
      root.dataset.boot = state;
      root.dataset.bootMs = String(Math.round(performance.now()));
    };

    const platform = pickPlatform();
    show(byId("app"), [el("p", { className: "status rescue", text: t("boot.checking") })]);
    try {
      await platform.init();
    } catch (err) {
      const code = err && typeof err.code === "string" ? err.code : "unknown";
      const state = Object.prototype.hasOwnProperty.call(FAILURE_STATE, code) ? FAILURE_STATE[code] : "unsupported";
      root.dataset.bootError = code;
      await ns.rescue.show(byId("app"), t, state);
      finish(state);
      if (await platform.isSmokeTest()) await platform.reportSmoke(false, "engine init failed: " + code);
      return;
    }
    const info = platform.engineInfo();
    root.dataset.engine = info.kind;
    if (info.sha256) root.dataset.engineSha256 = info.sha256;
    root.dataset.assets = assetsConsistent() ? "consistent" : "mixed";

    const checks = await runChecks(platform);
    const passed = checks.rows.filter((r) => r.passed).length;
    root.dataset.bootChecks = passed + "/" + checks.rows.length;

    const store = await platform.openStore();
    root.dataset.store = store.kind;
    const outcomes = {};
    for (const name of ns.store.NAMES) {
      try {
        outcomes[name] = await store.load(name);
      } catch (_) {
        outcomes[name] = { name, status: "unreadable", readOnly: true, doc: null, schemaVersion: null, backup: null, field: null };
      }
    }
    const ctx = makeContext(platform, store, outcomes, checks);
    ctx.persisted = store.kind === "indexeddb" ? platform.persist() : Promise.resolve(null);
    ns.theme.apply(ctx.settings.appearance.theme);
    ns.theme.watchSystem();
    ctx.applyLanguage();
    listen(ctx);
    await ns.countdowns.init(ctx);

    // The last route reopens on launch unless the address names one.
    if (!ns.router.explicit()) {
      const last = ns.router.known(ctx.state.route) ? ctx.state.route : ns.router.DEFAULT_ROUTE;
      ns.router.replace(last);
    }
    ns.shell.start(byId("app"), ctx);
    const ok = passed === checks.rows.length && root.dataset.assets === "consistent";
    finish(ok ? "ok" : "error");
    if (ok) registerServiceWorker();

    if (await platform.isSmokeTest()) {
      const shell = await smokeShell(ctx);
      const ipc = await measureIpc(platform);
      const details = checks.rows.map((r) => r.key + "=" + (r.passed ? "ok" : "fail")).join(" ") +
        "; boot " + root.dataset.bootMs + " ms; " + shell.text + "; " + ipc.text;
      await platform.reportSmoke(ok && shell.ok && ipc.ok, details);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
