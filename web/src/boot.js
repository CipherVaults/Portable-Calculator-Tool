// M0 boot: picks the platform adapter, loads the engine, runs a few engine
// checks and shows them. On the desktop `--smoke-test` run it also times
// engine_call round trips and reports the verdict to the native side.
//
// For the headless boot checks (scripts/browser-boot.mjs) it sets on <html>:
//   data-boot         ok | error | unsupported | integrity | load-failed | framed
//   data-boot-error   the engine's failure code (engine-web.js, web.js)
//   data-engine       wasm | native
//   data-engine-sha256  the SHA-256 the loader verified (web only)
//   data-boot-ms      milliseconds from navigation start to the verdict
// When the engine cannot start, the read-only rescue view (rescue.js) is
// shown instead of the checks.
(function () {
  "use strict";
  const ns = window.PCalc;
  Object.freeze(ns.platforms);
  Object.freeze(ns);

  const { el, byId, show } = ns.dom;
  const t = ns.i18n.create(ns.catalogs, "en");
  const root = document.documentElement;

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

  function render(platform, outcome) {
    const passedCount = outcome.rows.filter((r) => r.passed).length;
    const allPassed = passedCount === outcome.rows.length;
    const list = el("ul", { className: "check-list" },
      outcome.rows.map((row) =>
        el("li", { className: row.passed ? "check pass" : "check fail", attrs: { "data-check": row.key } }, [
          el("span", { className: "check-name", text: t(row.key) }),
          el("span", { className: "check-result", text: t(row.passed ? "result.pass" : "result.fail") })
        ])
      )
    );
    const children = [
      el("h1", { className: "title", text: t("app.title") }),
      el("p", { className: "status", text: t("app.status") }),
      el("p", { className: "platform chip", text: t("boot.platform." + platform.name) }),
      el("p", { className: allPassed ? "summary pass" : "summary fail",
        text: (allPassed ? t("boot.ready") : t("boot.failed")) + " · " + t("boot.passed", { count: passedCount }) }),
      list
    ];
    if (outcome.versions) {
      const v = outcome.versions;
      const items = [el("li", { text: t("versions.api", { version: v.api }) })];
      for (const [name, version] of Object.entries(v.engines)) {
        items.push(el("li", { text: t("versions.engine", { name, version }) }));
      }
      children.push(el("ul", { className: "versions" }, items));
    }
    show(byId("app"), children);
    return allPassed;
  }

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

  // M1: desktop engine_call IPC round trips (plan B17), printed by the
  // native side in the SMOKE_TEST_OK line.
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
      el("h1", { className: "title", text: t(titleKey) }),
      el("p", { className: "status", text: t(bodyKey) })
    ]);
  }

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
    show(byId("app"), [el("p", { className: "status", text: t("boot.checking") })]);
    try {
      await platform.init();
    } catch (err) {
      const code = err && typeof err.code === "string" ? err.code : "unknown";
      const state = Object.prototype.hasOwnProperty.call(FAILURE_STATE, code) ? FAILURE_STATE[code] : "unsupported";
      root.dataset.bootError = code;
      ns.rescue.show(byId("app"), t, state);
      finish(state);
      if (await platform.isSmokeTest()) await platform.reportSmoke(false, "engine init failed: " + code);
      return;
    }
    const info = platform.engineInfo();
    root.dataset.engine = info.kind;
    if (info.sha256) root.dataset.engineSha256 = info.sha256;

    const outcome = await runChecks(platform);
    const passed = render(platform, outcome);
    finish(passed ? "ok" : "error");

    if (await platform.isSmokeTest()) {
      const ipc = await measureIpc(platform);
      const details = outcome.rows.map((r) => r.key + "=" + (r.passed ? "ok" : "fail")).join(" ") +
        "; boot " + root.dataset.bootMs + " ms; " + ipc.text;
      await platform.reportSmoke(passed && ipc.ok, details);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
