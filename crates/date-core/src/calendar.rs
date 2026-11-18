//! Business calendar: the JSON `calendar` object (FROZEN §4), its validation
//! (`validate_calendar`, spec 2 §8.2) and the compiled [`Calendar`] that the
//! business-day arithmetic and the month grid query.
//!
//! # Holiday window
//!
//! Holiday data exists only for the years 1900..=2199
//! ([`HOLIDAY_MIN_YEAR`]..=[`HOLIDAY_MAX_YEAR`]). A preset adds nothing
//! before `max(1900, preset.min_year)` (the first year its rule set is
//! complete) or after 2199, and yearly custom holidays apply only inside
//! 1900..=2199. Ranges that reach outside a window still compute (with the
//! weekend only) and carry `warnings: ["presetYearOutOfRange"]`.
//!
//! # Memoization
//!
//! A [`Calendar`] lazily expands holidays one Gregorian year at a time and
//! memoizes both the per-year instances and the per-year sorted set of
//! effective holiday dates, so counting or stepping across many years costs
//! O(years + holidays).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::civil::{
    civil_from_days, clamp_to_domain, days_in_month, in_range, iso_weekday, EpochDay,
    MAX_EPOCH_DAY, MIN_EPOCH_DAY,
};
use crate::error::CoreError;
use crate::format::weekday_name;
use crate::holidays::rules::ymd;
use crate::holidays::{
    custom_year_instances, preset_def, preset_window, preset_year_instances, HijriConfig,
    HolidaySource, Instance, CUSTOM_HOLIDAY_COPY_NAME,
};
use crate::parse::{parse_date, parse_weekend, trim_ascii_ws, workdays_per_week};

pub use crate::holidays::{HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR};

/// Largest number of custom holidays (spec 2 §8.2).
pub const MAX_CUSTOM_HOLIDAYS: usize = 100;
/// Largest custom holiday name, in Unicode scalar values.
pub const MAX_CUSTOM_NAME_CHARS: usize = 60;
/// Largest number of Hijri overrides.
pub const MAX_HIJRI_OVERRIDES: usize = 50;
/// Largest magnitude of `hijriOffsetDays`.
pub const MAX_HIJRI_OFFSET_DAYS: i64 = 2;
/// Largest distance of an override from the tabular date, in days.
pub const MAX_HIJRI_OVERRIDE_DELTA: i64 = 3;
/// First Hijri year an override may name (1900-01-01 is in 1317 AH).
pub const HIJRI_OVERRIDE_MIN_YEAR: i64 = 1317;
/// Last Hijri year an override may name (2199-12-31 is in 1626 AH; critique
/// wrong-vector 4 corrects spec 2's 1627).
pub const HIJRI_OVERRIDE_MAX_YEAR: i64 = 1626;
/// The only supported `schemaVersion`.
pub const CALENDAR_SCHEMA_VERSION: i64 = 1;
/// Warning carried by results whose range reaches outside a holiday window.
pub const WARNING_PRESET_YEAR_OUT_OF_RANGE: &str = "presetYearOutOfRange";

/// JSON `calendar` object. Every field is optional; the defaults are preset
/// `none` and a Saturday/Sunday weekend (FROZEN §4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarSpec {
    /// Weekend days as ISO weekdays 1..=7 (validated by
    /// [`parse_weekend`](crate::parse::parse_weekend)).
    #[serde(default = "default_weekend")]
    pub weekend: Vec<i64>,
    /// Holiday preset.
    #[serde(default)]
    pub preset: HolidayPreset,
    /// Global tabular-Hijri offset in days (valid range -2..=2).
    #[serde(default)]
    pub hijri_offset_days: i64,
    /// Per-year Islamic date overrides.
    #[serde(default)]
    pub hijri_overrides: Vec<HijriOverride>,
    /// Preset holidays the user switched off, per preset.
    #[serde(default)]
    pub excluded_holidays: ExcludedHolidays,
    /// User-defined holidays.
    #[serde(default)]
    pub custom_holidays: Vec<CustomHoliday>,
    /// Whether observed and/or actual holiday dates count.
    #[serde(default)]
    pub observed_mode: ObservedMode,
    /// Settings schema version (1).
    #[serde(default = "default_schema_version")]
    pub schema_version: i64,
}

fn default_weekend() -> Vec<i64> {
    vec![6, 7]
}

const fn default_schema_version() -> i64 {
    CALENDAR_SCHEMA_VERSION
}

const fn default_true() -> bool {
    true
}

impl Default for CalendarSpec {
    fn default() -> Self {
        Self {
            weekend: default_weekend(),
            preset: HolidayPreset::default(),
            hijri_offset_days: 0,
            hijri_overrides: Vec::new(),
            excluded_holidays: ExcludedHolidays::default(),
            custom_holidays: Vec::new(),
            observed_mode: ObservedMode::default(),
            schema_version: default_schema_version(),
        }
    }
}

/// Holiday preset (single value, FROZEN §4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HolidayPreset {
    /// No preset holidays.
    #[default]
    None,
    /// US federal holidays.
    Us,
    /// United Kingdom, England & Wales bank holidays.
    Uk,
    /// Egypt public holidays.
    Eg,
}

impl HolidayPreset {
    /// The JSON value (`none`, `us`, `uk`, `eg`).
    pub const fn key(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Us => "us",
            Self::Uk => "uk",
            Self::Eg => "eg",
        }
    }

    /// English label: `None`, `US federal`, `UK (England & Wales)`, `Egypt`.
    pub fn label(self) -> &'static str {
        preset_def(self).map_or("None", |d| d.label)
    }

    /// The weekend the UI switches to when this preset is selected
    /// (us/uk/none: Sat/Sun, eg: Fri/Sat). The user may change it afterwards.
    pub fn default_weekend(self) -> Vec<i64> {
        preset_def(self).map_or_else(default_weekend, |d| {
            d.default_weekend.iter().map(|&x| i64::from(x)).collect()
        })
    }
}

/// Which holiday dates count (spec 2 §6).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObservedMode {
    /// The observed (substitute) date.
    #[default]
    Observed,
    /// The actual date.
    Actual,
    /// Both dates.
    Both,
}

/// Islamic event that a Hijri override re-anchors (spec 2 §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HijriEvent {
    /// 1 Muharram.
    IslamicNewYear,
    /// 12 Rabi al-Awwal.
    Mawlid,
    /// 1 Shawwal.
    EidAlFitr,
    /// 10 Dhu al-Hijja.
    EidAlAdha,
}

/// `{hijriYear, event, date}` override of a tabular Islamic date.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HijriOverride {
    /// Hijri year (valid range 1317..=1626).
    pub hijri_year: i64,
    /// The event being re-anchored.
    pub event: HijriEvent,
    /// The announced Gregorian date, `YYYY-MM-DD`.
    pub date: String,
}

/// Excluded preset holiday ids, per preset (camelCase ids).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExcludedHolidays {
    /// US ids.
    #[serde(default)]
    pub us: Vec<String>,
    /// UK ids.
    #[serde(default)]
    pub uk: Vec<String>,
    /// Egypt ids.
    #[serde(default)]
    pub eg: Vec<String>,
}

impl ExcludedHolidays {
    /// The list for one preset (empty for `none`).
    pub fn for_preset(&self, preset: HolidayPreset) -> &[String] {
        match preset {
            HolidayPreset::None => &[],
            HolidayPreset::Us => &self.us,
            HolidayPreset::Uk => &self.uk,
            HolidayPreset::Eg => &self.eg,
        }
    }
}

/// Kind of a custom holiday.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CustomHolidayKind {
    /// A single date (`date`).
    Date,
    /// Every year on `month`/`day`, optionally from `fromYear`.
    Yearly,
}

/// A user-defined holiday. A flat struct with optional kind-specific fields
/// (spec 2 §8.1); validation enforces which fields each kind needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomHoliday {
    /// `c-xxxxxxxx` id generated by the UI.
    pub id: String,
    /// Display name (1..=60 characters).
    pub name: String,
    /// One-off date or yearly.
    pub kind: CustomHolidayKind,
    /// Date for kind `date`.
    #[serde(default)]
    pub date: Option<String>,
    /// Month for kind `yearly`.
    #[serde(default)]
    pub month: Option<i64>,
    /// Day for kind `yearly`.
    #[serde(default)]
    pub day: Option<i64>,
    /// First year for kind `yearly`.
    #[serde(default)]
    pub from_year: Option<i64>,
    /// Disabled entries are kept but ignored.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

// ---------------------------------------------------------------------------
// Weekend mask
// ---------------------------------------------------------------------------

/// The weekend as a bitmask: bit `iso - 1` is set for each weekend day
/// (bit 0 = Monday .. bit 6 = Sunday). JSON carries the ISO array instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WeekendMask(u8);

impl WeekendMask {
    /// Saturday and Sunday (the default).
    pub const SAT_SUN: WeekendMask = WeekendMask(0x60);
    /// No weekend at all.
    pub const NONE: WeekendMask = WeekendMask(0);

    /// Validates an ISO weekday list (`invalid_weekend` / `no_working_days`).
    pub fn from_iso_days(days: &[i64]) -> Result<Self, CoreError> {
        parse_weekend(days).map(Self)
    }

    /// The raw bits (0x00..=0x7E).
    pub const fn bits(self) -> u8 {
        self.0
    }

    /// `true` iff ISO weekday `iso` (1..=7) is a weekend day.
    pub const fn contains_iso(self, iso: u32) -> bool {
        iso >= 1 && iso <= 7 && self.0 & (1 << (iso - 1)) != 0
    }

    /// `true` iff day `z` falls on a weekend day.
    pub fn is_weekend(self, z: EpochDay) -> bool {
        self.contains_iso(iso_weekday(z))
    }

    /// Working days per week (`7 - popcount`), 1..=7.
    pub const fn workdays_per_week(self) -> i64 {
        workdays_per_week(self.0) as i64
    }

    /// The weekend as a sorted ISO array (the JSON form).
    pub fn iso_days(self) -> Vec<u8> {
        (1..=7_u8)
            .filter(|&d| self.contains_iso(u32::from(d)))
            .collect()
    }

    /// Weekend day names joined with `", "` in ISO order, or `None`.
    pub fn names_text(self) -> String {
        let names: Vec<&str> = (1..=7)
            .filter(|&d| self.contains_iso(d))
            .map(weekday_name)
            .collect();
        if names.is_empty() {
            "None".to_string()
        } else {
            names.join(", ")
        }
    }

    /// Number of weekend days in `[from, to_excl)`, by week arithmetic:
    /// `full_weeks * popcount + (weekend days among the < 7 remaining days)`.
    ///
    /// Total on every `i64` pair: the span is taken in `i128` (`from + i`
    /// stays below `to_excl`), and a count too large for an `i64` (only
    /// possible for spans beyond about 10^18 days) saturates at `i64::MAX`.
    pub fn weekend_days_in(self, from: EpochDay, to_excl: EpochDay) -> i64 {
        let n = i128::from(to_excl) - i128::from(from);
        if n <= 0 {
            return 0;
        }
        let per_week = i128::from(7 - self.workdays_per_week());
        let full = n.div_euclid(7);
        // `rem_euclid(7)` is 0..=6, so the cast is lossless.
        let rest = (0..n.rem_euclid(7) as i64)
            .filter(|&i| self.is_weekend(from + i))
            .count() as i128;
        i64::try_from(full * per_week + rest).unwrap_or(i64::MAX)
    }
}

impl Default for WeekendMask {
    fn default() -> Self {
        Self::SAT_SUN
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// A validated custom holiday, ready for expansion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompiledCustom {
    /// Position in `customHolidays` (sort tie-break).
    pub index: usize,
    pub id: String,
    pub name: String,
    pub rule: CustomRule,
}

/// When a custom holiday occurs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CustomRule {
    /// One date.
    Date(EpochDay),
    /// Every year from `from_year` on `month`/`day` (Feb 29: leap years only).
    Yearly {
        month: u32,
        day: u32,
        from_year: i64,
    },
}

/// Everything `validate_calendar` derives from a spec.
struct Checked {
    weekend: WeekendMask,
    overrides: Vec<(i64, HijriEvent, EpochDay)>,
    excluded: ExcludedHolidays,
    customs: Vec<CompiledCustom>,
}

/// Parses a settings date strictly: no surrounding whitespace, `YYYY-MM-DD`,
/// a real date.
fn parse_strict_date(s: &str) -> Option<EpochDay> {
    if trim_ascii_ws(s).len() != s.len() {
        return None;
    }
    parse_date(s, crate::error::Field::Date).ok()
}

/// Characters banned anywhere in a custom holiday name (spec 2 §8.2):
/// C0/C1 controls, bidi marks, embeddings, overrides and isolates, line and
/// paragraph separators, and the BOM. (Rust strings cannot hold the lone
/// surrogates the JS mirror also rejects.)
fn is_banned_name_char(c: char) -> bool {
    matches!(c,
        '\u{0}'..='\u{1F}'
        | '\u{7F}'..='\u{9F}'
        | '\u{200E}'
        | '\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2066}'..='\u{2069}'
        | '\u{2028}'
        | '\u{2029}'
        | '\u{FEFF}')
}

/// The problem with a custom holiday name, if any. Banned characters are
/// checked before whitespace so that the Rust (`char::is_whitespace`) and JS
/// (`\s`) whitespace sets, which differ only in U+0085 and U+FEFF (both
/// banned), always give the same answer.
fn name_problem(name: &str) -> Option<&'static str> {
    if name.chars().any(is_banned_name_char) {
        return Some("the name contains a character that is not allowed");
    }
    if name.is_empty() {
        return Some("a name is required");
    }
    if name.starts_with(char::is_whitespace) || name.ends_with(char::is_whitespace) {
        return Some("the name must not start or end with a space");
    }
    if name.chars().count() > MAX_CUSTOM_NAME_CHARS {
        return Some("the name must be at most 60 characters");
    }
    None
}

/// `^c-[0-9a-f]{8}$`.
fn is_valid_custom_id(id: &str) -> bool {
    id.len() == 10
        && id.strip_prefix("c-").is_some_and(|hex| {
            hex.bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        })
}

fn in_holiday_years(y: i64) -> bool {
    (HOLIDAY_MIN_YEAR..=HOLIDAY_MAX_YEAR).contains(&y)
}

fn check_custom(n: usize, c: &CustomHoliday, seen: &[String]) -> Result<CustomRule, CoreError> {
    let err = |problem: &str| CoreError::invalid_custom_holiday(n, problem);
    if !is_valid_custom_id(&c.id) {
        return Err(err(
            "the id must be \"c-\" followed by 8 lowercase hexadecimal digits",
        ));
    }
    if seen.contains(&c.id) {
        return Err(err("the id is already used by another custom holiday"));
    }
    if let Some(problem) = name_problem(&c.name) {
        return Err(err(problem));
    }
    match c.kind {
        CustomHolidayKind::Date => {
            let (Some(date), None, None, None) = (&c.date, c.month, c.day, c.from_year) else {
                return Err(err(
                    "a one-off holiday takes a date and no month, day or start year",
                ));
            };
            let z = parse_strict_date(date)
                .ok_or_else(|| err("the date must be a real date in YYYY-MM-DD format"))?;
            if !in_holiday_years(civil_from_days(z).year) {
                return Err(err("the date must be between 1900-01-01 and 2199-12-31"));
            }
            Ok(CustomRule::Date(z))
        }
        CustomHolidayKind::Yearly => {
            let (None, Some(month), Some(day)) = (&c.date, c.month, c.day) else {
                return Err(err("a yearly holiday takes a month and a day and no date"));
            };
            let month = u32::try_from(month)
                .ok()
                .filter(|m| (1..=12).contains(m))
                .ok_or_else(|| err("the month must be between 1 and 12"))?;
            // Leap year 2000 so that Feb 29 is accepted (it fires only in
            // leap years).
            let day = u32::try_from(day)
                .ok()
                .filter(|d| (1..=days_in_month(2000, month)).contains(d))
                .ok_or_else(|| err("the day does not exist in that month"))?;
            let from_year = c.from_year.unwrap_or(HOLIDAY_MIN_YEAR);
            if !in_holiday_years(from_year) {
                return Err(err("the start year must be between 1900 and 2199"));
            }
            Ok(CustomRule::Yearly {
                month,
                day,
                from_year,
            })
        }
    }
}

fn check_excluded(preset: HolidayPreset, ids: &[String]) -> Result<Vec<String>, CoreError> {
    let Some(def) = preset_def(preset) else {
        return Ok(Vec::new());
    };
    let known: Vec<&str> = def.ids().collect();
    if ids.len() > known.len() {
        return Err(CoreError::invalid_excluded_holiday(
            preset.key(),
            &format!("at most {} entries are allowed", known.len()),
        ));
    }
    let mut out: Vec<String> = Vec::with_capacity(ids.len());
    for (i, id) in ids.iter().enumerate() {
        if !known.contains(&id.as_str()) {
            return Err(CoreError::invalid_excluded_holiday(
                preset.key(),
                &format!("entry {} is not a holiday of this preset", i + 1),
            ));
        }
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    Ok(out)
}

/// Validates a calendar spec. Order (the first error wins): weekend, schema
/// version, Hijri offset, Hijri overrides, excluded holidays (us, uk, eg),
/// custom holidays. Each list's length is checked before its entries, so
/// work is bounded for any input.
fn check(spec: &CalendarSpec) -> Result<Checked, CoreError> {
    let weekend = WeekendMask::from_iso_days(&spec.weekend)?;
    if spec.schema_version != CALENDAR_SCHEMA_VERSION {
        return Err(CoreError::invalid_schema_version());
    }
    if !(-MAX_HIJRI_OFFSET_DAYS..=MAX_HIJRI_OFFSET_DAYS).contains(&spec.hijri_offset_days) {
        return Err(CoreError::invalid_hijri_offset());
    }

    if spec.hijri_overrides.len() > MAX_HIJRI_OVERRIDES {
        return Err(CoreError::too_many_hijri_overrides(MAX_HIJRI_OVERRIDES));
    }
    let mut overrides: Vec<(i64, HijriEvent, EpochDay)> = Vec::new();
    for (i, o) in spec.hijri_overrides.iter().enumerate() {
        let err = |problem: &str| CoreError::invalid_hijri_override(i + 1, problem);
        if !(HIJRI_OVERRIDE_MIN_YEAR..=HIJRI_OVERRIDE_MAX_YEAR).contains(&o.hijri_year) {
            return Err(err("the Hijri year must be between 1317 and 1626"));
        }
        let z = parse_strict_date(&o.date)
            .ok_or_else(|| err("the date must be a real date in YYYY-MM-DD format"))?;
        let tabular = o.event.tabular_day(o.hijri_year);
        if (z - tabular).abs() > MAX_HIJRI_OVERRIDE_DELTA {
            return Err(err(&format!(
                "the date must be within 3 days of the estimated date {}",
                crate::format::format_iso(tabular)
            )));
        }
        if overrides
            .iter()
            .any(|&(y, e, _)| y == o.hijri_year && e == o.event)
        {
            return Err(err("the same year and event appear more than once"));
        }
        overrides.push((o.hijri_year, o.event, z));
    }

    let excluded = ExcludedHolidays {
        us: check_excluded(HolidayPreset::Us, &spec.excluded_holidays.us)?,
        uk: check_excluded(HolidayPreset::Uk, &spec.excluded_holidays.uk)?,
        eg: check_excluded(HolidayPreset::Eg, &spec.excluded_holidays.eg)?,
    };

    if spec.custom_holidays.len() > MAX_CUSTOM_HOLIDAYS {
        return Err(CoreError::too_many_custom_holidays(MAX_CUSTOM_HOLIDAYS));
    }
    let mut seen: Vec<String> = Vec::new();
    let mut customs = Vec::new();
    for (i, c) in spec.custom_holidays.iter().enumerate() {
        let rule = check_custom(i + 1, c, &seen)?;
        seen.push(c.id.clone());
        if c.enabled {
            customs.push(CompiledCustom {
                index: i,
                id: c.id.clone(),
                name: c.name.clone(),
                rule,
            });
        }
    }

    Ok(Checked {
        weekend,
        overrides,
        excluded,
        customs,
    })
}

/// Request of [`validate_calendar`]: `{ "calendar": {...} }`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateCalendarRequest {
    /// The calendar to validate.
    #[serde(default)]
    pub calendar: CalendarSpec,
}

/// Result of [`validate_calendar`], in field order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateCalendarResult {
    /// The normalized calendar: weekend sorted ascending, excluded ids
    /// deduplicated (first occurrence kept); everything else unchanged.
    pub calendar: CalendarSpec,
    /// Weekend names, `"Saturday, Sunday"` or `"None"`.
    pub weekend_text: String,
    /// Working days per week, 1..=7.
    pub workdays_per_week: i64,
    /// Preset label, for example `US federal` or `None`.
    pub preset_label: String,
    /// First year the preset adds holidays (`null` for preset `none`).
    pub preset_first_year: Option<i64>,
    /// Last year the preset adds holidays (`null` for preset `none`).
    pub preset_last_year: Option<i64>,
    /// Number of enabled custom holidays.
    pub enabled_custom_holidays: i64,
    /// `Holidays: US federal; weekend: Saturday, Sunday; 2 custom holidays`.
    pub summary_text: String,
}

/// Validates and normalizes a calendar (FROZEN §2/§4, spec 2 §8.2).
pub fn validate_calendar(
    req: &ValidateCalendarRequest,
) -> Result<ValidateCalendarResult, CoreError> {
    let spec = &req.calendar;
    let checked = check(spec)?;
    let mut calendar = spec.clone();
    calendar.weekend = checked
        .weekend
        .iso_days()
        .into_iter()
        .map(i64::from)
        .collect();
    calendar.excluded_holidays = checked.excluded;
    let window = preset_window(spec.preset);
    let enabled = checked.customs.len() as i64;
    let weekend_text = checked.weekend.names_text();
    let summary_text = format!(
        "Holidays: {}; weekend: {}; {}",
        spec.preset.label(),
        weekend_text,
        crate::format::plural(enabled, "custom holiday")
    );
    Ok(ValidateCalendarResult {
        calendar,
        weekend_text,
        workdays_per_week: checked.weekend.workdays_per_week(),
        preset_label: spec.preset.label().to_string(),
        preset_first_year: window.map(|w| w.0),
        preset_last_year: window.map(|w| w.1),
        enabled_custom_holidays: enabled,
        summary_text,
    })
}

// ---------------------------------------------------------------------------
// Compiled calendar
// ---------------------------------------------------------------------------

/// All holidays whose effective date is one particular day, merged: same-date
/// holidays count once and each name appears once (FROZEN §5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HolidayDay {
    /// The day.
    pub day: EpochDay,
    /// Actual (unshifted) date of the first holiday merged into this day, in
    /// source order; equals `day` unless that holiday is an observed or
    /// substitute day.
    pub actual: EpochDay,
    /// Display names, deduplicated, in source order (custom names included).
    pub names: Vec<String>,
    /// The same names for `copyText`/trace text: custom holidays appear as
    /// `Custom holiday`, so copied text (which history stores) never carries
    /// a custom name (FROZEN §11) and stays ASCII.
    pub copy_names: Vec<String>,
    /// Any of the merged holidays is a tabular-Hijri estimate.
    pub approximate: bool,
}

impl HolidayDay {
    /// `name / name` for copy text, with ` (estimated)` when approximate.
    pub fn copy_label(&self) -> String {
        let mut s = self.copy_names.join(" / ");
        if self.approximate {
            s.push_str(" (estimated)");
        }
        s
    }
}

/// A validated, compiled business calendar with per-year holiday memo.
#[derive(Debug)]
pub struct Calendar {
    weekend: WeekendMask,
    preset: HolidayPreset,
    observed_mode: ObservedMode,
    excluded: Vec<String>,
    hijri: HijriConfig,
    customs: Vec<CompiledCustom>,
    /// Instances by *actual* Gregorian year.
    by_actual_year: RefCell<BTreeMap<i64, Rc<Vec<Instance>>>>,
    /// Effective holiday days by Gregorian year, sorted by day.
    by_year: RefCell<BTreeMap<i64, Rc<Vec<HolidayDay>>>>,
}

impl Calendar {
    /// Validates `spec` and compiles it.
    pub fn new(spec: &CalendarSpec) -> Result<Self, CoreError> {
        let checked = check(spec)?;
        Ok(Self {
            weekend: checked.weekend,
            preset: spec.preset,
            observed_mode: spec.observed_mode,
            excluded: checked.excluded.for_preset(spec.preset).to_vec(),
            hijri: HijriConfig {
                offset_days: spec.hijri_offset_days,
                overrides: checked.overrides,
            },
            customs: checked.customs,
            by_actual_year: RefCell::new(BTreeMap::new()),
            by_year: RefCell::new(BTreeMap::new()),
        })
    }

    /// The weekend.
    pub fn weekend(&self) -> WeekendMask {
        self.weekend
    }

    /// The preset.
    pub fn preset(&self) -> HolidayPreset {
        self.preset
    }

    /// The observed mode.
    pub fn observed_mode(&self) -> ObservedMode {
        self.observed_mode
    }

    /// Number of enabled custom holidays.
    pub fn enabled_custom_holidays(&self) -> usize {
        self.customs.len()
    }

    /// `true` iff the calendar can have any holiday at all.
    pub fn has_holidays(&self) -> bool {
        self.preset != HolidayPreset::None || !self.customs.is_empty()
    }

    /// Instances whose *actual* date is in Gregorian `year` (memoized):
    /// preset rules (after one-offs, observance and exclusions), then custom
    /// holidays.
    pub(crate) fn instances_for_actual_year(&self, year: i64) -> Rc<Vec<Instance>> {
        if let Some(hit) = self.by_actual_year.borrow().get(&year) {
            return Rc::clone(hit);
        }
        let mut list = preset_def(self.preset)
            .map(|def| preset_year_instances(def, year, &self.hijri, &self.excluded))
            .unwrap_or_default();
        list.extend(custom_year_instances(&self.customs, year));
        let rc = Rc::new(list);
        self.by_actual_year
            .borrow_mut()
            .insert(year, Rc::clone(&rc));
        rc
    }

    /// Effective dates of an instance under the observed mode.
    pub(crate) fn effective_dates(&self, inst: &Instance) -> ([EpochDay; 2], usize) {
        match self.observed_mode {
            ObservedMode::Observed => ([inst.date, inst.date], 1),
            ObservedMode::Actual => ([inst.actual, inst.actual], 1),
            ObservedMode::Both if inst.date == inst.actual => ([inst.date, inst.date], 1),
            ObservedMode::Both => ([inst.date, inst.actual], 2),
        }
    }

    /// The sorted, merged holiday days of Gregorian `year` (memoized). An
    /// effective date can come from an instance whose actual date is in the
    /// neighbouring year (US New Year's Day observed on Dec 31).
    pub fn holiday_days_in_year(&self, year: i64) -> Rc<Vec<HolidayDay>> {
        if let Some(hit) = self.by_year.borrow().get(&year) {
            return Rc::clone(hit);
        }
        let mut hits: Vec<(EpochDay, Instance)> = Vec::new();
        if self.has_holidays() && (HOLIDAY_MIN_YEAR..=HOLIDAY_MAX_YEAR).contains(&year) {
            for y in year - 1..=year + 1 {
                for inst in self.instances_for_actual_year(y).iter() {
                    let (dates, n) = self.effective_dates(inst);
                    for &d in dates.iter().take(n) {
                        if civil_from_days(d).year == year {
                            hits.push((d, inst.clone()));
                        }
                    }
                }
            }
        }
        hits.sort_by(|(da, a), (db, b)| {
            (da, a.order, a.day_index, &a.id).cmp(&(db, b.order, b.day_index, &b.id))
        });
        let mut days: Vec<HolidayDay> = Vec::new();
        for (d, inst) in hits {
            // On its observed date a shifted holiday carries the suffix; on
            // its actual date (observed mode `both`) the plain name.
            let name = if d == inst.date {
                inst.name.clone()
            } else {
                inst.base_name.clone()
            };
            let copy_name = if inst.source == HolidaySource::Custom {
                CUSTOM_HOLIDAY_COPY_NAME.to_string()
            } else {
                name.clone()
            };
            match days.last_mut() {
                Some(last) if last.day == d => {
                    if !last.names.contains(&name) {
                        last.names.push(name);
                    }
                    if !last.copy_names.contains(&copy_name) {
                        last.copy_names.push(copy_name);
                    }
                    last.approximate |= inst.approximate;
                }
                _ => days.push(HolidayDay {
                    day: d,
                    actual: if d == inst.date { inst.actual } else { d },
                    names: vec![name],
                    copy_names: vec![copy_name],
                    approximate: inst.approximate,
                }),
            }
        }
        let rc = Rc::new(days);
        self.by_year.borrow_mut().insert(year, Rc::clone(&rc));
        rc
    }

    /// Holiday days in `[from, to_excl)`, in date order, through `f`. Any
    /// `i64` bounds are accepted: they are clamped to the supported days
    /// first (no holiday exists outside 1900..=2199 anyway).
    pub fn for_each_holiday_day(
        &self,
        from: EpochDay,
        to_excl: EpochDay,
        mut f: impl FnMut(&HolidayDay),
    ) {
        let (from, to_excl) = (clamp_to_domain(from), clamp_to_domain(to_excl));
        if to_excl <= from || !self.has_holidays() {
            return;
        }
        let y0 = civil_from_days(from).year.max(HOLIDAY_MIN_YEAR);
        let y1 = civil_from_days(to_excl - 1).year.min(HOLIDAY_MAX_YEAR);
        for y in y0..=y1 {
            let days = self.holiday_days_in_year(y);
            let start = days.partition_point(|h| h.day < from);
            for h in days.iter().skip(start).take_while(|h| h.day < to_excl) {
                f(h);
            }
        }
    }

    /// The merged holiday on day `z`, if any (`None` outside
    /// 0001-01-01..=9999-12-31).
    pub fn holiday_on(&self, z: EpochDay) -> Option<HolidayDay> {
        if !in_range(z) {
            return None;
        }
        let mut found = None;
        self.for_each_holiday_day(z, z + 1, |h| found = Some(h.clone()));
        found
    }

    /// `true` iff `z` is a holiday (on any weekday); `false` outside
    /// 0001-01-01..=9999-12-31.
    pub fn is_holiday(&self, z: EpochDay) -> bool {
        if !self.has_holidays() || !in_range(z) {
            return false;
        }
        let year = civil_from_days(z).year;
        if !(HOLIDAY_MIN_YEAR..=HOLIDAY_MAX_YEAR).contains(&year) {
            return false;
        }
        let days = self.holiday_days_in_year(year);
        days.binary_search_by_key(&z, |h| h.day).is_ok()
    }

    /// `true` iff `z` is a supported day (0001-01-01..=9999-12-31) that is
    /// neither a weekend day nor a holiday.
    pub fn is_business_day(&self, z: EpochDay) -> bool {
        in_range(z) && !self.weekend.is_weekend(z) && !self.is_holiday(z)
    }

    /// Whether an approximate (tabular Hijri) holiday removed a working day
    /// in `[from, to_excl)`. Estimates that fall on the weekend do not affect
    /// any count, so they do not set `usedApproximateHolidays`.
    pub fn any_approximate_in(&self, from: EpochDay, to_excl: EpochDay) -> bool {
        let mut any = false;
        self.for_each_holiday_day(from, to_excl, |h| {
            any |= h.approximate && !self.weekend.is_weekend(h.day);
        });
        any
    }

    /// `["presetYearOutOfRange"]` when the days `lo..=hi` reach a year outside
    /// the preset's window, or (with an enabled yearly custom holiday)
    /// outside 1900..=2199; otherwise empty. Never an error (FROZEN §4).
    pub fn coverage_warnings(&self, lo: EpochDay, hi: EpochDay) -> Vec<String> {
        // Clamped so that any `i64` is accepted; only the year matters here.
        let year = |z: EpochDay| civil_from_days(z.clamp(MIN_EPOCH_DAY, MAX_EPOCH_DAY)).year;
        let (y0, y1) = (year(lo), year(hi));
        let outside = |(first, last): (i64, i64)| y0 < first || y1 > last;
        let preset_out = preset_window(self.preset).is_some_and(outside);
        let custom_out = self
            .customs
            .iter()
            .any(|c| matches!(c.rule, CustomRule::Yearly { .. }))
            && outside((HOLIDAY_MIN_YEAR, HOLIDAY_MAX_YEAR));
        if preset_out || custom_out {
            vec![WARNING_PRESET_YEAR_OUT_OF_RANGE.to_string()]
        } else {
            Vec::new()
        }
    }

    /// Every instance with an effective date in `lo..=hi`, sorted by
    /// `(date, source order, dayIndex, id)` and deduplicated on
    /// `(id, dayIndex, date)`.
    pub(crate) fn instances_between(&self, lo: EpochDay, hi: EpochDay) -> Vec<Instance> {
        let mut out: Vec<Instance> = Vec::new();
        if hi < lo || !self.has_holidays() {
            return out;
        }
        let y0 = (civil_from_days(lo).year - 1).max(HOLIDAY_MIN_YEAR);
        let y1 = (civil_from_days(hi).year + 1).min(HOLIDAY_MAX_YEAR);
        for y in y0..=y1 {
            for inst in self.instances_for_actual_year(y).iter() {
                let (dates, n) = self.effective_dates(inst);
                if dates.iter().take(n).any(|&d| lo <= d && d <= hi) {
                    out.push(inst.clone());
                }
            }
        }
        out.sort_by(|a, b| {
            (a.date, a.order, a.day_index, &a.id).cmp(&(b.date, b.order, b.day_index, &b.id))
        });
        out.dedup_by(|a, b| a.id == b.id && a.day_index == b.day_index && a.date == b.date);
        out
    }
}

/// Day number of a custom yearly holiday in `year`, if it exists that year.
pub(crate) fn yearly_day(year: i64, month: u32, day: u32) -> Option<EpochDay> {
    (day <= days_in_month(year, month)).then(|| ymd(year, month, day))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weekend_mask_round_trip() {
        let m = WeekendMask::from_iso_days(&[7, 6]).unwrap();
        assert_eq!(m, WeekendMask::SAT_SUN);
        assert_eq!(m.iso_days(), vec![6, 7]);
        assert_eq!(m.names_text(), "Saturday, Sunday");
        assert_eq!(WeekendMask::NONE.names_text(), "None");
        assert_eq!(m.workdays_per_week(), 5);
    }

    #[test]
    fn custom_ids_and_names() {
        assert!(is_valid_custom_id("c-0123abcd"));
        assert!(!is_valid_custom_id("c-0123ABCD"));
        assert!(!is_valid_custom_id("c-0123abc"));
        assert!(name_problem("Founders' Day").is_none());
        assert!(name_problem(&"x".repeat(60)).is_none());
        assert!(name_problem(&"\u{0639}".repeat(60)).is_none());
        assert!(name_problem(&"x".repeat(61)).is_some());
        assert!(name_problem(" x").is_some());
        assert!(name_problem("x\u{202E}").is_some());
        assert!(name_problem("").is_some());
    }

    #[test]
    fn defaults() {
        let spec = CalendarSpec::default();
        assert_eq!(spec.weekend, vec![6, 7]);
        assert_eq!(spec.preset, HolidayPreset::None);
        assert_eq!(HolidayPreset::Eg.default_weekend(), vec![5, 6]);
        let cal = Calendar::new(&spec).unwrap();
        assert!(!cal.has_holidays());
    }
}
