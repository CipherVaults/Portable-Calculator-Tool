//! `date.*`: delegated unchanged to `date_core::api`.
//!
//! The request is parsed into a `serde_json::Value` first and then handed to
//! `date_core::api::call`, exactly as the Date Calculator's Tauri commands
//! and its NDJSON bridge do, so every response is byte-identical to the
//! Date app and to `crates/date-core/tests/fixtures/golden.json`.

use date_core::api::{self, Op};
use serde_json::Value;

use crate::envelope::{ApiError, INTERNAL_JSON};

pub(crate) fn run(op: Op, req: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(req) else {
        return ApiError::INVALID_REQUEST.to_json();
    };
    serde_json::to_string(&api::call(op, &value)).unwrap_or_else(|_| INTERNAL_JSON.to_string())
}

#[cfg(test)]
mod tests {
    use crate::call;

    #[test]
    fn delegates_with_date_core_semantics() {
        let res = call(
            "date.add_subtract",
            r#"{"date":"2024-01-31","operation":"add","months":"1"}"#,
        );
        let v: serde_json::Value = serde_json::from_str(&res).unwrap();
        assert_eq!(v["ok"], "true");
        assert_eq!(v["result"]["resultDate"], "2024-02-29");

        // date-core's own validation errors pass through untouched.
        let bad = call(
            "date.days_between",
            r#"{"startDate":"2024-02-30","endDate":"2024-03-01","includeEndDay":false}"#,
        );
        let v: serde_json::Value = serde_json::from_str(&bad).unwrap();
        assert_eq!(v["ok"], "false");
        assert_eq!(v["error"]["code"], "invalid_day");
        assert_eq!(v["error"]["field"], "startDate");

        // Unknown fields are refused by date-core's strict deserializer.
        let extra = call(
            "date.days_between",
            r#"{"startDate":"2024-01-01","endDate":"2024-01-02","includeEndDay":false,"x":1}"#,
        );
        assert!(extra.contains(r#""code":"invalid_request""#));
    }
}
