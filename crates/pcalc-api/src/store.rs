//! Store validators (plan B10, B11): `settings.validate`, `state.validate`,
//! `history.validate` and `countdowns.validate`.
//!
//! Each op takes the stored document's raw JSON text as its request and
//! answers one of:
//!
//! - `{"ok":"true","result":{"status":"ok","schemaVersion":1,"doc":{…}}}`:
//!   the document is valid; `doc` is its canonical form (fixed key order,
//!   the calendar normalised by date-core), which is what the stores keep.
//! - `{"ok":"true","result":{"status":"newer","schemaVersion":N,"supported":1}}`:
//!   written by a newer app. The store goes read-only, makes no backup and
//!   never writes it (B10 parse order).
//! - `{"ok":"false","error":{"code":"invalid_request","field":"<path>"|null,…}}`:
//!   not JSON, `schemaVersion` missing or invalid, or the strict schema
//!   failed at `field`. The store treats this as corrupt: a timestamped
//!   backup first, then read-only.
//!
//! `request_too_large` (the op's cap, checked by [`crate::call_bytes`]
//! before anything here runs) means "cannot validate": the store goes
//! read-only and leaves the data untouched, never down the corrupt path.
//!
//! **Parse order:** the raw JSON is parsed, then `schemaVersion` is read on
//! its own **before** any strict parse, so a newer document is never
//! mistaken for a corrupt one.
//!
//! Every level is strict: every field is required, unknown fields are
//! refused, enums are closed lists, texts and lists are capped. Any field
//! change to a stored struct bumps its `schemaVersion` (AGENTS.md); the
//! frozen key lists in `tests/fixtures/store-keys.json` fail the build if a
//! field set changes without that bump.
//!
//! `history` and `countdowns` are M2a skeletons of the B10/B11 schemas (the
//! history `inputs` object is not yet tagged by tool); M3 completes them.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::envelope::{ApiError, INTERNAL_JSON};

/// A stored document kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Doc {
    /// `settings`: preferences (B11).
    Settings,
    /// `state`: last route, pane and other session state (B11).
    State,
    /// `history`: calculation history (B10).
    History,
    /// `countdowns`: the countdown list (B11).
    Countdowns,
}

impl Doc {
    /// Every document kind.
    pub const ALL: [Doc; 4] = [Doc::Settings, Doc::State, Doc::History, Doc::Countdowns];

    /// The store name (also the desktop file stem and the IndexedDB key).
    pub const fn name(self) -> &'static str {
        match self {
            Doc::Settings => "settings",
            Doc::State => "state",
            Doc::History => "history",
            Doc::Countdowns => "countdowns",
        }
    }

    /// The schema version this build reads and writes.
    pub const fn schema_version(self) -> u64 {
        match self {
            Doc::Settings | Doc::State | Doc::History | Doc::Countdowns => 1,
        }
    }

    /// Looks a document kind up by its store name.
    pub fn from_name(name: &str) -> Option<Doc> {
        Doc::ALL.into_iter().find(|d| d.name() == name)
    }
}

/// A validation failure: `{"code","field","message"}` like every error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DocError {
    /// Always `invalid_request` (the API's code for a wrong shape).
    pub code: &'static str,
    /// The JSON path at fault (`appearance.theme`, `entries[3].id`), or
    /// `null` when the text is not JSON at all.
    pub field: Option<String>,
    /// English diagnostic (the UI shows catalog text, never this).
    pub message: String,
}

impl DocError {
    fn at(path: &str, message: impl Into<String>) -> Self {
        DocError {
            code: "invalid_request",
            field: Some(path.to_string()),
            message: message.into(),
        }
    }
}

/// The outcome of a successful validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Validated {
    /// The current schema: the canonical document JSON.
    Current(String),
    /// A newer schema this build must not read or write.
    Newer(u64),
}

/// Validates the raw JSON text of a stored document (see the module docs).
pub fn validate(doc: Doc, text: &str) -> Result<Validated, DocError> {
    let value: Value = serde_json::from_str(text).map_err(|_| DocError {
        code: "invalid_request",
        field: None,
        message: "The document is not valid JSON.".to_string(),
    })?;
    let Value::Object(map) = &value else {
        return Err(DocError::at("", "The document must be a JSON object."));
    };
    // schemaVersion first, on its own (B10 parse order).
    let version = match map.get("schemaVersion") {
        Some(Value::Number(n)) => n.as_u64().filter(|v| *v >= 1),
        _ => None,
    }
    .ok_or_else(|| {
        DocError::at(
            "schemaVersion",
            "schemaVersion must be a positive whole number.",
        )
    })?;
    let supported = doc.schema_version();
    if version > supported {
        return Ok(Validated::Newer(version));
    }
    if version < supported {
        // No older schema exists yet (v1 is the first); when one does, its
        // upgrade path goes here.
        return Err(DocError::at(
            "schemaVersion",
            "This schemaVersion is not supported.",
        ));
    }
    let canonical = match doc {
        Doc::Settings => to_json(&settings(&value)?),
        Doc::State => to_json(&state(&value)?),
        Doc::History => to_json(&history(&value)?),
        Doc::Countdowns => to_json(&countdowns(&value)?),
    };
    Ok(Validated::Current(canonical))
}

/// What a store does with a stored document's raw bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Checked {
    /// Valid; the canonical document JSON to keep.
    Current(String),
    /// A newer schema: read-only, no backup, never written.
    Newer(u64),
    /// Not valid (corrupt): a backup first, then read-only.
    Invalid(DocError),
    /// Over the op's cap (`request_too_large`): cannot be validated, so
    /// read-only and untouched; never treated as corrupt.
    TooLarge,
}

/// The `<doc>.validate` op on raw bytes, as a value: the same order of
/// checks as [`crate::call_bytes`] (the cap before anything, then UTF-8,
/// then [`validate`]). The native store (`pcalc-store`) decides with this.
pub fn check(doc: Doc, bytes: &[u8]) -> Checked {
    if bytes.len() > crate::Op::Validate(doc).request_cap() {
        return Checked::TooLarge;
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Checked::Invalid(DocError {
            code: "invalid_request",
            field: None,
            message: "The document is not valid UTF-8.".to_string(),
        });
    };
    match validate(doc, text) {
        Ok(Validated::Current(canonical)) => Checked::Current(canonical),
        Ok(Validated::Newer(version)) => Checked::Newer(version),
        Err(error) => Checked::Invalid(error),
    }
}

/// The API op: the envelope for [`validate`].
pub(crate) fn run(doc: Doc, req: &str) -> String {
    match validate(doc, req) {
        Ok(Validated::Current(canonical)) => format!(
            r#"{{"ok":"true","result":{{"status":"ok","schemaVersion":{},"doc":{canonical}}}}}"#,
            doc.schema_version()
        ),
        Ok(Validated::Newer(version)) => format!(
            r#"{{"ok":"true","result":{{"status":"newer","schemaVersion":{version},"supported":{}}}}}"#,
            doc.schema_version()
        ),
        // Not JSON at all: the same bytes as every other op's invalid_request.
        Err(DocError { field: None, .. }) => ApiError::INVALID_REQUEST.to_json(),
        Err(error) => {
            #[derive(Serialize)]
            struct Envelope {
                ok: &'static str,
                error: DocError,
            }
            serde_json::to_string(&Envelope { ok: "false", error })
                .unwrap_or_else(|_| INTERNAL_JSON.to_string())
        }
    }
}

fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| INTERNAL_JSON.to_string())
}

// ---------------------------------------------------------------------------
// Strict reading helpers
// ---------------------------------------------------------------------------

/// The latest instant a JavaScript `Date` can hold, in ms.
const MAX_TIMESTAMP_MS: u64 = 8_640_000_000_000_000;

/// A JSON object being read field by field; [`Obj::finish`] refuses any
/// field that was not read.
struct Obj<'a> {
    map: &'a Map<String, Value>,
    path: String,
    read: Vec<&'static str>,
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}.{key}")
    }
}

fn object<'a>(value: &'a Value, path: &str) -> Result<Obj<'a>, DocError> {
    match value {
        Value::Object(map) => Ok(Obj {
            map,
            path: path.to_string(),
            read: Vec::new(),
        }),
        _ => Err(DocError::at(path, "Expected an object.")),
    }
}

impl<'a> Obj<'a> {
    fn get(&mut self, key: &'static str) -> Result<(&'a Value, String), DocError> {
        self.read.push(key);
        let path = join(&self.path, key);
        match self.map.get(key) {
            Some(v) => Ok((v, path)),
            None => Err(DocError::at(&path, "This field is required.")),
        }
    }

    fn boolean(&mut self, key: &'static str) -> Result<bool, DocError> {
        let (v, path) = self.get(key)?;
        v.as_bool()
            .ok_or_else(|| DocError::at(&path, "Expected true or false."))
    }

    fn one_of(
        &mut self,
        key: &'static str,
        allowed: &'static [&'static str],
    ) -> Result<&'static str, DocError> {
        let (v, path) = self.get(key)?;
        one_of(v, &path, allowed)
    }

    fn uint(&mut self, key: &'static str, max: u64) -> Result<u64, DocError> {
        let (v, path) = self.get(key)?;
        uint(v, &path, max)
    }

    fn opt_uint(&mut self, key: &'static str, max: u64) -> Result<Option<u64>, DocError> {
        let (v, path) = self.get(key)?;
        if v.is_null() {
            Ok(None)
        } else {
            uint(v, &path, max).map(Some)
        }
    }

    fn text(&mut self, key: &'static str, max_chars: usize) -> Result<String, DocError> {
        let (v, path) = self.get(key)?;
        text(v, &path, max_chars)
    }

    fn opt_text(
        &mut self,
        key: &'static str,
        max_chars: usize,
    ) -> Result<Option<String>, DocError> {
        let (v, path) = self.get(key)?;
        if v.is_null() {
            Ok(None)
        } else {
            text(v, &path, max_chars).map(Some)
        }
    }

    fn object(&mut self, key: &'static str) -> Result<Obj<'a>, DocError> {
        let (v, path) = self.get(key)?;
        object(v, &path)
    }

    fn array(
        &mut self,
        key: &'static str,
        max_len: usize,
    ) -> Result<(&'a Vec<Value>, String), DocError> {
        let (v, path) = self.get(key)?;
        match v {
            Value::Array(items) if items.len() <= max_len => Ok((items, path)),
            Value::Array(_) => Err(DocError::at(&path, format!("At most {max_len} items."))),
            _ => Err(DocError::at(&path, "Expected a list.")),
        }
    }

    /// Refuses every field that was not read.
    fn finish(self) -> Result<(), DocError> {
        match self.map.keys().find(|k| !self.read.contains(&k.as_str())) {
            Some(extra) => Err(DocError::at(&join(&self.path, extra), "Unknown field.")),
            None => Ok(()),
        }
    }
}

fn one_of(
    v: &Value,
    path: &str,
    allowed: &'static [&'static str],
) -> Result<&'static str, DocError> {
    let s = v.as_str().unwrap_or("\u{0}");
    allowed
        .iter()
        .copied()
        .find(|a| *a == s)
        .ok_or_else(|| DocError::at(path, format!("Expected one of: {}.", allowed.join(", "))))
}

fn uint(v: &Value, path: &str, max: u64) -> Result<u64, DocError> {
    v.as_u64()
        .filter(|n| *n <= max)
        .ok_or_else(|| DocError::at(path, format!("Expected a whole number from 0 to {max}.")))
}

fn text(v: &Value, path: &str, max_chars: usize) -> Result<String, DocError> {
    match v.as_str() {
        Some(s) if s.chars().count() <= max_chars => Ok(s.to_string()),
        Some(_) => Err(DocError::at(
            path,
            format!("At most {max_chars} characters."),
        )),
        None => Err(DocError::at(path, "Expected text.")),
    }
}

/// An identifier: 1..=64 ASCII letters, digits, `-` and `_`.
fn ident(v: &Value, path: &str) -> Result<String, DocError> {
    match v.as_str() {
        Some(s)
            if (1..=64).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') =>
        {
            Ok(s.to_string())
        }
        _ => Err(DocError::at(
            path,
            "Expected an id (1-64 letters, digits, - or _).",
        )),
    }
}

/// `cardOrder`: every card exactly once.
fn parse_card_order(
    items: &[Value],
    path: &str,
    cards: &'static [&'static str],
) -> Result<Vec<&'static str>, DocError> {
    if items.len() != cards.len() {
        return Err(DocError::at(
            path,
            format!("Expected all {} cards once each.", cards.len()),
        ));
    }
    let mut out: Vec<&'static str> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let card = one_of(item, &format!("{path}[{i}]"), cards)?;
        if out.contains(&card) {
            return Err(DocError::at(&format!("{path}[{i}]"), "Duplicate card."));
        }
        out.push(card);
    }
    Ok(out)
}

/// `collapsedCards`: a duplicate-free subset of the cards.
fn parse_card_set(
    items: &[Value],
    path: &str,
    cards: &'static [&'static str],
) -> Result<Vec<&'static str>, DocError> {
    let mut out: Vec<&'static str> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let card = one_of(item, &format!("{path}[{i}]"), cards)?;
        if out.contains(&card) {
            return Err(DocError::at(&format!("{path}[{i}]"), "Duplicate card."));
        }
        out.push(card);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// settings (B11 + B5b appearance + B5c language)
// ---------------------------------------------------------------------------

/// The Date tool's six cards (Date Calculator v1.1.0 `CARD_KEYS`).
pub const DATE_CARDS: [&str; 6] = ["between", "add", "business", "age", "info", "countdown"];
/// The Percentage tool's eight cards (one per `percent.*` op).
pub const PERCENT_CARDS: [&str; 8] = [
    "change", "percent", "what", "discount", "base", "markup", "tax", "tip",
];
/// Settings → Appearance (B5b).
pub const THEMES: [&str; 4] = ["system", "terminal", "daylight", "retro"];
/// Settings → Language (B5c): `auto` follows the browser or OS.
pub const LANGUAGES: [&str; 13] = [
    "auto", "en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko",
];
const DIGITS: [&str; 3] = ["auto", "western", "arabic-indic"];
const GROUPING: [&str; 3] = ["comma", "thin", "none"];
const ANGLE_UNITS: [&str; 3] = ["deg", "rad", "grad"];
const WORD_SIZES: [&str; 4] = ["qword", "dword", "word", "byte"];
const BASES: [&str; 4] = ["hex", "dec", "oct", "bin"];
const SHIFT_MODES: [&str; 4] = ["arithmetic", "logical", "rotate", "rotateCarry"];
const FIRST_DAYS: [&str; 2] = ["monday", "sunday"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    schema_version: u64,
    check_updates_on_startup: bool,
    history: HistorySettings,
    display: DisplaySettings,
    calculator: CalculatorSettings,
    date: DateSettings,
    percent: PercentSettings,
    appearance: AppearanceSettings,
    language: LanguageSettings,
}

#[derive(Serialize)]
struct HistorySettings {
    enabled: bool,
}

#[derive(Serialize)]
struct DisplaySettings {
    grouping: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CalculatorSettings {
    angle_unit: &'static str,
    word_size: &'static str,
    base: &'static str,
    shift_mode: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DateSettings {
    first_day_of_week: &'static str,
    calendar: Value,
    card_order: Vec<&'static str>,
    collapsed_cards: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PercentSettings {
    card_order: Vec<&'static str>,
    collapsed_cards: Vec<&'static str>,
}

#[derive(Serialize)]
struct AppearanceSettings {
    theme: &'static str,
}

#[derive(Serialize)]
struct LanguageSettings {
    code: &'static str,
    digits: &'static str,
}

fn settings(value: &Value) -> Result<Settings, DocError> {
    let mut o = object(value, "")?;
    let schema_version = o.uint("schemaVersion", 1)?;
    let check_updates_on_startup = o.boolean("checkUpdatesOnStartup")?;

    let mut h = o.object("history")?;
    let history = HistorySettings {
        enabled: h.boolean("enabled")?,
    };
    h.finish()?;

    let mut d = o.object("display")?;
    let display = DisplaySettings {
        grouping: d.one_of("grouping", &GROUPING)?,
    };
    d.finish()?;

    let mut c = o.object("calculator")?;
    let calculator = CalculatorSettings {
        angle_unit: c.one_of("angleUnit", &ANGLE_UNITS)?,
        word_size: c.one_of("wordSize", &WORD_SIZES)?,
        base: c.one_of("base", &BASES)?,
        shift_mode: c.one_of("shiftMode", &SHIFT_MODES)?,
    };
    c.finish()?;

    let mut dt = o.object("date")?;
    let first_day_of_week = dt.one_of("firstDayOfWeek", &FIRST_DAYS)?;
    let (calendar_value, calendar_path) = dt.get("calendar")?;
    let calendar = calendar(calendar_value, &calendar_path)?;
    let (items, path) = dt.array("cardOrder", DATE_CARDS.len())?;
    let card_order = parse_card_order(items, &path, &DATE_CARDS)?;
    let (items, path) = dt.array("collapsedCards", DATE_CARDS.len())?;
    let collapsed_cards = parse_card_set(items, &path, &DATE_CARDS)?;
    dt.finish()?;
    let date = DateSettings {
        first_day_of_week,
        calendar,
        card_order,
        collapsed_cards,
    };

    let mut p = o.object("percent")?;
    let (items, path) = p.array("cardOrder", PERCENT_CARDS.len())?;
    let card_order = parse_card_order(items, &path, &PERCENT_CARDS)?;
    let (items, path) = p.array("collapsedCards", PERCENT_CARDS.len())?;
    let collapsed_cards = parse_card_set(items, &path, &PERCENT_CARDS)?;
    p.finish()?;
    let percent = PercentSettings {
        card_order,
        collapsed_cards,
    };

    let mut a = o.object("appearance")?;
    let appearance = AppearanceSettings {
        theme: a.one_of("theme", &THEMES)?,
    };
    a.finish()?;

    let mut l = o.object("language")?;
    let language = LanguageSettings {
        code: l.one_of("code", &LANGUAGES)?,
        digits: l.one_of("digits", &DIGITS)?,
    };
    l.finish()?;

    o.finish()?;
    Ok(Settings {
        schema_version,
        check_updates_on_startup,
        history,
        display,
        calculator,
        date,
        percent,
        appearance,
        language,
    })
}

/// The Date tool's calendar, validated and normalised by date-core's own
/// `validate_calendar` (the same strict rules as every `date.*` op).
fn calendar(value: &Value, path: &str) -> Result<Value, DocError> {
    if !value.is_object() {
        return Err(DocError::at(path, "Expected an object."));
    }
    let req = Value::Object(Map::from_iter([("calendar".to_string(), value.clone())]));
    let res = date_core::api::call(date_core::api::Op::ValidateCalendar, &req);
    let res = serde_json::to_value(&res).unwrap_or(Value::Null);
    if res["ok"] == "true" {
        return Ok(res["result"]["calendar"].clone());
    }
    let field = match res["error"]["field"].as_str() {
        Some(f) => format!("{path}.{}", f.strip_prefix("calendar.").unwrap_or(f)),
        None => path.to_string(),
    };
    let message = res["error"]["message"]
        .as_str()
        .unwrap_or("Invalid calendar.")
        .to_string();
    Err(DocError::at(&field, message))
}

// ---------------------------------------------------------------------------
// state (B11): M2a sections
// ---------------------------------------------------------------------------

const PANE_TABS: [&str; 3] = ["history", "memory", "countdowns"];
const PSEUDO_LOCALES: [&str; 3] = ["off", "en-XA", "ar-XB"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct State {
    schema_version: u64,
    route: String,
    pane: PaneState,
    dev: DevState,
}

#[derive(Serialize)]
struct PaneState {
    open: bool,
    tab: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevState {
    pseudo_locale: &'static str,
}

/// A route: `a-z` words joined by at most one `/` (the router keeps the
/// closed list; an unknown but well-formed route falls back to the default).
fn route(v: &Value, path: &str) -> Result<String, DocError> {
    let ok = |s: &str| {
        let mut parts = s.split('/');
        let word = |p: Option<&str>| {
            p.is_some_and(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
        };
        let first = word(parts.next());
        match parts.next() {
            None => first,
            Some(second) => first && word(Some(second)) && parts.next().is_none(),
        }
    };
    match v.as_str() {
        Some(s) if s.len() <= 40 && ok(s) => Ok(s.to_string()),
        _ => Err(DocError::at(
            path,
            "Expected a route such as standard or converter/length.",
        )),
    }
}

fn state(value: &Value) -> Result<State, DocError> {
    let mut o = object(value, "")?;
    let schema_version = o.uint("schemaVersion", 1)?;
    let (v, path) = o.get("route")?;
    let route = route(v, &path)?;
    let mut p = o.object("pane")?;
    let pane = PaneState {
        open: p.boolean("open")?,
        tab: p.one_of("tab", &PANE_TABS)?,
    };
    p.finish()?;
    let mut d = o.object("dev")?;
    let dev = DevState {
        pseudo_locale: d.one_of("pseudoLocale", &PSEUDO_LOCALES)?,
    };
    d.finish()?;
    o.finish()?;
    Ok(State {
        schema_version,
        route,
        pane,
        dev,
    })
}

// ---------------------------------------------------------------------------
// history (B10): M2a skeleton
// ---------------------------------------------------------------------------

/// Unpinned entries kept (the oldest is evicted beyond this).
pub const HISTORY_MAX_UNPINNED: usize = 2000;
/// Pinned entries kept (never evicted).
pub const HISTORY_MAX_PINNED: usize = 200;
const TOOLS: [&str; 7] = [
    "standard",
    "scientific",
    "programmer",
    "graphing",
    "converter",
    "percent",
    "date",
];
const TEXT_MAX: usize = 1024;
const COPY_TEXT_MAX: usize = 4096;
const NOTE_MAX: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct History {
    schema_version: u64,
    entries: Vec<HistoryEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    timestamp_ms: u64,
    tool: &'static str,
    calculator: String,
    calculator_label: String,
    inputs: Value,
    expression_text: String,
    inputs_text: String,
    result_text: String,
    copy_text: String,
    pinned: bool,
    note: Option<String>,
    engine: String,
}

fn history(value: &Value) -> Result<History, DocError> {
    let mut o = object(value, "")?;
    let schema_version = o.uint("schemaVersion", 1)?;
    let (items, path) = o.array("entries", HISTORY_MAX_UNPINNED + HISTORY_MAX_PINNED)?;
    let mut entries = Vec::with_capacity(items.len());
    let (mut pinned, mut unpinned) = (0usize, 0usize);
    for (i, item) in items.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let mut e = object(item, &at)?;
        let (v, p) = e.get("id")?;
        let id = ident(v, &p)?;
        let timestamp_ms = e.uint("timestampMs", MAX_TIMESTAMP_MS)?;
        let tool = e.one_of("tool", &TOOLS)?;
        let calculator = e.text("calculator", 64)?;
        let calculator_label = e.text("calculatorLabel", TEXT_MAX)?;
        let (inputs, p) = e.get("inputs")?;
        if !inputs.is_object() {
            return Err(DocError::at(&p, "Expected an object."));
        }
        let entry = HistoryEntry {
            id,
            timestamp_ms,
            tool,
            calculator,
            calculator_label,
            inputs: inputs.clone(),
            expression_text: e.text("expressionText", TEXT_MAX)?,
            inputs_text: e.text("inputsText", TEXT_MAX)?,
            result_text: e.text("resultText", TEXT_MAX)?,
            copy_text: e.text("copyText", COPY_TEXT_MAX)?,
            pinned: e.boolean("pinned")?,
            note: e.opt_text("note", NOTE_MAX)?,
            engine: e.text("engine", 64)?,
        };
        e.finish()?;
        if entries.iter().any(|x: &HistoryEntry| x.id == entry.id) {
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
// countdowns (B9, B11)
// ---------------------------------------------------------------------------

/// Countdowns kept.
pub const COUNTDOWNS_MAX: usize = 20;
const LABEL_MAX: usize = 60;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Countdowns {
    schema_version: u64,
    items: Vec<Countdown>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Countdown {
    id: String,
    label: String,
    target_date: String,
    target_time: String,
    created_at_ms: u64,
    saved_at_ms: u64,
    finished_seen_at_ms: Option<u64>,
}

fn countdowns(value: &Value) -> Result<Countdowns, DocError> {
    let mut o = object(value, "")?;
    let schema_version = o.uint("schemaVersion", 1)?;
    let (list, path) = o.array("items", COUNTDOWNS_MAX)?;
    let mut items: Vec<Countdown> = Vec::with_capacity(list.len());
    for (i, item) in list.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let mut c = object(item, &at)?;
        let (v, p) = c.get("id")?;
        let id = ident(v, &p)?;
        let label = c.text("label", LABEL_MAX)?;
        let (v, p) = c.get("targetDate")?;
        let target_date = match v.as_str() {
            Some(s)
                if date_core::parse_date(s, date_core::Field::TargetDate).is_ok()
                    && s.len() == 10 =>
            {
                s.to_string()
            }
            _ => return Err(DocError::at(&p, "Expected a date YYYY-MM-DD.")),
        };
        let (v, p) = c.get("targetTime")?;
        let target_time = match v.as_str() {
            Some("") => String::new(),
            Some(s)
                if s.len() == 5
                    && date_core::parse_time(s, date_core::Field::TargetTime, true).is_ok() =>
            {
                s.to_string()
            }
            _ => return Err(DocError::at(&p, "Expected \"\" or a time HH:MM.")),
        };
        let item = Countdown {
            id,
            label,
            target_date,
            target_time,
            created_at_ms: c.uint("createdAtMs", MAX_TIMESTAMP_MS)?,
            saved_at_ms: c.uint("savedAtMs", MAX_TIMESTAMP_MS)?,
            finished_seen_at_ms: c.opt_uint("finishedSeenAtMs", MAX_TIMESTAMP_MS)?,
        };
        c.finish()?;
        if items.iter().any(|x| x.id == item.id) {
            return Err(DocError::at(&format!("{at}.id"), "Duplicate id."));
        }
        items.push(item);
    }
    o.finish()?;
    Ok(Countdowns {
        schema_version,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::call;

    pub(crate) const SETTINGS: &str = r#"{"schemaVersion":1,"checkUpdatesOnStartup":false,"history":{"enabled":true},"display":{"grouping":"comma"},"calculator":{"angleUnit":"deg","wordSize":"qword","base":"dec","shiftMode":"arithmetic"},"date":{"firstDayOfWeek":"monday","calendar":{},"cardOrder":["between","add","business","age","info","countdown"],"collapsedCards":[]},"percent":{"cardOrder":["change","percent","what","discount","base","markup","tax","tip"],"collapsedCards":["tip"]},"appearance":{"theme":"system"},"language":{"code":"auto","digits":"auto"}}"#;
    const STATE: &str = r#"{"schemaVersion":1,"route":"converter/length","pane":{"open":false,"tab":"history"},"dev":{"pseudoLocale":"off"}}"#;
    const HISTORY: &str = r#"{"schemaVersion":1,"entries":[{"id":"h-1-0","timestampMs":1795400000000,"tool":"standard","calculator":"standard","calculatorLabel":"Standard","inputs":{"expr":[{"n":"2"},{"op":"+"},{"n":"2"}]},"expressionText":"2 + 2","inputsText":"","resultText":"4","copyText":"2 + 2 = 4","pinned":false,"note":null,"engine":"calc-core 0.1.0"}]}"#;
    const COUNTDOWNS: &str = r#"{"schemaVersion":1,"items":[{"id":"c-1","label":"New year","targetDate":"2026-12-31","targetTime":"09:00","createdAtMs":1,"savedAtMs":2,"finishedSeenAtMs":null}]}"#;

    fn sample(doc: Doc) -> &'static str {
        match doc {
            Doc::Settings => SETTINGS,
            Doc::State => STATE,
            Doc::History => HISTORY,
            Doc::Countdowns => COUNTDOWNS,
        }
    }

    fn field_of(res: &str) -> Value {
        serde_json::from_str::<Value>(res).unwrap()["error"]["field"].clone()
    }

    #[test]
    fn valid_documents_round_trip_to_their_canonical_form() {
        for doc in Doc::ALL {
            let Validated::Current(canonical) = validate(doc, sample(doc)).unwrap() else {
                panic!("{doc:?} not current");
            };
            // Canonical is a fixed point.
            assert_eq!(
                validate(doc, &canonical).unwrap(),
                Validated::Current(canonical.clone()),
                "{doc:?}"
            );
            let op = format!("{}.validate", doc.name());
            let res = call(&op, sample(doc));
            assert_eq!(
                res,
                format!(
                    r#"{{"ok":"true","result":{{"status":"ok","schemaVersion":1,"doc":{canonical}}}}}"#
                )
            );
        }
        // The calendar is normalised by date-core (defaults filled in).
        let Validated::Current(c) = validate(Doc::Settings, SETTINGS).unwrap() else {
            panic!()
        };
        assert!(
            c.contains(r#""calendar":{"customHolidays":[],"excludedHolidays":"#),
            "{c}"
        );
    }

    #[test]
    fn schema_version_is_read_first() {
        for doc in Doc::ALL {
            let op = format!("{}.validate", doc.name());
            // Newer: reported, never parsed (the rest is garbage on purpose).
            assert_eq!(
                call(&op, r#"{"schemaVersion":2,"anything":[1,2,3]}"#),
                r#"{"ok":"true","result":{"status":"newer","schemaVersion":2,"supported":1}}"#
            );
            for bad in [
                r#"{}"#,
                r#"{"schemaVersion":0}"#,
                r#"{"schemaVersion":-1}"#,
                r#"{"schemaVersion":1.5}"#,
                r#"{"schemaVersion":"1"}"#,
                r#"{"schemaVersion":null}"#,
            ] {
                assert_eq!(field_of(&call(&op, bad)), "schemaVersion", "{op} {bad}");
            }
            for not_object in ["[]", "1", "\"x\"", "null"] {
                assert_eq!(field_of(&call(&op, not_object)), "", "{op}");
            }
            for not_json in ["", "{", "nul", "{\"schemaVersion\":1,}"] {
                let res = call(&op, not_json);
                assert!(
                    res.contains(r#""code":"invalid_request","field":null"#),
                    "{res}"
                );
            }
        }
    }

    #[test]
    fn every_level_is_strict() {
        let cases: &[(Doc, &str, &str, &str)] = &[
            (
                Doc::Settings,
                r#""theme":"system""#,
                r#""theme":"dark""#,
                "appearance.theme",
            ),
            (
                Doc::Settings,
                r#""appearance":{"theme":"system"}"#,
                r#""appearance":{"theme":"system","x":1}"#,
                "appearance.x",
            ),
            (
                Doc::Settings,
                r#""checkUpdatesOnStartup":false,"#,
                "",
                "checkUpdatesOnStartup",
            ),
            (
                Doc::Settings,
                r#""code":"auto""#,
                r#""code":"xx""#,
                "language.code",
            ),
            (
                Doc::Settings,
                r#""digits":"auto""#,
                r#""digits":1"#,
                "language.digits",
            ),
            (
                Doc::Settings,
                r#""collapsedCards":["tip"]"#,
                r#""collapsedCards":["tip","tip"]"#,
                "percent.collapsedCards[1]",
            ),
            (
                Doc::Settings,
                r#""age","info""#,
                r#""age","age""#,
                "date.cardOrder[4]",
            ),
            (
                Doc::Settings,
                r#""calendar":{}"#,
                r#""calendar":{"weekend":[8]}"#,
                "date.calendar.weekend",
            ),
            (
                Doc::Settings,
                r#""calendar":{}"#,
                r#""calendar":[]"#,
                "date.calendar",
            ),
            (
                Doc::State,
                r#""route":"converter/length""#,
                r#""route":"a/b/c""#,
                "route",
            ),
            (
                Doc::State,
                r#""route":"converter/length""#,
                r#""route":"Standard""#,
                "route",
            ),
            (Doc::State, r#""tab":"history""#, r#""tab":"x""#, "pane.tab"),
            (
                Doc::State,
                r#""pseudoLocale":"off""#,
                r#""pseudoLocale":"en-US""#,
                "dev.pseudoLocale",
            ),
            (
                Doc::History,
                r#""id":"h-1-0""#,
                r#""id":"h 1""#,
                "entries[0].id",
            ),
            (
                Doc::History,
                r#""tool":"standard""#,
                r#""tool":"x""#,
                "entries[0].tool",
            ),
            (
                Doc::History,
                r#""note":null"#,
                r#""note":5"#,
                "entries[0].note",
            ),
            (
                Doc::History,
                r#""inputs":{"#,
                r#""inputs":[],"x":{"#,
                "entries[0].inputs",
            ),
            (
                Doc::History,
                r#""pinned":false"#,
                r#""pinned":false,"origin":"local""#,
                "entries[0].origin",
            ),
            (
                Doc::Countdowns,
                r#""targetDate":"2026-12-31""#,
                r#""targetDate":"2026-02-30""#,
                "items[0].targetDate",
            ),
            (
                Doc::Countdowns,
                r#""targetTime":"09:00""#,
                r#""targetTime":"9:00""#,
                "items[0].targetTime",
            ),
            (
                Doc::Countdowns,
                r#""targetTime":"09:00""#,
                r#""targetTime":"24:00""#,
                "items[0].targetTime",
            ),
            (
                Doc::Countdowns,
                r#""finishedSeenAtMs":null"#,
                r#""finishedSeenAtMs":-1"#,
                "items[0].finishedSeenAtMs",
            ),
            (
                Doc::Countdowns,
                r#""label":"New year""#,
                r#""label":"x","x":1"#,
                "items[0].x",
            ),
        ];
        for (doc, from, to, field) in cases {
            let text = sample(*doc).replacen(from, to, 1);
            assert_ne!(text, sample(*doc), "{from}");
            let res = call(&format!("{}.validate", doc.name()), &text);
            assert_eq!(field_of(&res), *field, "{doc:?} {to}: {res}");
        }
    }

    #[test]
    fn texts_and_lists_are_capped() {
        let long_label = "é".repeat(LABEL_MAX + 1);
        let text = COUNTDOWNS.replacen("New year", &long_label, 1);
        assert_eq!(
            field_of(&call("countdowns.validate", &text)),
            "items[0].label"
        );
        let ok_label = "é".repeat(LABEL_MAX);
        let text = COUNTDOWNS.replacen("New year", &ok_label, 1);
        assert!(call("countdowns.validate", &text).starts_with(r#"{"ok":"true""#));

        let item = r#"{"id":"c-ID","label":"","targetDate":"2026-12-31","targetTime":"","createdAtMs":1,"savedAtMs":2,"finishedSeenAtMs":3}"#;
        let list = |n: usize| {
            let items: Vec<String> = (0..n).map(|i| item.replace("ID", &i.to_string())).collect();
            format!(r#"{{"schemaVersion":1,"items":[{}]}}"#, items.join(","))
        };
        assert!(call("countdowns.validate", &list(COUNTDOWNS_MAX)).starts_with(r#"{"ok":"true""#));
        assert_eq!(
            field_of(&call("countdowns.validate", &list(COUNTDOWNS_MAX + 1))),
            "items"
        );
        let dup = list(2).replace("c-1", "c-0");
        assert_eq!(field_of(&call("countdowns.validate", &dup)), "items[1].id");
    }

    #[test]
    fn store_caps_attach_to_the_validate_ops() {
        use crate::{Op, CAP_HISTORY_VALIDATE, CAP_STORE};
        for doc in Doc::ALL {
            let op = Op::parse(&format!("{}.validate", doc.name())).unwrap();
            let want = if doc == Doc::History {
                CAP_HISTORY_VALIDATE
            } else {
                CAP_STORE
            };
            assert_eq!(op.request_cap(), want, "{doc:?}");
            assert_eq!(Doc::from_name(doc.name()), Some(doc));
        }
        assert_eq!(Doc::from_name("legacy"), None);
    }

    #[test]
    fn check_matches_the_op() {
        use crate::{call_bytes, CAP_STORE};
        for doc in Doc::ALL {
            let op = format!("{}.validate", doc.name());
            let ok = check(doc, sample(doc).as_bytes());
            let Checked::Current(canonical) = &ok else {
                panic!("{doc:?}")
            };
            assert!(call_bytes(op.as_bytes(), sample(doc).as_bytes()).contains(canonical.as_str()));
            assert_eq!(check(doc, br#"{"schemaVersion":7}"#), Checked::Newer(7));
            assert!(matches!(check(doc, b"\xFF{}"), Checked::Invalid(_)));
            assert!(matches!(check(doc, b"{}"), Checked::Invalid(_)));
        }
        let mut big = br#"{"schemaVersion":1}"#.to_vec();
        big.resize(CAP_STORE, b' ');
        assert!(matches!(check(Doc::State, &big), Checked::Invalid(_)));
        big.push(b' ');
        assert_eq!(check(Doc::State, &big), Checked::TooLarge);
        assert!(call_bytes(b"state.validate", &big).contains("request_too_large"));
        // A newer document over the cap is still TooLarge: nothing is read.
        let mut newer = br#"{"schemaVersion":9}"#.to_vec();
        newer.resize(CAP_STORE + 1, b' ');
        assert_eq!(check(Doc::Settings, &newer), Checked::TooLarge);
    }

    /// The frozen key lists (AGENTS.md: any field change to a stored struct
    /// bumps its schemaVersion). If this fails, either revert the field
    /// change or bump the doc's schemaVersion and update the fixture.
    #[test]
    fn stored_field_sets_are_frozen_per_schema_version() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/store-keys.json")).unwrap();
        for doc in Doc::ALL {
            let Validated::Current(canonical) = validate(doc, sample(doc)).unwrap() else {
                panic!()
            };
            let value: Value = serde_json::from_str(&canonical).unwrap();
            let mut paths = Vec::new();
            key_paths(&value, "", &mut paths);
            paths.sort();
            paths.dedup();
            let entry = &fixture[doc.name()];
            assert_eq!(entry["schemaVersion"], doc.schema_version(), "{doc:?}");
            let frozen: Vec<String> = entry["keys"]
                .as_array()
                .unwrap()
                .iter()
                .map(|k| k.as_str().unwrap().to_string())
                .collect();
            assert_eq!(
                paths, frozen,
                "{doc:?}: field set changed without a schemaVersion bump"
            );
        }
    }

    /// Dotted key paths of every object key; arrays become `[]`, and the
    /// free-form history `inputs` and date-core calendar are not descended.
    fn key_paths(v: &Value, path: &str, out: &mut Vec<String>) {
        match v {
            Value::Object(map) => {
                for (k, child) in map {
                    let p = join(path, k);
                    out.push(p.clone());
                    if k != "inputs" && k != "calendar" {
                        key_paths(child, &p, out);
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    key_paths(item, &format!("{path}[]"), out);
                }
            }
            _ => {}
        }
    }
}
