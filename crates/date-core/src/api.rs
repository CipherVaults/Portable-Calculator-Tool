//! The IPC-facing surface (FROZEN §2): one entry point per core function,
//! each taking its request struct and returning the [`Outcome`] envelope.
//!
//! This is the single surface shared by the Tauri commands, the NDJSON
//! bridge (`examples/date_bridge.rs`), the golden generator and the parity
//! tests, so every caller sees byte-identical behaviour.
//!
//! # Requests
//!
//! The request structs are the mode modules' own (re-exported below): every
//! one is `camelCase` with `deny_unknown_fields`, and the calendar-aware
//! ones embed the full [`CalendarSpec`] as `calendar`, so the settings modal
//! can preview unsaved edits (FROZEN §2).
//!
//! | op (`Op::name`)       | request                    | result                     |
//! |-----------------------|----------------------------|----------------------------|
//! | `calc_days_between`   | [`DaysBetweenRequest`]     | [`DaysBetweenResult`]      |
//! | `calc_add_subtract`   | [`AddSubtractRequest`]     | [`AddSubtractResult`]      |
//! | `calc_business_days`  | [`BusinessDaysRequest`]    | [`BusinessDaysResult`]     |
//! | `calc_age`            | [`AgeRequest`]             | [`AgeResult`]              |
//! | `calc_date_info`      | [`DateInfoRequest`]        | [`DateInfoResult`]         |
//! | `calc_countdown`      | [`CountdownRequest`]       | [`CountdownResult`]        |
//! | `holidays_in_range`   | [`HolidaysInRangeRequest`] | [`HolidaysInRangeResult`]  |
//! | `month_grid`          | [`MonthGridRequest`]       | [`MonthGridResult`]        |
//! | `validate_calendar`   | [`ValidateCalendarRequest`]| [`ValidateCalendarResult`] |
//!
//! # Guarantees
//!
//! - **Total.** No entry point panics or returns a Rust error: every failure
//!   is the `{"ok":"false","error":{...}}` envelope.
//! - **Bounded input.** Before anything is parsed, every string in the
//!   request (including those inside `calendar`) is checked against
//!   [`MAX_STRING_BYTES`]; a longer one is rejected with `invalid_request`.
//!   Lists need no separate cap here: the calendar validator checks each
//!   list's length before looking at its entries, and an over-long weekend
//!   list fails on its first repeated day.
//! - **Uniform deserialization errors.** [`call`] deserializes a request for
//!   an [`Op`] from any serde `Deserializer`; malformed JSON shapes, wrong
//!   types and unknown fields all become `invalid_request` (spec 1 §5.2).
//!   `invalid_request` is an IPC-boundary error: it is never produced by the
//!   `calc_*` functions themselves, and golden fixtures do not contain it.

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::CoreError;
use crate::strict::Strict;
use crate::Outcome;

pub use crate::calendar::{CalendarSpec, ValidateCalendarRequest, ValidateCalendarResult};
pub use crate::grid::{MonthGridRequest, MonthGridResult};
pub use crate::holidays::{HolidaysInRangeRequest, HolidaysInRangeResult};
pub use crate::modes::add_subtract::{AddSubtractRequest, AddSubtractResult};
pub use crate::modes::age::{AgeRequest, AgeResult};
pub use crate::modes::business_days::{BusinessDaysRequest, BusinessDaysResult};
pub use crate::modes::countdown::{CountdownRequest, CountdownResult};
pub use crate::modes::date_info::{DateInfoRequest, DateInfoResult};
pub use crate::modes::days_between::{DaysBetweenRequest, DaysBetweenResult};

/// Largest accepted string anywhere in a request, in UTF-8 bytes.
///
/// Every legitimate value is far shorter (a date is 10 bytes, an amount at
/// most 16, a custom holiday name at most 60 characters = 240 bytes), so the
/// cap only ever rejects abusive input, and it does so before any parsing.
pub const MAX_STRING_BYTES: usize = 1024;

/// Largest accepted serialized request, in bytes. The bridge applies it to
/// each NDJSON line; the Tauri layer may apply it to the raw IPC payload.
pub const MAX_REQUEST_BYTES: usize = 65_536;

/// The nine IPC operations, named exactly as the FROZEN §2 core functions
/// (also the bridge ops and the Tauri command names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Op {
    /// `calc_days_between`.
    CalcDaysBetween,
    /// `calc_add_subtract`.
    CalcAddSubtract,
    /// `calc_business_days`.
    CalcBusinessDays,
    /// `calc_age`.
    CalcAge,
    /// `calc_date_info`.
    CalcDateInfo,
    /// `calc_countdown`.
    CalcCountdown,
    /// `holidays_in_range`.
    HolidaysInRange,
    /// `month_grid`.
    MonthGrid,
    /// `validate_calendar`.
    ValidateCalendar,
}

impl Op {
    /// Every op, in FROZEN §2 order.
    pub const ALL: [Op; 9] = [
        Op::CalcDaysBetween,
        Op::CalcAddSubtract,
        Op::CalcBusinessDays,
        Op::CalcAge,
        Op::CalcDateInfo,
        Op::CalcCountdown,
        Op::HolidaysInRange,
        Op::MonthGrid,
        Op::ValidateCalendar,
    ];

    /// The snake_case name (bridge op, Tauri command, core function).
    pub const fn name(self) -> &'static str {
        match self {
            Op::CalcDaysBetween => "calc_days_between",
            Op::CalcAddSubtract => "calc_add_subtract",
            Op::CalcBusinessDays => "calc_business_days",
            Op::CalcAge => "calc_age",
            Op::CalcDateInfo => "calc_date_info",
            Op::CalcCountdown => "calc_countdown",
            Op::HolidaysInRange => "holidays_in_range",
            Op::MonthGrid => "month_grid",
            Op::ValidateCalendar => "validate_calendar",
        }
    }

    /// Looks an op up by its exact snake_case name.
    pub fn from_name(name: &str) -> Option<Op> {
        Op::ALL.into_iter().find(|op| op.name() == name)
    }

    /// Whether the op's request embeds a `calendar`.
    pub const fn takes_calendar(self) -> bool {
        matches!(
            self,
            Op::CalcAddSubtract
                | Op::CalcBusinessDays
                | Op::HolidaysInRange
                | Op::MonthGrid
                | Op::ValidateCalendar
        )
    }
}

/// The outcome of any op. Serializes exactly as the wrapped [`Outcome`]
/// (the variant itself leaves no trace in the JSON).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum Response {
    /// `calc_days_between`.
    DaysBetween(Outcome<DaysBetweenResult>),
    /// `calc_add_subtract`.
    AddSubtract(Outcome<AddSubtractResult>),
    /// `calc_business_days`.
    BusinessDays(Outcome<BusinessDaysResult>),
    /// `calc_age`.
    Age(Outcome<AgeResult>),
    /// `calc_date_info`.
    DateInfo(Outcome<DateInfoResult>),
    /// `calc_countdown`.
    Countdown(Outcome<CountdownResult>),
    /// `holidays_in_range`.
    HolidaysInRange(Outcome<HolidaysInRangeResult>),
    /// `month_grid`.
    MonthGrid(Outcome<MonthGridResult>),
    /// `validate_calendar`.
    ValidateCalendar(Outcome<ValidateCalendarResult>),
}

impl Response {
    /// The error, when the outcome is `{"ok":"false"}`.
    pub fn error(&self) -> Option<&CoreError> {
        match self {
            Response::DaysBetween(o) => o.error(),
            Response::AddSubtract(o) => o.error(),
            Response::BusinessDays(o) => o.error(),
            Response::Age(o) => o.error(),
            Response::DateInfo(o) => o.error(),
            Response::Countdown(o) => o.error(),
            Response::HolidaysInRange(o) => o.error(),
            Response::MonthGrid(o) => o.error(),
            Response::ValidateCalendar(o) => o.error(),
        }
    }

    /// `true` for `{"ok":"true"}`.
    pub fn is_ok(&self) -> bool {
        self.error().is_none()
    }
}

// ---------------------------------------------------------------------------
// Input limits
// ---------------------------------------------------------------------------

fn fits(s: &str) -> bool {
    s.len() <= MAX_STRING_BYTES
}

fn fits_opt(s: &Option<String>) -> bool {
    s.as_deref().is_none_or(fits)
}

/// Every string a request carries is at most [`MAX_STRING_BYTES`] long.
trait WithinLimits {
    fn within_limits(&self) -> bool;
}

impl WithinLimits for CalendarSpec {
    fn within_limits(&self) -> bool {
        let ex = &self.excluded_holidays;
        self.hijri_overrides.iter().all(|o| fits(&o.date))
            && [&ex.us, &ex.uk, &ex.eg]
                .into_iter()
                .all(|ids| ids.iter().all(|id| fits(id)))
            && self
                .custom_holidays
                .iter()
                .all(|c| fits(&c.id) && fits(&c.name) && fits_opt(&c.date))
    }
}

impl WithinLimits for DaysBetweenRequest {
    fn within_limits(&self) -> bool {
        fits(&self.start_date) && fits(&self.end_date)
    }
}

impl WithinLimits for AddSubtractRequest {
    fn within_limits(&self) -> bool {
        [
            &self.date,
            &self.years,
            &self.months,
            &self.weeks,
            &self.days,
        ]
        .into_iter()
        .all(|s| fits(s))
            && self.calendar.within_limits()
    }
}

impl WithinLimits for BusinessDaysRequest {
    fn within_limits(&self) -> bool {
        fits(&self.start_date) && fits(&self.end_date) && self.calendar.within_limits()
    }
}

impl WithinLimits for AgeRequest {
    fn within_limits(&self) -> bool {
        fits(&self.birth_date) && fits(&self.as_of_date)
    }
}

impl WithinLimits for DateInfoRequest {
    fn within_limits(&self) -> bool {
        fits(&self.date) && fits_opt(&self.today)
    }
}

impl WithinLimits for CountdownRequest {
    fn within_limits(&self) -> bool {
        [&self.now, &self.target]
            .into_iter()
            .all(|m| fits(&m.date) && fits(&m.time))
    }
}

impl WithinLimits for HolidaysInRangeRequest {
    fn within_limits(&self) -> bool {
        fits(&self.start_date) && fits(&self.end_date) && self.calendar.within_limits()
    }
}

impl WithinLimits for MonthGridRequest {
    fn within_limits(&self) -> bool {
        fits_opt(&self.today)
            && fits_opt(&self.range_start)
            && fits_opt(&self.range_end)
            && self.calendar.within_limits()
    }
}

impl WithinLimits for ValidateCalendarRequest {
    fn within_limits(&self) -> bool {
        self.calendar.within_limits()
    }
}

/// The `invalid_request` envelope.
fn invalid<T>() -> Outcome<T> {
    Outcome::Err {
        error: CoreError::invalid_request(),
    }
}

/// Applies the input limits, then runs `f`.
fn guarded<R: WithinLimits, T>(req: &R, f: impl FnOnce(&R) -> Result<T, CoreError>) -> Outcome<T> {
    if req.within_limits() {
        f(req).into()
    } else {
        invalid()
    }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/// `calc_days_between` (spec 1 §7.1).
pub fn calc_days_between(req: &DaysBetweenRequest) -> Outcome<DaysBetweenResult> {
    guarded(req, crate::modes::days_between::calc_days_between)
}

/// `calc_add_subtract` (spec 1 §7.2).
pub fn calc_add_subtract(req: &AddSubtractRequest) -> Outcome<AddSubtractResult> {
    guarded(req, crate::modes::add_subtract::calc_add_subtract)
}

/// `calc_business_days` (spec 1 §7.3).
pub fn calc_business_days(req: &BusinessDaysRequest) -> Outcome<BusinessDaysResult> {
    guarded(req, crate::modes::business_days::calc_business_days)
}

/// `calc_age` (spec 1 §7.4).
pub fn calc_age(req: &AgeRequest) -> Outcome<AgeResult> {
    guarded(req, crate::modes::age::calc_age)
}

/// `calc_date_info` (spec 1 §7.5).
pub fn calc_date_info(req: &DateInfoRequest) -> Outcome<DateInfoResult> {
    guarded(req, crate::modes::date_info::calc_date_info)
}

/// `calc_countdown` (spec 1 §7.6).
pub fn calc_countdown(req: &CountdownRequest) -> Outcome<CountdownResult> {
    guarded(req, crate::modes::countdown::calc_countdown)
}

/// `holidays_in_range` (spec 2 §8.5).
pub fn holidays_in_range(req: &HolidaysInRangeRequest) -> Outcome<HolidaysInRangeResult> {
    guarded(req, crate::holidays::holidays_in_range)
}

/// `month_grid` (FROZEN §9).
pub fn month_grid(req: &MonthGridRequest) -> Outcome<MonthGridResult> {
    guarded(req, crate::grid::month_grid)
}

/// `validate_calendar` (spec 2 §8.2).
pub fn validate_calendar(req: &ValidateCalendarRequest) -> Outcome<ValidateCalendarResult> {
    guarded(req, crate::calendar::validate_calendar)
}

/// Deserializes `req` as the request of `op` and runs it.
///
/// Any deserialization failure (wrong shape or type, missing required field,
/// unknown field anywhere, including inside `calendar`) yields
/// `invalid_request`; the deserializer's own message is discarded so that no
/// input text is ever echoed back. Every struct, at any depth, must be a
/// JSON object: serde's positional array form (`"req": ["2024-01-01"]`) is
/// rejected too.
pub fn call<'de, D: Deserializer<'de>>(op: Op, req: D) -> Response {
    /// Deserializes and runs one typed entry point.
    fn run<'de, R, T, D>(req: D, f: fn(&R) -> Outcome<T>) -> Outcome<T>
    where
        R: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        R::deserialize(Strict(req)).map_or_else(|_| invalid(), |r| f(&r))
    }

    match op {
        Op::CalcDaysBetween => Response::DaysBetween(run(req, calc_days_between)),
        Op::CalcAddSubtract => Response::AddSubtract(run(req, calc_add_subtract)),
        Op::CalcBusinessDays => Response::BusinessDays(run(req, calc_business_days)),
        Op::CalcAge => Response::Age(run(req, calc_age)),
        Op::CalcDateInfo => Response::DateInfo(run(req, calc_date_info)),
        Op::CalcCountdown => Response::Countdown(run(req, calc_countdown)),
        Op::HolidaysInRange => Response::HolidaysInRange(run(req, holidays_in_range)),
        Op::MonthGrid => Response::MonthGrid(run(req, month_grid)),
        Op::ValidateCalendar => Response::ValidateCalendar(run(req, validate_calendar)),
    }
}

/// The `invalid_request` response for `op` (used by callers that fail
/// before deserialization, such as the bridge's line-size cap).
pub fn invalid_request(op: Op) -> Response {
    match op {
        Op::CalcDaysBetween => Response::DaysBetween(invalid()),
        Op::CalcAddSubtract => Response::AddSubtract(invalid()),
        Op::CalcBusinessDays => Response::BusinessDays(invalid()),
        Op::CalcAge => Response::Age(invalid()),
        Op::CalcDateInfo => Response::DateInfo(invalid()),
        Op::CalcCountdown => Response::Countdown(invalid()),
        Op::HolidaysInRange => Response::HolidaysInRange(invalid()),
        Op::MonthGrid => Response::MonthGrid(invalid()),
        Op::ValidateCalendar => Response::ValidateCalendar(invalid()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn op_names_round_trip() {
        for op in Op::ALL {
            assert_eq!(Op::from_name(op.name()), Some(op));
        }
        assert_eq!(Op::from_name("CALC_AGE"), None);
        assert_eq!(Op::from_name(""), None);
    }

    #[test]
    fn length_cap_rejects_before_parsing() {
        let padded = format!("{}2024-01-01", " ".repeat(MAX_STRING_BYTES - 10));
        let ok = DaysBetweenRequest {
            start_date: padded.clone(),
            end_date: "2024-01-02".into(),
            include_end_day: false,
        };
        assert!(matches!(calc_days_between(&ok), Outcome::Ok { .. }));
        let long = DaysBetweenRequest {
            start_date: format!(" {padded}"),
            ..ok
        };
        let Outcome::Err { error } = calc_days_between(&long) else {
            panic!("over-long string accepted");
        };
        assert_eq!(error.code, ErrorCode::InvalidRequest);
        assert_eq!(error.field, None);
    }

    #[test]
    fn calendar_strings_are_capped() {
        let mut req = ValidateCalendarRequest::default();
        req.calendar.excluded_holidays.us = vec!["x".repeat(MAX_STRING_BYTES + 1)];
        assert_eq!(
            validate_calendar(&req).error().map(|e| e.code),
            Some(ErrorCode::InvalidRequest)
        );
    }
}
