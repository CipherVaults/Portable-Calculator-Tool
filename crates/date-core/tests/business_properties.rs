//! Business-day properties (spec 1 §10-§11 invariants 5-7, spec 2 §10.4):
//! the production year-chunked counting and stepping must equal a naive
//! day-by-day loop over many random ranges and calendars, and stepping must
//! be consistent with counting and with its own inverse.
//!
//! The naive oracle classifies each day independently: a weekend weekday is
//! a weekend day; otherwise a day whose date is an effective date of any
//! instance listed by `holidays_in_range` is a holiday; otherwise it is a
//! business day. That shares only the per-year rule expansion with
//! production, not the week arithmetic, year chunking, memo or merging.

mod common;

use std::collections::BTreeSet;

use common::{ymd, XorShift};
use date_core::civil::{iso_weekday, EpochDay, MAX_EPOCH_DAY, MIN_EPOCH_DAY};
use date_core::format::format_iso;
use date_core::{
    add_business_days, calc_add_subtract, count_business_days, holidays_in_range,
    AddSubtractRequest, Calendar, CalendarSpec, CustomHoliday, CustomHolidayKind, HolidayPreset,
    HolidaysInRangeRequest, ObservedMode, Operation,
};

/// A random but valid calendar. Presets, observed modes, Hijri offsets,
/// exclusions and custom holidays (one-off and yearly, sometimes on the same
/// date as a preset holiday or each other) are all exercised.
fn random_calendar(rng: &mut XorShift) -> CalendarSpec {
    let weekend: Vec<i64> = loop {
        let mask = rng.range(0, 0x7E);
        let days: Vec<i64> = (1..=7).filter(|d| mask & (1 << (d - 1)) != 0).collect();
        if days.len() < 7 {
            break days;
        }
    };
    let preset = match rng.range(0, 3) {
        0 => HolidayPreset::None,
        1 => HolidayPreset::Us,
        2 => HolidayPreset::Uk,
        _ => HolidayPreset::Eg,
    };
    let observed_mode = match rng.range(0, 2) {
        0 => ObservedMode::Observed,
        1 => ObservedMode::Actual,
        _ => ObservedMode::Both,
    };
    let mut spec = CalendarSpec {
        weekend,
        preset,
        observed_mode,
        hijri_offset_days: rng.range(-2, 2),
        ..CalendarSpec::default()
    };
    if rng.coin() {
        spec.excluded_holidays.us = vec!["independenceDay".into(), "columbusDay".into()];
        spec.excluded_holidays.uk = vec!["boxingDay".into()];
        spec.excluded_holidays.eg = vec!["eidAlFitr".into(), "copticEaster".into()];
    }
    let customs = rng.range(0, 6);
    for i in 0..customs {
        let id = format!("c-{:08x}", i + 1);
        let holiday = if rng.coin() {
            CustomHoliday {
                id,
                name: format!("Custom {i}"),
                kind: CustomHolidayKind::Date,
                date: Some(format_iso(rng.range(ymd(1900, 1, 1), ymd(2199, 12, 31)))),
                month: None,
                day: None,
                from_year: None,
                enabled: rng.range(0, 4) != 0,
            }
        } else {
            let month = rng.range(1, 12);
            let day = if month == 2 && rng.coin() {
                29
            } else {
                rng.range(1, 28)
            };
            CustomHoliday {
                id,
                name: format!("Yearly {i}"),
                kind: CustomHolidayKind::Yearly,
                date: None,
                month: Some(month),
                day: Some(day),
                from_year: rng.coin().then(|| rng.range(1900, 2199)),
                enabled: rng.range(0, 4) != 0,
            }
        };
        spec.custom_holidays.push(holiday);
    }
    spec
}

/// Effective holiday dates (per the observed mode) inside `[lo, hi]`.
fn holiday_set(spec: &CalendarSpec, lo: EpochDay, hi: EpochDay) -> BTreeSet<EpochDay> {
    let r = holidays_in_range(&HolidaysInRangeRequest {
        start_date: format_iso(lo),
        end_date: format_iso(hi),
        calendar: spec.clone(),
    })
    .expect("valid calendar");
    assert!(!r.truncated, "range too large for the oracle");
    let parse = |s: &str| date_core::parse_date(s, date_core::Field::Date).expect("iso date");
    let mut set = BTreeSet::new();
    for h in &r.holidays {
        let (date, actual) = (parse(&h.date), parse(&h.actual_date));
        let dates: Vec<EpochDay> = match spec.observed_mode {
            ObservedMode::Observed => vec![date],
            ObservedMode::Actual => vec![actual],
            ObservedMode::Both => vec![date, actual],
        };
        set.extend(dates.into_iter().filter(|d| (lo..=hi).contains(d)));
    }
    set
}

fn is_weekend(spec: &CalendarSpec, z: EpochDay) -> bool {
    spec.weekend.contains(&i64::from(iso_weekday(z)))
}

/// `(business, weekend, holiday)` of `[from, to_excl)`, day by day.
fn naive_count(
    spec: &CalendarSpec,
    set: &BTreeSet<EpochDay>,
    from: EpochDay,
    to_excl: EpochDay,
) -> (i64, i64, i64) {
    let (mut b, mut w, mut h) = (0, 0, 0);
    for z in from..to_excl {
        if is_weekend(spec, z) {
            w += 1;
        } else if set.contains(&z) {
            h += 1;
        } else {
            b += 1;
        }
    }
    (b, w, h)
}

/// The `|n|`-th business day after (before) `start`, day by day, or `None`
/// when the walk leaves `[lo, hi]`.
fn naive_step(
    spec: &CalendarSpec,
    set: &BTreeSet<EpochDay>,
    start: EpochDay,
    n: i64,
    (lo, hi): (EpochDay, EpochDay),
) -> Option<EpochDay> {
    if n == 0 {
        return Some(start);
    }
    let dir = n.signum();
    let mut remaining = n.abs();
    let mut z = start;
    loop {
        z += dir;
        if z < lo || z > hi {
            return None;
        }
        if !is_weekend(spec, z) && !set.contains(&z) {
            remaining -= 1;
            if remaining == 0 {
                return Some(z);
            }
        }
    }
}

/// A random start day, mostly around the holiday window (including its
/// edges, where presets switch off), sometimes anywhere in range.
fn random_day(rng: &mut XorShift) -> EpochDay {
    match rng.range(0, 5) {
        0 => rng.range(ymd(1895, 1, 1), ymd(1905, 12, 31)),
        1 => rng.range(ymd(2195, 1, 1), ymd(2204, 12, 31)),
        2 => rng.range(MIN_EPOCH_DAY, MAX_EPOCH_DAY),
        _ => rng.range(ymd(1965, 1, 1), ymd(2040, 12, 31)),
    }
}

#[test]
fn count_equals_naive_loop() {
    let mut rng = XorShift::new(0xB05_0001);
    for case in 0..400 {
        let spec = random_calendar(&mut rng);
        let cal = Calendar::new(&spec).expect("valid calendar");
        for _ in 0..5 {
            let from = random_day(&mut rng);
            let len = rng.range(0, 1_500);
            let to_excl = (from + len).min(MAX_EPOCH_DAY + 1);
            let set = holiday_set(&spec, from, (to_excl - 1).max(from));
            let got = count_business_days(&cal, from, to_excl);
            let want = naive_count(&spec, &set, from, to_excl);
            assert_eq!(
                (got.business, got.weekend, got.holiday),
                want,
                "case {case}: [{}, {}) {spec:?}",
                format_iso(from),
                format_iso(to_excl)
            );
            assert_eq!(got.calendar_days, to_excl - from);
            assert_eq!(
                got.calendar_days,
                got.business + got.weekend + got.holiday,
                "invariant 7"
            );
        }
    }
}

#[test]
fn count_is_additive_and_monotonic() {
    let mut rng = XorShift::new(0xB05_0002);
    for _ in 0..300 {
        let spec = random_calendar(&mut rng);
        let cal = Calendar::new(&spec).expect("valid calendar");
        let a = random_day(&mut rng).min(MAX_EPOCH_DAY - 40_000);
        let b = a + rng.range(0, 20_000);
        let c = b + rng.range(0, 20_000);
        let ab = count_business_days(&cal, a, b);
        let bc = count_business_days(&cal, b, c);
        let ac = count_business_days(&cal, a, c);
        assert_eq!(ab.business + bc.business, ac.business, "invariant 5");
        assert_eq!(ab.weekend + bc.weekend, ac.weekend);
        assert_eq!(ab.holiday + bc.holiday, ac.holiday);
        assert!(ac.business >= ab.business && ac.business >= bc.business);
    }
}

#[test]
fn add_equals_naive_walk_and_counts_back() {
    let mut rng = XorShift::new(0xB05_0003);
    let mut checked = 0;
    for case in 0..400 {
        let spec = random_calendar(&mut rng);
        let cal = Calendar::new(&spec).expect("valid calendar");
        for _ in 0..5 {
            let start = random_day(&mut rng);
            let n = match rng.range(0, 3) {
                0 => 0,
                1 => rng.range(-30, 30),
                _ => rng.range(-600, 600),
            };
            let window = (
                (start - 6_000).max(MIN_EPOCH_DAY),
                (start + 6_000).min(MAX_EPOCH_DAY),
            );
            let set = holiday_set(&spec, window.0, window.1);
            let want = naive_step(&spec, &set, start, n, window);
            let got = add_business_days(&cal, start, n);
            let Some(want) = want else {
                // The walk left the oracle window (or the supported range):
                // production must either fail or land outside the window.
                if let Ok(step) = got {
                    assert!(step.date < window.0 || step.date > window.1);
                }
                continue;
            };
            let step = got.unwrap_or_else(|e| {
                panic!("case {case}: {} + {n}: {e} {spec:?}", format_iso(start))
            });
            assert_eq!(step.date, want, "case {case}: {} + {n}", format_iso(start));
            checked += 1;
            // Invariant 6 and the skipped counts.
            if n > 0 {
                let c = count_business_days(&cal, start + 1, step.date + 1);
                assert_eq!(c.business, n);
                let between = count_business_days(&cal, start + 1, step.date);
                assert_eq!(step.skipped_weekend, between.weekend);
                assert_eq!(step.skipped_holidays, between.holiday);
            } else if n < 0 {
                let c = count_business_days(&cal, step.date, start);
                assert_eq!(c.business, -n);
                let between = count_business_days(&cal, step.date + 1, start);
                assert_eq!(step.skipped_weekend, between.weekend);
                assert_eq!(step.skipped_holidays, between.holiday);
            }
            if n != 0 {
                assert!(cal.is_business_day(step.date));
            }
        }
    }
    assert!(
        checked > 1_500,
        "too few cases reached the oracle: {checked}"
    );
}

/// `add(add(D, n), -n)` returns `D` when `D` is a business day, and otherwise
/// the nearest business day on the far side of `D` (the start day itself is
/// never counted).
#[test]
fn add_inverse_consistency() {
    let mut rng = XorShift::new(0xB05_0004);
    for _ in 0..2_000 {
        let spec = random_calendar(&mut rng);
        let cal = Calendar::new(&spec).expect("valid calendar");
        let d = rng.range(ymd(1890, 1, 1), ymd(2210, 12, 31));
        let n = rng.range(1, 2_000) * if rng.coin() { 1 } else { -1 };
        let Ok(there) = add_business_days(&cal, d, n) else {
            continue;
        };
        let back = add_business_days(&cal, there.date, -n).expect("way back exists");
        if cal.is_business_day(d) {
            assert_eq!(back.date, d, "{} {n}", format_iso(d));
        } else {
            // One step past D toward the way back.
            let nearest = add_business_days(&cal, d, -n.signum()).expect("exists");
            assert_eq!(back.date, nearest.date, "{} {n}", format_iso(d));
        }
    }
}

#[test]
fn business_weeks_are_wpw_business_days() {
    let mut rng = XorShift::new(0xB05_0005);
    for _ in 0..300 {
        let spec = random_calendar(&mut rng);
        let wpw = 7 - spec.weekend.len() as i64;
        let date = format_iso(rng.range(ymd(1960, 1, 1), ymd(2210, 12, 31)));
        let weeks = rng.range(-60, 60);
        let req = |weeks: String, days: String| AddSubtractRequest {
            date: date.clone(),
            operation: Operation::Add,
            years: String::new(),
            months: String::new(),
            weeks,
            days,
            business_days: true,
            calendar: spec.clone(),
        };
        let by_weeks = calc_add_subtract(&req(weeks.to_string(), "3".into())).unwrap();
        let by_days =
            calc_add_subtract(&req(String::new(), (weeks * wpw + 3).to_string())).unwrap();
        assert_eq!(by_weeks.result_date, by_days.result_date);
        assert_eq!(by_weeks.business_day_count, Some(weeks * wpw + 3));
    }
}

/// No 100k cap: the full 0001..=9999 span is counted and stepped quickly.
#[test]
fn whole_range_counts_and_steps() {
    for preset in [
        HolidayPreset::None,
        HolidayPreset::Us,
        HolidayPreset::Uk,
        HolidayPreset::Eg,
    ] {
        let spec = CalendarSpec {
            preset,
            ..CalendarSpec::default()
        };
        let cal = Calendar::new(&spec).unwrap();
        let all = count_business_days(&cal, MIN_EPOCH_DAY, MAX_EPOCH_DAY + 1);
        assert_eq!(all.calendar_days, 3_652_059);
        assert_eq!(all.weekend, 1_043_444);
        // Every business day of the whole range, stepped from just before
        // 0001-01-01 is impossible, so step from day one: 0001-01-01 is a
        // Monday (a business day) and is not counted by the step.
        let n = all.business - 1;
        let last = add_business_days(&cal, MIN_EPOCH_DAY, n).unwrap();
        assert_eq!(
            last.date, MAX_EPOCH_DAY,
            "{preset:?}: 9999-12-31 is a Friday"
        );
        assert!(add_business_days(&cal, MIN_EPOCH_DAY, n + 1).is_err());
        let first = add_business_days(&cal, MAX_EPOCH_DAY, -n).unwrap();
        assert_eq!(first.date, MIN_EPOCH_DAY);
        assert_eq!(
            last.skipped_weekend + last.skipped_holidays + n,
            MAX_EPOCH_DAY - MIN_EPOCH_DAY
        );
    }
}

/// The public helpers are total: day numbers far outside 0001..=9999 give a
/// result (or `result_out_of_range`), never an overflow panic. Counting
/// ignores the part of a range outside the supported days.
#[test]
fn public_helpers_are_total_outside_the_domain() {
    let extremes = [
        i64::MIN,
        i64::MIN + 1,
        -1_000_000_000_000_000,
        i64::MAX - 1,
        i64::MAX,
    ];
    for preset in [HolidayPreset::None, HolidayPreset::Us] {
        let cal = Calendar::new(&CalendarSpec {
            preset,
            ..CalendarSpec::default()
        })
        .unwrap();
        for &z in &extremes {
            for n in [i64::MIN, -1, 0, 1, i64::MAX] {
                assert!(add_business_days(&cal, z, n).is_err(), "{z} {n}");
            }
            assert!(!cal.is_business_day(z));
            assert!(!cal.is_holiday(z));
            assert!(cal.holiday_on(z).is_none());
            assert!(cal.coverage_warnings(z, z).len() <= 1);
            for &w in &extremes {
                let c = count_business_days(&cal, z, w);
                assert_eq!(c.calendar_days, c.business + c.weekend + c.holiday);
                let _ = cal.weekend().weekend_days_in(z, w);
                let _ = iso_weekday(z);
            }
        }
        // The whole supported range, reached from far outside it.
        let all = count_business_days(&cal, i64::MIN, i64::MAX);
        assert_eq!(
            all,
            count_business_days(&cal, MIN_EPOCH_DAY, MAX_EPOCH_DAY + 1)
        );
        assert_eq!(all.calendar_days, 3_652_059);
        assert_eq!(
            count_business_days(&cal, i64::MAX, i64::MIN).calendar_days,
            0
        );
        // Week arithmetic stays exact where the answer fits.
        assert_eq!(
            cal.weekend()
                .weekend_days_in(-7_000_000_000_000, 7_000_000_000_000),
            4_000_000_000_000
        );
    }
    assert_eq!(iso_weekday(i64::MAX), iso_weekday(i64::MAX % 7));
    assert_eq!(iso_weekday(i64::MIN), iso_weekday(i64::MIN % 7 + 7));
}
