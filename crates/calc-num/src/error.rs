//! Calculator number errors (plan B6). The codes and English messages are
//! stable: the UI maps codes to catalog keys, and the messages are the
//! English fallback.

use serde::Serialize;

/// Stable snake_case error code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NumErrorCode {
    /// Division (or remainder) by zero.
    DivideByZero,
    /// A mathematically undefined result (0/0, ln 0, tan 90 deg ...).
    Undefined,
    /// Text that is not a number, or has too many digits.
    InvalidInput,
    /// |exponent| above `MAX_EXPONENT`.
    Overflow,
}

impl NumErrorCode {
    /// The English message (spec B6).
    pub const fn message(self) -> &'static str {
        match self {
            NumErrorCode::DivideByZero => "Cannot divide by zero",
            NumErrorCode::Undefined => "Result is undefined",
            NumErrorCode::InvalidInput => "Invalid input",
            NumErrorCode::Overflow => "Overflow",
        }
    }
}

/// A calc-num error: `{"code":"…","message":"…"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NumError {
    /// Stable code.
    pub code: NumErrorCode,
    /// English message for `code`.
    pub message: &'static str,
}

impl NumError {
    /// The error for `code`, with its message.
    pub const fn new(code: NumErrorCode) -> Self {
        NumError {
            code,
            message: code.message(),
        }
    }
}

impl core::fmt::Display for NumError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.message)
    }
}

impl std::error::Error for NumError {}
