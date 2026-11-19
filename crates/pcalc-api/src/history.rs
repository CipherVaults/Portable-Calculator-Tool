//! History (plan B10, M3): the strict entry schema per tool and the three
//! history ops besides `history.validate`.
//!
//! # Entry
//!
//! `{id, timestampMs, tool, calculator, calculatorLabel, inputs,
//! expressionText, inputsText, resultText, copyText, pinned, note, engine}`,
//! every field required, nothing else allowed:
//!
//! - `id`: `h-<ms>-<n>` (1-16 and 1-10 ASCII digits);
//! - `tool`/`calculator`/`inputs`: the Date tool (`between` … `countdown`,
//!   the 15-field `HistoryInputs` of Date Calculator v1.1.0: each
//!   calculator's own keys, all required, each checked by date-core's own
//!   parser) and the Percentage tool (`change` … `tip`,
//!   `{inputA, inputB, inputC?, mode?}` as decimal strings, `inputC` only
//!   and always for `tip`, `mode` only and always for `tax`). The
//!   calculators, the converters and graphing refuse every entry until
//!   their milestones define their inputs;
//! - texts: `calculatorLabel`, `inputsText`, `resultText` one line,
//!   1..=1,024 characters, not blank; `expressionText` one line, 0..=1,024;
//!   `copyText` 1..=4,096 (line feeds and tabs allowed); `note` `null` or
//!   one line of 1..=200; `engine` 1..=64 of `[A-Za-z0-9 ._+-]`.
//!
//! Inputs are written in a fixed key order (not a JSON map), so the
//! canonical text is the same whatever map implementation a build uses.
//!
//! # Ops
//!
//! - `history.apply` `{doc: <history>|null, ops: [...]}`: applies `add`,
//!   `import`, `delete`, `pin` and `note` to the stored document as it is
//!   now (the stores read it inside their write lock), then sorts newest
//!   first, evicts the oldest unpinned entries beyond 2,000 and beyond the
//!   4 MiB write cap (pinned entries are never evicted) and answers the new
//!   canonical document with counts. `add` is idempotent by id and merges
//!   with the newest entry when it is the same calculation (tool,
//!   calculator, inputs and result): only the time moves.
//! - `history.import_preview`: the raw text of an export file (or of a bare
//!   history document), at most 8 MiB. Each entry is checked on its own:
//!   the valid ones come back canonical, the rest are counted as rejected
//!   with their first fields; ids repeated inside the file count once.
//! - `history.export_csv`: a history document in, CSV out. A cell that
//!   starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'`
//!   first (spreadsheet formula injection), then RFC 4180 quoting.

use std::collections::HashSet;

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::Value;

use crate::envelope::ok_json;
use crate::store::{
    error_json, join, object, one_of, DocError, DATE_CARDS, MAX_TIMESTAMP_MS, PERCENT_CARDS,
};

/// Unpinned entries kept (the oldest is evicted beyond this).
pub const HISTORY_MAX_UNPINNED: usize = 2000;
/// Pinned entries kept (never evicted; pinning more is refused).
pub const HISTORY_MAX_PINNED: usize = 200;
/// Largest canonical history document the stores write (B10: 4 MiB).
pub const HISTORY_WRITE_CAP: usize = 4 * 1024 * 1024;
/// One-line texts.
pub const TEXT_MAX: usize = 1024;
/// `copyText`.
pub const COPY_TEXT_MAX: usize = 4096;
/// `note`.
pub const NOTE_MAX: usize = 200;
const ENGINE_MAX: usize = 64;
const DATE_INPUT_MAX: usize = 256;
const PERCENT_INPUT_MAX: usize = 64;
/// Entries read from one import file (8 MiB holds far fewer valid ones).
const IMPORT_MAX_ENTRIES: usize = 50_000;
/// Operations in one `history.apply` request.
const APPLY_MAX_OPS: usize = 5_000;
/// Rejected fields reported by an import preview.
const REJECTED_FIELDS_MAX: usize = 10;

/// Every tool of the app (B10).
pub const TOOLS: [&str; 7] = [
    "standard",
    "scientific",
    "programmer",
    "graphing",
    "converter",
    "percent",
    "date",
];

/// The export file's `format` and the `formatVersion` this build writes.
pub const EXPORT_FORMAT: &str = "portable-calculator-export";
/// The export format version this build reads and writes.
pub const EXPORT_FORMAT_VERSION: u64 = 1;

// ---------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------

/// An entry's inputs in their fixed order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Inputs(Vec<(&'static str, String)>);

impl Serialize for Inputs {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

/// One history entry (canonical field order).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    id: String,
    timestamp_ms: u64,
    tool: &'static str,
    calculator: &'static str,
    calculator_label: String,
    inputs: Inputs,
    expression_text: String,
    inputs_text: String,
    result_text: String,
    copy_text: String,
    pinned: bool,
    note: Option<String>,
    engine: String,
}

impl Entry {
    /// The same calculation (the duplicate-newest merge).
    fn same_calculation(&self, other: &Entry) -> bool {
        self.tool == other.tool
            && self.calculator == other.calculator
            && self.inputs == other.inputs
            && self.result_text == other.result_text
    }
}

/// The history document.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    schema_version: u64,
    entries: Vec<Entry>,
}

/// `h-<1..16 digits>-<1..10 digits>`.
fn entry_id(v: &Value, path: &str) -> Result<String, DocError> {
    let ok = v.as_str().is_some_and(|s| {
        let Some(rest) = s.strip_prefix("h-") else {
            return false;
        };
        let Some((ms, n)) = rest.split_once('-') else {
            return false;
        };
        let digits = |p: &str, max: usize| {
            (1..=max).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit())
        };
        digits(ms, 16) && digits(n, 10)
    });
    match v.as_str() {
        Some(s) if ok => Ok(s.to_string()),
        _ => Err(DocError::at(path, "Expected an id h-<ms>-<n>.")),
    }
}

/// One line of text: at most `max` characters, no control characters,
/// and (unless `allow_empty`) not blank.
fn line(v: &Value, path: &str, max: usize, allow_empty: bool) -> Result<String, DocError> {
    let Some(s) = v.as_str() else {
        return Err(DocError::at(path, "Expected text."));
    };
    if s.chars().count() > max {
        return Err(DocError::at(path, format!("At most {max} characters.")));
    }
    if s.chars().any(char::is_control) {
        return Err(DocError::at(path, "One line without control characters."));
    }
    if !allow_empty && s.trim().is_empty() {
        return Err(DocError::at(path, "Must not be empty."));
    }
    Ok(s.to_string())
}

/// `copyText`: like [`line`] but line feeds and tabs are allowed.
fn multiline(v: &Value, path: &str) -> Result<String, DocError> {
    let Some(s) = v.as_str() else {
        return Err(DocError::at(path, "Expected text."));
    };
    if s.chars().count() > COPY_TEXT_MAX {
        return Err(DocError::at(
            path,
            format!("At most {COPY_TEXT_MAX} characters."),
        ));
    }
    if s.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
        return Err(DocError::at(
            path,
            "No control characters but line feeds and tabs.",
        ));
    }
    if s.trim().is_empty() {
        return Err(DocError::at(path, "Must not be empty."));
    }
    Ok(s.to_string())
}

/// `note`: `null`, or one line of 1..=200 characters (blank is `null`).
fn note(v: &Value, path: &str) -> Result<Option<String>, DocError> {
    if v.is_null() {
        return Ok(None);
    }
    let s = line(v, path, NOTE_MAX, true)?;
    Ok(if s.trim().is_empty() { None } else { Some(s) })
}

fn engine_name(v: &Value, path: &str) -> Result<String, DocError> {
    match v.as_str() {
        Some(s)
            if (1..=ENGINE_MAX).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b" ._+-".contains(&b)) =>
        {
            Ok(s.to_string())
        }
        _ => Err(DocError::at(
            path,
            "Expected an engine name such as date-core 1.0.0.",
        )),
    }
}

// -- Date inputs (Date Calculator v1.1.0 INPUT_KEYS) -------------------------

#[derive(Clone, Copy)]
enum DateKind {
    Date(date_core::Field),
    OptionalDate(date_core::Field),
    Bool,
    Operation,
    Amount(date_core::Field),
    LeapDayRule,
    OptionalTime(date_core::Field),
}

/// Every Date input key, in `HistoryInputs` field order.
const DATE_INPUTS: [(&str, DateKind); 15] = {
    use date_core::Field as F;
    [
        ("startDate", DateKind::Date(F::StartDate)),
        ("endDate", DateKind::Date(F::EndDate)),
        ("includeEndDay", DateKind::Bool),
        ("date", DateKind::Date(F::Date)),
        ("operation", DateKind::Operation),
        ("years", DateKind::Amount(F::Years)),
        ("months", DateKind::Amount(F::Months)),
        ("weeks", DateKind::Amount(F::Weeks)),
        ("days", DateKind::Amount(F::Days)),
        ("businessDays", DateKind::Bool),
        ("birthDate", DateKind::Date(F::BirthDate)),
        ("asOfDate", DateKind::OptionalDate(F::AsOfDate)),
        ("leapDayRule", DateKind::LeapDayRule),
        ("targetDate", DateKind::Date(F::TargetDate)),
        ("targetTime", DateKind::OptionalTime(F::TargetTime)),
    ]
};

/// The input keys each Date calculator stores: all required, no others.
fn date_keys(calculator: &str) -> &'static [&'static str] {
    match calculator {
        "between" | "business" => &["startDate", "endDate", "includeEndDay"],
        "add" => &[
            "date",
            "operation",
            "years",
            "months",
            "weeks",
            "days",
            "businessDays",
        ],
        "age" => &["birthDate", "asOfDate", "leapDayRule"],
        "info" => &["date"],
        "countdown" => &["targetDate", "targetTime"],
        _ => &[],
    }
}

fn date_value(kind: DateKind, s: &str) -> bool {
    use date_core::{parse_amount, parse_date, parse_time};
    if s.len() > DATE_INPUT_MAX || s.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    match kind {
        DateKind::Date(f) => parse_date(s, f).is_ok(),
        DateKind::OptionalDate(f) => s.is_empty() || parse_date(s, f).is_ok(),
        DateKind::Bool => s == "true" || s == "false",
        DateKind::Operation => s == "add" || s == "subtract",
        DateKind::Amount(f) => parse_amount(s, f).is_ok(),
        DateKind::LeapDayRule => s == "feb28" || s == "mar1",
        DateKind::OptionalTime(f) => parse_time(s, f, false).is_ok(),
    }
}

fn date_inputs(v: &Value, path: &str, calculator: &str) -> Result<Inputs, DocError> {
    let mut o = object(v, path)?;
    let keys = date_keys(calculator);
    let mut out = Vec::with_capacity(keys.len());
    for (key, kind) in DATE_INPUTS {
        if !keys.contains(&key) {
            continue;
        }
        let (value, p) = o.get(key)?;
        match value.as_str() {
            Some(s) if date_value(kind, s) => out.push((key, s.to_string())),
            _ => return Err(DocError::at(&p, "Not a value this calculator accepts.")),
        }
    }
    o.finish()?;
    Ok(Inputs(out))
}

// -- Percentage inputs ----------------------------------------------------------

/// A plain decimal as the Percentage tool sends it after cleaning:
/// `[+-]digits[.digits][e[+-]digits]`, at most 64 characters.
fn decimal(s: &str) -> bool {
    if s.is_empty() || s.len() > PERCENT_INPUT_MAX {
        return false;
    }
    let b = s.as_bytes();
    let mut i = usize::from(b[0] == b'+' || b[0] == b'-');
    let (mut int, mut frac) = (0usize, 0usize);
    while i < b.len() && b[i].is_ascii_digit() {
        int += 1;
        i += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            frac += 1;
            i += 1;
        }
    }
    if int + frac == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    i == b.len()
}

const PERCENT_MODES: [&str; 2] = ["add", "extract"];

fn percent_inputs(v: &Value, path: &str, calculator: &str) -> Result<Inputs, DocError> {
    let mut o = object(v, path)?;
    let mut out = Vec::with_capacity(4);
    let names: &[&'static str] = if calculator == "tip" {
        &["inputA", "inputB", "inputC"]
    } else {
        &["inputA", "inputB"]
    };
    for key in names {
        let (value, p) = o.get(key)?;
        match value.as_str() {
            Some(s) if decimal(s) => out.push((*key, s.to_string())),
            _ => return Err(DocError::at(&p, "Expected a plain decimal number.")),
        }
    }
    if calculator == "tax" {
        let mode = o.one_of("mode", &PERCENT_MODES)?;
        out.push(("mode", mode.to_string()));
    }
    o.finish()?;
    Ok(Inputs(out))
}

/// Reads and checks one entry (see the module docs).
pub(crate) fn entry(value: &Value, at: &str) -> Result<Entry, DocError> {
    let mut e = object(value, at)?;
    let (v, p) = e.get("id")?;
    let id = entry_id(v, &p)?;
    let timestamp_ms = e.uint("timestampMs", MAX_TIMESTAMP_MS)?;
    let tool = e.one_of("tool", &TOOLS)?;
    let (v, p) = e.get("calculator")?;
    let calculator = match tool {
        "date" => one_of(v, &p, &DATE_CARDS)?,
        "percent" => one_of(v, &p, &PERCENT_CARDS)?,
        _ => {
            return Err(DocError::at(
                &join(at, "tool"),
                "History for this tool arrives with its milestone.",
            ))
        }
    };
    let (v, p) = e.get("calculatorLabel")?;
    let calculator_label = line(v, &p, TEXT_MAX, false)?;
    let (v, p) = e.get("inputs")?;
    let inputs = if tool == "date" {
        date_inputs(v, &p, calculator)?
    } else {
        percent_inputs(v, &p, calculator)?
    };
    let (v, p) = e.get("expressionText")?;
    let expression_text = line(v, &p, TEXT_MAX, true)?;
    let (v, p) = e.get("inputsText")?;
    let inputs_text = line(v, &p, TEXT_MAX, false)?;
    let (v, p) = e.get("resultText")?;
    let result_text = line(v, &p, TEXT_MAX, false)?;
    let (v, p) = e.get("copyText")?;
    let copy_text = multiline(v, &p)?;
    let pinned = e.boolean("pinned")?;
    let (v, p) = e.get("note")?;
    let note = match v {
        Value::Null => None,
        // A stored note is never blank (blank is written as null).
        _ => Some(line(v, &p, NOTE_MAX, false)?),
    };
    let (v, p) = e.get("engine")?;
    let engine = engine_name(v, &p)?;
    e.finish()?;
    Ok(Entry {
        id,
        timestamp_ms,
        tool,
        calculator,
        calculator_label,
        inputs,
        expression_text,
        inputs_text,
        result_text,
        copy_text,
        pinned,
        note,
        engine,
    })
}

/// Reads and checks a history document rooted at `root` ("" for the
/// stored document, "doc" inside `history.apply`).
pub(crate) fn history(value: &Value, root: &str) -> Result<History, DocError> {
    let mut o = object(value, root)?;
    let schema_version = o.uint("schemaVersion", 1)?;
    if schema_version != 1 {
        return Err(DocError::at(
            &join(root, "schemaVersion"),
            "This schemaVersion is not supported.",
        ));
    }
    let (items, path) = o.array("entries", HISTORY_MAX_UNPINNED + HISTORY_MAX_PINNED)?;
    let mut entries = Vec::with_capacity(items.len());
    let mut ids: HashSet<String> = HashSet::with_capacity(items.len());
    let (mut pinned, mut unpinned) = (0usize, 0usize);
    for (i, item) in items.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let entry = entry(item, &at)?;
        if !ids.insert(entry.id.clone()) {
            return Err(DocError::at(&format!("{at}.id"), "Duplicate id."));
        }
        if entry.pinned {
            pinned += 1;
        } else {
            unpinned += 1;
        }
        if pinned > HISTORY_MAX_PINNED || unpinned > HISTORY_MAX_UNPINNED {
            return Err(DocError::at(&at, "Too many entries."));
        }
        entries.push(entry);
    }
    o.finish()?;
    Ok(History {
        schema_version,
        entries,
    })
}

// ---------------------------------------------------------------------------
// history.apply
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Applied {
    doc: History,
    added: usize,
    merged: usize,
    duplicates: usize,
    missing: usize,
    evicted: usize,
    pin_limit: bool,
}

/// The document's entries with a fast id lookup.
struct Working {
    entries: Vec<Entry>,
    ids: HashSet<String>,
    pinned: usize,
}

impl Working {
    fn new(entries: Vec<Entry>) -> Self {
        let ids = entries.iter().map(|e| e.id.clone()).collect();
        let pinned = entries.iter().filter(|e| e.pinned).count();
        Working {
            entries,
            ids,
            pinned,
        }
    }

    fn find(&mut self, id: &str) -> Option<&mut Entry> {
        if !self.ids.contains(id) {
            return None;
        }
        self.entries.iter_mut().find(|e| e.id == id)
    }
}

fn ids_list(v: &Value, path: &str) -> Result<Vec<String>, DocError> {
    let Value::Array(items) = v else {
        return Err(DocError::at(path, "Expected a list of ids."));
    };
    if items.len() > IMPORT_MAX_ENTRIES {
        return Err(DocError::at(path, "Too many ids."));
    }
    items
        .iter()
        .enumerate()
        .map(|(i, v)| entry_id(v, &format!("{path}[{i}]")))
        .collect()
}

/// Sorts newest first (ties by id, newest-looking first) and evicts the
/// oldest unpinned entries beyond the count cap and the 4 MiB write cap.
/// Pinned entries are never evicted.
fn fit(w: &mut Working) -> Result<usize, DocError> {
    w.entries.sort_by(|a, b| {
        b.timestamp_ms
            .cmp(&a.timestamp_ms)
            .then_with(|| b.id.cmp(&a.id))
    });
    let mut evicted = 0usize;
    let mut unpinned = w.entries.iter().filter(|e| !e.pinned).count();
    while unpinned > HISTORY_MAX_UNPINNED {
        if let Some(pos) = w.entries.iter().rposition(|e| !e.pinned) {
            w.entries.remove(pos);
            unpinned -= 1;
            evicted += 1;
        } else {
            break;
        }
    }
    loop {
        let doc = History {
            schema_version: 1,
            entries: std::mem::take(&mut w.entries),
        };
        let size = serde_json::to_string(&doc)
            .map(|s| s.len())
            .unwrap_or(usize::MAX);
        w.entries = doc.entries;
        if size <= HISTORY_WRITE_CAP {
            break;
        }
        let count = w.entries.len().max(1);
        let average = (size / count).max(1);
        let mut drop = (size - HISTORY_WRITE_CAP) / average + 1;
        let mut removed = 0usize;
        while drop > 0 {
            match w.entries.iter().rposition(|e| !e.pinned) {
                Some(pos) => {
                    w.entries.remove(pos);
                    drop -= 1;
                    removed += 1;
                }
                None => break,
            }
        }
        if removed == 0 {
            return Err(DocError::at(
                "doc",
                "The pinned entries alone are over the 4 MiB history cap.",
            ));
        }
        evicted += removed;
    }
    w.ids = w.entries.iter().map(|e| e.id.clone()).collect();
    Ok(evicted)
}

fn apply_value(req: &Value) -> Result<Applied, DocError> {
    let mut o = object(req, "")?;
    let (doc, _) = o.get("doc")?;
    let base = if doc.is_null() {
        Vec::new()
    } else {
        history(doc, "doc")?.entries
    };
    let (ops, ops_path) = o.array("ops", APPLY_MAX_OPS)?;
    o.finish()?;
    let mut w = Working::new(base);
    let mut out = Applied {
        doc: History {
            schema_version: 1,
            entries: Vec::new(),
        },
        added: 0,
        merged: 0,
        duplicates: 0,
        missing: 0,
        evicted: 0,
        pin_limit: false,
    };
    for (i, op) in ops.iter().enumerate() {
        let at = format!("{ops_path}[{i}]");
        let Value::Object(map) = op else {
            return Err(DocError::at(&at, "Expected an operation object."));
        };
        if map.len() != 1 {
            return Err(DocError::at(&at, "Expected exactly one operation."));
        }
        let Some((name, body)) = map.iter().next() else {
            return Err(DocError::at(&at, "Expected exactly one operation."));
        };
        let path = join(&at, name);
        match name.as_str() {
            "add" => {
                let e = entry(body, &path)?;
                if w.ids.contains(&e.id) {
                    out.duplicates += 1;
                    continue;
                }
                // The newest entry (the first of the newest timestamp).
                let newest = w
                    .entries
                    .iter()
                    .enumerate()
                    .max_by(|(ia, a), (ib, b)| a.timestamp_ms.cmp(&b.timestamp_ms).then(ib.cmp(ia)))
                    .map(|(i, _)| i);
                if let Some(n) = newest.filter(|n| w.entries[*n].same_calculation(&e)) {
                    let target = &mut w.entries[n];
                    target.timestamp_ms = target.timestamp_ms.max(e.timestamp_ms);
                    out.merged += 1;
                } else {
                    let mut e = e;
                    if e.pinned && w.pinned >= HISTORY_MAX_PINNED {
                        e.pinned = false;
                        out.pin_limit = true;
                    }
                    w.pinned += usize::from(e.pinned);
                    w.ids.insert(e.id.clone());
                    w.entries.push(e);
                    out.added += 1;
                }
            }
            "import" => {
                let Value::Array(items) = body else {
                    return Err(DocError::at(&path, "Expected a list of entries."));
                };
                if items.len() > IMPORT_MAX_ENTRIES {
                    return Err(DocError::at(&path, "Too many entries."));
                }
                for (j, item) in items.iter().enumerate() {
                    let mut e = entry(item, &format!("{path}[{j}]"))?;
                    if w.ids.contains(&e.id) {
                        out.duplicates += 1;
                        continue;
                    }
                    if e.pinned && w.pinned >= HISTORY_MAX_PINNED {
                        e.pinned = false;
                        out.pin_limit = true;
                    }
                    w.pinned += usize::from(e.pinned);
                    w.ids.insert(e.id.clone());
                    w.entries.push(e);
                    out.added += 1;
                }
            }
            "delete" => {
                for id in ids_list(body, &path)? {
                    if w.ids.remove(&id) {
                        if let Some(pos) = w.entries.iter().position(|e| e.id == id) {
                            let gone = w.entries.remove(pos);
                            w.pinned -= usize::from(gone.pinned);
                        }
                    } else {
                        out.missing += 1;
                    }
                }
            }
            "pin" => {
                let mut b = object(body, &path)?;
                let (v, p) = b.get("id")?;
                let id = entry_id(v, &p)?;
                let pinned = b.boolean("pinned")?;
                b.finish()?;
                let full = w.pinned >= HISTORY_MAX_PINNED;
                match w.find(&id) {
                    None => out.missing += 1,
                    Some(e) if e.pinned == pinned => {}
                    Some(_) if pinned && full => out.pin_limit = true,
                    Some(e) => {
                        e.pinned = pinned;
                        if pinned {
                            w.pinned += 1;
                        } else {
                            w.pinned -= 1;
                        }
                    }
                }
            }
            "note" => {
                let mut b = object(body, &path)?;
                let (v, p) = b.get("id")?;
                let id = entry_id(v, &p)?;
                let (v, p) = b.get("note")?;
                let text = note(v, &p)?;
                b.finish()?;
                match w.find(&id) {
                    None => out.missing += 1,
                    Some(e) => e.note = text,
                }
            }
            _ => {
                return Err(DocError::at(
                    &path,
                    "Expected add, import, delete, pin or note.",
                ))
            }
        }
    }
    out.evicted = fit(&mut w)?;
    out.doc.entries = w.entries;
    Ok(out)
}

/// The `history.apply` op.
pub(crate) fn apply(req: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(req) else {
        return crate::ApiError::INVALID_REQUEST.to_json();
    };
    match apply_value(&value) {
        Ok(applied) => ok_json(applied),
        Err(e) => error_json(e),
    }
}

// ---------------------------------------------------------------------------
// history.import_preview
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    status: &'static str,
    source: &'static str,
    app_version: Option<String>,
    exported_at_ms: Option<u64>,
    total: usize,
    rejected: usize,
    rejected_fields: Vec<String>,
    file_duplicates: usize,
    countdowns_valid: Option<bool>,
    settings_valid: Option<bool>,
    entries: Vec<Entry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NewerFile {
    status: &'static str,
    field: &'static str,
    version: u64,
}

enum PreviewOutcome {
    Ready(Preview),
    Newer(NewerFile),
}

fn preview_history(
    value: &Value,
    root: &str,
    out: &mut Preview,
) -> Result<Option<NewerFile>, DocError> {
    let mut h = object(value, root)?;
    let (v, p) = h.get("schemaVersion")?;
    let version = crate::store::uint(v, &p, u64::MAX)?;
    if version > 1 {
        return Ok(Some(NewerFile {
            status: "newer",
            field: "history.schemaVersion",
            version,
        }));
    }
    if version != 1 {
        return Err(DocError::at(&p, "This schemaVersion is not supported."));
    }
    let (items, path) = h.array("entries", IMPORT_MAX_ENTRIES)?;
    h.finish()?;
    let mut seen: HashSet<String> = HashSet::with_capacity(items.len());
    out.total = items.len();
    for (i, item) in items.iter().enumerate() {
        match entry(item, &format!("{path}[{i}]")) {
            Ok(e) => {
                if seen.insert(e.id.clone()) {
                    out.entries.push(e);
                } else {
                    out.file_duplicates += 1;
                }
            }
            Err(err) => {
                out.rejected += 1;
                if out.rejected_fields.len() < REJECTED_FIELDS_MAX {
                    out.rejected_fields.push(err.field.unwrap_or_default());
                }
            }
        }
    }
    Ok(None)
}

fn preview_value(value: &Value) -> Result<PreviewOutcome, DocError> {
    let Value::Object(map) = value else {
        return Err(DocError::at("", "Expected an export file."));
    };
    let mut out = Preview {
        status: "ok",
        source: "export",
        app_version: None,
        exported_at_ms: None,
        total: 0,
        rejected: 0,
        rejected_fields: Vec::new(),
        file_duplicates: 0,
        countdowns_valid: None,
        settings_valid: None,
        entries: Vec::new(),
    };
    if !map.contains_key("format") {
        // A bare history document.
        out.source = "history";
        return Ok(match preview_history(value, "", &mut out)? {
            Some(newer) => PreviewOutcome::Newer(newer),
            None => PreviewOutcome::Ready(out),
        });
    }
    let mut o = object(value, "")?;
    let (v, p) = o.get("format")?;
    if v.as_str() != Some(EXPORT_FORMAT) {
        return Err(DocError::at(&p, "Not a Portable Calculator export file."));
    }
    let (v, p) = o.get("formatVersion")?;
    let version = crate::store::uint(v, &p, u64::MAX)?;
    if version > EXPORT_FORMAT_VERSION {
        return Ok(PreviewOutcome::Newer(NewerFile {
            status: "newer",
            field: "formatVersion",
            version,
        }));
    }
    if version != EXPORT_FORMAT_VERSION {
        return Err(DocError::at(&p, "This formatVersion is not supported."));
    }
    let (v, p) = o.get("appVersion")?;
    out.app_version = Some(line(v, &p, 32, false)?);
    out.exported_at_ms = Some(o.uint("exportedAtMs", MAX_TIMESTAMP_MS)?);
    let (h, p) = o.get("history")?;
    let (c, pc) = o.get("countdowns")?;
    let (s, ps) = o.get("settings")?;
    o.finish()?;
    if !c.is_null() {
        if !c.is_object() {
            return Err(DocError::at(&pc, "Expected an object or null."));
        }
        out.countdowns_valid = Some(matches!(
            crate::store::validate(crate::store::Doc::Countdowns, &c.to_string()),
            Ok(crate::store::Validated::Current(_))
        ));
    }
    if !s.is_null() {
        if !s.is_object() {
            return Err(DocError::at(&ps, "Expected an object or null."));
        }
        out.settings_valid = Some(matches!(
            crate::store::validate(crate::store::Doc::Settings, &s.to_string()),
            Ok(crate::store::Validated::Current(_))
        ));
    }
    if !h.is_null() {
        if let Some(newer) = preview_history(h, &p, &mut out)? {
            return Ok(PreviewOutcome::Newer(newer));
        }
    }
    Ok(PreviewOutcome::Ready(out))
}

/// The `history.import_preview` op.
pub(crate) fn import_preview(req: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(req) else {
        return crate::ApiError::INVALID_REQUEST.to_json();
    };
    match preview_value(&value) {
        Ok(PreviewOutcome::Ready(p)) => ok_json(p),
        Ok(PreviewOutcome::Newer(n)) => ok_json(n),
        Err(e) => error_json(e),
    }
}

// ---------------------------------------------------------------------------
// history.export_csv
// ---------------------------------------------------------------------------

/// One CSV cell: a `'` before a leading `=`, `+`, `-`, `@`, tab or carriage
/// return (spreadsheet formula injection), then RFC 4180 quoting when the
/// cell holds a comma, a quote or a line break.
pub fn csv_cell(s: &str) -> String {
    let mut v = String::with_capacity(s.len() + 3);
    if matches!(s.chars().next(), Some('=' | '+' | '-' | '@' | '\t' | '\r')) {
        v.push('\'');
    }
    v.push_str(s);
    if v.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v
    }
}

/// `yyyy-mm-ddThh:mm:ssZ` for a time in ms since the Unix epoch.
fn utc_text(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// The CSV header row.
pub const CSV_HEADER: [&str; 13] = [
    "id",
    "timeUtc",
    "timestampMs",
    "tool",
    "calculator",
    "calculatorLabel",
    "expressionText",
    "inputsText",
    "resultText",
    "copyText",
    "pinned",
    "note",
    "engine",
];

fn csv(doc: &History) -> String {
    let mut out = String::new();
    out.push_str(&CSV_HEADER.join(","));
    out.push_str("\r\n");
    for e in &doc.entries {
        let cells = [
            e.id.clone(),
            utc_text(e.timestamp_ms),
            e.timestamp_ms.to_string(),
            e.tool.to_string(),
            e.calculator.to_string(),
            e.calculator_label.clone(),
            e.expression_text.clone(),
            e.inputs_text.clone(),
            e.result_text.clone(),
            e.copy_text.clone(),
            e.pinned.to_string(),
            e.note.clone().unwrap_or_default(),
            e.engine.clone(),
        ];
        let row: Vec<String> = cells.iter().map(|c| csv_cell(c)).collect();
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out
}

#[derive(Serialize)]
struct CsvOut {
    csv: String,
    rows: usize,
}

/// The `history.export_csv` op.
pub(crate) fn export_csv(req: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(req) else {
        return crate::ApiError::INVALID_REQUEST.to_json();
    };
    match history(&value, "") {
        Ok(doc) => ok_json(CsvOut {
            csv: csv(&doc),
            rows: doc.entries.len(),
        }),
        Err(e) => error_json(e),
    }
}

#[cfg(test)]
mod tests {
    //! History schema, caps, merge, import and CSV (plan B10, M3).

    use serde_json::{json, Value};

    use super::*;
    use crate::call;

    fn date_entry(id: &str, ts: u64, date: &str) -> Value {
        json!({
            "id": id, "timestampMs": ts, "tool": "date", "calculator": "info", "calculatorLabel": "Date Info",
            "inputs": {"date": date}, "expressionText": "", "inputsText": date, "resultText": format!("Info {date}"),
            "copyText": format!("{date}\nline two"), "pinned": false, "note": null, "engine": "date-core 1.0.0"
        })
    }

    fn percent_entry(id: &str, ts: u64, calculator: &str, inputs: Value) -> Value {
        json!({
            "id": id, "timestampMs": ts, "tool": "percent", "calculator": calculator, "calculatorLabel": "Label",
            "inputs": inputs, "expressionText": "", "inputsText": "in", "resultText": "out",
            "copyText": "copy", "pinned": false, "note": null, "engine": "percent-core 2.3.0"
        })
    }

    fn doc(entries: Vec<Value>) -> Value {
        json!({"schemaVersion": 1, "entries": entries})
    }

    fn validate_doc(v: &Value) -> String {
        call("history.validate", &v.to_string())
    }

    fn field_of(res: &str) -> Value {
        serde_json::from_str::<Value>(res).unwrap()["error"]["field"].clone()
    }

    fn ok(res: &str) -> Value {
        let v: Value = serde_json::from_str(res).unwrap();
        assert_eq!(v["ok"], "true", "{res}");
        v["result"].clone()
    }

    fn apply(doc: Value, ops: Value) -> Value {
        ok(&call(
            "history.apply",
            &json!({"doc": doc, "ops": ops}).to_string(),
        ))
    }

    #[test]
    fn date_inputs_are_strict_per_calculator() {
        let base = |calc: &str, inputs: Value| {
            let mut e = date_entry("h-1-0", 1, "2026-11-19");
            e["calculator"] = json!(calc);
            e["inputs"] = inputs;
            validate_doc(&doc(vec![e]))
        };
        let good = [
            (
                "between",
                json!({"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":"false"}),
            ),
            (
                "business",
                json!({"startDate":"2024-01-01","endDate":"2023-12-31","includeEndDay":"true"}),
            ),
            (
                "add",
                json!({"date":"2024-01-31","operation":"subtract","years":"","months":"-1","weeks":"0","days":"+3","businessDays":"true"}),
            ),
            (
                "age",
                json!({"birthDate":"2000-02-29","asOfDate":"","leapDayRule":"mar1"}),
            ),
            ("info", json!({"date":"0001-01-01"})),
            (
                "countdown",
                json!({"targetDate":"9999-12-31","targetTime":""}),
            ),
            (
                "countdown",
                json!({"targetDate":"2026-12-31","targetTime":"09:00"}),
            ),
        ];
        for (calc, inputs) in good {
            let res = base(calc, inputs.clone());
            assert!(res.starts_with(r#"{"ok":"true""#), "{calc} {inputs}: {res}");
        }
        let bad = [
            ("info", json!({}), "entries[0].inputs.date"),
            (
                "info",
                json!({"date":"2026-02-30"}),
                "entries[0].inputs.date",
            ),
            (
                "info",
                json!({"date":" 2026-11-19"}),
                "entries[0].inputs.date",
            ),
            (
                "info",
                json!({"date":"2026-11-19","endDate":"2026-11-19"}),
                "entries[0].inputs.endDate",
            ),
            ("info", json!({"date":19}), "entries[0].inputs.date"),
            (
                "between",
                json!({"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":"yes"}),
                "entries[0].inputs.includeEndDay",
            ),
            (
                "add",
                json!({"date":"2024-01-31","operation":"times","years":"","months":"","weeks":"","days":"","businessDays":"false"}),
                "entries[0].inputs.operation",
            ),
            (
                "add",
                json!({"date":"2024-01-31","operation":"add","years":"1.5","months":"","weeks":"","days":"","businessDays":"false"}),
                "entries[0].inputs.years",
            ),
            (
                "age",
                json!({"birthDate":"2000-02-29","asOfDate":"x","leapDayRule":"mar1"}),
                "entries[0].inputs.asOfDate",
            ),
            (
                "age",
                json!({"birthDate":"2000-02-29","asOfDate":"","leapDayRule":"feb29"}),
                "entries[0].inputs.leapDayRule",
            ),
            (
                "countdown",
                json!({"targetDate":"2026-12-31","targetTime":"25:00"}),
                "entries[0].inputs.targetTime",
            ),
            (
                "nope",
                json!({"date":"2026-11-19"}),
                "entries[0].calculator",
            ),
            (
                "change",
                json!({"date":"2026-11-19"}),
                "entries[0].calculator",
            ),
        ];
        for (calc, inputs, field) in bad {
            assert_eq!(
                field_of(&base(calc, inputs.clone())),
                field,
                "{calc} {inputs}"
            );
        }
    }

    #[test]
    fn percent_inputs_are_strict_per_calculator() {
        let check = |calc: &str, inputs: Value| {
            validate_doc(&doc(vec![percent_entry("h-1-0", 1, calc, inputs)]))
        };
        for (calc, inputs) in [
            ("change", json!({"inputA":"150","inputB":"180"})),
            ("discount", json!({"inputA":"79.99","inputB":"-.5"})),
            (
                "tax",
                json!({"inputA":"100","inputB":"15","mode":"extract"}),
            ),
            ("tip", json!({"inputA":"100","inputB":"20","inputC":"3"})),
            ("what", json!({"inputA":"1e-3","inputB":"+2E5"})),
        ] {
            let res = check(calc, inputs.clone());
            assert!(res.starts_with(r#"{"ok":"true""#), "{calc} {inputs}: {res}");
        }
        for (calc, inputs, field) in [
            (
                "change",
                json!({"inputA":"150"}),
                "entries[0].inputs.inputB",
            ),
            (
                "change",
                json!({"inputA":"150","inputB":"180","inputC":"1"}),
                "entries[0].inputs.inputC",
            ),
            (
                "change",
                json!({"inputA":"1,50","inputB":"180"}),
                "entries[0].inputs.inputA",
            ),
            (
                "change",
                json!({"inputA":"","inputB":"180"}),
                "entries[0].inputs.inputA",
            ),
            (
                "change",
                json!({"inputA":".","inputB":"180"}),
                "entries[0].inputs.inputA",
            ),
            (
                "change",
                json!({"inputA":"1e","inputB":"180"}),
                "entries[0].inputs.inputA",
            ),
            (
                "change",
                json!({"inputA":"١٥٠","inputB":"180"}),
                "entries[0].inputs.inputA",
            ),
            (
                "change",
                json!({"inputA":"150","inputB":"180","mode":"add"}),
                "entries[0].inputs.mode",
            ),
            (
                "tax",
                json!({"inputA":"100","inputB":"15"}),
                "entries[0].inputs.mode",
            ),
            (
                "tax",
                json!({"inputA":"100","inputB":"15","mode":"remove"}),
                "entries[0].inputs.mode",
            ),
            (
                "tip",
                json!({"inputA":"100","inputB":"20"}),
                "entries[0].inputs.inputC",
            ),
            (
                "between",
                json!({"inputA":"1","inputB":"2"}),
                "entries[0].calculator",
            ),
        ] {
            assert_eq!(
                field_of(&check(calc, inputs.clone())),
                field,
                "{calc} {inputs}"
            );
        }
        let long = "1".repeat(PERCENT_INPUT_MAX + 1);
        assert_eq!(
            field_of(&check("change", json!({"inputA": long, "inputB": "1"}))),
            "entries[0].inputs.inputA"
        );
        assert!(check(
            "change",
            json!({"inputA": "1".repeat(PERCENT_INPUT_MAX), "inputB": "1"})
        )
        .starts_with(r#"{"ok":"true""#));
    }

    #[test]
    fn tools_without_a_milestone_refuse_every_entry() {
        for tool in [
            "standard",
            "scientific",
            "programmer",
            "graphing",
            "converter",
        ] {
            let mut e = date_entry("h-1-0", 1, "2026-11-19");
            e["tool"] = json!(tool);
            e["calculator"] = json!(tool);
            e["inputs"] = json!({"expr": [{"n": "2"}]});
            assert_eq!(
                field_of(&validate_doc(&doc(vec![e]))),
                "entries[0].tool",
                "{tool}"
            );
        }
    }

    #[test]
    fn entry_fields_are_strict_and_capped() {
        let one = |f: &dyn Fn(&mut Value)| {
            let mut e = date_entry("h-1-0", 1, "2026-11-19");
            f(&mut e);
            validate_doc(&doc(vec![e]))
        };
        let okay = |res: String| assert!(res.starts_with(r#"{"ok":"true""#), "{res}");
        // Caps at cap and cap+1 (characters, not bytes).
        for (key, max) in [
            ("calculatorLabel", TEXT_MAX),
            ("inputsText", TEXT_MAX),
            ("resultText", TEXT_MAX),
            ("expressionText", TEXT_MAX),
            ("copyText", COPY_TEXT_MAX),
        ] {
            okay(one(&|e| e[key] = json!("é".repeat(max))));
            assert_eq!(
                field_of(&one(&|e| e[key] = json!("é".repeat(max + 1)))),
                format!("entries[0].{key}"),
                "{key}"
            );
        }
        okay(one(&|e| e["note"] = json!("ن".repeat(NOTE_MAX))));
        assert_eq!(
            field_of(&one(&|e| e["note"] = json!("ن".repeat(NOTE_MAX + 1)))),
            "entries[0].note"
        );
        // One-line texts refuse control characters; copyText allows \n and \t.
        assert_eq!(
            field_of(&one(&|e| e["resultText"] = json!("a\nb"))),
            "entries[0].resultText"
        );
        assert_eq!(
            field_of(&one(&|e| e["note"] = json!("a\u{7}"))),
            "entries[0].note"
        );
        okay(one(&|e| e["copyText"] = json!("a\n\tb")));
        assert_eq!(
            field_of(&one(&|e| e["copyText"] = json!("a\rb"))),
            "entries[0].copyText"
        );
        // Blank required texts and a blank stored note are refused.
        assert_eq!(
            field_of(&one(&|e| e["inputsText"] = json!("  "))),
            "entries[0].inputsText"
        );
        assert_eq!(
            field_of(&one(&|e| e["note"] = json!(" "))),
            "entries[0].note"
        );
        okay(one(&|e| e["expressionText"] = json!("")));
        // Ids, engine, legacy fields.
        for id in [
            "h-1",
            "x-1-0",
            "h-1-",
            "h--0",
            "h-12345678901234567-0",
            "h-1-12345678901",
            "h-1-0 ",
        ] {
            assert_eq!(
                field_of(&one(&|e| e["id"] = json!(id))),
                "entries[0].id",
                "{id}"
            );
        }
        okay(one(&|e| e["id"] = json!("h-1234567890123456-1234567890")));
        assert_eq!(
            field_of(&one(&|e| e["engine"] = json!(""))),
            "entries[0].engine"
        );
        assert_eq!(
            field_of(&one(&|e| e["engine"] = json!("date<core>"))),
            "entries[0].engine"
        );
        assert_eq!(
            field_of(&one(&|e| e["origin"] = json!("local"))),
            "entries[0].origin"
        );
        assert_eq!(
            field_of(&one(&|e| e["originKey"] = json!(null))),
            "entries[0].originKey"
        );
        assert_eq!(
            field_of(&one(&|e| e["timestampMs"] = json!(-1))),
            "entries[0].timestampMs"
        );
    }

    #[test]
    fn counts_are_capped_at_cap_and_cap_plus_one() {
        let entries = |unpinned: usize, pinned: usize| {
            let mut list = Vec::new();
            for i in 0..unpinned {
                list.push(date_entry(&format!("h-{i}-0"), i as u64, "2026-11-19"));
            }
            for i in 0..pinned {
                let mut e = date_entry(&format!("h-{i}-1"), i as u64, "2026-11-19");
                e["pinned"] = json!(true);
                list.push(e);
            }
            doc(list)
        };
        assert!(
            validate_doc(&entries(HISTORY_MAX_UNPINNED, HISTORY_MAX_PINNED))
                .starts_with(r#"{"ok":"true""#)
        );
        assert_eq!(
            field_of(&validate_doc(&entries(HISTORY_MAX_UNPINNED + 1, 0))),
            format!("entries[{HISTORY_MAX_UNPINNED}]")
        );
        assert_eq!(
            field_of(&validate_doc(&entries(0, HISTORY_MAX_PINNED + 1))),
            format!("entries[{HISTORY_MAX_PINNED}]")
        );
        let dup = doc(vec![
            date_entry("h-1-0", 1, "2026-11-19"),
            date_entry("h-1-0", 2, "2026-11-20"),
        ]);
        assert_eq!(field_of(&validate_doc(&dup)), "entries[1].id");
    }

    #[test]
    fn apply_adds_merges_the_newest_duplicate_and_is_idempotent_by_id() {
        let a = date_entry("h-10-1", 10, "2026-11-19");
        let r = apply(json!(null), json!([{"add": a}]));
        assert_eq!(
            (
                r["added"].as_u64(),
                r["doc"]["entries"].as_array().unwrap().len()
            ),
            (Some(1), 1)
        );
        // Same id again: a duplicate, nothing changes (a retried write).
        let again = apply(r["doc"].clone(), json!([{"add": a}]));
        assert_eq!(again["duplicates"], 1);
        assert_eq!(again["doc"], r["doc"]);
        // The same calculation with a new id merges into the newest entry.
        let mut same = date_entry("h-20-7", 20, "2026-11-19");
        same["copyText"] = json!("other copy");
        let merged = apply(r["doc"].clone(), json!([{"add": same}]));
        assert_eq!(merged["merged"], 1);
        let list = merged["doc"]["entries"].as_array().unwrap();
        assert_eq!(
            (
                list.len(),
                list[0]["id"].as_str(),
                list[0]["timestampMs"].as_u64()
            ),
            (1, Some("h-10-1"), Some(20))
        );
        // A different calculation is added, newest first.
        let other = date_entry("h-30-0", 30, "2026-11-20");
        let two = apply(merged["doc"].clone(), json!([{"add": other}]));
        let ids: Vec<&str> = two["doc"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["h-30-0", "h-10-1"]);
        // Only the newest is merged with: an older match is a new entry.
        let older_match = apply(
            two["doc"].clone(),
            json!([{"add": date_entry("h-40-0", 40, "2026-11-19")}]),
        );
        assert_eq!(
            (
                older_match["added"].as_u64(),
                older_match["merged"].as_u64()
            ),
            (Some(1), Some(0))
        );
        // Output is a valid stored document, canonical (a fixed point).
        let text = older_match["doc"].to_string();
        let v = ok(&call("history.validate", &text));
        assert_eq!(v["doc"], older_match["doc"]);
    }

    #[test]
    fn two_writers_never_lose_an_entry() {
        // Two windows record at once; each write applies its own operation to
        // the document as stored at that moment (the store's lock or
        // compare-and-save guarantees it is read fresh), so in either order
        // both entries survive. Replaying a write (a retry after a conflict)
        // changes nothing.
        let a = date_entry("h-100-1", 100, "2026-01-01");
        let b = date_entry("h-100-2", 100, "2026-01-02");
        let ab = apply(
            apply(json!(null), json!([{"add": a}]))["doc"].clone(),
            json!([{"add": b}]),
        );
        let ba = apply(
            apply(json!(null), json!([{"add": b}]))["doc"].clone(),
            json!([{"add": a}]),
        );
        assert_eq!(ab["doc"], ba["doc"]);
        assert_eq!(ab["doc"]["entries"].as_array().unwrap().len(), 2);
        let replay = apply(ab["doc"].clone(), json!([{"add": a}, {"add": b}]));
        assert_eq!(
            (replay["doc"].clone(), replay["duplicates"].as_u64()),
            (ab["doc"].clone(), Some(2))
        );
    }

    #[test]
    fn apply_pins_notes_deletes_and_never_evicts_pinned() {
        let mut list = Vec::new();
        for i in 0..(HISTORY_MAX_UNPINNED as u64) {
            list.push(date_entry(&format!("h-{}-0", i + 1), i + 1, "2026-11-19"));
        }
        // The oldest one is pinned: it survives every eviction.
        let mut pinned_old = date_entry("h-0-9", 0, "2026-11-18");
        pinned_old["pinned"] = json!(true);
        list.push(pinned_old);
        let full = doc(list);
        let r = apply(
            full,
            json!([{"add": date_entry("h-99999-0", 99_999, "2026-12-01")}]),
        );
        assert_eq!(
            (r["added"].as_u64(), r["evicted"].as_u64()),
            (Some(1), Some(1))
        );
        let entries = r["doc"]["entries"].as_array().unwrap();
        assert_eq!(entries.len(), HISTORY_MAX_UNPINNED + 1);
        assert!(entries.iter().any(|e| e["id"] == "h-0-9"), "pinned evicted");
        assert!(
            !entries.iter().any(|e| e["id"] == "h-1-0"),
            "oldest unpinned kept"
        );
        // Pin, unpin, note, a blank note is null, delete, missing ids.
        let small = apply(json!(null), json!([{"add": date_entry("h-1-0", 1, "2026-01-01")}, {"add": date_entry("h-2-0", 2, "2026-01-02")}]))["doc"].clone();
        let r = apply(
            small.clone(),
            json!([
                {"pin": {"id": "h-1-0", "pinned": true}},
                {"note": {"id": "h-2-0", "note": "عيد ميلاد"}},
                {"note": {"id": "h-1-0", "note": "  "}},
                {"pin": {"id": "h-9-9", "pinned": true}},
                {"delete": ["h-2-0", "h-8-8"]}
            ]),
        );
        assert_eq!(r["missing"], 2);
        let list = r["doc"]["entries"].as_array().unwrap();
        assert_eq!(
            (
                list.len(),
                list[0]["pinned"].as_bool(),
                list[0]["note"].clone()
            ),
            (1, Some(true), Value::Null)
        );
        let long_note = json!({"doc": small, "ops": [{"note": {"id": "h-2-0", "note": "x".repeat(NOTE_MAX + 1)}}]});
        assert_eq!(
            field_of(&call("history.apply", &long_note.to_string())),
            "ops[0].note.note"
        );
        // Pinning is refused at 200 pinned.
        let mut many = Vec::new();
        for i in 0..(HISTORY_MAX_PINNED as u64 + 1) {
            let mut e = date_entry(&format!("h-{i}-0"), i, "2026-11-19");
            e["pinned"] = json!(i < HISTORY_MAX_PINNED as u64);
            many.push(e);
        }
        let r = apply(
            doc(many),
            json!([{"pin": {"id": format!("h-{}-0", HISTORY_MAX_PINNED), "pinned": true}}]),
        );
        assert_eq!(r["pinLimit"], true);
        assert_eq!(
            r["doc"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|e| e["pinned"] == true)
                .count(),
            HISTORY_MAX_PINNED
        );
    }

    #[test]
    fn apply_rejects_bad_requests_with_a_field() {
        let field = |req: Value| field_of(&call("history.apply", &req.to_string()));
        assert_eq!(field(json!({"doc": null, "ops": [{"x": 1}]})), "ops[0].x");
        assert_eq!(
            field(json!({"doc": null, "ops": [{"add": 1, "delete": []}]})),
            "ops[0]"
        );
        assert_eq!(field(json!({"doc": null, "ops": [], "more": 1})), "more");
        assert_eq!(
            field(json!({"doc": {"schemaVersion": 2, "entries": []}, "ops": []})),
            "doc.schemaVersion"
        );
        assert_eq!(
            field(json!({"doc": doc(vec![json!({})]), "ops": []})),
            "doc.entries[0].id"
        );
        assert_eq!(
            field(json!({"doc": null, "ops": [{"delete": ["nope"]}]})),
            "ops[0].delete[0]"
        );
        assert_eq!(field(json!({"ops": []})), "doc");
        assert!(call("history.apply", "{").contains(r#""field":null"#));
    }

    #[test]
    fn apply_fits_the_four_mib_write_cap() {
        // 2,000 entries of ~3 KiB are over 4 MiB: the oldest unpinned go.
        let mut list = Vec::new();
        for i in 0..2000u64 {
            let mut e = date_entry(&format!("h-{}-0", i + 1), i + 1, "2026-11-19");
            e["copyText"] = json!("x".repeat(2500));
            list.push(e);
        }
        let req = json!({"doc": null, "ops": [{"import": list}]}).to_string();
        assert!(req.len() > HISTORY_WRITE_CAP);
        let r = ok(&call("history.apply", &req));
        let text = r["doc"].to_string();
        assert!(text.len() <= HISTORY_WRITE_CAP, "{}", text.len());
        assert!(r["evicted"].as_u64().unwrap() > 0);
        let kept = r["doc"]["entries"].as_array().unwrap();
        assert_eq!(kept[0]["id"], "h-2000-0", "the newest is kept");
        assert_eq!(kept.len() + r["evicted"].as_u64().unwrap() as usize, 2000);
        // At the cap the document is still a valid stored history.
        assert!(call("history.validate", &text).starts_with(r#"{"ok":"true""#));
    }

    fn export_file(entries: Vec<Value>) -> Value {
        json!({
            "format": EXPORT_FORMAT, "formatVersion": 1, "appVersion": "0.1.0", "exportedAtMs": 5,
            "history": doc(entries), "countdowns": null, "settings": null
        })
    }

    #[test]
    fn import_preview_checks_each_entry_and_commit_is_idempotent() {
        let mut bad = date_entry("h-3-0", 3, "2026-11-19");
        bad["inputs"] = json!({"date": "2026-02-30"});
        let file = export_file(vec![
            date_entry("h-1-0", 1, "2026-11-19"),
            date_entry("h-2-0", 2, "2026-11-20"),
            bad,
            date_entry("h-1-0", 9, "2026-11-21"),
            json!({"id": "h-4-0"}),
        ]);
        let p = ok(&call("history.import_preview", &file.to_string()));
        assert_eq!(
            (
                p["status"].as_str(),
                p["total"].as_u64(),
                p["rejected"].as_u64(),
                p["fileDuplicates"].as_u64()
            ),
            (Some("ok"), Some(5), Some(2), Some(1))
        );
        assert_eq!(
            p["rejectedFields"],
            json!([
                "history.entries[2].inputs.date",
                "history.entries[4].timestampMs"
            ])
        );
        let entries = p["entries"].clone();
        assert_eq!(entries.as_array().unwrap().len(), 2);
        // Commit into a history that already has h-2-0 (a different copy):
        // the existing entry is never replaced.
        let mut mine = date_entry("h-2-0", 2, "2026-11-20");
        mine["note"] = json!("mine");
        let stored = doc(vec![mine]);
        let once = apply(stored, json!([{"import": entries}]));
        assert_eq!(
            (once["added"].as_u64(), once["duplicates"].as_u64()),
            (Some(1), Some(1))
        );
        let kept = once["doc"]["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "h-2-0")
            .unwrap()
            .clone();
        assert_eq!(kept["note"], "mine");
        // Importing the same file again adds nothing.
        let twice = apply(once["doc"].clone(), json!([{"import": entries}]));
        assert_eq!(
            (twice["added"].as_u64(), twice["duplicates"].as_u64()),
            (Some(0), Some(2))
        );
        assert_eq!(twice["doc"], once["doc"]);
    }

    #[test]
    fn import_preview_reads_formats_and_refuses_others() {
        // A bare history document is accepted too.
        let bare = doc(vec![date_entry("h-1-0", 1, "2026-11-19")]);
        let p = ok(&call("history.import_preview", &bare.to_string()));
        assert_eq!(
            (p["source"].as_str(), p["entries"].as_array().unwrap().len()),
            (Some("history"), 1)
        );
        // Newer format or history schema: reported, never read.
        let mut newer = export_file(vec![]);
        newer["formatVersion"] = json!(2);
        newer["anything"] = json!(1);
        assert_eq!(
            ok(&call("history.import_preview", &newer.to_string()))["status"],
            "newer"
        );
        let mut newer_history = export_file(vec![]);
        newer_history["history"]["schemaVersion"] = json!(3);
        assert_eq!(
            ok(&call("history.import_preview", &newer_history.to_string()))["field"],
            "history.schemaVersion"
        );
        // Countdowns and settings are checked and reported, not imported.
        let mut with_docs = export_file(vec![]);
        with_docs["countdowns"] = json!({"schemaVersion": 1, "items": []});
        with_docs["settings"] = json!({"schemaVersion": 1});
        let p = ok(&call("history.import_preview", &with_docs.to_string()));
        assert_eq!(
            (p["countdownsValid"].as_bool(), p["settingsValid"].as_bool()),
            (Some(true), Some(false))
        );
        // Wrong format, unknown keys, not JSON.
        let mut other = export_file(vec![]);
        other["format"] = json!("percentage-calculator-export");
        assert_eq!(
            field_of(&call("history.import_preview", &other.to_string())),
            "format"
        );
        let mut extra = export_file(vec![]);
        extra["x"] = json!(1);
        assert_eq!(
            field_of(&call("history.import_preview", &extra.to_string())),
            "x"
        );
        assert!(call("history.import_preview", "not json").contains(r#""field":null"#));
        assert_eq!(field_of(&call("history.import_preview", "[]")), "");
    }

    #[test]
    fn csv_cells_escape_formulas_and_quote() {
        assert_eq!(csv_cell("plain"), "plain");
        for (raw, want) in [
            ("=1+1", "'=1+1"),
            ("+1", "'+1"),
            ("-5", "'-5"),
            ("@SUM(A1)", "'@SUM(A1)"),
            ("\tx", "'\tx"),
            ("\rx", "\"'\rx\""),
            ("a,b", "\"a,b\""),
            ("say \"hi\"", "\"say \"\"hi\"\"\""),
            (
                "=HYPERLINK(\"x\",\"y\")",
                "\"'=HYPERLINK(\"\"x\"\",\"\"y\"\")\"",
            ),
            ("two\nlines", "\"two\nlines\""),
            ("a=b", "a=b"),
            ("", ""),
        ] {
            assert_eq!(csv_cell(raw), want, "{raw:?}");
        }
        let mut e = date_entry("h-1795400000000-0", 1_795_400_000_000, "2026-11-19");
        e["note"] = json!("=cmd|' /C calc'!A0");
        e["calculatorLabel"] = json!("Date, Info");
        let res = ok(&call("history.export_csv", &doc(vec![e]).to_string()));
        let csv = res["csv"].as_str().unwrap();
        let mut lines = csv.split("\r\n");
        assert_eq!(lines.next().unwrap(), CSV_HEADER.join(","));
        let row = lines.next().unwrap();
        assert!(
            row.starts_with(
                "h-1795400000000-0,2026-11-23T02:13:20Z,1795400000000,date,info,\"Date, Info\","
            ),
            "{row}"
        );
        assert!(
            csv.contains(",'=cmd|' /C calc'!A0,date-core 1.0.0\r\n"),
            "{csv}"
        );
        assert_eq!(res["rows"], 1);
        assert!(call(
            "history.export_csv",
            r#"{"schemaVersion":1,"entries":[{}]}"#
        )
        .contains("entries[0].id"));
    }

    #[test]
    fn utc_text_is_civil_time() {
        assert_eq!(utc_text(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_text(951_782_400_000), "2000-02-29T00:00:00Z");
        assert_eq!(utc_text(MAX_TIMESTAMP_MS), "275760-09-13T00:00:00Z");
    }
}
