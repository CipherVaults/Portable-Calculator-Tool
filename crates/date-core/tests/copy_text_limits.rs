//! FROZEN §11: every result's `copyText` fits the 1024-byte history limit.
//!
//! For each mode the test feeds hand-built worst cases (longest weekday and
//! month names, largest magnitudes, every optional note line) plus a seeded
//! random sweep biased toward extreme inputs, and checks the bound. Business
//! results cap their holiday list at 10 dates plus `and n more` and replace
//! custom holiday names with `Custom holiday` (FROZEN §11).

mod common;

use common::{ymd, XorShift};
use date_core::format::{format_hms, format_iso};
use date_core::{
    calc_add_subtract, calc_age, calc_business_days, calc_countdown, calc_date_info,
    calc_days_between, AddSubtractRequest, AgeRequest, BusinessDaysRequest, CalendarSpec,
    CountdownRequest, CustomHoliday, CustomHolidayKind, DateInfoRequest, DaysBetweenRequest,
    HolidayPreset, LeapDayRule, Moment, Operation, MAX_COPY_TEXT_BYTES, MAX_EPOCH_DAY,
    MIN_EPOCH_DAY,
};

fn check(mode: &str, copy: &str, longest: &mut usize) {
    assert!(copy.is_ascii(), "{mode}: copyText must be ASCII: {copy:?}");
    assert!(
        copy.len() <= MAX_COPY_TEXT_BYTES,
        "{mode}: copyText is {} bytes:\n{copy}",
        copy.len()
    );
    *longest = (*longest).max(copy.len());
}

/// A random amount string with a magnitude of up to `max`, biased to long
/// values, sometimes signed or zero-padded.
fn amount(rng: &mut XorShift, max: i64) -> String {
    let v = match rng.range(0, 3) {
        0 => max,
        1 => rng.range(0, max),
        2 => rng.range(max / 2, max),
        _ => 0,
    };
    let sign = match rng.range(0, 2) {
        0 => "-",
        1 => "+",
        _ => "",
    };
    format!("{sign}{v}")
}

#[test]
fn days_between_copy_text_fits() {
    let mut longest = 0;
    // Wednesday is the longest weekday name: 9999-12-29 and 0001-01-03.
    let (late_wed, early_wed) = (ymd(9999, 12, 29), ymd(1, 1, 3));
    for (a, b) in [
        (late_wed, early_wed),
        (early_wed, late_wed),
        (MAX_EPOCH_DAY, MIN_EPOCH_DAY),
    ] {
        for include in [false, true] {
            let r = calc_days_between(&DaysBetweenRequest {
                start_date: format_iso(a),
                end_date: format_iso(b),
                include_end_day: include,
            })
            .unwrap();
            check("days_between", &r.copy_text, &mut longest);
        }
    }
    let mut rng = XorShift::new(0xC0FF_EE01);
    for _ in 0..20_000 {
        let r = calc_days_between(&DaysBetweenRequest {
            start_date: format_iso(rng.day()),
            end_date: format_iso(rng.day()),
            include_end_day: rng.coin(),
        })
        .unwrap();
        check("days_between", &r.copy_text, &mut longest);
    }
    println!("days_between longest copyText: {longest} bytes");
}

#[test]
fn add_subtract_copy_text_fits() {
    let mut longest = 0;
    let req = |date: i64, op, y: &str, m: &str, w: &str, d: &str| AddSubtractRequest {
        date: format_iso(date),
        operation: op,
        years: y.into(),
        months: m.into(),
        weeks: w.into(),
        days: d.into(),
        business_days: false,
        calendar: CalendarSpec::default(),
    };
    // Every term at (near) its maximum width, a net month step that clamps
    // (+1 month from Jan 31) and a negative 7-digit delta.
    let worst = [
        req(
            ymd(5000, 1, 31),
            Operation::Add,
            "9999",
            "-119987",
            "521722",
            "-3652058",
        ),
        req(
            ymd(9999, 12, 31),
            Operation::Subtract,
            "9998",
            "11",
            "0",
            "30",
        ),
        req(
            ymd(9999, 9, 29),
            Operation::Subtract,
            "-0001",
            "-119988",
            "-521722",
            "3652058",
        ),
    ];
    for r in &worst {
        if let Ok(res) = calc_add_subtract(r) {
            check("add_subtract", &res.copy_text, &mut longest);
        }
    }
    let mut rng = XorShift::new(0xC0FF_EE02);
    let mut ok = 0;
    for _ in 0..40_000 {
        let op = if rng.coin() {
            Operation::Add
        } else {
            Operation::Subtract
        };
        let y = amount(&mut rng, 9_999);
        let m = amount(&mut rng, 119_988);
        let w = amount(&mut rng, 521_722);
        let d = amount(&mut rng, 3_652_058);
        if let Ok(res) = calc_add_subtract(&req(rng.day(), op, &y, &m, &w, &d)) {
            ok += 1;
            check("add_subtract", &res.copy_text, &mut longest);
        }
    }
    assert!(ok > 1_000, "the sweep should hit in-range results");
    println!("add_subtract longest copyText: {longest} bytes");
}

#[test]
fn age_copy_text_fits() {
    let mut longest = 0;
    let mut cases = vec![
        (ymd(4, 2, 29), ymd(9998, 12, 30)),
        (ymd(4, 2, 29), MAX_EPOCH_DAY),
        (MIN_EPOCH_DAY, MAX_EPOCH_DAY),
        (ymd(1, 1, 3), ymd(9998, 9, 30)),
    ];
    let mut rng = XorShift::new(0xC0FF_EE03);
    for _ in 0..20_000 {
        let (a, b) = (rng.day(), rng.day());
        cases.push((a.min(b), a.max(b)));
    }
    for (birth, as_of) in cases {
        for rule in [LeapDayRule::Feb28, LeapDayRule::Mar1] {
            let r = calc_age(&AgeRequest {
                birth_date: format_iso(birth),
                as_of_date: format_iso(as_of),
                leap_day_rule: rule,
            })
            .unwrap();
            check("age", &r.copy_text, &mut longest);
        }
    }
    println!("age longest copyText: {longest} bytes");
}

#[test]
fn date_info_copy_text_fits() {
    let mut longest = 0;
    let mut cases = vec![
        (ymd(9999, 12, 29), Some(MIN_EPOCH_DAY)),
        (MIN_EPOCH_DAY, Some(MAX_EPOCH_DAY)),
        (ymd(1, 9, 26), Some(MAX_EPOCH_DAY)),
    ];
    let mut rng = XorShift::new(0xC0FF_EE04);
    for _ in 0..20_000 {
        let today = rng.coin().then(|| rng.day());
        cases.push((rng.day(), today));
    }
    for (date, today) in cases {
        let r = calc_date_info(&DateInfoRequest {
            date: format_iso(date),
            today: today.map(format_iso),
        })
        .unwrap();
        check("date_info", &r.copy_text, &mut longest);
    }
    println!("date_info longest copyText: {longest} bytes");
}

#[test]
fn countdown_copy_text_fits() {
    let mut longest = 0;
    let m = |date: i64, secs: i64, off: i64| Moment {
        date: format_iso(date),
        time: format_hms(secs as u32),
        utc_offset_minutes: off,
    };
    let mut cases = vec![
        (
            m(MIN_EPOCH_DAY, 0, 1_080),
            m(ymd(9999, 12, 29), 86_399, -1_080),
        ),
        (m(MAX_EPOCH_DAY, 86_399, -1_080), m(ymd(1, 1, 3), 0, 1_080)),
    ];
    let mut rng = XorShift::new(0xC0FF_EE05);
    for _ in 0..20_000 {
        let now = m(rng.day(), rng.range(0, 86_399), rng.range(-1_080, 1_080));
        let target = m(rng.day(), rng.range(0, 86_399), rng.range(-1_080, 1_080));
        cases.push((now, target));
    }
    for (now, target) in cases {
        let r = calc_countdown(&CountdownRequest { now, target }).unwrap();
        check("countdown", &r.copy_text, &mut longest);
    }
    println!("countdown longest copyText: {longest} bytes");
}

/// A worst-case calendar for copy text: the longest weekend text (six days),
/// a preset with long names, and 100 custom holidays stacked on preset dates
/// (merged names) and every other day, all with 60-character names.
fn heavy_calendar(preset: HolidayPreset, weekend: Vec<i64>) -> CalendarSpec {
    let name = "N".repeat(60);
    let custom_holidays = (0..100)
        .map(|i| CustomHoliday {
            id: format!("c-{i:08x}"),
            name: name.clone(),
            kind: if i % 2 == 0 {
                CustomHolidayKind::Yearly
            } else {
                CustomHolidayKind::Date
            },
            date: (i % 2 == 1).then(|| format_iso(ymd(2026, 1, 1) + i)),
            month: (i % 2 == 0).then_some(1 + (i / 2) % 12),
            day: (i % 2 == 0).then_some(1 + (i / 24) % 28),
            from_year: None,
            enabled: true,
        })
        .collect();
    CalendarSpec {
        weekend,
        preset,
        custom_holidays,
        hijri_offset_days: 2,
        ..CalendarSpec::default()
    }
}

#[test]
fn business_copy_text_fits() {
    let mut longest = 0;
    let presets = [
        HolidayPreset::None,
        HolidayPreset::Us,
        HolidayPreset::Uk,
        HolidayPreset::Eg,
    ];
    let weekends = [
        vec![],
        vec![6, 7],
        vec![1, 2, 3, 4, 5, 7],
        vec![2, 3, 4, 5, 6, 7],
    ];
    // Backward (note line), later date included, a Wednesday at each end,
    // spanning the holiday window (warning note) and Hijri estimates.
    let ranges = [
        (ymd(9999, 12, 29), ymd(1, 1, 3)),
        (ymd(2199, 12, 25), ymd(1899, 12, 27)),
        (ymd(2026, 12, 30), ymd(2026, 1, 7)),
        (MAX_EPOCH_DAY, MIN_EPOCH_DAY),
    ];
    for preset in presets {
        for weekend in &weekends {
            let cal = heavy_calendar(preset, weekend.clone());
            for &(a, b) in &ranges {
                for include in [false, true] {
                    let r = calc_business_days(&BusinessDaysRequest {
                        start_date: format_iso(a),
                        end_date: format_iso(b),
                        include_end_day: include,
                        calendar: cal.clone(),
                    })
                    .unwrap();
                    assert!(!r.copy_text.contains(&"N".repeat(60)), "custom name leaked");
                    check("business_days", &r.copy_text, &mut longest);
                }
            }
        }
    }
    let mut rng = XorShift::new(0xC0FF_EE06);
    for _ in 0..400 {
        let preset = presets[rng.range(0, 3) as usize];
        let weekend = weekends[rng.range(0, 3) as usize].clone();
        let cal = heavy_calendar(preset, weekend);
        let a = rng.range(ymd(1890, 1, 1), ymd(2210, 1, 1));
        let b = a + rng.range(-4_000, 4_000);
        let r = calc_business_days(&BusinessDaysRequest {
            start_date: format_iso(a),
            end_date: format_iso(b.clamp(MIN_EPOCH_DAY, MAX_EPOCH_DAY)),
            include_end_day: rng.coin(),
            calendar: cal,
        })
        .unwrap();
        check("business_days", &r.copy_text, &mut longest);
    }
    println!("business_days longest copyText: {longest} bytes");
}

#[test]
fn add_subtract_business_copy_text_fits() {
    let mut longest = 0;
    let mut rng = XorShift::new(0xC0FF_EE07);
    let mut ok = 0;
    for _ in 0..600 {
        let preset = [HolidayPreset::Uk, HolidayPreset::Eg][rng.range(0, 1) as usize];
        let weekend = if rng.coin() {
            vec![1, 2, 3, 4, 5, 7]
        } else {
            vec![2, 3, 4, 5, 6, 7]
        };
        let req = AddSubtractRequest {
            date: format_iso(rng.range(ymd(1890, 1, 31), ymd(2210, 1, 31))),
            operation: if rng.coin() {
                Operation::Add
            } else {
                Operation::Subtract
            },
            // Magnitudes that keep most results inside the supported range
            // while still producing 6-7 digit counts.
            years: amount(&mut rng, 300),
            months: amount(&mut rng, 3_600),
            weeks: amount(&mut rng, 100_000),
            days: amount(&mut rng, 1_000_000),
            business_days: true,
            calendar: heavy_calendar(preset, weekend),
        };
        if let Ok(res) = calc_add_subtract(&req) {
            ok += 1;
            check("add_subtract_business", &res.copy_text, &mut longest);
        }
    }
    assert!(ok > 100, "the sweep should hit in-range results: {ok}");
    println!("add_subtract business longest copyText: {longest} bytes");
}

/// The business copy texts follow the spec 1 §7.2/§7.3 templates byte for
/// byte: no preset line and no notes beyond the templated ones (estimates
/// are marked per holiday entry; warnings travel in `warnings[]`).
#[test]
fn business_copy_text_matches_the_templates() {
    let customs = |items: &[(&str, &str)]| -> CalendarSpec {
        CalendarSpec {
            custom_holidays: items
                .iter()
                .enumerate()
                .map(|(i, (name, date))| CustomHoliday {
                    id: format!("c-{:08x}", i + 1),
                    name: (*name).to_string(),
                    kind: CustomHolidayKind::Date,
                    date: Some((*date).to_string()),
                    month: None,
                    day: None,
                    from_year: None,
                    enabled: true,
                })
                .collect(),
            ..CalendarSpec::default()
        }
    };
    // Vector C3.
    let c3 = calc_business_days(&BusinessDaysRequest {
        start_date: "2025-01-01".into(),
        end_date: "2025-01-31".into(),
        include_end_day: true,
        calendar: customs(&[
            ("New Year's Day", "2025-01-01"),
            ("Martin Luther King Jr. Day", "2025-01-20"),
        ]),
    })
    .unwrap();
    assert_eq!(
        c3.copy_text,
        "From 2025-01-01 (Wednesday) to 2025-01-31 (Friday), later date included\n\
         Business days: 21\n\
         Calendar days: 31\n\
         Weekend days: 8\n\
         Holidays on working days: 2\n\
         Weekend: Saturday, Sunday\n\
         Holidays: 2025-01-01 Custom holiday; 2025-01-20 Custom holiday"
    );
    // Vector B4.
    let b4 = calc_add_subtract(&AddSubtractRequest {
        date: "2025-12-22".into(),
        operation: Operation::Add,
        years: String::new(),
        months: String::new(),
        weeks: String::new(),
        days: "5".into(),
        business_days: true,
        calendar: customs(&[
            ("Christmas Day", "2025-12-25"),
            ("Boxing Day", "2025-12-26"),
        ]),
    })
    .unwrap();
    assert_eq!(
        b4.copy_text,
        "2025-12-22 + 5 business days = 2025-12-31\n\
         Result: Wednesday, December 31, 2025\n\
         Calendar days moved: 9\n\
         Business days: 5 (skipped 2 weekend days, 2 holidays)"
    );
    // Estimated and out-of-window ranges add no extra lines.
    let eg = calc_business_days(&BusinessDaysRequest {
        start_date: "2199-12-01".into(),
        end_date: "2200-01-31".into(),
        include_end_day: false,
        calendar: CalendarSpec {
            preset: HolidayPreset::Eg,
            weekend: vec![5, 6],
            ..CalendarSpec::default()
        },
    })
    .unwrap();
    assert_eq!(eg.warnings, ["presetYearOutOfRange"]);
    assert!(!eg.copy_text.contains("Note:"), "{}", eg.copy_text);
    assert!(!eg.copy_text.contains("preset"), "{}", eg.copy_text);
}
