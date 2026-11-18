// Clickable mini calendars (plan B9; Date Calculator v1.1.0 plan A1). The
// grid comes from the engine (date.month_grid: 42 cells, weekend, holiday,
// today and range flags, an English label per day); this file only paints
// it and handles the input:
//   - every day is a <button>; out-of-range days (before 0001-01-01, after
//     9999-12-31) are disabled; out-of-month days select and move the view
//   - one delegated click and one keydown listener per grid
//   - roving tabindex: exactly one tabindex=0 per grid (the focused date
//     when shown, else the last focused, a selected date or an endpoint,
//     today, or the 1st); arrows ±1 day / ±1 week, Home/End the week's
//     ends, PageUp/PageDown ±1 month (Shift: ±1 year, month ends clamped
//     by the engine); moving focus never selects; Enter/Space select
//   - focus survives a repaint, and a stale paint (view.seq) never lands
//   - the header Today button changes the view only
// Selection marks come from the field values (marks()), never from the
// engine's range flags: its range is [earlier, later).
(function () {
  "use strict";
  const { el, flag } = window.PCalc.dom;

  const parseIso = (v) => {
    const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return y >= 1 && mo >= 1 && mo <= 12 ? { y, m: mo } : null;
  };
  const str = (v) => (typeof v === "string" ? v : "");

  // opts: {prefix, t, call(op, req), calendar(), firstDay(), today(),
  //        marks(), onPick(iso, {shift}), legend: [catalog keys], top: [nodes]}
  function create(opts) {
    const t = opts.t;
    const p = opts.prefix;
    const view = { year: 0, month: 0, rangeStart: null, rangeEnd: null, seq: 0, last: null, focusDate: "" };

    const title = el("p", { className: "cal-title", text: "—", attrs: { id: p + "Title", "aria-live": "polite" } });
    const nav = (id, text, label) => el("button", { className: "cal-nav", text, attrs: { id: p + id, type: "button", "aria-label": label, "aria-controls": p + "Grid" } });
    const prev = nav("PrevBtn", "‹", t("date.cal.prev"));
    const next = nav("NextBtn", "›", t("date.cal.next"));
    const todayBtn = nav("TodayBtn", t("date.cal.today"), t("date.cal.todayLabel"));
    todayBtn.classList.add("cal-today");
    const head = el("div", { className: "cal-weekdays", attrs: { id: p + "Weekdays", "aria-hidden": "true" } });
    const grid = el("div", { className: "cal-grid", attrs: { id: p + "Grid", role: "group", "aria-labelledby": p + "Title" } });
    const legend = el("p", { className: "cal-legend", attrs: { "aria-hidden": "true" } },
      (opts.legend || []).map(([cls, key]) => el("span", { className: "legend-item" }, [el("span", { className: "swatch " + cls }), t(key)])));
    const root = el("div", { className: "mini-cal", attrs: { id: p } }, [
      ...(opts.top || []),
      el("div", { className: "cal-head" }, [prev, title, next, todayBtn]),
      head,
      grid,
      legend
    ]);

    function cell(c, marks) {
      const date = str(c.date);
      const classes = ["cal-cell"];
      if (!c.inMonth) classes.push("out");
      if (c.outOfRange) classes.push("out-of-range");
      if (c.weekend) classes.push("weekend");
      if (c.holiday) {
        classes.push("holiday");
        if (c.approximate) classes.push("approx");
      }
      if (c.inRange) classes.push("in-range");
      let suffix = "";
      if (date && date === marks.start) {
        classes.push("pick-start");
        suffix += t("date.cal.suffixStart");
      }
      if (date && date === marks.end) {
        classes.push("pick-end");
        suffix += t("date.cal.suffixEnd");
      }
      if (date && date === marks.selected) {
        classes.push("selected");
        suffix += t("date.cal.suffixSelected");
      }
      if (suffix) classes.push("endpoint");
      if (c.isToday) classes.push("today");
      const label = str(c.label) || date;
      return el("button", {
        className: classes.join(" "),
        text: typeof c.day === "number" ? String(c.day) : "",
        attrs: {
          type: "button",
          "aria-label": label + suffix,
          "aria-pressed": suffix ? "true" : null,
          "aria-current": c.isToday ? "date" : null,
          title: label || null,
          "data-date": date,
          tabindex: "-1",
          disabled: c.outOfRange ? true : null
        }
      });
    }

    // Exactly one tab stop: the focused date if shown, else the last focused
    // date, a selected date or an endpoint, today, or the 1st.
    function rovingDate(cells, marks, keep) {
      const shown = (iso, inMonthOnly) => Boolean(iso) && cells.some((c) => c.date === iso && !c.outOfRange && (!inMonthOnly || c.inMonth));
      if (shown(keep, false)) return keep;
      for (const iso of [view.focusDate, marks.start, marks.end, marks.selected]) if (shown(iso, true)) return iso;
      const today = cells.find((c) => c.isToday && c.inMonth && !c.outOfRange);
      if (today) return str(today.date);
      const first = cells.find((c) => c.inMonth && !c.outOfRange);
      return first ? str(first.date) : "";
    }

    function paint(g) {
      flag(prev, "disabled", view.year <= 1 && view.month <= 1);
      flag(next, "disabled", view.year >= 9999 && view.month >= 12);
      if (!g || !Array.isArray(g.cells)) {
        title.textContent = "—";
        grid.replaceChildren();
        return;
      }
      title.textContent = str(g.title) || "—";
      const headers = Array.isArray(g.weekdayHeaders) ? g.weekdayHeaders : [];
      head.replaceChildren(...headers.map((h, i) => el("span", { className: g.cells[i] && g.cells[i].weekend ? "cal-dow weekend" : "cal-dow", text: str(h) })));
      // A keyboard move names the new date in view.focusDate; otherwise the
      // focused cell's own date is kept.
      const active = document.activeElement;
      const hadFocus = Boolean(active && active !== grid && grid.contains(active));
      const keep = hadFocus ? view.focusDate || str(active.getAttribute("data-date")) : "";
      const cells = g.cells.filter((c) => c && typeof c === "object");
      const marks = opts.marks();
      const nodes = cells.map((c) => cell(c, marks));
      const stop = rovingDate(cells, marks, keep);
      const stopNode = nodes.find((n) => n.getAttribute("data-date") === stop) || null;
      if (stopNode) stopNode.setAttribute("tabindex", "0");
      grid.replaceChildren(...nodes);
      if (hadFocus && stopNode) stopNode.focus({ preventScroll: true });
    }

    async function refresh() {
      if (!view.year) return null;
      const ticket = ++view.seq;
      const req = { year: view.year, month: view.month, firstDayOfWeek: opts.firstDay(), today: opts.today(), calendar: opts.calendar() };
      if (view.rangeStart) req.rangeStart = view.rangeStart;
      if (view.rangeEnd) req.rangeEnd = view.rangeEnd;
      const g = await opts.call("date.month_grid", req);
      if (ticket !== view.seq) return null;
      view.last = g;
      paint(g);
      return g;
    }

    function setView(o) {
      const a = parseIso(o.anchor) || parseIso(opts.today()) || { y: 2026, m: 1 };
      view.year = a.y;
      view.month = a.m;
      view.rangeStart = parseIso(o.rangeStart) ? o.rangeStart : null;
      view.rangeEnd = parseIso(o.rangeEnd) ? o.rangeEnd : null;
      return refresh();
    }

    function shift(delta) {
      if (!view.year) return Promise.resolve(null);
      const idx = Math.max(12, Math.min(12 * 9999 + 11, view.year * 12 + (view.month - 1) + delta));
      view.year = Math.floor(idx / 12);
      view.month = (idx % 12) + 1;
      return refresh();
    }

    // The header Today button changes the view only; it never selects.
    function showToday() {
      const a = parseIso(opts.today());
      if (!a) return Promise.resolve(null);
      view.year = a.y;
      view.month = a.m;
      return refresh();
    }

    function setStop(node) {
      for (const n of grid.children) n.setAttribute("tabindex", n === node ? "0" : "-1");
    }

    // ± days or months through the engine (month ends clamp), or null at
    // the ends of 0001-01-01..9999-12-31.
    async function shiftDate(iso, step) {
      const r = await opts.call("date.add_subtract", {
        date: iso,
        operation: step.days < 0 || step.months < 0 ? "subtract" : "add",
        years: "",
        months: step.months ? String(Math.abs(step.months)) : "",
        weeks: "",
        days: step.days ? String(Math.abs(step.days)) : "",
        businessDays: false,
        calendar: opts.calendar()
      });
      return r && parseIso(r.resultDate) ? r.resultDate : null;
    }

    async function moveFocus(from, step) {
      const nodes = Array.from(grid.children);
      let target = "";
      if (!step.months) {
        const j = nodes.indexOf(from) + step.days;
        if (j >= 0 && j < nodes.length) target = str(nodes[j].getAttribute("data-date"));
      }
      if (!target) target = (await shiftDate(str(from.getAttribute("data-date")), step)) || "";
      const a = parseIso(target);
      if (!a) return;
      const node = Array.from(grid.children).find((n) => n.getAttribute("data-date") === target) || null;
      if (node && node.hasAttribute("disabled")) return;
      view.focusDate = target;
      if (node && a.y === view.year && a.m === view.month) {
        setStop(node);
        node.focus();
        return;
      }
      view.year = a.y;
      view.month = a.m;
      await refresh();
    }

    const cellOf = (event) => {
      const n = event.target && typeof event.target.closest === "function" ? event.target.closest(".cal-cell") : null;
      return n && grid.contains(n) ? n : null;
    };

    function onKey(event) {
      const c = cellOf(event);
      if (!c || event.altKey || event.ctrlKey || event.metaKey) return;
      const k = event.key;
      if (k === "Enter" || k === " " || k === "Spacebar") {
        // Here, not through the native click, so Shift+Enter reaches the pick.
        event.preventDefault();
        if (!c.hasAttribute("disabled")) opts.onPick(str(c.getAttribute("data-date")), { shift: Boolean(event.shiftKey) });
        return;
      }
      const col = Array.from(grid.children).indexOf(c) % 7;
      const year = event.shiftKey ? 12 : 1;
      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      const steps = {
        ArrowLeft: { days: rtl ? 1 : -1 },
        ArrowRight: { days: rtl ? -1 : 1 },
        ArrowUp: { days: -7 },
        ArrowDown: { days: 7 },
        Home: { days: -col },
        End: { days: 6 - col },
        PageUp: { months: -year },
        PageDown: { months: year }
      };
      if (!Object.prototype.hasOwnProperty.call(steps, k)) return;
      event.preventDefault();
      const step = Object.assign({ days: 0, months: 0 }, steps[k]);
      if (step.days === 0 && step.months === 0) return;
      moveFocus(c, step);
    }

    prev.addEventListener("click", () => shift(-1));
    next.addEventListener("click", () => shift(1));
    todayBtn.addEventListener("click", () => showToday());
    grid.addEventListener("click", (event) => {
      const c = cellOf(event);
      if (!c || c.hasAttribute("disabled")) return;
      opts.onPick(str(c.getAttribute("data-date")), { shift: Boolean(event.shiftKey) });
    });
    grid.addEventListener("keydown", onKey);
    grid.addEventListener("focusin", (event) => {
      const c = cellOf(event);
      if (!c) return;
      view.focusDate = str(c.getAttribute("data-date"));
      setStop(c);
    });

    return {
      node: root,
      view,
      setView,
      refresh,
      shift,
      showToday,
      repaint: () => paint(view.last),
      setFocusDate: (iso) => {
        view.focusDate = iso;
      }
    };
  }

  // A stored calendar with date-core's defaults filled in (the engine's
  // date.validate_calendar gives the same; this covers the moment before
  // its answer arrives). An empty {} is the default calendar.
  function fullCalendar(cal) {
    const c = cal && typeof cal === "object" ? cal : {};
    const ex = c.excludedHolidays && typeof c.excludedHolidays === "object" ? c.excludedHolidays : {};
    return {
      weekend: Array.isArray(c.weekend) ? c.weekend.slice() : [6, 7],
      preset: typeof c.preset === "string" ? c.preset : "none",
      hijriOffsetDays: typeof c.hijriOffsetDays === "number" ? c.hijriOffsetDays : 0,
      hijriOverrides: Array.isArray(c.hijriOverrides) ? c.hijriOverrides.slice() : [],
      excludedHolidays: { us: Array.isArray(ex.us) ? ex.us.slice() : [], uk: Array.isArray(ex.uk) ? ex.uk.slice() : [], eg: Array.isArray(ex.eg) ? ex.eg.slice() : [] },
      customHolidays: Array.isArray(c.customHolidays) ? c.customHolidays.slice() : [],
      observedMode: typeof c.observedMode === "string" ? c.observedMode : "observed",
      schemaVersion: 1
    };
  }

  window.PCalc.miniCal = Object.freeze({ create, parseIso, fullCalendar });
})();
