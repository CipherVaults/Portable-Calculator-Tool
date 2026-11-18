//! units-core: the unit catalogue and exact unit conversion.
//!
//! See `Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`, section B8.
//!
//! Every unit is a const table row `{id, symbol, factor = num/den, exact,
//! source}` relative to its category's SI base unit. A conversion is
//! `x * f_from / f_to` in [`calc_num::Dec`] (M7); temperature is affine
//! through kelvin. Sources: NIST SP 811 and the SI Brochure.
//!
//! # Status (M0 skeleton)
//!
//! Implemented now: the twelve [`Category`] ids in drawer order, the
//! [`Unit`] row type, and the Length table as the first real table.
//! Planned (M7): the other eleven tables, `units.catalog` and
//! `units.convert` through `pcalc-api`, NIST vectors and round trips.
#![forbid(unsafe_code)]

pub mod length;

use serde::Serialize;

/// Engine version; equal to the crate version (asserted by a test).
pub const ENGINE_VERSION: &str = "0.1.0";

/// A converter category, in the drawer order of plan B5.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    /// Volume (base: cubic metre).
    Volume,
    /// Length (base: metre).
    Length,
    /// Weight and mass (base: kilogram).
    Mass,
    /// Temperature (affine, through kelvin).
    Temperature,
    /// Energy (base: joule).
    Energy,
    /// Area (base: square metre).
    Area,
    /// Speed (base: metre per second).
    Speed,
    /// Time (base: second; no month).
    Time,
    /// Power (base: watt).
    Power,
    /// Data (base: bit; separate SI and IEC groups).
    Data,
    /// Pressure (base: pascal).
    Pressure,
    /// Angle (base: radian; pi-based factors are marked computed).
    Angle,
}

impl Category {
    /// Every category, in drawer order.
    pub const ALL: [Category; 12] = [
        Category::Volume,
        Category::Length,
        Category::Mass,
        Category::Temperature,
        Category::Energy,
        Category::Area,
        Category::Speed,
        Category::Time,
        Category::Power,
        Category::Data,
        Category::Pressure,
        Category::Angle,
    ];

    /// The stable id used in requests and history.
    pub const fn id(self) -> &'static str {
        match self {
            Category::Volume => "volume",
            Category::Length => "length",
            Category::Mass => "mass",
            Category::Temperature => "temperature",
            Category::Energy => "energy",
            Category::Area => "area",
            Category::Speed => "speed",
            Category::Time => "time",
            Category::Power => "power",
            Category::Data => "data",
            Category::Pressure => "pressure",
            Category::Angle => "angle",
        }
    }

    /// Looks a category up by id.
    pub fn from_id(id: &str) -> Option<Category> {
        Category::ALL.into_iter().find(|c| c.id() == id)
    }
}

/// One unit: `1 <unit> = num/den <base unit>`. The factor is an exact
/// rational of decimal integer strings, parsed into `Dec` at conversion
/// time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    /// Stable id (`"in"`, `"km"` …).
    pub id: &'static str,
    /// Display symbol.
    pub symbol: &'static str,
    /// Factor numerator (decimal integer text).
    pub num: &'static str,
    /// Factor denominator (decimal integer text, never `"0"`).
    pub den: &'static str,
    /// `true` when the factor is exact by definition.
    pub exact: bool,
    /// Where the factor comes from.
    pub source: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;
    use calc_num::Dec;

    #[test]
    fn engine_version_matches_crate_version() {
        assert_eq!(ENGINE_VERSION, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn twelve_categories_with_unique_round_tripping_ids() {
        let mut ids: Vec<&str> = Category::ALL.iter().map(|c| c.id()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 12);
        for c in Category::ALL {
            assert_eq!(Category::from_id(c.id()), Some(c));
        }
        assert_eq!(Category::from_id("currency"), None);
    }

    #[test]
    fn length_table_factors_are_valid_decimals() {
        let mut ids = Vec::new();
        for unit in length::UNITS {
            assert!(Dec::parse(unit.num).is_ok(), "{}", unit.id);
            let den = Dec::parse(unit.den).unwrap();
            assert!(!den.is_zero(), "{}", unit.id);
            ids.push(unit.id);
        }
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate length unit id");
        let inch = length::UNITS.iter().find(|u| u.id == "in").unwrap();
        assert_eq!((inch.num, inch.den, inch.exact), ("254", "10000", true));
    }
}
