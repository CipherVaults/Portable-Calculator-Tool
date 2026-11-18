// M0 boot: picks the platform adapter, loads the engine, runs a few engine
// checks and shows them. On the desktop `--smoke-test` run it reports the
// verdict to the native side. Sets <html data-boot="ok|error|unsupported">
// for the headless boot checks.
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

    const platform = pickPlatform();
    show(byId("app"), [el("p", { className: "status", text: t("boot.checking") })]);
    try {
      await platform.init();
    } catch (_) {
      showMessage("unsupported.title", "unsupported.body");
      root.dataset.boot = "unsupported";
      if (await platform.isSmokeTest()) await platform.reportSmoke(false, "engine init failed");
      return;
    }

    const outcome = await runChecks(platform);
    const passed = render(platform, outcome);
    root.dataset.boot = passed ? "ok" : "error";

    if (await platform.isSmokeTest()) {
      const details = outcome.rows.map((r) => r.key + "=" + (r.passed ? "ok" : "fail")).join(" ");
      await platform.reportSmoke(passed, details);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
