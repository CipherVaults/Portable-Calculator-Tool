//! The closed op list and per-op request caps.

use date_core::api::Op as DateOp;

use crate::store::Doc;
use crate::{CAP_ENGINE, CAP_HISTORY_VALIDATE, CAP_IMPORT, CAP_STORE, MAX_OP_BYTES};

/// A percentage calculator (PCT v2.3.0's eight cards).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PercentOp {
    /// `percent.change`: percentage change from an original to a new value.
    Change,
    /// `percent.percent`: what percent a part is of a total.
    Percent,
    /// `percent.what`: what is X% of a number.
    What,
    /// `percent.discount`: final price and amount saved.
    Discount,
    /// `percent.base`: the whole when a value is X% of it.
    Base,
    /// `percent.markup`: profit, markup and margin.
    Markup,
    /// `percent.tax`: add or extract tax/VAT.
    Tax,
    /// `percent.tip`: tip and bill split.
    Tip,
}

/// A history op besides `history.validate` (plan B10, M3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HistoryOp {
    /// `history.apply`: add, import, delete, pin and note on the stored
    /// document, then the caps.
    Apply,
    /// `history.import_preview`: an export file's entries, checked one by one.
    ImportPreview,
    /// `history.export_csv`: the history as CSV (formula cells escaped).
    ExportCsv,
}

/// One API operation. The list is closed: anything else is `unknown_op`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Op {
    /// `meta.versions`.
    MetaVersions,
    /// A `date.*` op, delegated to `date_core::api`.
    Date(DateOp),
    /// A `percent.*` op.
    Percent(PercentOp),
    /// A store validator: `settings.validate`, `state.validate`,
    /// `history.validate`, `countdowns.validate` (plan B10, B11).
    Validate(Doc),
    /// A history op (`history.apply`, `history.import_preview`,
    /// `history.export_csv`).
    History(HistoryOp),
}

/// `(name, op)` for every op, in documentation order.
const TABLE: [(&str, Op); 25] = [
    ("meta.versions", Op::MetaVersions),
    ("date.days_between", Op::Date(DateOp::CalcDaysBetween)),
    ("date.add_subtract", Op::Date(DateOp::CalcAddSubtract)),
    ("date.business_days", Op::Date(DateOp::CalcBusinessDays)),
    ("date.age", Op::Date(DateOp::CalcAge)),
    ("date.date_info", Op::Date(DateOp::CalcDateInfo)),
    ("date.countdown", Op::Date(DateOp::CalcCountdown)),
    ("date.holidays_in_range", Op::Date(DateOp::HolidaysInRange)),
    ("date.month_grid", Op::Date(DateOp::MonthGrid)),
    ("date.validate_calendar", Op::Date(DateOp::ValidateCalendar)),
    ("percent.change", Op::Percent(PercentOp::Change)),
    ("percent.percent", Op::Percent(PercentOp::Percent)),
    ("percent.what", Op::Percent(PercentOp::What)),
    ("percent.discount", Op::Percent(PercentOp::Discount)),
    ("percent.base", Op::Percent(PercentOp::Base)),
    ("percent.markup", Op::Percent(PercentOp::Markup)),
    ("percent.tax", Op::Percent(PercentOp::Tax)),
    ("percent.tip", Op::Percent(PercentOp::Tip)),
    ("settings.validate", Op::Validate(Doc::Settings)),
    ("state.validate", Op::Validate(Doc::State)),
    ("history.validate", Op::Validate(Doc::History)),
    ("countdowns.validate", Op::Validate(Doc::Countdowns)),
    ("history.apply", Op::History(HistoryOp::Apply)),
    (
        "history.import_preview",
        Op::History(HistoryOp::ImportPreview),
    ),
    ("history.export_csv", Op::History(HistoryOp::ExportCsv)),
];

impl Op {
    /// Every op, in documentation order.
    pub const ALL: [Op; 25] = {
        let mut all = [Op::MetaVersions; 25];
        let mut i = 0;
        while i < TABLE.len() {
            all[i] = TABLE[i].1;
            i += 1;
        }
        all
    };

    /// The op's wire name.
    pub fn name(self) -> &'static str {
        TABLE
            .iter()
            .find(|(_, op)| *op == self)
            .map_or("", |(name, _)| name)
    }

    /// Looks an op up by its exact wire name.
    pub fn parse(name: &str) -> Option<Op> {
        if name.len() > MAX_OP_BYTES {
            return None;
        }
        TABLE.iter().find(|(n, _)| *n == name).map(|(_, op)| *op)
    }

    /// [`Op::parse`] on raw bytes (invalid UTF-8 is never an op).
    pub fn parse_bytes(name: &[u8]) -> Option<Op> {
        std::str::from_utf8(name).ok().and_then(Op::parse)
    }

    /// The largest raw request this op accepts, in bytes (plan B2's table).
    ///
    /// | Ops | Cap |
    /// |---|---|
    /// | `meta.*`, `date.*`, `percent.*` (and later `calc`, `prog`, `units`, `graph`) | [`CAP_ENGINE`] (64 KiB) |
    /// | `settings.validate`, `state.validate`, `countdowns.validate` | [`CAP_STORE`] (256 KiB) |
    /// | `history.validate`, `history.export_csv` | [`CAP_HISTORY_VALIDATE`] (4.5 MiB) |
    /// | `history.import_preview`, `history.apply` | [`CAP_IMPORT`] (8 MiB) |
    ///
    /// `history.apply` carries the stored document (at most 4 MiB written)
    /// plus the operations, an import's new entries included, so it shares
    /// the import cap. `legacy.preview` was dropped with the owner's "no
    /// legacy migration". The match is exhaustive, so a new op cannot
    /// compile without a cap.
    pub const fn request_cap(self) -> usize {
        match self {
            Op::MetaVersions => CAP_ENGINE,
            Op::Date(_) => CAP_ENGINE,
            Op::Percent(_) => CAP_ENGINE,
            Op::Validate(Doc::History) => CAP_HISTORY_VALIDATE,
            Op::Validate(Doc::Settings | Doc::State | Doc::Countdowns) => CAP_STORE,
            Op::History(HistoryOp::ExportCsv) => CAP_HISTORY_VALIDATE,
            Op::History(HistoryOp::Apply | HistoryOp::ImportPreview) => CAP_IMPORT,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip_and_are_unique() {
        for op in Op::ALL {
            assert_eq!(Op::parse(op.name()), Some(op));
            assert!(op.name().len() <= MAX_OP_BYTES);
        }
        let mut names: Vec<&str> = TABLE.iter().map(|(n, _)| *n).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), TABLE.len());
    }

    #[test]
    fn every_date_core_op_is_reachable() {
        for date_op in DateOp::ALL {
            assert!(Op::ALL.contains(&Op::Date(date_op)), "{date_op:?}");
            // The wire name is the date-core name without its `calc_` prefix.
            let name = Op::Date(date_op).name();
            let core = date_op.name();
            assert_eq!(
                name.strip_prefix("date.").unwrap(),
                core.strip_prefix("calc_").unwrap_or(core)
            );
        }
    }
}
