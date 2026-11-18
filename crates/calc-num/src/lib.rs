//! calc-num: the decimal number type behind every Portable Calculator tool.
//!
//! See `Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`, section B6.
//!
//! # Guarantees
//!
//! - **No floats.** A [`Dec`] is a sign, base-10^9 `u32` limbs and a decimal
//!   exponent. Every operation is integer arithmetic, so native and WASM
//!   builds are bit-identical. Float arithmetic is denied by lint in this
//!   crate.
//! - **Pure and total.** No clock, locale or I/O, and no input can panic:
//!   every failure is a [`NumError`].
//! - **Bounded.** |exponent| <= [`MAX_EXPONENT`], at most
//!   [`PRECISION_DIGITS`] significant digits, and every loop is bounded by
//!   the input length or by those limits.
//!
//! # Status (M0 skeleton)
//!
//! Implemented now: parsing ([`Dec::parse`]), the canonical text form
//! ([`Dec::to_canonical`]), construction from integers, sign and zero
//! queries, exact comparison of canonical values.
//!
//! Planned surface (milestone M5a, with a 60-digit independent oracle):
//!
//! | Function | Meaning |
//! |---|---|
//! | `add`, `sub`, `mul`, `div` | exact, then rounded half-even to 34 significant digits |
//! | `rem`, `neg`, `abs`, `cmp` | exact |
//! | `round_sig(n)` | half-even rounding to `n` significant digits |
//! | `sqrt`, `pow`, `exp`, `ln`, `log10` | 44 working digits, faithful to 32 |
//! | `sin`, `cos`, `tan` (+ inverses, hyperbolics) | exact degree/gradian reduction (sin 180 deg = 0) |
//! | `factorial` | n! for integer n <= 3248 |
//! | `format(DisplayOptions)` | <= 32 digits, plain from 1e-7 to 1e16, grouping `,`, thin space or none |
#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

mod dec;
mod error;

pub use dec::{Dec, LIMB_BASE, LIMB_DIGITS};
pub use error::{NumError, NumErrorCode};

/// Engine version; equal to the crate version (asserted by a test).
pub const ENGINE_VERSION: &str = "0.1.0";

/// Significant digits kept by every arithmetic result.
pub const PRECISION_DIGITS: usize = 34;

/// Working digits for transcendental functions (guard digits included).
pub const WORKING_DIGITS: usize = 44;

/// Significant digits shown on the display.
pub const DISPLAY_DIGITS: usize = 32;

/// Largest |exponent| of a value (in scientific form); beyond it, `overflow`.
pub const MAX_EXPONENT: i32 = 9999;

/// Longest accepted number text, in bytes.
pub const MAX_INPUT_BYTES: usize = 128;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_version_matches_crate_version() {
        assert_eq!(ENGINE_VERSION, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn limits_are_consistent() {
        const { assert!(DISPLAY_DIGITS < PRECISION_DIGITS) };
        const { assert!(PRECISION_DIGITS < WORKING_DIGITS) };
        assert_eq!(10u32.pow(LIMB_DIGITS), LIMB_BASE);
    }
}
