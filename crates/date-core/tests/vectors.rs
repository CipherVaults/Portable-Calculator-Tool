//! Runs the hand-verified vectors in `tests/fixtures/vectors.json`.
//!
//! Each case names an operation, a request and a partial expectation of the
//! serialized `Outcome` envelope. Every field listed in the expectation must
//! match exactly (strings byte for byte, numbers exactly, `null` as `null`);
//! fields the case does not list are not checked. An optional `endsWith` map
//! checks string suffixes of result fields.

use date_core::{
    calc_add_subtract, calc_age, calc_business_days, calc_countdown, calc_date_info,
    calc_days_between, format_int, holidays_in_range, month_grid, parse_amount, parse_date,
    parse_time, parse_weekend, validate_calendar, AddSubtractRequest, AgeRequest,
    BusinessDaysRequest, CountdownRequest, DateInfoRequest, DaysBetweenRequest, Field,
    HolidaysInRangeRequest, MonthGridRequest, Outcome, ValidateCalendarRequest,
};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("fixtures/vectors.json");

fn to_value<T: Serialize>(outcome: Outcome<T>) -> Value {
    serde_json::to_value(outcome).expect("outcome serializes")
}

fn request<T: DeserializeOwned>(id: &str, req: &Value) -> T {
    serde_json::from_value(req.clone())
        .unwrap_or_else(|e| panic!("{id}: request does not deserialize: {e}"))
}

fn field(id: &str, req: &Value) -> Field {
    let key = req["field"].as_str().unwrap_or_default();
    Field::from_key(key).unwrap_or_else(|| panic!("{id}: unknown field {key:?}"))
}

fn raw(req: &Value) -> &str {
    req["raw"].as_str().unwrap_or_default()
}

/// Executes one case and returns the serialized outcome.
fn run(id: &str, op: &str, req: &Value) -> Value {
    match op {
        "parse_date" => to_value(parse_date(raw(req), field(id, req)).into()),
        "parse_amount" => to_value(parse_amount(raw(req), field(id, req)).into()),
        "parse_time" => {
            let required = req["required"].as_bool().unwrap_or(false);
            to_value(parse_time(raw(req), field(id, req), required).into())
        }
        "format_int" => {
            let n = req["n"].as_i64().expect("n is an integer");
            to_value(Outcome::Ok {
                result: format_int(n),
            })
        }
        "parse_weekend" => {
            let days: Vec<i64> = request(id, &req["weekend"]);
            to_value(
                parse_weekend(&days)
                    .map(|mask| {
                        json!({
                            "mask": mask,
                            "workdaysPerWeek": date_core::parse::workdays_per_week(mask),
                        })
                    })
                    .into(),
            )
        }
        "calc_days_between" => {
            to_value(calc_days_between(&request::<DaysBetweenRequest>(id, req)).into())
        }
        "calc_add_subtract" => {
            to_value(calc_add_subtract(&request::<AddSubtractRequest>(id, req)).into())
        }
        "calc_age" => to_value(calc_age(&request::<AgeRequest>(id, req)).into()),
        "calc_date_info" => to_value(calc_date_info(&request::<DateInfoRequest>(id, req)).into()),
        "calc_countdown" => to_value(calc_countdown(&request::<CountdownRequest>(id, req)).into()),
        "calc_business_days" => {
            to_value(calc_business_days(&request::<BusinessDaysRequest>(id, req)).into())
        }
        "holidays_in_range" => {
            to_value(holidays_in_range(&request::<HolidaysInRangeRequest>(id, req)).into())
        }
        "month_grid" => to_value(month_grid(&request::<MonthGridRequest>(id, req)).into()),
        "validate_calendar" => {
            to_value(validate_calendar(&request::<ValidateCalendarRequest>(id, req)).into())
        }
        other => panic!("{id}: unknown op {other:?}"),
    }
}

/// Recursively checks that every key of `expected` matches `actual`.
fn partial_match(path: &str, expected: &Value, actual: &Value, failures: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Object(exp), Value::Object(act)) => {
            for (key, ev) in exp {
                let sub = format!("{path}.{key}");
                match act.get(key) {
                    Some(av) => partial_match(&sub, ev, av, failures),
                    None => failures.push(format!("{sub}: missing (expected {ev})")),
                }
            }
        }
        _ if expected == actual => {}
        _ => failures.push(format!("{path}: expected {expected}, got {actual}")),
    }
}

#[test]
fn hand_verified_vectors() {
    let fixture: Value = serde_json::from_str(FIXTURE).expect("vectors.json is valid JSON");
    let cases = fixture["cases"].as_array().expect("cases array");
    assert!(cases.len() >= 190, "expected the full vector set");

    let mut failures = Vec::new();
    let mut ids = std::collections::BTreeSet::new();
    for case in cases {
        let id = case["id"].as_str().expect("case id");
        assert!(ids.insert(id.to_string()), "duplicate case id {id}");
        let op = case["op"].as_str().expect("case op");
        let actual = run(id, op, &case["req"]);
        partial_match(id, &case["expect"], &actual, &mut failures);
        if let Some(suffixes) = case.get("endsWith").and_then(Value::as_object) {
            for (key, suffix) in suffixes {
                let got = actual["result"][key].as_str().unwrap_or_default();
                let want = suffix.as_str().unwrap_or_default();
                if !got.ends_with(want) {
                    failures.push(format!(
                        "{id}.result.{key}: {got:?} does not end with {want:?}"
                    ));
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} vector mismatch(es):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn partial_match_detects_mismatches() {
    let mut failures = Vec::new();
    partial_match(
        "x",
        &json!({"a": 1, "b": {"c": "s"}, "n": null}),
        &json!({"a": 1, "b": {"c": "s", "d": 2}, "n": null, "extra": true}),
        &mut failures,
    );
    assert!(failures.is_empty(), "{failures:?}");
    partial_match(
        "x",
        &json!({"a": 2, "b": {"c": "t"}, "m": 0, "n": null}),
        &json!({"a": 1, "b": {"c": "s"}, "n": {"k": 1}}),
        &mut failures,
    );
    assert_eq!(failures.len(), 4, "{failures:?}");
}

#[test]
fn envelope_uses_string_tags() {
    let ok = serde_json::to_string(&Outcome::from(parse_date("2025-01-01", Field::Date))).unwrap();
    assert_eq!(ok, r#"{"ok":"true","result":20089}"#);
    let err =
        serde_json::to_string(&Outcome::from(parse_date("2023-02-29", Field::StartDate))).unwrap();
    assert_eq!(
        err,
        r#"{"ok":"false","error":{"code":"invalid_day","field":"startDate","message":"Start date is not a real date: February 2023 has 28 days."}}"#
    );
    let no_field = serde_json::to_string(&Outcome::<i64>::from(Err(
        date_core::CoreError::result_out_of_range(),
    )))
    .unwrap();
    assert!(no_field
        .starts_with(r#"{"ok":"false","error":{"code":"result_out_of_range","field":null,"#));
}

#[test]
fn requests_reject_unknown_fields() {
    let bad = json!({"startDate": "2025-01-01", "endDate": "2025-01-02", "extra": 1});
    assert!(serde_json::from_value::<DaysBetweenRequest>(bad).is_err());
    let bad = json!({"now": {"date": "2025-01-01", "time": "00:00", "tz": "x"}});
    assert!(serde_json::from_value::<CountdownRequest>(bad).is_err());
    let bad = json!({"date": "2025-01-01", "operation": "add", "calendar": {"weekends": [6]}});
    assert!(serde_json::from_value::<AddSubtractRequest>(bad).is_err());
    let ok = json!({"date": "2025-01-01", "operation": "add", "calendar": {"weekend": [5, 6], "preset": "eg"}});
    assert!(serde_json::from_value::<AddSubtractRequest>(ok).is_ok());
}

#[test]
fn result_key_order_is_declaration_order() {
    let req = DaysBetweenRequest {
        start_date: "2025-01-01".into(),
        end_date: "2025-01-02".into(),
        include_end_day: false,
    };
    let text = serde_json::to_string(&Outcome::from(calc_days_between(&req))).unwrap();
    let keys = [
        "\"ok\"",
        "\"result\"",
        "\"startDate\"",
        "\"endDate\"",
        "\"includeEndDay\"",
        "\"direction\"",
        "\"totalDays\"",
        "\"signedDays\"",
        "\"years\"",
        "\"months\"",
        "\"days\"",
        "\"totalMonths\"",
        "\"weeks\"",
        "\"weekRemainderDays\"",
        "\"totalHours\"",
        "\"totalMinutes\"",
        "\"totalSeconds\"",
        "\"startWeekday\"",
        "\"endWeekday\"",
        "\"breakdownText\"",
        "\"weeksText\"",
        "\"summaryText\"",
        "\"formulaText\"",
        "\"traceLines\"",
        "\"copyText\"",
    ];
    let positions: Vec<usize> = keys
        .iter()
        .map(|k| {
            text.find(k)
                .unwrap_or_else(|| panic!("{k} missing in {text}"))
        })
        .collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "{text}");
}
