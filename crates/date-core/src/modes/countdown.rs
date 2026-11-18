//! Mode 6, Live Countdown (spec 1 §7.6, FROZEN §7).
//!
//! The core is pure: the UI supplies "now" and, for each of the two instants,
//! the UTC offset in effect at that instant (`-getTimezoneOffset()` of a
//! local `Date` built with `setFullYear`, rounded). Converting both local
//! times to UTC seconds with their own offsets makes the difference correct
//! across DST transitions.

use serde::{Deserialize, Serialize};

use crate::civil::{EpochDay, SECONDS_PER_DAY};
use crate::error::{CoreError, Field};
use crate::format::{
    format_hms, format_int, format_iso, format_parts, format_utc_offset, plural, weekday_of,
};
use crate::parse::{parse_date, parse_time, parse_utc_offset};

/// A local date-time with its UTC offset: `{ "date", "time", "utcOffsetMinutes" }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Moment {
    /// `YYYY-MM-DD`.
    #[serde(default)]
    pub date: String,
    /// `HH:MM` or `HH:MM:SS` (required for `now`, optional for `target`).
    #[serde(default)]
    pub time: String,
    /// East-positive UTC offset in minutes (UTC+02:00 = 120), -1080..=1080.
    #[serde(default)]
    pub utc_offset_minutes: i64,
}

/// Request: `{ "now": Moment, "target": Moment }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CountdownRequest {
    /// The current local date-time.
    #[serde(default)]
    pub now: Moment,
    /// The target local date-time.
    #[serde(default)]
    pub target: Moment,
}

/// Whether the target is ahead, behind or exactly now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CountdownStatus {
    /// Target after now.
    Future,
    /// Target before now.
    Past,
    /// Target equals now.
    Now,
}

/// Result, in the documented field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountdownResult {
    pub now_date: String,
    /// Normalized `HH:MM:SS`.
    pub now_time: String,
    pub target_date: String,
    /// Normalized `HH:MM:SS`.
    pub target_time: String,
    pub target_weekday: String,
    pub status: CountdownStatus,
    /// `target - now` in seconds (signed).
    pub total_seconds: i64,
    pub days: i64,
    pub hours: i64,
    pub minutes: i64,
    pub seconds: i64,
    pub total_hours: i64,
    pub total_minutes: i64,
    /// `format_parts(days, hours, minutes, seconds)`.
    pub text: String,
    /// `{days with commas}d {HH}h {MM}m {SS}s`.
    pub clock_text: String,
    pub summary_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// UTC seconds since 1970-01-01 of a local date-time.
fn utc_seconds(day: EpochDay, secs: u32, offset_minutes: i64) -> i64 {
    day * SECONDS_PER_DAY + i64::from(secs) - offset_minutes * 60
}

/// Computes the signed time from `now` to `target`.
pub fn calc_countdown(req: &CountdownRequest) -> Result<CountdownResult, CoreError> {
    let now_day = parse_date(&req.now.date, Field::NowDate)?;
    let target_day = parse_date(&req.target.date, Field::TargetDate)?;
    let now_secs = parse_time(&req.now.time, Field::NowTime, true)?;
    let target_secs = parse_time(&req.target.time, Field::TargetTime, false)?;
    let now_off = parse_utc_offset(req.now.utc_offset_minutes, Field::NowUtcOffset)?;
    let target_off = parse_utc_offset(req.target.utc_offset_minutes, Field::TargetUtcOffset)?;

    let n = utc_seconds(now_day, now_secs, now_off);
    let t = utc_seconds(target_day, target_secs, target_off);
    let total_seconds = t - n;
    let status = match total_seconds.signum() {
        1 => CountdownStatus::Future,
        -1 => CountdownStatus::Past,
        _ => CountdownStatus::Now,
    };
    let a = total_seconds.abs();
    let days = a.div_euclid(SECONDS_PER_DAY);
    let hours = a.rem_euclid(SECONDS_PER_DAY) / 3_600;
    let minutes = a.rem_euclid(3_600) / 60;
    let seconds = a.rem_euclid(60);

    let text = format_parts(&[
        (days, "day"),
        (hours, "hour"),
        (minutes, "minute"),
        (seconds, "second"),
    ]);
    let clock_text = format!(
        "{}d {:02}h {:02}m {:02}s",
        format_int(days),
        hours,
        minutes,
        seconds
    );
    let now_iso = format_iso(now_day);
    let now_time = format_hms(now_secs);
    let target_iso = format_iso(target_day);
    let target_time = format_hms(target_secs);
    let target_weekday = weekday_of(target_day).to_string();
    let target_label = format!("{target_iso} {target_time} ({target_weekday})");
    let summary_text = match status {
        CountdownStatus::Future => format!("{text} until {target_label}"),
        CountdownStatus::Past => format!("{text} since {target_label}"),
        CountdownStatus::Now => format!("The target time is now: {target_label}"),
    };

    let trace_lines = vec![
        format!(
            "Now: {now_iso} {now_time} {} = {} s (Unix time)",
            format_utc_offset(now_off),
            format_int(n)
        ),
        format!(
            "Target: {target_iso} {target_time} {} = {} s (Unix time)",
            format_utc_offset(target_off),
            format_int(t)
        ),
        format!(
            "Target - now = {} - {} = {} s",
            format_int(t),
            format_int(n),
            format_int(total_seconds)
        ),
        format!(
            "{} s = {} x 86,400 + {} x 3,600 + {} x 60 + {}",
            format_int(a),
            format_int(days),
            hours,
            minutes,
            seconds
        ),
        format!("= {text}"),
    ];

    let copy_text = format!(
        "{summary_text}\nClock: {clock_text}\nTotal: {}",
        plural(a, "second")
    );

    Ok(CountdownResult {
        now_date: now_iso,
        now_time,
        target_date: target_iso,
        target_time,
        target_weekday,
        status,
        total_seconds,
        days,
        hours,
        minutes,
        seconds,
        total_hours: a / 3_600,
        total_minutes: a / 60,
        text,
        clock_text,
        summary_text,
        trace_lines,
        copy_text,
    })
}
