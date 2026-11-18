//! United Kingdom, England & Wales bank holidays (spec 2 §4.2, FROZEN §10).
//!
//! Substitute days follow the generic "next free weekday" rule (see
//! [`Observance::UkSubstitute`]). One-off proclamations are data: moves of a
//! regular holiday in one year, and extra days. The table is verified through
//! 2027; later proclamations need a release. Scotland and Northern Ireland are
//! out of scope.

use crate::calendar::HolidayPreset;

use super::rules::{Era, HolidayRule, Observance, OneOffExtra, OneOffMove, PresetDef, RuleKind};

const MON: u32 = 1;

const fn fixed(month: u32, day: u32) -> RuleKind {
    RuleKind::Fixed { month, day }
}

const fn last_monday(month: u32) -> RuleKind {
    RuleKind::LastWeekday {
        month,
        weekday: MON,
    }
}

const RULES: &[HolidayRule] = &[
    HolidayRule {
        id: "newYearsDay",
        name: "New Year's Day",
        eras: &[Era::from(1974, fixed(1, 1))],
    },
    HolidayRule {
        id: "goodFriday",
        name: "Good Friday",
        eras: &[Era::from(1900, RuleKind::EasterOffset { offset: -2 })],
    },
    HolidayRule {
        id: "easterMonday",
        name: "Easter Monday",
        eras: &[Era::from(1900, RuleKind::EasterOffset { offset: 1 })],
    },
    HolidayRule {
        id: "earlyMayBankHoliday",
        name: "Early May bank holiday",
        eras: &[Era::from(
            1978,
            RuleKind::NthWeekday {
                month: 5,
                weekday: MON,
                n: 1,
            },
        )],
    },
    HolidayRule {
        id: "springBankHoliday",
        name: "Spring bank holiday",
        eras: &[Era::from(1971, last_monday(5))],
    },
    HolidayRule {
        id: "summerBankHoliday",
        name: "Summer bank holiday",
        eras: &[Era::from(1971, last_monday(8))],
    },
    HolidayRule {
        id: "christmasDay",
        name: "Christmas Day",
        eras: &[Era::from(1900, fixed(12, 25))],
    },
    HolidayRule {
        id: "boxingDay",
        name: "Boxing Day",
        eras: &[Era::from(1900, fixed(12, 26))],
    },
];

const MOVES: &[OneOffMove] = &[
    OneOffMove {
        year: 1995,
        id: "earlyMayBankHoliday",
        to: (1995, 5, 8),
    },
    OneOffMove {
        year: 2002,
        id: "springBankHoliday",
        to: (2002, 6, 4),
    },
    OneOffMove {
        year: 2012,
        id: "springBankHoliday",
        to: (2012, 6, 4),
    },
    OneOffMove {
        year: 2020,
        id: "earlyMayBankHoliday",
        to: (2020, 5, 8),
    },
    OneOffMove {
        year: 2022,
        id: "springBankHoliday",
        to: (2022, 6, 2),
    },
];

const EXTRAS: &[OneOffExtra] = &[
    OneOffExtra {
        id: "royalWedding1981",
        name: "Royal Wedding Day",
        date: (1981, 7, 29),
    },
    OneOffExtra {
        id: "millennium1999",
        name: "Millennium Day",
        date: (1999, 12, 31),
    },
    OneOffExtra {
        id: "goldenJubilee2002",
        name: "Golden Jubilee bank holiday",
        date: (2002, 6, 3),
    },
    OneOffExtra {
        id: "royalWedding2011",
        name: "Royal Wedding Day",
        date: (2011, 4, 29),
    },
    OneOffExtra {
        id: "diamondJubilee2012",
        name: "Diamond Jubilee bank holiday",
        date: (2012, 6, 5),
    },
    OneOffExtra {
        id: "platinumJubilee2022",
        name: "Platinum Jubilee bank holiday",
        date: (2022, 6, 3),
    },
    OneOffExtra {
        id: "stateFuneral2022",
        name: "State Funeral of Queen Elizabeth II",
        date: (2022, 9, 19),
    },
    OneOffExtra {
        id: "coronation2023",
        name: "Coronation of King Charles III",
        date: (2023, 5, 8),
    },
];

/// The England & Wales preset.
pub const UK: PresetDef = PresetDef {
    preset: HolidayPreset::Uk,
    label: "UK (England & Wales)",
    min_year: 1978,
    default_weekend: &[6, 7],
    observance: Observance::UkSubstitute,
    shifted_suffix: " (substitute day)",
    rules: RULES,
    moves: MOVES,
    extras: EXTRAS,
};
