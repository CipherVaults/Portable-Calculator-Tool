//! calc-core: the Standard / Scientific key machine, the expression parser
//! and evaluator, and the Programmer engine.
//!
//! See `Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`, sections B6 and
//! B10.
//!
//! # Guarantees
//!
//! - **Pure and total.** No clock, locale or I/O, `#![forbid(unsafe_code)]`,
//!   and no input can panic.
//! - **Decimal only.** Every number is a [`calc_num::Dec`]; no floats.
//!
//! # Status (M0 skeleton)
//!
//! Implemented now: the shared vocabulary ([`Mode`], [`AngleUnit`]), the
//! expression tokenizer ([`token::tokenize`]) and the Programmer word sizes
//! ([`programmer::WordSize`]).
//!
//! Planned surface (M5b, M5c, M6), reached through `pcalc-api`:
//!
//! | Op | Request -> response |
//! |---|---|
//! | `calc.press` | `{mode, angleUnit, state, key}` -> `{state, display, expression, memory, record?}` |
//! | `calc.eval` | `{expr, angleUnit, mode}` -> `{display, value}` (history restore) |
//! | `prog.press` | `{wordSize, base, signed, state, key}` -> `{state, hex, dec, oct, bin, record?}` |
//! | `prog.eval` | `{expr, wordSize, base, signed, carryIn}` -> the same views |
#![forbid(unsafe_code)]

pub mod programmer;
pub mod token;

use serde::{Deserialize, Serialize};

/// Engine version; equal to the crate version (asserted by a test).
pub const ENGINE_VERSION: &str = "0.1.0";

/// Largest number of tokens in one expression (history `expr` cap, B10).
pub const MAX_EXPR_TOKENS: usize = 256;

/// Largest expression text accepted by the tokenizer, in bytes.
pub const MAX_EXPR_BYTES: usize = 4096;

/// Calculator mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Immediate execution (`2+3x4=` gives 20), Windows `%` rules.
    Standard,
    /// Operator precedence and parentheses.
    Scientific,
}

/// Angle unit for trigonometric functions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AngleUnit {
    /// Degrees (the default, as in the Windows Calculator).
    #[default]
    Deg,
    /// Radians.
    Rad,
    /// Gradians.
    Grad,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_version_matches_crate_version() {
        assert_eq!(ENGINE_VERSION, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn vocabulary_serializes_in_camel_case() {
        assert_eq!(
            serde_json::to_string(&Mode::Scientific).unwrap(),
            "\"scientific\""
        );
        assert_eq!(serde_json::to_string(&AngleUnit::Grad).unwrap(), "\"grad\"");
        assert!(serde_json::from_str::<AngleUnit>("\"turns\"").is_err());
        assert_eq!(AngleUnit::default(), AngleUnit::Deg);
    }
}
