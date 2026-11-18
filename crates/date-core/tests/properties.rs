//! Property tests for the invariants in spec 1 §11 (the business-day
//! invariants 5-7 live in `business_properties.rs`), the brute-force
//! anniversary-walk check of spec 1 §10, and no-panic fuzzing of the parsers.

mod common;

use common::{ymd, XorShift};
use date_core::civil::{
    add_months, anniversary, civil_from_days, days_from_civil, iso_weekday, ymd_between, EpochDay,
    LeapDayRule, MAX_EPOCH_DAY, MIN_EPOCH_DAY,
};
use date_core::format::{format_hms, format_iso};
use date_core::{
    calc_add_subtract, calc_age, calc_countdown, calc_days_between, parse_amount, parse_date,
    parse_time, AddSubtractRequest, AgeRequest, CalendarSpec, CountdownRequest, DaysBetweenRequest,
    Field, Moment, Operation,
};

const RULES: [LeapDayRule; 2] = [LeapDayRule::Feb28, LeapDayRule::Mar1];

fn between(a: EpochDay, b: EpochDay, include: bool) -> date_core::DaysBetweenResult {
    calc_days_between(&DaysBetweenRequest {
        start_date: format_iso(a),
        end_date: format_iso(b),
        include_end_day: include,
    })
    .expect("valid dates")
}

fn add_request(date: EpochDay, op: Operation, amounts: [i64; 4]) -> AddSubtractRequest {
    AddSubtractRequest {
        date: format_iso(date),
        operation: op,
        years: amounts[0].to_string(),
        months: amounts[1].to_string(),
        weeks: amounts[2].to_string(),
        days: amounts[3].to_string(),
        business_days: false,
        calendar: CalendarSpec::default(),
    }
}

/// Invariant 1, also well outside the supported range (the algorithm is exact
/// for any era).
#[test]
fn civil_round_trip() {
    let mut rng = XorShift::new(1);
    for _ in 0..200_000 {
        let z = rng.range(-50_000_000, 50_000_000);
        assert_eq!(days_from_civil(civil_from_days(z)), z);
    }
}

/// Invariant 2.
#[test]
fn weekday_is_periodic() {
    let mut rng = XorShift::new(2);
    for _ in 0..100_000 {
        let z = rng.range(MIN_EPOCH_DAY - 10_000, MAX_EPOCH_DAY + 10_000);
        assert_eq!(iso_weekday(z + 7), iso_weekday(z));
        assert!((1..=7).contains(&iso_weekday(z)));
    }
}

/// Invariant 3.
#[test]
fn days_between_is_antisymmetric_and_include_adds_one() {
    let mut rng = XorShift::new(3);
    for _ in 0..5_000 {
        let (a, b) = (rng.day(), rng.day());
        let ab = between(a, b, false);
        let ba = between(b, a, false);
        assert_eq!(ab.signed_days, -ba.signed_days);
        assert_eq!(ab.signed_days, b - a);
        let inc = between(a, b, true);
        assert_eq!(inc.total_days, ab.total_days + 1);
        assert_eq!(ab.years * 12 + ab.months, ab.total_months);
        assert_eq!(ab.weeks * 7 + ab.week_remainder_days, ab.total_days);
    }
}

/// Invariant 4 under both rules, plus the Add/Subtract round trip of the
/// breakdown (spec 1 §2.4: `add_months(a, M) + days == b`).
#[test]
fn anniversary_walk_invariants() {
    let mut rng = XorShift::new(4);
    for i in 0..20_000 {
        let lo = rng.day();
        let hi_x = if i % 2 == 0 {
            (lo + rng.range(0, 1_000)).min(MAX_EPOCH_DAY + 1)
        } else {
            rng.range(lo, MAX_EPOCH_DAY + 1)
        };
        for rule in RULES {
            let r = ymd_between(lo, hi_x, rule);
            let (c, _) = add_months(civil_from_days(lo), r.total_months, rule);
            assert_eq!(days_from_civil(c) + r.days, hi_x);
            assert!(anniversary(lo, r.total_months + 1, rule) > hi_x);
            assert!(r.days >= 0 && (0..12).contains(&r.months));
        }
        let r = ymd_between(lo, hi_x, LeapDayRule::Feb28);
        if hi_x <= MAX_EPOCH_DAY {
            let back = calc_add_subtract(&add_request(
                lo,
                Operation::Add,
                [0, r.total_months, 0, r.days],
            ))
            .expect("in range");
            assert_eq!(back.result_date, format_iso(hi_x));
        }
    }
}

/// Spec 1 §10 brute force: for every start in 1999-12..2001-03 and every end
/// up to 800 days later, `ymd_between` equals the definition (the largest `M`
/// whose anniversary is not after the end), under both rules.
#[test]
fn ymd_between_equals_definition_brute_force() {
    for rule in RULES {
        for a in ymd(1999, 12, 1)..=ymd(2001, 3, 31) {
            let mut m = 0_i64;
            for b in a..=a + 800 {
                while anniversary(a, m + 1, rule) <= b {
                    m += 1;
                }
                let r = ymd_between(a, b, rule);
                assert_eq!(r.total_months, m, "{} -> {}", format_iso(a), format_iso(b));
                assert_eq!(r.days, b - anniversary(a, m, rule));
            }
        }
    }
}

/// Invariant 8, with the tighter bound from the critique: 366 days only when
/// born on the age-at date.
#[test]
fn age_next_birthday_invariants() {
    let mut rng = XorShift::new(8);
    for i in 0..10_000 {
        let birth = if i % 3 == 0 {
            // Feb 29 births in a random leap year.
            let y = 4 * rng.range(1, 2_499);
            if (y % 100 == 0) && (y % 400 != 0) {
                ymd(y, 2, 28)
            } else {
                ymd(y, 2, 29)
            }
        } else {
            rng.day()
        };
        let as_of = if i % 5 == 0 {
            birth
        } else {
            (birth + rng.range(0, 40_000)).min(MAX_EPOCH_DAY)
        };
        for rule in RULES {
            let r = calc_age(&AgeRequest {
                birth_date: format_iso(birth),
                as_of_date: format_iso(as_of),
                leap_day_rule: rule,
            })
            .expect("valid age");
            assert_eq!(r.total_days, as_of - birth);
            let Some(nb) = r.next_birthday else {
                continue;
            };
            let next = date_core::parse_date(&nb.date, Field::Date).unwrap();
            assert!(nb.is_today || next > as_of);
            assert_eq!(nb.is_today, next == as_of);
            assert_eq!(nb.days_until, next - as_of);
            assert!(nb.days_until <= 366);
            if birth != as_of {
                assert!(nb.days_until <= 365, "{}", format_iso(birth));
            }
            assert_eq!(nb.turning_age, r.years + i64::from(!nb.is_today));
        }
    }
}

/// Invariant 9.
#[test]
fn countdown_decomposes_exactly() {
    let mut rng = XorShift::new(9);
    for _ in 0..10_000 {
        let moment = |rng: &mut XorShift| Moment {
            date: format_iso(rng.day()),
            time: format_hms(rng.range(0, 86_399) as u32),
            utc_offset_minutes: rng.range(-1_080, 1_080),
        };
        let req = CountdownRequest {
            now: moment(&mut rng),
            target: moment(&mut rng),
        };
        let r = calc_countdown(&req).expect("valid countdown");
        let a = r.total_seconds.abs();
        assert_eq!(
            a,
            r.days * 86_400 + r.hours * 3_600 + r.minutes * 60 + r.seconds
        );
        assert!(r.hours < 24 && r.minutes < 60 && r.seconds < 60);
        assert_eq!(r.total_hours, a / 3_600);
        assert_eq!(r.total_minutes, a / 60);
    }
}

/// Invariant 10: weeks/days-only adds are invertible.
#[test]
fn week_and_day_steps_round_trip() {
    let mut rng = XorShift::new(10);
    for _ in 0..10_000 {
        let d = rng.day();
        let w = rng.range(-521_722, 521_722) / rng.range(1, 1_000);
        let x = rng.range(-3_652_058, 3_652_058) / rng.range(1, 1_000);
        let Ok(fwd) = calc_add_subtract(&add_request(d, Operation::Add, [0, 0, w, x])) else {
            continue; // out of range
        };
        let mid = parse_date(&fwd.result_date, Field::Date).unwrap();
        assert_eq!(mid - d, w * 7 + x);
        let back = calc_add_subtract(&add_request(mid, Operation::Subtract, [0, 0, w, x]))
            .expect("inverse is in range");
        assert_eq!(back.result_date, format_iso(d));
    }
}

/// The combined month step clamps once and matches `add_months` directly.
#[test]
fn add_subtract_month_step_is_single_clamp() {
    let mut rng = XorShift::new(11);
    for _ in 0..10_000 {
        let d = rng.day();
        let (y, m) = (rng.range(-50, 50), rng.range(-600, 600));
        let op = if rng.coin() {
            Operation::Add
        } else {
            Operation::Subtract
        };
        let s = if op == Operation::Add { 1 } else { -1 };
        let (c, clamped) = add_months(civil_from_days(d), s * (12 * y + m), LeapDayRule::Feb28);
        let expected = days_from_civil(c);
        match calc_add_subtract(&add_request(d, op, [y, m, 0, 0])) {
            Ok(r) => {
                assert_eq!(r.result_date, format_iso(expected));
                assert_eq!(r.month_clamped, clamped && 12 * y + m != 0);
                assert_eq!(r.calendar_days_delta, expected - d);
            }
            Err(e) => {
                assert_eq!(e.code, date_core::ErrorCode::ResultOutOfRange);
                assert!(!date_core::civil::in_range(expected));
            }
        }
    }
}

/// Parsers never panic and stay strict on arbitrary text.
#[test]
fn parsers_never_panic_on_garbage() {
    const ALPHABET: [char; 24] = [
        '0',
        '1',
        '2',
        '9',
        '-',
        '+',
        ':',
        ' ',
        '\t',
        '\n',
        '/',
        '.',
        'e',
        ',',
        '\u{0663}',
        '\u{FF12}',
        '\u{00A0}',
        '\u{FEFF}',
        '\u{200F}',
        'Z',
        'T',
        '\u{1F600}',
        '\0',
        '\r',
    ];
    let mut rng = XorShift::new(12);
    for _ in 0..100_000 {
        let len = rng.range(0, 24) as usize;
        let s: String = (0..len)
            .map(|_| ALPHABET[rng.range(0, ALPHABET.len() as i64 - 1) as usize])
            .collect();
        if let Ok(z) = parse_date(&s, Field::Date) {
            assert!(date_core::civil::in_range(z));
        }
        if let Ok(v) = parse_amount(&s, Field::Days) {
            assert!(v.abs() <= 3_652_058);
        }
        if let Ok(t) = parse_time(&s, Field::TargetTime, false) {
            assert!(t < 86_400);
        }
    }
}
