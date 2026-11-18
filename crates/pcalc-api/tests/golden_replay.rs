//! Replays both engines' golden fixtures through `pcalc_api::call`:
//!
//! - every `date-core` golden case through its `date.*` op, compared **byte
//!   for byte** with the stored `res` text;
//! - every `percent-core` golden case that maps to a `percent.*` op,
//!   compared field by field with the stored v1.1 JavaScript results (the
//!   same checks as percent-core's own `golden_parity` test). Cases with a
//!   non-finite argument cannot be sent as JSON numbers and must come back
//!   as `invalid_request`; `formatDecimal` cases are not an op.

use serde::Deserialize;
use serde_json::Value;

const DATE_GOLDEN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../date-core/tests/fixtures/golden.json"
);
const PERCENT_GOLDEN: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../percent-core/tests/fixtures/golden.json"
);

/// Splits a golden case line `{"op":"…","req":REQ,"res":RES}` (optionally
/// followed by `,`) into its op and raw REQ / RES texts.
fn split_case(line: &str) -> Option<(&str, &str, &str)> {
    let line = line.strip_suffix(',').unwrap_or(line);
    let rest = line.strip_prefix("{\"op\":\"")?;
    let (op, rest) = rest.split_once("\",\"req\":")?;
    let (req, res) = rest.split_once(",\"res\":")?;
    if res.contains(",\"res\":") {
        return None;
    }
    Some((op, req, res.strip_suffix('}')?))
}

#[test]
fn date_golden_is_byte_identical_through_the_api() {
    let text = std::fs::read_to_string(DATE_GOLDEN).expect("read date golden");
    let mut count = 0usize;
    for line in text.lines().filter(|l| l.starts_with("{\"op\":")) {
        let (core_op, req, res) = split_case(line).unwrap_or_else(|| panic!("bad line {line}"));
        let op = format!("date.{}", core_op.strip_prefix("calc_").unwrap_or(core_op));
        let got = pcalc_api::call(&op, req);
        assert_eq!(got, res, "case #{count} {op} {req}");
        count += 1;
    }
    let header: Value =
        serde_json::from_str(&format!("{}]}}", text.lines().next().expect("header line")))
            .expect("header");
    assert_eq!(header["count"].as_u64(), Some(count as u64));
    assert!(count >= 12_000, "only {count} date cases");
}

#[derive(Deserialize)]
struct PercentCase {
    f: String,
    a: Vec<String>,
    r: Value,
}

fn js_num(s: &str) -> f64 {
    match s {
        "NaN" => f64::NAN,
        "Infinity" => f64::INFINITY,
        "-Infinity" => f64::NEG_INFINITY,
        other => other.parse().expect("golden number"),
    }
}

/// The API serializes non-finite numbers as `null`.
fn same_number(got: &Value, want: f64) -> bool {
    if want.is_finite() {
        got.as_f64()
            .is_some_and(|g| g.to_bits() == want.to_bits() || g == want)
    } else {
        got.is_null()
    }
}

#[test]
fn percent_golden_matches_through_the_api() {
    let text = std::fs::read_to_string(PERCENT_GOLDEN).expect("read percent golden");
    let cases: Vec<PercentCase> = serde_json::from_str(&text).expect("percent golden");
    let (mut checked, mut non_finite, mut format_only) = (0usize, 0usize, 0usize);
    for (idx, case) in cases.iter().enumerate() {
        let (op, keys) = match case.f.as_str() {
            "percentageChange" => ("percent.change", ["originalValue", "newValue"]),
            "percentageOfTotal" => ("percent.percent", ["part", "total"]),
            "percentagePortion" => ("percent.what", ["percent", "number"]),
            "originalValue" => ("percent.base", ["value", "percent"]),
            "discount" => ("percent.discount", ["price", "discountPercent"]),
            "formatDecimal" => {
                format_only += 1;
                continue;
            }
            other => panic!("unknown golden function {other}"),
        };
        let finite = case.a.iter().all(|a| js_num(a).is_finite());
        let req = if finite {
            format!(
                r#"{{"{}":{},"{}":{}}}"#,
                keys[0], case.a[0], keys[1], case.a[1]
            )
        } else {
            format!(
                r#"{{"{}":"{}","{}":"{}"}}"#,
                keys[0], case.a[0], keys[1], case.a[1]
            )
        };
        let got: Value = serde_json::from_str(&pcalc_api::call(op, &req)).expect("envelope");
        if !finite {
            assert_eq!(got["error"]["code"], "invalid_request", "case #{idx} {req}");
            non_finite += 1;
            continue;
        }
        let ctx = format!("case #{idx} {op} {req}");
        if case.f == "discount" {
            let res = &got["result"];
            assert_eq!(got["ok"], "true", "{ctx}");
            assert!(res.get("ok").is_none(), "{ctx}: boolean ok must be dropped");
            assert!(
                same_number(
                    &res["finalPrice"],
                    js_num(case.r["finalPrice"].as_str().unwrap())
                ),
                "{ctx}"
            );
            assert!(
                same_number(&res["saved"], js_num(case.r["saved"].as_str().unwrap())),
                "{ctx}"
            );
            assert_eq!(res["label"], case.r["label"], "{ctx}");
            assert_eq!(res["copyText"], case.r["copyText"], "{ctx}");
        } else if case.r["ok"].as_bool() == Some(true) {
            let res = &got["result"];
            assert_eq!(got["ok"], "true", "{ctx}");
            let want_value = js_num(case.r["value"].as_str().unwrap());
            assert!(
                same_number(&res["value"], want_value),
                "{ctx}: value {}",
                res["value"]
            );
            assert_eq!(res["label"], case.r["label"], "{ctx}");
            let want_live = if case.f == "percentageChange" && want_value.is_nan() {
                Value::from("?% no change")
            } else {
                case.r["label"].clone()
            };
            assert_eq!(res["liveResult"], want_live, "{ctx}");
        } else {
            assert_eq!(got["ok"], "false", "{ctx}");
            assert_eq!(got["error"]["message"], case.r["error"], "{ctx}");
            assert_eq!(got["error"]["code"], "zero_divisor", "{ctx}");
        }
        checked += 1;
    }
    assert!(checked > 5_000, "only {checked} percent cases checked");
    assert!(non_finite > 0 && format_only > 0);
    assert_eq!(checked + non_finite + format_only, cases.len());
}
