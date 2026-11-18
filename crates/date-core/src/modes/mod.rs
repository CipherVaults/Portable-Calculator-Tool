//! The six calculator modes (spec 1 §7).
//!
//! Each mode exposes `calc_X(&XRequest) -> Result<XResult, CoreError>`.
//! Requests are camelCase with `deny_unknown_fields`; results serialize their
//! fields in declaration order, which is part of the parity contract.

pub mod add_subtract;
pub mod age;
pub mod business_days;
pub mod countdown;
pub mod date_info;
pub mod days_between;

use crate::civil::{anniversary_clamped, civil_from_days, EpochDay, LeapDayRule, Ymd};
use crate::format::{format_iso, format_parts, plural};

/// Suffix explaining why a month anniversary's day differs from the start's.
fn clamp_note(start_day: u32, anniversary: EpochDay) -> String {
    let c = civil_from_days(anniversary);
    if c.day == start_day {
        String::new()
    } else if start_day == 29 && c.month == 3 && c.day == 1 {
        " (leap day moved to March 1)".to_string()
    } else {
        format!(" (clamped from day {start_day})")
    }
}

/// Trace lines for the anniversary walk from `lo` to `target`, whose
/// breakdown is `ymd` (spec 1 §2.4). Every anniversary is anchored on `lo`
/// itself (never stepped year-then-month), mirroring the algorithm:
///
/// ```text
/// 2024-01-31 + 1 year = 2025-01-31
/// 2024-01-31 + 1 year, 1 month = 2025-02-28 (clamped from day 31)
/// 2025-02-28 + 15 days = 2025-03-15
/// ```
pub(crate) fn walk_trace(
    lo: EpochDay,
    target: EpochDay,
    ymd: &Ymd,
    rule: LeapDayRule,
) -> Vec<String> {
    let mut lines = Vec::new();
    let lo_iso = format_iso(lo);
    let start_day = civil_from_days(lo).day;
    if ymd.years > 0 {
        let (day, _) = anniversary_clamped(lo, ymd.years * 12, rule);
        lines.push(format!(
            "{lo_iso} + {} = {}{}",
            plural(ymd.years, "year"),
            format_iso(day),
            clamp_note(start_day, day)
        ));
    }
    if ymd.months > 0 {
        let (day, _) = anniversary_clamped(lo, ymd.total_months, rule);
        lines.push(format!(
            "{lo_iso} + {} = {}{}",
            format_parts(&[(ymd.years, "year"), (ymd.months, "month")]),
            format_iso(day),
            clamp_note(start_day, day)
        ));
    }
    if ymd.days > 0 {
        lines.push(format!(
            "{} + {} = {}",
            format_iso(target - ymd.days),
            plural(ymd.days, "day"),
            format_iso(target)
        ));
    }
    lines
}
