//! Egypt public holidays (spec 2 §4.3, FROZEN owner decisions and §10).
//!
//! No substitute days. Islamic holidays come from the tabular Hijri calendar
//! and are always marked approximate. Coptic Christmas and Coptic Easter are
//! included (both excludable); Sham el-Nessim is Orthodox Easter Monday.
//!
//! Not modelled: cabinet decrees that move a holiday (often to a Thursday) or
//! add bridge or extra Eid days. The remedy is to exclude the holiday and add
//! a custom one-off.

use crate::calendar::{HijriEvent, HolidayPreset};

use super::rules::{Era, HolidayRule, Observance, PresetDef, RuleKind};

const fn fixed(month: u32, day: u32) -> RuleKind {
    RuleKind::Fixed { month, day }
}

const fn hijri(anchor: HijriEvent, offset: i64, span: u32) -> RuleKind {
    RuleKind::Hijri {
        anchor,
        offset,
        span,
    }
}

const RULES: &[HolidayRule] = &[
    HolidayRule {
        id: "copticChristmas",
        name: "Coptic Christmas",
        eras: &[Era::from(
            2003,
            RuleKind::JulianFixed { month: 12, day: 25 },
        )],
    },
    HolidayRule {
        id: "revolutionDay25Jan",
        name: "January 25 Revolution & Police Day",
        eras: &[Era::from(2009, fixed(1, 25))],
    },
    HolidayRule {
        id: "sinaiLiberationDay",
        name: "Sinai Liberation Day",
        eras: &[Era::from(1983, fixed(4, 25))],
    },
    HolidayRule {
        id: "labourDay",
        name: "Labour Day",
        eras: &[Era::from(1900, fixed(5, 1))],
    },
    HolidayRule {
        id: "june30Revolution",
        name: "June 30 Revolution",
        eras: &[Era::from(2014, fixed(6, 30))],
    },
    HolidayRule {
        id: "revolutionDay23Jul",
        name: "July 23 Revolution Day",
        eras: &[Era::from(1953, fixed(7, 23))],
    },
    HolidayRule {
        id: "armedForcesDay",
        name: "Armed Forces Day",
        eras: &[Era::from(1974, fixed(10, 6))],
    },
    HolidayRule {
        id: "copticEaster",
        name: "Coptic Easter",
        eras: &[Era::from(
            1900,
            RuleKind::OrthodoxEasterOffset { offset: 0 },
        )],
    },
    HolidayRule {
        id: "shamElNessim",
        name: "Sham el-Nessim",
        eras: &[Era::from(
            1900,
            RuleKind::OrthodoxEasterOffset { offset: 1 },
        )],
    },
    HolidayRule {
        id: "islamicNewYear",
        name: "Islamic New Year",
        eras: &[Era::from(1900, hijri(HijriEvent::IslamicNewYear, 0, 1))],
    },
    HolidayRule {
        id: "mawlid",
        name: "Prophet's Birthday (Mawlid)",
        eras: &[Era::from(1900, hijri(HijriEvent::Mawlid, 0, 1))],
    },
    HolidayRule {
        id: "eidAlFitr",
        name: "Eid al-Fitr",
        eras: &[Era::from(1900, hijri(HijriEvent::EidAlFitr, 0, 3))],
    },
    HolidayRule {
        id: "arafatDay",
        name: "Arafat Day",
        // Anchored to Eid al-Adha, so an Adha override moves it too.
        eras: &[Era::from(1900, hijri(HijriEvent::EidAlAdha, -1, 1))],
    },
    HolidayRule {
        id: "eidAlAdha",
        name: "Eid al-Adha",
        eras: &[Era::from(1900, hijri(HijriEvent::EidAlAdha, 0, 3))],
    },
];

/// The Egypt preset.
pub const EG: PresetDef = PresetDef {
    preset: HolidayPreset::Eg,
    label: "Egypt",
    min_year: 2014,
    default_weekend: &[5, 6],
    observance: Observance::None,
    shifted_suffix: "",
    rules: RULES,
    moves: &[],
    extras: &[],
};
