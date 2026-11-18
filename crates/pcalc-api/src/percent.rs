//! `percent.*`: percent-core wrapped in the envelope (plan B2).
//!
//! Requests are strict JSON objects of finite numbers (JSON has no NaN or
//! Infinity, and an out-of-range literal such as `1e400` is refused), named
//! as the Percentage Calculator's Tauri commands named them:
//!
//! | Op | Request | percent-core |
//! |---|---|---|
//! | `percent.change` | `{originalValue, newValue}` | `calculate_percentage_change` |
//! | `percent.percent` | `{part, total}` | `calculate_percentage_of_total` |
//! | `percent.what` | `{percent, number}` | `calculate_percentage_portion` |
//! | `percent.discount` | `{price, discountPercent}` | `calculate_discount` |
//! | `percent.base` | `{value, percent}` | `calculate_original_value` |
//! | `percent.markup` | `{cost, sellingPrice}` | `calculate_markup_margin` |
//! | `percent.tax` | `{amount, ratePercent, mode:"add"\|"extract"}` | `calculate_tax` |
//! | `percent.tip` | `{bill, tipPercent, people}` | `calculate_tip_split` |
//!
//! Normalisation: percent-core's flat `{"ok":"true",…}` results become
//! `{"ok":"true","result":{…}}` with the same fields in the same order
//! (DiscountResult's boolean `ok` is dropped: it is always `true`), and its
//! error strings become `{"code","field","message"}` with the original
//! English text as the message. A non-finite result number serializes as
//! `null`, exactly as percent-core's own JSON does.

use percent_core::{
    calculate_discount, calculate_markup_margin, calculate_original_value,
    calculate_percentage_change, calculate_percentage_of_total, calculate_percentage_portion,
    calculate_tax, calculate_tip_split, CalcResult, MarkupMarginResult, TaxMode, TaxResult,
    TipSplitResult,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::envelope::{ok_json, ApiError};
use crate::op::PercentOp;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ChangeReq {
    original_value: f64,
    new_value: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PercentReq {
    part: f64,
    total: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WhatReq {
    percent: f64,
    number: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DiscountReq {
    price: f64,
    discount_percent: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BaseReq {
    value: f64,
    percent: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MarkupReq {
    cost: f64,
    selling_price: f64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TaxReq {
    amount: f64,
    rate_percent: f64,
    /// Read as a plain string so only `"add"` / `"extract"` are accepted
    /// (no serde enum map forms).
    mode: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TipReq {
    bill: f64,
    tip_percent: f64,
    people: f64,
}

/// Parses a strict request object: JSON text, then an object (never serde's
/// positional array form), then the typed struct.
fn parse<T: DeserializeOwned>(req: &str) -> Option<T> {
    match serde_json::from_str::<Value>(req) {
        Ok(value @ Value::Object(_)) => serde_json::from_value(value).ok(),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Results (field order = percent-core's)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ValueOut {
    value: f64,
    label: String,
    live_result: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscountOut {
    final_price: f64,
    saved: f64,
    final_text: String,
    saved_text: String,
    label: String,
    copy_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkupOut {
    profit: f64,
    markup: f64,
    margin: f64,
    profit_text: String,
    markup_text: String,
    margin_text: String,
    label: String,
    live_result: String,
    copy_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaxOut {
    net: f64,
    tax: f64,
    total: f64,
    net_text: String,
    tax_text: String,
    total_text: String,
    label: String,
    live_result: String,
    copy_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TipOut {
    tip_amount: f64,
    total_bill: f64,
    per_person: f64,
    tip_text: String,
    total_text: String,
    per_person_text: String,
    label: String,
    live_result: String,
    copy_text: String,
}

/// Maps a percent-core error string to `{code, field, message}`.
fn error_json(message: &'static str) -> String {
    let (code, field) = match message {
        "Original value cannot be zero" => ("zero_divisor", Some("originalValue")),
        "Total cannot be zero" => ("zero_divisor", Some("total")),
        "Percent cannot be zero" => ("zero_divisor", Some("percent")),
        "Cost cannot be zero" => ("zero_divisor", Some("cost")),
        "Selling price cannot be zero" => ("zero_divisor", Some("sellingPrice")),
        "Tax rate cannot be -100%" => ("zero_divisor", Some("ratePercent")),
        "Bill amount cannot be negative" => ("negative_value", Some("bill")),
        "Tip % cannot be negative" => ("negative_value", Some("tipPercent")),
        "People must be a whole number (1 or more)" => ("invalid_people", Some("people")),
        _ => ("calc_error", None),
    };
    ApiError {
        code,
        field,
        message,
    }
    .to_json()
}

fn value_json(r: CalcResult) -> String {
    match r {
        CalcResult::Ok {
            value,
            label,
            live_result,
        } => ok_json(ValueOut {
            value,
            label,
            live_result,
        }),
        CalcResult::Err { error } => error_json(error),
    }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

pub(crate) fn run(op: PercentOp, req: &str) -> String {
    run_inner(op, req).unwrap_or_else(|| ApiError::INVALID_REQUEST.to_json())
}

fn run_inner(op: PercentOp, req: &str) -> Option<String> {
    Some(match op {
        PercentOp::Change => {
            let r: ChangeReq = parse(req)?;
            value_json(calculate_percentage_change(r.original_value, r.new_value))
        }
        PercentOp::Percent => {
            let r: PercentReq = parse(req)?;
            value_json(calculate_percentage_of_total(r.part, r.total))
        }
        PercentOp::What => {
            let r: WhatReq = parse(req)?;
            value_json(calculate_percentage_portion(r.percent, r.number))
        }
        PercentOp::Base => {
            let r: BaseReq = parse(req)?;
            value_json(calculate_original_value(r.value, r.percent))
        }
        PercentOp::Discount => {
            let r: DiscountReq = parse(req)?;
            let d = calculate_discount(r.price, r.discount_percent);
            ok_json(DiscountOut {
                final_price: d.final_price,
                saved: d.saved,
                final_text: d.final_text,
                saved_text: d.saved_text,
                label: d.label,
                copy_text: d.copy_text,
            })
        }
        PercentOp::Markup => {
            let r: MarkupReq = parse(req)?;
            match calculate_markup_margin(r.cost, r.selling_price) {
                MarkupMarginResult::Ok {
                    profit,
                    markup,
                    margin,
                    profit_text,
                    markup_text,
                    margin_text,
                    label,
                    live_result,
                    copy_text,
                } => ok_json(MarkupOut {
                    profit,
                    markup,
                    margin,
                    profit_text,
                    markup_text,
                    margin_text,
                    label,
                    live_result,
                    copy_text,
                }),
                MarkupMarginResult::Err { error } => error_json(error),
            }
        }
        PercentOp::Tax => {
            let r: TaxReq = parse(req)?;
            let mode = match r.mode.as_str() {
                "add" => TaxMode::Add,
                "extract" => TaxMode::Extract,
                _ => return None,
            };
            match calculate_tax(r.amount, r.rate_percent, mode) {
                TaxResult::Ok {
                    net,
                    tax,
                    total,
                    net_text,
                    tax_text,
                    total_text,
                    label,
                    live_result,
                    copy_text,
                } => ok_json(TaxOut {
                    net,
                    tax,
                    total,
                    net_text,
                    tax_text,
                    total_text,
                    label,
                    live_result,
                    copy_text,
                }),
                TaxResult::Err { error } => error_json(error),
            }
        }
        PercentOp::Tip => {
            let r: TipReq = parse(req)?;
            match calculate_tip_split(r.bill, r.tip_percent, r.people) {
                TipSplitResult::Ok {
                    tip_amount,
                    total_bill,
                    per_person,
                    tip_text,
                    total_text,
                    per_person_text,
                    label,
                    live_result,
                    copy_text,
                } => ok_json(TipOut {
                    tip_amount,
                    total_bill,
                    per_person,
                    tip_text,
                    total_text,
                    per_person_text,
                    label,
                    live_result,
                    copy_text,
                }),
                TipSplitResult::Err { error } => error_json(error),
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use crate::call;
    use serde_json::Value;

    fn v(op: &str, req: &str) -> Value {
        serde_json::from_str(&call(op, req)).unwrap()
    }

    #[test]
    fn results_are_wrapped_in_the_envelope() {
        assert_eq!(
            call("percent.change", r#"{"originalValue":150,"newValue":180}"#),
            r#"{"ok":"true","result":{"value":20.0,"label":"20.00% increase","liveResult":"20.00% increase"}}"#
        );
        assert_eq!(
            call(
                "percent.discount",
                r#"{"price":79.99,"discountPercent":20}"#
            ),
            r#"{"ok":"true","result":{"finalPrice":63.992,"saved":15.998,"finalText":"63.99","savedText":"16.00","label":"Final: 63.99<br>Saved: 16.00","copyText":"Final: 63.99\nSaved: 16.00"}}"#
        );
        assert_eq!(
            v("percent.percent", r#"{"part":50,"total":200}"#)["result"]["label"],
            "25.00%"
        );
        assert_eq!(
            v("percent.what", r#"{"percent":20,"number":500}"#)["result"]["value"],
            100.0
        );
        assert_eq!(
            v("percent.base", r#"{"value":50,"percent":25}"#)["result"]["label"],
            "200.00"
        );
        assert_eq!(
            v("percent.markup", r#"{"cost":80,"sellingPrice":100}"#)["result"]["marginText"],
            "20.00%"
        );
        assert_eq!(
            v(
                "percent.tax",
                r#"{"amount":115,"ratePercent":15,"mode":"extract"}"#
            )["result"]["netText"],
            "100.00"
        );
        assert_eq!(
            v("percent.tip", r#"{"bill":100,"tipPercent":20,"people":3}"#)["result"]["copyText"],
            "Each: 40.00\nTotal: 120.00 \u{00B7} Tip: 20.00"
        );
    }

    #[test]
    fn engine_errors_get_codes_and_fields() {
        for (op, req, code, field, message) in [
            (
                "percent.change",
                r#"{"originalValue":0,"newValue":1}"#,
                "zero_divisor",
                "originalValue",
                "Original value cannot be zero",
            ),
            (
                "percent.percent",
                r#"{"part":1,"total":0}"#,
                "zero_divisor",
                "total",
                "Total cannot be zero",
            ),
            (
                "percent.base",
                r#"{"value":1,"percent":0}"#,
                "zero_divisor",
                "percent",
                "Percent cannot be zero",
            ),
            (
                "percent.markup",
                r#"{"cost":0,"sellingPrice":1}"#,
                "zero_divisor",
                "cost",
                "Cost cannot be zero",
            ),
            (
                "percent.markup",
                r#"{"cost":1,"sellingPrice":0}"#,
                "zero_divisor",
                "sellingPrice",
                "Selling price cannot be zero",
            ),
            (
                "percent.tax",
                r#"{"amount":1,"ratePercent":-100,"mode":"extract"}"#,
                "zero_divisor",
                "ratePercent",
                "Tax rate cannot be -100%",
            ),
            (
                "percent.tip",
                r#"{"bill":-1,"tipPercent":1,"people":1}"#,
                "negative_value",
                "bill",
                "Bill amount cannot be negative",
            ),
            (
                "percent.tip",
                r#"{"bill":1,"tipPercent":-1,"people":1}"#,
                "negative_value",
                "tipPercent",
                "Tip % cannot be negative",
            ),
            (
                "percent.tip",
                r#"{"bill":1,"tipPercent":1,"people":1.5}"#,
                "invalid_people",
                "people",
                "People must be a whole number (1 or more)",
            ),
        ] {
            let res = v(op, req);
            assert_eq!(res["ok"], "false", "{op} {req}");
            assert_eq!(res["error"]["code"], code, "{op} {req}");
            assert_eq!(res["error"]["field"], field, "{op} {req}");
            assert_eq!(res["error"]["message"], message, "{op} {req}");
        }
    }

    #[test]
    fn requests_are_strict_finite_numbers() {
        for (op, req) in [
            (
                "percent.change",
                r#"{"originalValue":"150","newValue":180}"#,
            ),
            ("percent.change", r#"{"originalValue":150}"#),
            (
                "percent.change",
                r#"{"originalValue":150,"newValue":180,"x":0}"#,
            ),
            ("percent.change", r#"[150,180]"#),
            ("percent.change", r#"{"originalValue":1e400,"newValue":1}"#),
            ("percent.change", r#"{"originalValue":NaN,"newValue":1}"#),
            ("percent.change", r#"{"originalValue":null,"newValue":1}"#),
            (
                "percent.tax",
                r#"{"amount":1,"ratePercent":1,"mode":"Add"}"#,
            ),
            (
                "percent.tax",
                r#"{"amount":1,"ratePercent":1,"mode":{"add":null}}"#,
            ),
            ("percent.tip", r#"{"bill":1,"tipPercent":1,"people":"2"}"#),
        ] {
            assert_eq!(v(op, req)["error"]["code"], "invalid_request", "{op} {req}");
        }
    }

    #[test]
    fn float_inputs_round_trip_to_the_last_bit() {
        // percent.what with percent=100 returns (100/100)*number == number
        // exactly, so the parsed f64 is visible in the result.
        for text in [
            "0.1",
            "2.2250738585072014e-308",
            "2.2250738585072011e-308",
            "4.9406564584124654e-324",
            "1.7976931348623157e308",
            "9007199254740993",
            "0.30000000000000004",
            "123456789.12345678",
            "8.98846567431158e307",
            "1.00000000000000011102230246251565404236316680908203125",
        ] {
            let want: f64 = text.parse().unwrap();
            let res = v(
                "percent.what",
                &format!(r#"{{"percent":100,"number":{text}}}"#),
            );
            let got = res["result"]["value"].as_f64().unwrap();
            assert_eq!(got.to_bits(), want.to_bits(), "{text}");
        }
    }
}
