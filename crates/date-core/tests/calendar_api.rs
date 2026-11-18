//! `validate_calendar` (FROZEN §4, spec 2 §8.2) and `month_grid` (FROZEN §9):
//! defaults, normalization, every limit and error code, the 42-cell grid
//! layout and flags, and no-panic fuzzing of both entry points.

mod common;

use common::XorShift;
use date_core::{
    month_grid, validate_calendar, Calendar, CalendarSpec, MonthGridRequest, MonthGridResult,
    ValidateCalendarRequest, ValidateCalendarResult,
};
use serde_json::{json, Value};

fn validate(calendar: Value) -> Result<ValidateCalendarResult, (String, String)> {
    let req: ValidateCalendarRequest =
        serde_json::from_value(json!({ "calendar": calendar })).expect("request deserializes");
    validate_calendar(&req).map_err(|e| (e.code.as_str().to_string(), e.message.clone()))
}

fn code(calendar: Value) -> String {
    match validate(calendar) {
        Ok(_) => "ok".into(),
        Err((code, _)) => code,
    }
}

fn custom(extra: Value) -> Value {
    let mut base =
        json!({"id": "c-0000000a", "name": "Office closed", "kind": "date", "date": "2026-12-24"});
    if let (Some(b), Some(e)) = (base.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            if v.is_null() {
                b.remove(k);
            } else {
                b.insert(k.clone(), v.clone());
            }
        }
    }
    base
}

#[test]
fn defaults_and_summary() {
    let r = validate(json!({})).unwrap();
    assert_eq!(r.calendar, CalendarSpec::default());
    assert_eq!(r.calendar.weekend, vec![6, 7]);
    assert_eq!(r.weekend_text, "Saturday, Sunday");
    assert_eq!(r.workdays_per_week, 5);
    assert_eq!(r.preset_label, "None");
    assert_eq!(r.preset_first_year, None);
    assert_eq!(
        r.summary_text,
        "Holidays: None; weekend: Saturday, Sunday; 0 custom holidays"
    );
    let v = serde_json::to_value(&r.calendar).unwrap();
    assert_eq!(
        v,
        json!({
            "weekend": [6, 7], "preset": "none", "hijriOffsetDays": 0, "hijriOverrides": [],
            "excludedHolidays": {"us": [], "uk": [], "eg": []}, "customHolidays": [],
            "observedMode": "observed", "schemaVersion": 1
        })
    );
    let r = validate(json!({"preset": "eg", "weekend": [6, 5]})).unwrap();
    assert_eq!(r.calendar.weekend, vec![5, 6]);
    assert_eq!(r.preset_label, "Egypt");
    assert_eq!(
        (r.preset_first_year, r.preset_last_year),
        (Some(2014), Some(2199))
    );
    assert_eq!(date_core::HolidayPreset::Eg.default_weekend(), vec![5, 6]);
    assert_eq!(date_core::HolidayPreset::Us.default_weekend(), vec![6, 7]);
    let r = validate(json!({"preset": "uk", "weekend": []})).unwrap();
    assert_eq!(r.weekend_text, "None");
    assert_eq!(r.workdays_per_week, 7);
    assert_eq!(
        (r.preset_first_year, r.preset_last_year),
        (Some(1978), Some(2199))
    );
}

#[test]
fn normalization() {
    let r = validate(json!({
        "weekend": [7, 6],
        "excludedHolidays": {"us": ["columbusDay", "columbusDay", "juneteenth"], "uk": ["royalWedding1981"]},
        "customHolidays": [custom(json!({})), custom(json!({"id": "c-0000000b", "enabled": false}))]
    }))
    .unwrap();
    assert_eq!(r.calendar.weekend, vec![6, 7]);
    assert_eq!(
        r.calendar.excluded_holidays.us,
        ["columbusDay", "juneteenth"]
    );
    assert_eq!(r.calendar.excluded_holidays.uk, ["royalWedding1981"]);
    assert_eq!(r.enabled_custom_holidays, 1);
    assert!(
        r.calendar.custom_holidays[0].enabled,
        "enabled defaults to true"
    );
    assert_eq!(
        r.summary_text,
        "Holidays: None; weekend: Saturday, Sunday; 1 custom holiday"
    );
}

#[test]
fn weekend_errors() {
    assert_eq!(code(json!({"weekend": [0]})), "invalid_weekend");
    assert_eq!(code(json!({"weekend": [8]})), "invalid_weekend");
    assert_eq!(code(json!({"weekend": [6, 6]})), "invalid_weekend");
    assert_eq!(
        code(json!({"weekend": [1, 2, 3, 4, 5, 6, 7]})),
        "no_working_days"
    );
    assert_eq!(code(json!({"weekend": [1, 2, 3, 4, 5, 6]})), "ok");
    // Weekend errors come first (spec 1 §5.2: weekend, then holidays).
    assert_eq!(
        code(json!({"weekend": [9], "schemaVersion": 2, "hijriOffsetDays": 9})),
        "invalid_weekend"
    );
}

#[test]
fn schema_and_hijri_errors() {
    assert_eq!(code(json!({"schemaVersion": 2})), "invalid_schema_version");
    assert_eq!(code(json!({"hijriOffsetDays": 3})), "invalid_hijri_offset");
    assert_eq!(code(json!({"hijriOffsetDays": -2})), "ok");
    let ov = |y: i64, e: &str, d: &str| json!({"hijriYear": y, "event": e, "date": d});
    assert_eq!(
        code(json!({"hijriOverrides": [ov(1447, "eidAlFitr", "2026-03-19")]})),
        "ok"
    );
    // ±3 days of the tabular 2026-03-20.
    assert_eq!(
        code(json!({"hijriOverrides": [ov(1447, "eidAlFitr", "2026-03-23")]})),
        "ok"
    );
    let (c, m) =
        validate(json!({"hijriOverrides": [ov(1447, "eidAlFitr", "2026-03-24")]})).unwrap_err();
    assert_eq!(c, "invalid_hijri_override");
    assert_eq!(
        m,
        "Islamic date override 1: the date must be within 3 days of the estimated date 2026-03-20."
    );
    // Hijri year bound 1317..=1626 (critique wrong-vector 4).
    assert_eq!(
        code(json!({"hijriOverrides": [ov(1627, "islamicNewYear", "2200-02-20")]})),
        "invalid_hijri_override"
    );
    assert_eq!(
        code(json!({"hijriOverrides": [ov(1316, "islamicNewYear", "1899-05-01")]})),
        "invalid_hijri_override"
    );
    assert_eq!(
        code(json!({"hijriOverrides": [ov(1447, "mawlid", "2025-9-05")]})),
        "invalid_hijri_override"
    );
    let dup = json!({"hijriOverrides": [ov(1447, "mawlid", "2025-09-05"), ov(1447, "mawlid", "2025-09-04")]});
    let (c, m) = validate(dup).unwrap_err();
    assert_eq!(c, "invalid_hijri_override");
    assert_eq!(
        m,
        "Islamic date override 2: the same year and event appear more than once."
    );
    let many: Vec<Value> = (0..51)
        .map(|i| ov(1400 + i, "islamicNewYear", "2000-01-01"))
        .collect();
    assert_eq!(
        code(json!({"hijriOverrides": many})),
        "too_many_hijri_overrides"
    );
    // An unknown event is a deserialization error (invalid_request at IPC).
    let bad: Result<ValidateCalendarRequest, _> = serde_json::from_value(
        json!({"calendar": {"hijriOverrides": [ov(1447, "ramadan", "2026-02-18")]}}),
    );
    assert!(bad.is_err());
}

#[test]
fn excluded_holiday_errors() {
    let (c, m) = validate(json!({"excludedHolidays": {"us": ["goodFriday"]}})).unwrap_err();
    assert_eq!(c, "invalid_excluded_holiday");
    assert_eq!(
        m,
        "Excluded holidays (us): entry 1 is not a holiday of this preset."
    );
    assert_eq!(
        code(json!({"excludedHolidays": {"uk": ["coronation2023", "goodFriday"]}})),
        "ok"
    );
    assert_eq!(
        code(json!({"excludedHolidays": {"eg": ["copticEaster", "shamElNessim", "arafatDay"]}})),
        "ok"
    );
    let too_long: Vec<&str> = std::iter::repeat_n("newYearsDay", 12).collect();
    assert_eq!(
        code(json!({"excludedHolidays": {"us": too_long}})),
        "invalid_excluded_holiday"
    );
    // Lists of presets other than the selected one are validated too.
    assert_eq!(
        code(json!({"preset": "us", "excludedHolidays": {"eg": ["nope"]}})),
        "invalid_excluded_holiday"
    );
}

#[test]
fn custom_holiday_errors() {
    let one = |extra: Value| code(json!({"customHolidays": [custom(extra)]}));
    assert_eq!(one(json!({})), "ok");
    for bad in [
        json!({"id": "c-0000000A"}),
        json!({"id": "x-0000000a"}),
        json!({"id": "c-000000a"}),
        json!({"name": ""}),
        json!({"name": " Office"}),
        json!({"name": "Office "}),
        json!({"name": "Office\u{202E}"}),
        json!({"name": "Office\u{200F}"}),
        json!({"name": "Office\u{0085}"}),
        json!({"name": "Line\nbreak"}),
        json!({"name": "x".repeat(61)}),
        json!({"date": "2026-02-30"}),
        json!({"date": " 2026-12-24"}),
        json!({"date": "1899-12-31"}),
        json!({"date": "2200-01-01"}),
        json!({"month": 12}),
        json!({"kind": "yearly"}),
        json!({"kind": "yearly", "date": null, "month": 13, "day": 1}),
        json!({"kind": "yearly", "date": null, "month": 2, "day": 30}),
        json!({"kind": "yearly", "date": null, "month": 4, "day": 31}),
        json!({"kind": "yearly", "date": null, "month": 1, "day": 1, "fromYear": 2200}),
        json!({"kind": "yearly", "date": null, "month": 1}),
    ] {
        assert_eq!(one(bad.clone()), "invalid_custom_holiday", "{bad}");
    }
    assert_eq!(one(json!({"name": "\u{0639}".repeat(60)})), "ok");
    assert_eq!(
        one(json!({"kind": "yearly", "date": null, "month": 2, "day": 29, "fromYear": 1900})),
        "ok"
    );
    let (_, m) =
        validate(json!({"customHolidays": [custom(json!({})), custom(json!({}))]})).unwrap_err();
    assert_eq!(
        m,
        "Custom holiday 2: the id is already used by another custom holiday."
    );
    let many: Vec<Value> = (0..101)
        .map(|i| custom(json!({"id": format!("c-{i:08x}")})))
        .collect();
    assert_eq!(
        code(json!({"customHolidays": many})),
        "too_many_custom_holidays"
    );
    let hundred: Vec<Value> = (0..100)
        .map(|i| custom(json!({"id": format!("c-{i:08x}"), "name": "n".repeat(60)})))
        .collect();
    assert_eq!(code(json!({"customHolidays": hundred})), "ok");
}

#[test]
fn calendar_rejects_unknown_fields_and_values() {
    for bad in [
        json!({"weekends": [6]}),
        json!({"preset": "fr"}),
        json!({"preset": "uk-ew"}),
        json!({"observedMode": "nearest"}),
        json!({"excludedHolidays": {"fr": []}}),
        json!({"customHolidays": [{"id": "c-00000001", "name": "x", "kind": "date", "date": "2026-01-01", "color": "red"}]}),
        json!({"customHolidays": [{"id": "c-00000001", "name": "x", "kind": "weekly"}]}),
        json!({"weekend": [6.5]}),
    ] {
        let r: Result<ValidateCalendarRequest, _> =
            serde_json::from_value(json!({ "calendar": bad.clone() }));
        assert!(r.is_err(), "{bad}");
    }
}

// ---------------------------------------------------------------------------
// month_grid
// ---------------------------------------------------------------------------

fn grid(req: Value) -> MonthGridResult {
    let req: MonthGridRequest = serde_json::from_value(req).expect("request deserializes");
    month_grid(&req).expect("grid succeeds")
}

#[test]
fn grid_monday_first_with_today_range_and_holidays() {
    let g = grid(json!({
        "year": 2026, "month": 11, "today": "2026-11-16",
        "rangeStart": "2026-11-20", "rangeEnd": "2026-11-10",
        "calendar": {"preset": "us"}
    }));
    assert_eq!(g.title, "November 2026");
    assert_eq!(
        g.weekday_headers,
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    );
    assert_eq!(g.cells.len(), 42);
    // Nov 1 2026 is a Sunday, so a Monday-first grid starts on Oct 26.
    assert_eq!(g.cells[0].date, "2026-10-26");
    assert_eq!(g.cells[6].date, "2026-11-01");
    assert_eq!(g.cells[41].date, "2026-12-06");
    assert_eq!(g.cells.iter().filter(|c| c.in_month).count(), 30);
    for (i, c) in g.cells.iter().enumerate() {
        assert_eq!(c.iso_weekday as usize, i % 7 + 1);
        assert_eq!(c.weekend, c.iso_weekday >= 6);
        assert!(!c.out_of_range);
    }
    let cell = |d: &str| g.cells.iter().find(|c| c.date == d).unwrap();
    assert!(cell("2026-11-16").is_today);
    assert_eq!(g.cells.iter().filter(|c| c.is_today).count(), 1);
    assert_eq!(g.cells.iter().filter(|c| c.in_range).count(), 11);
    assert!(cell("2026-11-10").is_range_start && cell("2026-11-10").in_range);
    assert!(cell("2026-11-20").is_range_end);
    assert!(!cell("2026-11-21").in_range);
    let vet = cell("2026-11-11");
    assert!(vet.holiday && !vet.approximate);
    assert_eq!(vet.holiday_names, ["Veterans Day"]);
    assert_eq!(
        vet.label,
        "Wednesday, November 11, 2026, holiday: Veterans Day"
    );
    assert_eq!(cell("2026-11-16").label, "Monday, November 16, 2026, today");
    assert_eq!(
        cell("2026-11-15").label,
        "Sunday, November 15, 2026, weekend"
    );
    let dates: Vec<&str> = g.holidays.iter().map(|h| h.date.as_str()).collect();
    assert_eq!(dates, ["2026-11-11", "2026-11-26"]);
    assert!(g.warnings.is_empty());
    assert!(!g.used_approximate_holidays);
}

#[test]
fn grid_sunday_first_and_optional_inputs() {
    let g = grid(json!({"year": 2026, "month": 11, "firstDayOfWeek": "sunday"}));
    assert_eq!(
        g.weekday_headers,
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    );
    assert_eq!(g.cells[0].date, "2026-11-01");
    assert!(g
        .cells
        .iter()
        .all(|c| !c.is_today && !c.in_range && !c.holiday));
    // A blank today and a single range end are allowed.
    let g = grid(json!({"year": 2026, "month": 2, "today": "", "rangeEnd": "2026-02-14"}));
    assert_eq!(g.cells.iter().filter(|c| c.in_range).count(), 1);
    assert_eq!(g.cells.iter().filter(|c| c.in_month).count(), 28);
    // February 2021 starts on Monday and fills exactly four rows; the grid
    // still has 42 cells.
    let g = grid(json!({"year": 2021, "month": 2}));
    assert_eq!(g.cells[0].date, "2021-02-01");
    assert_eq!(g.cells.len(), 42);
}

#[test]
fn grid_marks_estimates_and_custom_names() {
    let g = grid(json!({
        "year": 2026, "month": 3,
        "calendar": {"preset": "eg", "weekend": [5, 6], "customHolidays": [
            {"id": "c-00000001", "name": "Team day", "kind": "date", "date": "2026-03-20"}
        ]}
    }));
    let c = g.cells.iter().find(|c| c.date == "2026-03-20").unwrap();
    assert!(c.approximate && c.weekend);
    assert_eq!(c.holiday_names, ["Eid al-Fitr", "Team day"]);
    assert_eq!(
        c.label,
        "Friday, March 20, 2026, weekend, holiday: Eid al-Fitr / Team day (estimated)"
    );
    assert!(g.used_approximate_holidays);
}

#[test]
fn grid_edges_and_errors() {
    let g = grid(json!({"year": 1, "month": 1, "firstDayOfWeek": "sunday"}));
    assert_eq!(g.cells[0].date, "0000-12-31");
    assert!(g.cells[0].out_of_range && !g.cells[0].in_month);
    assert!(!g.cells[1].out_of_range);
    let g = grid(json!({"year": 9999, "month": 12, "calendar": {"preset": "us"}}));
    assert!(g.cells[41].out_of_range);
    assert_eq!(g.cells[41].date, "10000-01-09");
    assert_eq!(g.warnings, ["presetYearOutOfRange"]);
    let err = |req: Value| {
        let req: MonthGridRequest = serde_json::from_value(req).unwrap();
        month_grid(&req).unwrap_err().code.as_str()
    };
    assert_eq!(err(json!({"year": 0, "month": 1})), "year_out_of_range");
    assert_eq!(err(json!({"year": 10000, "month": 1})), "year_out_of_range");
    assert_eq!(
        err(json!({"year": 2026, "month": 13})),
        "month_out_of_range"
    );
    assert_eq!(
        err(json!({"year": 2026, "month": 1, "today": "2026-1-1"})),
        "invalid_date_format"
    );
    assert_eq!(
        err(json!({"year": 2026, "month": 1, "calendar": {"weekend": [1, 2, 3, 4, 5, 6, 7]}})),
        "no_working_days"
    );
    let bad: Result<MonthGridRequest, _> =
        serde_json::from_value(json!({"year": 2026, "month": 1, "firstDayOfWeek": "saturday"}));
    assert!(bad.is_err());
}

// ---------------------------------------------------------------------------
// No-panic fuzzing
// ---------------------------------------------------------------------------

fn pick<'a>(rng: &mut XorShift, items: &[&'a str]) -> &'a str {
    items[rng.range(0, items.len() as i64 - 1) as usize]
}

#[test]
fn calendar_validation_and_grid_never_panic() {
    let mut rng = XorShift::new(0xCA1E_0001);
    let dates = [
        "2026-01-01",
        "1899-12-31",
        "2199-12-31",
        "0001-01-01",
        "9999-12-31",
        "",
        " ",
        "2026-02-29",
        "2024-02-29",
        "abc",
        "２０２６-01-01",
        "2026-13-01",
    ];
    let ids = [
        "newYearsDay",
        "goodFriday",
        "eidAlAdha",
        "copticEaster",
        "",
        "x",
    ];
    for _ in 0..5_000 {
        let weekend: Vec<i64> = (0..rng.range(0, 9)).map(|_| rng.range(-2, 9)).collect();
        let customs: Vec<Value> = (0..rng.range(0, 4))
            .map(|i| {
                json!({
                    "id": if rng.coin() { format!("c-{:08x}", i) } else { "c-zz".to_string() },
                    "name": pick(&mut rng, &["A", " B", "C\u{2066}", "", "Long name"]),
                    "kind": pick(&mut rng, &["date", "yearly"]),
                    "date": if rng.coin() { Value::from(pick(&mut rng, &dates)) } else { Value::Null },
                    "month": if rng.coin() { Value::from(rng.range(-1, 14)) } else { Value::Null },
                    "day": if rng.coin() { Value::from(rng.range(-1, 32)) } else { Value::Null },
                    "fromYear": if rng.coin() { Value::from(rng.range(1800, 2300)) } else { Value::Null },
                    "enabled": rng.coin(),
                })
            })
            .collect();
        let overrides: Vec<Value> = (0..rng.range(0, 3))
            .map(|_| {
                json!({
                    "hijriYear": rng.range(1300, 1700),
                    "event": pick(&mut rng, &["islamicNewYear", "mawlid", "eidAlFitr", "eidAlAdha"]),
                    "date": pick(&mut rng, &dates),
                })
            })
            .collect();
        let calendar = json!({
            "weekend": weekend,
            "preset": pick(&mut rng, &["none", "us", "uk", "eg"]),
            "hijriOffsetDays": rng.range(-4, 4),
            "hijriOverrides": overrides,
            "excludedHolidays": {"us": [pick(&mut rng, &ids)], "eg": [pick(&mut rng, &ids)]},
            "customHolidays": customs,
            "observedMode": pick(&mut rng, &["observed", "actual", "both"]),
            "schemaVersion": rng.range(0, 2),
        });
        let spec: CalendarSpec = match serde_json::from_value(calendar.clone()) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let validated = validate_calendar(&ValidateCalendarRequest {
            calendar: spec.clone(),
        });
        let built = Calendar::new(&spec);
        assert_eq!(validated.is_ok(), built.is_ok());
        let year = rng.range(-5, 10_005);
        let month = rng.range(-1, 14);
        let req = json!({
            "year": year, "month": month,
            "today": pick(&mut rng, &dates),
            "rangeStart": pick(&mut rng, &dates),
            "calendar": calendar,
        });
        if let Ok(req) = serde_json::from_value::<MonthGridRequest>(req) {
            if let Ok(g) = month_grid(&req) {
                assert_eq!(g.cells.len(), 42);
            }
        }
    }
}
