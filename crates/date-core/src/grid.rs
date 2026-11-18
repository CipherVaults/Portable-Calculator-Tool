//! `month_grid`: the 42-cell mini calendar used by the Business, Date Info and
//! Countdown cards (FROZEN §9). Being in the core, it is covered by parity.

use serde::{Deserialize, Serialize};

use crate::calendar::{Calendar, CalendarSpec, HolidayDay};
use crate::civil::{days_in_month, in_range, iso_weekday, EpochDay};
use crate::error::{CoreError, Field};
use crate::format::{format_iso, format_long, month_name};
use crate::holidays::rules::ymd;
use crate::modes::business_days::HolidayHit;
use crate::parse::{parse_date, trim_ascii_ws};

/// Cells in every grid: six weeks.
pub const GRID_CELLS: usize = 42;

/// Three-letter weekday names in ISO order.
const WEEKDAY_SHORT: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// First column of the grid.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FirstDayOfWeek {
    /// ISO 8601 (the default).
    #[default]
    Monday,
    /// US style.
    Sunday,
}

impl FirstDayOfWeek {
    const fn iso(self) -> u32 {
        match self {
            Self::Monday => 1,
            Self::Sunday => 7,
        }
    }
}

/// Request. `today`, `rangeStart` and `rangeEnd` are optional (null, omitted
/// or blank means absent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonthGridRequest {
    /// Year 1..=9999.
    pub year: i64,
    /// Month 1..=12.
    pub month: i64,
    /// Monday (default) or Sunday.
    #[serde(default)]
    pub first_day_of_week: FirstDayOfWeek,
    /// The UI's local today, `YYYY-MM-DD`.
    #[serde(default)]
    pub today: Option<String>,
    /// First highlighted date (inclusive).
    #[serde(default)]
    pub range_start: Option<String>,
    /// Last highlighted date (inclusive); may be before `rangeStart`.
    #[serde(default)]
    pub range_end: Option<String>,
    /// Weekend and holidays.
    #[serde(default)]
    pub calendar: CalendarSpec,
}

/// One grid cell, in field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    /// `YYYY-MM-DD` (cells past either end of the supported range print
    /// year 0000 or 10000 and have `outOfRange: true`).
    pub date: String,
    /// Day of month.
    pub day: u32,
    /// ISO weekday 1..=7.
    pub iso_weekday: u32,
    /// The cell belongs to the requested month.
    pub in_month: bool,
    /// The date is outside 0001-01-01..=9999-12-31 (not selectable).
    pub out_of_range: bool,
    /// The weekday is a weekend day.
    pub weekend: bool,
    /// At least one holiday falls on the date.
    pub holiday: bool,
    /// Holiday names, deduplicated (custom names included, for display).
    pub holiday_names: Vec<String>,
    /// A holiday on the date is an estimate.
    pub approximate: bool,
    /// The date equals `today`.
    pub is_today: bool,
    /// The date is inside the highlighted range (inclusive).
    pub in_range: bool,
    /// The date is the first day of the highlighted range.
    pub is_range_start: bool,
    /// The date is the last day of the highlighted range.
    pub is_range_end: bool,
    /// Accessible label: `Monday, November 16, 2026` plus `, weekend`,
    /// `, holiday: {names}[ (estimated)]`, `, today` as applicable.
    pub label: String,
}

/// Result, in field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthGridResult {
    pub year: i64,
    pub month: i64,
    pub month_name: String,
    /// `November 2026`.
    pub title: String,
    pub first_day_of_week: FirstDayOfWeek,
    /// Seven `Mon`..`Sun` headers in column order.
    pub weekday_headers: Vec<String>,
    /// Exactly 42 cells, row by row.
    pub cells: Vec<GridCell>,
    /// Every holiday date in the month (weekend ones included), for a
    /// textual list next to the grid.
    pub holidays: Vec<HolidayHit>,
    pub used_approximate_holidays: bool,
    /// `presetYearOutOfRange` when the month is outside the holiday window.
    pub warnings: Vec<String>,
}

fn optional_date(raw: Option<&str>, field: Field) -> Result<Option<EpochDay>, CoreError> {
    match raw {
        Some(s) if !trim_ascii_ws(s).is_empty() => parse_date(s, field).map(Some),
        _ => Ok(None),
    }
}

/// Builds the month grid. Validation order: year, month, today, rangeStart,
/// rangeEnd, calendar.
///
/// The grid starts on the last `firstDayOfWeek` on or before the 1st of the
/// month and always has 42 cells, so every month (including a 31-day month
/// starting on the last column) fits.
pub fn month_grid(req: &MonthGridRequest) -> Result<MonthGridResult, CoreError> {
    if !(1..=9999).contains(&req.year) {
        return Err(CoreError::year_out_of_range());
    }
    let month = u32::try_from(req.month)
        .ok()
        .filter(|m| (1..=12).contains(m))
        .ok_or_else(CoreError::month_out_of_range)?;
    let today = optional_date(req.today.as_deref(), Field::Today)?;
    let range_start = optional_date(req.range_start.as_deref(), Field::RangeStart)?;
    let range_end = optional_date(req.range_end.as_deref(), Field::RangeEnd)?;
    let cal = Calendar::new(&req.calendar)?;
    let weekend = cal.weekend();

    let year = req.year;
    let first = ymd(year, month, 1);
    let last = first + i64::from(days_in_month(year, month)) - 1;
    let lead =
        (i64::from(iso_weekday(first)) - i64::from(req.first_day_of_week.iso())).rem_euclid(7);
    let grid_start = first - lead;
    let grid_end_excl = grid_start + GRID_CELLS as i64;

    let mut holiday_days: Vec<HolidayDay> = Vec::new();
    cal.for_each_holiday_day(grid_start, grid_end_excl, |h| holiday_days.push(h.clone()));

    let range = match (range_start, range_end) {
        (Some(a), Some(b)) => Some((a.min(b), a.max(b))),
        (Some(a), None) | (None, Some(a)) => Some((a, a)),
        (None, None) => None,
    };

    let cells = (0..GRID_CELLS as i64)
        .map(|i| {
            let z = grid_start + i;
            let civil = crate::civil::civil_from_days(z);
            let hol = holiday_days
                .binary_search_by_key(&z, |h| h.day)
                .ok()
                .and_then(|idx| holiday_days.get(idx));
            let is_weekend = weekend.is_weekend(z);
            let is_today = today == Some(z);
            let mut label = format_long(z);
            if is_weekend {
                label.push_str(", weekend");
            }
            if let Some(h) = hol {
                label.push_str(", holiday: ");
                label.push_str(&h.names.join(" / "));
                if h.approximate {
                    label.push_str(" (estimated)");
                }
            }
            if is_today {
                label.push_str(", today");
            }
            GridCell {
                date: format_iso(z),
                day: civil.day,
                iso_weekday: iso_weekday(z),
                in_month: (first..=last).contains(&z),
                out_of_range: !in_range(z),
                weekend: is_weekend,
                holiday: hol.is_some(),
                holiday_names: hol.map(|h| h.names.clone()).unwrap_or_default(),
                approximate: hol.is_some_and(|h| h.approximate),
                is_today,
                in_range: range.is_some_and(|(lo, hi)| lo <= z && z <= hi),
                is_range_start: range.is_some_and(|(lo, _)| lo == z),
                is_range_end: range.is_some_and(|(_, hi)| hi == z),
                label,
            }
        })
        .collect();

    let month_holidays: Vec<&HolidayDay> = holiday_days
        .iter()
        .filter(|h| (first..=last).contains(&h.day))
        .collect();
    let weekday_headers = (0..7)
        .map(|i| {
            let iso = (req.first_day_of_week.iso() - 1 + i) % 7;
            WEEKDAY_SHORT
                .get(iso as usize)
                .copied()
                .unwrap_or_default()
                .to_string()
        })
        .collect();

    Ok(MonthGridResult {
        year,
        month: req.month,
        month_name: month_name(month).to_string(),
        title: format!("{} {}", month_name(month), year),
        first_day_of_week: req.first_day_of_week,
        weekday_headers,
        cells,
        used_approximate_holidays: month_holidays.iter().any(|h| h.approximate),
        holidays: month_holidays
            .iter()
            .map(|&h| HolidayHit::from(h))
            .collect(),
        warnings: cal.coverage_warnings(first, last),
    })
}
