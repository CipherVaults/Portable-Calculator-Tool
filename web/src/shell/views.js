// The views behind the routes (plan B5). The Date (M2b) and Percentage
// (M2c) tools are real; the other tool routes are placeholders that name
// their milestone; Settings (with the Date calendar and layout sections and
// the Percentage layout section) and About work.
//
// A view is render(ctx) -> [nodes]. ctx is the shell context (shell.js):
// t, lang, digits, settings, state, outcomes, store, checks, build and the
// actions (setTheme, setLanguage, setDigits, setPseudo, retry, reset).
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, value, withValues } = ns.dom;

  const MILESTONES = Object.freeze({
    standard: "M5b", scientific: "M5c", graphing: "M8", programmer: "M6",
    date: "M2b", percent: "M2c", mini: "M5b+"
  });

  // The catalog key of a route's title ("converter/length" -> "route.converter.length").
  const titleKey = (route) => "route." + route.replace("/", ".");

  function panel(titleText, children, attrs) {
    return el("section", { className: "panel", attrs }, [el("h2", { className: "panel-title", text: titleText }), ...children]);
  }

  function placeholder(ctx, route) {
    const t = ctx.t;
    const converter = route.startsWith("converter/");
    const milestone = converter ? "M7" : MILESTONES[route] || "M10";
    const name = t(titleKey(route));
    return [
      panel(name, [
        el("p", { className: "placeholder-when", text: t("view.placeholder.coming", { milestone }) }),
        el("p", { className: "status", text: converter ? t("view.placeholder.converter", { name }) : t("view.placeholder.body") })
      ], { "data-state": "placeholder" })
    ];
  }

  // ---- Settings -------------------------------------------------------------

  function radioGroup(name, legend, options, current, onPick) {
    const items = options.map(([value, label]) => {
      const id = name + "-" + value;
      const input = el("input", { attrs: { type: "radio", name, id, value } });
      input.checked = value === current;
      input.addEventListener("change", () => {
        if (input.checked) onPick(value);
      });
      return el("label", { className: "choice", attrs: { for: id } }, [input, el("span", { text: label })]);
    });
    return el("fieldset", { className: "choices" }, [el("legend", { text: legend }), ...items]);
  }

  function select(id, label, options, current, onPick) {
    const node = el("select", { className: "select", attrs: { id } },
      options.map(([value, text]) => {
        const option = el("option", { text, attrs: { value } });
        option.selected = value === current;
        return option;
      })
    );
    node.addEventListener("change", () => onPick(node.value));
    return el("div", { className: "field" }, [el("label", { className: "field-label", text: label, attrs: { for: id } }), node]);
  }

  function docRows(ctx) {
    const t = ctx.t;
    return el("ul", { className: "doc-list" },
      ns.store.NAMES.map((name) => {
        const o = ctx.outcomes[name];
        const status = o ? o.status : "empty";
        return el("li", { className: "doc-row", attrs: { "data-doc": name, "data-state": status } }, [
          el("span", { className: "doc-name", text: t("store.doc." + name) }),
          el("span", { className: o && o.readOnly ? "doc-status warn" : "doc-status", text: t("store.status." + status) })
        ]);
      })
    );
  }

  // Settings > History: history.enabled controls recording (plan B10).
  function historySettings(ctx) {
    const t = ctx.t;
    const box = el("input", { attrs: { id: "historyEnabled", type: "checkbox", "aria-describedby": "historyEnabledNote" } });
    box.checked = ctx.settings.history.enabled !== false;
    box.addEventListener("change", () => {
      ctx.settings.history.enabled = box.checked;
      ctx.saveSettings();
    });
    return panel(t("settings.history"), [
      el("label", { className: "choice check-row", attrs: { for: "historyEnabled" } }, [box, el("span", { text: t("settings.history.enabled") })]),
      el("p", { className: "hint", text: t("settings.history.note"), attrs: { id: "historyEnabledNote" } })
    ], { id: "settingsHistory" });
  }

  function settings(ctx) {
    const t = ctx.t;
    const f = ns.format;
    const s = ctx.settings;
    const themes = ns.theme.PREFS.map((p) => [p, t("settings.theme." + p)]);
    const resolved = ns.i18n.resolve("auto", navigator.languages || [navigator.language], Object.keys(ns.catalogs));
    const languages = [["auto", t("settings.language.auto", { name: ns.i18n.NATIVE_NAMES[resolved] })]].concat(
      Object.keys(ns.catalogs).map((code) => [code, ns.i18n.NATIVE_NAMES[code] || code])
    );
    const sample = t("settings.sample", {
      number: value(f.isolate(f.formatNumber("1234567.89", ctx.lang, { digits: ctx.digits, grouping: s.display.grouping }))),
      date: value(f.isolate(f.formatDate("2026-11-18", ctx.lang, { digits: ctx.digits })))
    });
    // Static facts, filled in once known: no live region (it would be
    // announced again on every re-render of Settings).
    const storageNote = el("p", { className: "status", attrs: { id: "storageEstimate" } });
    const persistNote = el("p", { className: "status", attrs: { id: "storagePersist" } });
    ctx.describeStorage(storageNote, persistNote);

    const out = [
      panel(t("settings.appearance"), [
        radioGroup("theme", t("settings.theme"), themes, s.appearance.theme, (v) => ctx.setTheme(v)),
        el("p", { className: "hint", text: t("settings.theme.systemHint") })
      ], { id: "settingsAppearance" }),
      panel(t("settings.language"), [
        select("languageSelect", t("settings.language.label"), languages, s.language.code, (v) => ctx.setLanguage(v)),
        select("digitsSelect", t("settings.digits"), [
          ["auto", t("settings.digits.auto")],
          ["western", t("settings.digits.western")],
          ["arabic-indic", t("settings.digits.arabic")]
        ], s.language.digits, (v) => ctx.setDigits(v)),
        el("p", { className: "sample", attrs: { id: "formatSample", dir: "auto" } }, withValues(sample)),
        el("p", { className: "hint", text: t("settings.language.note") })
      ], { id: "settingsLanguage" }),
      historySettings(ctx),
      panel(t("settings.storage"), [
        el("p", { className: "status", text: t("settings.storage.kind." + ctx.store.kind) }),
        persistNote,
        storageNote,
        docRows(ctx)
      ], { id: "settingsStorage" }),
      ...ns.dateSettings.panels(ctx),
      ...ns.percentTool.settingsPanels(ctx)
    ];
    if (ctx.devTools) {
      out.push(panel(t("settings.dev"), [
        select("pseudoSelect", t("settings.dev.pseudo"), [
          ["off", t("settings.dev.off")],
          ["en-XA", ns.i18n.NATIVE_NAMES["en-XA"]],
          ["ar-XB", ns.i18n.NATIVE_NAMES["ar-XB"]]
        ], ctx.state.dev.pseudoLocale, (v) => ctx.setPseudo(v)),
        el("p", { className: "hint", text: t("settings.dev.note") })
      ], { id: "settingsDeveloper" }));
    }
    return out;
  }

  // ---- About ----------------------------------------------------------------

  function about(ctx) {
    const t = ctx.t;
    const info = ctx.platform.engineInfo();
    const rows = ctx.checks.rows;
    const passed = rows.filter((r) => r.passed).length;
    const list = el("ul", { className: "check-list" },
      rows.map((row) =>
        el("li", { className: row.passed ? "check pass" : "check fail", attrs: { "data-check": row.key } }, [
          el("span", { className: "check-name", text: t(row.key) }),
          el("span", { className: "check-result", text: t(row.passed ? "result.pass" : "result.fail") })
        ])
      )
    );
    const versions = [];
    if (ctx.checks.versions) {
      const v = ctx.checks.versions;
      versions.push(el("li", { text: t("versions.api", { version: v.api }) }));
      for (const [name, version] of Object.entries(v.engines)) versions.push(el("li", { text: t("versions.engine", { name, version }) }));
    }
    return [
      panel(t("app.title"), [
        el("p", { className: "status", text: t("about.version", { version: ns.build.appVersion }) }),
        el("p", { className: "chip", text: t("boot.platform." + ctx.platform.name) }),
        el("p", { className: "status", text: t(info.kind === "wasm" ? "about.engine.wasm" : "about.engine.native") }),
        el("p", { className: "status", text: t("about.privacy") })
      ], { id: "aboutApp" }),
      panel(t("about.checks"), [
        el("p", { className: passed === rows.length ? "summary pass" : "summary fail",
          text: (passed === rows.length ? t("boot.ready") : t("boot.failed")) + " · " + t("boot.passed", { count: passed }) }),
        list
      ], { id: "aboutChecks" }),
      panel(t("about.versions"), [el("ul", { className: "versions" }, versions)], { id: "aboutVersions" }),
      panel(t("about.shortcuts"), [
        el("ul", { className: "plain-list" }, [
          el("li", { text: t("about.shortcuts.tools") }),
          el("li", { text: t("about.shortcuts.history") }),
          el("li", { text: t("about.shortcuts.escape") })
        ])
      ]),
      panel(t("about.languages.title"), [el("p", { className: "status", text: t("about.languages") })])
    ];
  }

  function render(ctx, route) {
    // A tool that leaves stops its timers and flushes what it must save.
    if (route !== "date") ns.dateTool.leave();
    if (route !== "percent") ns.percentTool.leave();
    if (route === "date") return ns.dateTool.render(ctx);
    if (route === "percent") return ns.percentTool.render(ctx);
    if (route === "settings") return settings(ctx);
    if (route === "about") return about(ctx);
    return placeholder(ctx, route);
  }

  ns.views = Object.freeze({ render, titleKey, MILESTONES });
})();
