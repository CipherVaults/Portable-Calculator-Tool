//! Strict input parsing (spec 1 §3, FROZEN §6).
//!
//! Parsers work on bytes and accept ASCII digits only, so fullwidth or
//! Arabic-Indic digits are always rejected here (the UI converts Arabic-Indic
//! digits before calling the core). Every path returns a [`CoreError`]; none
//! can panic.

use crate::civil::{days_from_civil, days_in_month, Civil, EpochDay, SPAN_DAYS};
use crate::error::{CoreError, Field};

/// Largest accepted magnitude for Years (spec 1 §3.3).
pub const MAX_YEARS: i64 = 9_999;
/// Largest accepted magnitude for Months (`9 999 x 12`).
pub const MAX_MONTHS: i64 = 119_988;
/// Largest accepted magnitude for Weeks (`floor(3 652 058 / 7)`).
pub const MAX_WEEKS: i64 = 521_722;
/// Largest accepted magnitude for Days (the full supported span).
pub const MAX_DAYS: i64 = SPAN_DAYS;
/// Most digits an amount may have after its sign, leading zeros included
/// (FROZEN §6). This matches the history validator `^[+-]?\d{1,15}$`
/// (critique correction 7), so any accepted raw input can be stored as is.
pub const MAX_AMOUNT_DIGITS: usize = 15;
/// Largest accepted UTC offset magnitude in minutes (UTC-18:00..=UTC+18:00).
pub const MAX_UTC_OFFSET_MINUTES: i64 = 1_080;

/// Strips only U+0020, U+0009, U+000A and U+000D from both ends. Never
/// `str::trim`, whose Unicode whitespace set differs from the JS mirror's.
pub fn trim_ascii_ws(s: &str) -> &str {
    s.trim_matches(|c| matches!(c, ' ' | '\t' | '\n' | '\r'))
}

/// Value of a run of ASCII digits (the caller guarantees digits only and at
/// most 15 of them, so the result cannot overflow).
fn digits_value(bytes: &[u8]) -> i64 {
    bytes
        .iter()
        .fold(0_i64, |acc, b| acc * 10 + i64::from(b - b'0'))
}

/// Parses a strict `YYYY-MM-DD` date in 0001-01-01..=9999-12-31.
///
/// Order of checks (the first failure wins): blank -> `missing_date`; not
/// exactly 10 bytes of `dddd-dd-dd` -> `invalid_date_format`; year 0000 ->
/// `date_out_of_range`; month -> `invalid_month`; day -> `invalid_day`.
pub fn parse_date(raw: &str, field: Field) -> Result<EpochDay, CoreError> {
    let s = trim_ascii_ws(raw);
    if s.is_empty() {
        return Err(CoreError::missing_date(field));
    }
    let b = s.as_bytes();
    let shape_ok = b.len() == 10
        && b.iter().enumerate().all(|(i, &ch)| match i {
            4 | 7 => ch == b'-',
            _ => ch.is_ascii_digit(),
        });
    if !shape_ok {
        return Err(CoreError::invalid_date_format(field));
    }
    let year = digits_value(&b[0..4]);
    // Two ASCII digits, so 0..=99 and the casts are lossless.
    let month = digits_value(&b[5..7]) as u32;
    let day = digits_value(&b[8..10]) as u32;
    if year == 0 {
        return Err(CoreError::date_out_of_range(field));
    }
    if !(1..=12).contains(&month) {
        return Err(CoreError::invalid_month(field));
    }
    let dim = days_in_month(year, month);
    if day < 1 || day > dim {
        return Err(CoreError::invalid_day(field, year, month, dim));
    }
    Ok(days_from_civil(Civil::new(year, month, day)))
}

/// The per-field maximum magnitude for [`parse_amount`]. Non-amount fields
/// fall back to the Days maximum.
pub const fn amount_max(field: Field) -> i64 {
    match field {
        Field::Years => MAX_YEARS,
        Field::Months => MAX_MONTHS,
        Field::Weeks => MAX_WEEKS,
        _ => MAX_DAYS,
    }
}

/// Parses a signed whole-number amount (`^[+-]?[0-9]+$`).
///
/// Blank means 0. More than 15 digits after the sign (leading zeros count,
/// per FROZEN §6, which overrides spec 1 §3.3's "significant digits") or a
/// magnitude above [`amount_max`] gives `amount_out_of_range`. `-0`
/// normalizes to `0`.
pub fn parse_amount(raw: &str, field: Field) -> Result<i64, CoreError> {
    let s = trim_ascii_ws(raw);
    if s.is_empty() {
        return Ok(0);
    }
    let (negative, digits) = match s.as_bytes() {
        [b'-', rest @ ..] => (true, rest),
        [b'+', rest @ ..] => (false, rest),
        all => (false, all),
    };
    if digits.is_empty() || !digits.iter().all(u8::is_ascii_digit) {
        return Err(CoreError::invalid_amount(field));
    }
    let max = amount_max(field);
    if digits.len() > MAX_AMOUNT_DIGITS {
        return Err(CoreError::amount_out_of_range(field, max));
    }
    let magnitude = digits_value(digits);
    if magnitude > max {
        return Err(CoreError::amount_out_of_range(field, max));
    }
    Ok(if negative { -magnitude } else { magnitude })
}

/// Parses a 24-hour `HH:MM` or `HH:MM:SS` time into seconds of the day.
///
/// Blank gives `missing_time` when `required`, else 00:00:00. `24:00` and leap
/// seconds are rejected.
pub fn parse_time(raw: &str, field: Field, required: bool) -> Result<u32, CoreError> {
    let s = trim_ascii_ws(raw);
    if s.is_empty() {
        return if required {
            Err(CoreError::missing_time(field))
        } else {
            Ok(0)
        };
    }
    let b = s.as_bytes();
    let shape_ok = (b.len() == 5 || b.len() == 8)
        && b.iter().enumerate().all(|(i, &ch)| match i {
            2 | 5 => ch == b':',
            _ => ch.is_ascii_digit(),
        });
    if !shape_ok {
        return Err(CoreError::invalid_time(field));
    }
    // Each component is two ASCII digits (0..=99), so the casts are lossless.
    let hh = digits_value(&b[0..2]) as u32;
    let mm = digits_value(&b[3..5]) as u32;
    let ss = if b.len() == 8 {
        digits_value(&b[6..8]) as u32
    } else {
        0
    };
    if hh > 23 || mm > 59 || ss > 59 {
        return Err(CoreError::invalid_time(field));
    }
    Ok(hh * 3600 + mm * 60 + ss)
}

/// Validates an east-positive UTC offset in minutes (-1080..=1080).
pub fn parse_utc_offset(minutes: i64, field: Field) -> Result<i64, CoreError> {
    if (-MAX_UTC_OFFSET_MINUTES..=MAX_UTC_OFFSET_MINUTES).contains(&minutes) {
        Ok(minutes)
    } else {
        Err(CoreError::invalid_utc_offset(field))
    }
}

/// Validates a weekend list of ISO weekdays (1 = Monday .. 7 = Sunday) and
/// returns it as a bitmask with bit `iso - 1` set for each weekend day.
///
/// Values outside 1..=7 or duplicates give `invalid_weekend`; all seven days
/// give `no_working_days`; an empty list (no weekend) is allowed.
pub fn parse_weekend(days: &[i64]) -> Result<u8, CoreError> {
    let mut mask = 0_u8;
    for &d in days {
        if !(1..=7).contains(&d) {
            return Err(CoreError::invalid_weekend());
        }
        let bit = 1_u8 << (d - 1);
        if mask & bit != 0 {
            return Err(CoreError::invalid_weekend());
        }
        mask |= bit;
    }
    if mask == 0x7F {
        return Err(CoreError::no_working_days());
    }
    Ok(mask)
}

/// Working days per week for a weekend bitmask (`7 - popcount`).
pub const fn workdays_per_week(mask: u8) -> u32 {
    7 - (mask & 0x7F).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn dates() {
        assert_eq!(parse_date(" 2025-01-01\t", Field::Date), Ok(20_089));
        assert_eq!(
            parse_date("2023-02-29", Field::StartDate).map_err(|e| e.message),
            Err("Start date is not a real date: February 2023 has 28 days.".to_string())
        );
        assert_eq!(
            parse_date("2025-1-05", Field::Date).map_err(|e| e.code),
            Err(ErrorCode::InvalidDateFormat)
        );
        assert_eq!(
            parse_date("\u{FEFF}2025-01-01", Field::Date).map_err(|e| e.code),
            Err(ErrorCode::InvalidDateFormat)
        );
    }

    #[test]
    fn amounts() {
        assert_eq!(parse_amount(" +007 ", Field::Years), Ok(7));
        assert_eq!(parse_amount("-0", Field::Years), Ok(0));
        // FROZEN §6: up to 15 digits after the sign, leading zeros included,
        // so every accepted input also passes the history validator
        // `^[+-]?\d{1,15}$`.
        assert_eq!(parse_amount("000000000000001", Field::Days), Ok(1));
        assert_eq!(parse_amount("-000000000000000", Field::Days), Ok(0));
        for raw in ["0000000000000001", "+0000000000000000", "-0000000000000007"] {
            assert_eq!(
                parse_amount(raw, Field::Days).map_err(|e| e.code),
                Err(ErrorCode::AmountOutOfRange),
                "{raw}"
            );
        }
        let huge_zero = format!("-{}", "0".repeat(100_000));
        assert_eq!(
            parse_amount(&huge_zero, Field::Days).map_err(|e| e.code),
            Err(ErrorCode::AmountOutOfRange)
        );
        assert_eq!(
            parse_amount("-", Field::Days).map_err(|e| e.code),
            Err(ErrorCode::InvalidAmount)
        );
        assert_eq!(
            parse_amount("99999999999999999999", Field::Days).map_err(|e| e.code),
            Err(ErrorCode::AmountOutOfRange)
        );
    }

    #[test]
    fn times_offsets_weekends() {
        assert_eq!(parse_time("23:59:59", Field::NowTime, true), Ok(86_399));
        assert_eq!(
            parse_time("", Field::NowTime, true).map_err(|e| e.code),
            Err(ErrorCode::MissingTime)
        );
        assert_eq!(
            parse_time("12:00:0", Field::NowTime, true).map_err(|e| e.code),
            Err(ErrorCode::InvalidTime)
        );
        assert!(parse_utc_offset(1081, Field::NowUtcOffset).is_err());
        assert_eq!(parse_weekend(&[7, 6]), Ok(0x60));
        assert_eq!(workdays_per_week(0x60), 5);
        assert!(parse_weekend(&[i64::MIN]).is_err());
    }
}
