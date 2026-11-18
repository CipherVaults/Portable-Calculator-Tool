//! Easter computi and Julian-calendar dates (spec 2 §2.2-§2.4).
//!
//! All arithmetic is integer floor division (`div_euclid`/`rem_euclid`), so
//! every function is total for any year; the results are only meaningful for
//! the Gregorian era (1583 onwards), which covers the holiday window
//! 1900..=2199.

use crate::civil::{civil_from_days, days_from_civil, Civil, EpochDay, JDN_OFFSET};

/// Western (Gregorian) Easter Sunday: the anonymous Gregorian algorithm
/// (Meeus/Jones/Butcher).
///
/// The algorithm finds the Paschal full moon from the Metonic position `a`,
/// corrects it for the Gregorian solar (`b`, `d`) and lunar (`f`, `g`)
/// equations (`h` is the epact-like offset), then steps to the following
/// Sunday (`l`), with `m` handling the two exceptional epacts. The result is
/// always between March 22 and April 25.
pub fn western_easter(year: i64) -> EpochDay {
    let a = year.rem_euclid(19);
    let b = year.div_euclid(100);
    let c = year.rem_euclid(100);
    let d = b.div_euclid(4);
    let e = b.rem_euclid(4);
    let f = (b + 8).div_euclid(25);
    let g = (b - f + 1).div_euclid(3);
    let h = (19 * a + b - d - g + 15).rem_euclid(30);
    let i = c.div_euclid(4);
    let k = c.rem_euclid(4);
    let l = (32 + 2 * e + 2 * i - h - k).rem_euclid(7);
    let m = (a + 11 * h + 22 * l).div_euclid(451);
    let n = h + l - 7 * m + 114;
    // `n` is in 107..=149, so month is 3 or 4 and day is 1..=31.
    civil_day(year, n.div_euclid(31), n.rem_euclid(31) + 1)
}

/// Orthodox (and Coptic) Easter Sunday as a Gregorian day number.
///
/// Meeus's Julian computus gives a date in the Julian calendar, which is then
/// converted through the Julian Day Number. The conversion never hard-codes a
/// "+13 days" shift: the Julian-Gregorian gap grows to 14 days on
/// 1 March 2100 (Julian), and going through the JDN handles that.
pub fn orthodox_easter(year: i64) -> EpochDay {
    let a = year.rem_euclid(4);
    let b = year.rem_euclid(7);
    let c = year.rem_euclid(19);
    let d = (19 * c + 15).rem_euclid(30);
    let e = (2 * a + 4 * b - d + 34).rem_euclid(7);
    let n = d + e + 114;
    julian_to_days(year, n.div_euclid(31), n.rem_euclid(31) + 1)
}

/// Day number of a Julian-calendar date (`y`, `m`, `d`), through the standard
/// Julian-calendar JDN formula.
pub fn julian_to_days(year: i64, month: i64, day: i64) -> EpochDay {
    let a = (14 - month).div_euclid(12);
    let yy = year + 4800 - a;
    let mm = month + 12 * a - 3;
    let jdn = day + (153 * mm + 2).div_euclid(5) + 365 * yy + yy.div_euclid(4) - 32_083;
    jdn - JDN_OFFSET
}

/// The Gregorian-year-`year` occurrence of the Julian date `month`/`day`
/// (spec 2 §2.4). Julian years `year - 1` and `year` are both tried and the
/// one landing in Gregorian `year` wins: Julian Dec 25 is Gregorian Jan 7 for
/// 1901..=2100 and Jan 8 for 2101..=2199 (Coptic Christmas).
pub fn julian_fixed_in_year(year: i64, month: i64, day: i64) -> Option<EpochDay> {
    [year - 1, year]
        .into_iter()
        .map(|jy| julian_to_days(jy, month, day))
        .find(|&z| civil_from_days(z).year == year)
}

/// `days_from_civil` for small validated month/day values.
fn civil_day(year: i64, month: i64, day: i64) -> EpochDay {
    // Month 1..=12 and day 1..=31 by construction; the conversions cannot
    // truncate, and `days_from_civil` is total anyway.
    days_from_civil(Civil::new(
        year,
        u32::try_from(month).unwrap_or(1),
        u32::try_from(day).unwrap_or(1),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::format_iso;

    #[test]
    fn anchors() {
        assert_eq!(format_iso(western_easter(2000)), "2000-04-23");
        assert_eq!(format_iso(western_easter(2038)), "2038-04-25");
        assert_eq!(format_iso(western_easter(2285)), "2285-03-22");
        assert_eq!(format_iso(orthodox_easter(2010)), "2010-04-04");
        assert_eq!(format_iso(orthodox_easter(2100)), "2100-05-02");
        let xmas = |y| julian_fixed_in_year(y, 12, 25).map(format_iso);
        assert_eq!(xmas(2100).as_deref(), Some("2100-01-07"));
        assert_eq!(xmas(2101).as_deref(), Some("2101-01-08"));
    }
}
