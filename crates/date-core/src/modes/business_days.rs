//! Mode 3, Business Days Between (spec 1 §7.3, FROZEN §5).

use serde::{Deserialize, Serialize};

use super::days_between::Direction;
use crate::business::{count_business_days, working_holidays};
use crate::calendar::{Calendar, CalendarSpec, HolidayDay};
use crate::civil::EpochDay;
use crate::error::{CoreError, Field};
use crate::format::{format_int, format_iso, plural, weekday_of};
use crate::parse::parse_date;

/// Most holiday dates listed in the JSON result (the total is always given).
pub const MAX_LISTED_HOLIDAYS: usize = 500;
/// Most holiday dates listed in `copyText` before `; and {n} more`
/// (FROZEN §11).
pub const MAX_COPY_HOLIDAYS: usize = 10;
/// Byte budget of the `Holidays: ...` copy line, including the `and n more`
/// tail. With every other line at its maximum this keeps `copyText` within
/// [`MAX_COPY_TEXT_BYTES`](crate::MAX_COPY_TEXT_BYTES).
pub const COPY_HOLIDAY_LINE_BUDGET: usize = 520;

/// Request: `{ "startDate", "endDate", "includeEndDay", "calendar" }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BusinessDaysRequest {
    /// Start date, `YYYY-MM-DD`.
    #[serde(default)]
    pub start_date: String,
    /// End date, `YYYY-MM-DD`; may be before the start date.
    #[serde(default)]
    pub end_date: String,
    /// Also count the later of the two dates (UI: "include the later date").
    #[serde(default)]
    pub include_end_day: bool,
    /// Weekend and holidays.
    #[serde(default)]
    pub calendar: CalendarSpec,
}

/// A holiday date that removed a working day from the count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayHit {
    /// The date.
    pub date: String,
    /// Actual date of the first holiday on that date (differs from `date`
    /// for an observed or substitute day).
    pub actual_date: String,
    /// Names of every holiday on that date, deduplicated, joined `" / "`.
    pub name: String,
    /// Any of them is an estimated (tabular Hijri) date.
    pub approximate: bool,
}

impl From<&HolidayDay> for HolidayHit {
    fn from(h: &HolidayDay) -> Self {
        Self {
            date: format_iso(h.day),
            actual_date: format_iso(h.actual),
            name: h.names.join(" / "),
            approximate: h.approximate,
        }
    }
}

/// Result, in the documented field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessDaysResult {
    pub start_date: String,
    pub end_date: String,
    pub include_end_day: bool,
    pub direction: Direction,
    /// The weekend, sorted ISO weekdays.
    pub weekend: Vec<u8>,
    /// Days in the counted interval `[lo, hiX)`.
    pub calendar_days: i64,
    pub business_days: i64,
    /// `-business_days` when backward.
    pub signed_business_days: i64,
    pub weekend_days: i64,
    /// Holiday dates on working weekdays (same-date holidays count once).
    pub holiday_days: i64,
    /// The first 500 of those dates.
    pub holidays: Vec<HolidayHit>,
    /// More holiday dates exist than are listed.
    pub holidays_truncated: bool,
    /// Any holiday date in the counted interval is an estimate.
    pub used_approximate_holidays: bool,
    /// `presetYearOutOfRange` when the range leaves the holiday window.
    pub warnings: Vec<String>,
    /// `22 business days, 8 weekend days, 0 holidays`.
    pub breakdown_text: String,
    /// `plural(business, business day)`.
    pub summary_text: String,
    /// `{cal} calendar days - {we} weekend days - {ho} holidays = {summary}`.
    pub formula_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// The `Holidays: ...` copy line: at most [`MAX_COPY_HOLIDAYS`] dates, fewer
/// if the next entry would push the line past
/// [`COPY_HOLIDAY_LINE_BUDGET`] (reserving room for the tail), then
/// `; and {n} more` for the rest. Custom holidays appear as
/// `Custom holiday`, so the line is ASCII and carries no custom name.
pub(crate) fn copy_holiday_line(listed: &[HolidayDay], total: i64) -> String {
    const TAIL_RESERVE: usize = 24;
    let mut line = "Holidays: ".to_string();
    let mut shown = 0_i64;
    for h in listed.iter().take(MAX_COPY_HOLIDAYS) {
        let entry = format!("{} {}", format_iso(h.day), h.copy_label());
        let sep = if shown == 0 { "" } else { "; " };
        if line.len() + sep.len() + entry.len() + TAIL_RESERVE > COPY_HOLIDAY_LINE_BUDGET {
            break;
        }
        line.push_str(sep);
        line.push_str(&entry);
        shown += 1;
    }
    let more = total - shown;
    if more > 0 {
        if shown > 0 {
            line.push_str("; ");
        }
        line.push_str(&format!("and {} more", format_int(more)));
    }
    line
}

/// Counts business days between two dates.
///
/// The counted interval is `[lo, hiX)` with `hiX = hi + includeEndDay`: the
/// earlier date is always counted and the later date only when the toggle is
/// on (Mon -> Fri gives 4, or 5 with the toggle, like Excel `NETWORKDAYS`).
pub fn calc_business_days(req: &BusinessDaysRequest) -> Result<BusinessDaysResult, CoreError> {
    let a = parse_date(&req.start_date, Field::StartDate)?;
    let b = parse_date(&req.end_date, Field::EndDate)?;
    let cal = Calendar::new(&req.calendar)?;
    let include = req.include_end_day;

    let direction = Direction::between(a, b);
    let (lo, hi) = (a.min(b), a.max(b));
    let hi_x: EpochDay = hi + i64::from(include);
    let count = count_business_days(&cal, lo, hi_x);
    let signed = if direction == Direction::Backward {
        -count.business
    } else {
        count.business
    };
    let (listed, total) = working_holidays(&cal, lo, hi_x, MAX_LISTED_HOLIDAYS);
    let used_approximate_holidays = cal.any_approximate_in(lo, hi_x);
    let warnings = cal.coverage_warnings(lo, (hi_x - 1).max(lo));
    let weekend = cal.weekend();

    let summary_text = plural(count.business, "business day");
    let breakdown_text = format!(
        "{}, {}, {}",
        summary_text,
        plural(count.weekend, "weekend day"),
        plural(count.holiday, "holiday")
    );
    let formula_text = format!(
        "{} - {} - {} = {}",
        plural(count.calendar_days, "calendar day"),
        plural(count.weekend, "weekend day"),
        plural(count.holiday, "holiday"),
        summary_text
    );

    let mut trace_lines = Vec::new();
    if direction == Direction::Backward {
        trace_lines.push("The end date is before the start date, so the dates are swapped.".into());
    }
    trace_lines.push(if include {
        format!(
            "Counting {} through {} (later date included)",
            format_iso(lo),
            format_iso(hi)
        )
    } else {
        format!(
            "Counting {} up to {} (later date not counted)",
            format_iso(lo),
            format_iso(hi)
        )
    });
    let full_weeks = count.calendar_days.div_euclid(7);
    let rest = count.calendar_days.rem_euclid(7);
    trace_lines.push(format!(
        "{} = {} x 7 + {}",
        plural(count.calendar_days, "calendar day"),
        plural(full_weeks, "full week"),
        plural(rest, "day")
    ));
    trace_lines.push(format!(
        "Weekend ({}): {}",
        weekend.names_text(),
        plural(count.weekend, "day")
    ));
    trace_lines.push(format!(
        "Holidays on working days: {}",
        format_int(count.holiday)
    ));
    for h in listed.iter().take(MAX_COPY_HOLIDAYS) {
        trace_lines.push(format!("  {} {}", format_iso(h.day), h.copy_label()));
    }
    if total > MAX_COPY_HOLIDAYS as i64 {
        trace_lines.push(format!(
            "  and {} more",
            format_int(total - MAX_COPY_HOLIDAYS as i64)
        ));
    }
    trace_lines.push(formula_text.clone());

    let mut copy = vec![
        format!(
            "From {} ({}) to {} ({}){}",
            format_iso(a),
            weekday_of(a),
            format_iso(b),
            weekday_of(b),
            if include { ", later date included" } else { "" }
        ),
        format!("Business days: {}", format_int(count.business)),
        format!("Calendar days: {}", format_int(count.calendar_days)),
        format!("Weekend days: {}", format_int(count.weekend)),
        format!("Holidays on working days: {}", format_int(count.holiday)),
        format!("Weekend: {}", weekend.names_text()),
    ];
    // Spec 1 §7.3 template. Estimates are marked on each holiday entry;
    // `warnings` and `usedApproximateHolidays` travel in the JSON only.
    if total > 0 {
        copy.push(copy_holiday_line(&listed, total));
    }
    if direction == Direction::Backward {
        copy.push("Note: the end date is before the start date.".into());
    }

    Ok(BusinessDaysResult {
        start_date: format_iso(a),
        end_date: format_iso(b),
        include_end_day: include,
        direction,
        weekend: weekend.iso_days(),
        calendar_days: count.calendar_days,
        business_days: count.business,
        signed_business_days: signed,
        weekend_days: count.weekend,
        holiday_days: count.holiday,
        holidays: listed.iter().map(HolidayHit::from).collect(),
        holidays_truncated: total > MAX_LISTED_HOLIDAYS as i64,
        used_approximate_holidays,
        warnings,
        breakdown_text,
        summary_text,
        formula_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}
