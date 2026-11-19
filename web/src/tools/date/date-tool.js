// The Date tool (plan B9): the six cards of Date Calculator v1.2.0 (Days
// Between, Add / Subtract with business mode, Business Days, Age, Date
// Info, Countdown), each with a live result and a live-formula panel; the
// v1.1.0 clickable mini calendars; the v1.2.0 card layout (collapse,
// reorder, Move menu) kept in settings.date.cardOrder / collapsedCards;
// and the Countdown card over the countdown list (countdowns.js).
//
// All date math, holiday rules, display text and calendar grids come from
// the engine (date.* ops through the platform adapter). Engine text (result
// summaries, trace lines, weekday and holiday names) is English and shown
// as is until the translated catalogs (M9a); every other word comes from
// the catalog. Per-card sequence counters keep a slower answer from
// overwriting a newer keystroke or a Clear.
//
// History: Calculate, Enter and Copy record through PCalc.history (the
// history store since M3); live updates never record. restore(entry) (the
// History panel) puts an entry's stored inputs back into its card, which
// opens, computes again in the current language and takes focus; a
// restored countdown target is shown, not added to the countdown list.
//
// Field values, modes and the selected countdown live in `model` for the
// session, so leaving the route and coming back (or a language change that
// rebuilds the view) keeps them.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, show, flag, value, ltr, ltrNodes, withValues } = ns.dom;
  const KEYS = Object.freeze(["between", "add", "business", "age", "info", "countdown"]);
  const AMOUNTS = ["addYears", "addMonths", "addWeeks", "addDays"];
  const MAX_HIT_ROWS = 25;
  const COPY_FEEDBACK_MS = 1200;
  const ROLLOVER_MS = 60000;
  const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const TEXT_FIELDS = ["betweenStart", "betweenEnd", "addStart", ...AMOUNTS, "bizStart", "bizEnd", "ageBirth", "ageAsOf", "infoDate", "cdTarget", "cdTime", "cdLabel"];
  const CHECKS = ["betweenIncludeEnd", "addBusiness", "bizIncludeEnd"];

  // The session model (see the header).
  const model = { fields: {}, checks: {}, addMode: "add", leap: "feb28", bizPick: null, cdSelected: null, cdInitialised: false, cdForgotten: "", expandCountdown: false, revealCountdown: false, restoreKey: null };

  let m = null; // the mounted view, or null

  // Lookups stay inside this view: while a re-render builds the new view,
  // the old one (same ids) is still in the document.
  function byId(id) {
    if (m && m.root) {
      const n = m.root.querySelector("#" + id);
      if (n) return n;
    }
    return document.getElementById(id);
  }

  const str = (v) => (typeof v === "string" ? v : "");
  // Engine English kept left-to-right inside right-to-left text (B5c).
  const eng = (v) => (str(v) ? ltr(str(v)) : "");
  const isIso = (v) => ns.miniCal.parseIso(v) !== null;
  const pairKey = (d, t) => d + "|" + t;

  // ---- engine ------------------------------------------------------------------

  async function envelope(op, req) {
    try {
      return JSON.parse(await m.ctx.platform.engine(op, JSON.stringify(req)));
    } catch (_) {
      return null;
    }
  }
  async function result(op, req) {
    const r = await envelope(op, req);
    return r && r.ok === "true" && r.result && typeof r.result === "object" ? r.result : null;
  }
  const errorText = (r) => (r && r.ok === "false" && r.error && typeof r.error.message === "string" && r.error.message.trim() ? r.error.message : m.t("date.error.failed"));

  // ---- formatting ---------------------------------------------------------------

  function num(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "—";
    return ns.format.formatNumber(String(Math.trunc(n)), m.ctx.lang, { digits: m.ctx.digits, grouping: m.ctx.settings.display.grouping });
  }
  // A counted unit ("3 days"): the plural form chosen by the number.
  const unit = (key, n) => m.t("date.unit." + key, { plural: typeof n === "number" ? Math.abs(n) : 0, count: value(num(n)) });
  const sep = () => m.t("date.sep");
  const join = (parts) => parts.filter((p) => typeof p === "string" && p !== "").join(sep());

  // ---- calendar (settings.date.calendar, normalised by the engine) ---------

  function calendar() {
    return m.calInfo && m.calInfo.calendar ? m.calInfo.calendar : ns.miniCal.fullCalendar(m.ctx.settings.date.calendar);
  }
  const firstDay = () => (m.ctx.settings.date.firstDayOfWeek === "sunday" ? "sunday" : "monday");

  function weekendShort(days) {
    const list = Array.isArray(days) ? days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : [];
    if (list.length === 0) return m.t("date.cal.noWeekend");
    return list.slice().sort((a, b) => a - b).map((d) => ns.format.weekdayName(d).slice(0, 3)).join("/");
  }

  // Short description for cards: never a custom holiday name, only a count.
  function calendarShort() {
    const cal = calendar();
    const custom = (cal.customHolidays || []).filter((c) => c && c.enabled !== false).length;
    const preset = !cal.preset || cal.preset === "none" ? m.t("date.preset.short.none") : m.t("date.preset.short." + cal.preset);
    const parts = [weekendShort(cal.weekend), preset];
    if (custom > 0) parts.push(unit("customHoliday", custom));
    return join(parts);
  }

  // ---- DOM helpers --------------------------------------------------------------

  function field(id, labelText, input, extra) {
    return el("div", { className: "date-field" }, [el("label", { className: "field-label", text: labelText, attrs: { for: id } }), input, ...(extra || [])]);
  }

  function dateInput(id, extraAttrs) {
    return el("input", { className: "input date-input", attrs: Object.assign({ id, type: "date", min: "0001-01-01", max: "9999-12-31" }, extraAttrs || {}) });
  }

  function dateRow(id, labelKey, todayKey, extra) {
    const input = dateInput(id, extra);
    const today = el("button", { className: "button today-button", text: m.t("date.today"), attrs: { type: "button", id: id + "TodayBtn", "aria-label": m.t(todayKey) } });
    today.addEventListener("click", () => {
      input.value = ns.clock.todayIso();
      if (id === "cdTarget") commitCountdown(true);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return field(id, m.t(labelKey), el("div", { className: "date-row" }, [input, today]));
  }

  function amountInput(id) {
    return el("input", { className: "input", attrs: { id, type: "text", inputmode: "numeric", dir: "ltr", placeholder: "0", autocomplete: "off", spellcheck: "false", maxlength: "16" } });
  }

  function checkRow(id, text, describedBy) {
    const box = el("input", { attrs: { id, type: "checkbox", "aria-describedby": describedBy || null } });
    return el("label", { className: "choice check-row", attrs: { for: id } }, [box, el("span", { text })]);
  }

  function toggleGroup(labelKey, buttons) {
    return el("div", { className: "toggle-group", attrs: { role: "group", "aria-label": m.t(labelKey) } }, buttons);
  }

  function modeButton(id, text, on) {
    return el("button", { className: on ? "button mode-button active" : "button mode-button", text, attrs: { id, type: "button", "aria-pressed": on ? "true" : "false" } });
  }

  function setPressed(id, on) {
    const b = byId(id);
    if (!b) return;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function actionButtons(key) {
    const calc = el("button", { className: "button primary", text: m.t("date.calc"), attrs: { type: "button", id: key + "CalcBtn" } });
    const clear = el("button", { className: "button", text: m.t("date.clear"), attrs: { type: "button", id: key + "ClearBtn" } });
    const copy = el("button", { className: "button", text: m.t("date.copy"), attrs: { type: "button", id: key + "CopyBtn" } });
    calc.addEventListener("click", () => calculateAndRecord(key));
    clear.addEventListener("click", () => resetCard(key));
    copy.addEventListener("click", () => copyResult(key, copy));
    return el("div", { className: "button-row" }, [calc, clear, copy]);
  }

  // Not a live region: it changes on every keystroke. The tool's one polite
  // region (dateResultLive, shell/announcer.js) speaks it.
  function resultBox(key) {
    return el("div", { className: "result", attrs: { id: key + "Result" } }, [el("span", { className: "result-prefix", text: "=" }), "—"]);
  }
  const speech = (key) => ns.announcer.resultWords(byId(key + "Result"));

  function formula(key, extra) {
    return el("div", { className: "formula" }, [
      el("p", { className: "formula-title", text: m.t("date.formula") }),
      ...(extra.before || []),
      el("ul", { className: "trace", attrs: { id: key + "Trace", "aria-label": m.t("date.trace." + key) } }, [el("li", { className: "trace-hint", text: m.t("date.hint." + key) })]),
      el("p", { className: "live-result", text: m.t("date.live.idle"), attrs: { id: key + "Live" } }),
      ...(extra.after || [])
    ]);
  }

  function calendarSummary(id, hidden) {
    const edit = el("button", { className: "button link-button", text: m.t("date.calEdit"), attrs: { type: "button", id: id + "Edit" } });
    edit.addEventListener("click", () => {
      m.ctx.settingsFocus = "dateCalendar";
      m.ctx.shell.navigate("settings");
    });
    return el("div", { className: "calendar-summary", attrs: { id, hidden: hidden || null } }, [el("span", { className: "calendar-summary-text", attrs: { id: id + "Text" } }), edit]);
  }

  const legend = (selectedKey) => [
    ["swatch-endpoint", selectedKey],
    ["swatch-weekend", "date.legend.weekend"],
    ["swatch-holiday", "date.legend.holiday"],
    ["swatch-approx", "date.legend.estimated"],
    ["swatch-today", "date.legend.today"]
  ];

  // ---- result, trace, live ---------------------------------------------------------

  function setResult(key, main, subs, warnings, extra) {
    const box = byId(key + "Result");
    if (!box) return;
    const nodes = [el("span", { className: "result-prefix", text: "=" }), el("span", { className: "result-main" }, ltrNodes(main))];
    for (const s of subs || []) if (typeof s === "string" && s) nodes.push(el("span", { className: "result-sub" }, withValues(s)));
    for (const n of extra || []) nodes.push(n);
    for (const w of warnings || []) if (w) nodes.push(el("span", { className: "result-warning", text: w }));
    show(box, nodes);
  }
  function resultIdle(key) {
    const box = byId(key + "Result");
    if (box) show(box, [el("span", { className: "result-prefix", text: "=" }), "—"]);
  }
  function resultError(key, message) {
    const box = byId(key + "Result");
    if (box) show(box, [el("span", { className: "result-prefix", text: "=" }), el("span", { className: "error-text", text: message })]);
  }
  function traceLines(key, lines) {
    const list = byId(key + "Trace");
    if (!list) return;
    const items = (Array.isArray(lines) ? lines : []).filter((l) => typeof l === "string").map((l) =>
      l.startsWith("  ") ? el("li", { className: "trace-note" }, ltrNodes(l.trim())) : el("li", {}, ltrNodes(l)));
    if (items.length === 0) traceIdle(key);
    else show(list, items);
  }
  function traceIdle(key) {
    const list = byId(key + "Trace");
    if (list) show(list, [el("li", { className: "trace-hint", text: m.t("date.hint." + key) })]);
  }
  function traceError(key, message) {
    const list = byId(key + "Trace");
    if (list) show(list, [el("li", { className: "trace-hint", text: m.t("date.hint." + key) }), el("li", {}, [el("span", { className: "error-text", text: message })])]);
  }
  function live(key, text) {
    const n = byId(key + "Live");
    if (n) show(n, withValues(text));
  }
  function cardIdle(key) {
    m.last[key] = null;
    traceIdle(key);
    live(key, m.t("date.live.idle"));
    resultIdle(key);
  }
  function cardError(key, message) {
    m.last[key] = null;
    traceError(key, message);
    live(key, m.t("date.live.invalid"));
    resultError(key, message);
  }
  function warnings(r) {
    const out = [];
    if (r && Array.isArray(r.warnings) && r.warnings.includes("presetYearOutOfRange")) out.push(m.t("date.warn.presetYears"));
    if (r && r.usedApproximateHolidays === true) out.push(m.t("date.warn.estimated"));
    return out;
  }

  const read = (id) => {
    const n = byId(id);
    return n && typeof n.value === "string" ? n.value.trim() : "";
  };
  const readAmount = (id) => ns.format.normalizeDigits(read(id)).trim();
  const checked = (id) => {
    const n = byId(id);
    return Boolean(n && n.checked);
  };
  function setField(id, v) {
    const n = byId(id);
    if (n) n.value = typeof v === "string" ? v : "";
    model.fields[id] = typeof v === "string" ? v : "";
  }

  // ---- card 1: Days Between --------------------------------------------------------------

  async function updateBetween() {
    const ticket = ++m.seq.between;
    const startDate = read("betweenStart");
    const endDate = read("betweenEnd");
    const includeEndDay = checked("betweenIncludeEnd");
    if (!startDate || !endDate) return cardIdle("between");
    m.last.between = null;
    const res = await envelope("date.days_between", { startDate, endDate, includeEndDay });
    if (!m || ticket !== m.seq.between) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) return cardError("between", errorText(res));
    const days = r.direction === "backward" ? "date.between.weekdaysBackward" : "date.between.weekdays";
    setResult("between", str(r.breakdownText), [
      join([eng(r.summaryText), eng(r.weeksText)]),
      join([unit("hour", r.totalHours), unit("minute", r.totalMinutes), unit("second", r.totalSeconds)]),
      m.t(days, { start: str(r.startWeekday), end: str(r.endWeekday) })
    ]);
    traceLines("between", r.traceLines);
    live("between", m.t("date.live.value", { value: eng(r.summaryText) }));
    m.last.between = {
      calculator: "between",
      inputs: { startDate, endDate, includeEndDay: String(includeEndDay) },
      inputsText: startDate + " → " + endDate + (includeEndDay ? " (+1)" : ""),
      resultText: join([str(r.summaryText), str(r.breakdownText)]),
      copyText: str(r.copyText)
    };
  }

  // ---- card 2: Add / Subtract ---------------------------------------------------------------

  function setAddMode(mode) {
    model.addMode = mode === "subtract" ? "subtract" : "add";
    setPressed("addModeAddBtn", model.addMode === "add");
    setPressed("addModeSubtractBtn", model.addMode === "subtract");
    return updateAdd();
  }

  function syncAddBusiness() {
    const on = checked("addBusiness");
    flag(byId("addBusinessNote"), "hidden", !on);
    flag(byId("addCalendarSummary"), "hidden", !on);
    byId("addWeeksLabel").textContent = m.t(on ? "date.field.bizWeeks" : "date.field.weeks");
    byId("addDaysLabel").textContent = m.t(on ? "date.field.bizDays" : "date.field.days");
  }

  async function updateAdd() {
    const ticket = ++m.seq.add;
    const date = read("addStart");
    const amounts = { years: readAmount("addYears"), months: readAmount("addMonths"), weeks: readAmount("addWeeks"), days: readAmount("addDays") };
    const operation = model.addMode;
    const businessDays = checked("addBusiness");
    if (!date) return cardIdle("add");
    m.last.add = null;
    const res = await envelope("date.add_subtract", Object.assign({ date, operation }, amounts, { businessDays, calendar: calendar() }));
    if (!m || ticket !== m.seq.add) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) return cardError("add", errorText(res));
    const subs = [eng(r.expressionText), m.t("date.add.moved", { n: value(num(r.calendarDaysDelta)) })];
    if (businessDays && typeof r.businessDayCount === "number") {
      subs.push(join([m.t("date.add.business", { n: value(num(r.businessDayCount)), weekend: unit("weekendDay", r.skippedWeekendDays), holidays: unit("holiday", r.skippedHolidays) }), calendarShort()]));
    }
    if (r.monthClamped === true) subs.push(m.t("date.add.clamped"));
    setResult("add", str(r.summaryText), subs, warnings(r));
    traceLines("add", r.traceLines);
    live("add", m.t("date.live.value", { value: eng(str(r.resultDate) + " (" + str(r.resultWeekday) + ")") }));
    const sign = operation === "subtract" ? "−" : "+";
    const parts = [["years", "y"], ["months", "m"], ["weeks", "w"], ["days", "d"]].filter(([k]) => amounts[k] !== "").map(([k, s]) => amounts[k] + s);
    m.last.add = {
      calculator: "add",
      inputs: { date, operation, years: amounts.years, months: amounts.months, weeks: amounts.weeks, days: amounts.days, businessDays: String(businessDays) },
      inputsText: date + " " + sign + " " + (parts.length ? parts.join(" ") : "0d") + (businessDays ? sep() + calendarShort() : ""),
      resultText: str(r.resultDate) + " (" + str(r.resultWeekday) + ")",
      copyText: str(r.copyText)
    };
  }

  // ---- card 3: Business Days ------------------------------------------------------------------

  function renderHits(r) {
    const box = byId("bizHolidayHits");
    const list = byId("bizHolidayList");
    const more = byId("bizHolidayMore");
    if (!box) return;
    const hits = r && Array.isArray(r.holidays) ? r.holidays.filter((h) => h && typeof h === "object") : [];
    if (hits.length === 0) {
      flag(box, "hidden", true);
      show(list, []);
      more.textContent = "";
      flag(more, "hidden", true);
      return;
    }
    const shown = hits.slice(0, MAX_HIT_ROWS);
    show(list, shown.map((h) => {
      const name = el("bdi", { className: "hit-name", text: str(h.name), attrs: { dir: "auto" } });
      return el("li", { className: "hit" }, [name, h.approximate === true ? el("span", { className: "approx-tag", text: m.t("date.estimated") }) : null, el("bdi", { className: "hit-date", text: str(h.date), attrs: { dir: "ltr" } })]);
    }));
    const total = typeof r.holidayDays === "number" ? r.holidayDays : hits.length;
    const rest = total - shown.length;
    show(more, rest > 0 ? withValues(m.t("date.biz.more", { plural: rest, count: value(num(rest)) })) : []);
    flag(more, "hidden", rest <= 0);
    flag(box, "hidden", false);
  }

  // The calendar pick target: Start if the start date is empty, else End
  // if the end date is empty, else Start.
  function setBizPick(target) {
    model.bizPick = target === "end" ? "end" : "start";
    const s = byId("bizPickStart");
    const e = byId("bizPickEnd");
    if (s) s.checked = model.bizPick === "start";
    if (e) e.checked = model.bizPick === "end";
    const hint = byId("bizCalHint");
    const text = m.t(model.bizPick === "end" ? "date.cal.hintEnd" : "date.cal.hintStart");
    if (hint && hint.textContent !== text) hint.textContent = text;
  }
  function resetBizPick() {
    setBizPick(read("bizStart") && !read("bizEnd") ? "end" : "start");
  }

  async function updateBusiness() {
    const ticket = ++m.seq.business;
    const startDate = read("bizStart");
    const endDate = read("bizEnd");
    const includeEndDay = checked("bizIncludeEnd");
    // Consumed once: only the update a calendar click started follows it.
    const clicked = m.anchor;
    m.anchor = null;
    if (!startDate || !endDate) {
      cardIdle("business");
      renderHits(null);
      const single = startDate || endDate || null;
      await m.cals.biz.setView({ anchor: clicked || single, rangeStart: single, rangeEnd: single });
      return;
    }
    m.last.business = null;
    const res = await envelope("date.business_days", { startDate, endDate, includeEndDay, calendar: calendar() });
    if (!m || ticket !== m.seq.business) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) {
      cardError("business", errorText(res));
      renderHits(null);
      return;
    }
    setResult("business", str(r.summaryText), [
      join([unit("calendarDay", r.calendarDays), unit("weekendDay", r.weekendDays), unit("holiday", r.holidayDays)]),
      join([calendarShort(), m.t(includeEndDay ? "date.biz.included" : "date.biz.notIncluded"), r.direction === "backward" ? m.t("date.biz.backward") : ""])
    ], warnings(r));
    traceLines("business", r.traceLines);
    live("business", m.t("date.live.value", { value: eng(r.summaryText) }));
    renderHits(r);
    m.last.business = {
      calculator: "business",
      inputs: { startDate, endDate, includeEndDay: String(includeEndDay) },
      inputsText: startDate + " → " + endDate + (includeEndDay ? " (+1)" : "") + sep() + calendarShort(),
      resultText: str(r.breakdownText),
      copyText: str(r.copyText)
    };
    // The count covers [earlier, later): without "include the later date"
    // the shading stops the day before the later date (the engine steps it).
    const earlier = startDate <= endDate ? startDate : endDate;
    const later = startDate <= endDate ? endDate : startDate;
    let rangeEnd = later;
    if (!includeEndDay && earlier !== later) {
      const prev = await result("date.add_subtract", { date: later, operation: "subtract", years: "", months: "", weeks: "", days: "1", businessDays: false, calendar: calendar() });
      if (!m || ticket !== m.seq.business) return;
      rangeEnd = prev && isIso(prev.resultDate) ? prev.resultDate : later;
    }
    await m.cals.biz.setView({ anchor: clicked || earlier, rangeStart: earlier, rangeEnd });
  }

  // ---- card 4: Age ------------------------------------------------------------------------------

  function setLeap(rule) {
    model.leap = rule === "mar1" ? "mar1" : "feb28";
    setPressed("ageLeapFeb28Btn", model.leap === "feb28");
    setPressed("ageLeapMar1Btn", model.leap === "mar1");
    return updateAge();
  }

  async function updateAge() {
    const ticket = ++m.seq.age;
    const birthDate = read("ageBirth");
    const asOfRaw = read("ageAsOf");
    const asOfDate = asOfRaw || ns.clock.todayIso();
    const rule = model.leap;
    const hint = byId("ageAsOfHint");
    if (hint) hint.textContent = m.t("date.age.hint", { date: ns.clock.todayIso() });
    if (!birthDate) return cardIdle("age");
    m.last.age = null;
    const res = await envelope("date.age", { birthDate, asOfDate, leapDayRule: rule });
    if (!m || ticket !== m.seq.age) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) return cardError("age", errorText(res));
    const nb = r.nextBirthday && typeof r.nextBirthday === "object" ? r.nextBirthday : null;
    let next = m.t("date.age.none");
    if (nb && nb.isToday === true) next = m.t("date.age.today", { date: str(nb.date), age: value(num(nb.turningAge)) });
    else if (nb) next = m.t("date.age.next", { weekday: str(nb.weekday).slice(0, 3), date: str(nb.date), days: unit("day", nb.daysUntil), age: value(num(nb.turningAge)) });
    setResult("age", str(r.ageText), [
      next,
      join([unit("month", r.totalMonths), unit("week", r.totalWeeks), unit("day", r.totalDays)]),
      join([eng(r.summaryText), m.t("date.age.born", { weekday: str(r.bornWeekday) }), m.t(asOfRaw ? "date.age.asOf" : "date.age.asOfToday", { date: asOfDate })])
    ]);
    traceLines("age", r.traceLines);
    live("age", m.t("date.live.value", { value: eng(r.ageText) }));
    m.last.age = {
      calculator: "age",
      inputs: { birthDate, asOfDate: asOfRaw, leapDayRule: rule },
      inputsText: birthDate + " → " + asOfDate + (rule === "mar1" ? " (Feb 29 → Mar 1)" : ""),
      resultText: str(r.ageText),
      copyText: str(r.copyText)
    };
  }

  // ---- card 5: Date Info ------------------------------------------------------------------------

  function calendarDayText(grid, date) {
    const cells = grid && Array.isArray(grid.cells) ? grid.cells : [];
    const c = cells.find((x) => x && x.inMonth && x.date === date);
    if (!c) return null;
    if (c.holiday) {
      const names = Array.isArray(c.holidayNames) ? c.holidayNames.join(" / ") : "";
      return join([m.t(c.approximate ? "date.info.holidayEstimated" : "date.info.holiday", { names }), c.weekend ? m.t("date.info.weekend") : ""]);
    }
    return m.t(c.weekend ? "date.info.weekend" : "date.info.workday");
  }

  async function updateInfo() {
    const ticket = ++m.seq.info;
    const date = read("infoDate");
    if (!date) {
      cardIdle("info");
      await m.cals.info.setView({ anchor: null });
      return;
    }
    m.last.info = null;
    const [res, grid] = await Promise.all([
      envelope("date.date_info", { date, today: ns.clock.todayIso() }),
      m.cals.info.setView({ anchor: date, rangeStart: date, rangeEnd: date })
    ]);
    if (!m || ticket !== m.seq.info) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) return cardError("info", errorText(res));
    const rows = [
      ["date.info.weekday", str(r.weekday)],
      ["date.info.isoWeek", m.t("date.info.isoWeekValue", { text: str(r.isoWeekText), week: value(num(r.isoWeek)), weeks: value(num(r.isoWeeksInYear)) })],
      ["date.info.dayOfYear", m.t("date.info.dayOfYearValue", { day: value(num(r.dayOfYear)), days: value(num(r.daysInYear)), ordinal: str(r.ordinalText) })],
      ["date.info.quarter", m.t("date.info.quarterValue", { q: value(num(r.quarter)) })],
      ["date.info.leapYear", m.t(r.isLeapYear ? "date.info.leapYes" : "date.info.leapNo", { year: Number.isInteger(r.year) ? ns.clock.pad(r.year, 4) : "—" })],
      ["date.info.daysLeft", m.t("date.info.daysLeftValue", { year: value(num(r.daysRemainingInYear)), month: value(num(r.daysRemainingInMonth)) })],
      ["date.info.relative", eng(r.relativeText) || "—"]
    ];
    const day = calendarDayText(grid, date);
    if (day) rows.push(["date.info.calendar", m.t("date.info.calendarValue", { day, calendar: calendarShort() })]);
    rows.push(["date.info.unixDay", value(num(r.epochDay))]);
    rows.push(["date.info.julianDay", value(num(r.julianDayNumber))]);
    const grid2 = el("dl", { className: "info-rows" }, rows.flatMap(([k, v]) => [el("dt", { className: "info-key", text: m.t(k) }), el("dd", { className: "info-val" }, withValues(v))]));
    setResult("info", str(r.longText), [], [], [grid2]);
    traceLines("info", r.traceLines);
    live("info", m.t("date.live.value", { value: eng(r.weekday) + sep() + eng(r.isoWeekText) }));
    m.last.info = { calculator: "info", inputs: { date }, inputsText: date, resultText: join([str(r.longText), str(r.isoWeekText)]), copyText: str(r.copyText) };
  }

  // ---- card 6: Countdown --------------------------------------------------------------------------

  // A field mid-edit (one segment cleared) reads "" with validity.badInput.
  function countdownFields() {
    const d = byId("cdTarget");
    const tm = byId("cdTime");
    if ((d && d.validity && d.validity.badInput) || (tm && tm.validity && tm.validity.badInput)) return null;
    const targetDate = read("cdTarget");
    const targetTime = read("cdTime");
    if (!isIso(targetDate)) return null;
    if (targetTime !== "" && !TIME_RE.test(targetTime)) return null;
    return { targetDate, targetTime };
  }

  // The selected saved item when the fields still show its target.
  function shownItem() {
    if (!model.cdSelected) return null;
    const item = ns.countdowns.get(model.cdSelected);
    if (!item) return null;
    return pairKey(item.targetDate, item.targetTime) === pairKey(read("cdTarget"), read("cdTime")) ? item : null;
  }

  // Saves the card into the selected countdown, or a new one. `explicit` is
  // a user commit; the page-hide flush passes false, so it never re-saves a
  // countdown just deleted.
  function commitCountdown(explicit) {
    if (!m) return;
    const p = countdownFields();
    if (!p) return;
    const key = pairKey(p.targetDate, p.targetTime);
    if (explicit) model.cdForgotten = "";
    else if (key === model.cdForgotten) return;
    if (model.cdSelected && !ns.countdowns.get(model.cdSelected)) model.cdSelected = null;
    const r = ns.countdowns.upsert(model.cdSelected, { label: byId("cdLabel") ? byId("cdLabel").value : "", targetDate: p.targetDate, targetTime: p.targetTime });
    m.cdFull = Boolean(r.full);
    if (r.id) model.cdSelected = r.id;
    renderCountdownChrome();
  }

  function deleteCountdown() {
    const id = model.cdSelected;
    if (!id) return;
    model.cdForgotten = pairKey(read("cdTarget"), read("cdTime"));
    model.cdSelected = null;
    ns.countdowns.remove(id);
    setField("cdLabel", "");
    setField("cdTarget", "");
    setField("cdTime", "");
    m.cdFull = false;
    renderCountdownChrome();
    const focus = byId("cdSelect");
    if (focus) focus.focus();
    updateCountdown({});
  }

  function selectCountdownInCard(id) {
    const item = id ? ns.countdowns.get(id) : null;
    model.cdSelected = item ? item.id : null;
    setField("cdLabel", item ? item.label : "");
    setField("cdTarget", item ? item.targetDate : "");
    setField("cdTime", item ? item.targetTime : "");
    m.cdFull = false;
    renderCountdownChrome();
    return updateCountdown({});
  }

  // The selector, the saved note and Delete.
  function renderCountdownChrome() {
    if (!m) return;
    const t = m.t;
    const select = byId("cdSelect");
    if (select) {
      const list = ns.countdowns.list().sort((a, b) => a.createdAtMs - b.createdAtMs);
      const label = (i) => (i.label || t("date.cd.untitled")) + " · " + i.targetDate + (i.targetTime ? " " + i.targetTime : "");
      show(select, [el("option", { text: t("date.cd.new"), attrs: { value: "" } }), ...list.map((i) => el("option", { text: label(i), attrs: { value: i.id } }))]);
      select.value = model.cdSelected || "";
    }
    const note = byId("cdSavedNote");
    const del = byId("cdDeleteBtn");
    if (!note || !del) return;
    let text = ns.countdowns.note(t);
    if (!model.cdSelected && text === t("date.cd.note.saved")) text = "";
    if (m.cdFull) text = t("date.cd.note.full", { max: num(ns.countdowns.MAX) });
    const canDelete = Boolean(model.cdSelected) && ns.countdowns.writable();
    if (!canDelete && document.activeElement === del) byId("countdownCalcBtn").focus();
    byId("cdSavedNoteText").textContent = text;
    flag(del, "hidden", !canDelete);
    flag(note, "hidden", text === "" && !canDelete);
  }

  function setPhase(phase) {
    const chip = byId("cdPhase");
    if (!chip) return;
    const text = phase ? m.t("date.cd.phase." + phase) : "";
    if (chip.textContent !== text) chip.textContent = text;
    flag(chip, "hidden", text === "");
    chip.classList.toggle("is-finished", phase === "finished" || phase === "finishedClosed");
  }

  // The polite status changes once per target and phase, never per tick.
  function setStatus(key, text) {
    if (key === m.cdStatusKey) return;
    m.cdStatusKey = key;
    const n = byId("cdStatus");
    if (n) n.textContent = text;
  }

  function clockIdle() {
    const c = byId("cdClock");
    if (!c) return;
    c.textContent = "—";
    c.classList.add("is-idle");
    c.classList.remove("is-past");
  }

  // "business days left": over [today, target) with the saved calendar,
  // recomputed on input, settings and day changes, never per tick.
  async function countdownBusinessLine(today, targetDate) {
    const b = await result("date.business_days", { startDate: today, endDate: targetDate, includeEndDay: false, calendar: calendar() });
    if (!b || typeof b.businessDays !== "number") return "";
    return m.t(b.direction === "backward" ? "date.cd.bizSince" : "date.cd.bizLeft", { n: value(num(b.businessDays)), calendar: calendarShort() }) +
      (b.usedApproximateHolidays === true ? sep() + m.t("date.cd.bizEstimated") : "");
  }

  async function updateCountdown(o) {
    if (!m) return;
    const fromTick = Boolean(o.fromTick);
    const ticket = ++m.seq.countdown;
    if (!fromTick) {
      m.last.countdown = null;
      m.cdFullPending = true;
    }
    const full = m.cdFullPending;
    const targetDate = read("cdTarget");
    const targetTime = read("cdTime");
    if (!targetDate) {
      m.last.countdown = null;
      cardIdle("countdown");
      clockIdle();
      setPhase("");
      setStatus("idle", m.t("date.cd.idle"));
      if (full) {
        await m.cals.cd.setView({ anchor: null });
        if (m && ticket === m.seq.countdown) m.cdFullPending = false;
      }
      return;
    }
    const now = o.now || ns.clock.nowMoment();
    const target = { date: targetDate, time: targetTime, utcOffsetMinutes: ns.clock.offsetAt(targetDate, targetTime) };
    const [res, bizLine] = await Promise.all([envelope("date.countdown", { now, target }), full ? countdownBusinessLine(now.date, targetDate) : Promise.resolve("")]);
    if (!m || ticket !== m.seq.countdown) return;
    const r = res && res.ok === "true" ? res.result : null;
    if (!r) {
      m.last.countdown = null;
      const message = errorText(res);
      cardError("countdown", message);
      clockIdle();
      setPhase("");
      setStatus("error|" + message, m.t("date.cd.stopped", { message }));
      if (full) {
        await m.cals.cd.setView({ anchor: targetDate });
        if (m && ticket === m.seq.countdown) m.cdFullPending = false;
      }
      return;
    }
    const clock = byId("cdClock");
    if (clock) {
      clock.textContent = str(r.clockText);
      clock.classList.remove("is-idle");
      clock.classList.toggle("is-past", r.status === "past");
    }
    traceLines("countdown", r.traceLines);
    live("countdown", m.t("date.live.value", { value: eng(r.text) }));
    const item = shownItem();
    const isFinished = r.status === "past" || r.status === "now";
    const phase = item ? ns.countdowns.phaseOf(item, res) : isFinished ? "finished" : "counting";
    setPhase(phase);
    setStatus(targetDate + "|" + str(r.targetTime) + "|" + phase, ns.countdowns.statusText(m.t, phase, r));
    if (item && cardVisible()) ns.countdowns.rendered(item, res);
    m.last.countdown = {
      calculator: "countdown",
      inputs: { targetDate, targetTime },
      inputsText: (r.status === "past" ? "← " : "→ ") + targetDate + (targetTime ? " " + targetTime : ""),
      resultText: str(r.summaryText),
      copyText: str(r.copyText)
    };
    // The polite result region changes only on an input change or a
    // Calculate, never on a plain tick; the clock itself is not live.
    if (full) {
      setResult("countdown", str(r.summaryText), [
        bizLine,
        join([unit("second", r.totalSeconds), unit("minute", r.totalMinutes), unit("hour", r.totalHours)]),
        m.t("date.cd.target", { when: eng(str(r.targetDate) + " " + str(r.targetTime) + " (" + str(r.targetWeekday) + ")") })
      ]);
      await m.cals.cd.setView({ anchor: targetDate, rangeStart: targetDate, rangeEnd: targetDate });
      if (!m || ticket !== m.seq.countdown) return;
      m.cdFullPending = false;
    }
    // An edit (not a tick) starts the shared ticker; its first tick comes
    // just after the next whole second, so "restored" shows until then.
    if (!fromTick) ns.countdowns.wake();
  }

  // Shown on the screen (a hidden page is markSeen's own check, and the
  // ticker stops while the page is hidden).
  function cardVisible() {
    const card = byId("card-countdown");
    return Boolean(m && card && card.isConnected && !m.layout.isCollapsed("countdown"));
  }

  async function applyQuick(kind) {
    const today = ns.clock.todayIso();
    let target = null;
    if (kind === "newYear") {
      const year = Number(today.slice(0, 4)) + 1;
      if (year <= 9999) target = ns.clock.pad(year, 4) + "-01-01";
    } else {
      const r = await result("date.add_subtract", { date: today, operation: "add", years: "", months: "", weeks: "", days: kind === "plus100" ? "100" : "30", businessDays: false, calendar: calendar() });
      if (r && isIso(r.resultDate)) target = r.resultDate;
    }
    if (!target || !m) return;
    setField("cdTarget", target);
    commitCountdown(true);
    await updateCountdown({});
  }

  // ---- shared actions ------------------------------------------------------------------------------

  const UPDATERS = {
    between: () => updateBetween(),
    add: () => updateAdd(),
    business: () => updateBusiness(),
    age: () => updateAge(),
    info: () => updateInfo(),
    countdown: () => updateCountdown({})
  };

  function record(key) {
    const last = m && m.last[key];
    if (!last || !last.copyText) return false;
    return ns.history.record(Object.assign({ tool: "date", calculatorLabel: m.t("date.card." + key) }, last));
  }

  async function calculateAndRecord(key) {
    await UPDATERS[key]();
    if (!m) return;
    record(key);
    m.say.now(() => speech(key));
  }

  async function copyResult(key, button) {
    const last = m.last[key];
    if (!last || !last.copyText) return false;
    let ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(last.copyText);
        ok = true;
      }
    } catch (_) {
      ok = false;
    }
    if (!ok || !m) return false;
    const label = m.t("date.copy");
    button.textContent = m.t("date.copied");
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = label;
    }, COPY_FEEDBACK_MS);
    record(key);
    return true;
  }

  function resetCard(key, opts) {
    const o = opts || {};
    switch (key) {
      case "between":
        setField("betweenStart", "");
        setField("betweenEnd", "");
        setCheck("betweenIncludeEnd", false);
        break;
      case "add":
        for (const id of ["addStart", ...AMOUNTS]) setField(id, "");
        break;
      case "business":
        setField("bizStart", "");
        setField("bizEnd", "");
        setCheck("bizIncludeEnd", false);
        resetBizPick();
        break;
      case "age":
        setField("ageBirth", "");
        setField("ageAsOf", "");
        break;
      case "info":
        setField("infoDate", "");
        break;
      case "countdown":
        // Clear empties the card and starts a new countdown; the saved list
        // is changed only by Delete.
        if (!o.keepSelection) model.cdSelected = null;
        setField("cdLabel", "");
        setField("cdTarget", "");
        setField("cdTime", "");
        m.cdFull = false;
        renderCountdownChrome();
        break;
      default:
        return Promise.resolve();
    }
    resultIdle(key);
    return UPDATERS[key]();
  }

  function setCheck(id, on) {
    const n = byId(id);
    if (n) n.checked = on;
    model.checks[id] = on;
  }

  // A phone (coarse pointer) keeps focus on Clear all: focusing a field
  // would raise the on-screen keyboard and hide the bottom bar.
  function clearAll() {
    const done = Promise.all(KEYS.map((k) => resetCard(k)));
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const first = coarse ? byId("dateClearAllBtn") : firstFocus();
    if (first) first.focus({ preventScroll: coarse });
    m.say.say(m.t("tool.cleared"));
    return done;
  }

  const FIRST = { between: "betweenStart", add: "addStart", business: "bizStart", age: "ageBirth", info: "infoDate", countdown: "cdTarget" };
  function firstFocus() {
    const order = m.layout.order();
    const key = order.find((k) => !m.layout.isCollapsed(k));
    if (key) return byId(FIRST[key]);
    const card = byId("card-" + order[0]);
    return card ? card.querySelector(".card-collapse") : null;
  }

  async function onPick(calKey, iso, o) {
    if (!isIso(iso) || !m) return;
    m.cals[calKey].setFocusDate(iso);
    if (calKey === "info") {
      setField("infoDate", iso);
      await updateInfo();
      return;
    }
    if (calKey === "cd") {
      // The target time is kept; a past day shows the finished state.
      setField("cdTarget", iso);
      commitCountdown(true);
      await updateCountdown({});
      return;
    }
    const target = o.shift ? "end" : model.bizPick;
    setField(target === "end" ? "bizEnd" : "bizStart", iso);
    setBizPick(target === "end" ? "start" : "end");
    m.anchor = iso;
    await updateBusiness();
  }

  // Midnight: today-dependent cards refresh when the local date changes.
  function checkRollover() {
    if (!m) return Promise.resolve();
    const today = ns.clock.todayIso();
    if (today === m.today) return Promise.resolve();
    m.today = today;
    return Promise.all([updateAge(), updateInfo(), m.cals.biz.refresh(), updateCountdown({})]);
  }

  async function refreshCalendarInfo() {
    const info = await result("date.validate_calendar", { calendar: m.ctx.settings.date.calendar });
    if (!m) return;
    m.calInfo = info;
    const text = calendarShort();
    for (const id of ["addCalendarSummaryText", "bizCalendarSummaryText"]) {
      const n = byId(id);
      if (n) n.textContent = text;
    }
  }

  // ---- building ------------------------------------------------------------------------------------

  function buildCards() {
    const t = m.t;
    const L = m.layout;
    const panel = (left, right) => [el("div", { className: "card-grid" }, [el("div", { className: "card-inputs" }, left), right])];

    const between = L.card("between", t("date.card.between"), t("date.card.between.sub"), panel([
      dateRow("betweenStart", "date.field.start", "date.today.start"),
      el("div", { className: "swap-row" }, [swapButton("swapBetweenBtn", "betweenStart", "betweenEnd", () => updateBetween())]),
      dateRow("betweenEnd", "date.field.end", "date.today.end"),
      checkRow("betweenIncludeEnd", t("date.between.include")),
      actionButtons("between"),
      resultBox("between")
    ], formula("between", {})));

    const addBtn = modeButton("addModeAddBtn", t("date.mode.add"), model.addMode === "add");
    const subBtn = modeButton("addModeSubtractBtn", t("date.mode.subtract"), model.addMode === "subtract");
    addBtn.addEventListener("click", () => setAddMode("add"));
    subBtn.addEventListener("click", () => setAddMode("subtract"));
    // Amounts take negatives: a ± key beside each (the iPhone keypad has no minus).
    const amount = (id, key) => el("div", { className: "date-field" }, [el("label", { className: "field-label", text: t(key), attrs: { for: id, id: id + "Label" } }), ns.signToggle.wrap(amountInput(id), t("field.sign", { field: t(key) }))]);
    const add = L.card("add", t("date.card.add"), t("date.card.add.sub"), panel([
      toggleGroup("date.mode.label", [addBtn, subBtn]),
      dateRow("addStart", "date.field.start", "date.today.start"),
      el("div", { className: "amount-grid" }, [amount("addYears", "date.field.years"), amount("addMonths", "date.field.months"), amount("addWeeks", "date.field.weeks"), amount("addDays", "date.field.days")]),
      checkRow("addBusiness", t("date.add.businessToggle"), "addBusinessNote"),
      el("p", { className: "hint", text: t("date.add.businessNote"), attrs: { id: "addBusinessNote", hidden: true } }),
      calendarSummary("addCalendarSummary", true),
      actionButtons("add"),
      resultBox("add")
    ], formula("add", {})));

    const pickStart = el("input", { attrs: { type: "radio", name: "bizPick", id: "bizPickStart", value: "start" } });
    const pickEnd = el("input", { attrs: { type: "radio", name: "bizPick", id: "bizPickEnd", value: "end" } });
    for (const radio of [pickStart, pickEnd]) radio.addEventListener("change", () => setBizPick(radio.checked ? radio.value : model.bizPick));
    const pick = el("fieldset", { className: "cal-pick", attrs: { id: "bizCalPick" } }, [
      el("legend", { className: "cal-pick-legend", text: t("date.cal.pickLegend") }),
      el("label", { className: "choice", attrs: { for: "bizPickStart" } }, [pickStart, el("span", { text: t("date.cal.pickStart") })]),
      el("label", { className: "choice", attrs: { for: "bizPickEnd" } }, [pickEnd, el("span", { text: t("date.cal.pickEnd") })])
    ]);
    const pickHint = el("p", { className: "hint cal-pick-hint", attrs: { id: "bizCalHint", role: "status", "aria-live": "polite" } });
    m.cals.biz = calendarFor("biz", "bizCal", "date.legend.endpoints", () => ({ start: read("bizStart"), end: read("bizEnd"), selected: "" }), [pick, pickHint]);
    const hits = el("div", { className: "holiday-hits", attrs: { id: "bizHolidayHits", hidden: true } }, [
      el("p", { className: "formula-title", text: t("date.biz.hitsTitle") }),
      el("ul", { className: "hit-list", attrs: { id: "bizHolidayList", "aria-label": t("date.biz.hitsTitle") } }),
      el("p", { className: "hint", attrs: { id: "bizHolidayMore", hidden: true } })
    ]);
    const business = L.card("business", t("date.card.business"), t("date.card.business.sub"), panel([
      dateRow("bizStart", "date.field.start", "date.today.start"),
      el("div", { className: "swap-row" }, [swapButton("swapBizBtn", "bizStart", "bizEnd", () => updateBusiness())]),
      dateRow("bizEnd", "date.field.end", "date.today.end"),
      checkRow("bizIncludeEnd", t("date.biz.include")),
      calendarSummary("bizCalendarSummary", false),
      actionButtons("business"),
      resultBox("business")
    ], formula("business", { after: [m.cals.biz.node, hits] })));

    const feb = modeButton("ageLeapFeb28Btn", t("date.age.feb28"), model.leap === "feb28");
    const mar = modeButton("ageLeapMar1Btn", t("date.age.mar1"), model.leap === "mar1");
    feb.addEventListener("click", () => setLeap("feb28"));
    mar.addEventListener("click", () => setLeap("mar1"));
    const age = L.card("age", t("date.card.age"), t("date.card.age.sub"), panel([
      field("ageBirth", t("date.field.birth"), dateInput("ageBirth")),
      el("div", { className: "date-field" }, [
        el("label", { className: "field-label", text: t("date.field.asOf"), attrs: { for: "ageAsOf" } }),
        el("div", { className: "date-row" }, [dateInput("ageAsOf", { "aria-describedby": "ageAsOfHint" }), todayFor("ageAsOf", "date.today.asOf")]),
        el("p", { className: "hint", attrs: { id: "ageAsOfHint" } })
      ]),
      el("div", { className: "toggle-row" }, [el("span", { className: "field-label", text: t("date.age.leapLabel"), attrs: { id: "ageLeapLabel" } }),
        el("div", { className: "toggle-group", attrs: { role: "group", "aria-labelledby": "ageLeapLabel" } }, [feb, mar])]),
      actionButtons("age"),
      resultBox("age")
    ], formula("age", {})));

    m.cals.info = calendarFor("info", "infoCal", "date.legend.selected", () => ({ start: "", end: "", selected: read("infoDate") }), []);
    const info = L.card("info", t("date.card.info"), t("date.card.info.sub"), panel([
      dateRow("infoDate", "date.field.date", "date.today.date"),
      actionButtons("info"),
      resultBox("info")
    ], formula("info", { after: [m.cals.info.node] })));

    const select = el("select", { className: "select", attrs: { id: "cdSelect" } });
    select.addEventListener("change", () => selectCountdownInCard(select.value || null));
    const del = el("button", { className: "button link-button", text: t("date.cd.delete"), attrs: { type: "button", id: "cdDeleteBtn", hidden: true } });
    del.addEventListener("click", () => deleteCountdown());
    const pill = (kind, key) => {
      const b = el("button", { className: "button chip-button", text: t(key), attrs: { type: "button", id: "cdQuick-" + kind, "data-value": kind } });
      b.addEventListener("click", () => applyQuick(kind));
      return b;
    };
    m.cals.cd = calendarFor("cd", "cdCal", "date.legend.target", () => ({ start: "", end: "", selected: read("cdTarget") }), []);
    const countdown = L.card("countdown", t("date.card.countdown"), t("date.card.countdown.sub"), panel([
      field("cdSelect", t("date.cd.select"), select),
      field("cdLabel", t("date.cd.label"), el("input", { className: "input", attrs: { id: "cdLabel", type: "text", maxlength: String(ns.countdowns.LABEL_MAX), autocomplete: "off", dir: "auto" } })),
      dateRow("cdTarget", "date.field.target", "date.today.target"),
      el("div", { className: "chip-row", attrs: { role: "group", "aria-label": t("date.cd.quick") } }, [pill("newYear", "date.cd.quick.newYear"), pill("plus30", "date.cd.quick.plus30"), pill("plus100", "date.cd.quick.plus100")]),
      field("cdTime", t("date.field.time"), el("input", { className: "input date-input", attrs: { id: "cdTime", type: "time", step: "60" } })),
      el("div", { className: "saved-note", attrs: { id: "cdSavedNote", hidden: true } }, [el("span", { className: "hint", attrs: { id: "cdSavedNoteText" } }), del]),
      actionButtons("countdown"),
      resultBox("countdown")
    ], formula("countdown", {
      before: [
        el("div", { className: "cd-phase-row" }, [el("span", { className: "cd-phase", attrs: { id: "cdPhase", hidden: true, "aria-hidden": "true" } })]),
        el("p", { className: "cd-clock is-idle", text: "—", attrs: { id: "cdClock", role: "timer", "aria-labelledby": "card-countdown-title" } }),
        el("p", { className: "cd-status", text: t("date.cd.idle"), attrs: { id: "cdStatus", role: "status", "aria-live": "polite" } })
      ],
      after: [m.cals.cd.node]
    })));
    return [between, add, business, age, info, countdown];
  }

  function todayFor(id, labelKey) {
    const b = el("button", { className: "button today-button", text: m.t("date.today"), attrs: { type: "button", id: id + "TodayBtn", "aria-label": m.t(labelKey) } });
    b.addEventListener("click", () => {
      const input = byId(id);
      input.value = ns.clock.todayIso();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return b;
  }

  function swapButton(id, a, b, then) {
    const button = el("button", { className: "button swap-button", text: m.t("date.swap"), attrs: { type: "button", id } });
    button.addEventListener("click", () => {
      const x = read(a);
      setField(a, read(b));
      setField(b, x);
      then();
    });
    return button;
  }

  function calendarFor(key, prefix, selectedLegend, marks, top) {
    return ns.miniCal.create({
      prefix,
      t: m.t,
      call: (op, req) => result(op, req),
      calendar: () => calendar(),
      firstDay,
      today: () => ns.clock.todayIso(),
      marks,
      onPick: (iso, o) => onPick(key, iso, o),
      legend: [["swatch-endpoint", selectedLegend]].concat(key === "biz" ? [["swatch-range", "date.legend.range"]] : [], legend(selectedLegend).slice(1)),
      top
    });
  }

  // Live inputs: every keystroke recomputes; a commit (change) of the
  // countdown target saves it. Commit listeners first, so a render that
  // follows sees the saved record.
  function bind(root) {
    const on = (id, types, fn) => {
      const n = byId(id);
      if (n) for (const type of types) n.addEventListener(type, fn);
    };
    root.addEventListener("input", (e) => remember(e.target));
    root.addEventListener("change", (e) => remember(e.target));
    on("betweenStart", ["input", "change"], () => updateBetween());
    on("betweenEnd", ["input", "change"], () => updateBetween());
    on("betweenIncludeEnd", ["change"], () => updateBetween());
    on("addStart", ["input", "change"], () => updateAdd());
    for (const id of AMOUNTS) {
      on(id, ["input"], () => {
        const n = byId(id);
        const normal = ns.format.normalizeDigits(n.value);
        if (normal !== n.value) n.value = normal;
        updateAdd();
      });
      on(id, ["paste"], (e) => onAmountPaste(e, byId(id)));
    }
    on("addBusiness", ["change"], () => {
      syncAddBusiness();
      updateAdd();
    });
    on("bizStart", ["input", "change"], () => updateBusiness());
    on("bizEnd", ["input", "change"], () => updateBusiness());
    on("bizIncludeEnd", ["change"], () => updateBusiness());
    on("bizStart", ["focus"], () => setBizPick("start"));
    on("bizEnd", ["focus"], () => setBizPick("end"));
    // A date committed by typing moves the pick on to the other, still
    // empty end, so the next tap fills it instead of overwriting.
    on("bizStart", ["change"], () => {
      if (read("bizStart") && !read("bizEnd")) setBizPick("end");
    });
    on("bizEnd", ["change"], () => {
      if (read("bizEnd") && !read("bizStart")) setBizPick("start");
    });
    on("ageBirth", ["input", "change"], () => updateAge());
    on("ageAsOf", ["input", "change"], () => updateAge());
    on("infoDate", ["input", "change"], () => updateInfo());
    for (const id of ["cdTarget", "cdTime", "cdLabel"]) on(id, ["change"], () => commitCountdown(true));
    on("cdTarget", ["input", "change"], () => updateCountdown({}));
    on("cdTime", ["input", "change"], () => updateCountdown({}));
    const ENTER = { between: ["betweenStart", "betweenEnd"], add: ["addStart", ...AMOUNTS], business: ["bizStart", "bizEnd"], age: ["ageBirth", "ageAsOf"], info: ["infoDate"], countdown: ["cdTarget", "cdTime"] };
    for (const [key, ids] of Object.entries(ENTER)) {
      for (const id of ids) {
        on(id, ["keydown"], (e) => {
          if (e.key === "Enter") calculateAndRecord(key);
        });
        // Typing is spoken once it pauses, never per keystroke.
        on(id, ["input"], () => m.say.soon(() => speech(key)));
      }
    }
  }

  // "1,000" pasted into an amount becomes 1000; a non-number paste is blocked.
  function onAmountPaste(event, input) {
    const raw = event.clipboardData && typeof event.clipboardData.getData === "function" ? event.clipboardData.getData("text") : null;
    if (typeof raw !== "string") return;
    const plain = /^[+-]?\d{1,15}$/;
    const trimmed = raw.trim();
    if (!trimmed || plain.test(trimmed)) return;
    const cleaned = ns.format.normalizeDigits(trimmed).replace(/[\s,_'٬]+/g, "");
    event.preventDefault();
    if (plain.test(cleaned)) {
      input.value = cleaned;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function remember(target) {
    const id = target && typeof target.getAttribute === "function" ? target.getAttribute("id") : null;
    if (!id) return;
    if (TEXT_FIELDS.includes(id)) model.fields[id] = target.value;
    else if (CHECKS.includes(id)) model.checks[id] = Boolean(target.checked);
  }

  function restoreModel() {
    for (const id of TEXT_FIELDS) {
      const n = byId(id);
      if (n && typeof model.fields[id] === "string") n.value = model.fields[id];
    }
    for (const id of CHECKS) {
      const n = byId(id);
      if (n) n.checked = Boolean(model.checks[id]);
    }
  }

  // The launch restore: the most recently saved countdown fills an empty
  // card once per session (the exact time left shows on the first render).
  function restoreCountdown() {
    if (model.cdInitialised) return;
    model.cdInitialised = true;
    if (read("cdTarget") !== "") return;
    const list = ns.countdowns.list();
    if (list.length === 0) return;
    const latest = list.reduce((a, b) => (b.savedAtMs > a.savedAtMs ? b : a));
    model.cdSelected = latest.id;
    setField("cdLabel", latest.label);
    setField("cdTarget", latest.targetDate);
    setField("cdTime", latest.targetTime);
  }

  function render(ctx) {
    leave();
    const t = ctx.t;
    const live = el("p", { className: "sr-only", attrs: { id: "dateLayoutLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const resultLive = el("p", { className: "sr-only", attrs: { id: "dateResultLive", role: "status", "aria-live": "polite", "aria-atomic": "true" } });
    const container = el("div", { className: "tool-cards", attrs: { id: "dateCards" } });
    const settings = ctx.settings.date;
    m = {
      ctx,
      t,
      seq: { between: 0, add: 0, business: 0, age: 0, info: 0, countdown: 0 },
      last: {},
      cals: {},
      anchor: null,
      calInfo: null,
      today: ns.clock.todayIso(),
      cdStatusKey: "",
      cdFull: false,
      cdFullPending: false,
      say: ns.announcer.create(resultLive),
      cleanups: []
    };
    m.cleanups.push(() => m.say.cancel());
    const state = ns.cardLayout.normalise(KEYS, settings);
    m.layout = ns.cardLayout.create({
      container,
      keys: KEYS.slice(),
      title: (key) => t("date.card." + key),
      t,
      state,
      live,
      hintId: "dateCardMoveHint",
      onChange: (s, o) => saveLayout(ctx, s, o),
      onExpand: (key) => {
        if (key === "countdown") updateCountdown({ fromTick: true });
      }
    });
    const cards = buildCards();
    container.replaceChildren(...cards);
    const clearAllBtn = el("button", { className: "button", text: t("date.clearAll"), attrs: { type: "button", id: "dateClearAllBtn" } });
    clearAllBtn.addEventListener("click", () => clearAll());
    const root = el("div", { className: "date-tool", attrs: { id: "dateTool" } }, [
      el("div", { className: "tool-bar" }, [el("p", { className: "hint tool-bar-text", text: t("date.toolHint") }), clearAllBtn]),
      el("p", { className: "sr-only", text: t("layout.moveHint"), attrs: { id: "dateCardMoveHint" } }),
      live,
      resultLive,
      container
    ]);
    m.root = root;
    restoreModel();
    m.layout.mount();
    bind(root);
    syncAddBusiness();
    restoreCountdown();
    if (model.bizPick === null) {
      model.bizPick = "start";
      resetBizPick();
    } else setBizPick(model.bizPick);
    renderCountdownChrome();
    if (model.expandCountdown) {
      model.expandCountdown = false;
      m.layout.expand("countdown");
    }
    const mine = m;
    if (model.revealCountdown) {
      model.revealCountdown = false;
      window.setTimeout(() => revealCountdown(mine), 0);
    }
    if (model.restoreKey) {
      const key = model.restoreKey;
      model.restoreKey = null;
      m.layout.expand(key);
      window.setTimeout(() => revealCard(mine, key), 0);
    }
    m.cleanups.push(ns.countdowns.watch({ visible: () => mine === m && cardVisible(), render: (now) => updateCountdown({ fromTick: true, now }) }));
    m.cleanups.push(ns.countdowns.onFlush(() => commitCountdown(false)));
    m.cleanups.push(ns.countdowns.subscribe(() => onCountdownsChanged()));
    const rollover = window.setInterval(() => checkRollover(), ROLLOVER_MS);
    m.cleanups.push(() => window.clearInterval(rollover));
    const onVisible = () => {
      if (document.visibilityState !== "hidden") checkRollover();
    };
    document.addEventListener("visibilitychange", onVisible);
    m.cleanups.push(() => document.removeEventListener("visibilitychange", onVisible));
    m.ready = (async () => {
      await refreshCalendarInfo();
      if (mine !== m) return;
      await Promise.all(KEYS.map((k) => UPDATERS[k]()));
    })();
    return [root];
  }

  // Another tab (or the pane) changed the list: the selector and note follow;
  // a selected countdown deleted elsewhere is let go.
  function onCountdownsChanged() {
    if (!m) return;
    if (model.cdSelected && !ns.countdowns.get(model.cdSelected)) model.cdSelected = null;
    const item = model.cdSelected ? ns.countdowns.get(model.cdSelected) : null;
    const card = byId("card-countdown");
    const editing = card && card.contains(document.activeElement);
    if (item && !editing && pairKey(item.targetDate, item.targetTime) !== pairKey(read("cdTarget"), read("cdTime"))) {
      setField("cdLabel", item.label);
      setField("cdTarget", item.targetDate);
      setField("cdTime", item.targetTime);
      updateCountdown({});
    }
    renderCountdownChrome();
  }

  function saveLayout(ctx, s, o) {
    ctx.settings.date.cardOrder = s.cardOrder;
    ctx.settings.date.collapsedCards = s.collapsedCards;
    ctx.layoutNote = o && o.reset ? "reset" : null;
    return ctx.saveSettings();
  }

  // Leaving the route (or re-rendering it): flush a typed countdown, stop
  // the card's ticks and timers, drop the document listeners.
  function leave() {
    if (!m) return;
    const old = m;
    commitCountdown(false);
    old.layout.destroy();
    for (const fn of old.cleanups) fn();
    m = null;
  }

  // The pane's Open: the card shows that countdown (now or at its next render).
  function selectCountdown(id) {
    const item = ns.countdowns.get(id);
    if (!item) return;
    model.cdSelected = item.id;
    model.cdInitialised = true;
    model.fields.cdLabel = item.label;
    model.fields.cdTarget = item.targetDate;
    model.fields.cdTime = item.targetTime;
    model.expandCountdown = true;
    model.revealCountdown = true;
    if (m) {
      m.layout.expand("countdown");
      selectCountdownInCard(item.id);
    }
  }

  // After the pane's Open the shell renders this route and puts focus on
  // the view (scrolled to the top); then the Countdown card is brought into
  // view and its title takes focus, so a phone shows what Open did.
  function revealCountdown(mine) {
    if (mine !== m) return;
    const card = byId("card-countdown");
    const title = byId("card-countdown-title");
    if (!card || !title) return;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
    if (typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "start" });
  }

  // A restored card comes into view and its title takes focus.
  function revealCard(mine, key) {
    if (mine !== m) return;
    const card = byId("card-" + key);
    const title = byId("card-" + key + "-title");
    if (!card || !title) return;
    title.setAttribute("tabindex", "-1");
    title.focus({ preventScroll: true });
    if (typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "start" });
  }

  // History restore (see the header): the entry's inputs (plan B10's
  // 15-field HistoryInputs, per calculator) into the session model; the
  // next render (the panel navigates here) shows and computes them.
  function restore(entry) {
    const key = entry && entry.calculator;
    const i = entry && entry.inputs && typeof entry.inputs === "object" ? entry.inputs : null;
    if (!i || !KEYS.includes(key)) return false;
    const f = model.fields;
    const c = model.checks;
    const s = (v) => (typeof v === "string" ? v : "");
    switch (key) {
      case "between":
        f.betweenStart = s(i.startDate);
        f.betweenEnd = s(i.endDate);
        c.betweenIncludeEnd = i.includeEndDay === "true";
        break;
      case "add":
        f.addStart = s(i.date);
        model.addMode = i.operation === "subtract" ? "subtract" : "add";
        f.addYears = s(i.years);
        f.addMonths = s(i.months);
        f.addWeeks = s(i.weeks);
        f.addDays = s(i.days);
        c.addBusiness = i.businessDays === "true";
        break;
      case "business":
        f.bizStart = s(i.startDate);
        f.bizEnd = s(i.endDate);
        c.bizIncludeEnd = i.includeEndDay === "true";
        break;
      case "age":
        f.ageBirth = s(i.birthDate);
        f.ageAsOf = s(i.asOfDate);
        model.leap = i.leapDayRule === "mar1" ? "mar1" : "feb28";
        break;
      case "info":
        f.infoDate = s(i.date);
        break;
      default:
        // Shown, not saved: leaving the tool does not add it to the list.
        f.cdTarget = s(i.targetDate);
        f.cdTime = s(i.targetTime);
        f.cdLabel = "";
        model.cdSelected = null;
        model.cdInitialised = true;
        model.cdForgotten = pairKey(f.cdTarget, f.cdTime);
    }
    model.restoreKey = key;
    return true;
  }

  // Settings > Layout > Reset card order & expand all.
  function resetLayout(ctx) {
    if (m) {
      m.layout.reset();
      return;
    }
    saveLayout(ctx, { cardOrder: KEYS.slice(), collapsedCards: [] }, { reset: true });
  }

  ns.dateTool = Object.freeze({
    KEYS,
    render,
    leave,
    selectCountdown,
    restore,
    resetLayout,
    ready: () => (m ? m.ready : Promise.resolve()),
    model: () => JSON.parse(JSON.stringify(model))
  });
})();
