//! Published holiday tables (spec 2 §9, FROZEN §10/§14): US federal, UK
//! (England & Wales), Egypt, Western and Orthodox Easter, the tabular Hijri
//! golden values, and business-day counts per year.
//!
//! Every expectation here is hand-verified against the published lists and
//! weekday arithmetic; none is generated from the engine.

mod common;

use common::ymd;
use date_core::format::format_iso;
use date_core::holidays::easter::{julian_fixed_in_year, orthodox_easter, western_easter};
use date_core::holidays::hijri::{days_to_hijri, hijri_to_days, HijriDate};
use date_core::{
    calc_business_days, holidays_in_range, BusinessDaysRequest, HijriEvent, HolidayInstance,
    HolidaysInRangeRequest, HolidaysInRangeResult,
};
use serde_json::{json, Value};

/// Lists the holidays of `[start, end]` for a calendar given as JSON.
fn holidays(start: &str, end: &str, calendar: Value) -> HolidaysInRangeResult {
    let req: HolidaysInRangeRequest = serde_json::from_value(json!({
        "startDate": start,
        "endDate": end,
        "calendar": calendar,
    }))
    .expect("request deserializes");
    holidays_in_range(&req).expect("holidays_in_range succeeds")
}

/// `(date, actualDate)` pairs of a listing.
fn dates(list: &[HolidayInstance]) -> Vec<(String, String)> {
    list.iter()
        .map(|h| (h.date.clone(), h.actual_date.clone()))
        .collect()
}

/// Expected `(date, actualDate)` pairs from `"date"` or `"date=actual"`.
fn expect(items: &[&str]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|s| match s.split_once('=') {
            Some((d, a)) => (d.to_string(), a.to_string()),
            None => (s.to_string(), s.to_string()),
        })
        .collect()
}

fn year(preset: &str, y: i64) -> HolidaysInRangeResult {
    holidays(
        &format!("{y:04}-01-01"),
        &format!("{y:04}-12-31"),
        json!({"preset": preset}),
    )
}

/// Business days over a whole year, later date included.
fn business_year(y: i64, calendar: Value) -> i64 {
    let req: BusinessDaysRequest = serde_json::from_value(json!({
        "startDate": format!("{y:04}-01-01"),
        "endDate": format!("{y:04}-12-31"),
        "includeEndDay": true,
        "calendar": calendar,
    }))
    .expect("request deserializes");
    calc_business_days(&req)
        .expect("count succeeds")
        .business_days
}

fn find<'a>(list: &'a [HolidayInstance], id: &str) -> Vec<&'a HolidayInstance> {
    list.iter().filter(|h| h.id == id).collect()
}

// ---------------------------------------------------------------------------
// US federal (spec 2 §9.1)
// ---------------------------------------------------------------------------

#[test]
fn us_2026_matches_published_list() {
    let r = year("us", 2026);
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "2026-01-01",
            "2026-01-19",
            "2026-02-16",
            "2026-05-25",
            "2026-06-19",
            "2026-07-03=2026-07-04",
            "2026-09-07",
            "2026-10-12",
            "2026-11-11",
            "2026-11-26",
            "2026-12-25",
        ])
    );
    assert_eq!(r.count, 11);
    assert_eq!(r.holiday_days, 11);
    let july = &find(&r.holidays, "independenceDay")[0];
    assert_eq!(july.name, "Independence Day (observed)");
    assert!(july.shifted && !july.on_weekend && !july.approximate);
    assert!(r.warnings.is_empty());
    assert_eq!(business_year(2026, json!({"preset": "us"})), 250);
}

#[test]
fn us_2027_includes_new_year_2028_observed() {
    let r = year("us", 2027);
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "2027-01-01",
            "2027-01-18",
            "2027-02-15",
            "2027-05-31",
            "2027-06-18=2027-06-19",
            "2027-07-05=2027-07-04",
            "2027-09-06",
            "2027-10-11",
            "2027-11-11",
            "2027-11-25",
            "2027-12-24=2027-12-25",
            "2027-12-31=2028-01-01",
        ])
    );
    assert_eq!(r.summary_text, "12 holidays from 2027-01-01 to 2027-12-31");
    assert_eq!(business_year(2027, json!({"preset": "us"})), 249);
}

#[test]
fn us_edge_years() {
    // 2021: New Year 2022 (Sat) observed Fri 2021-12-31; Juneteenth (Sat)
    // observed Fri Jun 18.
    let r = year("us", 2021);
    let ny: Vec<_> = find(&r.holidays, "newYearsDay")
        .iter()
        .map(|h| (h.date.as_str(), h.actual_date.as_str()))
        .collect();
    assert_eq!(
        ny,
        [("2021-01-01", "2021-01-01"), ("2021-12-31", "2022-01-01")]
    );
    assert_eq!(find(&r.holidays, "juneteenth")[0].date, "2021-06-18");
    // ...and 2022 itself does not list New Year's Day (it was observed in 2021).
    let r = year("us", 2022);
    assert!(find(&r.holidays, "newYearsDay").is_empty());
    assert_eq!(find(&r.holidays, "juneteenth")[0].date, "2022-06-20");
    assert_eq!(find(&r.holidays, "christmasDay")[0].date, "2022-12-26");
    // 2028: Veterans Day Sat Nov 11 -> Fri Nov 10.
    let r = year("us", 2028);
    let vet = find(&r.holidays, "veteransDay")[0];
    assert_eq!(
        (vet.date.as_str(), vet.actual_date.as_str()),
        ("2028-11-10", "2028-11-11")
    );
    // Veterans Day era 1971-1977: 4th Monday of October.
    assert_eq!(
        find(&year("us", 1975).holidays, "veteransDay")[0].date,
        "1975-10-27"
    );
    assert_eq!(
        find(&year("us", 1978).holidays, "veteransDay")[0].date,
        "1978-11-10"
    );
    // MLK Day from 1986 only; Juneteenth from 2021 only.
    assert_eq!(
        find(&year("us", 1986).holidays, "mlkDay")[0].date,
        "1986-01-20"
    );
    assert!(find(&year("us", 1985).holidays, "mlkDay").is_empty());
    assert!(find(&year("us", 2020).holidays, "juneteenth").is_empty());
    // Before 1971 (min_year) the preset adds nothing and warns.
    let r = year("us", 1970);
    assert_eq!(r.count, 0);
    assert_eq!(r.warnings, ["presetYearOutOfRange"]);
    let r = year("us", 1971);
    assert_eq!(r.count, 10);
    assert!(r.warnings.is_empty());
}

#[test]
fn observed_mode_actual_and_both() {
    let r = holidays(
        "2026-07-01",
        "2026-07-31",
        json!({"preset": "us", "observedMode": "actual"}),
    );
    assert_eq!(r.count, 1);
    assert_eq!(r.holidays[0].date, "2026-07-03");
    // Listed because its *actual* date is in range.
    let r = holidays(
        "2026-07-04",
        "2026-07-04",
        json!({"preset": "us", "observedMode": "actual"}),
    );
    assert_eq!(r.count, 1);
    let r = holidays(
        "2026-07-04",
        "2026-07-04",
        json!({"preset": "us", "observedMode": "observed"}),
    );
    assert_eq!(r.count, 0);
    // Both: Jul 3 and Jul 4 are holiday dates (Jul 4 is a Saturday, so the
    // Sat/Sun count does not change; with a Fri-only weekend it does).
    let both = |weekend: Value| {
        let req: BusinessDaysRequest = serde_json::from_value(json!({
            "startDate": "2026-07-01", "endDate": "2026-07-31", "includeEndDay": true,
            "calendar": {"preset": "us", "observedMode": "both", "weekend": weekend},
        }))
        .unwrap();
        calc_business_days(&req).unwrap()
    };
    assert_eq!(both(json!([6, 7])).holiday_days, 1);
    let r = both(json!([5]));
    assert_eq!(r.holiday_days, 1);
    assert_eq!(r.holidays[0].date, "2026-07-04");
    assert_eq!(r.holidays[0].name, "Independence Day");
}

// ---------------------------------------------------------------------------
// UK, England & Wales (spec 2 §9.2, FROZEN §10)
// ---------------------------------------------------------------------------

#[test]
fn uk_2026_and_2027() {
    let r = year("uk", 2026);
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "2026-01-01",
            "2026-04-03",
            "2026-04-06",
            "2026-05-04",
            "2026-05-25",
            "2026-08-31",
            "2026-12-25",
            "2026-12-28=2026-12-26",
        ])
    );
    assert_eq!(r.holidays[7].name, "Boxing Day (substitute day)");
    assert_eq!(business_year(2026, json!({"preset": "uk"})), 253);

    let r = year("uk", 2027);
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "2027-01-01",
            "2027-03-26",
            "2027-03-29",
            "2027-05-03",
            "2027-05-31",
            "2027-08-30",
            "2027-12-27=2027-12-25",
            "2027-12-28=2027-12-26",
        ])
    );
    assert_eq!(business_year(2027, json!({"preset": "uk"})), 253);
}

#[test]
fn uk_2020_2021_2022() {
    assert_eq!(
        dates(&year("uk", 2020).holidays),
        expect(&[
            "2020-01-01",
            "2020-04-10",
            "2020-04-13",
            "2020-05-08",
            "2020-05-25",
            "2020-08-31",
            "2020-12-25",
            "2020-12-28=2020-12-26",
        ])
    );
    assert_eq!(
        dates(&year("uk", 2021).holidays),
        expect(&[
            "2021-01-01",
            "2021-04-02",
            "2021-04-05",
            "2021-05-03",
            "2021-05-31",
            "2021-08-30",
            "2021-12-27=2021-12-25",
            "2021-12-28=2021-12-26",
        ])
    );
    let r = year("uk", 2022);
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "2022-01-03=2022-01-01",
            "2022-04-15",
            "2022-04-18",
            "2022-05-02",
            "2022-06-02",
            "2022-06-03",
            "2022-08-29",
            "2022-09-19",
            "2022-12-26",
            "2022-12-27=2022-12-25",
        ])
    );
    let ids: Vec<&str> = r.holidays.iter().map(|h| h.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "newYearsDay",
            "goodFriday",
            "easterMonday",
            "earlyMayBankHoliday",
            "springBankHoliday",
            "platinumJubilee2022",
            "summerBankHoliday",
            "stateFuneral2022",
            "boxingDay",
            "christmasDay",
        ]
    );
    assert_eq!(r.holidays[9].name, "Christmas Day (substitute day)");
    assert_eq!(r.holidays[8].name, "Boxing Day");
}

#[test]
fn uk_2028_2032_and_1981() {
    let r = year("uk", 2028);
    assert_eq!(r.holidays[0].date, "2028-01-03");
    assert_eq!(r.holidays[0].actual_date, "2028-01-01");
    let r = holidays("2032-12-01", "2032-12-31", json!({"preset": "uk"}));
    assert_eq!(
        dates(&r.holidays),
        expect(&["2032-12-27=2032-12-25", "2032-12-28=2032-12-26"])
    );
    // 1981-07-29 royal wedding (critique wrong-vector 3, FROZEN §10).
    let r = year("uk", 1981);
    let wedding = find(&r.holidays, "royalWedding1981");
    assert_eq!(wedding.len(), 1);
    assert_eq!(wedding[0].date, "1981-07-29");
    assert_eq!(
        dates(&r.holidays),
        expect(&[
            "1981-01-01",
            "1981-04-17",
            "1981-04-20",
            "1981-05-04",
            "1981-05-25",
            "1981-07-29",
            "1981-08-31",
            "1981-12-25",
            "1981-12-28=1981-12-26",
        ])
    );
    // One-offs are excludable by id.
    let r = holidays(
        "1981-07-29",
        "1981-07-29",
        json!({"preset": "uk", "excludedHolidays": {"uk": ["royalWedding1981"]}}),
    );
    assert_eq!(r.count, 0);
    // Other one-offs: 1995, 1999, 2002, 2011, 2012, 2023.
    let one_offs = [
        ("1995", "1995-05-08", "earlyMayBankHoliday"),
        ("1999", "1999-12-31", "millennium1999"),
        ("2002", "2002-06-03", "goldenJubilee2002"),
        ("2002", "2002-06-04", "springBankHoliday"),
        ("2011", "2011-04-29", "royalWedding2011"),
        ("2012", "2012-06-04", "springBankHoliday"),
        ("2012", "2012-06-05", "diamondJubilee2012"),
        ("2023", "2023-05-08", "coronation2023"),
    ];
    for (y, date, id) in one_offs {
        let r = year("uk", y.parse().unwrap());
        let hit = find(&r.holidays, id);
        assert!(
            hit.iter().any(|h| h.date == date && h.actual_date == date),
            "{id} {date}"
        );
    }
    // Before 1978 the preset adds nothing.
    assert_eq!(year("uk", 1977).count, 0);
    assert_eq!(year("uk", 1977).warnings, ["presetYearOutOfRange"]);
}

// ---------------------------------------------------------------------------
// Egypt (spec 2 §9.3, FROZEN §10)
// ---------------------------------------------------------------------------

#[test]
fn egypt_2026_fixed_and_easter_based() {
    let r = year("eg", 2026);
    let fixed: Vec<(&str, &str)> = r
        .holidays
        .iter()
        .filter(|h| !h.approximate)
        .map(|h| (h.date.as_str(), h.id.as_str()))
        .collect();
    assert_eq!(
        fixed,
        [
            ("2026-01-07", "copticChristmas"),
            ("2026-01-25", "revolutionDay25Jan"),
            ("2026-04-12", "copticEaster"),
            ("2026-04-13", "shamElNessim"),
            ("2026-04-25", "sinaiLiberationDay"),
            ("2026-05-01", "labourDay"),
            ("2026-06-30", "june30Revolution"),
            ("2026-07-23", "revolutionDay23Jul"),
            ("2026-10-06", "armedForcesDay"),
        ]
    );
    assert!(r.holidays.iter().all(|h| !h.shifted));
}

#[test]
fn egypt_2026_full_set_with_tabular_islamic_dates() {
    // Spec 2 §9.3 lists 17 dates; FROZEN §10 adds Coptic Easter (Apr 12),
    // so the default set has 18. Excluding copticEaster restores the spec's
    // 17 dates and its 249 business days.
    let spec17 = [
        "2026-01-07",
        "2026-01-25",
        "2026-03-20",
        "2026-03-21",
        "2026-03-22",
        "2026-04-13",
        "2026-04-25",
        "2026-05-01",
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
        "2026-05-29",
        "2026-06-17",
        "2026-06-30",
        "2026-07-23",
        "2026-08-26",
        "2026-10-06",
    ];
    let cal =
        json!({"preset": "eg", "weekend": [5, 6], "excludedHolidays": {"eg": ["copticEaster"]}});
    let r = holidays("2026-01-01", "2026-12-31", cal.clone());
    let got: Vec<&str> = r.holidays.iter().map(|h| h.date.as_str()).collect();
    assert_eq!(got, spec17);
    assert_eq!(r.count, 17);
    assert!(r.used_approximate_holidays);
    assert_eq!(business_year(2026, cal), 249);

    let r = holidays("2026-01-01", "2026-12-31", json!({"preset": "eg"}));
    assert_eq!(r.count, 18);
    assert_eq!(
        business_year(2026, json!({"preset": "eg", "weekend": [5, 6]})),
        248
    );

    // Approximate flags and Eid day indexes.
    let fitr = find(&r.holidays, "eidAlFitr");
    let idx: Vec<_> = fitr
        .iter()
        .map(|h| (h.date.as_str(), h.day_index))
        .collect();
    assert_eq!(
        idx,
        [
            ("2026-03-20", Some(1)),
            ("2026-03-21", Some(2)),
            ("2026-03-22", Some(3))
        ]
    );
    assert!(fitr.iter().all(|h| h.approximate));
    assert_eq!(find(&r.holidays, "arafatDay")[0].date, "2026-05-26");
    assert_eq!(find(&r.holidays, "islamicNewYear")[0].date, "2026-06-17");
    assert_eq!(find(&r.holidays, "mawlid")[0].date, "2026-08-26");
    // Under the default Sat/Sun weekend, Mar 21-22 fall on the weekend.
    let sat = find(&r.holidays, "eidAlFitr")[1];
    assert!(sat.on_weekend);
}

#[test]
fn egypt_hijri_offset_and_overrides() {
    // Global offset moves every Islamic date; fixed dates stay.
    let r = holidays(
        "2026-01-01",
        "2026-12-31",
        json!({"preset": "eg", "hijriOffsetDays": -1}),
    );
    assert_eq!(find(&r.holidays, "eidAlFitr")[0].date, "2026-03-19");
    assert_eq!(find(&r.holidays, "copticChristmas")[0].date, "2026-01-07");
    // An Adha override moves the whole block and Arafat with it, and wins
    // over the offset.
    let r = holidays(
        "2026-01-01",
        "2026-12-31",
        json!({"preset": "eg", "hijriOffsetDays": 2, "hijriOverrides": [
            {"hijriYear": 1447, "event": "eidAlAdha", "date": "2026-05-26"}
        ]}),
    );
    let adha: Vec<&str> = find(&r.holidays, "eidAlAdha")
        .iter()
        .map(|h| h.date.as_str())
        .collect();
    assert_eq!(adha, ["2026-05-26", "2026-05-27", "2026-05-28"]);
    assert_eq!(find(&r.holidays, "arafatDay")[0].date, "2026-05-25");
    assert_eq!(find(&r.holidays, "eidAlFitr")[0].date, "2026-03-22");
}

#[test]
fn egypt_window_and_two_eids_in_one_year() {
    assert_eq!(year("eg", 2013).count, 0);
    assert_eq!(year("eg", 2013).warnings, ["presetYearOutOfRange"]);
    let r = year("eg", 2033);
    let first_days: Vec<&str> = find(&r.holidays, "eidAlFitr")
        .iter()
        .filter(|h| h.day_index == Some(1))
        .map(|h| h.date.as_str())
        .collect();
    assert_eq!(first_days, ["2033-01-03", "2033-12-23"]);
}

// ---------------------------------------------------------------------------
// Easter (spec 2 §9.4)
// ---------------------------------------------------------------------------

#[test]
fn easter_tables() {
    let table = [
        (
            2024,
            "2024-03-31",
            "2024-03-29",
            "2024-04-01",
            "2024-05-05",
            "2024-05-06",
        ),
        (
            2025,
            "2025-04-20",
            "2025-04-18",
            "2025-04-21",
            "2025-04-20",
            "2025-04-21",
        ),
        (
            2026,
            "2026-04-05",
            "2026-04-03",
            "2026-04-06",
            "2026-04-12",
            "2026-04-13",
        ),
        (
            2027,
            "2027-03-28",
            "2027-03-26",
            "2027-03-29",
            "2027-05-02",
            "2027-05-03",
        ),
        (
            2028,
            "2028-04-16",
            "2028-04-14",
            "2028-04-17",
            "2028-04-16",
            "2028-04-17",
        ),
        (
            2029,
            "2029-04-01",
            "2029-03-30",
            "2029-04-02",
            "2029-04-08",
            "2029-04-09",
        ),
        (
            2030,
            "2030-04-21",
            "2030-04-19",
            "2030-04-22",
            "2030-04-28",
            "2030-04-29",
        ),
    ];
    for (y, western, good_friday, easter_monday, orthodox, sham) in table {
        assert_eq!(format_iso(western_easter(y)), western, "{y}");
        assert_eq!(format_iso(orthodox_easter(y)), orthodox, "{y}");
        let uk = year("uk", y);
        assert_eq!(find(&uk.holidays, "goodFriday")[0].date, good_friday);
        assert_eq!(find(&uk.holidays, "easterMonday")[0].date, easter_monday);
        let eg = year("eg", y);
        assert_eq!(find(&eg.holidays, "copticEaster")[0].date, orthodox);
        assert_eq!(find(&eg.holidays, "shamElNessim")[0].date, sham);
    }
    assert_eq!(format_iso(western_easter(2000)), "2000-04-23");
    assert_eq!(format_iso(western_easter(2038)), "2038-04-25");
    assert_eq!(format_iso(western_easter(2285)), "2285-03-22");
    assert_eq!(format_iso(orthodox_easter(2010)), "2010-04-04");
    assert_eq!(format_iso(orthodox_easter(2100)), "2100-05-02");
    let xmas = |y| julian_fixed_in_year(y, 12, 25).map(format_iso);
    assert_eq!(xmas(2100).as_deref(), Some("2100-01-07"));
    assert_eq!(xmas(2101).as_deref(), Some("2101-01-08"));
    assert_eq!(xmas(1901).as_deref(), Some("1901-01-07"));
    assert_eq!(
        find(&year("eg", 2101).holidays, "copticChristmas")[0].date,
        "2101-01-08"
    );
}

/// Gauss's Easter algorithm (with the Lichtenberg corrections), an
/// independent cross-check of Meeus/Jones/Butcher.
fn gauss_easter(y: i64) -> i64 {
    let a = y % 19;
    let k = y / 100;
    let m = 15 + (3 * k + 3) / 4 - (8 * k + 13) / 25;
    let s = 2 - (3 * k + 3) / 4;
    let d = (19 * a + m) % 30;
    let r = (d + a / 11) / 29;
    let og = 21 + d - r;
    let sz = 7 - (y + y / 4 + s) % 7;
    let oe = 7 - (og - sz) % 7;
    let os = og + oe; // days after Feb 28/29 counted from March 1 = 1
    ymd(y, 3, 1) + os - 1
}

#[test]
fn easter_invariants_1900_2199() {
    for y in 1900..=2199 {
        let w = western_easter(y);
        assert_eq!(w, gauss_easter(y), "{y}");
        assert!(w >= ymd(y, 3, 22) && w <= ymd(y, 4, 25), "{y}");
        assert_eq!((w + 3).rem_euclid(7), 6, "{y}: Sunday");
        let o = orthodox_easter(y);
        assert_eq!((o + 3).rem_euclid(7), 6, "{y}: Orthodox Sunday");
        assert!(o >= w, "{y}: Orthodox never before Western");
        if y <= 2099 {
            assert!(o >= ymd(y, 4, 4) && o <= ymd(y, 5, 8), "{y}");
        }
    }
}

// ---------------------------------------------------------------------------
// Tabular Hijri (spec 2 §9.5)
// ---------------------------------------------------------------------------

#[test]
fn hijri_golden_values() {
    let table = [
        (
            1446,
            "2024-07-08",
            "2024-09-16",
            "2025-03-31",
            "2025-06-06",
            "2025-06-07",
        ),
        (
            1447,
            "2025-06-27",
            "2025-09-05",
            "2026-03-20",
            "2026-05-26",
            "2026-05-27",
        ),
        (
            1448,
            "2026-06-17",
            "2026-08-26",
            "2027-03-10",
            "2027-05-16",
            "2027-05-17",
        ),
        (
            1449,
            "2027-06-06",
            "2027-08-15",
            "2028-02-27",
            "2028-05-04",
            "2028-05-05",
        ),
    ];
    for (hy, new_year, mawlid, fitr, arafat, adha) in table {
        let day = |e: HijriEvent| format_iso(e.tabular_day(hy));
        assert_eq!(day(HijriEvent::IslamicNewYear), new_year, "{hy}");
        assert_eq!(day(HijriEvent::Mawlid), mawlid, "{hy}");
        assert_eq!(day(HijriEvent::EidAlFitr), fitr, "{hy}");
        assert_eq!(
            format_iso(HijriEvent::EidAlAdha.tabular_day(hy) - 1),
            arafat
        );
        assert_eq!(day(HijriEvent::EidAlAdha), adha, "{hy}");
    }
    assert!(date_core::holidays::hijri::is_hijri_leap_year(1447));
    assert!(!date_core::holidays::hijri::is_hijri_leap_year(1448));
    // Two Eid al-Fitr in 2000 and in 2033.
    assert_eq!(
        format_iso(HijriEvent::EidAlFitr.tabular_day(1420)),
        "2000-01-08"
    );
    assert_eq!(
        format_iso(HijriEvent::EidAlFitr.tabular_day(1421)),
        "2000-12-28"
    );
    assert_eq!(
        format_iso(HijriEvent::EidAlFitr.tabular_day(1454)),
        "2033-01-03"
    );
    assert_eq!(
        format_iso(HijriEvent::EidAlFitr.tabular_day(1455)),
        "2033-12-23"
    );
    // Round-trip anchors.
    let h = |y, m, d| days_to_hijri(ymd(y, m, d));
    let hd = |year, month, day| HijriDate { year, month, day };
    assert_eq!(h(2026, 11, 16), hd(1448, 6, 5));
    assert_eq!(h(2025, 3, 30), hd(1446, 9, 30));
    assert_eq!(h(1900, 1, 1), hd(1317, 8, 28));
    assert_eq!(h(2199, 12, 31), hd(1626, 11, 13));
    assert_eq!(format_iso(hijri_to_days(1, 1, 1)), "0622-07-19");
}

#[test]
fn hijri_round_trip_1900_2200() {
    let mut prev: Option<HijriDate> = None;
    for z in ymd(1900, 1, 1)..=ymd(2200, 12, 31) {
        let h = days_to_hijri(z);
        assert!((1..=12).contains(&h.month) && (1..=30).contains(&h.day));
        assert_eq!(hijri_to_days(h.year, h.month, h.day), z);
        if let Some(p) = prev {
            assert!(h > p);
        }
        prev = Some(h);
    }
}

// ---------------------------------------------------------------------------
// Custom holidays and range behaviour
// ---------------------------------------------------------------------------

#[test]
fn custom_holidays_yearly_date_and_disabled() {
    let cal = json!({"customHolidays": [
        {"id": "c-00000001", "name": "Founders' Day", "kind": "yearly", "month": 3, "day": 15, "fromYear": 2020, "enabled": true},
        {"id": "c-00000002", "name": "Leap party", "kind": "yearly", "month": 2, "day": 29, "enabled": true},
        {"id": "c-00000003", "name": "Company shutdown", "kind": "date", "date": "2026-12-24", "enabled": true},
        {"id": "c-00000004", "name": "Old", "kind": "date", "date": "2026-12-23", "enabled": false}
    ]});
    let r = holidays("2019-01-01", "2028-12-31", cal);
    let got: Vec<(&str, &str)> = r
        .holidays
        .iter()
        .map(|h| (h.date.as_str(), h.id.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            ("2020-02-29", "c-00000002"),
            ("2020-03-15", "c-00000001"),
            ("2021-03-15", "c-00000001"),
            ("2022-03-15", "c-00000001"),
            ("2023-03-15", "c-00000001"),
            ("2024-02-29", "c-00000002"),
            ("2024-03-15", "c-00000001"),
            ("2025-03-15", "c-00000001"),
            ("2026-03-15", "c-00000001"),
            ("2026-12-24", "c-00000003"),
            ("2027-03-15", "c-00000001"),
            ("2028-02-29", "c-00000002"),
            ("2028-03-15", "c-00000001"),
        ]
    );
    assert!(r.holidays.iter().all(|h| !h.shifted && !h.approximate));
    assert_eq!(
        serde_json::to_value(&r.holidays[0]).unwrap()["source"],
        "custom"
    );
}

#[test]
fn same_date_holidays_count_once_and_names_dedupe() {
    // A custom holiday on a preset date: two instances, one holiday day.
    let cal = json!({"preset": "us", "customHolidays": [
        {"id": "c-00000001", "name": "New Year's Day", "kind": "date", "date": "2026-01-01", "enabled": true},
        {"id": "c-00000002", "name": "Bank day", "kind": "date", "date": "2026-01-01", "enabled": true}
    ]});
    let r = holidays("2026-01-01", "2026-01-31", cal.clone());
    assert_eq!(r.count, 4);
    assert_eq!(r.holiday_days, 2);
    let req: BusinessDaysRequest = serde_json::from_value(json!({
        "startDate": "2026-01-01", "endDate": "2026-01-31", "includeEndDay": true, "calendar": cal,
    }))
    .unwrap();
    let b = calc_business_days(&req).unwrap();
    assert_eq!(b.holiday_days, 2);
    assert_eq!(b.holidays[0].name, "New Year's Day / Bank day");
    // copyText never carries a custom name (FROZEN §11).
    assert!(b
        .copy_text
        .contains("Holidays: 2026-01-01 New Year's Day / Custom holiday; 2026-01-19"));
    assert!(!b.copy_text.contains("Bank day"));
}

#[test]
fn preset_years_outside_window_warn_but_still_compute() {
    let r = holidays("1899-12-01", "1900-01-31", json!({"preset": "uk"}));
    assert_eq!(r.warnings, ["presetYearOutOfRange"]);
    let r = holidays("2199-12-01", "2200-01-31", json!({"preset": "us"}));
    assert_eq!(r.warnings, ["presetYearOutOfRange"]);
    assert_eq!(find(&r.holidays, "christmasDay")[0].date, "2199-12-25");
    // No preset, no yearly customs: never a warning.
    let r = holidays("0001-01-01", "9999-12-31", json!({}));
    assert!(r.warnings.is_empty());
    assert_eq!(r.count, 0);
    // A huge range is fast and complete.
    let r = holidays("0001-01-01", "9999-12-31", json!({"preset": "eg"}));
    assert_eq!(r.warnings, ["presetYearOutOfRange"]);
    assert!(r.count > 186 * 17);
}

#[test]
fn holidays_in_range_accepts_backward_ranges() {
    let r = holidays("2026-12-31", "2026-01-01", json!({"preset": "uk"}));
    assert_eq!(r.start_date, "2026-01-01");
    assert_eq!(r.end_date, "2026-12-31");
    assert_eq!(r.count, 8);
}

/// `onWeekend` describes the counted dates (spec 2 §8.5): under `actual` a
/// holiday whose actual date is a weekend day has no effect, so it is
/// `onWeekend: true` and carries its plain name; under `both` the observed
/// weekday still counts.
#[test]
fn on_weekend_follows_the_counted_dates() {
    let on_weekend = |mode: &str, preset: &str, start: &str, end: &str, id: &str| {
        let r = holidays(start, end, json!({"preset": preset, "observedMode": mode}));
        let h = find(&r.holidays, id)[0].clone();
        (h.name, h.date, h.actual_date, h.on_weekend)
    };
    let july = |mode| on_weekend(mode, "us", "2026-07-01", "2026-07-31", "independenceDay");
    assert_eq!(
        july("observed"),
        (
            "Independence Day (observed)".into(),
            "2026-07-03".into(),
            "2026-07-04".into(),
            false
        )
    );
    assert_eq!(
        july("actual"),
        (
            "Independence Day".into(),
            "2026-07-03".into(),
            "2026-07-04".into(),
            true
        )
    );
    assert_eq!(
        july("both"),
        (
            "Independence Day (observed)".into(),
            "2026-07-03".into(),
            "2026-07-04".into(),
            false
        )
    );
    // Same range through the business count: no effect under `actual`.
    let req: BusinessDaysRequest = serde_json::from_value(json!({
        "startDate": "2026-07-01", "endDate": "2026-07-31", "includeEndDay": true,
        "calendar": {"preset": "us", "observedMode": "actual"},
    }))
    .unwrap();
    assert_eq!(calc_business_days(&req).unwrap().holiday_days, 0);
    // UK Boxing Day 2026 is Saturday 26, substitute Monday 28.
    let boxing = on_weekend("actual", "uk", "2026-12-01", "2026-12-31", "boxingDay");
    assert_eq!(
        boxing,
        (
            "Boxing Day".into(),
            "2026-12-28".into(),
            "2026-12-26".into(),
            true
        )
    );
    let boxing = on_weekend("observed", "uk", "2026-12-01", "2026-12-31", "boxingDay");
    assert_eq!(
        boxing,
        (
            "Boxing Day (substitute day)".into(),
            "2026-12-28".into(),
            "2026-12-26".into(),
            false
        )
    );
}
