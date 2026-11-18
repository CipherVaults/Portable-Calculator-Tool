//! date-core: pure, deterministic date calculation engine for Date Calculator Tool.
//!
//! See `Documentation/specs/` (`0- FROZEN_DECISIONS.md` overrides specs 1-4).
//!
//! # Guarantees
//!
//! - **Pure.** No clock, time zone, locale or environment access: "today" and
//!   "now" are always inputs supplied by the UI.
//! - **Integer-only.** Every date is an `i64` day number (days since
//!   1970-01-01) in the proleptic Gregorian calendar; inputs and outputs are
//!   limited to 0001-01-01..=9999-12-31.
//! - **Total.** No input can cause a panic: every parse path returns a
//!   [`CoreError`], and all arithmetic stays within validated bounds.
//! - **Parity.** All text (including thousands grouping and plurals) is built
//!   here with byte-exact ASCII rules, so the mobile JS mirror can reproduce
//!   every output byte for byte.
//!
//! # Entry points
//!
//! Each mode is `calc_X(&XRequest) -> Result<XResult, CoreError>`; wrap the
//! result with [`Outcome::from`] (or [`into_outcome`]) to get the JSON
//! envelope `{"ok":"true","result":{...}}` / `{"ok":"false","error":{...}}`.
//!
//! Calendar-aware entry points: [`calc_business_days`], the business mode of
//! [`calc_add_subtract`], [`holidays_in_range`], [`month_grid`] and
//! [`validate_calendar`]. They all take the same [`CalendarSpec`]
//! (FROZEN §4) embedded in their request.
//!
//! The IPC surface used by the Tauri commands and the NDJSON bridge is
//! [`api`]: the same nine functions returning the [`Outcome`] envelope
//! directly, with input-size limits and a by-name dispatcher ([`api::call`]).
#![forbid(unsafe_code)]

pub mod api;
pub mod business;
pub mod calendar;
pub mod civil;
pub mod error;
pub mod format;
pub mod grid;
pub mod holidays;
pub mod modes;
pub mod parse;
mod strict;

use serde::Serialize;

pub use business::{add_business_days, count_business_days, BusinessCount, BusinessStep};
pub use calendar::{
    validate_calendar, Calendar, CalendarSpec, CustomHoliday, CustomHolidayKind, ExcludedHolidays,
    HijriEvent, HijriOverride, HolidayDay, HolidayPreset, ObservedMode, ValidateCalendarRequest,
    ValidateCalendarResult, WeekendMask, WARNING_PRESET_YEAR_OUT_OF_RANGE,
};
pub use civil::{Civil, EpochDay, IsoWeek, LeapDayRule, Ymd, MAX_EPOCH_DAY, MIN_EPOCH_DAY};
pub use error::{CoreError, ErrorCode, Field};
pub use format::format_int;
pub use grid::{month_grid, FirstDayOfWeek, GridCell, MonthGridRequest, MonthGridResult};
pub use holidays::{
    holidays_in_range, HolidayInstance, HolidaySource, HolidaysInRangeRequest,
    HolidaysInRangeResult, HOLIDAY_MAX_YEAR, HOLIDAY_MIN_YEAR,
};
pub use modes::add_subtract::{
    calc_add_subtract, AddSubtractRequest, AddSubtractResult, Operation,
};
pub use modes::age::{calc_age, AgeRequest, AgeResult, NextBirthday};
pub use modes::business_days::{
    calc_business_days, BusinessDaysRequest, BusinessDaysResult, HolidayHit,
};
pub use modes::countdown::{
    calc_countdown, CountdownRequest, CountdownResult, CountdownStatus, Moment,
};
pub use modes::date_info::{calc_date_info, DateInfoRequest, DateInfoResult};
pub use modes::days_between::{
    calc_days_between, DaysBetweenRequest, DaysBetweenResult, Direction,
};
pub use parse::{parse_amount, parse_date, parse_time, parse_utc_offset, parse_weekend};

/// Engine version; matches the `/* date-core:begin v1.0.0 */` marker of the
/// JS mirror.
pub const ENGINE_VERSION: &str = "1.0.0";

/// Upper bound on every result's `copyText`, in bytes (FROZEN §11: history
/// entries store `copyText` and accept at most 1024 bytes).
pub const MAX_COPY_TEXT_BYTES: usize = 1024;

/// The result envelope shared by core, bridge, Tauri and JS (FROZEN §1):
/// `{"ok":"true","result":{...}}` or `{"ok":"false","error":{...}}`, with
/// the reference project's string tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "ok")]
pub enum Outcome<T> {
    /// Success.
    #[serde(rename = "true")]
    Ok {
        /// The mode's result.
        result: T,
    },
    /// Failure.
    #[serde(rename = "false")]
    Err {
        /// The first error in validation order.
        error: CoreError,
    },
}

impl<T> From<Result<T, CoreError>> for Outcome<T> {
    fn from(r: Result<T, CoreError>) -> Self {
        match r {
            Ok(result) => Outcome::Ok { result },
            Err(error) => Outcome::Err { error },
        }
    }
}

impl<T> Outcome<T> {
    /// The error of a failed outcome.
    pub fn error(&self) -> Option<&CoreError> {
        match self {
            Outcome::Ok { .. } => None,
            Outcome::Err { error } => Some(error),
        }
    }

    /// The result of a successful outcome.
    pub fn result(&self) -> Option<&T> {
        match self {
            Outcome::Ok { result } => Some(result),
            Outcome::Err { .. } => None,
        }
    }

    /// `true` for `{"ok":"true"}`.
    pub fn is_ok(&self) -> bool {
        matches!(self, Outcome::Ok { .. })
    }
}

/// Wraps a core result in the JSON envelope.
pub fn into_outcome<T>(r: Result<T, CoreError>) -> Outcome<T> {
    Outcome::from(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_variants_construct() {
        let ok: Outcome<i64> = Ok(5).into();
        assert_eq!(ok, Outcome::Ok { result: 5 });
        let err: Outcome<i64> = into_outcome(Err(CoreError::result_out_of_range()));
        assert!(matches!(err, Outcome::Err { .. }));
    }
}
