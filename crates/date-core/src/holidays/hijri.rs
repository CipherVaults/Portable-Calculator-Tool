//! Tabular (arithmetical) Islamic calendar (spec 2 §2.5).
//!
//! This is the "approximate" source for Islamic holidays: the real dates
//! depend on moon sighting and usually land within one or two days of these.
//!
//! - Leap years follow **type II** (the "Kuwaiti" pattern): years
//!   2, 5, 7, 10, 13, 16, 18, 21, 24, 26 and 29 of each 30-year cycle, i.e.
//!   `(14 + 11 * hy) mod 30 < 11`.
//! - **Civil (Friday) epoch:** 1 Muharram 1 AH = JDN 1 948 440 = 19 July 622
//!   (proleptic Gregorian).
//! - Months alternate 30 and 29 days; month 12 has 30 days in leap years.
//!
//! Everything is integer arithmetic with floor division; `ceil(29.5 * k)` is
//! written as `floor((59 * k + 1) / 2)` so no float is ever involved.

use crate::calendar::HijriEvent;
use crate::civil::{EpochDay, JDN_OFFSET};

/// Day number of 1 Muharram 1 AH (JDN 1 948 440).
pub const HIJRI_EPOCH: EpochDay = 1_948_440 - JDN_OFFSET;

/// A tabular Hijri date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct HijriDate {
    /// Hijri year (AH).
    pub year: i64,
    /// Month 1..=12.
    pub month: i64,
    /// Day 1..=30.
    pub day: i64,
}

/// Type II leap-year rule.
pub fn is_hijri_leap_year(hy: i64) -> bool {
    (14 + 11 * hy).rem_euclid(30) < 11
}

/// Day number of a tabular Hijri date.
///
/// `(hy - 1) * 354 + floor((3 + 11 * hy) / 30)` counts the days of all
/// previous years (354 each plus one per leap year), and
/// `floor((59 * (hm - 1) + 1) / 2)` = `ceil(29.5 * (hm - 1))` counts the days
/// of the previous months of the year.
pub fn hijri_to_days(hy: i64, hm: i64, hd: i64) -> EpochDay {
    hd + (59 * (hm - 1) + 1).div_euclid(2)
        + (hy - 1) * 354
        + (3 + 11 * hy).div_euclid(30)
        + HIJRI_EPOCH
        - 1
}

/// Tabular Hijri date of a day number.
///
/// The year estimate `floor((30 * (z - epoch) + 10646) / 10631)` (10 631 days
/// per 30-year cycle) is exact in practice; two guarded corrections keep the
/// function exact for any input. The month is found by a linear scan of at
/// most 12 month starts, so no float `ceil` is needed.
pub fn days_to_hijri(z: EpochDay) -> HijriDate {
    let mut hy = (30 * (z - HIJRI_EPOCH) + 10_646).div_euclid(10_631);
    if hijri_to_days(hy, 1, 1) > z {
        hy -= 1;
    }
    if hijri_to_days(hy + 1, 1, 1) <= z {
        hy += 1;
    }
    let month = (1..=12)
        .rev()
        .find(|&m| hijri_to_days(hy, m, 1) <= z)
        .unwrap_or(1);
    HijriDate {
        year: hy,
        month,
        day: z - hijri_to_days(hy, month, 1) + 1,
    }
}

impl HijriEvent {
    /// Every event, in rule order.
    pub const ALL: [HijriEvent; 4] = [
        HijriEvent::IslamicNewYear,
        HijriEvent::Mawlid,
        HijriEvent::EidAlFitr,
        HijriEvent::EidAlAdha,
    ];

    /// The event's Hijri month and day: 1 Muharram, 12 Rabi' al-Awwal,
    /// 1 Shawwal, 10 Dhu al-Hijjah.
    pub const fn month_day(self) -> (i64, i64) {
        match self {
            Self::IslamicNewYear => (1, 1),
            Self::Mawlid => (3, 12),
            Self::EidAlFitr => (10, 1),
            Self::EidAlAdha => (12, 10),
        }
    }

    /// The camelCase id used in JSON.
    pub const fn id(self) -> &'static str {
        match self {
            Self::IslamicNewYear => "islamicNewYear",
            Self::Mawlid => "mawlid",
            Self::EidAlFitr => "eidAlFitr",
            Self::EidAlAdha => "eidAlAdha",
        }
    }

    /// Tabular (offset-free) day number of the event in Hijri year `hy`.
    pub fn tabular_day(self, hy: i64) -> EpochDay {
        let (m, d) = self.month_day();
        hijri_to_days(hy, m, d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::civil::{days_from_civil, Civil};

    fn day(y: i64, m: u32, d: u32) -> EpochDay {
        days_from_civil(Civil::new(y, m, d))
    }

    #[test]
    fn epoch_and_range_anchors() {
        assert_eq!(HIJRI_EPOCH, day(622, 7, 19));
        let h = |y, m, d| days_to_hijri(day(y, m, d));
        assert_eq!(
            h(1900, 1, 1),
            HijriDate {
                year: 1317,
                month: 8,
                day: 28
            }
        );
        assert_eq!(
            h(2199, 12, 31),
            HijriDate {
                year: 1626,
                month: 11,
                day: 13
            }
        );
        assert_eq!(
            h(2026, 11, 16),
            HijriDate {
                year: 1448,
                month: 6,
                day: 5
            }
        );
        assert_eq!(
            h(2025, 3, 30),
            HijriDate {
                year: 1446,
                month: 9,
                day: 30
            }
        );
        assert!(is_hijri_leap_year(1447) && !is_hijri_leap_year(1446));
    }
}
