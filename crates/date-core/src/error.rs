//! Error type, snake_case error codes and per-field labels (spec 1 §5).
//!
//! Every validation failure in the engine is reported as a [`CoreError`]
//! carrying a stable machine code, the JSON path of the offending field (or
//! `null` for whole-request errors) and an exact English message. The message
//! texts are part of the parity contract with the mobile JS mirror, so they are
//! built only by the constructors in this module.

use std::fmt;

use serde::{Serialize, Serializer};

use crate::format::{format_int, month_name};

/// Stable, snake_case error codes (FROZEN §4: "Error codes are snake_case").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// A required date field is blank.
    MissingDate,
    /// A date field is not exactly `YYYY-MM-DD` with ASCII digits.
    InvalidDateFormat,
    /// A date has year 0000 (the only syntactically valid out-of-range year).
    DateOutOfRange,
    /// A date has a month outside 01..=12.
    InvalidMonth,
    /// A date has a day that does not exist in its month.
    InvalidDay,
    /// An amount is not a signed whole number.
    InvalidAmount,
    /// An amount exceeds its per-field maximum.
    AmountOutOfRange,
    /// A required time field is blank.
    MissingTime,
    /// A time is not a valid 24-hour `HH:MM[:SS]`.
    InvalidTime,
    /// A UTC offset is outside -1080..=1080 minutes.
    InvalidUtcOffset,
    /// The weekend list has values outside 1..=7 or duplicates.
    InvalidWeekend,
    /// The weekend covers all seven days.
    NoWorkingDays,
    /// The date of birth is after the age-at date.
    BirthAfterAsOf,
    /// The computed date falls outside 0001-01-01..=9999-12-31.
    ResultOutOfRange,
    /// The request could not be deserialized (Tauri/bridge only).
    InvalidRequest,
    /// `calendar.schemaVersion` is not 1.
    InvalidSchemaVersion,
    /// `calendar.hijriOffsetDays` is outside -2..=2.
    InvalidHijriOffset,
    /// More than 50 Hijri overrides.
    TooManyHijriOverrides,
    /// A Hijri override is malformed, out of range or duplicated.
    InvalidHijriOverride,
    /// An excluded holiday id is unknown, or the list is too long.
    InvalidExcludedHoliday,
    /// More than 100 custom holidays.
    TooManyCustomHolidays,
    /// A custom holiday is malformed.
    InvalidCustomHoliday,
    /// A month-grid year is outside 1..=9999.
    YearOutOfRange,
    /// A month-grid month is outside 1..=12.
    MonthOutOfRange,
}

impl ErrorCode {
    /// The snake_case code string exactly as serialized.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MissingDate => "missing_date",
            Self::InvalidDateFormat => "invalid_date_format",
            Self::DateOutOfRange => "date_out_of_range",
            Self::InvalidMonth => "invalid_month",
            Self::InvalidDay => "invalid_day",
            Self::InvalidAmount => "invalid_amount",
            Self::AmountOutOfRange => "amount_out_of_range",
            Self::MissingTime => "missing_time",
            Self::InvalidTime => "invalid_time",
            Self::InvalidUtcOffset => "invalid_utc_offset",
            Self::InvalidWeekend => "invalid_weekend",
            Self::NoWorkingDays => "no_working_days",
            Self::BirthAfterAsOf => "birth_after_as_of",
            Self::ResultOutOfRange => "result_out_of_range",
            Self::InvalidRequest => "invalid_request",
            Self::InvalidSchemaVersion => "invalid_schema_version",
            Self::InvalidHijriOffset => "invalid_hijri_offset",
            Self::TooManyHijriOverrides => "too_many_hijri_overrides",
            Self::InvalidHijriOverride => "invalid_hijri_override",
            Self::InvalidExcludedHoliday => "invalid_excluded_holiday",
            Self::TooManyCustomHolidays => "too_many_custom_holidays",
            Self::InvalidCustomHoliday => "invalid_custom_holiday",
            Self::YearOutOfRange => "year_out_of_range",
            Self::MonthOutOfRange => "month_out_of_range",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A request field that an error can point at.
///
/// Each variant has a JSON path ([`Field::key`], serialized in errors) and an
/// English label ([`Field::label`], used as `{L}` in messages). Labels are
/// unique per key, so one enum serves all six modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Field {
    /// Days Between / Business Days: `startDate` ("Start date").
    StartDate,
    /// Days Between / Business Days: `endDate` ("End date").
    EndDate,
    /// Add/Subtract and Date Info: `date` ("Date").
    Date,
    /// Age: `birthDate` ("Date of birth").
    BirthDate,
    /// Age: `asOfDate` ("Age at date").
    AsOfDate,
    /// Date Info: `today` ("Today's date").
    Today,
    /// Add/Subtract: `years` ("Years").
    Years,
    /// Add/Subtract: `months` ("Months").
    Months,
    /// Add/Subtract: `weeks` ("Weeks").
    Weeks,
    /// Add/Subtract: `days` ("Days").
    Days,
    /// Countdown: `now.date` ("Current date").
    NowDate,
    /// Countdown: `now.time` ("Current time").
    NowTime,
    /// Countdown: `now.utcOffsetMinutes` ("Current time").
    NowUtcOffset,
    /// Countdown: `target.date` ("Target date").
    TargetDate,
    /// Countdown: `target.time` ("Target time").
    TargetTime,
    /// Countdown: `target.utcOffsetMinutes` ("Target time").
    TargetUtcOffset,
    /// Calendar: `calendar.weekend`.
    CalendarWeekend,
    /// Calendar: `calendar.schemaVersion`.
    CalendarSchemaVersion,
    /// Calendar: `calendar.hijriOffsetDays`.
    CalendarHijriOffsetDays,
    /// Calendar: `calendar.hijriOverrides`.
    CalendarHijriOverrides,
    /// Calendar: `calendar.excludedHolidays`.
    CalendarExcludedHolidays,
    /// Calendar: `calendar.customHolidays`.
    CalendarCustomHolidays,
    /// Month grid: `year` ("Year").
    Year,
    /// Month grid: `month` ("Month").
    Month,
    /// Month grid: `rangeStart` ("Range start").
    RangeStart,
    /// Month grid: `rangeEnd` ("Range end").
    RangeEnd,
}

impl Field {
    /// Every field, for lookups and exhaustive tests.
    pub const ALL: [Field; 26] = [
        Field::StartDate,
        Field::EndDate,
        Field::Date,
        Field::BirthDate,
        Field::AsOfDate,
        Field::Today,
        Field::Years,
        Field::Months,
        Field::Weeks,
        Field::Days,
        Field::NowDate,
        Field::NowTime,
        Field::NowUtcOffset,
        Field::TargetDate,
        Field::TargetTime,
        Field::TargetUtcOffset,
        Field::CalendarWeekend,
        Field::CalendarSchemaVersion,
        Field::CalendarHijriOffsetDays,
        Field::CalendarHijriOverrides,
        Field::CalendarExcludedHolidays,
        Field::CalendarCustomHolidays,
        Field::Year,
        Field::Month,
        Field::RangeStart,
        Field::RangeEnd,
    ];

    /// The JSON path reported in `error.field`.
    pub const fn key(self) -> &'static str {
        match self {
            Self::StartDate => "startDate",
            Self::EndDate => "endDate",
            Self::Date => "date",
            Self::BirthDate => "birthDate",
            Self::AsOfDate => "asOfDate",
            Self::Today => "today",
            Self::Years => "years",
            Self::Months => "months",
            Self::Weeks => "weeks",
            Self::Days => "days",
            Self::NowDate => "now.date",
            Self::NowTime => "now.time",
            Self::NowUtcOffset => "now.utcOffsetMinutes",
            Self::TargetDate => "target.date",
            Self::TargetTime => "target.time",
            Self::TargetUtcOffset => "target.utcOffsetMinutes",
            Self::CalendarWeekend => "calendar.weekend",
            Self::CalendarSchemaVersion => "calendar.schemaVersion",
            Self::CalendarHijriOffsetDays => "calendar.hijriOffsetDays",
            Self::CalendarHijriOverrides => "calendar.hijriOverrides",
            Self::CalendarExcludedHolidays => "calendar.excludedHolidays",
            Self::CalendarCustomHolidays => "calendar.customHolidays",
            Self::Year => "year",
            Self::Month => "month",
            Self::RangeStart => "rangeStart",
            Self::RangeEnd => "rangeEnd",
        }
    }

    /// The English label substituted for `{L}` in messages (spec 1 §7).
    pub const fn label(self) -> &'static str {
        match self {
            Self::StartDate => "Start date",
            Self::EndDate => "End date",
            Self::Date => "Date",
            Self::BirthDate => "Date of birth",
            Self::AsOfDate => "Age at date",
            Self::Today => "Today's date",
            Self::Years => "Years",
            Self::Months => "Months",
            Self::Weeks => "Weeks",
            Self::Days => "Days",
            Self::NowDate => "Current date",
            Self::NowTime | Self::NowUtcOffset => "Current time",
            Self::TargetDate => "Target date",
            Self::TargetTime | Self::TargetUtcOffset => "Target time",
            Self::CalendarWeekend => "Weekend",
            Self::CalendarSchemaVersion => "Calendar schema version",
            Self::CalendarHijriOffsetDays => "Islamic date offset",
            Self::CalendarHijriOverrides => "Islamic date override",
            Self::CalendarExcludedHolidays => "Excluded holidays",
            Self::CalendarCustomHolidays => "Custom holiday",
            Self::Year => "Year",
            Self::Month => "Month",
            Self::RangeStart => "Range start",
            Self::RangeEnd => "Range end",
        }
    }

    /// Looks a field up by its JSON path (used by the bridge and tests).
    pub fn from_key(key: &str) -> Option<Field> {
        Self::ALL.into_iter().find(|f| f.key() == key)
    }
}

impl Serialize for Field {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.key())
    }
}

impl fmt::Display for Field {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.key())
    }
}

/// A validation or computation error, serialized as
/// `{"code": "...", "field": "..." | null, "message": "..."}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CoreError {
    /// Stable snake_case code.
    pub code: ErrorCode,
    /// JSON path of the offending field, or `null` for whole-request errors.
    pub field: Option<Field>,
    /// Exact English message (spec 1 §5.2).
    pub message: String,
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.field {
            Some(field) => write!(f, "{} ({}): {}", self.code, field, self.message),
            None => write!(f, "{}: {}", self.code, self.message),
        }
    }
}

impl std::error::Error for CoreError {}

impl CoreError {
    fn at(code: ErrorCode, field: Field, message: String) -> Self {
        Self {
            code,
            field: Some(field),
            message,
        }
    }

    /// `missing_date`: `{L} is required.`
    pub fn missing_date(field: Field) -> Self {
        Self::at(
            ErrorCode::MissingDate,
            field,
            format!("{} is required.", field.label()),
        )
    }

    /// `invalid_date_format`: `{L} must be in YYYY-MM-DD format.`
    pub fn invalid_date_format(field: Field) -> Self {
        Self::at(
            ErrorCode::InvalidDateFormat,
            field,
            format!("{} must be in YYYY-MM-DD format.", field.label()),
        )
    }

    /// `date_out_of_range`: `{L} must be between 0001-01-01 and 9999-12-31.`
    pub fn date_out_of_range(field: Field) -> Self {
        Self::at(
            ErrorCode::DateOutOfRange,
            field,
            format!(
                "{} must be between 0001-01-01 and 9999-12-31.",
                field.label()
            ),
        )
    }

    /// `invalid_month`: `{L} is not a real date: month must be 01 to 12.`
    pub fn invalid_month(field: Field) -> Self {
        Self::at(
            ErrorCode::InvalidMonth,
            field,
            format!(
                "{} is not a real date: month must be 01 to 12.",
                field.label()
            ),
        )
    }

    /// `invalid_day`: `{L} is not a real date: {MonthName} {YYYY} has {n} days.`
    pub fn invalid_day(field: Field, year: i64, month: u32, days_in_month: u32) -> Self {
        Self::at(
            ErrorCode::InvalidDay,
            field,
            format!(
                "{} is not a real date: {} {:04} has {} days.",
                field.label(),
                month_name(month),
                year,
                days_in_month
            ),
        )
    }

    /// `invalid_amount`: `{L} must be a whole number.`
    pub fn invalid_amount(field: Field) -> Self {
        Self::at(
            ErrorCode::InvalidAmount,
            field,
            format!("{} must be a whole number.", field.label()),
        )
    }

    /// `amount_out_of_range`: `{L} must be between -{max} and {max}.`
    pub fn amount_out_of_range(field: Field, max: i64) -> Self {
        let m = format_int(max);
        Self::at(
            ErrorCode::AmountOutOfRange,
            field,
            format!("{} must be between -{} and {}.", field.label(), m, m),
        )
    }

    /// `missing_time`: `{L} is required.`
    pub fn missing_time(field: Field) -> Self {
        Self::at(
            ErrorCode::MissingTime,
            field,
            format!("{} is required.", field.label()),
        )
    }

    /// `invalid_time`: `{L} must be a valid 24-hour time (HH:MM or HH:MM:SS).`
    pub fn invalid_time(field: Field) -> Self {
        Self::at(
            ErrorCode::InvalidTime,
            field,
            format!(
                "{} must be a valid 24-hour time (HH:MM or HH:MM:SS).",
                field.label()
            ),
        )
    }

    /// `invalid_utc_offset`: `{L} UTC offset must be between -1,080 and 1,080 minutes.`
    pub fn invalid_utc_offset(field: Field) -> Self {
        Self::at(
            ErrorCode::InvalidUtcOffset,
            field,
            format!(
                "{} UTC offset must be between -1,080 and 1,080 minutes.",
                field.label()
            ),
        )
    }

    /// `invalid_weekend` on `calendar.weekend`.
    pub fn invalid_weekend() -> Self {
        Self::at(
            ErrorCode::InvalidWeekend,
            Field::CalendarWeekend,
            "Weekend days must be distinct numbers from 1 (Monday) to 7 (Sunday).".to_string(),
        )
    }

    /// `no_working_days` on `calendar.weekend`.
    pub fn no_working_days() -> Self {
        Self::at(
            ErrorCode::NoWorkingDays,
            Field::CalendarWeekend,
            "At least one day of the week must be a working day.".to_string(),
        )
    }

    /// `birth_after_as_of` on `birthDate`.
    pub fn birth_after_as_of() -> Self {
        Self::at(
            ErrorCode::BirthAfterAsOf,
            Field::BirthDate,
            "Date of birth must be on or before the age-at date.".to_string(),
        )
    }

    /// `result_out_of_range` (no field).
    pub fn result_out_of_range() -> Self {
        Self {
            code: ErrorCode::ResultOutOfRange,
            field: None,
            message: "The result is outside the supported range (0001-01-01 to 9999-12-31)."
                .to_string(),
        }
    }

    /// `invalid_request` (no field): a serde failure at the IPC/bridge boundary.
    pub fn invalid_request() -> Self {
        Self {
            code: ErrorCode::InvalidRequest,
            field: None,
            message: "Invalid request.".to_string(),
        }
    }

    /// `invalid_schema_version` on `calendar.schemaVersion`.
    pub fn invalid_schema_version() -> Self {
        Self::at(
            ErrorCode::InvalidSchemaVersion,
            Field::CalendarSchemaVersion,
            "Calendar schema version must be 1.".to_string(),
        )
    }

    /// `invalid_hijri_offset` on `calendar.hijriOffsetDays`.
    pub fn invalid_hijri_offset() -> Self {
        Self::at(
            ErrorCode::InvalidHijriOffset,
            Field::CalendarHijriOffsetDays,
            "Islamic date offset must be between -2 and 2 days.".to_string(),
        )
    }

    /// `too_many_hijri_overrides` on `calendar.hijriOverrides`.
    pub fn too_many_hijri_overrides(max: usize) -> Self {
        Self::at(
            ErrorCode::TooManyHijriOverrides,
            Field::CalendarHijriOverrides,
            format!("At most {max} Islamic date overrides are allowed."),
        )
    }

    /// `invalid_hijri_override`: `Islamic date override {n}: {problem}.`
    /// (`n` is 1-based).
    pub fn invalid_hijri_override(n: usize, problem: &str) -> Self {
        Self::at(
            ErrorCode::InvalidHijriOverride,
            Field::CalendarHijriOverrides,
            format!("Islamic date override {n}: {problem}."),
        )
    }

    /// `invalid_excluded_holiday`: `Excluded holidays ({preset}): {problem}.`
    pub fn invalid_excluded_holiday(preset: &str, problem: &str) -> Self {
        Self::at(
            ErrorCode::InvalidExcludedHoliday,
            Field::CalendarExcludedHolidays,
            format!("Excluded holidays ({preset}): {problem}."),
        )
    }

    /// `too_many_custom_holidays` on `calendar.customHolidays`.
    pub fn too_many_custom_holidays(max: usize) -> Self {
        Self::at(
            ErrorCode::TooManyCustomHolidays,
            Field::CalendarCustomHolidays,
            format!("At most {max} custom holidays are allowed."),
        )
    }

    /// `invalid_custom_holiday`: `Custom holiday {n}: {problem}.` (`n` is
    /// 1-based). The message never echoes user text.
    pub fn invalid_custom_holiday(n: usize, problem: &str) -> Self {
        Self::at(
            ErrorCode::InvalidCustomHoliday,
            Field::CalendarCustomHolidays,
            format!("Custom holiday {n}: {problem}."),
        )
    }

    /// `year_out_of_range` on `year`.
    pub fn year_out_of_range() -> Self {
        Self::at(
            ErrorCode::YearOutOfRange,
            Field::Year,
            "Year must be between 1 and 9,999.".to_string(),
        )
    }

    /// `month_out_of_range` on `month`.
    pub fn month_out_of_range() -> Self {
        Self::at(
            ErrorCode::MonthOutOfRange,
            Field::Month,
            "Month must be between 1 and 12.".to_string(),
        )
    }
}
