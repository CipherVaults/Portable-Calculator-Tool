//! Holiday rule data model (spec 2 §3) and its evaluation for one year.
//!
//! A preset is static data: an ordered list of rules, each made of eras
//! (year ranges with a rule kind), plus an observance policy and, for the UK,
//! a table of one-off moves and extra days. Weekdays are ISO numbers
//! (1 = Monday .. 7 = Sunday), matching [`iso_weekday`].

use crate::calendar::{HijriEvent, HolidayPreset};
use crate::civil::{days_from_civil, days_in_month, iso_weekday, Civil, EpochDay};

use super::easter::{julian_fixed_in_year, orthodox_easter, western_easter};

/// How a rule produces its date(s) in a given year.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleKind {
    /// A fixed Gregorian month/day.
    Fixed {
        /// Month 1..=12.
        month: u32,
        /// Day of month.
        day: u32,
    },
    /// The `n`-th (1..=4) given weekday of a month.
    NthWeekday {
        /// Month 1..=12.
        month: u32,
        /// ISO weekday 1..=7.
        weekday: u32,
        /// Occurrence 1..=4.
        n: u32,
    },
    /// The last given weekday of a month.
    LastWeekday {
        /// Month 1..=12.
        month: u32,
        /// ISO weekday 1..=7.
        weekday: u32,
    },
    /// Western Easter Sunday plus `offset` days.
    EasterOffset {
        /// Days after Easter Sunday (negative = before).
        offset: i64,
    },
    /// Orthodox/Coptic Easter Sunday plus `offset` days.
    OrthodoxEasterOffset {
        /// Days after Orthodox Easter Sunday.
        offset: i64,
    },
    /// A fixed Julian-calendar month/day, converted to the Gregorian year.
    JulianFixed {
        /// Julian month 1..=12.
        month: i64,
        /// Julian day of month.
        day: i64,
    },
    /// An Islamic event: `span` consecutive days starting `offset` days after
    /// the (possibly overridden) anchor of `anchor`. Always approximate.
    Hijri {
        /// The event whose anchor (and override) this rule follows.
        anchor: HijriEvent,
        /// Days from the anchor to the first day (Arafat Day: -1).
        offset: i64,
        /// Number of consecutive days (Eids: 3).
        span: u32,
    },
}

/// A year range (inclusive) during which a rule has a given kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Era {
    /// First year.
    pub from_year: i64,
    /// Last year, or `None` for open-ended.
    pub to_year: Option<i64>,
    /// The rule kind during the era.
    pub kind: RuleKind,
}

impl Era {
    /// An open-ended era starting in `from_year`.
    pub const fn from(from_year: i64, kind: RuleKind) -> Self {
        Self {
            from_year,
            to_year: None,
            kind,
        }
    }

    /// A closed era.
    pub const fn between(from_year: i64, to_year: i64, kind: RuleKind) -> Self {
        Self {
            from_year,
            to_year: Some(to_year),
            kind,
        }
    }

    fn contains(&self, year: i64) -> bool {
        year >= self.from_year && self.to_year.is_none_or(|to| year <= to)
    }
}

/// Statutory shifting of holidays that fall on Saturday or Sunday. It is
/// independent of the user's weekend (spec 2 §1.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Observance {
    /// No shifting (Egypt).
    None,
    /// 5 U.S.C. 6103(b): Saturday -> preceding Friday, Sunday -> following
    /// Monday.
    UsFederal,
    /// England & Wales substitute days: the next Monday..Friday not already a
    /// bank holiday, processed in date order.
    UkSubstitute,
}

/// One holiday rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HolidayRule {
    /// Stable camelCase id (used in `excludedHolidays`).
    pub id: &'static str,
    /// English display name.
    pub name: &'static str,
    /// The first era containing the year wins; none means the rule is absent
    /// that year.
    pub eras: &'static [Era],
}

/// A one-off move of a rule's date in one year (UK proclamations).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OneOffMove {
    /// The year affected.
    pub year: i64,
    /// The rule id moved.
    pub id: &'static str,
    /// The new date `(year, month, day)`.
    pub to: (i64, u32, u32),
}

/// A one-off extra holiday (UK royal and national events).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OneOffExtra {
    /// Stable camelCase id (excludable).
    pub id: &'static str,
    /// English display name.
    pub name: &'static str,
    /// The date `(year, month, day)`.
    pub date: (i64, u32, u32),
}

/// A holiday preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PresetDef {
    /// The preset.
    pub preset: HolidayPreset,
    /// English label used in texts.
    pub label: &'static str,
    /// First year whose rule set is complete; the preset adds nothing before
    /// `max(1900, min_year)` (spec 2 §1.3).
    pub min_year: i64,
    /// The weekend the UI switches to when the preset is chosen (ISO days).
    pub default_weekend: &'static [u8],
    /// Statutory shifting policy.
    pub observance: Observance,
    /// Name suffix of shifted instances.
    pub shifted_suffix: &'static str,
    /// Rules, in source order.
    pub rules: &'static [HolidayRule],
    /// One-off moves.
    pub moves: &'static [OneOffMove],
    /// One-off extra days.
    pub extras: &'static [OneOffExtra],
}

impl PresetDef {
    /// Every excludable id: the rule ids, then the one-off extra ids.
    pub fn ids(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.rules
            .iter()
            .map(|r| r.id)
            .chain(self.extras.iter().map(|e| e.id))
    }
}

/// Day number of `(year, month, day)`.
pub(crate) fn ymd(year: i64, month: u32, day: u32) -> EpochDay {
    days_from_civil(Civil::new(year, month, day))
}

/// The `n`-th ISO weekday `wd` of a month:
/// `first + ((wd - weekday(first)) mod 7) + 7 * (n - 1)`.
pub fn nth_weekday(year: i64, month: u32, weekday: u32, n: u32) -> EpochDay {
    let first = ymd(year, month, 1);
    let delta = (i64::from(weekday) - i64::from(iso_weekday(first))).rem_euclid(7);
    first + delta + 7 * (i64::from(n) - 1)
}

/// The last ISO weekday `wd` of a month: `L - ((weekday(L) - wd) mod 7)`.
pub fn last_weekday(year: i64, month: u32, weekday: u32) -> EpochDay {
    let last = ymd(year, month, days_in_month(year, month));
    last - (i64::from(iso_weekday(last)) - i64::from(weekday)).rem_euclid(7)
}

/// The kind of `rule` in `year`, if the rule exists that year.
pub fn kind_in_year(rule: &HolidayRule, year: i64) -> Option<RuleKind> {
    rule.eras.iter().find(|e| e.contains(year)).map(|e| e.kind)
}

/// The single date of a non-Hijri rule kind in Gregorian `year`.
pub fn gregorian_date(kind: RuleKind, year: i64) -> Option<EpochDay> {
    match kind {
        RuleKind::Fixed { month, day } => Some(ymd(year, month, day)),
        RuleKind::NthWeekday { month, weekday, n } => Some(nth_weekday(year, month, weekday, n)),
        RuleKind::LastWeekday { month, weekday } => Some(last_weekday(year, month, weekday)),
        RuleKind::EasterOffset { offset } => Some(western_easter(year) + offset),
        RuleKind::OrthodoxEasterOffset { offset } => Some(orthodox_easter(year) + offset),
        RuleKind::JulianFixed { month, day } => julian_fixed_in_year(year, month, day),
        RuleKind::Hijri { .. } => None,
    }
}
