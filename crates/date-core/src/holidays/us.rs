//! US federal holidays (spec 2 §4.1): 5 U.S.C. 6103(a) with the Saturday ->
//! Friday / Sunday -> Monday observance of 6103(b) and EO 11582.
//!
//! Not modelled: Inauguration Day (DC area only) and ad-hoc executive-order
//! closures such as Christmas Eve; users can add them as custom holidays.

use crate::calendar::HolidayPreset;

use super::rules::{Era, HolidayRule, Observance, PresetDef, RuleKind};

const MON: u32 = 1;
const THU: u32 = 4;

const fn fixed(month: u32, day: u32) -> RuleKind {
    RuleKind::Fixed { month, day }
}

const fn nth(month: u32, weekday: u32, n: u32) -> RuleKind {
    RuleKind::NthWeekday { month, weekday, n }
}

const RULES: &[HolidayRule] = &[
    HolidayRule {
        id: "newYearsDay",
        name: "New Year's Day",
        eras: &[Era::from(1971, fixed(1, 1))],
    },
    HolidayRule {
        id: "mlkDay",
        name: "Birthday of Martin Luther King, Jr.",
        eras: &[Era::from(1986, nth(1, MON, 3))],
    },
    HolidayRule {
        id: "washingtonsBirthday",
        name: "Washington's Birthday (Presidents' Day)",
        eras: &[Era::from(1971, nth(2, MON, 3))],
    },
    HolidayRule {
        id: "memorialDay",
        name: "Memorial Day",
        eras: &[Era::from(
            1971,
            RuleKind::LastWeekday {
                month: 5,
                weekday: MON,
            },
        )],
    },
    HolidayRule {
        id: "juneteenth",
        name: "Juneteenth National Independence Day",
        eras: &[Era::from(2021, fixed(6, 19))],
    },
    HolidayRule {
        id: "independenceDay",
        name: "Independence Day",
        eras: &[Era::from(1971, fixed(7, 4))],
    },
    HolidayRule {
        id: "laborDay",
        name: "Labor Day",
        eras: &[Era::from(1971, nth(9, MON, 1))],
    },
    HolidayRule {
        id: "columbusDay",
        name: "Columbus Day",
        eras: &[Era::from(1971, nth(10, MON, 2))],
    },
    HolidayRule {
        id: "veteransDay",
        name: "Veterans Day",
        // The Uniform Monday Holiday Act moved it to the 4th Monday of
        // October for 1971-1977; it returned to Nov 11 in 1978.
        eras: &[
            Era::between(1971, 1977, nth(10, MON, 4)),
            Era::from(1978, fixed(11, 11)),
        ],
    },
    HolidayRule {
        id: "thanksgivingDay",
        name: "Thanksgiving Day",
        eras: &[Era::from(1971, nth(11, THU, 4))],
    },
    HolidayRule {
        id: "christmasDay",
        name: "Christmas Day",
        eras: &[Era::from(1971, fixed(12, 25))],
    },
];

/// The US federal preset.
pub const US: PresetDef = PresetDef {
    preset: HolidayPreset::Us,
    label: "US federal",
    min_year: 1971,
    default_weekend: &[6, 7],
    observance: Observance::UsFederal,
    shifted_suffix: " (observed)",
    rules: RULES,
    moves: &[],
    extras: &[],
};
