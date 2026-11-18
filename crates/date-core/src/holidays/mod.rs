//! Holiday presets and their year-by-year expansion (spec 2), plus the
//! `holidays_in_range` entry point (FROZEN §2).
//!
//! Expansion of one *actual* Gregorian year `y` for a preset:
//!
//! 1. Evaluate each rule's era for `y` (fixed, nth/last weekday, Western or
//!    Orthodox Easter offsets, Julian fixed dates). Islamic rules scan every
//!    Hijri year overlapping `y` (with one year of margin) and keep the days
//!    whose actual date falls in `y`, which yields two Eids in years such as
//!    2000 and 2033.
//! 2. Apply the one-off table (UK moves and extra days).
//! 3. Apply the statutory observance (US Sat->Fri/Sun->Mon, UK substitute
//!    days); custom holidays are never shifted.
//! 4. Drop the ids the user excluded for this preset. Exclusion happens after
//!    observance, so the official substitute schedule does not change when a
//!    holiday is switched off.

pub mod easter;
pub mod eg;
pub mod hijri;
pub mod rules;
pub mod uk;
pub mod us;

use serde::{Deserialize, Serialize};

use crate::calendar::{
    yearly_day, Calendar, CalendarSpec, CompiledCustom, CustomRule, HijriEvent, HolidayPreset,
    ObservedMode,
};
use crate::civil::{civil_from_days, iso_weekday, EpochDay};
use crate::error::{CoreError, Field};
use crate::format::{format_iso, plural};
use crate::parse::parse_date;

use self::hijri::days_to_hijri;
use self::rules::{gregorian_date, kind_in_year, ymd, Observance, PresetDef, RuleKind};

/// First year with holiday data (spec 2 §1.3).
pub const HOLIDAY_MIN_YEAR: i64 = 1900;
/// Last year with holiday data.
pub const HOLIDAY_MAX_YEAR: i64 = 2199;
/// The name custom holidays carry in copy and trace text.
pub const CUSTOM_HOLIDAY_COPY_NAME: &str = "Custom holiday";
/// Most instances `holidays_in_range` lists (the total is always reported).
pub const MAX_LISTED_INSTANCES: usize = 1_000;

/// Source order offset of UK one-off extras (after every rule).
const EXTRA_ORDER_BASE: u32 = 100;
/// Source order offset of custom holidays (after every preset entry).
const CUSTOM_ORDER_BASE: u32 = 1_000;

/// The definition of a preset (`None` for preset `none`).
pub fn preset_def(preset: HolidayPreset) -> Option<&'static PresetDef> {
    match preset {
        HolidayPreset::None => None,
        HolidayPreset::Us => Some(&us::US),
        HolidayPreset::Uk => Some(&uk::UK),
        HolidayPreset::Eg => Some(&eg::EG),
    }
}

/// The years a preset adds holidays: `max(1900, min_year)..=2199`.
pub fn preset_window(preset: HolidayPreset) -> Option<(i64, i64)> {
    preset_def(preset).map(|d| (d.min_year.max(HOLIDAY_MIN_YEAR), HOLIDAY_MAX_YEAR))
}

/// Where a holiday instance comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HolidaySource {
    /// A preset rule or one-off.
    Preset,
    /// A user-defined holiday.
    Custom,
}

/// Global Hijri adjustment and per-year overrides.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct HijriConfig {
    /// Added to every tabular date (-2..=2).
    pub offset_days: i64,
    /// `(hijriYear, event, date)`; each replaces the anchor and wins over the
    /// offset.
    pub overrides: Vec<(i64, HijriEvent, EpochDay)>,
}

impl HijriConfig {
    /// The anchor (day 1) of `event` in Hijri year `hy`.
    fn anchor(&self, event: HijriEvent, hy: i64) -> EpochDay {
        self.overrides
            .iter()
            .find(|&&(y, e, _)| y == hy && e == event)
            .map_or_else(|| event.tabular_day(hy) + self.offset_days, |o| o.2)
    }
}

/// One expanded holiday occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Instance {
    pub id: String,
    /// Name, with the preset's suffix when shifted.
    pub name: String,
    /// Name without any suffix.
    pub base_name: String,
    pub source: HolidaySource,
    /// Observed date.
    pub date: EpochDay,
    /// Actual (unshifted) date.
    pub actual: EpochDay,
    pub approximate: bool,
    /// 1-based day of a multi-day block (Eids), else `None`.
    pub day_index: Option<u32>,
    /// Source order: rule index, then extras, then custom list order.
    pub order: u32,
}

fn year_of(z: EpochDay) -> i64 {
    civil_from_days(z).year
}

fn preset_instance(id: &str, name: &str, day: EpochDay, order: usize) -> Instance {
    Instance {
        id: id.to_string(),
        name: name.to_string(),
        base_name: name.to_string(),
        source: HolidaySource::Preset,
        date: day,
        actual: day,
        approximate: false,
        day_index: None,
        order: u32::try_from(order).unwrap_or(u32::MAX),
    }
}

/// Preset instances whose actual date is in Gregorian `year`, after
/// one-offs, observance and exclusions. Empty outside the preset window.
pub(crate) fn preset_year_instances(
    def: &PresetDef,
    year: i64,
    hijri: &HijriConfig,
    excluded: &[String],
) -> Vec<Instance> {
    let Some((first, last)) = preset_window(def.preset) else {
        return Vec::new();
    };
    if year < first || year > last {
        return Vec::new();
    }
    let mut out: Vec<Instance> = Vec::new();
    for (idx, rule) in def.rules.iter().enumerate() {
        let Some(kind) = kind_in_year(rule, year) else {
            continue;
        };
        if let RuleKind::Hijri {
            anchor,
            offset,
            span,
        } = kind
        {
            let hy0 = days_to_hijri(ymd(year, 1, 1)).year - 1;
            let hy1 = days_to_hijri(ymd(year, 12, 31)).year + 1;
            for hy in hy0..=hy1 {
                let first_day = hijri.anchor(anchor, hy) + offset;
                for i in 0..span {
                    let d = first_day + i64::from(i);
                    if year_of(d) == year {
                        let mut inst = preset_instance(rule.id, rule.name, d, idx);
                        inst.approximate = true;
                        inst.day_index = (span > 1).then_some(i + 1);
                        out.push(inst);
                    }
                }
            }
        } else if let Some(d) = gregorian_date(kind, year).filter(|&d| year_of(d) == year) {
            out.push(preset_instance(rule.id, rule.name, d, idx));
        }
    }

    for mv in def.moves.iter().filter(|m| m.year == year) {
        let to = ymd(mv.to.0, mv.to.1, mv.to.2);
        for inst in out.iter_mut().filter(|i| i.id == mv.id) {
            inst.date = to;
            inst.actual = to;
        }
    }
    for (i, ex) in def.extras.iter().enumerate() {
        if ex.date.0 == year {
            let d = ymd(ex.date.0, ex.date.1, ex.date.2);
            out.push(preset_instance(
                ex.id,
                ex.name,
                d,
                EXTRA_ORDER_BASE as usize + i,
            ));
        }
    }

    apply_observance(def, &mut out);
    out.retain(|i| !excluded.contains(&i.id));
    out
}

fn is_sat_sun(z: EpochDay) -> bool {
    iso_weekday(z) >= 6
}

/// Applies the preset's statutory shifting to one year's instances.
fn apply_observance(def: &PresetDef, list: &mut [Instance]) {
    match def.observance {
        Observance::None => {}
        Observance::UsFederal => {
            for inst in list.iter_mut() {
                inst.date = match iso_weekday(inst.actual) {
                    6 => inst.actual - 1,
                    7 => inst.actual + 1,
                    _ => inst.actual,
                };
            }
        }
        Observance::UkSubstitute => {
            // Process in actual-date order (stable by rule order). A holiday
            // on Sat/Sun moves to the next Mon..Fri that is not already a
            // holiday; this reproduces every gov.uk case, including
            // Christmas on Sunday -> Tuesday 27 (Boxing Day keeps Monday 26).
            list.sort_by_key(|i| i.actual);
            let mut taken: Vec<EpochDay> = list
                .iter()
                .map(|i| i.actual)
                .filter(|&d| !is_sat_sun(d))
                .collect();
            for inst in list.iter_mut() {
                if is_sat_sun(inst.actual) {
                    let mut s = inst.actual + 1;
                    while is_sat_sun(s) || taken.contains(&s) {
                        s += 1;
                    }
                    inst.date = s;
                    taken.push(s);
                }
            }
        }
    }
    for inst in list.iter_mut() {
        if inst.date != inst.actual {
            inst.name = format!("{}{}", inst.base_name, def.shifted_suffix);
        }
    }
}

/// Custom holiday instances in Gregorian `year` (never shifted).
pub(crate) fn custom_year_instances(customs: &[CompiledCustom], year: i64) -> Vec<Instance> {
    if !(HOLIDAY_MIN_YEAR..=HOLIDAY_MAX_YEAR).contains(&year) {
        return Vec::new();
    }
    customs
        .iter()
        .filter_map(|c| {
            let day = match c.rule {
                CustomRule::Date(d) => (year_of(d) == year).then_some(d),
                CustomRule::Yearly {
                    month,
                    day,
                    from_year,
                } if year >= from_year => yearly_day(year, month, day),
                CustomRule::Yearly { .. } => None,
            }?;
            Some(Instance {
                id: c.id.clone(),
                name: c.name.clone(),
                base_name: c.name.clone(),
                source: HolidaySource::Custom,
                date: day,
                actual: day,
                approximate: false,
                day_index: None,
                order: CUSTOM_ORDER_BASE + u32::try_from(c.index).unwrap_or(0),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// holidays_in_range
// ---------------------------------------------------------------------------

/// One holiday occurrence in JSON (spec 2 §8.5), in field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayInstance {
    /// Preset rule id or custom id.
    pub id: String,
    /// Display name (` (observed)` / ` (substitute day)` when shifted and the
    /// observed date counts; the plain name under `observedMode: actual`).
    pub name: String,
    /// `preset` or `custom`.
    pub source: HolidaySource,
    /// Observed date.
    pub date: String,
    /// Actual date.
    pub actual_date: String,
    /// `date != actualDate`.
    pub shifted: bool,
    /// Tabular-Hijri estimate (UI shows "estimated").
    pub approximate: bool,
    /// Day 1..=3 of an Eid block, else `null`.
    pub day_index: Option<u32>,
    /// Every date that counts under `observedMode` (the observed date, the
    /// actual date, or both) falls on the user's weekend, so the holiday has
    /// no effect on counts.
    pub on_weekend: bool,
}

/// Request: `{ "startDate", "endDate", "calendar" }`. The range is inclusive
/// and may be given backwards.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HolidaysInRangeRequest {
    /// First date, `YYYY-MM-DD`.
    #[serde(default)]
    pub start_date: String,
    /// Last date, `YYYY-MM-DD`.
    #[serde(default)]
    pub end_date: String,
    /// The calendar.
    #[serde(default)]
    pub calendar: CalendarSpec,
}

/// Result, in field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidaysInRangeResult {
    /// The earlier date.
    pub start_date: String,
    /// The later date.
    pub end_date: String,
    pub preset: HolidayPreset,
    pub observed_mode: ObservedMode,
    /// Total instances with an effective date in the range.
    pub count: i64,
    /// Distinct effective dates in the range: several holidays on one date
    /// count once (FROZEN §5).
    pub holiday_days: i64,
    /// The first [`MAX_LISTED_INSTANCES`] instances.
    pub holidays: Vec<HolidayInstance>,
    /// More instances exist than are listed.
    pub truncated: bool,
    pub used_approximate_holidays: bool,
    pub warnings: Vec<String>,
    /// `12 holidays from 2027-01-01 to 2027-12-31`.
    pub summary_text: String,
}

/// Lists every holiday instance with an effective date (per `observedMode`)
/// in the inclusive range, sorted by `(date, source order, dayIndex, id)`.
/// Instances are listed separately even when they share a date.
pub fn holidays_in_range(req: &HolidaysInRangeRequest) -> Result<HolidaysInRangeResult, CoreError> {
    let a = parse_date(&req.start_date, Field::StartDate)?;
    let b = parse_date(&req.end_date, Field::EndDate)?;
    let cal = Calendar::new(&req.calendar)?;
    let (lo, hi) = (a.min(b), a.max(b));
    let all = cal.instances_between(lo, hi);
    let weekend = cal.weekend();
    let count = all.len() as i64;
    let mut holiday_days = 0_i64;
    cal.for_each_holiday_day(lo, hi + 1, |_| holiday_days += 1);
    let used_approximate_holidays = all.iter().any(|i| i.approximate);
    let actual_mode = cal.observed_mode() == ObservedMode::Actual;
    let holidays = all
        .iter()
        .take(MAX_LISTED_INSTANCES)
        .map(|i| {
            // `onWeekend` describes the dates that count under the observed
            // mode: true only when every one of them is a weekend day, so the
            // instance has no effect on any count.
            let (dates, n) = cal.effective_dates(i);
            let on_weekend = dates.iter().take(n).all(|&d| weekend.is_weekend(d));
            // Under `actual` the shifted date never counts, so the name drops
            // the observed/substitute suffix (as in business and grid output).
            let name = if actual_mode { &i.base_name } else { &i.name };
            HolidayInstance {
                id: i.id.clone(),
                name: name.clone(),
                source: i.source,
                date: format_iso(i.date),
                actual_date: format_iso(i.actual),
                shifted: i.date != i.actual,
                approximate: i.approximate,
                day_index: i.day_index,
                on_weekend,
            }
        })
        .collect();
    Ok(HolidaysInRangeResult {
        start_date: format_iso(lo),
        end_date: format_iso(hi),
        preset: cal.preset(),
        observed_mode: cal.observed_mode(),
        count,
        holiday_days,
        holidays,
        truncated: all.len() > MAX_LISTED_INSTANCES,
        used_approximate_holidays,
        warnings: cal.coverage_warnings(lo, hi),
        summary_text: format!(
            "{} from {} to {}",
            plural(count, "holiday"),
            format_iso(lo),
            format_iso(hi)
        ),
    })
}
