//! [`Dec`]: sign, base-10^9 limbs, decimal exponent.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::{NumError, NumErrorCode};
use crate::{MAX_EXPONENT, MAX_INPUT_BYTES, PRECISION_DIGITS};

/// The limb base, 10^9 (each `u32` limb holds nine decimal digits).
pub const LIMB_BASE: u32 = 1_000_000_000;

/// Decimal digits per limb.
pub const LIMB_DIGITS: u32 = 9;

/// A decimal value `(-1)^neg * coefficient * 10^exp`.
///
/// Invariants (kept by every constructor, so derived equality is value
/// equality):
/// - `limbs` is the coefficient in base 10^9, least significant limb first,
///   with no zero limb at the most significant end;
/// - the coefficient has no trailing decimal zero (they are moved into
///   `exp`), and at most [`PRECISION_DIGITS`] digits;
/// - zero is `limbs == []`, `neg == false`, `exp == 0` (there is no -0).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct Dec {
    neg: bool,
    limbs: Vec<u32>,
    exp: i32,
}

fn invalid() -> NumError {
    NumError::new(NumErrorCode::InvalidInput)
}

impl Dec {
    /// Zero.
    pub fn zero() -> Self {
        Dec::default()
    }

    /// The exact value of an integer.
    pub fn from_i64(n: i64) -> Self {
        let digits = n.unsigned_abs().to_string();
        // An i64 has at most 19 digits, well inside every limit.
        Self::from_digits(n < 0, digits.as_bytes(), 0).unwrap_or_default()
    }

    /// Parses `[+-]digits[.digits][(e|E)[+-]digits]` (ASCII, no spaces, at
    /// most [`MAX_INPUT_BYTES`] bytes and [`PRECISION_DIGITS`] significant
    /// digits). Rounding of longer inputs arrives with the arithmetic (M5a).
    pub fn parse(text: &str) -> Result<Self, NumError> {
        let bytes = text.as_bytes();
        if bytes.is_empty() || bytes.len() > MAX_INPUT_BYTES {
            return Err(invalid());
        }
        let (neg, rest) = match bytes[0] {
            b'-' => (true, &bytes[1..]),
            b'+' => (false, &bytes[1..]),
            _ => (false, bytes),
        };
        let (mantissa, exp_part) = match rest.iter().position(|&b| b == b'e' || b == b'E') {
            Some(i) => (&rest[..i], Some(&rest[i + 1..])),
            None => (rest, None),
        };

        let mut digits: Vec<u8> = Vec::with_capacity(mantissa.len());
        let mut frac_len: i64 = 0;
        let mut seen_point = false;
        for &b in mantissa {
            match b {
                b'0'..=b'9' => {
                    digits.push(b);
                    if seen_point {
                        frac_len += 1;
                    }
                }
                b'.' if !seen_point => seen_point = true,
                _ => return Err(invalid()),
            }
        }
        if digits.is_empty() {
            return Err(invalid());
        }

        let exp_value: i64 = match exp_part {
            None => 0,
            Some(e) => {
                let (eneg, edigits) = match e.first() {
                    Some(b'-') => (true, &e[1..]),
                    Some(b'+') => (false, &e[1..]),
                    _ => (false, e),
                };
                // Five digits bound the loop and any exponent that can matter.
                if edigits.is_empty() || edigits.len() > 5 {
                    return Err(invalid());
                }
                let mut v: i64 = 0;
                for &b in edigits {
                    if !b.is_ascii_digit() {
                        return Err(invalid());
                    }
                    v = v * 10 + i64::from(b - b'0');
                }
                if eneg {
                    -v
                } else {
                    v
                }
            }
        };

        let exp = exp_value - frac_len;
        Self::from_digits_i64(neg, &digits, exp)
    }

    /// Builds a value from ASCII digits and a power-of-ten exponent.
    fn from_digits(neg: bool, digits: &[u8], exp: i32) -> Result<Self, NumError> {
        Self::from_digits_i64(neg, digits, i64::from(exp))
    }

    fn from_digits_i64(neg: bool, digits: &[u8], mut exp: i64) -> Result<Self, NumError> {
        let start = digits
            .iter()
            .position(|&d| d != b'0')
            .unwrap_or(digits.len());
        let mut sig = &digits[start..];
        if sig.is_empty() {
            return Ok(Dec::zero());
        }
        let trailing = sig.iter().rev().take_while(|&&d| d == b'0').count();
        sig = &sig[..sig.len() - trailing];
        exp += trailing as i64;
        if sig.len() > PRECISION_DIGITS {
            return Err(invalid());
        }
        let adjusted = exp + sig.len() as i64 - 1;
        if adjusted.abs() > i64::from(MAX_EXPONENT) {
            return Err(NumError::new(NumErrorCode::Overflow));
        }

        let mut limbs = Vec::with_capacity(sig.len().div_ceil(LIMB_DIGITS as usize));
        let mut end = sig.len();
        while end > 0 {
            let begin = end.saturating_sub(LIMB_DIGITS as usize);
            let limb = sig[begin..end]
                .iter()
                .fold(0u32, |acc, &d| acc * 10 + u32::from(d - b'0'));
            limbs.push(limb);
            end = begin;
        }
        Ok(Dec {
            neg,
            limbs,
            // |exp| <= MAX_EXPONENT + PRECISION_DIGITS, far inside i32.
            exp: exp as i32,
        })
    }

    /// `true` for zero.
    pub fn is_zero(&self) -> bool {
        self.limbs.is_empty()
    }

    /// `true` for values below zero.
    pub fn is_negative(&self) -> bool {
        self.neg
    }

    /// The coefficient's decimal digits, most significant first (`"0"` for
    /// zero).
    pub fn coefficient_digits(&self) -> String {
        let mut out = String::with_capacity(self.limbs.len() * LIMB_DIGITS as usize);
        let mut iter = self.limbs.iter().rev();
        match iter.next() {
            None => return "0".to_string(),
            Some(top) => out.push_str(&top.to_string()),
        }
        for limb in iter {
            out.push_str(&format!("{limb:09}"));
        }
        out
    }

    /// Number of significant digits (0 for zero).
    pub fn significant_digits(&self) -> usize {
        if self.is_zero() {
            0
        } else {
            self.coefficient_digits().len()
        }
    }

    /// The exponent of the leading digit (scientific-notation exponent);
    /// 0 for zero.
    pub fn adjusted_exponent(&self) -> i32 {
        if self.is_zero() {
            0
        } else {
            self.exp + self.significant_digits() as i32 - 1
        }
    }

    /// The canonical text: plain notation when the leading digit's exponent
    /// is in -7..16 (`"1200"`, `"-0.0015"`), otherwise scientific
    /// (`"1.5e+20"`, `"-2e-9"`). [`Dec::parse`] reads it back exactly. This
    /// is the storage form used in history `expr` tokens; the display format
    /// (grouping, digit limits) is a separate, later function.
    pub fn to_canonical(&self) -> String {
        if self.is_zero() {
            return "0".to_string();
        }
        let digits = self.coefficient_digits();
        let n = digits.len() as i64;
        let exp = i64::from(self.exp);
        let adjusted = exp + n - 1;
        let mut out = String::new();
        if self.neg {
            out.push('-');
        }
        if (-7..16).contains(&adjusted) {
            if exp >= 0 {
                out.push_str(&digits);
                out.extend(std::iter::repeat_n('0', exp as usize));
            } else {
                let point = n + exp;
                if point <= 0 {
                    out.push_str("0.");
                    out.extend(std::iter::repeat_n('0', (-point) as usize));
                    out.push_str(&digits);
                } else {
                    let (int, frac) = digits.split_at(point as usize);
                    out.push_str(int);
                    out.push('.');
                    out.push_str(frac);
                }
            }
        } else {
            let (first, rest) = digits.split_at(1);
            out.push_str(first);
            if !rest.is_empty() {
                out.push('.');
                out.push_str(rest);
            }
            out.push('e');
            out.push(if adjusted < 0 { '-' } else { '+' });
            out.push_str(&adjusted.unsigned_abs().to_string());
        }
        out
    }
}

impl core::fmt::Display for Dec {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.to_canonical())
    }
}

impl Serialize for Dec {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_canonical())
    }
}

impl<'de> Deserialize<'de> for Dec {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        Dec::parse(&text).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canon(s: &str) -> String {
        Dec::parse(s)
            .map(|d| d.to_canonical())
            .unwrap_or_else(|e| format!("ERR {:?}", e.code))
    }

    #[test]
    fn parses_and_canonicalises() {
        for (input, want) in [
            ("0", "0"),
            ("-0", "0"),
            ("000.000", "0"),
            ("1", "1"),
            ("+1", "1"),
            ("1200", "1200"),
            ("1.2e3", "1200"),
            ("0.5", "0.5"),
            (".5", "0.5"),
            ("5.", "5"),
            ("-0.0015", "-0.0015"),
            ("1e-7", "0.0000001"),
            ("1e-8", "1e-8"),
            ("1.5e-7", "0.00000015"),
            ("0.0000001", "0.0000001"),
            ("0.000001", "0.000001"),
            ("9999999999999999", "9999999999999999"),
            ("10000000000000000", "1e+16"),
            ("1.5e20", "1.5e+20"),
            ("123456789.123456789", "123456789.123456789"),
            (
                "1234567890123456789012345678901234",
                "1.234567890123456789012345678901234e+33",
            ),
            ("1e9999", "1e+9999"),
            ("1e-9999", "1e-9999"),
        ] {
            assert_eq!(canon(input), want, "input {input:?}");
        }
    }

    #[test]
    fn canonical_text_round_trips() {
        for input in [
            "0",
            "1",
            "-42",
            "3.14159",
            "1e-7",
            "-6.02214076e+23",
            "0.000001",
        ] {
            let d = Dec::parse(input).unwrap();
            assert_eq!(Dec::parse(&d.to_canonical()).unwrap(), d);
        }
    }

    #[test]
    fn rejects_bad_text_without_panicking() {
        for input in [
            "", "-", "+", ".", "e5", "1e", "1e+", "1..2", "1.2.3", "1,5", " 1", "1 ", "0x10",
            "NaN", "Infinity", "\u{0661}", "1e123456", "--1",
        ] {
            assert_eq!(
                Dec::parse(input).map_err(|e| e.code),
                Err(NumErrorCode::InvalidInput),
                "input {input:?}"
            );
        }
        let long = "1".repeat(MAX_INPUT_BYTES + 1);
        assert!(Dec::parse(&long).is_err());
        // 35 significant digits: rounding is M5a, so it is refused for now.
        assert!(Dec::parse(&"1".repeat(35)).is_err());
    }

    #[test]
    fn exponent_limits_overflow() {
        assert_eq!(
            Dec::parse("1e10000").map_err(|e| e.code),
            Err(NumErrorCode::Overflow)
        );
        assert_eq!(
            Dec::parse("1e-10000").map_err(|e| e.code),
            Err(NumErrorCode::Overflow)
        );
        // Trailing zeros move into the exponent before the check.
        assert!(Dec::parse("10e9998").is_ok());
        assert!(Dec::parse("100e9998").is_err());
    }

    #[test]
    fn integers_are_exact_including_extremes() {
        assert_eq!(Dec::from_i64(0), Dec::zero());
        assert_eq!(Dec::from_i64(-1200).to_canonical(), "-1200");
        assert_eq!(
            Dec::from_i64(i64::MIN).to_canonical(),
            "-9.223372036854775808e+18"
        );
        assert_eq!(Dec::from_i64(1200), Dec::parse("1.2e3").unwrap());
        assert_eq!(Dec::from_i64(1200).adjusted_exponent(), 3);
        assert_eq!(Dec::from_i64(1200).significant_digits(), 2);
    }

    #[test]
    fn serde_uses_the_canonical_string() {
        let d = Dec::parse("-2.50").unwrap();
        assert_eq!(serde_json::to_string(&d).unwrap(), "\"-2.5\"");
        let back: Dec = serde_json::from_str("\"1.2e3\"").unwrap();
        assert_eq!(back, Dec::from_i64(1200));
        assert!(serde_json::from_str::<Dec>("\"abc\"").is_err());
        assert!(serde_json::from_str::<Dec>("12").is_err());
    }
}
