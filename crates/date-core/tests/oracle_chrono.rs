//! Independent cross-check of the civil engine against `chrono` (dev-only).
//!
//! - Exhaustive: every day 0001-01-01..=9999-12-31 (3 652 059 days) for the
//!   civil round trip, weekday, ordinal and ISO week; every year for the leap
//!   rule and ISO weeks-in-year; every month for its length.
//! - Seeded random: `add_months` (Feb28 rule = chrono's clamping),
//!   `ymd_between`'s whole months, and `calc_days_between` totals.

mod common;

use chrono::{Datelike, Months, NaiveDate, Weekday};
use common::XorShift;
use date_core::civil::{
    add_months, civil_from_days, day_of_year, days_from_civil, days_in_month, in_range,
    is_leap_year, iso_week, iso_weekday, iso_weeks_in_year, ymd_between, Civil, EpochDay,
    LeapDayRule, MAX_EPOCH_DAY, MIN_EPOCH_DAY,
};
use date_core::format::format_iso;
use date_core::{calc_days_between, DaysBetweenRequest};

/// chrono counts days from 0001-01-01 = day 1 of the common era.
const CE_OFFSET: i64 = 719_163;

fn chrono_date(z: EpochDay) -> NaiveDate {
    let n = i32::try_from(z + CE_OFFSET).expect("fits i32");
    NaiveDate::from_num_days_from_ce_opt(n).expect("chrono date in range")
}

fn epoch_of(d: NaiveDate) -> EpochDay {
    i64::from(d.num_days_from_ce()) - CE_OFFSET
}

fn to_chrono(c: Civil) -> NaiveDate {
    NaiveDate::from_ymd_opt(i32::try_from(c.year).unwrap(), c.month, c.day).unwrap()
}

#[test]
fn every_day_matches_chrono() {
    let mut d = chrono_date(MIN_EPOCH_DAY);
    let mut checked = 0_u64;
    for z in MIN_EPOCH_DAY..=MAX_EPOCH_DAY {
        let c = civil_from_days(z);
        assert_eq!(
            (c.year, c.month, c.day),
            (i64::from(d.year()), d.month(), d.day()),
            "civil_from_days({z})"
        );
        assert_eq!(days_from_civil(c), z, "round trip {z}");
        assert!(in_range(z));
        assert_eq!(
            iso_weekday(z),
            d.weekday().number_from_monday(),
            "weekday {z}"
        );
        assert_eq!(day_of_year(z), d.ordinal(), "ordinal {z}");
        let iw = iso_week(z);
        let cw = d.iso_week();
        assert_eq!(
            (iw.year, iw.week, iw.weekday),
            (
                i64::from(cw.year()),
                cw.week(),
                d.weekday().number_from_monday()
            ),
            "iso week {z}"
        );
        if z % 97 == 0 {
            assert_eq!(
                format_iso(z),
                d.format("%Y-%m-%d").to_string(),
                "iso text {z}"
            );
        }
        checked += 1;
        if let Some(next) = d.succ_opt() {
            d = next;
        }
    }
    assert_eq!(checked, 3_652_059);
    assert!(!in_range(MIN_EPOCH_DAY - 1));
    assert!(!in_range(MAX_EPOCH_DAY + 1));
}

#[test]
fn every_year_and_month_matches_chrono() {
    for y in 1..=9999_i32 {
        let yy = i64::from(y);
        assert_eq!(
            is_leap_year(yy),
            NaiveDate::from_ymd_opt(y, 2, 29).is_some(),
            "leap {y}"
        );
        assert_eq!(
            iso_weeks_in_year(yy) == 53,
            NaiveDate::from_isoywd_opt(y, 53, Weekday::Mon).is_some(),
            "iso weeks in {y}"
        );
        for m in 1..=12_u32 {
            let first = NaiveDate::from_ymd_opt(y, m, 1).unwrap();
            let next = if m == 12 {
                NaiveDate::from_ymd_opt(y + 1, 1, 1).unwrap()
            } else {
                NaiveDate::from_ymd_opt(y, m + 1, 1).unwrap()
            };
            let len = next.signed_duration_since(first).num_days();
            assert_eq!(i64::from(days_in_month(yy, m)), len, "days in {y}-{m}");
        }
    }
}

/// chrono's month arithmetic (which clamps to month end) for a signed `k`.
fn chrono_add_months(d: NaiveDate, k: i64) -> Option<NaiveDate> {
    let n = u32::try_from(k.unsigned_abs()).ok()?;
    if k >= 0 {
        d.checked_add_months(Months::new(n))
    } else {
        d.checked_sub_months(Months::new(n))
    }
}

#[test]
fn add_months_matches_chrono() {
    let mut rng = XorShift::new(0xDA7E_2026_0001);
    for _ in 0..20_000 {
        let z = rng.day();
        let c = civil_from_days(z);
        let d = chrono_date(z);
        for k in -30..=30 {
            let (ours, clamped) = add_months(c, k, LeapDayRule::Feb28);
            let theirs = chrono_add_months(d, k).expect("chrono month step");
            assert_eq!(to_chrono(ours), theirs, "{} + {k} months", format_iso(z));
            assert_eq!(clamped, ours.day != c.day);
        }
        // One large step whose result stays inside chrono's range.
        let k = rng.range(-119_988, 119_988);
        let (ours, _) = add_months(c, k, LeapDayRule::Feb28);
        if (1..=9999).contains(&ours.year) {
            let theirs = chrono_add_months(d, k).expect("chrono month step");
            assert_eq!(to_chrono(ours), theirs, "{} + {k} months", format_iso(z));
        }
    }
}

/// Largest `M` with `a + M months <= b` by binary search on chrono's month
/// arithmetic (anniversaries are strictly increasing in `M`).
fn chrono_whole_months(a: NaiveDate, b: NaiveDate) -> i64 {
    let (mut lo, mut hi) = (0_i64, 120_000_i64); // invariant: lo fits, hi does not
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        match chrono_add_months(a, mid) {
            Some(x) if x <= b => lo = mid,
            _ => hi = mid,
        }
    }
    lo
}

#[test]
fn ymd_between_matches_chrono_month_search() {
    let mut rng = XorShift::new(0xDA7E_2026_0002);
    for i in 0..30_000 {
        let a = rng.day();
        // Mix short spans (month-end edge cases) with arbitrary ones.
        let b = if i % 2 == 0 {
            (a + rng.range(0, 800)).min(MAX_EPOCH_DAY)
        } else {
            rng.range(a, MAX_EPOCH_DAY)
        };
        let ymd = ymd_between(a, b, LeapDayRule::Feb28);
        let (ca, cb) = (chrono_date(a), chrono_date(b));
        let m = chrono_whole_months(ca, cb);
        assert_eq!(
            ymd.total_months,
            m,
            "{} -> {}",
            format_iso(a),
            format_iso(b)
        );
        let anchor = chrono_add_months(ca, m).unwrap();
        assert_eq!(ymd.days, cb.signed_duration_since(anchor).num_days());
        assert_eq!((ymd.years, ymd.months), (m / 12, m % 12));
    }
}

#[test]
fn days_between_matches_chrono() {
    let mut rng = XorShift::new(0xDA7E_2026_0003);
    for _ in 0..20_000 {
        let (a, b) = (rng.day(), rng.day());
        let include = rng.coin();
        let req = DaysBetweenRequest {
            start_date: format_iso(a),
            end_date: format_iso(b),
            include_end_day: include,
        };
        let r = calc_days_between(&req).expect("valid dates");
        let delta = chrono_date(b)
            .signed_duration_since(chrono_date(a))
            .num_days();
        assert_eq!(r.total_days, delta.abs() + i64::from(include));
        let expected_signed = if delta < 0 {
            -r.total_days
        } else {
            r.total_days
        };
        assert_eq!(r.signed_days, expected_signed);
        assert_eq!(epoch_of(chrono_date(a)), a);
        assert_eq!(r.total_seconds, r.total_days * 86_400);
    }
}
