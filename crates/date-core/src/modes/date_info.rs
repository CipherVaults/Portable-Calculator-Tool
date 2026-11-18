//! Mode 5, Day of Week / Date Info (spec 1 §7.5).

use serde::{Deserialize, Serialize};

use crate::civil::{
    civil_from_days, day_of_year, days_from_civil, days_in_month, days_in_year, is_leap_year,
    iso_week, iso_weekday, iso_weeks_in_year, quarter, Civil, JDN_OFFSET, SECONDS_PER_DAY,
};
use crate::error::{CoreError, Field};
use crate::format::{format_int, format_iso, format_long, month_name, plural, weekday_name};
use crate::parse::{parse_date, trim_ascii_ws};

/// Request: `{ "date", "today" }`. `today` is optional: null, omitted or
/// blank means "no relative text".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DateInfoRequest {
    /// The date to describe, `YYYY-MM-DD`.
    #[serde(default)]
    pub date: String,
    /// The UI's local today, `YYYY-MM-DD`.
    #[serde(default)]
    pub today: Option<String>,
}

/// Result, in the documented field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DateInfoResult {
    pub date: String,
    pub weekday: String,
    /// 1 = Monday .. 7 = Sunday.
    pub iso_weekday: u32,
    pub long_text: String,
    pub year: i64,
    pub month: u32,
    pub day: u32,
    pub month_name: String,
    pub day_of_year: u32,
    pub days_in_year: u32,
    /// Days after this date until Dec 31 (Dec 31 -> 0).
    pub days_remaining_in_year: u32,
    pub days_in_month: u32,
    /// Days after this date until the month's last day.
    pub days_remaining_in_month: u32,
    pub quarter: u32,
    pub is_leap_year: bool,
    pub iso_week_year: i64,
    pub iso_week: u32,
    /// Weeks in the ISO week-numbering year (52 or 53).
    pub iso_weeks_in_year: u32,
    /// `YYYY-Www-D`.
    pub iso_week_text: String,
    /// `YYYY-DDD`.
    pub ordinal_text: String,
    /// Unix day number (days since 1970-01-01).
    pub epoch_day: i64,
    /// `epochDay * 86400` (00:00 UTC).
    pub unix_timestamp: i64,
    /// `epochDay + 2440588` (JDN at noon UT).
    pub julian_day_number: i64,
    /// `date - today`, or `null` without `today`.
    pub days_from_today: Option<i64>,
    /// `Today` | `In {n days}` | `{n days} ago`, or `null`.
    pub relative_text: Option<String>,
    /// Same as `longText`.
    pub summary_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// Explains the Gregorian leap-year rule for `y`.
fn leap_reason(y: i64) -> String {
    if y.rem_euclid(400) == 0 {
        format!("{y} is divisible by 400, so it is a leap year")
    } else if y.rem_euclid(100) == 0 {
        format!("{y} is divisible by 100 but not by 400, so it is not a leap year")
    } else if y.rem_euclid(4) == 0 {
        format!("{y} is divisible by 4 and not by 100, so it is a leap year")
    } else {
        format!("{y} is not divisible by 4, so it is not a leap year")
    }
}

/// Describes a date: weekday, ISO week, ordinal, quarter, leap year, days
/// remaining, day numbers and (with `today`) a relative phrase.
pub fn calc_date_info(req: &DateInfoRequest) -> Result<DateInfoResult, CoreError> {
    let z = parse_date(&req.date, Field::Date)?;
    let today = match req.today.as_deref() {
        Some(raw) if !trim_ascii_ws(raw).is_empty() => Some(parse_date(raw, Field::Today)?),
        _ => None,
    };

    let Civil { year, month, day } = civil_from_days(z);
    let weekday_num = iso_weekday(z);
    let weekday = weekday_name(weekday_num).to_string();
    let doy = day_of_year(z);
    let diy = days_in_year(year);
    let dim = days_in_month(year, month);
    let leap = is_leap_year(year);
    let rem_year = diy.saturating_sub(doy);
    let rem_month = dim.saturating_sub(day);
    let iw = iso_week(z);
    let weeks_in_iso_year = iso_weeks_in_year(iw.year);
    let iso_week_text = format!("{:04}-W{:02}-{}", iw.year, iw.week, iw.weekday);
    let ordinal_text = format!("{year:04}-{doy:03}");
    let q = quarter(month);
    let unix_timestamp = z * SECONDS_PER_DAY;
    let jdn = z + JDN_OFFSET;
    let long_text = format_long(z);
    let iso = format_iso(z);

    let days_from_today = today.map(|t| z - t);
    let relative_text = days_from_today.map(|n| match n {
        0 => "Today".to_string(),
        n if n > 0 => format!("In {}", plural(n, "day")),
        n => format!("{} ago", plural(-n, "day")),
    });

    let jan1 = days_from_civil(Civil::new(year, 1, 1));
    let raw_week = (i64::from(doy) - i64::from(weekday_num) + 10).div_euclid(7);
    let mut trace_lines = vec![
        format!("{iso} = Unix day {}", format_int(z)),
        format!(
            "Weekday: ({} + 3) mod 7 + 1 = {weekday_num} ({weekday})",
            format_int(z)
        ),
        format!(
            "Day of year: {} - {} (Jan 1) + 1 = {doy} of {diy}",
            format_int(z),
            format_int(jan1)
        ),
        format!(
            "ISO week: floor(({doy} - {weekday_num} + 10) / 7) = {raw_week} -> {iso_week_text}"
        ),
        format!("Quarter: floor(({month} - 1) / 3) + 1 = Q{q}"),
        format!("Leap year: {}", leap_reason(year)),
        format!(
            "Days left: {diy} - {doy} = {} in the year, {dim} - {day} = {} in the month",
            rem_year, rem_month
        ),
        format!(
            "Julian Day Number: {} + 2,440,588 = {}",
            format_int(z),
            format_int(jdn)
        ),
    ];
    if let (Some(t), Some(n), Some(text)) = (today, days_from_today, &relative_text) {
        trace_lines.push(format!(
            "Relative: {iso} - {} = {} -> {text}",
            format_iso(t),
            format_int(n)
        ));
    }

    let mut copy = vec![
        long_text.clone(),
        format!("ISO date: {iso}"),
        format!("ISO week: {iso_week_text}"),
        format!("Ordinal date: {ordinal_text}"),
        format!(
            "Day of year: {doy} of {diy} ({} remaining)",
            plural(i64::from(rem_year), "day")
        ),
        format!("Quarter: Q{q}"),
        format!("Leap year: {}", if leap { "Yes" } else { "No" }),
        // Spec 1 §7.5 byte rule; `daysRemainingInMonth` stays out of copyText.
        format!("Days in month: {dim}"),
        format!("Unix day number: {z}"),
        format!("Unix timestamp (00:00 UTC): {unix_timestamp}"),
        format!("Julian Day Number: {jdn}"),
    ];
    if let Some(text) = &relative_text {
        copy.push(format!("Relative to today: {text}"));
    }

    Ok(DateInfoResult {
        date: iso,
        weekday,
        iso_weekday: weekday_num,
        summary_text: long_text.clone(),
        long_text,
        year,
        month,
        day,
        month_name: month_name(month).to_string(),
        day_of_year: doy,
        days_in_year: diy,
        days_remaining_in_year: rem_year,
        days_in_month: dim,
        days_remaining_in_month: rem_month,
        quarter: q,
        is_leap_year: leap,
        iso_week_year: iw.year,
        iso_week: iw.week,
        iso_weeks_in_year: weeks_in_iso_year,
        iso_week_text,
        ordinal_text,
        epoch_day: z,
        unix_timestamp,
        julian_day_number: jdn,
        days_from_today,
        relative_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vector I14's request: the copy text follows spec 1 §7.5 byte for byte.
    /// `daysRemainingInMonth` is a result field and a trace line only.
    #[test]
    fn copy_text_days_in_month_line() {
        let req = DateInfoRequest {
            date: "2026-11-16".to_string(),
            today: Some("2026-11-13".to_string()),
        };
        let r = calc_date_info(&req).expect("valid request");
        assert_eq!(r.days_remaining_in_month, 14);
        assert_eq!(
            r.copy_text,
            "Monday, November 16, 2026\n\
             ISO date: 2026-11-16\n\
             ISO week: 2026-W47-1\n\
             Ordinal date: 2026-320\n\
             Day of year: 320 of 365 (45 days remaining)\n\
             Quarter: Q4\n\
             Leap year: No\n\
             Days in month: 30\n\
             Unix day number: 20773\n\
             Unix timestamp (00:00 UTC): 1794787200\n\
             Julian Day Number: 2461361\n\
             Relative to today: In 3 days"
        );
    }
}
