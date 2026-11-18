//! The result envelope and the API-level errors.

use serde::Serialize;

/// An API-level error, serialized exactly like date-core's `CoreError`:
/// `{"code":"…","field":"…"|null,"message":"…"}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ApiError {
    /// Stable snake_case code.
    pub code: &'static str,
    /// The camelCase request field at fault, or `null`.
    pub field: Option<&'static str>,
    /// English fallback message (the UI shows catalog text by `code`).
    pub message: &'static str,
}

/// `{"ok":"false","error":{...}}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ErrorEnvelope {
    ok: &'static str,
    /// The error.
    pub error: ApiError,
}

/// `{"ok":"true","result":{...}}`.
#[derive(Serialize)]
pub(crate) struct OkEnvelope<T> {
    ok: &'static str,
    result: T,
}

/// Last-resort output if serialization ever failed (it cannot for these
/// types, but the API never panics).
pub(crate) const INTERNAL_JSON: &str =
    r#"{"ok":"false","error":{"code":"internal","field":null,"message":"Internal error."}}"#;

impl ApiError {
    /// The op name is not in the closed list.
    pub const UNKNOWN_OP: ApiError = ApiError {
        code: "unknown_op",
        field: None,
        message: "Unknown operation.",
    };

    /// The raw request is longer than the op's cap.
    pub const REQUEST_TOO_LARGE: ApiError = ApiError {
        code: "request_too_large",
        field: None,
        message: "Request is too large.",
    };

    /// Invalid UTF-8, malformed JSON, wrong shape or unknown field. Same
    /// bytes as date-core's `invalid_request`.
    pub const INVALID_REQUEST: ApiError = ApiError {
        code: "invalid_request",
        field: None,
        message: "Invalid request.",
    };

    /// The `{"ok":"false","error":…}` JSON for this error.
    pub fn to_json(self) -> String {
        serde_json::to_string(&ErrorEnvelope {
            ok: "false",
            error: self,
        })
        .unwrap_or_else(|_| INTERNAL_JSON.to_string())
    }
}

/// The `{"ok":"true","result":…}` JSON for `result`.
pub(crate) fn ok_json<T: Serialize>(result: T) -> String {
    serde_json::to_string(&OkEnvelope { ok: "true", result })
        .unwrap_or_else(|_| INTERNAL_JSON.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes_match_date_core_shape() {
        assert_eq!(
            ApiError::INVALID_REQUEST.to_json(),
            serde_json::to_string(&date_core::Outcome::<()>::Err {
                error: date_core::CoreError::invalid_request()
            })
            .unwrap()
        );
        assert_eq!(ok_json(5), r#"{"ok":"true","result":5}"#);
        assert!(serde_json::from_str::<serde_json::Value>(INTERNAL_JSON).is_ok());
    }
}
