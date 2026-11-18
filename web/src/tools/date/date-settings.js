// Settings for the Date tool (plan B9, B11): the calendar in
// settings.date.calendar (weekend presets or custom days, a holiday preset
// US/UK/EG, Egypt switching the weekend to Fri/Sat, the Hijri offset ±2 and
// per-year overrides of estimated Islamic holidays, up to 100 custom
// holidays, per-holiday exclusions), the first day of the week in
// settings.date.firstDayOfWeek, and Layout > Reset for the card order.
//
// Commit on success: every change is checked by the engine
// (date.validate_calendar, the same rules as settings.validate) before it
// replaces the calendar; a refused change shows its error and keeps the
// last good calendar. Changes run one at a time, in order.
(function () {
  "use strict";
  const ns = window.PCalc;
  const { el, byId, show, flag, value, withValues } = ns.dom;
  const MAX_CUSTOM = 100;
  const HIJRI_OFFSET_MAX = 2;
  const HIJRI_YEAR_MIN = 1317;
  const HIJRI_YEAR_MAX = 1626;
  const YEAR_MIN = 1900;
  const YEAR_MAX = 2199;
  const PRESETS = ["none", "us", "uk", "eg"];
  const WEEKENDS = { satSun: [6, 7], friSat: [5, 6], friOnly: [5] };
  const HIJRI_EVENTS = new Set(["islamicNewYear", "mawlid", "eidAlFitr", "eidAlAdha"]);

  // Kept across re-renders of Settings (session only).
  const ui = { weekendCustom: false, year: null };
  let s = null; // the rendered section
  let queue = Promise.resolve();

  const str = (v) => (typeof v === "string" ? v : "");
  const copy = (v) => JSON.parse(JSON.stringify(v));

  async function envelope(op, req) {
    try {
      return JSON.parse(await s.ctx.platform.engine(op, JSON.stringify(req)));
    } catch (_) {
      return null;
    }
  }

  function sameDays(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const x = a.slice().sort((p, q) => p - q);
    const y = b.slice().sort((p, q) => p - q);
    return x.every((v, i) => v === y[i]);
  }
  function weekendMode(days) {
    for (const [mode, list] of Object.entries(WEEKENDS)) if (sameDays(days, list)) return mode;
    return "custom";
  }

  const calendar = () => (s.info && s.info.calendar ? s.info.calendar : ns.miniCal.fullCalendar(s.ctx.settings.date.calendar));

  // ---- errors ----------------------------------------------------------------

  function showError(target, message) {
    const n = byId({ weekend: "weekendError", custom: "customHolidayError", holidays: "holidayError" }[target] || "calendarStatus");
    if (!n) return;
    n.textContent = message;
    flag(n, "hidden", false);
    n.classList.add("is-error");
  }
  function clearErrors() {
    for (const id of ["weekendError", "customHolidayError", "holidayError"]) {
      const n = byId(id);
      if (!n) continue;
      n.textContent = "";
      flag(n, "hidden", true);
    }
    const st = byId("calendarStatus");
    if (st) st.classList.remove("is-error");
  }

  // ---- commit ----------------------------------------------------------------

  // mutate(next) changes a copy of the calendar (false = nothing to do);
  // the engine checks it; on success it becomes settings.date.calendar.
  function commit(mutate, target) {
    const run = async () => {
      if (!s) return false;
      const mine = s;
      const next = copy(calendar());
      if (mutate(next) === false) return false;
      clearErrors();
      const r = await envelope("date.validate_calendar", { calendar: next });
      if (mine !== s) return false;
      if (!r || r.ok !== "true") {
        paint();
        showError(target, r && r.error && r.error.message ? r.error.message : s.t("date.set.saveFailed"));
        await refreshPreview();
        return false;
      }
      s.info = r.result;
      s.ctx.settings.date.calendar = r.result.calendar;
      const saved = s.ctx.saveSettings();
      paint();
      await refreshPreview();
      await saved;
      return true;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => false);
    return p;
  }

  // ---- painting ----------------------------------------------------------------

  function setPressed(n, on) {
    n.classList.toggle("active", on);
    n.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function paint() {
    if (!s) return;
    const t = s.t;
    const cal = calendar();
    const mode = ui.weekendCustom ? "custom" : weekendMode(cal.weekend);
    for (const [m2, b] of Object.entries(s.weekendButtons)) setPressed(b, m2 === mode);
    flag(byId("weekendCustom"), "hidden", mode !== "custom");
    for (let iso = 1; iso <= 7; iso++) {
      const box = byId("weekendDay" + iso);
      if (box) box.checked = cal.weekend.includes(iso);
    }
    const work = 7 - cal.weekend.length;
    show(byId("weekendNote"), withValues(t("date.set.workdays", { plural: work, count: value(String(work)) })));
    const preset = byId("holidayPresetSelect");
    preset.value = cal.preset;
    const egypt = cal.preset === "eg";
    flag(byId("egyptWeekendNote"), "hidden", !egypt);
    flag(byId("hijriBlock"), "hidden", !egypt);
    const offset = Number(cal.hijriOffsetDays) || 0;
    byId("hijriOffsetValue").textContent = offset > 0 ? "+" + offset : String(offset);
    flag(byId("hijriMinusBtn"), "disabled", offset <= -HIJRI_OFFSET_MAX);
    flag(byId("hijriPlusBtn"), "disabled", offset >= HIJRI_OFFSET_MAX);
    paintCustom();
    byId("firstDayOfWeekSelect").value = s.ctx.settings.date.firstDayOfWeek === "sunday" ? "sunday" : "monday";
    const status = byId("calendarStatus");
    if (status && !status.classList.contains("is-error")) status.textContent = s.info ? str(s.info.summaryText) : "";
  }

  function paintCustom() {
    const t = s.t;
    const list = byId("customHolidayList");
    const customs = Array.isArray(calendar().customHolidays) ? calendar().customHolidays : [];
    byId("customHolidayCount").textContent = t("date.set.customCount", { count: customs.length, max: MAX_CUSTOM });
    flag(byId("customHolidayAddBtn"), "disabled", customs.length >= MAX_CUSTOM);
    if (customs.length === 0) {
      show(list, [el("li", { className: "holiday-empty", text: t("date.set.customEmpty") })]);
      return;
    }
    show(list, customs.map((c) => {
      const name = str(c.name);
      const when = c.kind === "yearly"
        ? t(typeof c.fromYear === "number" ? "date.set.yearlyFrom" : "date.set.yearly", { md: ns.clock.pad(Number(c.month) || 0) + "-" + ns.clock.pad(Number(c.day) || 0), year: String(c.fromYear) })
        : str(c.date);
      const del = el("button", { className: "button", text: "×", attrs: { type: "button", title: t("date.set.customDelete", { name }), "aria-label": t("date.set.customDelete", { name }) } });
      del.addEventListener("click", () => commit((next) => {
        next.customHolidays = next.customHolidays.filter((x) => x.id !== c.id);
      }, "custom"));
      return el("li", { className: "holiday-row" }, [
        el("div", { className: "holiday-main" }, [
          el("bdi", { className: "holiday-name", text: name, attrs: { dir: "auto" } }),
          el("span", { className: "holiday-date", text: when }),
          c.enabled === false ? el("span", { className: "holiday-flag", text: t("date.set.disabled") }) : null
        ]),
        del
      ]);
    }));
  }

  // ---- holiday preview (the preset's holidays of one year) ----------------------

  async function findHijriYear(event, date) {
    const gy = Number(date.slice(0, 4));
    const estimate = Math.floor((gy - 622) * 1.030684);
    for (const hy of [estimate, estimate + 1, estimate - 1, estimate + 2, estimate - 2]) {
      if (hy < HIJRI_YEAR_MIN || hy > HIJRI_YEAR_MAX) continue;
      const cal = copy(calendar());
      cal.hijriOverrides = cal.hijriOverrides.filter((o) => !(o.hijriYear === hy && o.event === event));
      cal.hijriOverrides.push({ hijriYear: hy, event, date });
      const r = await envelope("date.validate_calendar", { calendar: cal });
      if (r && r.ok === "true") return hy;
    }
    return null;
  }

  async function setOverride(instance, newDate) {
    const event = instance.id;
    const existing = calendar().hijriOverrides.find((o) => o.event === event && o.date === instance.date);
    if (!newDate) {
      if (!existing) return true;
      return commit((next) => {
        next.hijriOverrides = next.hijriOverrides.filter((o) => !(o.event === event && o.hijriYear === existing.hijriYear));
      }, "holidays");
    }
    if (!ns.miniCal.parseIso(newDate)) return false;
    const hijriYear = existing ? existing.hijriYear : await findHijriYear(event, instance.date);
    if (hijriYear === null) {
      showError("holidays", s.t("date.set.hijriNoYear"));
      await refreshPreview();
      return false;
    }
    return commit((next) => {
      next.hijriOverrides = next.hijriOverrides.filter((o) => !(o.event === event && o.hijriYear === hijriYear));
      next.hijriOverrides.push({ hijriYear, event, date: newDate });
    }, "holidays");
  }

  function previewRow(inst, i, excluded, overrides) {
    const t = s.t;
    const off = excluded.includes(inst.id);
    const box = el("input", { attrs: { type: "checkbox", id: "holidayRow" + i, "data-focus-key": str(inst.id) + "|" + str(inst.date) + "|check" } });
    box.checked = !off;
    box.addEventListener("change", () => {
      const preset = calendar().preset;
      commit((next) => {
        const list = (Array.isArray(next.excludedHolidays[preset]) ? next.excludedHolidays[preset] : []).filter((x) => x !== inst.id);
        if (!box.checked) list.push(inst.id);
        next.excludedHolidays[preset] = list;
      }, "holidays");
    });
    const name = typeof inst.dayIndex === "number" ? t("date.set.dayIndex", { name: str(inst.name), day: String(inst.dayIndex) }) : str(inst.name);
    const meta = [el("span", { className: "holiday-date", text: str(inst.date) })];
    if (inst.shifted === true) meta.push(el("span", { className: "holiday-flag", text: t("date.set.actual", { date: str(inst.actualDate) }) }));
    if (inst.onWeekend === true) meta.push(el("span", { className: "holiday-flag", text: t("date.set.onWeekend") }));
    if (inst.approximate === true) meta.push(el("span", { className: "approx-tag", text: t("date.estimated") }));
    const row = el("li", { className: off ? "holiday-row is-excluded" : "holiday-row" }, [
      el("label", { className: "choice holiday-check", attrs: { for: "holidayRow" + i } }, [box, el("span", { className: "holiday-name", text: name })]),
      el("div", { className: "holiday-meta" }, meta)
    ]);
    const overridable = inst.approximate === true && HIJRI_EVENTS.has(inst.id) && (inst.dayIndex === null || inst.dayIndex === undefined || inst.dayIndex === 1);
    if (overridable) {
      const current = overrides.find((o) => o.event === inst.id && o.date === inst.date);
      const input = el("input", { className: "input date-input", attrs: { type: "date", id: "holidayOverride" + i, min: "1900-01-01", max: "2199-12-31", "data-focus-key": str(inst.id) + "|" + str(inst.date) + "|override" } });
      input.value = current ? current.date : "";
      input.addEventListener("change", () => setOverride(inst, input.value.trim()));
      row.append(el("div", { className: "date-field holiday-override" }, [
        el("label", { className: "field-label", text: t(current ? "date.set.overrideSet" : "date.set.override"), attrs: { for: "holidayOverride" + i } }),
        input
      ]));
    }
    return row;
  }

  async function refreshPreview() {
    if (!s) return;
    const mine = s;
    const ticket = ++s.previewSeq;
    const t = s.t;
    const cal = calendar();
    byId("holidayYearValue").textContent = String(ui.year);
    flag(byId("holidayYearPrevBtn"), "disabled", ui.year <= YEAR_MIN);
    flag(byId("holidayYearNextBtn"), "disabled", ui.year >= YEAR_MAX);
    const list = byId("holidayPreviewList");
    const warn = byId("holidayWarning");
    if (!cal.preset || cal.preset === "none") {
      show(list, [el("li", { className: "holiday-empty", text: t("date.set.previewNone") })]);
      flag(warn, "hidden", true);
      return;
    }
    // Every preset holiday is listed (exclusions and custom holidays
    // dropped from this unsaved variant), so each can be switched back on.
    const preview = copy(cal);
    preview.excludedHolidays = { us: [], uk: [], eg: [] };
    preview.customHolidays = [];
    const y = ns.clock.pad(ui.year, 4);
    const r = await envelope("date.holidays_in_range", { startDate: y + "-01-01", endDate: y + "-12-31", calendar: preview });
    if (mine !== s || ticket !== s.previewSeq) return;
    if (!r || r.ok !== "true") {
      show(list, [el("li", { className: "holiday-empty", text: t("date.set.previewFailed") })]);
      return;
    }
    const res = r.result;
    const instances = Array.isArray(res.holidays) ? res.holidays.filter((h) => h && typeof h === "object" && h.source !== "custom") : [];
    const excluded = Array.isArray(cal.excludedHolidays && cal.excludedHolidays[cal.preset]) ? cal.excludedHolidays[cal.preset] : [];
    const overrides = Array.isArray(cal.hijriOverrides) ? cal.hijriOverrides : [];
    // Rebuilding the rows destroys the focused control: focus goes to the
    // matching control of the new row.
    const active = document.activeElement;
    const focusKey = active && list.contains(active) ? active.getAttribute("data-focus-key") || "" : "";
    const presetName = t("date.preset." + cal.preset);
    if (instances.length === 0) show(list, [el("li", { className: "holiday-empty", text: t("date.set.previewEmpty", { preset: presetName, year: String(ui.year) }) })]);
    else show(list, instances.map((inst, i) => previewRow(inst, i, excluded, overrides)));
    if (focusKey) {
      const target = Array.from(list.querySelectorAll("[data-focus-key]")).find((n) => n.getAttribute("data-focus-key") === focusKey);
      if (target) target.focus();
      else byId("holidayPresetSelect").focus();
    }
    const out = Array.isArray(res.warnings) && res.warnings.includes("presetYearOutOfRange");
    const info = s.info;
    const covers = info && typeof info.presetFirstYear === "number" && typeof info.presetLastYear === "number";
    warn.textContent = out ? t(covers ? "date.set.outOfRangeCovers" : "date.set.outOfRange", { preset: presetName, year: String(ui.year), first: covers ? String(info.presetFirstYear) : "", last: covers ? String(info.presetLastYear) : "" }) : "";
    flag(warn, "hidden", !out);
  }

  // ---- building ----------------------------------------------------------------

  function panel(id, title, children) {
    return el("section", { className: "panel", attrs: { id } }, [el("h2", { className: "panel-title", text: title }), ...children]);
  }

  function panels(ctx) {
    const t = ctx.t;
    s = { ctx, t, info: null, previewSeq: 0, weekendButtons: {} };
    if (ui.year === null) ui.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Number(ns.clock.todayIso().slice(0, 4)) || 2026));

    // Weekend
    const wb = (mode, key) => {
      const b = el("button", { className: "button mode-button", text: t(key), attrs: { type: "button", id: "weekend-" + mode, "aria-pressed": "false" } });
      b.addEventListener("click", () => {
        if (mode === "custom") {
          ui.weekendCustom = true;
          paint();
          const first = byId("weekendDay1");
          if (first) first.focus();
          return;
        }
        ui.weekendCustom = false;
        commit((next) => {
          next.weekend = WEEKENDS[mode].slice();
        }, "weekend");
      });
      s.weekendButtons[mode] = b;
      return b;
    };
    const days = [];
    for (let iso = 1; iso <= 7; iso++) {
      const box = el("input", { attrs: { type: "checkbox", id: "weekendDay" + iso, "data-value": String(iso) } });
      box.addEventListener("change", () => {
        const picked = [];
        for (let d = 1; d <= 7; d++) if (byId("weekendDay" + d).checked) picked.push(d);
        if (picked.length === 7) {
          box.checked = false;
          showError("weekend", t("date.set.weekendAll"));
          return;
        }
        ui.weekendCustom = true;
        commit((next) => {
          next.weekend = picked;
        }, "weekend");
      });
      days.push(el("label", { className: "choice weekday-choice", attrs: { for: "weekendDay" + iso } }, [box, el("span", { text: ns.format.weekdayName(iso).slice(0, 3) })]));
    }
    const weekend = panel("settingsDateWeekend", t("date.set.weekend"), [
      el("div", { className: "toggle-group wrap", attrs: { role: "group", "aria-label": t("date.set.weekend") } }, [
        wb("satSun", "date.set.satSun"), wb("friSat", "date.set.friSat"), wb("friOnly", "date.set.friOnly"), wb("custom", "date.set.custom")
      ]),
      el("fieldset", { className: "choices weekday-grid", attrs: { id: "weekendCustom", hidden: true } }, [el("legend", { text: t("date.set.customDays") }), ...days]),
      el("p", { className: "hint", attrs: { id: "weekendNote" } }),
      el("p", { className: "form-error", attrs: { id: "weekendError", role: "alert", hidden: true } })
    ]);

    // Holidays
    const presetSelect = el("select", { className: "select", attrs: { id: "holidayPresetSelect" } },
      PRESETS.map((p) => el("option", { text: t("date.preset." + p), attrs: { value: p } })));
    presetSelect.addEventListener("change", () => {
      const v = presetSelect.value;
      if (!PRESETS.includes(v)) return;
      // Choosing Egypt switches the weekend to Fri/Sat (it can be changed
      // back); leaving Egypt never touches the weekend.
      if (v === "eg") ui.weekendCustom = false;
      commit((next) => {
        next.preset = v;
        if (v === "eg") next.weekend = WEEKENDS.friSat.slice();
      }, "holidays");
    });
    const stepper = (id, text, label, delta) => {
      const b = el("button", { className: "button stepper-button", text, attrs: { type: "button", id, "aria-label": t(label) } });
      b.addEventListener("click", () => commit((next) => {
        const cur = Number(next.hijriOffsetDays) || 0;
        const v = Math.max(-HIJRI_OFFSET_MAX, Math.min(HIJRI_OFFSET_MAX, cur + delta));
        if (v === cur) return false;
        next.hijriOffsetDays = v;
        return true;
      }, "holidays"));
      return b;
    };
    const yearButton = (id, text, label, delta) => {
      const b = el("button", { className: "button cal-nav", text, attrs: { type: "button", id, "aria-label": t(label), "aria-controls": "holidayPreviewList" } });
      b.addEventListener("click", () => {
        ui.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, ui.year + delta));
        refreshPreview();
      });
      return b;
    };
    const holidays = panel("settingsDateHolidays", t("date.set.holidays"), [
      el("div", { className: "field" }, [el("label", { className: "field-label", text: t("date.set.preset"), attrs: { for: "holidayPresetSelect" } }), presetSelect]),
      el("p", { className: "hint", text: t("date.set.egyptNote"), attrs: { id: "egyptWeekendNote", hidden: true } }),
      el("div", { className: "hijri-block", attrs: { id: "hijriBlock", hidden: true } }, [
        el("div", { className: "hijri-row" }, [
          el("span", { className: "field-label", text: t("date.set.hijriOffset"), attrs: { id: "hijriOffsetLabel" } }),
          el("div", { className: "stepper", attrs: { role: "group", "aria-labelledby": "hijriOffsetLabel" } }, [
            stepper("hijriMinusBtn", "−", "date.set.hijriMinus", -1),
            el("output", { className: "stepper-value", text: "0", attrs: { id: "hijriOffsetValue", "aria-live": "polite" } }),
            stepper("hijriPlusBtn", "+", "date.set.hijriPlus", 1)
          ]),
          el("span", { className: "approx-tag", text: t("date.estimated") })
        ]),
        el("p", { className: "hint", text: t("date.set.hijriNote") })
      ]),
      el("div", { className: "year-picker" }, [
        yearButton("holidayYearPrevBtn", "‹", "date.set.prevYear", -1),
        el("span", { className: "year-value", attrs: { id: "holidayYearValue", "aria-live": "polite" } }),
        yearButton("holidayYearNextBtn", "›", "date.set.nextYear", 1)
      ]),
      el("ul", { className: "holiday-list", attrs: { id: "holidayPreviewList", "aria-label": t("date.set.previewLabel") } }),
      el("p", { className: "hint", attrs: { id: "holidayWarning", hidden: true } }),
      el("p", { className: "form-error", attrs: { id: "holidayError", role: "alert", hidden: true } })
    ]);

    // Custom holidays
    const nameInput = el("input", { className: "input", attrs: { id: "customHolidayName", type: "text", maxlength: "60", autocomplete: "off", spellcheck: "false", dir: "auto" } });
    const dateInput = el("input", { className: "input date-input", attrs: { id: "customHolidayDate", type: "date", min: "1900-01-01", max: "2199-12-31" } });
    const yearly = el("input", { attrs: { id: "customHolidayYearly", type: "checkbox" } });
    const addBtn = el("button", { className: "button primary", text: t("date.set.customAdd"), attrs: { type: "button", id: "customHolidayAddBtn" } });
    const add = async () => {
      clearErrors();
      const name = nameInput.value.trim();
      const date = dateInput.value.trim();
      const customs = calendar().customHolidays;
      if (!name) return showError("custom", t("date.set.customNoName"));
      if (!ns.miniCal.parseIso(date)) return showError("custom", t("date.set.customNoDate"));
      if (customs.length >= MAX_CUSTOM) return showError("custom", t("date.set.customFull", { max: MAX_CUSTOM }));
      const taken = new Set(customs.map((c) => c.id));
      let id = null;
      for (let k = 0; k < 50 && !id; k++) {
        const n = window.crypto.getRandomValues(new Uint32Array(1))[0];
        const candidate = "c-" + n.toString(16).padStart(8, "0");
        if (!taken.has(candidate)) id = candidate;
      }
      if (!id) return false;
      const entry = yearly.checked
        ? { id, name, kind: "yearly", month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)), fromYear: Number(date.slice(0, 4)), enabled: true }
        : { id, name, kind: "date", date, enabled: true };
      const ok = await commit((next) => {
        next.customHolidays = next.customHolidays.concat(entry);
      }, "custom");
      if (ok) {
        nameInput.value = "";
        dateInput.value = "";
        yearly.checked = false;
      }
      return ok;
    };
    addBtn.addEventListener("click", () => add());
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    const custom = panel("settingsDateCustom", t("date.set.customTitle"), [
      el("p", { className: "hint", attrs: { id: "customHolidayCount" } }),
      el("div", { className: "field" }, [el("label", { className: "field-label", text: t("date.set.customName"), attrs: { for: "customHolidayName" } }), nameInput]),
      el("div", { className: "field" }, [el("label", { className: "field-label", text: t("date.set.customDate"), attrs: { for: "customHolidayDate" } }), dateInput]),
      el("label", { className: "choice", attrs: { for: "customHolidayYearly" } }, [yearly, el("span", { text: t("date.set.customYearly") })]),
      el("div", { className: "button-row" }, [addBtn]),
      el("p", { className: "form-error", attrs: { id: "customHolidayError", role: "alert", hidden: true } }),
      el("ul", { className: "holiday-list", attrs: { id: "customHolidayList", "aria-label": t("date.set.customTitle") } })
    ]);

    // Calendar (first day) and the summary
    const fdw = el("select", { className: "select", attrs: { id: "firstDayOfWeekSelect" } }, [
      el("option", { text: t("date.set.monday"), attrs: { value: "monday" } }),
      el("option", { text: t("date.set.sunday"), attrs: { value: "sunday" } })
    ]);
    fdw.addEventListener("change", () => {
      ctx.settings.date.firstDayOfWeek = fdw.value === "sunday" ? "sunday" : "monday";
      ctx.saveSettings();
    });
    const general = panel("settingsDateCalendar", t("date.set.calendar"), [
      el("div", { className: "field" }, [el("label", { className: "field-label", text: t("date.set.firstDay"), attrs: { for: "firstDayOfWeekSelect" } }), fdw]),
      el("p", { className: "status", attrs: { id: "calendarStatus", role: "status", "aria-live": "polite" } })
    ]);

    // Layout
    const reset = el("button", { className: "button", text: t("layout.reset"), attrs: { type: "button", id: "dateLayoutResetBtn" } });
    const layoutNote = el("p", { className: "status", attrs: { id: "dateLayoutNote", role: "status", "aria-live": "polite" } });
    const noteText = () => {
      const o = ctx.outcomes.settings;
      if (ctx.store.kind === "memory" || (o && o.readOnly)) return t("layout.note.session");
      return t(ctx.layoutNote === "reset" ? "layout.note.reset" : "layout.note.saved");
    };
    layoutNote.textContent = noteText();
    reset.addEventListener("click", async () => {
      await ns.dateTool.resetLayout(ctx);
      layoutNote.textContent = noteText();
    });
    const layout = panel("settingsDateLayout", t("layout.title"), [el("div", { className: "button-row" }, [reset]), layoutNote]);

    const out = [el("h2", { className: "settings-group-title", text: t("date.set.group"), attrs: { id: "settingsDateTitle" } }), general, weekend, holidays, custom, layout];
    // The first render: the engine's normalised calendar, then the preview.
    const mine = s;
    (async () => {
      const r = await envelope("date.validate_calendar", { calendar: ctx.settings.date.calendar });
      if (mine !== s || !byId("holidayPresetSelect")) return;
      s.info = r && r.ok === "true" ? r.result : null;
      paint();
      await refreshPreview();
    })();
    // "Edit in Settings" on a Date card lands here.
    if (ctx.settingsFocus === "dateCalendar") {
      ctx.settingsFocus = null;
      window.setTimeout(() => {
        const target = byId("weekend-satSun");
        if (target) {
          target.focus();
          if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });
        }
      }, 0);
    }
    return out;
  }

  ns.dateSettings = Object.freeze({ panels, ready: () => queue });
})();
