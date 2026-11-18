// Card layout (plan B9, B11; Date Calculator v1.2.0 plan A8, ported from
// Percentage Calculator Tool v2.3.0): every card of a tool collapses to its
// title row and moves by its ⠿ handle, with a pointer (mouse, pen, touch),
// with ArrowUp/ArrowDown on the focused handle, or through the Move menu a
// tap, click or Enter/Space on the handle opens (WCAG 2.5.7, so a phone
// screen-reader user can reorder with single taps). Collapsing only toggles
// a class: inputs keep their values and live results keep updating.
//
// The tool owns the state ({cardOrder, collapsedCards}, stored in its
// settings section) and saves it in onChange; the launch writes nothing.
//
//   const layout = PCalc.cardLayout.create({ container, keys, title(key),
//     t, state, onChange(state, {reset}), onExpand(key), live, hintId });
//   layout.card(key, title, subtitle, bodyNodes) -> <section>
//   layout.mount()          wires the cards and applies the state
//   layout.reset()          default order, every card expanded, saved
//   layout.expand(key)      opens a collapsed card (and saves that)
//   layout.destroy()        removes the document listeners
(function () {
  "use strict";
  const { el, flag } = window.PCalc.dom;

  // A drag starts after 4 px with a mouse and 10 px with a finger or pen:
  // a tap often wanders a few px (Android's touch slop is about 8 dp).
  // Holding within 60 px of the top or bottom edge auto-scrolls, at up to
  // 12 px a frame, but only once the drag has travelled 24 px or been held
  // for 300 ms, so a wobbly tap near an edge never scrolls the page.
  const DRAG_START_PX = 4;
  const DRAG_START_TOUCH_PX = 10;
  const DRAG_EDGE_PX = 60;
  const DRAG_SCROLL_PX = 12;
  const DRAG_EDGE_ARM_PX = 24;
  const DRAG_EDGE_HOLD_MS = 300;

  function create(opts) {
    const { container, keys, t } = opts;
    let state = { cardOrder: opts.state.cardOrder.slice(), collapsedCards: opts.state.collapsedCards.slice() };
    const cards = new Map();
    let drag = null;
    let clickGuard = null; // the handle whose next click ends a real drag
    let menuKey = "";
    let announceTimer = 0;
    const docListeners = [];

    const title = (key) => opts.title(key);
    const collapsed = (key) => state.collapsedCards.includes(key);

    // ---- building -----------------------------------------------------------

    function card(key, titleText, subtitleText, body) {
      const handle = el("button", { className: "card-handle", text: "⠿",
        attrs: { type: "button", "aria-label": t("layout.move", { title: titleText }), "aria-describedby": opts.hintId, title: t("layout.dragTitle") } });
      const toggle = el("button", { className: "card-collapse",
        attrs: { type: "button", "aria-expanded": "true", "aria-controls": "card-" + key + "-body", "aria-label": t("layout.collapse", { title: titleText }) } });
      const slot = el("div", { className: "card-menu-slot" });
      const bodyNode = el("div", { className: "card-body", attrs: { id: "card-" + key + "-body" } }, body);
      const section = el("section", { className: "tool-card", attrs: { id: "card-" + key, "data-card": key, "aria-labelledby": "card-" + key + "-title" } }, [
        el("div", { className: "card-head" }, [
          handle,
          el("div", { className: "card-heading" }, [
            el("h2", { className: "card-title", text: titleText, attrs: { id: "card-" + key + "-title" } }),
            subtitleText ? el("p", { className: "card-subtitle", text: subtitleText }) : null
          ]),
          toggle
        ]),
        slot,
        bodyNode
      ]);
      cards.set(key, { section, handle, toggle, slot, body: bodyNode });
      return section;
    }

    const menu = el("div", { className: "card-move-menu", attrs: { id: "cardMoveMenu", role: "group", hidden: true } },
      [["up", "layout.moveUp"], ["down", "layout.moveDown"], ["done", "layout.moveDone"]].map(([action, key]) => {
        const b = el("button", { className: "button card-move-button", text: t(key), attrs: { type: "button", "data-value": action } });
        b.addEventListener("click", () => onMenuAction(action, b));
        return b;
      })
    );

    // ---- state ----------------------------------------------------------------

    function domOrder() {
      return Array.from(container.children, (n) => n.getAttribute("data-card")).filter((k) => keys.includes(k));
    }

    function renderCollapsed(key) {
      const c = cards.get(key);
      if (!c) return;
      const on = collapsed(key);
      c.section.classList.toggle("is-collapsed", on);
      flag(c.body, "hidden", on);
      c.toggle.setAttribute("aria-expanded", on ? "false" : "true");
      c.toggle.setAttribute("aria-label", t(on ? "layout.expand" : "layout.collapse", { title: title(key) }));
      const glyph = on ? "[ + ]" : "[ − ]";
      if (c.toggle.textContent !== glyph) c.toggle.textContent = glyph;
    }

    // Puts the cards in `order`, keeping focus that was inside one of them
    // (moving a node drops its focus in a browser).
    function applyOrder(order) {
      const active = document.activeElement;
      const had = Boolean(active && active !== document.body && container.contains(active));
      const now = domOrder();
      if (now.join() !== order.join()) container.replaceChildren(...order.map((k) => cards.get(k).section));
      if (had && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    }

    function apply() {
      applyOrder(state.cardOrder);
      for (const key of keys) renderCollapsed(key);
    }

    function changed(extra) {
      opts.onChange({ cardOrder: state.cardOrder.slice(), collapsedCards: state.collapsedCards.slice() }, extra || {});
    }

    function setCollapsed(key, on) {
      if (!keys.includes(key) || collapsed(key) === on) {
        renderCollapsed(key);
        return false;
      }
      state.collapsedCards = on ? state.collapsedCards.concat(key) : state.collapsedCards.filter((k) => k !== key);
      renderCollapsed(key);
      if (!on && opts.onExpand) opts.onExpand(key);
      changed();
      return true;
    }

    function setOrder(order) {
      if (order.join() === state.cardOrder.join()) return false;
      state.cardOrder = order.slice();
      applyOrder(state.cardOrder);
      updateMenuEdges();
      changed();
      return true;
    }

    // Polite, and re-announced when the same text repeats (a move at an end).
    function announce(text) {
      const live = opts.live;
      if (!live) return;
      window.clearTimeout(announceTimer);
      announceTimer = 0;
      if (live.textContent !== text) {
        live.textContent = text;
        return;
      }
      live.textContent = "";
      announceTimer = window.setTimeout(() => {
        announceTimer = 0;
        live.textContent = text;
      }, 60);
    }

    function moved(key, order) {
      announce(t("layout.moved", { title: title(key), position: order.indexOf(key) + 1, total: order.length }));
    }

    // ArrowUp/ArrowDown on the handle, or Move up / Move down in the menu:
    // one place, focus kept on the handle or the pressed button.
    function moveBy(key, delta, focusEl) {
      finishDrag(true);
      const order = domOrder();
      const from = order.indexOf(key);
      if (from < 0) return;
      const to = Math.max(0, Math.min(order.length - 1, from + delta));
      if (to !== from) {
        order.splice(from, 1);
        order.splice(to, 0, key);
        setOrder(order);
      }
      const target = focusEl || cards.get(key).handle;
      if (target.isConnected && document.activeElement !== target) target.focus({ preventScroll: true });
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });
      moved(key, order);
    }

    // ---- pointer drag -----------------------------------------------------------

    function clearDropHints() {
      for (const c of cards.values()) c.section.classList.remove("drop-before", "drop-after");
    }

    // The card under the pointer's height gets one drop line before or after.
    function updateDropTarget(x, y) {
      if (!drag) return;
      clearDropHints();
      drag.target = null;
      const boxes = [];
      for (const key of domOrder()) {
        const c = cards.get(key);
        if (c.section === drag.card) continue;
        const r = c.section.getBoundingClientRect();
        if (![r.top, r.bottom, r.left, r.right].every(Number.isFinite)) continue;
        boxes.push({ card: c.section, r });
      }
      if (boxes.length === 0) return;
      const box = container.getBoundingClientRect();
      const inBand = (x >= box.left - 80 && x <= box.right + 80) || boxes.some(({ r }) => x >= r.left && x <= r.right);
      if (!inBand) return;
      let target;
      if (y < boxes[0].r.top) target = boxes[0];
      else if (y > boxes[boxes.length - 1].r.bottom) target = boxes[boxes.length - 1];
      else {
        const dist = ({ r }) => Math.abs(y - (r.top + r.bottom) / 2);
        target = boxes.reduce((best, b) => (dist(b) < dist(best) ? b : best));
      }
      drag.target = target.card;
      drag.after = y >= (target.r.top + target.r.bottom) / 2;
      target.card.classList.add(drag.after ? "drop-after" : "drop-before");
    }

    function edgeDelta(y) {
      const h = window.innerHeight || 0;
      let depth = 0;
      if (y < DRAG_EDGE_PX) depth = y - DRAG_EDGE_PX;
      else if (y > h - DRAG_EDGE_PX) depth = y - (h - DRAG_EDGE_PX);
      if (depth === 0) return 0;
      const step = Math.round((DRAG_SCROLL_PX * Math.min(Math.abs(depth), DRAG_EDGE_PX)) / DRAG_EDGE_PX);
      return Math.sign(depth) * Math.max(2, step);
    }

    const frame = (fn) => (typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(fn) : 0);

    function scrollDrag() {
      if (!drag || !drag.moved || !drag.edgeArmed) return;
      const delta = edgeDelta(drag.y);
      if (delta !== 0) {
        if (typeof window.scrollBy === "function") window.scrollBy({ top: delta, behavior: "instant" });
        updateDropTarget(drag.x, drag.y);
        drag.frame = frame(scrollDrag);
      } else {
        drag.frame = 0;
      }
    }

    function armEdge() {
      if (!drag || !drag.moved) return;
      drag.armTimer = 0;
      drag.edgeArmed = true;
      if (!drag.frame && edgeDelta(drag.y) !== 0) drag.frame = frame(scrollDrag);
    }

    function finishDrag(cancelled, event) {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      if (!cancelled && drag.moved && event) updateDropTarget(event.clientX, event.clientY);
      const d = drag;
      drag = null;
      if (d.frame && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(d.frame);
      if (d.armTimer) window.clearTimeout(d.armTimer);
      if (d.moved) clickGuard = d.handle;
      d.card.classList.remove("is-dragging");
      clearDropHints();
      try {
        if (typeof d.handle.releasePointerCapture === "function") d.handle.releasePointerCapture(d.pointerId);
      } catch (_) {
        // A synthetic or already released pointer has no capture.
      }
      if (cancelled || !d.moved || !d.target) return;
      const order = domOrder().filter((k) => k !== d.key);
      let at = order.indexOf(d.target.getAttribute("data-card"));
      if (at < 0) return;
      if (d.after) at++;
      order.splice(at, 0, d.key);
      if (setOrder(order)) moved(d.key, order);
    }

    function onPointerDown(key, event) {
      if (drag || (event.button || 0) !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      const c = cards.get(key);
      clickGuard = null;
      drag = { key, card: c.section, handle: c.handle, pointerId: event.pointerId, pointerType: event.pointerType || "",
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        moved: false, target: null, after: false, frame: 0, edgeArmed: false, armTimer: 0 };
      try {
        if (typeof c.handle.setPointerCapture === "function") c.handle.setPointerCapture(event.pointerId);
      } catch (_) {
        // The document listeners also follow an uncaptured pointer.
      }
    }

    function onPointerMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.moved) {
        const threshold = drag.pointerType === "mouse" ? DRAG_START_PX : DRAG_START_TOUCH_PX;
        if (dist < threshold) return;
        drag.moved = true;
        drag.card.classList.add("is-dragging");
        closeMenu({});
        drag.armTimer = window.setTimeout(armEdge, DRAG_EDGE_HOLD_MS);
      }
      event.preventDefault();
      updateDropTarget(event.clientX, event.clientY);
      if (!drag.edgeArmed && dist > DRAG_EDGE_ARM_PX) {
        if (drag.armTimer) window.clearTimeout(drag.armTimer);
        drag.armTimer = 0;
        drag.edgeArmed = true;
      }
      if (drag.edgeArmed && !drag.frame && edgeDelta(event.clientY) !== 0) drag.frame = frame(scrollDrag);
    }

    // ---- the Move menu ---------------------------------------------------------------

    // Move up / Move down are marked unavailable at the ends with
    // aria-disabled (not disabled, so a focused button keeps its focus).
    function updateMenuEdges() {
      if (!menuKey) return;
      const order = domOrder();
      const at = order.indexOf(menuKey);
      for (const b of menu.querySelectorAll("button")) {
        const action = b.getAttribute("data-value");
        const edge = (action === "up" && at <= 0) || (action === "down" && at >= order.length - 1);
        if (edge) b.setAttribute("aria-disabled", "true");
        else b.removeAttribute("aria-disabled");
      }
    }

    function openMenu(key) {
      const c = cards.get(key);
      c.slot.replaceChildren(menu);
      menuKey = key;
      menu.setAttribute("aria-label", t("layout.move", { title: title(key) }));
      flag(menu, "hidden", false);
      updateMenuEdges();
      const first = menu.querySelector("button");
      if (first) first.focus({ preventScroll: true });
      if (typeof menu.scrollIntoView === "function") menu.scrollIntoView({ block: "nearest" });
    }

    // Closing returns focus to the card's handle when it was in the menu (or
    // when asked), unless the pointer is already going elsewhere.
    function closeMenu(o) {
      if (!menuKey) return false;
      const handle = cards.get(menuKey).handle;
      const hadFocus = menu.contains(document.activeElement);
      menuKey = "";
      flag(menu, "hidden", true);
      if (!o.keepFocus && (o.focusHandle || hadFocus) && document.activeElement !== handle) handle.focus({ preventScroll: true });
      return true;
    }

    function onMenuAction(action, button) {
      const key = menuKey;
      if (!key) return;
      if (action === "done") {
        closeMenu({ focusHandle: true });
        return;
      }
      if (button.getAttribute("aria-disabled") === "true") {
        moved(key, domOrder());
        return;
      }
      moveBy(key, action === "up" ? -1 : 1, button);
      updateMenuEdges();
    }

    // ---- wiring ------------------------------------------------------------------------

    function listen(target, type, fn) {
      target.addEventListener(type, fn);
      docListeners.push([target, type, fn]);
    }

    function mount() {
      for (const [key, c] of cards) {
        c.toggle.addEventListener("click", () => {
          finishDrag(true);
          setCollapsed(key, !collapsed(key));
        });
        c.handle.addEventListener("pointerdown", (e) => onPointerDown(key, e));
        c.handle.addEventListener("lostpointercapture", (e) => {
          if (drag && drag.handle === c.handle) finishDrag(true, e);
        });
        // A tap, click or Enter/Space opens (or closes) the Move menu; the
        // click that ends a real drag does not.
        c.handle.addEventListener("click", () => {
          if (clickGuard === c.handle) {
            clickGuard = null;
            return;
          }
          if (menuKey === key) closeMenu({ focusHandle: true });
          else openMenu(key);
        });
        c.handle.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") clickGuard = null;
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          e.preventDefault();
          moveBy(key, e.key === "ArrowUp" ? -1 : 1, null);
        });
      }
      listen(document, "pointermove", onPointerMove);
      listen(document, "pointerup", (e) => finishDrag(false, e));
      listen(document, "pointercancel", (e) => finishDrag(true, e));
      // A pointer going down outside the open menu and its handle closes it.
      listen(document, "pointerdown", (e) => {
        if (!menuKey) return;
        const target = e.target;
        if (menu.contains(target)) return;
        if (target && typeof target.closest === "function" && target.closest(".card-handle") === cards.get(menuKey).handle) return;
        closeMenu({ keepFocus: true });
      });
      listen(document, "keydown", (e) => {
        if (e.key !== "Escape") return;
        finishDrag(true);
        if (!menuKey) return;
        const handle = cards.get(menuKey).handle;
        if (menu.contains(e.target) || e.target === handle) {
          e.preventDefault();
          e.stopPropagation();
          closeMenu({ focusHandle: true });
        }
      });
      listen(window, "blur", () => finishDrag(true));
      apply();
    }

    function reset() {
      closeMenu({ keepFocus: true });
      finishDrag(true);
      const wasCollapsed = state.collapsedCards.slice();
      state = { cardOrder: keys.slice(), collapsedCards: [] };
      apply();
      if (opts.onExpand) for (const key of wasCollapsed) opts.onExpand(key);
      changed({ reset: true });
    }

    function destroy() {
      finishDrag(true);
      window.clearTimeout(announceTimer);
      for (const [target, type, fn] of docListeners) target.removeEventListener(type, fn);
      docListeners.length = 0;
    }

    return {
      card,
      mount,
      reset,
      destroy,
      expand: (key) => setCollapsed(key, false),
      isCollapsed: collapsed,
      order: () => domOrder(),
      menuOpen: () => menuKey,
      closeMenu: () => closeMenu({ keepFocus: true })
    };
  }

  // The same rules as settings.validate: every card once, a duplicate-free
  // subset collapsed. Anything else gives the default layout.
  function normalise(keys, s) {
    const order = s && Array.isArray(s.cardOrder) ? s.cardOrder : [];
    const okOrder = order.length === keys.length && keys.every((k) => order.includes(k));
    const set = s && Array.isArray(s.collapsedCards) ? s.collapsedCards : [];
    const okSet = set.every((k) => keys.includes(k)) && new Set(set).size === set.length;
    return { cardOrder: okOrder ? order.slice() : keys.slice(), collapsedCards: okSet ? set.slice() : [] };
  }

  window.PCalc.cardLayout = Object.freeze({ create, normalise });
})();
