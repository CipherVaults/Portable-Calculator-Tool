//! Business-day counting and stepping (spec 1 §6, FROZEN §5).
//!
//! Every day is exactly one of: a **weekend** day (its weekday is in the
//! weekend, even if it is also a holiday), a **holiday** (a holiday date on a
//! working weekday; several holidays on one date count once), or a
//! **business** day.
//!
//! Both operations run year by year with week arithmetic, so the cost is
//! O(years + holidays) for any span up to 0001..=9999; there is no cap on
//! the number of days.

use crate::calendar::{Calendar, HolidayDay};
use crate::civil::{
    civil_from_days, clamp_to_domain, in_range, EpochDay, MAX_EPOCH_DAY, MIN_EPOCH_DAY,
};
use crate::error::CoreError;
use crate::holidays::rules::ymd;

/// Classification counts of a half-open range `[from, to_excl)`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct BusinessCount {
    /// `to_excl - from` (0 for an empty range).
    pub calendar_days: i64,
    /// Business days.
    pub business: i64,
    /// Weekend days (including holidays that fall on the weekend).
    pub weekend: i64,
    /// Holiday dates on working weekdays.
    pub holiday: i64,
}

/// Counts the days of `[from, to_excl)`:
///
/// 1. `weekend = full_weeks * weekend_days_per_week + (weekend days among the
///    remaining < 7 days)`;
/// 2. `holiday` = merged holiday days in the range whose weekday is a working
///    day (one memoized year at a time);
/// 3. `business = calendar_days - weekend - holiday`.
///
/// Invariant: `calendar_days == business + weekend + holiday`.
///
/// The range is first intersected with the supported days
/// 0001-01-01..=9999-12-31 ([`clamp_to_domain`]), so any `i64` input is
/// accepted without overflow; the `calc_*` entry points only ever pass
/// ranges inside it.
pub fn count_business_days(cal: &Calendar, from: EpochDay, to_excl: EpochDay) -> BusinessCount {
    let (from, to_excl) = (clamp_to_domain(from), clamp_to_domain(to_excl));
    let calendar_days = (to_excl - from).max(0);
    if calendar_days == 0 {
        return BusinessCount::default();
    }
    let mask = cal.weekend();
    let weekend = mask.weekend_days_in(from, to_excl);
    let mut holiday = 0;
    cal.for_each_holiday_day(from, to_excl, |h| {
        if !mask.is_weekend(h.day) {
            holiday += 1;
        }
    });
    BusinessCount {
        calendar_days,
        business: calendar_days - weekend - holiday,
        weekend,
        holiday,
    }
}

/// Holiday days on working weekdays in `[from, to_excl)`, the first `limit`
/// of them in date order, plus the total number.
pub fn working_holidays(
    cal: &Calendar,
    from: EpochDay,
    to_excl: EpochDay,
    limit: usize,
) -> (Vec<HolidayDay>, i64) {
    let mask = cal.weekend();
    let mut listed = Vec::new();
    let mut total = 0_i64;
    cal.for_each_holiday_day(from, to_excl, |h| {
        if !mask.is_weekend(h.day) {
            total += 1;
            if listed.len() < limit {
                listed.push(h.clone());
            }
        }
    });
    (listed, total)
}

/// Outcome of [`add_business_days`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct BusinessStep {
    /// The resulting day.
    pub date: EpochDay,
    /// Weekend days strictly between the start and the result.
    pub skipped_weekend: i64,
    /// Holidays (on working weekdays) strictly between the start and the
    /// result.
    pub skipped_holidays: i64,
}

/// Steps `n` business days from `start` (backwards for `n < 0`).
///
/// - `n == 0` returns `start` unchanged, even when it is not a business day.
/// - Otherwise the start day itself is never counted and the result is the
///   `|n|`-th business day after (before) it, so it is always a business day.
///
/// Whole years are skipped with [`count_business_days`] while the year holds
/// fewer business days than remain; the final year is walked day by day (at
/// most 366 days). Leaving 0001-01-01..=9999-12-31 gives
/// `result_out_of_range`; a weekend of all seven days is rejected earlier by
/// validation, so every year holds at least 52 business days minus holidays.
/// A `start` outside that range is also `result_out_of_range` (for any `n`),
/// so the stepping arithmetic never overflows.
pub fn add_business_days(
    cal: &Calendar,
    start: EpochDay,
    n: i64,
) -> Result<BusinessStep, CoreError> {
    if !in_range(start) {
        return Err(CoreError::result_out_of_range());
    }
    if n == 0 {
        return Ok(BusinessStep {
            date: start,
            skipped_weekend: 0,
            skipped_holidays: 0,
        });
    }
    let date = if n > 0 {
        step_forward(cal, start, n)?
    } else {
        step_backward(cal, start, n.checked_neg().unwrap_or(i64::MAX))?
    };
    let between = if n > 0 {
        count_business_days(cal, start + 1, date)
    } else {
        count_business_days(cal, date + 1, start)
    };
    Ok(BusinessStep {
        date,
        skipped_weekend: between.weekend,
        skipped_holidays: between.holiday,
    })
}

fn step_forward(cal: &Calendar, start: EpochDay, n: i64) -> Result<EpochDay, CoreError> {
    let mut cursor = start + 1;
    let mut remaining = n;
    loop {
        if cursor > MAX_EPOCH_DAY {
            return Err(CoreError::result_out_of_range());
        }
        let year_end = ymd(civil_from_days(cursor).year, 12, 31).min(MAX_EPOCH_DAY);
        let chunk = count_business_days(cal, cursor, year_end + 1).business;
        if chunk < remaining {
            remaining -= chunk;
            cursor = year_end + 1;
            continue;
        }
        // The answer is inside this chunk: walk it.
        for day in cursor..=year_end {
            if cal.is_business_day(day) {
                remaining -= 1;
                if remaining == 0 {
                    return Ok(day);
                }
            }
        }
        // Unreachable when `chunk >= remaining`; kept total.
        return Err(CoreError::result_out_of_range());
    }
}

fn step_backward(cal: &Calendar, start: EpochDay, n: i64) -> Result<EpochDay, CoreError> {
    let mut cursor = start - 1;
    let mut remaining = n;
    loop {
        if cursor < MIN_EPOCH_DAY {
            return Err(CoreError::result_out_of_range());
        }
        let year_start = ymd(civil_from_days(cursor).year, 1, 1).max(MIN_EPOCH_DAY);
        let chunk = count_business_days(cal, year_start, cursor + 1).business;
        if chunk < remaining {
            remaining -= chunk;
            cursor = year_start - 1;
            continue;
        }
        for day in (year_start..=cursor).rev() {
            if cal.is_business_day(day) {
                remaining -= 1;
                if remaining == 0 {
                    return Ok(day);
                }
            }
        }
        return Err(CoreError::result_out_of_range());
    }
}
