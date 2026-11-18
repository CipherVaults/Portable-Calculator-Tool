// The local clock (plan B4: localNowParts and offsetAt from the Date
// Calculator's main.js). Engines never read a clock: "today" and "now"
// are always inputs, taken here from the LOCAL components of Date (never
// the UTC ISO string), with the UTC offset in effect at that instant.
(function () {
  "use strict";

  const pad = (n, width) => String(n).padStart(width || 2, "0");

  // date-core accepts offsets of at most ±18 h.
  function clampOffset(minutes) {
    if (!Number.isFinite(minutes)) return 0;
    return Math.max(-1080, Math.min(1080, minutes));
  }

  function nowParts() {
    const d = new Date();
    return {
      y: d.getFullYear(),
      m: d.getMonth() + 1,
      d: d.getDate(),
      hh: d.getHours(),
      mi: d.getMinutes(),
      ss: d.getSeconds(),
      offset: clampOffset(Math.round(-d.getTimezoneOffset()))
    };
  }

  function todayIso() {
    const p = nowParts();
    return pad(p.y, 4) + "-" + pad(p.m) + "-" + pad(p.d);
  }

  // The engine's {date, time, utcOffsetMinutes} for now.
  function nowMoment() {
    const p = nowParts();
    return {
      date: pad(p.y, 4) + "-" + pad(p.m) + "-" + pad(p.d),
      time: pad(p.hh) + ":" + pad(p.mi) + ":" + pad(p.ss),
      utcOffsetMinutes: p.offset
    };
  }

  // The UTC offset in effect at a local date-time (DST-correct per
  // instant). setFullYear keeps years 0001..0099 from being read as 19xx.
  function offsetAt(dateIso, timeText) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
    if (!dm) return nowParts().offset;
    const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeText || "");
    const d = new Date(2000, 0, 1, 0, 0, 0, 0);
    d.setFullYear(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
    d.setHours(tm ? Number(tm[1]) : 0, tm ? Number(tm[2]) : 0, tm && tm[3] ? Number(tm[3]) : 0, 0);
    return clampOffset(Math.round(-d.getTimezoneOffset()));
  }

  window.PCalc.clock = Object.freeze({
    pad,
    nowMs: () => Date.now(),
    todayIso,
    nowMoment,
    offsetAt
  });
})();
