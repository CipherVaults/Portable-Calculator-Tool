// The phone-first app shell (plan B5): a top bar with the ☰ drawer button,
// the current tool's title and the pane button; the drawer (Calculator,
// Tools, Converter, then Settings and About); the main view; and the
// History | Memory | Countdowns pane.
//
// Layout by width (styles/shell.css; JS only keeps the semantics in step):
//   < 760 px     drawer: modal sheet from the inline start; pane: bottom
//                sheet (open/close buttons, no dragging, safe-area insets)
//   760-1100 px  drawer: modal; pane: modal overlay from the inline end
//   >= 1100 px   drawer pinned as a column; pane docked as a column
// A modal drawer or pane traps Tab inside itself, closes on Esc or the
// scrim, makes the rest of the page (footer included) inert, stops the page
// behind it scrolling (<html data-modal>) and returns focus to the button
// that opened it (its toggle when the tap did not focus it, as in Safari).
// Crossing 1100 px keeps the pane's open state and moves focus that was in
// a closed or hidden part to its counterpart in the new layout.
//
// Keys: Alt+1 … Alt+6 open Standard, Scientific, Graphing, Programmer,
// Date and Percentage; Ctrl+H shows or hides the history pane; Esc closes
// the open drawer or pane. The shortcuts never fire while an input method
// is composing or in a text field, a select or editable content (macOS
// types characters with Option+digit, and Ctrl+H deletes there).
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, byId, show, flag } = ns.dom;
  const router = ns.router;
  const PANE_TABS = Object.freeze(["history", "memory", "countdowns"]);
  const WIDE = "(min-width: 1100px)";

  const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

  function media(query) {
    try {
      return window.matchMedia(query);
    } catch (_) {
      return { matches: false, addEventListener() {} };
    }
  }

  // Builds the shell into `root` and returns its controller. ctx: see
  // views.js; it gains `shell` (this controller).
  function start(root, ctx) {
    const wide = media(WIDE);
    let modal = null; // { name: "drawer" | "pane", opener, container }
    let route = router.current();
    let resetArmed = null;
    let pendingFocus = false;

    const t = () => ctx.t;
    const nodes = {};

    function build() {
      const tt = t();
      nodes.drawerToggle = el("button", { className: "icon-button", text: "☰",
        attrs: { id: "drawerToggle", type: "button", "aria-controls": "drawer", "aria-expanded": "false", "aria-label": tt("shell.menu.open") } });
      nodes.title = el("h1", { className: "topbar-title", attrs: { id: "routeTitle" } });
      nodes.paneToggle = el("button", { className: "icon-button", text: "⟲",
        attrs: { id: "paneToggle", type: "button", "aria-controls": "pane", "aria-expanded": "false", "aria-label": tt("pane.open") } });
      nodes.topbar = el("header", { className: "topbar", attrs: { id: "topbar" } }, [nodes.drawerToggle, nodes.title, nodes.paneToggle]);

      nodes.links = new Map();
      const group = (key, routes) =>
        el("section", { className: "nav-group" }, [
          el("h2", { className: "nav-group-title", text: tt("nav.group." + key) }),
          el("ul", { className: "nav-list" }, routes.map((r) => {
            const a = el("a", { className: "nav-link", text: tt(ns.views.titleKey(r)), attrs: { href: "#/" + r, "data-route": r } });
            nodes.links.set(r, a);
            return el("li", {}, [a]);
          }))
        ]);
      nodes.drawerClose = el("button", { className: "icon-button drawer-close", text: "✕",
        attrs: { id: "drawerClose", type: "button", "aria-label": tt("shell.menu.close") } });
      nodes.drawer = el("nav", { className: "drawer", attrs: { id: "drawer", "aria-labelledby": "drawerTitle" } }, [
        el("div", { className: "drawer-head" }, [el("p", { className: "drawer-title", text: tt("app.title"), attrs: { id: "drawerTitle" } }), nodes.drawerClose]),
        ...router.GROUPS.map((g) => group(g.key, g.routes)),
        group("app", ["settings", "about"])
      ]);

      nodes.banners = el("div", { className: "banners", attrs: { id: "banners" } });
      nodes.viewBody = el("div", { className: "view-body", attrs: { id: "viewBody" } });
      nodes.view = el("main", { className: "view", attrs: { id: "view", tabindex: "-1", "aria-labelledby": "routeTitle" } }, [nodes.banners, nodes.viewBody]);

      nodes.tabs = new Map();
      const tabList = el("div", { className: "pane-tabs", attrs: { role: "tablist", "aria-label": tt("pane.title") } },
        PANE_TABS.map((tab) => {
          const b = el("button", { className: "pane-tab", text: tt("pane.tab." + tab),
            attrs: { id: "paneTab-" + tab, type: "button", role: "tab", "aria-controls": "panePanel", "data-tab": tab } });
          nodes.tabs.set(tab, b);
          return b;
        })
      );
      nodes.paneClose = el("button", { className: "icon-button", text: "✕", attrs: { id: "paneClose", type: "button", "aria-label": tt("pane.close") } });
      nodes.panePanel = el("div", { className: "pane-panel", attrs: { id: "panePanel", role: "tabpanel", tabindex: "0" } });
      nodes.pane = el("aside", { className: "pane", attrs: { id: "pane", "aria-labelledby": "paneTitle" } }, [
        el("div", { className: "pane-head" }, [el("h2", { className: "pane-title", text: tt("pane.title"), attrs: { id: "paneTitle" } }), nodes.paneClose]),
        tabList,
        nodes.panePanel
      ]);
      nodes.scrim = el("div", { className: "scrim", attrs: { id: "scrim", hidden: true } });
      nodes.shell = el("div", { className: "shell", attrs: { id: "shell" } }, [nodes.topbar, nodes.drawer, nodes.view, nodes.pane, nodes.scrim]);
      show(root, [nodes.shell]);

      nodes.drawerToggle.addEventListener("click", () => (modal && modal.name === "drawer" ? closeModal() : openDrawer()));
      nodes.drawerClose.addEventListener("click", () => closeModal());
      nodes.paneToggle.addEventListener("click", () => togglePane());
      nodes.paneClose.addEventListener("click", () => setPane(false));
      nodes.scrim.addEventListener("click", () => closeModal());
      for (const [tab, b] of nodes.tabs) b.addEventListener("click", () => selectTab(tab));
      tabList.addEventListener("keydown", onTabKey);
      nodes.drawer.addEventListener("click", (e) => {
        const link = e.target && e.target.closest ? e.target.closest("a.nav-link") : null;
        if (!link) return;
        e.preventDefault();
        const r = link.getAttribute("data-route");
        if (modal && modal.name === "drawer") closeModal({ restoreFocus: false });
        navigate(r, { focus: true });
      });
    }

    // ---- modal handling --------------------------------------------------

    const drawerIsModal = () => !wide.matches;
    const paneIsModal = () => !wide.matches;

    // Everything but the open modal is inert (where supported) and hidden
    // from assistive technology; the focus trap covers older browsers.
    function setInert(except) {
      for (const n of [nodes.topbar, nodes.drawer, nodes.view, nodes.pane, byId("appFooter")]) {
        if (!n) continue;
        const on = except !== null && n !== except;
        flag(n, "inert", on);
        if (on) n.setAttribute("aria-hidden", "true");
        else n.removeAttribute("aria-hidden");
      }
    }

    function focusables(container) {
      return Array.from(container.querySelectorAll(FOCUSABLE)).filter((n) => !n.closest("[hidden]"));
    }

    // The element focus returns to: the focused control, or the modal's
    // toggle when nothing in the shell has focus (Safari does not focus a
    // button on tap or click, so activeElement is <body>).
    function openerFor(toggle) {
      const active = document.activeElement;
      if (!active || active === document.body || active === document.documentElement || !nodes.shell.contains(active)) return toggle;
      return active;
    }

    function openModal(name, container, toggle) {
      modal = { name, opener: openerFor(toggle), container };
      flag(nodes.scrim, "hidden", false);
      container.setAttribute("role", "dialog");
      container.setAttribute("aria-modal", "true");
      setInert(container);
      nodes.shell.setAttribute("data-modal", name);
      document.documentElement.setAttribute("data-modal", name);
      const first = focusables(container)[0];
      if (first) first.focus();
    }

    function closeModal(opts) {
      if (!modal) return;
      const { name, opener, container } = modal;
      modal = null;
      flag(nodes.scrim, "hidden", true);
      container.removeAttribute("role");
      container.removeAttribute("aria-modal");
      setInert(null);
      nodes.shell.removeAttribute("data-modal");
      document.documentElement.removeAttribute("data-modal");
      if (name === "drawer") {
        flag(nodes.drawer, "hidden", drawerIsModal());
        nodes.drawerToggle.setAttribute("aria-expanded", "false");
      } else if (!opts || !opts.layoutChange) {
        setPane(false, { fromModal: true });
      }
      if (!opts || opts.restoreFocus !== false) {
        // A rebuilt shell replaced the opener: use the new toggle.
        const back = opener && document.contains(opener) ? opener : name === "drawer" ? nodes.drawerToggle : nodes.paneToggle;
        if (back && typeof back.focus === "function") back.focus();
      }
    }

    function openDrawer() {
      if (!drawerIsModal()) return;
      if (modal) closeModal({ restoreFocus: false });
      flag(nodes.drawer, "hidden", false);
      nodes.drawerToggle.setAttribute("aria-expanded", "true");
      openModal("drawer", nodes.drawer, nodes.drawerToggle);
    }

    // Focus trap: Tab and Shift+Tab cycle inside the open modal.
    function trap(e) {
      if (!modal || e.key !== "Tab") return;
      const list = focusables(modal.container);
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !modal.container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !modal.container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    // ---- pane --------------------------------------------------------------

    function selectTab(tab, opts) {
      if (!PANE_TABS.includes(tab)) return;
      for (const [name, b] of nodes.tabs) {
        const on = name === tab;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.setAttribute("tabindex", on ? "0" : "-1");
      }
      nodes.panePanel.setAttribute("aria-labelledby", "paneTab-" + tab);
      show(nodes.panePanel, [el("p", { className: "status", text: t()("pane.empty." + tab) })]);
      if (ctx.state.pane.tab !== tab) {
        ctx.state.pane.tab = tab;
        if (!opts || opts.save !== false) ctx.saveState();
      }
      if (opts && opts.focus) nodes.tabs.get(tab).focus();
    }

    // Arrow keys move between tabs (WAI-ARIA tabs pattern).
    function onTabKey(e) {
      const i = PANE_TABS.indexOf(ctx.state.pane.tab);
      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      let next = null;
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next = PANE_TABS[(i + 1) % PANE_TABS.length];
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) next = PANE_TABS[(i + PANE_TABS.length - 1) % PANE_TABS.length];
      else if (e.key === "Home") next = PANE_TABS[0];
      else if (e.key === "End") next = PANE_TABS[PANE_TABS.length - 1];
      if (next) {
        e.preventDefault();
        selectTab(next, { focus: true });
      }
    }

    function setPane(open, opts) {
      const o = opts || {};
      if (!open && modal && modal.name === "pane" && !o.fromModal) {
        closeModal();
        return;
      }
      flag(nodes.pane, "hidden", !open);
      nodes.paneToggle.setAttribute("aria-expanded", open ? "true" : "false");
      nodes.shell.setAttribute("data-pane", open ? "open" : "closed");
      if (ctx.state.pane.open !== open) {
        ctx.state.pane.open = open;
        ctx.saveState();
      }
      if (open && paneIsModal() && !o.restoring) {
        if (modal) closeModal({ restoreFocus: false });
        openModal("pane", nodes.pane, nodes.paneToggle);
        const tab = nodes.tabs.get(ctx.state.pane.tab);
        if (tab) tab.focus();
      } else if (open && o.focus) {
        const tab = nodes.tabs.get(ctx.state.pane.tab);
        if (tab) tab.focus();
      }
    }

    function togglePane() {
      setPane(nodes.pane.hasAttribute("hidden"), { focus: true });
    }

    // Re-applies the layout semantics when the width crosses 1100 px (a
    // tablet turned, a window resized). The pane's open state is kept; an
    // open pane only waits to be asked for again on a narrow screen. Focus
    // that was in the drawer or pane moves to its counterpart in the new
    // layout instead of falling to <body>.
    function onWidth() {
      const active = document.activeElement;
      const wasIn = nodes.drawer.contains(active) ? "drawer" : nodes.pane.contains(active) ? "pane" : null;
      if (modal) closeModal({ restoreFocus: false, layoutChange: true });
      flag(nodes.drawer, "hidden", drawerIsModal());
      flag(nodes.drawerToggle, "hidden", !drawerIsModal());
      nodes.shell.setAttribute("data-layout", wide.matches ? "wide" : "narrow");
      // A pane left open on a narrow screen stays closed until asked for.
      const open = ctx.state.pane.open && !paneIsModal();
      flag(nodes.pane, "hidden", !open);
      nodes.paneToggle.setAttribute("aria-expanded", open ? "true" : "false");
      nodes.shell.setAttribute("data-pane", open ? "open" : "closed");
      if (wasIn === "pane") {
        const tab = nodes.tabs.get(ctx.state.pane.tab);
        if (open && tab) tab.focus();
        else nodes.paneToggle.focus();
      } else if (wasIn === "drawer") {
        if (drawerIsModal()) nodes.drawerToggle.focus();
        else {
          const link = nodes.links.get(route) || nodes.links.values().next().value;
          if (link) link.focus();
        }
      }
    }

    // ---- routes ------------------------------------------------------------

    function renderRoute(r, opts) {
      route = r;
      const tt = t();
      nodes.title.textContent = tt(ns.views.titleKey(r));
      document.title = tt(ns.views.titleKey(r)) + " · " + tt("app.title");
      for (const [name, a] of nodes.links) {
        if (name === r) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      }
      show(nodes.viewBody, ns.views.render(ctx, r));
      nodes.shell.setAttribute("data-route", r);
      document.documentElement.setAttribute("data-route", r);
      if (ctx.state.route !== r) {
        ctx.state.route = r;
        ctx.saveState();
      }
      if (opts && opts.fresh) window.scrollTo(0, 0);
      if (opts && opts.focus) nodes.view.focus({ preventScroll: true });
    }

    function navigate(r, opts) {
      if (!router.known(r)) return;
      pendingFocus = Boolean(opts && opts.focus);
      if (router.current() === r && router.explicit()) renderRoute(r, opts);
      else router.go(r);
    }

    // ---- banners -----------------------------------------------------------

    function renderBanners() {
      const tt = t();
      const items = [];
      if (ctx.store.kind === "memory") items.push(el("p", { className: "banner", text: tt("banner.memory"), attrs: { role: "status", "data-state": "memory" } }));
      for (const name of ns.store.NAMES) {
        const o = ctx.outcomes[name];
        if (!o || !o.readOnly) continue;
        const docName = tt("store.doc." + name);
        const text = o.status === "newer" ? tt("banner.newer", { doc: docName }) : tt("banner.readOnly", { doc: docName });
        const retry = el("button", { className: "button", text: tt("banner.retry"), attrs: { type: "button", "data-doc": name } });
        retry.addEventListener("click", () => ctx.retry(name));
        // A document written by a newer app is never replaced or backed up
        // here (B10): Retry only, and the banner says to update.
        if (o.status === "newer") {
          items.push(el("div", { className: "banner", attrs: { role: "status", "data-doc": name, "data-state": o.status } }, [
            el("p", { className: "banner-text", text }),
            el("div", { className: "button-row" }, [retry])
          ]));
          continue;
        }
        const armed = resetArmed === name;
        const reset = el("button", { className: armed ? "button danger" : "button", text: tt(armed ? "banner.resetConfirm" : "banner.reset"),
          attrs: { type: "button", "data-doc": name, "data-state": armed ? "armed" : "idle" } });
        reset.addEventListener("click", () => {
          if (resetArmed === name) {
            resetArmed = null;
            ctx.reset(name);
          } else {
            resetArmed = name;
            renderBanners();
            const again = nodes.banners.querySelector("button[data-state='armed']");
            if (again) again.focus();
          }
        });
        items.push(el("div", { className: "banner", attrs: { role: "status", "data-doc": name, "data-state": o.status } }, [
          el("p", { className: "banner-text", text }),
          el("div", { className: "button-row" }, [retry, reset])
        ]));
      }
      if (ctx.lastSaveError) {
        items.push(el("p", { className: "banner", text: tt("banner.saveFailed", { doc: tt("store.doc." + ctx.lastSaveError.name), reason: ctx.lastSaveError.code }),
          attrs: { role: "status", "data-state": "save-failed" } }));
      }
      show(nodes.banners, items);
      flag(nodes.banners, "hidden", items.length === 0);
    }

    // ---- keyboard ------------------------------------------------------------

    // A field where keys type text (or pick an option): shortcuts stay out.
    const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local", "month", "week"]);
    function editable(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.isContentEditable) return true;
      const tag = node.localName;
      if (tag === "textarea" || tag === "select") return true;
      return tag === "input" && TEXT_INPUTS.has(String(node.getAttribute("type") || "").toLowerCase());
    }

    function onKey(e) {
      trap(e);
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && modal) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.isComposing || editable(e.target)) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code || "");
        if (m) {
          e.preventDefault();
          if (modal) closeModal({ restoreFocus: false });
          navigate(router.SHORTCUTS[Number(m[1]) - 1], { focus: true });
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        togglePane();
      }
    }

    // ---- lifecycle -----------------------------------------------------------

    // Rebuilding or re-rendering replaces the focused control (a Settings
    // select whose change re-labels the app): focus goes back to the control
    // with the same id, without scrolling (WCAG 2.4.3, 3.2.2).
    function keepingFocus(fn) {
      const active = document.activeElement;
      const id = active && active !== document.body && typeof active.getAttribute === "function" ? active.getAttribute("id") : null;
      fn();
      if (!id || document.activeElement === active) return;
      const again = byId(id);
      if (again && again !== document.activeElement) again.focus({ preventScroll: true });
    }

    build();
    const controller = {
      rebuild() {
        keepingFocus(() => {
          const wasModal = modal ? modal.name : null;
          if (modal) closeModal({ restoreFocus: false, layoutChange: true });
          build();
          onWidth();
          selectTab(ctx.state.pane.tab, { save: false });
          renderRoute(route);
          renderBanners();
          if (wasModal === "pane") setPane(true);
        });
      },
      renderBanners,
      refresh: () => keepingFocus(() => renderRoute(route)),
      navigate,
      openDrawer,
      closeModal,
      setPane,
      modal: () => (modal ? modal.name : null),
      route: () => route
    };
    ctx.shell = controller;

    onWidth();
    selectTab(PANE_TABS.includes(ctx.state.pane.tab) ? ctx.state.pane.tab : "history", { save: false });
    renderRoute(route);
    renderBanners();
    wide.addEventListener("change", onWidth);
    document.addEventListener("keydown", onKey);
    router.onChange((r) => {
      const focus = pendingFocus;
      pendingFocus = false;
      if (modal && modal.name === "drawer") closeModal({ restoreFocus: false });
      renderRoute(r, { focus, fresh: true });
    });
    return controller;
  }

  ns.shell = Object.freeze({ start, PANE_TABS });
})();
