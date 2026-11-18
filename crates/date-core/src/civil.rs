//! Proleptic Gregorian civil-date arithmetic on `i64` day numbers (spec 1 §2).
//!
//! A day is identified by its [`EpochDay`]: the number of days since
//! 1970-01-01 (the Unix day number). Conversions use Howard Hinnant's
//! `days_from_civil` / `civil_from_days`, which work on 400-year "eras" of
//! exactly 146 097 days with the year starting on March 1 so that the leap day
//! is the last day of the internal year.
//!
//! All divisions are floor divisions and all remainders are Euclidean, so the
//! formulas are correct for negative values as well. The JS mirror uses
//! `div(a, b) = Math.floor(a / b)` and `mod(a, b) = ((a % b) + b) % b`.
//!
//! **Domain.** Every function here is exact for any day number or year whose
//! magnitude is below about 10^15, far beyond what the engine ever produces:
//! inputs are limited to 0001-01-01..=9999-12-31 by the parsers, and the only
//! out-of-range values are transient intermediates a few thousand years past
//! either end. The functions never panic inside that domain.

use serde::{Deserialize, Serialize};

/// Days since 1970-01-01 (the Unix day number).
pub type EpochDay = i64;

/// 0001-01-01, a Monday.
pub const MIN_EPOCH_DAY: EpochDay = -719_162;
/// 9999-12-31, a Friday.
pub const MAX_EPOCH_DAY: EpochDay = 2_932_896;
/// `JDN = epoch_day + JDN_OFFSET` (2 440 588 is the JDN of 1970-01-01).
pub const JDN_OFFSET: i64 = 2_440_588;
/// `MAX_EPOCH_DAY - MIN_EPOCH_DAY`, the largest possible day difference.
pub const SPAN_DAYS: i64 = MAX_EPOCH_DAY - MIN_EPOCH_DAY;
/// Seconds in a calendar day (date-only modes have no time zones).
pub const SECONDS_PER_DAY: i64 = 86_400;

/// Days from 0000-03-01 to 1970-01-01 in the Hinnant shifted calendar.
const UNIX_EPOCH_SHIFT: i64 = 719_468;
/// Days in a 400-year Gregorian era.
const DAYS_PER_ERA: i64 = 146_097;

/// A calendar date in astronomical year numbering (year 0 = 1 BCE).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Civil {
    /// Year (astronomical numbering).
    pub year: i64,
    /// Month, 1..=12.
    pub month: u32,
    /// Day of month, 1..=31.
    pub day: u32,
}

impl Civil {
    /// Builds a civil date without validation.
    pub const fn new(year: i64, month: u32, day: u32) -> Self {
        Self { year, month, day }
    }
}

/// How a February 29 start behaves when an anniversary lands in a common year
/// (FROZEN §8).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LeapDayRule {
    /// Plain month-end clamping: Feb 29 -> Feb 28 (the default everywhere).
    #[default]
    Feb28,
    /// UK-style: a Feb 29 start lands on Mar 1 in common years.
    Mar1,
}

/// ISO-8601 week date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct IsoWeek {
    /// ISO week-numbering year (may differ from the calendar year near Jan 1).
    pub year: i64,
    /// Week 1..=53.
    pub week: u32,
    /// ISO weekday 1 = Monday .. 7 = Sunday.
    pub weekday: u32,
}

/// Anniversary-walk breakdown of a span (see [`ymd_between`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Ymd {
    /// Whole years (`total_months / 12`).
    pub years: i64,
    /// Remaining months, 0..=11.
    pub months: i64,
    /// Days after the last month anniversary.
    pub days: i64,
    /// Whole months `M` (the largest month anniversary not after the end).
    pub total_months: i64,
}

/// `true` iff `z` is within 0001-01-01..=9999-12-31.
pub const fn in_range(z: EpochDay) -> bool {
    z >= MIN_EPOCH_DAY && z <= MAX_EPOCH_DAY
}

/// Clamps a half-open range bound to `MIN_EPOCH_DAY..=MAX_EPOCH_DAY + 1`, the
/// bounds of the supported days. Differences of clamped bounds always fit in
/// an `i64`, and every day in between is valid for the civil arithmetic, so
/// the public range helpers clamp their bounds with this before any
/// arithmetic.
pub const fn clamp_to_domain(z: EpochDay) -> EpochDay {
    if z < MIN_EPOCH_DAY {
        MIN_EPOCH_DAY
    } else if z > MAX_EPOCH_DAY + 1 {
        MAX_EPOCH_DAY + 1
    } else {
        z
    }
}

/// Gregorian leap-year rule (Euclidean remainders, so it also holds for
/// years <= 0).
pub const fn is_leap_year(y: i64) -> bool {
    (y.rem_euclid(4) == 0 && y.rem_euclid(100) != 0) || y.rem_euclid(400) == 0
}

/// Days in month `m` of year `y`; `0` when `m` is not in 1..=12.
pub const fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(y) => 29,
        2 => 28,
        _ => 0,
    }
}

/// 365 or 366.
pub const fn days_in_year(y: i64) -> u32 {
    if is_leap_year(y) {
        366
    } else {
        365
    }
}

/// Calendar quarter 1..=4 of a month 1..=12.
pub const fn quarter(month: u32) -> u32 {
    (month.saturating_sub(1)) / 3 + 1
}

/// Hinnant `days_from_civil`: the day number of a civil date.
///
/// The year is shifted to start on March 1 (`mp` = 0 for March .. 11 for
/// February), so `doy` (day of the shifted year) is a closed formula and the
/// leap day needs no special case. `doe` is the day of the 400-year era.
pub fn days_from_civil(c: Civil) -> EpochDay {
    let m = i64::from(c.month);
    let d = i64::from(c.day);
    let y = c.year - i64::from(c.month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400; // 0..=399
    let mp = (m + 9).rem_euclid(12); // Mar = 0 .. Feb = 11
    let doy = (153 * mp + 2).div_euclid(5) + d - 1; // 0..=365
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // 0..=146096
    era * DAYS_PER_ERA + doe - UNIX_EPOCH_SHIFT
}

/// Hinnant `civil_from_days`: the civil date of a day number.
///
/// `yoe` is recovered from the day of era by removing the leap days
/// (`doe/1460` four-year cycles, `doe/36524` centuries, `doe/146096` for the
/// last day of the era); the rest inverts [`days_from_civil`].
pub fn civil_from_days(z: EpochDay) -> Civil {
    let z = z + UNIX_EPOCH_SHIFT;
    let era = z.div_euclid(DAYS_PER_ERA);
    let doe = z - era * DAYS_PER_ERA; // 0..=146096
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // 0..=399
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // 0..=365
    let mp = (5 * doy + 2) / 153; // 0..=11
    let d = doy - (153 * mp + 2) / 5 + 1; // 1..=31
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // 1..=12

    // `m` is 1..=12 and `d` is 1..=31 by construction, so the casts are lossless.
    Civil {
        year: y + i64::from(m <= 2),
        month: m as u32,
        day: d as u32,
    }
}

/// ISO weekday 1 = Monday .. 7 = Sunday. 1970-01-01 (day 0) is a Thursday.
pub fn iso_weekday(z: EpochDay) -> u32 {
    // `(z + 3) mod 7`, reduced first so that it is total on every `i64`;
    // the value is 0..=6, so the cast is lossless.
    ((z.rem_euclid(7) + 3) % 7 + 1) as u32
}

/// Day of the year, 1..=366.
pub fn day_of_year(z: EpochDay) -> u32 {
    let c = civil_from_days(z);
    // At most 365, so the cast is lossless.
    (z - days_from_civil(Civil::new(c.year, 1, 1)) + 1) as u32
}

/// 53 iff January 1 is a Thursday, or a Wednesday in a leap year; else 52.
pub fn iso_weeks_in_year(y: i64) -> u32 {
    let jan1 = iso_weekday(days_from_civil(Civil::new(y, 1, 1)));
    if jan1 == 4 || (jan1 == 3 && is_leap_year(y)) {
        53
    } else {
        52
    }
}

/// ISO week date of a day (spec 1 §2.2).
///
/// With ordinal `o` and weekday `w`, the week is `floor((o - w + 10) / 7)`
/// (the "Thursday rule": week 1 is the week containing the year's first
/// Thursday). Week 0 means the last week of the previous ISO year; a week past
/// the year's week count means week 1 of the next.
pub fn iso_week(z: EpochDay) -> IsoWeek {
    let y = civil_from_days(z).year;
    let w = iso_weekday(z);
    let o = i64::from(day_of_year(z));
    let wk = (o - i64::from(w) + 10).div_euclid(7);
    if wk < 1 {
        IsoWeek {
            year: y - 1,
            week: iso_weeks_in_year(y - 1),
            weekday: w,
        }
    } else if wk > i64::from(iso_weeks_in_year(y)) {
        IsoWeek {
            year: y + 1,
            week: 1,
            weekday: w,
        }
    } else {
        IsoWeek {
            year: y,
            // 1..=53, lossless.
            week: wk as u32,
            weekday: w,
        }
    }
}

/// Adds `k` calendar months with month-end clamping (spec 1 §2.3).
///
/// Returns the new date and whether its day differs from the original day
/// (it was clamped, or moved to Mar 1 under [`LeapDayRule::Mar1`]). `Mar1`
/// only changes a Feb 29 start that lands in February of a common year.
pub fn add_months(c: Civil, k: i64, rule: LeapDayRule) -> (Civil, bool) {
    let t = c.year * 12 + (i64::from(c.month) - 1) + k;
    let ny = t.div_euclid(12);
    // rem_euclid(12) is 0..=11, so the cast is lossless.
    let nm = (t.rem_euclid(12) + 1) as u32;
    if rule == LeapDayRule::Mar1 && c.month == 2 && c.day == 29 && nm == 2 && !is_leap_year(ny) {
        return (Civil::new(ny, 3, 1), true);
    }
    let nd = c.day.min(days_in_month(ny, nm));
    (Civil::new(ny, nm, nd), nd != c.day)
}

/// The `k`-th month anniversary of `start` and whether it was clamped.
pub fn anniversary_clamped(start: EpochDay, k: i64, rule: LeapDayRule) -> (EpochDay, bool) {
    let (c, clamped) = add_months(civil_from_days(start), k, rule);
    (days_from_civil(c), clamped)
}

/// The `k`-th month anniversary of `start`.
pub fn anniversary(start: EpochDay, k: i64, rule: LeapDayRule) -> EpochDay {
    anniversary_clamped(start, k, rule).0
}

/// Years, months and days from `earlier` to `later` by the anniversary walk
/// (spec 1 §2.4). The arguments are ordered internally, so the result is
/// always the walk from the earlier day toward the later one.
///
/// **Definition.** `M` is the largest `M >= 0` with
/// `anniversary(a, M) <= b`; `days = b - anniversary(a, M)`.
///
/// **O(1) algorithm.** Let `M0` be the plain month difference
/// `(y2*12 + m2) - (y1*12 + m1)`. `anniversary(a, M0)` lies in `b`'s month,
/// with one exception: under `Mar1`, when `a` is Feb 29 and `b` is in
/// February of a common year, it is Mar 1 of the following month (e.g.
/// `a = 2000-02-29`, `b = 2001-02-15`, `M0 = 12` gives `2001-03-01`).
///
/// - If `anniversary(a, M0) <= b`, then `M = M0`: `anniversary(a, M0 + 1)`
///   lies in a month after `b`'s (a `Mar1` shift only moves it later).
/// - Otherwise `M = M0 - 1`. That anniversary lies in the month before `b`'s
///   month, or, under `Mar1`, on Mar 1 of `b`'s month when `b` is in March;
///   either way it is `<= b` (in the exception above it is Jan 29).
///
/// One decrement is therefore enough.
pub fn ymd_between(earlier: EpochDay, later: EpochDay, rule: LeapDayRule) -> Ymd {
    let (a, b) = if earlier <= later {
        (earlier, later)
    } else {
        (later, earlier)
    };
    let ca = civil_from_days(a);
    let cb = civil_from_days(b);
    let m0 = (cb.year * 12 + i64::from(cb.month)) - (ca.year * 12 + i64::from(ca.month));
    let at_m0 = anniversary(a, m0, rule);
    let (m, anchor) = if at_m0 > b {
        (m0 - 1, anniversary(a, m0 - 1, rule))
    } else {
        (m0, at_m0)
    };
    Ymd {
        years: m.div_euclid(12),
        months: m.rem_euclid(12),
        days: b - anchor,
        total_months: m,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(y: i64, m: u32, d: u32) -> EpochDay {
        days_from_civil(Civil::new(y, m, d))
    }

    /// The `Mar1` case where `anniversary(a, M0)` leaves `b`'s month: it lands
    /// on Mar 1, after `b`, and one decrement gives the answer.
    #[test]
    fn ymd_between_mar1_m0_outside_b_month() {
        let a = day(2000, 2, 29);
        let b = day(2001, 2, 15);
        assert_eq!(anniversary(a, 12, LeapDayRule::Mar1), day(2001, 3, 1));
        let r = ymd_between(a, b, LeapDayRule::Mar1);
        assert_eq!((r.years, r.months, r.days, r.total_months), (0, 11, 17, 11));
        assert_eq!(anniversary(a, 11, LeapDayRule::Mar1), day(2001, 1, 29));
    }

    #[test]
    fn range_constants() {
        assert_eq!(day(1, 1, 1), MIN_EPOCH_DAY);
        assert_eq!(day(9999, 12, 31), MAX_EPOCH_DAY);
        assert_eq!(day(1970, 1, 1), 0);
        assert_eq!(iso_weekday(MIN_EPOCH_DAY), 1);
        assert_eq!(iso_weekday(MAX_EPOCH_DAY), 5);
        assert_eq!(iso_weekday(0), 4);
        assert_eq!(SPAN_DAYS, 3_652_058);
    }

    #[test]
    fn leap_rules() {
        assert!(is_leap_year(2000));
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2025));
        assert!(is_leap_year(0));
        assert!(is_leap_year(-4));
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2023, 2), 28);
        assert_eq!(days_in_month(2023, 13), 0);
    }

    #[test]
    fn spec_edge_table() {
        let f = LeapDayRule::Feb28;
        let cases = [
            ((2023, 1, 31), (2023, 2, 27), (0, 0, 27)),
            ((2023, 1, 31), (2023, 2, 28), (0, 1, 0)),
            ((2023, 1, 28), (2023, 2, 28), (0, 1, 0)),
            ((2023, 1, 31), (2023, 3, 1), (0, 1, 1)),
            ((2024, 1, 31), (2024, 3, 1), (0, 1, 1)),
            ((2025, 3, 31), (2025, 4, 30), (0, 1, 0)),
            ((2024, 2, 29), (2025, 2, 28), (1, 0, 0)),
            ((2024, 2, 29), (2028, 2, 29), (4, 0, 0)),
            ((1, 1, 1), (9999, 12, 31), (9998, 11, 30)),
        ];
        for ((y1, m1, d1), (y2, m2, d2), (ey, em, ed)) in cases {
            let r = ymd_between(day(y1, m1, d1), day(y2, m2, d2), f);
            assert_eq!((r.years, r.months, r.days), (ey, em, ed));
        }
        let r = ymd_between(day(2024, 2, 29), day(2025, 2, 28), LeapDayRule::Mar1);
        assert_eq!((r.years, r.months, r.days), (0, 11, 30));
    }

    #[test]
    fn add_months_clamps_once() {
        let (c, clamped) = add_months(Civil::new(2023, 1, 31), 13, LeapDayRule::Feb28);
        assert_eq!((c, clamped), (Civil::new(2024, 2, 29), true));
        let (c, clamped) = add_months(Civil::new(2024, 2, 29), 12, LeapDayRule::Mar1);
        assert_eq!((c, clamped), (Civil::new(2025, 3, 1), true));
        let (c, clamped) = add_months(Civil::new(2024, 2, 29), -12, LeapDayRule::Feb28);
        assert_eq!((c, clamped), (Civil::new(2023, 2, 28), true));
    }

    #[test]
    fn iso_weeks() {
        assert_eq!(
            iso_week(day(2021, 1, 3)),
            IsoWeek {
                year: 2020,
                week: 53,
                weekday: 7
            }
        );
        assert_eq!(
            iso_week(day(2024, 12, 30)),
            IsoWeek {
                year: 2025,
                week: 1,
                weekday: 1
            }
        );
        assert_eq!(iso_weeks_in_year(2026), 53);
        assert_eq!(iso_weeks_in_year(2025), 52);
    }
}
