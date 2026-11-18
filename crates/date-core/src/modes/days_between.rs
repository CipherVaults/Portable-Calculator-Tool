//! Mode 1, Days Between Two Dates (spec 1 §7.1, FROZEN §5).

use serde::{Deserialize, Serialize};

use super::walk_trace;
use crate::civil::{ymd_between, EpochDay, LeapDayRule, SECONDS_PER_DAY};
use crate::error::{CoreError, Field};
use crate::format::{format_int, format_iso, format_parts, plural, weekday_of};
use crate::parse::parse_date;

/// Request: `{ "startDate", "endDate", "includeEndDay" }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DaysBetweenRequest {
    /// Start date, `YYYY-MM-DD`.
    #[serde(default)]
    pub start_date: String,
    /// End date, `YYYY-MM-DD`; may be before the start date.
    #[serde(default)]
    pub end_date: String,
    /// Also count the later of the two dates (UI: "include the later date").
    #[serde(default)]
    pub include_end_day: bool,
}

/// Whether the end date is after, before or equal to the start date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    /// `start == end`.
    Same,
    /// `start < end`.
    Forward,
    /// `start > end`.
    Backward,
}

impl Direction {
    /// Direction from `a` to `b`.
    pub fn between(a: EpochDay, b: EpochDay) -> Self {
        match a.cmp(&b) {
            std::cmp::Ordering::Equal => Self::Same,
            std::cmp::Ordering::Less => Self::Forward,
            std::cmp::Ordering::Greater => Self::Backward,
        }
    }
}

/// Result, in the documented field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaysBetweenResult {
    pub start_date: String,
    pub end_date: String,
    pub include_end_day: bool,
    pub direction: Direction,
    /// Days in the counted interval `[lo, hiX)`; never negative.
    pub total_days: i64,
    /// `-total_days` when backward.
    pub signed_days: i64,
    pub years: i64,
    pub months: i64,
    pub days: i64,
    pub total_months: i64,
    pub weeks: i64,
    pub week_remainder_days: i64,
    pub total_hours: i64,
    pub total_minutes: i64,
    pub total_seconds: i64,
    pub start_weekday: String,
    pub end_weekday: String,
    /// `format_parts(years, months, days)`.
    pub breakdown_text: String,
    /// `format_parts(weeks, remainder days)`.
    pub weeks_text: String,
    /// `plural(total_days, day)`.
    pub summary_text: String,
    /// `{hi} - {lo}[ + 1] = {summary}`.
    pub formula_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// Counts the days between two dates.
///
/// The counted interval is `[lo, hiX)` with `hiX = hi + includeEndDay`: the
/// earlier date is always counted, the later one only when the toggle is on.
/// `hiX` may be 10000-01-01; it is only used as a day number.
pub fn calc_days_between(req: &DaysBetweenRequest) -> Result<DaysBetweenResult, CoreError> {
    let a = parse_date(&req.start_date, Field::StartDate)?;
    let b = parse_date(&req.end_date, Field::EndDate)?;
    let include = req.include_end_day;

    let direction = Direction::between(a, b);
    let (lo, hi) = (a.min(b), a.max(b));
    let hi_x = hi + i64::from(include);
    let total_days = hi_x - lo;
    let signed_days = if direction == Direction::Backward {
        -total_days
    } else {
        total_days
    };
    let ymd = ymd_between(lo, hi_x, LeapDayRule::Feb28);
    let weeks = total_days.div_euclid(7);
    let week_remainder_days = total_days.rem_euclid(7);
    let total_hours = total_days * 24;
    let total_minutes = total_days * 1_440;
    let total_seconds = total_days * SECONDS_PER_DAY;

    let start_iso = format_iso(a);
    let end_iso = format_iso(b);
    let start_weekday = weekday_of(a).to_string();
    let end_weekday = weekday_of(b).to_string();
    let breakdown_text = format_parts(&[
        (ymd.years, "year"),
        (ymd.months, "month"),
        (ymd.days, "day"),
    ]);
    let weeks_text = format_parts(&[(weeks, "week"), (week_remainder_days, "day")]);
    let summary_text = plural(total_days, "day");
    let formula_text = format!(
        "{} - {}{} = {}",
        format_iso(hi),
        format_iso(lo),
        if include { " + 1" } else { "" },
        summary_text
    );

    let mut trace_lines = Vec::new();
    if direction == Direction::Backward {
        trace_lines.push("The end date is before the start date, so the dates are swapped.".into());
    }
    if include {
        trace_lines.push(format!(
            "From {} through {} (later date included: count to {})",
            format_iso(lo),
            format_iso(hi),
            format_iso(hi_x)
        ));
    } else {
        trace_lines.push(format!("From {} to {}", format_iso(lo), format_iso(hi)));
    }
    trace_lines.extend(walk_trace(lo, hi_x, &ymd, LeapDayRule::Feb28));
    trace_lines.push(format!("= {breakdown_text}"));
    trace_lines.push(formula_text.clone());

    let mut copy = vec![
        format!(
            "From {start_iso} ({start_weekday}) to {end_iso} ({end_weekday}){}",
            if include { ", later date included" } else { "" }
        ),
        format!("Total: {summary_text}"),
        format!("Breakdown: {breakdown_text}"),
        format!("Weeks: {weeks_text}"),
        format!("Hours: {}", format_int(total_hours)),
        format!("Minutes: {}", format_int(total_minutes)),
        format!("Seconds: {}", format_int(total_seconds)),
    ];
    if direction == Direction::Backward {
        copy.push("Note: the end date is before the start date.".into());
    }

    Ok(DaysBetweenResult {
        start_date: start_iso,
        end_date: end_iso,
        include_end_day: include,
        direction,
        total_days,
        signed_days,
        years: ymd.years,
        months: ymd.months,
        days: ymd.days,
        total_months: ymd.total_months,
        weeks,
        week_remainder_days,
        total_hours,
        total_minutes,
        total_seconds,
        start_weekday,
        end_weekday,
        breakdown_text,
        weeks_text,
        summary_text,
        formula_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}
