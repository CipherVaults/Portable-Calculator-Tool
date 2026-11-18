//! Mode 4, Age with next birthday (spec 1 §7.4, FROZEN §8).

use serde::{Deserialize, Serialize};

use super::walk_trace;
use crate::civil::{
    anniversary, civil_from_days, in_range, ymd_between, LeapDayRule, SECONDS_PER_DAY,
};
use crate::error::{CoreError, Field};
use crate::format::{format_iso, format_long, format_parts, plural, weekday_of};
use crate::parse::parse_date;

/// Request: `{ "birthDate", "asOfDate", "leapDayRule" }`.
///
/// `asOfDate` is required by the core; the UI substitutes local today for an
/// empty field and shows it (FROZEN §8).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgeRequest {
    /// Date of birth, `YYYY-MM-DD`.
    #[serde(default)]
    pub birth_date: String,
    /// Age-at date, `YYYY-MM-DD`.
    #[serde(default)]
    pub as_of_date: String,
    /// Birthday of a Feb 29 birth in common years: `feb28` (default) or `mar1`.
    #[serde(default)]
    pub leap_day_rule: LeapDayRule,
}

/// The next birthday (or today's, when the age-at date is a birthday).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextBirthday {
    pub date: String,
    pub weekday: String,
    pub long_text: String,
    pub turning_age: i64,
    pub days_until: i64,
    /// Breakdown of the wait (`ymd_between(asOf, next, feb28)`).
    pub years: i64,
    pub months: i64,
    pub days: i64,
    pub until_text: String,
    pub is_today: bool,
}

/// Result, in the documented field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgeResult {
    pub birth_date: String,
    pub as_of_date: String,
    pub leap_day_rule: LeapDayRule,
    pub years: i64,
    pub months: i64,
    pub days: i64,
    pub age_text: String,
    pub total_months: i64,
    pub total_weeks: i64,
    pub week_remainder_days: i64,
    pub total_days: i64,
    pub total_hours: i64,
    pub total_minutes: i64,
    pub total_seconds: i64,
    pub born_weekday: String,
    /// `null` when the next birthday is after 9999-12-31.
    pub next_birthday: Option<NextBirthday>,
    /// `{years} year(s) old`.
    pub summary_text: String,
    /// Live-formula panel lines.
    pub trace_lines: Vec<String>,
    pub copy_text: String,
}

/// Computes an age on a given date.
///
/// The age is the anniversary walk from the birth date under the selected
/// leap-day rule. The next birthday is the anniversary `12 * (years + 1)`,
/// unless the age-at date is itself a birthday (`years >= 1` and the
/// `12 * years` anniversary equals it). Being born on the age-at date is never
/// "birthday today": the next birthday is one year later.
pub fn calc_age(req: &AgeRequest) -> Result<AgeResult, CoreError> {
    let birth = parse_date(&req.birth_date, Field::BirthDate)?;
    let as_of = parse_date(&req.as_of_date, Field::AsOfDate)?;
    if birth > as_of {
        return Err(CoreError::birth_after_as_of());
    }
    let rule = req.leap_day_rule;

    let ymd = ymd_between(birth, as_of, rule);
    let total_days = as_of - birth;
    let total_weeks = total_days.div_euclid(7);
    let week_remainder_days = total_days.rem_euclid(7);
    let age_text = format_parts(&[
        (ymd.years, "year"),
        (ymd.months, "month"),
        (ymd.days, "day"),
    ]);
    let summary_text = format!("{} old", plural(ymd.years, "year"));

    let is_today = ymd.years >= 1 && anniversary(birth, 12 * ymd.years, rule) == as_of;
    let (next_day, turning_age) = if is_today {
        (as_of, ymd.years)
    } else {
        (
            anniversary(birth, 12 * (ymd.years + 1), rule),
            ymd.years + 1,
        )
    };
    let next_birthday = in_range(next_day).then(|| {
        let until = ymd_between(as_of, next_day, LeapDayRule::Feb28);
        NextBirthday {
            date: format_iso(next_day),
            weekday: weekday_of(next_day).to_string(),
            long_text: format_long(next_day),
            turning_age,
            days_until: next_day - as_of,
            years: until.years,
            months: until.months,
            days: until.days,
            until_text: format_parts(&[
                (until.years, "year"),
                (until.months, "month"),
                (until.days, "day"),
            ]),
            is_today,
        }
    });

    let birth_iso = format_iso(birth);
    let as_of_iso = format_iso(as_of);
    let born_weekday = weekday_of(birth).to_string();
    let birth_civil = civil_from_days(birth);
    let leap_note = (birth_civil.month == 2 && birth_civil.day == 29).then_some(match rule {
        LeapDayRule::Feb28 => "Leap-day birthday: celebrated on February 28 in common years.",
        LeapDayRule::Mar1 => "Leap-day birthday: celebrated on March 1 in common years.",
    });

    let mut trace_lines = vec![format!("Born {birth_iso} ({born_weekday})")];
    trace_lines.extend(walk_trace(birth, as_of, &ymd, rule));
    trace_lines.push(format!("Age on {as_of_iso}: {age_text}"));
    trace_lines.push(match &next_birthday {
        Some(nb) if nb.is_today => format!(
            "{birth_iso} + {} = {} (birthday today)",
            plural(turning_age, "year"),
            nb.date
        ),
        Some(nb) => format!(
            "{birth_iso} + {} = {} (next birthday, in {})",
            plural(turning_age, "year"),
            nb.date,
            plural(nb.days_until, "day")
        ),
        None => format!(
            "{birth_iso} + {} is after 9999-12-31",
            plural(turning_age, "year")
        ),
    });
    if let Some(note) = leap_note {
        trace_lines.push(note.to_string());
    }

    let mut copy = vec![
        format!("Born {birth_iso} ({born_weekday}), age on {as_of_iso}"),
        format!("Age: {age_text}"),
        format!(
            "In months: {}",
            format_parts(&[(ymd.total_months, "month"), (ymd.days, "day")])
        ),
        format!(
            "In weeks: {}",
            format_parts(&[(total_weeks, "week"), (week_remainder_days, "day")])
        ),
        format!("In days: {}", plural(total_days, "day")),
        match &next_birthday {
            Some(nb) if nb.is_today => format!(
                "Next birthday: today, {} ({}), turning {}",
                nb.date, nb.weekday, nb.turning_age
            ),
            Some(nb) => format!(
                "Next birthday: {} ({}), turning {}, in {} ({})",
                nb.date,
                nb.weekday,
                nb.turning_age,
                plural(nb.days_until, "day"),
                nb.until_text
            ),
            None => "Next birthday: after 9999-12-31 (outside the supported range)".to_string(),
        },
    ];
    if let Some(note) = leap_note {
        copy.push(note.to_string());
    }

    Ok(AgeResult {
        birth_date: birth_iso,
        as_of_date: as_of_iso,
        leap_day_rule: rule,
        years: ymd.years,
        months: ymd.months,
        days: ymd.days,
        age_text,
        total_months: ymd.total_months,
        total_weeks,
        week_remainder_days,
        total_days,
        total_hours: total_days * 24,
        total_minutes: total_days * 1_440,
        total_seconds: total_days * SECONDS_PER_DAY,
        born_weekday,
        next_birthday,
        summary_text,
        trace_lines,
        copy_text: copy.join("\n"),
    })
}
