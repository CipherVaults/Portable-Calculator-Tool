//! pcalc-api: the single engine API of Portable Calculator Tool.
//!
//! Every surface — the Tauri command `engine_call`, the `pcalc-wasm` raw ABI
//! and the NDJSON bridge — calls [`call`] (or [`call_bytes`]) and gets the
//! same bytes back. See `Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`,
//! sections B1 and B2.
//!
//! # Envelope
//!
//! date-core's envelope everywhere: `{"ok":"true","result":{...}}` or
//! `{"ok":"false","error":{"code":"…","field":…,"message":"…"}}`.
//!
//! # Order of checks
//!
//! 1. The op name is looked up in the closed [`Op`] list; anything else
//!    (including invalid UTF-8 or more than [`MAX_OP_BYTES`]) is
//!    `unknown_op`.
//! 2. The raw request length is checked against the op's cap
//!    ([`Op::request_cap`]) **before any parsing**; over the cap is
//!    `request_too_large` (storage treats it as "cannot validate", never as
//!    corrupt).
//! 3. Invalid UTF-8, malformed JSON, a wrong shape or an unknown field is
//!    `invalid_request`.
//!
//! # Ops (M0)
//!
//! | Op | Engine |
//! |---|---|
//! | `meta.versions` | `{api, app, engines}` |
//! | `date.days_between`, `date.add_subtract`, `date.business_days`, `date.age`, `date.date_info`, `date.countdown`, `date.holidays_in_range`, `date.month_grid`, `date.validate_calendar` | `date_core::api` (byte-identical to the Date app) |
//! | `percent.change`, `percent.percent`, `percent.what`, `percent.discount`, `percent.base`, `percent.markup`, `percent.tax`, `percent.tip` | `percent_core`, normalised to the envelope |
//!
//! The calculator, converter, graph, store-validation ops arrive with their
//! milestones; until then they are `unknown_op`.
//!
//! # Guarantees
//!
//! Pure and total: `#![forbid(unsafe_code)]`, no clock, locale or I/O, and
//! no input can panic (every failure is an envelope).
#![forbid(unsafe_code)]

mod date;
mod envelope;
mod meta;
mod op;
mod percent;

pub use envelope::{ApiError, ErrorEnvelope};
pub use op::{Op, PercentOp};

/// Version of the `call` contract (ops, envelope, caps). Reported by
/// `meta.versions` as `api`.
pub const API_VERSION: u32 = 1;

/// The app version (this crate's version, locked to `tauri.conf.json` and
/// the web build by `scripts/check-versions.mjs`).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Longest op name accepted, in bytes.
pub const MAX_OP_BYTES: usize = 64;

/// Cap for calculator, programmer, date, percent, units, graph and meta ops.
pub const CAP_ENGINE: usize = 64 * 1024;

/// Cap for `settings.validate`, `state.validate`, `countdowns.validate`.
pub const CAP_STORE: usize = 256 * 1024;

/// Cap for `history.validate` (the 4 MiB store cap plus headroom).
pub const CAP_HISTORY_VALIDATE: usize = 4 * 1024 * 1024 + 512 * 1024;

/// Cap for `history.import_preview`.
pub const CAP_IMPORT: usize = 8 * 1024 * 1024;

/// The largest request any op can accept (the WASM input buffer limit).
pub const MAX_REQUEST_BYTES: usize = CAP_IMPORT;

/// Runs `op` on the JSON request text `req` and returns the envelope JSON.
pub fn call(op: &str, req: &str) -> String {
    call_bytes(op.as_bytes(), req.as_bytes())
}

/// [`call`] on raw bytes (the WASM ABI path): invalid UTF-8 in `op` is
/// `unknown_op`, in `req` it is `invalid_request`.
pub fn call_bytes(op: &[u8], req: &[u8]) -> String {
    let Some(op) = Op::parse_bytes(op) else {
        return ApiError::UNKNOWN_OP.to_json();
    };
    if req.len() > op.request_cap() {
        return ApiError::REQUEST_TOO_LARGE.to_json();
    }
    let Ok(req) = std::str::from_utf8(req) else {
        return ApiError::INVALID_REQUEST.to_json();
    };
    match op {
        Op::MetaVersions => meta::versions(req),
        Op::Date(date_op) => date::run(date_op, req),
        Op::Percent(percent_op) => percent::run(percent_op, req),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAYS: &str = r#"{"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":false}"#;

    fn padded(len: usize) -> String {
        // JSON allows trailing whitespace, so padding keeps the request valid.
        let mut s = DAYS.to_string();
        s.push_str(&" ".repeat(len - DAYS.len()));
        s
    }

    #[test]
    fn unknown_ops_are_refused_before_anything_else() {
        let unknown = r#"{"ok":"false","error":{"code":"unknown_op","field":null,"message":"Unknown operation."}}"#;
        for op in [
            "",
            "date",
            "date.",
            "calc_days_between",
            "DATE.DAYS_BETWEEN",
            "date.days_between ",
            "calc.press",
            "legacy.preview",
        ] {
            assert_eq!(call(op, DAYS), unknown, "op {op:?}");
        }
        assert_eq!(call_bytes(b"date.\xFFage", b"{}"), unknown);
        assert_eq!(call(&"x".repeat(MAX_OP_BYTES + 1), "{}"), unknown);
        // An unknown op with an oversized request is still unknown_op.
        assert_eq!(call("nope", &" ".repeat(CAP_ENGINE + 1)), unknown);
    }

    #[test]
    fn request_cap_is_exact_and_checked_before_parsing() {
        let ok = call("date.days_between", &padded(CAP_ENGINE));
        assert!(
            ok.starts_with(r#"{"ok":"true","result":{"startDate":"2024-01-01""#),
            "{ok}"
        );
        let too_large = r#"{"ok":"false","error":{"code":"request_too_large","field":null,"message":"Request is too large."}}"#;
        assert_eq!(
            call("date.days_between", &padded(CAP_ENGINE + 1)),
            too_large
        );
        // Not even valid UTF-8 or JSON is looked at past the cap.
        assert_eq!(
            call_bytes(b"percent.change", &vec![0xFF; CAP_ENGINE + 1]),
            too_large
        );
        assert_eq!(
            call("meta.versions", &" ".repeat(CAP_ENGINE + 1)),
            too_large
        );
        for op in Op::ALL {
            assert_eq!(op.request_cap(), CAP_ENGINE, "{}", op.name());
        }
        const { assert!(CAP_ENGINE < CAP_STORE && CAP_STORE < CAP_HISTORY_VALIDATE) };
        const { assert!(CAP_HISTORY_VALIDATE < CAP_IMPORT && CAP_IMPORT == MAX_REQUEST_BYTES) };
        assert_eq!(CAP_HISTORY_VALIDATE, 4_718_592);
    }

    /// Plan B2: every op, at exactly its cap and at cap+1, with valid JSON
    /// padding, garbage and invalid UTF-8. At the cap the request is parsed
    /// (whatever it answers, it is never `request_too_large`); one byte more
    /// is `request_too_large` before anything is looked at.
    #[test]
    fn every_op_is_capped_at_exactly_its_cap() {
        let too_large = ApiError::REQUEST_TOO_LARGE.to_json();
        let invalid = ApiError::INVALID_REQUEST.to_json();
        for op in Op::ALL {
            let name = op.name();
            let cap = op.request_cap();
            let json = |len: usize| format!("{{}}{}", " ".repeat(len - 2));
            let at_cap = call(name, &json(cap));
            assert_ne!(at_cap, too_large, "{name} at cap");
            assert!(at_cap.starts_with(r#"{"ok":""#), "{name}: {at_cap}");
            assert_eq!(call(name, &json(cap + 1)), too_large, "{name} cap+1");
            assert_eq!(call(name, &json(cap - 1)), call(name, "{}"), "{name} cap-1");
            for byte in [b'x', 0xFF] {
                assert_eq!(
                    call_bytes(name.as_bytes(), &vec![byte; cap]),
                    invalid,
                    "{name} {byte}"
                );
                assert_eq!(
                    call_bytes(name.as_bytes(), &vec![byte; cap + 1]),
                    too_large,
                    "{name} {byte}"
                );
            }
        }
        // An unknown op stays unknown_op at every size, as on WASM.
        for len in [0, CAP_ENGINE, CAP_ENGINE + 1, MAX_REQUEST_BYTES + 1] {
            assert_eq!(
                call_bytes(b"history.validate", &vec![b' '; len]),
                ApiError::UNKNOWN_OP.to_json()
            );
        }
    }

    #[test]
    fn invalid_utf8_and_bad_json_are_invalid_request() {
        let invalid = r#"{"ok":"false","error":{"code":"invalid_request","field":null,"message":"Invalid request."}}"#;
        assert_eq!(
            call_bytes(b"date.age", b"{\"birthDate\":\"\xC3\x28\"}"),
            invalid
        );
        assert_eq!(call_bytes(b"percent.change", b"\xFF"), invalid);
        assert_eq!(call_bytes(b"meta.versions", b"\xFF"), invalid);
        for op in ["date.age", "percent.change", "meta.versions"] {
            for req in ["", "nul", "{", "[]", "42", "\"x\"", "{}{}"] {
                assert_eq!(call(op, req), invalid, "{op} {req:?}");
            }
        }
    }

    #[test]
    fn meta_versions_reports_api_app_and_every_engine() {
        let want = format!(
            r#"{{"ok":"true","result":{{"api":1,"app":"{APP_VERSION}","engines":{{"date-core":"1.0.0","percent-core":"2.3.0","calc-num":"0.1.0","calc-core":"0.1.0","units-core":"0.1.0","graph-core":"0.1.0"}}}}}}"#
        );
        assert_eq!(call("meta.versions", "{}"), want);
        assert_eq!(call("meta.versions", " { } \n"), want);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&call("meta.versions", r#"{"x":1}"#))
                .unwrap()["error"]["code"],
            "invalid_request"
        );
    }

    #[test]
    fn app_version_is_the_crate_version() {
        assert_eq!(APP_VERSION, "0.1.0");
    }
}
