//! Mode 2, Add/Subtract from a Date (spec 1 §7.2, FROZEN §2-§6).

use serde::{Deserialize, Serialize};

use crate::business::add_business_days;
use crate::calendar::{Calendar, CalendarSpec};
use crate::civil::{add_months, civil_from_days, days_from_civil, in_range, EpochDay, LeapDayRule};
use crate::error::{CoreError, Field};
use crate::format::{format_civil_iso, format_int, format_iso, format_long, plural, weekday_of};
use crate::parse::{parse_amount, parse_date};

/// Add or subtract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    /// Effective amounts are the entered amounts.
    Add,
    /// Effective amounts are the negated entered amounts.
    Subtract,
}

impl Operation {
    const fn sign(self) -> i64 {
        match self {
            Self::Add => 1,
            Self::Subtract => -1,
        }
    }
}

/// Request. The four amounts are the raw input strings (blank = 0, signed
/// values allowed, FROZEN §6).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AddSubtractRequest {
    /// Start date, `YYYY-MM-DD`.
    #[serde(default)]
    pub date: String,
    /// `"add"` or `"subtract"`.
    pub operation: Operation,
    /// Years amount (raw string).
    #[serde(default)]
    pub years: String,
    /// Months amount (raw string).
    #[serde(default)]
    pub months: String,
    /// Weeks amount (raw string).
    #[serde(default)]
    pub weeks: String,
    /// Days amount (raw string).
    #[serde(default)]
    pub days: String,
    /// Treat weeks/days as business weeks/days (FROZEN decision 5).
    #[serde(default)]
    pub business_days: bool,
    /// Business calendar; used only when `businessDays` is true.
    #[serde(default)]
    pub calendar: CalendarSpec,
}

/// Result, in the documented field order. The business fields are `null` in
/// calendar mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSubtractResult {
    pub date: String,
    pub operation: Operation,
    pub business_days: bool,
    /// Effective signed years (`sign * years`).
    pub years: i64,
    /// Effective signed months.
    pub months: i64,
    /// Effective signed weeks.
    pub weeks: i64,
    /// Effective signed days.
    pub days: i64,
    pub result_date: String,
    pub result_weekday: String,
    pub result_long_text: String,
    /// `result - date` in calendar days.
    pub calendar_days_delta: i64,
    /// The single month step clamped the day to the month's end.
    pub month_clamped: bool,
    pub business_start_date: Option<String>,
    pub business_day_count: Option<i64>,
    pub start_is_business_day: Option<bool>,
    pub skipped_weekend_days: Option<i64>,
    pub skipped_holidays: Option<i64>,
    /// Any holiday used was an estimated (tabular Hijri) date.
    pub used_approximate_holidays: Option<bool>,
    /// Non-fatal warnings such as `presetYearOutOfRange`.
    pub warnings: Vec<String>,
    /// `{date} + 1 month - 1 day = {result}`.
    pub expression_text: String,
    /// Same as `resultLongText`.
    pub summary_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// `" + 1 month"` / `" - 2 days"` for each non-zero component, in order.
fn terms(parts: &[(i64, &str)]) -> String {
    parts
        .iter()
        .filter(|(n, _)| *n != 0)
        .map(|(n, unit)| {
            let op = if *n < 0 { "-" } else { "+" };
            format!(" {op} {}", plural(n.abs(), unit))
        })
        .collect()
}

/// Adds or subtracts years, months, weeks and days.
///
/// Calendar mode: one combined month step `add_months(date, Y*12 + Mo)` with a
/// single month-end clamp, then `W*7 + D` days. The month step's intermediate
/// date is not range-checked (9999-12-15 + 1 month - 30 days is fine); only the
/// final date is. Subtraction is not the inverse of addition
/// (2025-01-31 + 1 month - 1 month = 2025-01-28).
///
/// Business mode (`businessDays: true`, owner decision): the calendar is
/// validated after the amounts; years and months step on the calendar first
/// (the intermediate `D1` must be in range, because holidays are undefined
/// outside it); then weeks count as **business weeks** of `wpw` working days
/// each, so `N = W * wpw + D` business days are stepped from `D1` with
/// [`add_business_days`]. `N = 0` returns `D1` even when it is not a
/// business day (flagged by `startIsBusinessDay: false`).
pub fn calc_add_subtract(req: &AddSubtractRequest) -> Result<AddSubtractResult, CoreError> {
    let start = parse_date(&req.date, Field::Date)?;
    let sign = req.operation.sign();
    // Validated magnitudes are at most 3 652 058, so none of this can overflow.
    let y = sign * parse_amount(&req.years, Field::Years)?;
    let mo = sign * parse_amount(&req.months, Field::Months)?;
    let w = sign * parse_amount(&req.weeks, Field::Weeks)?;
    let d = sign * parse_amount(&req.days, Field::Days)?;

    if req.business_days {
        let cal = Calendar::new(&req.calendar)?;
        return business_mode(req, start, [y, mo, w, d], &cal);
    }

    let total_months = y * 12 + mo;
    let (mid, clamped) = add_months(civil_from_days(start), total_months, LeapDayRule::Feb28);
    let mid_day = days_from_civil(mid);
    let day_step = w * 7 + d;
    let result = mid_day + day_step;
    if !in_range(result) {
        return Err(CoreError::result_out_of_range());
    }
    let month_clamped = clamped && total_months != 0;

    let date_iso = format_iso(start);
    let result_iso = format_iso(result);
    let result_long_text = format_long(result);
    let delta = result - start;

    let month_terms = terms(&[(y, "year"), (mo, "month")]);
    let day_terms = terms(&[(w, "week"), (d, "day")]);
    let all_terms = if month_terms.is_empty() && day_terms.is_empty() {
        " + 0 days".to_string()
    } else {
        format!("{month_terms}{day_terms}")
    };
    let expression_text = format!("{date_iso}{all_terms} = {result_iso}");

    let mut trace_lines = vec![format!("Start: {date_iso} ({})", weekday_of(start))];
    if !month_terms.is_empty() {
        let mut line = format!("Months first:{month_terms} -> {}", format_civil_iso(mid));
        if month_clamped {
            line.push_str(&format!(
                " (clamped from day {})",
                civil_from_days(start).day
            ));
        }
        if !in_range(mid_day) {
            line.push_str(" (outside the supported range; allowed as an intermediate step)");
        }
        trace_lines.push(line);
    }
    if !day_terms.is_empty() {
        // Show the net day count only when it is not already a single term.
        let net = if w != 0 {
            format!(
                " ({}{})",
                if day_step < 0 { "-" } else { "+" },
                plural(day_step.abs(), "day")
            )
        } else {
            String::new()
        };
        trace_lines.push(format!("Then days:{day_terms}{net} -> {result_iso}"));
    }
    trace_lines.push(format!("= {result_long_text}"));

    let mut copy = vec![
        expression_text.clone(),
        format!("Result: {result_long_text}"),
        format!("Calendar days moved: {}", format_int(delta)),
    ];
    if month_clamped {
        copy.push("Note: the day was moved to the last day of the month.".into());
    }

    Ok(AddSubtractResult {
        date: date_iso,
        operation: req.operation,
        business_days: false,
        years: y,
        months: mo,
        weeks: w,
        days: d,
        result_date: result_iso,
        result_weekday: weekday_of(result).to_string(),
        summary_text: result_long_text.clone(),
        result_long_text,
        calendar_days_delta: delta,
        month_clamped,
        business_start_date: None,
        business_day_count: None,
        start_is_business_day: None,
        skipped_weekend_days: None,
        skipped_holidays: None,
        used_approximate_holidays: None,
        warnings: Vec::new(),
        expression_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}

/// The business-mode half of [`calc_add_subtract`]; `amounts` are the
/// effective signed `[Y, Mo, W, D]`.
fn business_mode(
    req: &AddSubtractRequest,
    start: EpochDay,
    amounts: [i64; 4],
    cal: &Calendar,
) -> Result<AddSubtractResult, CoreError> {
    let [y, mo, w, d] = amounts;
    let total_months = y * 12 + mo;
    let (mid, clamped) = add_months(civil_from_days(start), total_months, LeapDayRule::Feb28);
    let d1 = days_from_civil(mid);
    if !in_range(d1) {
        return Err(CoreError::result_out_of_range());
    }
    let month_clamped = clamped && total_months != 0;
    let weekend = cal.weekend();
    let wpw = weekend.workdays_per_week();
    // |W| <= 521 722 and wpw <= 7, |D| <= 3 652 058: far from overflow.
    let n = w * wpw + d;
    let step = add_business_days(cal, d1, n)?;
    let result = step.date;
    let start_is_business_day = cal.is_business_day(d1);
    let (span_lo, span_hi) = (d1.min(result), d1.max(result));
    let used_approximate_holidays = match n.signum() {
        1 => cal.any_approximate_in(d1 + 1, result + 1),
        -1 => cal.any_approximate_in(result, d1),
        _ => false,
    };
    let warnings = cal.coverage_warnings(span_lo, span_hi);

    let date_iso = format_iso(start);
    let d1_iso = format_iso(d1);
    let result_iso = format_iso(result);
    let result_long_text = format_long(result);
    let delta = result - start;

    let month_terms = terms(&[(y, "year"), (mo, "month")]);
    let day_terms = terms(&[(w, "business week"), (d, "business day")]);
    let all_terms = if month_terms.is_empty() && day_terms.is_empty() {
        " + 0 business days".to_string()
    } else {
        format!("{month_terms}{day_terms}")
    };
    let expression_text = format!("{date_iso}{all_terms} = {result_iso}");

    let mut trace_lines = vec![format!("Start: {date_iso} ({})", weekday_of(start))];
    if !month_terms.is_empty() {
        let mut line = format!("Months first:{month_terms} -> {d1_iso}");
        if month_clamped {
            line.push_str(&format!(
                " (clamped from day {})",
                civil_from_days(start).day
            ));
        }
        trace_lines.push(line);
    }
    trace_lines.push(format!(
        "Weekend: {} ({} working days per week)",
        weekend.names_text(),
        wpw
    ));
    if w != 0 {
        trace_lines.push(format!(
            "Business days: {} x {} + {} = {}",
            format_int(w),
            wpw,
            format_int(d),
            format_int(n)
        ));
    }
    if n == 0 {
        trace_lines.push(format!(
            "No business days to move; {d1_iso} is {}a business day",
            if start_is_business_day { "" } else { "not " }
        ));
    } else {
        trace_lines.push(format!(
            "From {d1_iso} ({}) {} {} -> {result_iso}",
            weekday_of(d1),
            if n < 0 { "back" } else { "forward" },
            plural(n.abs(), "business day")
        ));
        trace_lines.push(format!(
            "Skipped {}, {}",
            plural(step.skipped_weekend, "weekend day"),
            plural(step.skipped_holidays, "holiday")
        ));
    }
    trace_lines.push(format!("= {result_long_text}"));

    let mut copy = vec![
        expression_text.clone(),
        format!("Result: {result_long_text}"),
        format!("Calendar days moved: {}", format_int(delta)),
    ];
    if month_clamped {
        copy.push("Note: the day was moved to the last day of the month.".into());
    }
    copy.push(format!(
        "Business days: {} (skipped {}, {})",
        format_int(n),
        plural(step.skipped_weekend, "weekend day"),
        plural(step.skipped_holidays, "holiday")
    ));
    // Spec 1 §7.2 template: the weekend, estimates and warnings are in the
    // JSON fields and trace lines, not in the copied text.
    if n == 0 && !start_is_business_day {
        copy.push("Note: the start date is not a business day.".into());
    }

    Ok(AddSubtractResult {
        date: date_iso,
        operation: req.operation,
        business_days: true,
        years: y,
        months: mo,
        weeks: w,
        days: d,
        result_date: result_iso,
        result_weekday: weekday_of(result).to_string(),
        summary_text: result_long_text.clone(),
        result_long_text,
        calendar_days_delta: delta,
        month_clamped,
        business_start_date: Some(d1_iso),
        business_day_count: Some(n),
        start_is_business_day: Some(start_is_business_day),
        skipped_weekend_days: Some(step.skipped_weekend),
        skipped_holidays: Some(step.skipped_holidays),
        used_approximate_holidays: Some(used_approximate_holidays),
        warnings,
        expression_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}
