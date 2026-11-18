//! Byte-exact text formatting (spec 1 §4).
//!
//! Everything here is locale-free ASCII so the JS mirror can reproduce it
//! byte for byte: no `{:n}`, no `toLocaleString`, no `Intl`. All functions are
//! total (they never panic), including for dates outside the supported range,
//! which only ever appear as intermediates in trace lines.

use crate::civil::{civil_from_days, iso_weekday, Civil, EpochDay};

/// Weekday names in ISO order (index 0 = Monday).
pub const WEEKDAY_NAMES: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/// Month names (index 0 = January).
pub const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Name of an ISO weekday (1 = Monday .. 7 = Sunday). Out-of-range values wrap
/// modulo 7 so the function is total.
pub fn weekday_name(iso_weekday: u32) -> &'static str {
    let idx = (iso_weekday % 7 + 6) % 7;
    WEEKDAY_NAMES.get(idx as usize).copied().unwrap_or("")
}

/// Name of a month (1 = January .. 12 = December); `""` for anything else.
pub fn month_name(month: u32) -> &'static str {
    month
        .checked_sub(1)
        .and_then(|i| MONTH_NAMES.get(i as usize))
        .copied()
        .unwrap_or("")
}

/// Weekday name of a day number.
pub fn weekday_of(z: EpochDay) -> &'static str {
    weekday_name(iso_weekday(z))
}

/// Integer with ASCII `,` thousands separators and a leading `-` for
/// negatives: `0`, `999`, `1,000`, `-1,234,567`.
pub fn format_int(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let len = digits.len();
    let mut out = String::with_capacity(len + len / 3 + 1);
    if n < 0 {
        out.push('-');
    }
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (len - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    out
}

/// `YYYY-MM-DD` of a civil date. The year is zero-padded to at least 4 digits;
/// years outside 1..=9999 (trace intermediates only) print in full, with a
/// leading `-` for negative years.
pub fn format_civil_iso(c: Civil) -> String {
    let sign = if c.year < 0 { "-" } else { "" };
    format!(
        "{}{:04}-{:02}-{:02}",
        sign,
        c.year.unsigned_abs(),
        c.month,
        c.day
    )
}

/// `YYYY-MM-DD` of a day number (see [`format_civil_iso`]).
pub fn format_iso(z: EpochDay) -> String {
    format_civil_iso(civil_from_days(z))
}

/// `{Weekday}, {MonthName} {day}, {year}`, with day and year unpadded and no
/// separators: `Monday, January 1, 1`, `Friday, February 28, 2025`.
pub fn format_long(z: EpochDay) -> String {
    let c = civil_from_days(z);
    format!(
        "{}, {} {}, {}",
        weekday_of(z),
        month_name(c.month),
        c.day,
        c.year
    )
}

/// `HH:MM:SS` of a second-of-day (values >= 86 400 keep counting hours).
pub fn format_hms(secs: u32) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// `"{format_int(n)} {unit}"`, with the unit singular iff `n == 1`. Every unit
/// used by the engine forms its plural by appending `s`.
pub fn plural(n: i64, unit: &str) -> String {
    if n == 1 {
        format!("{} {}", format_int(n), unit)
    } else {
        format!("{} {}s", format_int(n), unit)
    }
}

/// Joins the non-zero parts with `", "`. If every part is zero, returns
/// `"0 {plural of the last unit}"` (for example `0 days`). An empty slice
/// yields an empty string.
pub fn format_parts(parts: &[(i64, &str)]) -> String {
    let joined = parts
        .iter()
        .filter(|(n, _)| *n != 0)
        .map(|(n, unit)| plural(*n, unit))
        .collect::<Vec<_>>()
        .join(", ");
    if !joined.is_empty() {
        return joined;
    }
    match parts.last() {
        Some((_, unit)) => plural(0, unit),
        None => String::new(),
    }
}

/// `UTC+HH:MM` / `UTC-HH:MM` for an east-positive offset in minutes.
pub fn format_utc_offset(minutes: i64) -> String {
    let sign = if minutes < 0 { '-' } else { '+' };
    let abs = minutes.unsigned_abs();
    format!("UTC{}{:02}:{:02}", sign, abs / 60, abs % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::civil::{MAX_EPOCH_DAY, MIN_EPOCH_DAY};

    #[test]
    fn format_int_groups_thousands() {
        assert_eq!(format_int(0), "0");
        assert_eq!(format_int(999), "999");
        assert_eq!(format_int(1000), "1,000");
        assert_eq!(format_int(-1_234_567), "-1,234,567");
        assert_eq!(format_int(315_537_897_600), "315,537,897,600");
        assert_eq!(format_int(i64::MIN), "-9,223,372,036,854,775,808");
        assert_eq!(format_int(i64::MAX), "9,223,372,036,854,775,807");
    }

    #[test]
    fn iso_and_long_forms() {
        assert_eq!(format_iso(MIN_EPOCH_DAY), "0001-01-01");
        assert_eq!(format_iso(MAX_EPOCH_DAY), "9999-12-31");
        assert_eq!(format_iso(MAX_EPOCH_DAY + 1), "10000-01-01");
        assert_eq!(format_iso(MIN_EPOCH_DAY - 1), "0000-12-31");
        assert_eq!(format_long(MIN_EPOCH_DAY), "Monday, January 1, 1");
        assert_eq!(format_long(20_147), "Friday, February 28, 2025");
    }

    #[test]
    fn plurals_and_parts() {
        assert_eq!(plural(0, "day"), "0 days");
        assert_eq!(plural(1, "day"), "1 day");
        assert_eq!(plural(2, "business day"), "2 business days");
        assert_eq!(
            format_parts(&[(0, "year"), (0, "month"), (0, "day")]),
            "0 days"
        );
        assert_eq!(
            format_parts(&[(1, "year"), (0, "month"), (3, "day")]),
            "1 year, 3 days"
        );
        assert_eq!(format_parts(&[]), "");
    }

    #[test]
    fn names_and_clock() {
        assert_eq!(weekday_name(1), "Monday");
        assert_eq!(weekday_name(7), "Sunday");
        assert_eq!(month_name(0), "");
        assert_eq!(month_name(13), "");
        assert_eq!(format_hms(0), "00:00:00");
        assert_eq!(format_hms(86_399), "23:59:59");
        assert_eq!(format_utc_offset(-300), "UTC-05:00");
        assert_eq!(format_utc_offset(330), "UTC+05:30");
        assert_eq!(format_utc_offset(0), "UTC+00:00");
    }
}
