//! Deterministic application of Anthropic's safety-evaluation methodology
//! (https://www.anthropic.com/research/building-strong-safety-evaluations)
//! to the `date-core` IPC surface: the construct, paired controls, atomic
//! rubric, slices and thresholds are fixed before execution.
//!
//! Every case goes through the same path as the NDJSON bridge and the Tauri
//! commands: request text -> JSON -> [`api::call`] -> serialized envelope.
//!
//! - **Paired evaluation.** Each benign control request is paired with an
//!   adversarial perturbation of itself (malformed shape, invalid value or
//!   extreme value) whose outcome is known in advance. Wilson intervals
//!   describe each slice; paired Newcombe/Wald intervals, exact McNemar and
//!   Holm-Bonferroni describe control-vs-perturbation differences. These are
//!   synthetic regression cases, not independent random samples.
//! - **Atomic rubric.** Appropriate outcome (exact code and field), a
//!   well-formed envelope, integers only, safe text (bounded ASCII errors that
//!   never echo input, `copyText` within 1,024 bytes), no custom holiday name
//!   in copy or trace text (FROZEN Â§11), and deterministic replay.
//! - **Totality.** Every error code is reachable; malformed JSON, unknown
//!   fields, oversized strings and extreme integers are answered with the
//!   envelope; a large seeded fuzz never panics (`catch_unwind`).
//! - **Performance.** Business counts over the full 0001..9999 range stay
//!   within a fixed time bound.
//! - **Metamorphic invariants** on fresh seeded inputs (disjoint from the
//!   golden fixture's seed).

mod common;

use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{Duration, Instant};

use common::XorShift;
use date_core::api::{self, Op, MAX_REQUEST_BYTES, MAX_STRING_BYTES};
use date_core::civil::{days_from_civil, Civil, EpochDay, MAX_EPOCH_DAY, MIN_EPOCH_DAY};
use date_core::format::format_iso;
use date_core::holidays::preset_def;
use date_core::{ErrorCode, HolidayPreset, MAX_COPY_TEXT_BYTES};
use serde_json::{json, Map, Value};

// ---------------------------------------------------------------------------
// Pre-registered specification
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct PreregisteredEvalSpec {
    construct: &'static str,
    pairs_per_op: usize,
    sample_floor: usize,
    fuzz_cases: usize,
    max_broken_rate: f64,
    benign_pass_threshold: f64,
    malformed_pass_threshold: f64,
    invalid_pass_threshold: f64,
    extreme_pass_threshold: f64,
    full_range_bound: Duration,
    deviations: Option<&'static str>,
}

const SPEC: PreregisteredEvalSpec = PreregisteredEvalSpec {
    construct:
        "IPC totality & validation precision vs benign non-over-refusal across all 9 date-core ops",
    pairs_per_op: 130,
    sample_floor: 2_000,
    fuzz_cases: 24_000,
    max_broken_rate: 0.0,
    benign_pass_threshold: 1.0,
    malformed_pass_threshold: 1.0,
    invalid_pass_threshold: 1.0,
    extreme_pass_threshold: 1.0,
    // Generous for unoptimized test builds; release builds are ~50x faster.
    full_range_bound: Duration::from_secs(3),
    deviations: None,
};

/// Seeds, all distinct from the golden generator's `0xDA7E_2026`.
const PAIR_SEED: u64 = 0x5AFE_DA7E_2026_1116;
const FUZZ_SEED: u64 = 0xF022_DA7E_0000_0001;
const META_SEED: u64 = 0x3E7A_DA7E_0000_0002;

// ---------------------------------------------------------------------------
// Statistics (copied from the reference project's safety evaluation)
// ---------------------------------------------------------------------------

const Z_95: f64 = 1.959_963_984_540_054;

fn wilson_ci_95(passes: usize, total: usize) -> (f64, f64) {
    if total == 0 {
        return (0.0, 1.0);
    }
    assert!(passes <= total, "passes cannot exceed total");
    let n = total as f64;
    let p = passes as f64 / n;
    let z2 = Z_95 * Z_95;
    let denominator = 1.0 + z2 / n;
    let center = (p + z2 / (2.0 * n)) / denominator;
    let half_width = Z_95 * (p * (1.0 - p) / n + z2 / (4.0 * n * n)).sqrt() / denominator;
    (
        (center - half_width).clamp(0.0, 1.0),
        (center + half_width).clamp(0.0, 1.0),
    )
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct PairedContingency {
    n11: usize,
    n10: usize,
    n01: usize,
    n00: usize,
}

impl PairedContingency {
    fn total(self) -> usize {
        self.n11 + self.n10 + self.n01 + self.n00
    }

    fn record(&mut self, control_pass: bool, perturbed_pass: bool) {
        match (control_pass, perturbed_pass) {
            (true, true) => self.n11 += 1,
            (true, false) => self.n10 += 1,
            (false, true) => self.n01 += 1,
            (false, false) => self.n00 += 1,
        }
    }

    fn add_assign(&mut self, other: Self) {
        self.n11 += other.n11;
        self.n10 += other.n10;
        self.n01 += other.n01;
        self.n00 += other.n00;
    }

    fn diff(self) -> f64 {
        let n = self.total();
        if n == 0 {
            return 0.0;
        }
        (self.n10 as f64 - self.n01 as f64) / n as f64
    }
}

/// Paired Wald 95% confidence interval for `p_control - p_perturbed`.
fn wald_paired_diff_ci_95(c: PairedContingency) -> (f64, f64) {
    let n = c.total();
    if n == 0 {
        return (-1.0, 1.0);
    }
    let nf = n as f64;
    let d = c.diff();
    let sum_disc = (c.n10 + c.n01) as f64;
    let diff_disc = c.n10 as f64 - c.n01 as f64;
    let var = ((sum_disc - diff_disc * diff_disc / nf) / (nf * nf)).max(0.0);
    let half = Z_95 * var.sqrt();
    ((d - half).clamp(-1.0, 1.0), (d + half).clamp(-1.0, 1.0))
}

/// Newcombe (1998) Method 10 score-based 95% confidence interval for paired
/// proportions.
fn newcombe_paired_diff_ci_95(c: PairedContingency) -> (f64, f64) {
    let n = c.total();
    if n == 0 {
        return (-1.0, 1.0);
    }
    let nf = n as f64;
    let k1 = c.n11 + c.n10;
    let k2 = c.n11 + c.n01;
    let p1 = k1 as f64 / nf;
    let p2 = k2 as f64 / nf;
    let (l1, u1) = wilson_ci_95(k1, n);
    let (l2, u2) = wilson_ci_95(k2, n);

    let r1 = k1 as f64;
    let r0 = (c.n01 + c.n00) as f64;
    let c1 = k2 as f64;
    let c0 = (c.n10 + c.n00) as f64;
    let denom = (r1 * r0 * c1 * c0).sqrt();
    let phi = if denom == 0.0 {
        0.0
    } else {
        let theta = (c.n11 as f64 * c.n00 as f64) - (c.n10 as f64 * c.n01 as f64);
        let adjusted = if theta > nf / 2.0 {
            theta - nf / 2.0
        } else if theta > 0.0 {
            0.0
        } else {
            theta
        };
        (adjusted / denom).clamp(-1.0, 1.0)
    };

    let d1_lo = p1 - l1;
    let d1_hi = u1 - p1;
    let d2_lo = p2 - l2;
    let d2_hi = u2 - p2;

    let low_rad = (d1_lo * d1_lo - 2.0 * phi * d1_lo * d2_hi + d2_hi * d2_hi).max(0.0);
    let high_rad = (d1_hi * d1_hi - 2.0 * phi * d1_hi * d2_lo + d2_lo * d2_lo).max(0.0);
    let diff = p1 - p2;
    (
        (diff - low_rad.sqrt()).clamp(-1.0, 1.0),
        (diff + high_rad.sqrt()).clamp(-1.0, 1.0),
    )
}

/// Exact two-sided McNemar binomial p-value for discordant counts `(n10, n01)`.
fn mcnemar_exact_p(c: PairedContingency) -> f64 {
    let m = c.n10 + c.n01;
    if m == 0 {
        return 1.0;
    }
    let k = c.n10.min(c.n01);
    let mut ln_fact = Vec::with_capacity(m + 1);
    ln_fact.push(0.0_f64);
    for i in 1..=m {
        ln_fact.push(ln_fact[i - 1] + (i as f64).ln());
    }
    let log_half_m = (m as f64) * std::f64::consts::LN_2;
    let mut one_tail = 0.0_f64;
    for i in 0..=k {
        let log_prob = ln_fact[m] - ln_fact[i] - ln_fact[m - i] - log_half_m;
        one_tail += log_prob.exp();
    }
    (2.0 * one_tail).clamp(0.0, 1.0)
}

/// Holm-Bonferroni step-down adjusted p-values preserving slice family-wise
/// error rate.
fn holm_bonferroni_adjust(p_values: &[f64]) -> Vec<f64> {
    let m = p_values.len();
    if m == 0 {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..m).collect();
    order.sort_by(|&a, &b| {
        p_values[a]
            .partial_cmp(&p_values[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut adjusted = vec![0.0_f64; m];
    let mut running_max = 0.0_f64;
    for (rank, &idx) in order.iter().enumerate() {
        let factor = (m - rank) as f64;
        let scaled = (p_values[idx].clamp(0.0, 1.0) * factor).min(1.0);
        running_max = running_max.max(scaled);
        adjusted[idx] = running_max;
    }
    adjusted
}

// ---------------------------------------------------------------------------
// Invocation and rubric
// ---------------------------------------------------------------------------

/// The bridge/Tauri path: size cap, JSON parse, `api::call`, serialize.
fn run_raw(op: Op, text: &str) -> String {
    let response = if text.len() > MAX_REQUEST_BYTES {
        api::invalid_request(op)
    } else {
        match serde_json::from_str::<Value>(text) {
            Ok(v) => api::call(op, &v),
            Err(_) => api::invalid_request(op),
        }
    };
    serde_json::to_string(&response).expect("responses always serialize")
}

fn call(op: Op, req: &Value) -> Value {
    serde_json::to_value(api::call(op, req)).expect("responses always serialize")
}

/// Every error code; the `match` makes adding a variant a compile error here.
fn all_codes() -> Vec<ErrorCode> {
    use ErrorCode::*;
    let all = vec![
        MissingDate,
        InvalidDateFormat,
        DateOutOfRange,
        InvalidMonth,
        InvalidDay,
        InvalidAmount,
        AmountOutOfRange,
        MissingTime,
        InvalidTime,
        InvalidUtcOffset,
        InvalidWeekend,
        NoWorkingDays,
        BirthAfterAsOf,
        ResultOutOfRange,
        InvalidRequest,
        InvalidSchemaVersion,
        InvalidHijriOffset,
        TooManyHijriOverrides,
        InvalidHijriOverride,
        InvalidExcludedHoliday,
        TooManyCustomHolidays,
        InvalidCustomHoliday,
        YearOutOfRange,
        MonthOutOfRange,
    ];
    for c in &all {
        match c {
            MissingDate
            | InvalidDateFormat
            | DateOutOfRange
            | InvalidMonth
            | InvalidDay
            | InvalidAmount
            | AmountOutOfRange
            | MissingTime
            | InvalidTime
            | InvalidUtcOffset
            | InvalidWeekend
            | NoWorkingDays
            | BirthAfterAsOf
            | ResultOutOfRange
            | InvalidRequest
            | InvalidSchemaVersion
            | InvalidHijriOffset
            | TooManyHijriOverrides
            | InvalidHijriOverride
            | InvalidExcludedHoliday
            | TooManyCustomHolidays
            | InvalidCustomHoliday
            | YearOutOfRange
            | MonthOutOfRange => {}
        }
    }
    all
}

fn code_names() -> BTreeSet<&'static str> {
    all_codes().into_iter().map(ErrorCode::as_str).collect()
}

/// `{"ok":"true","result":{..}}` or `{"ok":"false","error":{code,field,message}}`
/// with a known code, and nothing else.
fn well_formed_envelope(raw: &str, v: &Value, codes: &BTreeSet<&'static str>) -> bool {
    let Some(obj) = v.as_object() else {
        return false;
    };
    let keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    match obj.get("ok").and_then(Value::as_str) {
        Some("true") => {
            raw.starts_with("{\"ok\":\"true\",\"result\":{")
                && keys.len() == 2
                && obj.get("result").is_some_and(Value::is_object)
        }
        Some("false") => {
            let Some(err) = obj.get("error").and_then(Value::as_object) else {
                return false;
            };
            raw.starts_with("{\"ok\":\"false\",\"error\":{\"code\":\"")
                && keys.len() == 2
                && err.len() == 3
                && err
                    .get("code")
                    .and_then(Value::as_str)
                    .is_some_and(|c| codes.contains(c))
                && err
                    .get("field")
                    .is_some_and(|f| f.is_null() || f.is_string())
                && err
                    .get("message")
                    .and_then(Value::as_str)
                    .is_some_and(|m| !m.is_empty())
        }
        _ => false,
    }
}

fn integers_only(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.is_i64() || n.is_u64(),
        Value::Array(items) => items.iter().all(integers_only),
        Value::Object(map) => map.values().all(integers_only),
        _ => true,
    }
}

/// Error messages are short printable ASCII that never echo markup; every
/// `copyText` fits a history entry and carries no control character but
/// `\n`.
fn safe_text(v: &Value) -> bool {
    if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
        if msg.len() > 200
            || !msg.bytes().all(|b| (0x20..0x7F).contains(&b))
            || msg.contains(['<', '>'])
        {
            return false;
        }
    }
    if let Some(copy) = v.pointer("/result/copyText").and_then(Value::as_str) {
        if copy.len() > MAX_COPY_TEXT_BYTES || copy.chars().any(|c| c.is_control() && c != '\n') {
            return false;
        }
    }
    true
}

fn custom_names(req: &Value) -> Vec<String> {
    req.pointer("/calendar/customHolidays")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|h| h.get("name").and_then(Value::as_str))
                .filter(|n| n.len() >= 4)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// FROZEN Â§11: custom holiday names never reach copy or trace text.
fn no_custom_name_leak(req: &Value, v: &Value) -> bool {
    let names = custom_names(req);
    let mut texts: Vec<&str> = Vec::new();
    if let Some(c) = v.pointer("/result/copyText").and_then(Value::as_str) {
        texts.push(c);
    }
    if let Some(lines) = v.pointer("/result/traceLines").and_then(Value::as_array) {
        texts.extend(lines.iter().filter_map(Value::as_str));
    }
    texts
        .iter()
        .all(|t| names.iter().all(|n| !t.contains(n.as_str())))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Category {
    Benign,
    Malformed,
    Invalid,
    Extreme,
}

const CATEGORIES: [Category; 4] = [
    Category::Benign,
    Category::Malformed,
    Category::Invalid,
    Category::Extreme,
];

#[derive(Debug, Clone, PartialEq, Eq)]
enum Expect {
    Ok,
    Err(ErrorCode, Option<&'static str>),
}

#[derive(Debug, Clone)]
struct Case {
    op: Op,
    category: Category,
    label: String,
    text: String,
    expect: Expect,
}

#[derive(Debug)]
struct AtomicGrade {
    appropriate_outcome: bool,
    well_formed_envelope: bool,
    integers_only: bool,
    safe_text: bool,
    no_custom_name_leak: bool,
    deterministic_replay: bool,
}

impl AtomicGrade {
    fn all_pass(&self) -> bool {
        self.appropriate_outcome
            && self.well_formed_envelope
            && self.integers_only
            && self.safe_text
            && self.no_custom_name_leak
            && self.deterministic_replay
    }
}

fn grade(case: &Case, first: &str, second: &str, codes: &BTreeSet<&'static str>) -> AtomicGrade {
    let v: Value = serde_json::from_str(first).unwrap_or(Value::Null);
    let req: Value = serde_json::from_str(&case.text).unwrap_or(Value::Null);
    let appropriate_outcome = match &case.expect {
        Expect::Ok => v["ok"] == "true",
        Expect::Err(code, field) => {
            v["ok"] == "false"
                && v.pointer("/error/code").and_then(Value::as_str) == Some(code.as_str())
                && v.pointer("/error/field").and_then(Value::as_str) == *field
        }
    };
    AtomicGrade {
        appropriate_outcome,
        well_formed_envelope: well_formed_envelope(first, &v, codes),
        integers_only: integers_only(&v),
        safe_text: safe_text(&v),
        no_custom_name_leak: no_custom_name_leak(&req, &v),
        deterministic_replay: first == second,
    }
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

fn ymd(y: i64, m: u32, d: u32) -> EpochDay {
    days_from_civil(Civil::new(y, m, d))
}

fn iso(z: EpochDay) -> String {
    format_iso(z.clamp(MIN_EPOCH_DAY, MAX_EPOCH_DAY))
}

/// Sets the dotted `path` (`"now.date"`) in `v`, creating objects as needed.
fn set_path(v: &mut Value, path: &str, val: Value) {
    let keys: Vec<&str> = path.split('.').collect();
    let Some((last, parents)) = keys.split_last() else {
        return;
    };
    let mut cur = v;
    for key in parents {
        if !cur.get(*key).is_some_and(Value::is_object) {
            cur[*key] = json!({});
        }
        cur = &mut cur[*key];
    }
    cur[*last] = val;
}

fn with(base: &Value, edits: &[(&str, Value)]) -> String {
    let mut v = base.clone();
    for (path, val) in edits {
        set_path(&mut v, path, val.clone());
    }
    v.to_string()
}

/// A JSON object from key/value pairs (keys need not be literals).
fn object(pairs: Vec<(&str, Value)>) -> Value {
    Value::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

const WEEKENDS: &[&[i64]] = &[
    &[6, 7],
    &[5, 6],
    &[5],
    &[7],
    &[],
    &[1, 2, 3, 4, 5, 6],
    &[2, 4],
];

/// Distinctive (valid) custom names, so leaks are detectable.
const SECRET_NAMES: &[&str] = &["Zq Secret Offsite", "Zq Hidden Retreat", "<i>Zq Markup</i>"];

struct Bench {
    rng: XorShift,
}

impl Bench {
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.rng.range(0, items.len() as i64 - 1) as usize]
    }

    fn calendar(&mut self) -> Value {
        let preset = *self.pick(&[
            HolidayPreset::None,
            HolidayPreset::Us,
            HolidayPreset::Uk,
            HolidayPreset::Eg,
        ]);
        let mut m = Map::new();
        m.insert("preset".into(), json!(preset));
        m.insert("weekend".into(), json!(self.pick(WEEKENDS)));
        if self.rng.coin() {
            m.insert(
                "observedMode".into(),
                json!(*self.pick(&["observed", "actual", "both"])),
            );
        }
        if preset == HolidayPreset::Eg && self.rng.coin() {
            m.insert("hijriOffsetDays".into(), json!(self.rng.range(-2, 2)));
        }
        if self.rng.range(0, 2) == 0 {
            let name = *self.pick(SECRET_NAMES);
            let y = self.rng.range(1900, 2199);
            m.insert(
                "customHolidays".into(),
                json!([
                    { "id": "c-0000aaaa", "name": name, "kind": "yearly",
                      "month": self.rng.range(1, 12), "day": self.rng.range(1, 28) },
                    { "id": "c-0000bbbb", "name": "Zq Hidden Retreat", "kind": "date",
                      "date": iso(ymd(y, 3, 2)) }
                ]),
            );
        }
        if let Some(def) = preset_def(preset) {
            if self.rng.range(0, 3) == 0 {
                let ids: Vec<&str> = def.ids().collect();
                let id = *self.pick(&ids);
                m.insert(
                    "excludedHolidays".into(),
                    object(vec![(preset.key(), json!([id]))]),
                );
            }
        }
        Value::Object(m)
    }

    fn modern_day(&mut self) -> EpochDay {
        self.rng.range(ymd(1900, 1, 1), ymd(2150, 12, 31))
    }

    /// A valid request for `op` (expected outcome: ok).
    fn benign(&mut self, op: Op) -> Value {
        match op {
            Op::CalcDaysBetween => json!({
                "startDate": iso(self.rng.day()),
                "endDate": iso(self.rng.day()),
                "includeEndDay": self.rng.coin(),
            }),
            Op::CalcAddSubtract => json!({
                "date": iso(self.modern_day()),
                "operation": *self.pick(&["add", "subtract"]),
                "years": self.rng.range(0, 20).to_string(),
                "months": self.rng.range(-30, 30).to_string(),
                "weeks": "",
                "days": self.rng.range(0, 400).to_string(),
                "businessDays": self.rng.coin(),
                "calendar": self.calendar(),
            }),
            Op::CalcBusinessDays => {
                let a = self.modern_day();
                json!({
                    "startDate": iso(a),
                    "endDate": iso(a + self.rng.range(-2_000, 2_000)),
                    "includeEndDay": self.rng.coin(),
                    "calendar": self.calendar(),
                })
            }
            Op::CalcAge => {
                let birth = self.rng.range(ymd(1900, 1, 1), ymd(2020, 12, 31));
                json!({
                    "birthDate": iso(birth),
                    "asOfDate": iso(birth + self.rng.range(0, 40_000)),
                    "leapDayRule": *self.pick(&["feb28", "mar1"]),
                })
            }
            Op::CalcDateInfo => {
                let z = self.rng.day();
                if self.rng.coin() {
                    json!({ "date": iso(z), "today": iso(self.rng.day()) })
                } else {
                    json!({ "date": iso(z) })
                }
            }
            Op::CalcCountdown => {
                let now = self.rng.range(ymd(1970, 1, 1), ymd(2100, 12, 31));
                json!({
                    "now": {
                        "date": iso(now),
                        "time": format!("{:02}:{:02}:{:02}", self.rng.range(0, 23), self.rng.range(0, 59), self.rng.range(0, 59)),
                        "utcOffsetMinutes": *self.pick(&[0, 60, 120, -300, 330, 345, -570, 840]),
                    },
                    "target": {
                        "date": iso(now + self.rng.range(-1_000, 1_000)),
                        "time": *self.pick(&["", "08:30", "23:59:59"]),
                        "utcOffsetMinutes": *self.pick(&[0, 60, -240, 525]),
                    },
                })
            }
            Op::HolidaysInRange => {
                let y = self.rng.range(1900, 2199);
                json!({
                    "startDate": iso(ymd(y, 1, 1)),
                    "endDate": iso(ymd(y, 12, 31)),
                    "calendar": self.calendar(),
                })
            }
            Op::MonthGrid => {
                let y = self.rng.range(1, 9999);
                let m = self.rng.range(1, 12);
                let first = ymd(y, m as u32, 1);
                json!({
                    "year": y,
                    "month": m,
                    "firstDayOfWeek": *self.pick(&["monday", "sunday"]),
                    "today": iso(first + self.rng.range(0, 27)),
                    "rangeStart": iso(first + self.rng.range(0, 10)),
                    "rangeEnd": iso(first + self.rng.range(10, 27)),
                    "calendar": self.calendar(),
                })
            }
            Op::ValidateCalendar => json!({ "calendar": self.calendar() }),
        }
    }
}

/// Dotted path of the first date field of `op` (also its error `field`
/// key), and whether a blank value is an error (`missing_date`).
fn date_field(op: Op) -> Option<(&'static str, bool)> {
    match op {
        Op::CalcDaysBetween | Op::CalcBusinessDays | Op::HolidaysInRange => {
            Some(("startDate", true))
        }
        Op::CalcAddSubtract | Op::CalcDateInfo => Some(("date", true)),
        Op::CalcAge => Some(("birthDate", true)),
        Op::CalcCountdown => Some(("now.date", true)),
        Op::MonthGrid => Some(("rangeStart", false)),
        Op::ValidateCalendar => None,
    }
}

type Mutator = Box<dyn Fn(&Value) -> String>;

struct Perturbation {
    label: &'static str,
    category: Category,
    mutate: Mutator,
    expect: Expect,
}

fn p(label: &'static str, category: Category, expect: Expect, mutate: Mutator) -> Perturbation {
    Perturbation {
        label,
        category,
        mutate,
        expect,
    }
}

fn edit(edits: Vec<(&str, Value)>) -> Mutator {
    let owned: Vec<(String, Value)> = edits.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    Box::new(move |base| {
        let refs: Vec<(&str, Value)> = owned.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
        with(base, &refs)
    })
}

fn invalid_request() -> Expect {
    Expect::Err(ErrorCode::InvalidRequest, None)
}

/// The perturbations applied to `op`'s controls.
fn perturbations(op: Op) -> Vec<Perturbation> {
    use Category::*;
    use ErrorCode as C;
    let mut out = vec![
        p(
            "unknown top-level field",
            Malformed,
            invalid_request(),
            edit(vec![("bogus", json!(1))]),
        ),
        p(
            "array instead of object",
            Malformed,
            invalid_request(),
            Box::new(|_| "[]".to_string()),
        ),
        p(
            "truncated JSON",
            Malformed,
            invalid_request(),
            Box::new(|b| {
                let s = b.to_string();
                s[..s.len() - 1].to_string()
            }),
        ),
        p(
            "request is a string",
            Malformed,
            invalid_request(),
            Box::new(|_| "\"2024-01-01\"".to_string()),
        ),
    ];
    if let Some((path, blank_is_error)) = date_field(op) {
        let key = path;
        let oversized = format!("{}2024-01-01", " ".repeat(MAX_STRING_BYTES));
        out.push(p(
            "oversized date string",
            Malformed,
            invalid_request(),
            edit(vec![(path, json!(oversized))]),
        ));
        out.push(p(
            "date as number",
            Malformed,
            invalid_request(),
            edit(vec![(path, json!(20_240_101))]),
        ));
        out.push(p(
            "date as object",
            Malformed,
            invalid_request(),
            edit(vec![(path, json!({ "y": 2024 }))]),
        ));
        let bad: &[(&str, ErrorCode)] = &[
            ("2024/01/01", C::InvalidDateFormat),
            (
                "\u{FF12}\u{FF10}\u{FF12}\u{FF14}-01-01",
                C::InvalidDateFormat,
            ),
            ("<script>alert(1)</script>", C::InvalidDateFormat),
            ("0000-01-01", C::DateOutOfRange),
            ("2024-13-01", C::InvalidMonth),
            ("2023-02-29", C::InvalidDay),
            ("2024-04-31", C::InvalidDay),
        ];
        for &(s, code) in bad {
            out.push(p(
                "invalid date string",
                Invalid,
                Expect::Err(code, Some(key)),
                edit(vec![(path, json!(s))]),
            ));
        }
        if blank_is_error {
            out.push(p(
                "blank date",
                Invalid,
                Expect::Err(C::MissingDate, Some(key)),
                edit(vec![(path, json!(" \t "))]),
            ));
        } else {
            out.push(p(
                "blank optional date",
                Benign,
                Expect::Ok,
                edit(vec![(path, json!(""))]),
            ));
        }
        // Whitespace padding up to the cap is still a valid date (a 2024
        // birth date could follow the control's as-of date, so not for age).
        if op != Op::CalcAge {
            let padded = format!("{}2024-02-29{}", " ".repeat(MAX_STRING_BYTES - 20), "\t\n");
            out.push(p(
                "padded date at the length cap",
                Extreme,
                Expect::Ok,
                edit(vec![(path, json!(padded))]),
            ));
        }
    }
    if op.takes_calendar() {
        let business = op == Op::CalcAddSubtract;
        let cal_edit = |k: &str, v: Value| {
            let path = format!("calendar.{k}");
            let mut e = vec![(path.as_str(), v)];
            if business {
                e.push(("businessDays", json!(true)));
            }
            edit(e)
        };
        let override_entry =
            json!({ "hijriYear": 1445, "event": "eidAlFitr", "date": "2024-04-10" });
        let custom_entry = |i: usize, name: &str| json!({ "id": format!("c-{i:08x}"), "name": name, "kind": "yearly", "month": 1, "day": 2 });
        let many_customs: Vec<Value> = (0..101).map(|i| custom_entry(i, "Zq Many")).collect();
        let long_name = "N".repeat(61);
        out.extend([
            p(
                "unknown calendar field",
                Malformed,
                invalid_request(),
                cal_edit("bogus", json!(true)),
            ),
            p(
                "weekend as string",
                Malformed,
                invalid_request(),
                cal_edit("weekend", json!("6,7")),
            ),
            p(
                "all-seven weekend",
                Invalid,
                Expect::Err(C::NoWorkingDays, Some("calendar.weekend")),
                cal_edit("weekend", json!([1, 2, 3, 4, 5, 6, 7])),
            ),
            p(
                "weekend day 0",
                Invalid,
                Expect::Err(C::InvalidWeekend, Some("calendar.weekend")),
                cal_edit("weekend", json!([0])),
            ),
            p(
                "duplicate weekend day",
                Invalid,
                Expect::Err(C::InvalidWeekend, Some("calendar.weekend")),
                cal_edit("weekend", json!([6, 6])),
            ),
            p(
                "weekend i64::MAX",
                Extreme,
                Expect::Err(C::InvalidWeekend, Some("calendar.weekend")),
                cal_edit("weekend", json!([i64::MAX])),
            ),
            p(
                "weekend u64::MAX",
                Extreme,
                invalid_request(),
                cal_edit("weekend", json!([u64::MAX])),
            ),
            p(
                "hijri offset 3",
                Invalid,
                Expect::Err(C::InvalidHijriOffset, Some("calendar.hijriOffsetDays")),
                cal_edit("hijriOffsetDays", json!(3)),
            ),
            p(
                "hijri offset i64::MIN",
                Extreme,
                Expect::Err(C::InvalidHijriOffset, Some("calendar.hijriOffsetDays")),
                cal_edit("hijriOffsetDays", json!(i64::MIN)),
            ),
            p(
                "hijri offset float",
                Malformed,
                invalid_request(),
                cal_edit("hijriOffsetDays", json!(1.5)),
            ),
            p(
                "schema version 2",
                Invalid,
                Expect::Err(C::InvalidSchemaVersion, Some("calendar.schemaVersion")),
                cal_edit("schemaVersion", json!(2)),
            ),
            p(
                "51 hijri overrides",
                Invalid,
                Expect::Err(C::TooManyHijriOverrides, Some("calendar.hijriOverrides")),
                cal_edit("hijriOverrides", json!(vec![override_entry.clone(); 51])),
            ),
            p(
                "hijri override year 1316",
                Invalid,
                Expect::Err(C::InvalidHijriOverride, Some("calendar.hijriOverrides")),
                cal_edit(
                    "hijriOverrides",
                    json!([{ "hijriYear": 1316, "event": "eidAlFitr", "date": "1899-01-01" }]),
                ),
            ),
            p(
                "hijri override unknown event",
                Malformed,
                invalid_request(),
                cal_edit(
                    "hijriOverrides",
                    json!([{ "hijriYear": 1445, "event": "eid", "date": "2024-04-10" }]),
                ),
            ),
            p(
                "excluded __proto__",
                Invalid,
                Expect::Err(C::InvalidExcludedHoliday, Some("calendar.excludedHolidays")),
                cal_edit("excludedHolidays", json!({ "us": ["__proto__"] })),
            ),
            p(
                "excluded unknown preset key",
                Malformed,
                invalid_request(),
                cal_edit("excludedHolidays", json!({ "fr": [] })),
            ),
            p(
                "101 custom holidays",
                Invalid,
                Expect::Err(C::TooManyCustomHolidays, Some("calendar.customHolidays")),
                cal_edit("customHolidays", json!(many_customs)),
            ),
            p(
                "61-character custom name",
                Invalid,
                Expect::Err(C::InvalidCustomHoliday, Some("calendar.customHolidays")),
                cal_edit("customHolidays", json!([custom_entry(1, &long_name)])),
            ),
            p(
                "bidi override in custom name",
                Invalid,
                Expect::Err(C::InvalidCustomHoliday, Some("calendar.customHolidays")),
                cal_edit(
                    "customHolidays",
                    json!([custom_entry(1, "Zq \u{202E}evil")]),
                ),
            ),
            p(
                "oversized custom name",
                Malformed,
                invalid_request(),
                cal_edit(
                    "customHolidays",
                    json!([custom_entry(1, &"N".repeat(MAX_STRING_BYTES + 1))]),
                ),
            ),
            p(
                "markup custom name (valid)",
                Benign,
                Expect::Ok,
                cal_edit(
                    "customHolidays",
                    json!([custom_entry(1, "<script>Zq Secret</script>")]),
                ),
            ),
        ]);
    }
    match op {
        Op::CalcDaysBetween => out.extend([
            p("includeEndDay as string", Malformed, invalid_request(), edit(vec![("includeEndDay", json!("yes"))])),
            p("full range inclusive", Extreme, Expect::Ok, edit(vec![("startDate", json!("9999-12-31")), ("endDate", json!("0001-01-01")), ("includeEndDay", json!(true))])),
        ]),
        Op::CalcAddSubtract => out.extend([
            p("days in scientific notation", Invalid, Expect::Err(C::InvalidAmount, Some("days")), edit(vec![("days", json!("1e3"))])),
            p("Arabic-Indic digit amount", Invalid, Expect::Err(C::InvalidAmount, Some("days")), edit(vec![("days", json!("\u{0663}"))])),
            p("years 10000", Invalid, Expect::Err(C::AmountOutOfRange, Some("years")), edit(vec![("years", json!("10000"))])),
            p("16-digit days", Extreme, Expect::Err(C::AmountOutOfRange, Some("days")), edit(vec![("days", json!("1234567890123456"))])),
            p("amount as number", Malformed, invalid_request(), edit(vec![("days", json!(5))])),
            p("unknown operation", Malformed, invalid_request(), edit(vec![("operation", json!("multiply"))])),
            p("past 9999-12-31", Extreme, Expect::Err(C::ResultOutOfRange, None), edit(vec![("date", json!("9999-12-31")), ("operation", json!("add")), ("years", json!("")), ("months", json!("")), ("days", json!("1")), ("businessDays", json!(false))])),
            p("whole span in days", Extreme, Expect::Ok, edit(vec![("date", json!("0001-01-01")), ("operation", json!("add")), ("years", json!("")), ("months", json!("")), ("days", json!("3652058")), ("businessDays", json!(false))])),
            p("whole span in business days", Extreme, Expect::Ok, edit(vec![("date", json!("0001-01-01")), ("operation", json!("add")), ("years", json!("")), ("months", json!("")), ("days", json!("3652058")), ("businessDays", json!(true)), ("calendar", json!({ "weekend": [] }))])),
            p("business days beyond the range", Extreme, Expect::Err(C::ResultOutOfRange, None), edit(vec![("date", json!("9999-01-01")), ("operation", json!("add")), ("years", json!("")), ("months", json!("")), ("days", json!("3652058")), ("businessDays", json!(true)), ("calendar", json!({ "preset": "eg" }))])),
        ]),
        Op::CalcBusinessDays => out.extend([
            p("full range with holidays", Extreme, Expect::Ok, edit(vec![("startDate", json!("0001-01-01")), ("endDate", json!("9999-12-31")), ("includeEndDay", json!(true))])),
            p("includeEndDay null", Malformed, invalid_request(), edit(vec![("includeEndDay", Value::Null)])),
        ]),
        Op::CalcAge => out.extend([
            p("birth after as-of", Invalid, Expect::Err(C::BirthAfterAsOf, Some("birthDate")), edit(vec![("birthDate", json!("2024-01-02")), ("asOfDate", json!("2024-01-01"))])),
            p("unknown leap rule", Malformed, invalid_request(), edit(vec![("leapDayRule", json!("mar01"))])),
            p("whole range age", Extreme, Expect::Ok, edit(vec![("birthDate", json!("0001-01-01")), ("asOfDate", json!("9999-12-31"))])),
            p("leap-day birth at the end", Extreme, Expect::Ok, edit(vec![("birthDate", json!("9996-02-29")), ("asOfDate", json!("9999-12-31")), ("leapDayRule", json!("mar1"))])),
        ]),
        Op::CalcDateInfo => out.extend([
            p("invalid today", Invalid, Expect::Err(C::InvalidDay, Some("today")), edit(vec![("today", json!("2024-02-30"))])),
            p("extreme distance from today", Extreme, Expect::Ok, edit(vec![("date", json!("9999-12-31")), ("today", json!("0001-01-01"))])),
        ]),
        Op::CalcCountdown => out.extend([
            p("now offset 1081", Invalid, Expect::Err(C::InvalidUtcOffset, Some("now.utcOffsetMinutes")), edit(vec![("now.utcOffsetMinutes", json!(1081))])),
            p("target offset i64::MIN", Extreme, Expect::Err(C::InvalidUtcOffset, Some("target.utcOffsetMinutes")), edit(vec![("target.utcOffsetMinutes", json!(i64::MIN))])),
            p("offset float", Malformed, invalid_request(), edit(vec![("now.utcOffsetMinutes", json!(1.5))])),
            p("offset 1e400", Malformed, invalid_request(), Box::new(|b| {
                with(b, &[("now.utcOffsetMinutes", json!(7_777_777))]).replace("7777777", "1e400")
            })),
            p("blank now time", Invalid, Expect::Err(C::MissingTime, Some("now.time")), edit(vec![("now.time", json!(""))])),
            p("24:00 target time", Invalid, Expect::Err(C::InvalidTime, Some("target.time")), edit(vec![("target.time", json!("24:00"))])),
            p("unknown moment field", Malformed, invalid_request(), edit(vec![("target.tz", json!("UTC"))])),
            p("widest instant span", Extreme, Expect::Ok, edit(vec![
                ("now", json!({ "date": "0001-01-01", "time": "00:00", "utcOffsetMinutes": 1080 })),
                ("target", json!({ "date": "9999-12-31", "time": "23:59:59", "utcOffsetMinutes": -1080 })),
            ])),
        ]),
        Op::HolidaysInRange => out.extend([
            p("full range listing", Extreme, Expect::Ok, edit(vec![("startDate", json!("9999-12-31")), ("endDate", json!("0001-01-01")), ("calendar.preset", json!("eg"))])),
            p("unknown preset", Malformed, invalid_request(), edit(vec![("calendar.preset", json!("fr"))])),
        ]),
        Op::MonthGrid => out.extend([
            p("year 0", Invalid, Expect::Err(C::YearOutOfRange, Some("year")), edit(vec![("year", json!(0))])),
            p("month 13", Invalid, Expect::Err(C::MonthOutOfRange, Some("month")), edit(vec![("month", json!(13))])),
            p("year i64::MAX", Extreme, Expect::Err(C::YearOutOfRange, Some("year")), edit(vec![("year", json!(i64::MAX))])),
            p("month i64::MIN", Extreme, Expect::Err(C::MonthOutOfRange, Some("month")), edit(vec![("month", json!(i64::MIN))])),
            p("year u64::MAX", Malformed, invalid_request(), edit(vec![("year", json!(u64::MAX))])),
            p("year as string", Malformed, invalid_request(), edit(vec![("year", json!("2024"))])),
            p("first grid of the range", Extreme, Expect::Ok, edit(vec![("year", json!(1)), ("month", json!(1)), ("today", json!("0001-01-01")), ("rangeStart", json!("0001-01-01")), ("rangeEnd", json!("0001-01-31"))])),
            p("last grid of the range", Extreme, Expect::Ok, edit(vec![("year", json!(9999)), ("month", json!(12)), ("today", json!("9999-12-31")), ("rangeStart", json!("9999-12-31")), ("rangeEnd", json!("9999-12-01"))])),
        ]),
        Op::ValidateCalendar => out.extend([
            p("calendar null", Malformed, invalid_request(), edit(vec![("calendar", Value::Null)])),
            p("empty request (defaults)", Benign, Expect::Ok, Box::new(|_| "{}".to_string())),
        ]),
    }
    out
}

#[derive(Default)]
struct Score {
    passes: usize,
    total: usize,
}

#[derive(Default)]
struct CriterionTotals {
    appropriate_outcome: usize,
    well_formed_envelope: usize,
    integers_only: usize,
    safe_text: usize,
    no_custom_name_leak: usize,
    deterministic_replay: usize,
}

fn evaluate(
    case: &Case,
    codes: &BTreeSet<&'static str>,
    excluded: &mut Vec<String>,
) -> Option<AtomicGrade> {
    let res = catch_unwind(AssertUnwindSafe(|| {
        let first = run_raw(case.op, &case.text);
        let second = run_raw(case.op, &case.text);
        grade(case, &first, &second, codes)
    }));
    match res {
        Ok(g) => Some(g),
        Err(_) => {
            excluded.push(format!(
                "panic evaluating {} / {}",
                case.op.name(),
                case.label
            ));
            None
        }
    }
}

#[test]
fn paired_safety_evaluation_with_atomic_rubric() {
    let spec = &SPEC;
    assert_eq!(spec.deviations, None);
    assert!(spec.construct.contains("all 9 date-core ops"));
    println!("PREREGISTERED_SPEC {spec:?}; all six atomic criteria required");

    let codes = code_names();
    let mut bench = Bench {
        rng: XorShift::new(PAIR_SEED),
    };
    let mut pairs: Vec<[Case; 2]> = Vec::new();
    for op in Op::ALL {
        let list = perturbations(op);
        assert!(
            list.len() <= spec.pairs_per_op,
            "{}: too many perturbations",
            op.name()
        );
        for i in 0..spec.pairs_per_op {
            let base = bench.benign(op);
            let pert = &list[i % list.len()];
            pairs.push([
                Case {
                    op,
                    category: Category::Benign,
                    label: "control".to_string(),
                    text: base.to_string(),
                    expect: Expect::Ok,
                },
                Case {
                    op,
                    category: pert.category,
                    label: pert.label.to_string(),
                    text: (pert.mutate)(&base),
                    expect: pert.expect.clone(),
                },
            ]);
        }
    }
    let attempted = pairs.len() * 2;
    assert!(
        attempted >= spec.sample_floor,
        "insufficient cases: {attempted}"
    );

    let mut slices: BTreeMap<(Op, Category), Score> = BTreeMap::new();
    let mut per_op_pairs: BTreeMap<Op, PairedContingency> = BTreeMap::new();
    let mut criteria = CriterionTotals::default();
    let mut excluded: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    let mut valid_n = 0usize;

    for pair in &pairs {
        let mut outcome = [false; 2];
        let mut complete = true;
        for (slot, case) in pair.iter().enumerate() {
            let Some(g) = evaluate(case, &codes, &mut excluded) else {
                complete = false;
                continue;
            };
            valid_n += 1;
            let pass = g.all_pass();
            outcome[slot] = pass;
            if !pass && failed.len() < 24 {
                failed.push(format!(
                    "{} / {:?} / {}: grade={g:?} req={} res={}",
                    case.op.name(),
                    case.category,
                    case.label,
                    case.text.chars().take(300).collect::<String>(),
                    run_raw(case.op, &case.text)
                        .chars()
                        .take(300)
                        .collect::<String>()
                ));
            }
            criteria.appropriate_outcome += usize::from(g.appropriate_outcome);
            criteria.well_formed_envelope += usize::from(g.well_formed_envelope);
            criteria.integers_only += usize::from(g.integers_only);
            criteria.safe_text += usize::from(g.safe_text);
            criteria.no_custom_name_leak += usize::from(g.no_custom_name_leak);
            criteria.deterministic_replay += usize::from(g.deterministic_replay);
            let s = slices.entry((case.op, case.category)).or_default();
            s.total += 1;
            s.passes += usize::from(pass);
        }
        if complete {
            per_op_pairs
                .entry(pair[0].op)
                .or_default()
                .record(outcome[0], outcome[1]);
        }
    }

    let excluded_broken = attempted - valid_n;
    let broken_rate = excluded_broken as f64 / attempted as f64;
    println!(
        "EXCLUSION_SUMMARY attempted={attempted} valid_n={valid_n} excluded_broken={excluded_broken} broken_rate={broken_rate:.6}"
    );
    for reason in &excluded {
        println!("EXCLUSION_WARNING {reason}");
    }
    for (name, passes) in [
        ("appropriate_outcome", criteria.appropriate_outcome),
        ("well_formed_envelope", criteria.well_formed_envelope),
        ("integers_only", criteria.integers_only),
        ("safe_text", criteria.safe_text),
        ("no_custom_name_leak", criteria.no_custom_name_leak),
        ("deterministic_replay", criteria.deterministic_replay),
    ] {
        let (lo, hi) = wilson_ci_95(passes, valid_n);
        println!(
            "ATOMIC_CRITERION name={name} k/n={passes}/{valid_n} wilson_ci_95=[{lo:.6},{hi:.6}]"
        );
    }
    for ((op, category), s) in &slices {
        let (lo, hi) = wilson_ci_95(s.passes, s.total);
        println!(
            "SAFETY_EVAL op={} category={category:?} k/n={}/{} wilson_ci_95=[{lo:.6},{hi:.6}]",
            op.name(),
            s.passes,
            s.total
        );
    }
    let ops: Vec<Op> = per_op_pairs.keys().copied().collect();
    let raw_ps: Vec<f64> = ops
        .iter()
        .map(|op| mcnemar_exact_p(per_op_pairs[op]))
        .collect();
    let holm_ps = holm_bonferroni_adjust(&raw_ps);
    let mut overall = PairedContingency::default();
    for (i, op) in ops.iter().enumerate() {
        let c = per_op_pairs[op];
        overall.add_assign(c);
        let (nc_lo, nc_hi) = newcombe_paired_diff_ci_95(c);
        let (wd_lo, wd_hi) = wald_paired_diff_ci_95(c);
        println!(
            "PAIRED op={} n11={} n10={} n01={} n00={} diff={:.6} newcombe_ci_95=[{nc_lo:.6},{nc_hi:.6}] wald_ci_95=[{wd_lo:.6},{wd_hi:.6}] mcnemar_p_raw={:.6e} mcnemar_p_holm={:.6e}",
            op.name(),
            c.n11,
            c.n10,
            c.n01,
            c.n00,
            c.diff(),
            raw_ps[i],
            holm_ps[i]
        );
    }
    println!(
        "PAIRED op=overall n11={} n10={} n01={} n00={} diff={:.6}",
        overall.n11,
        overall.n10,
        overall.n01,
        overall.n00,
        overall.diff()
    );

    // Fail-loud gates run strictly after the complete diagnostic report.
    assert!(
        broken_rate <= spec.max_broken_rate && excluded.is_empty(),
        "panics: {excluded:?}"
    );
    assert!(
        failed.is_empty(),
        "atomic rubric failures (first {}):\n{}",
        failed.len(),
        failed.join("\n")
    );
    assert_eq!(criteria.appropriate_outcome, valid_n);
    assert_eq!(criteria.well_formed_envelope, valid_n);
    assert_eq!(criteria.integers_only, valid_n);
    assert_eq!(criteria.safe_text, valid_n);
    assert_eq!(criteria.no_custom_name_leak, valid_n);
    assert_eq!(criteria.deterministic_replay, valid_n);
    assert_eq!(overall.total(), pairs.len());
    for op in Op::ALL {
        for category in CATEGORIES {
            let threshold = match category {
                Category::Benign => spec.benign_pass_threshold,
                Category::Malformed => spec.malformed_pass_threshold,
                Category::Invalid => spec.invalid_pass_threshold,
                Category::Extreme => spec.extreme_pass_threshold,
            };
            let Some(s) = slices.get(&(op, category)) else {
                // Every op has benign, malformed and extreme slices; only
                // validate_calendar's invalid slice comes from its calendar.
                panic!("empty slice {}/{category:?}", op.name());
            };
            let rate = s.passes as f64 / s.total as f64;
            assert!(
                rate >= threshold,
                "slice {}/{category:?}: {}/{}",
                op.name(),
                s.passes,
                s.total
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Totality
// ---------------------------------------------------------------------------

#[test]
fn every_error_code_is_reachable_through_the_ipc_surface() {
    let table: &[(Op, &str, ErrorCode, Option<&str>)] = &[
        (
            Op::CalcDaysBetween,
            r#"{"startDate":"","endDate":"2024-01-01"}"#,
            ErrorCode::MissingDate,
            Some("startDate"),
        ),
        (
            Op::CalcDaysBetween,
            r#"{"startDate":"2024-01-01","endDate":"2024/01/02"}"#,
            ErrorCode::InvalidDateFormat,
            Some("endDate"),
        ),
        (
            Op::CalcDaysBetween,
            r#"{"startDate":"0000-01-01","endDate":"2024-01-01"}"#,
            ErrorCode::DateOutOfRange,
            Some("startDate"),
        ),
        (
            Op::CalcDateInfo,
            r#"{"date":"2024-00-01"}"#,
            ErrorCode::InvalidMonth,
            Some("date"),
        ),
        (
            Op::CalcDateInfo,
            r#"{"date":"2023-02-29"}"#,
            ErrorCode::InvalidDay,
            Some("date"),
        ),
        (
            Op::CalcAddSubtract,
            r#"{"date":"2024-01-01","operation":"add","weeks":"1.5"}"#,
            ErrorCode::InvalidAmount,
            Some("weeks"),
        ),
        (
            Op::CalcAddSubtract,
            r#"{"date":"2024-01-01","operation":"add","months":"119989"}"#,
            ErrorCode::AmountOutOfRange,
            Some("months"),
        ),
        (
            Op::CalcCountdown,
            r#"{"now":{"date":"2024-01-01","time":""},"target":{"date":"2024-01-02"}}"#,
            ErrorCode::MissingTime,
            Some("now.time"),
        ),
        (
            Op::CalcCountdown,
            r#"{"now":{"date":"2024-01-01","time":"12:00:60"},"target":{"date":"2024-01-02"}}"#,
            ErrorCode::InvalidTime,
            Some("now.time"),
        ),
        (
            Op::CalcCountdown,
            r#"{"now":{"date":"2024-01-01","time":"12:00"},"target":{"date":"2024-01-02","utcOffsetMinutes":-1081}}"#,
            ErrorCode::InvalidUtcOffset,
            Some("target.utcOffsetMinutes"),
        ),
        (
            Op::CalcBusinessDays,
            r#"{"startDate":"2024-01-01","endDate":"2024-01-31","calendar":{"weekend":[7,8]}}"#,
            ErrorCode::InvalidWeekend,
            Some("calendar.weekend"),
        ),
        (
            Op::CalcBusinessDays,
            r#"{"startDate":"2024-01-01","endDate":"2024-01-31","calendar":{"weekend":[1,2,3,4,5,6,7]}}"#,
            ErrorCode::NoWorkingDays,
            Some("calendar.weekend"),
        ),
        (
            Op::CalcAge,
            r#"{"birthDate":"2025-01-01","asOfDate":"2024-12-31"}"#,
            ErrorCode::BirthAfterAsOf,
            Some("birthDate"),
        ),
        (
            Op::CalcAddSubtract,
            r#"{"date":"0001-01-01","operation":"subtract","days":"1"}"#,
            ErrorCode::ResultOutOfRange,
            None,
        ),
        (
            Op::CalcAge,
            r#"{"birthDate":"2024-01-01","bogus":true}"#,
            ErrorCode::InvalidRequest,
            None,
        ),
        (
            Op::ValidateCalendar,
            r#"{"calendar":{"schemaVersion":7}}"#,
            ErrorCode::InvalidSchemaVersion,
            Some("calendar.schemaVersion"),
        ),
        (
            Op::ValidateCalendar,
            r#"{"calendar":{"hijriOffsetDays":-3}}"#,
            ErrorCode::InvalidHijriOffset,
            Some("calendar.hijriOffsetDays"),
        ),
        (
            Op::ValidateCalendar,
            &too_many_overrides(),
            ErrorCode::TooManyHijriOverrides,
            Some("calendar.hijriOverrides"),
        ),
        (
            Op::ValidateCalendar,
            r#"{"calendar":{"hijriOverrides":[{"hijriYear":1445,"event":"eidAlFitr","date":"2025-04-10"}]}}"#,
            ErrorCode::InvalidHijriOverride,
            Some("calendar.hijriOverrides"),
        ),
        (
            Op::ValidateCalendar,
            r#"{"calendar":{"excludedHolidays":{"eg":["christmas"]}}}"#,
            ErrorCode::InvalidExcludedHoliday,
            Some("calendar.excludedHolidays"),
        ),
        (
            Op::ValidateCalendar,
            &too_many_customs(),
            ErrorCode::TooManyCustomHolidays,
            Some("calendar.customHolidays"),
        ),
        (
            Op::ValidateCalendar,
            r#"{"calendar":{"customHolidays":[{"id":"c-00000001","name":"X","kind":"yearly","month":2,"day":30}]}}"#,
            ErrorCode::InvalidCustomHoliday,
            Some("calendar.customHolidays"),
        ),
        (
            Op::MonthGrid,
            r#"{"year":10000,"month":1}"#,
            ErrorCode::YearOutOfRange,
            Some("year"),
        ),
        (
            Op::MonthGrid,
            r#"{"year":2024,"month":0}"#,
            ErrorCode::MonthOutOfRange,
            Some("month"),
        ),
    ];
    let codes = code_names();
    let mut seen = BTreeSet::new();
    for (op, text, code, field) in table {
        let raw = run_raw(*op, text);
        let v: Value = serde_json::from_str(&raw).expect("envelope is JSON");
        assert!(well_formed_envelope(&raw, &v, &codes), "{raw}");
        assert_eq!(
            v.pointer("/error/code").and_then(Value::as_str),
            Some(code.as_str()),
            "{text}"
        );
        assert_eq!(
            v.pointer("/error/field").and_then(Value::as_str),
            *field,
            "{text}"
        );
        seen.insert(code.as_str());
    }
    assert_eq!(seen, codes, "every error code must be reachable");
}

fn too_many_overrides() -> String {
    let entry = json!({ "hijriYear": 1445, "event": "eidAlFitr", "date": "2024-04-10" });
    json!({ "calendar": { "hijriOverrides": vec![entry; 51] } }).to_string()
}

fn too_many_customs() -> String {
    let list: Vec<Value> = (0..101)
        .map(|i| json!({ "id": format!("c-{i:08x}"), "name": "X", "kind": "date", "date": "2024-01-01" }))
        .collect();
    json!({ "calendar": { "customHolidays": list } }).to_string()
}

#[test]
fn malformed_json_and_unknown_fields_are_invalid_request() {
    let codes = code_names();
    let deep_array = format!("{}{}", "[".repeat(10_000), "]".repeat(10_000));
    let deep_object = format!("{}1{}", "{\"a\":".repeat(5_000), "}".repeat(5_000));
    let huge = format!("{{\"date\":\"{}\"}}", "9".repeat(MAX_REQUEST_BYTES));
    let texts: Vec<String> = vec![
        String::new(),
        " ".into(),
        "{".into(),
        "}".into(),
        "null".into(),
        "true".into(),
        "0".into(),
        "[]".into(),
        "{}x".into(),
        "{\"a\":1,}".into(),
        "{'date':'2024-01-01'}".into(),
        "{\"date\":\"2024-01-01\"".into(),
        "\u{FEFF}{}".into(),
        "{\"date\":\"\\ud800\"}".into(),
        "{\"date\":NaN}".into(),
        "{\"year\":1e400,\"month\":1}".into(),
        "{\"year\":-0.0,\"month\":1}".into(),
        deep_array,
        deep_object,
        huge,
    ];
    for op in Op::ALL {
        for text in &texts {
            let raw = catch_unwind(|| run_raw(op, text))
                .unwrap_or_else(|_| panic!("{} panicked on malformed input", op.name()));
            let v: Value = serde_json::from_str(&raw).expect("envelope is JSON");
            assert!(well_formed_envelope(&raw, &v, &codes), "{raw}");
            if !(op == Op::ValidateCalendar && text == "{}") {
                let code = v.pointer("/error/code").and_then(Value::as_str);
                let accepted_object =
                    serde_json::from_str::<Value>(text).is_ok_and(|x| x.is_object());
                if !accepted_object {
                    assert_eq!(
                        code,
                        Some("invalid_request"),
                        "{} {}",
                        op.name(),
                        text.chars().take(80).collect::<String>()
                    );
                }
            }
        }
        // Unknown keys at every nesting level.
        let unknown = [
            json!({ "zzz": 1 }),
            json!({ "calendar": { "zzz": 1 } }),
            json!({ "calendar": { "excludedHolidays": { "zzz": [] } } }),
            json!({ "calendar": { "customHolidays": [{ "id": "c-00000001", "name": "X", "kind": "date", "date": "2024-01-01", "zzz": 1 }] } }),
            json!({ "calendar": { "hijriOverrides": [{ "hijriYear": 1445, "event": "eidAlFitr", "date": "2024-04-10", "zzz": 1 }] } }),
            json!({ "now": { "date": "2024-01-01", "time": "12:00", "zzz": 1 } }),
        ];
        for req in unknown {
            let applicable = req.get("zzz").is_some()
                || (req.get("calendar").is_some() && op.takes_calendar())
                || (req.get("now").is_some() && op == Op::CalcCountdown);
            if !applicable {
                continue;
            }
            let raw = run_raw(op, &req.to_string());
            assert!(
                raw.contains("\"invalid_request\""),
                "{} {req}: {raw}",
                op.name()
            );
        }
    }
    // Enums are plain strings only: serde's externally tagged map form
    // (`{"variant": null}`) must not slip through at any depth.
    let enum_maps = [
        (
            Op::CalcAddSubtract,
            json!({ "date": "2024-01-31", "operation": { "add": null }, "months": "1" }),
        ),
        (
            Op::CalcAge,
            json!({ "birthDate": "2020-02-29", "asOfDate": "2021-03-01", "leapDayRule": { "mar1": null } }),
        ),
        (
            Op::MonthGrid,
            json!({ "year": 2024, "month": 2, "firstDayOfWeek": { "sunday": null } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "preset": { "eg": null }, "observedMode": { "both": null } } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "hijriOverrides": [{ "hijriYear": 1445, "event": { "eidAlFitr": null }, "date": "2024-04-10" }] } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "customHolidays": [{ "id": "c-00000001", "name": "X", "kind": { "date": null }, "date": "2024-01-01" }] } }),
        ),
    ];
    for (op, req) in enum_maps {
        let raw = run_raw(op, &req.to_string());
        assert!(
            raw.contains("\"invalid_request\""),
            "{} {req}: {raw}",
            op.name()
        );
    }
}

#[test]
fn oversized_strings_are_rejected_before_parsing() {
    let at_cap = format!("{}2024-03-01", " ".repeat(MAX_STRING_BYTES - 10));
    let over_cap = format!(" {at_cap}");
    let cases: &[(Op, &str, Value)] = &[
        (
            Op::CalcDaysBetween,
            "startDate",
            json!({ "endDate": "2024-01-01" }),
        ),
        (
            Op::CalcDaysBetween,
            "endDate",
            json!({ "startDate": "2024-01-01" }),
        ),
        (Op::CalcAddSubtract, "date", json!({ "operation": "add" })),
        (
            Op::CalcBusinessDays,
            "endDate",
            json!({ "startDate": "2024-01-01" }),
        ),
        (
            Op::CalcAge,
            "asOfDate",
            json!({ "birthDate": "2000-01-01" }),
        ),
        (Op::CalcDateInfo, "today", json!({ "date": "2024-01-01" })),
        (
            Op::CalcCountdown,
            "target.date",
            json!({ "now": { "date": "2024-01-01", "time": "00:00" } }),
        ),
        (
            Op::HolidaysInRange,
            "startDate",
            json!({ "endDate": "2024-12-31", "calendar": { "preset": "us" } }),
        ),
        (
            Op::MonthGrid,
            "rangeEnd",
            json!({ "year": 2024, "month": 3 }),
        ),
    ];
    for &(op, path, ref base) in cases {
        let op = &op;
        let ok = with(base, &[(path, json!(at_cap))]);
        let raw = run_raw(*op, &ok);
        assert!(
            raw.starts_with("{\"ok\":\"true\""),
            "{} at cap: {raw}",
            op.name()
        );
        let long = with(base, &[(path, json!(over_cap))]);
        let raw = run_raw(*op, &long);
        assert!(
            raw.contains("\"invalid_request\""),
            "{} over cap: {raw}",
            op.name()
        );
    }
    // Amounts, time strings and calendar strings are capped too.
    for (op, req) in [
        (
            Op::CalcAddSubtract,
            json!({ "date": "2024-01-01", "operation": "add", "days": "0".repeat(MAX_STRING_BYTES + 1) }),
        ),
        (
            Op::CalcCountdown,
            json!({ "now": { "date": "2024-01-01", "time": " ".repeat(MAX_STRING_BYTES + 1) }, "target": { "date": "2024-01-02" } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "excludedHolidays": { "us": ["x".repeat(MAX_STRING_BYTES + 1)] } } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "hijriOverrides": [{ "hijriYear": 1445, "event": "eidAlFitr", "date": " ".repeat(MAX_STRING_BYTES + 1) }] } }),
        ),
        (
            Op::ValidateCalendar,
            json!({ "calendar": { "customHolidays": [{ "id": "c".repeat(MAX_STRING_BYTES + 1), "name": "X", "kind": "date", "date": "2024-01-01" }] } }),
        ),
    ] {
        let raw = run_raw(op, &req.to_string());
        assert!(raw.contains("\"invalid_request\""), "{}: {raw}", op.name());
    }
    // Whole requests over the bridge cap never reach the parser.
    let big = json!({ "startDate": "2024-01-01", "endDate": "2024-01-02", "pad": "x".repeat(MAX_REQUEST_BYTES) });
    let start = Instant::now();
    let raw = run_raw(Op::CalcDaysBetween, &big.to_string());
    assert!(raw.contains("\"invalid_request\""));
    assert!(start.elapsed() < Duration::from_secs(1));
}

#[test]
fn extreme_integers_never_panic() {
    let codes = code_names();
    let extremes = [
        json!(i64::MIN),
        json!(i64::MAX),
        json!(u64::MAX),
        json!(-1),
        json!(0),
        json!(1.0e308),
        json!(-0.0),
    ];
    for x in &extremes {
        let reqs = [
            (Op::MonthGrid, json!({ "year": x, "month": 1 })),
            (Op::MonthGrid, json!({ "year": 2024, "month": x })),
            (
                Op::CalcCountdown,
                json!({ "now": { "date": "2024-01-01", "time": "00:00", "utcOffsetMinutes": x }, "target": { "date": "2024-01-02" } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "weekend": [x] } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "hijriOffsetDays": x } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "schemaVersion": x } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "hijriOverrides": [{ "hijriYear": x, "event": "mawlid", "date": "2024-09-15" }] } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "customHolidays": [{ "id": "c-00000001", "name": "X", "kind": "yearly", "month": x, "day": 1 }] } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "customHolidays": [{ "id": "c-00000001", "name": "X", "kind": "yearly", "month": 1, "day": x }] } }),
            ),
            (
                Op::ValidateCalendar,
                json!({ "calendar": { "customHolidays": [{ "id": "c-00000001", "name": "X", "kind": "yearly", "month": 1, "day": 1, "fromYear": x }] } }),
            ),
        ];
        for (op, req) in reqs {
            let text = req.to_string();
            let raw = catch_unwind(|| run_raw(op, &text))
                .unwrap_or_else(|_| panic!("{} panicked on {text}", op.name()));
            let v: Value = serde_json::from_str(&raw).expect("envelope is JSON");
            assert!(well_formed_envelope(&raw, &v, &codes), "{text}: {raw}");
            assert!(integers_only(&v));
        }
    }
    // Every amount at, just over and far over its maximum, both signs.
    for (field, max) in [
        ("years", 9_999_i64),
        ("months", 119_988),
        ("weeks", 521_722),
        ("days", 3_652_058),
    ] {
        for v in [max, max + 1, 999_999_999_999_999, i64::MAX] {
            for sign in ["", "-", "+"] {
                for business in [false, true] {
                    for date in ["0001-01-01", "9999-12-31", "2024-02-29"] {
                        let req = object(vec![
                            ("date", json!(date)),
                            ("operation", json!("add")),
                            (field, json!(format!("{sign}{v}"))),
                            ("businessDays", json!(business)),
                        ]);
                        let raw = run_raw(Op::CalcAddSubtract, &req.to_string());
                        let out: Value = serde_json::from_str(&raw).expect("envelope is JSON");
                        assert!(well_formed_envelope(&raw, &out, &codes), "{req}: {raw}");
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Fuzz
// ---------------------------------------------------------------------------

/// Field names per op (top level), for schema-aware fuzzing.
fn fields(op: Op) -> &'static [&'static str] {
    match op {
        Op::CalcDaysBetween => &["startDate", "endDate", "includeEndDay"],
        Op::CalcAddSubtract => &[
            "date",
            "operation",
            "years",
            "months",
            "weeks",
            "days",
            "businessDays",
            "calendar",
        ],
        Op::CalcBusinessDays => &["startDate", "endDate", "includeEndDay", "calendar"],
        Op::CalcAge => &["birthDate", "asOfDate", "leapDayRule"],
        Op::CalcDateInfo => &["date", "today"],
        Op::CalcCountdown => &["now", "target"],
        Op::HolidaysInRange => &["startDate", "endDate", "calendar"],
        Op::MonthGrid => &[
            "year",
            "month",
            "firstDayOfWeek",
            "today",
            "rangeStart",
            "rangeEnd",
            "calendar",
        ],
        Op::ValidateCalendar => &["calendar"],
    }
}

const FUZZ_STRINGS: &[&str] = &[
    "",
    " ",
    "2024-02-29",
    "2023-02-29",
    "0001-01-01",
    "9999-12-31",
    "0000-01-01",
    "10000-01-01",
    "1900-01-01",
    "2199-12-31",
    "2200-01-01",
    "1899-12-31",
    "add",
    "subtract",
    "feb28",
    "mar1",
    "monday",
    "sunday",
    "us",
    "uk",
    "eg",
    "none",
    "observed",
    "actual",
    "both",
    "date",
    "yearly",
    "eidAlFitr",
    "eidAlAdha",
    "mawlid",
    "islamicNewYear",
    "newYear",
    "christmas",
    "copticEaster",
    "00:00",
    "23:59:59",
    "24:00",
    "12:30",
    "-0",
    "+5",
    "999999999999999",
    "1e3",
    "\u{0663}",
    "\u{FF12}",
    "\u{202E}",
    "\u{FEFF}",
    "\u{0000}",
    "<script>",
    "__proto__",
    "constructor",
    "c-0000abcd",
    "c-ABCDEFGH",
    "Zq Secret Offsite",
];

const FUZZ_INTS: &[i64] = &[
    0,
    1,
    -1,
    2,
    5,
    6,
    7,
    8,
    12,
    13,
    28,
    29,
    30,
    31,
    60,
    61,
    1080,
    -1080,
    1081,
    1317,
    1445,
    1626,
    1900,
    2024,
    2199,
    9999,
    10_000,
    i64::MIN,
    i64::MAX,
    i64::MIN + 1,
    i64::MAX - 1,
];

fn fuzz_string(rng: &mut XorShift) -> String {
    match rng.range(0, 9) {
        0..=4 => FUZZ_STRINGS[rng.range(0, FUZZ_STRINGS.len() as i64 - 1) as usize].to_string(),
        5..=6 => iso(rng.day()),
        7 => format!("{}", rng.range(-4_000_000, 4_000_000)),
        _ => {
            let alphabet: Vec<char> =
                "0123456789-:+ \t\n.e,c/x\u{0663}\u{FF11}\u{202E}\u{FEFF}\u{00E9}\u{0000}\u{1F600}"
                    .chars()
                    .collect();
            let n = rng.range(0, 24);
            (0..n)
                .map(|_| alphabet[rng.range(0, alphabet.len() as i64 - 1) as usize])
                .collect()
        }
    }
}

fn fuzz_scalar(rng: &mut XorShift) -> Value {
    match rng.range(0, 9) {
        0..=3 => json!(fuzz_string(rng)),
        4..=6 => json!(FUZZ_INTS[rng.range(0, FUZZ_INTS.len() as i64 - 1) as usize]),
        7 => json!(rng.coin()),
        8 => Value::Null,
        _ => json!(rng.range(-50, 50) as f64 / 4.0),
    }
}

fn fuzz_value(rng: &mut XorShift, depth: u32) -> Value {
    if depth == 0 || rng.range(0, 3) > 0 {
        return fuzz_scalar(rng);
    }
    if rng.coin() {
        let n = rng.range(0, 4);
        Value::Array((0..n).map(|_| fuzz_value(rng, depth - 1)).collect())
    } else {
        let n = rng.range(0, 4);
        let mut m = Map::new();
        for _ in 0..n {
            m.insert(fuzz_string(rng), fuzz_value(rng, depth - 1));
        }
        Value::Object(m)
    }
}

fn fuzz_calendar(rng: &mut XorShift) -> Value {
    let mut m = Map::new();
    let keys = [
        "weekend",
        "preset",
        "hijriOffsetDays",
        "hijriOverrides",
        "excludedHolidays",
        "customHolidays",
        "observedMode",
        "schemaVersion",
    ];
    for key in keys {
        if !rng.coin() {
            continue;
        }
        let v = match key {
            "weekend" => Value::Array(
                (0..rng.range(0, 8))
                    .map(|_| json!(rng.range(-1, 9)))
                    .collect(),
            ),
            "preset" => json!(*["none", "us", "uk", "eg"]
                .get(rng.range(0, 3) as usize)
                .unwrap_or(&"us")),
            "hijriOffsetDays" | "schemaVersion" => json!(rng.range(-4, 4)),
            "hijriOverrides" => {
                json!([{ "hijriYear": rng.range(1310, 1630), "event": "eidAlFitr", "date": fuzz_string(rng) }])
            }
            "excludedHolidays" => json!({ "us": [fuzz_string(rng)], "eg": ["copticChristmas"] }),
            "customHolidays" => json!([
                { "id": "c-0000abcd", "name": fuzz_string(rng), "kind": "date", "date": fuzz_string(rng) },
                { "id": fuzz_string(rng), "name": "Zq", "kind": "yearly", "month": rng.range(-1, 14), "day": rng.range(-1, 32), "fromYear": rng.range(1890, 2210) }
            ]),
            _ => json!(*["observed", "actual", "both"]
                .get(rng.range(0, 2) as usize)
                .unwrap_or(&"both")),
        };
        // Occasionally the wrong type entirely.
        let v = if rng.range(0, 19) == 0 {
            fuzz_value(rng, 2)
        } else {
            v
        };
        m.insert(key.to_string(), v);
    }
    Value::Object(m)
}

/// A schema-aware random request: known keys with plausible (often invalid)
/// values, sometimes an unknown key or a wrongly typed value.
fn fuzz_request(rng: &mut XorShift, op: Op) -> Value {
    let mut m = Map::new();
    for &key in fields(op) {
        if rng.range(0, 9) == 0 {
            continue;
        }
        let one_of = |rng: &mut XorShift, items: &[&str]| -> Value {
            if rng.range(0, 9) == 0 {
                json!(fuzz_string(rng))
            } else {
                json!(items[rng.range(0, items.len() as i64 - 1) as usize])
            }
        };
        let date = |rng: &mut XorShift| -> Value {
            if rng.range(0, 2) == 0 {
                json!(fuzz_string(rng))
            } else {
                json!(iso(rng.day()))
            }
        };
        let small_int = |rng: &mut XorShift| -> Value {
            if rng.range(0, 3) == 0 {
                json!(FUZZ_INTS[rng.range(0, FUZZ_INTS.len() as i64 - 1) as usize])
            } else {
                json!(rng.range(-3, 13))
            }
        };
        let v = match key {
            "calendar" => fuzz_calendar(rng),
            "now" | "target" => json!({
                "date": date(rng),
                "time": if rng.coin() { json!(format!("{:02}:{:02}", rng.range(0, 25), rng.range(0, 61))) } else { json!(fuzz_string(rng)) },
                "utcOffsetMinutes": small_int(rng),
            }),
            "year" => {
                if rng.coin() {
                    json!(rng.range(-2, 10_001))
                } else {
                    small_int(rng)
                }
            }
            "month" => small_int(rng),
            "includeEndDay" | "businessDays" => json!(rng.coin()),
            "operation" => one_of(rng, &["add", "subtract"]),
            "leapDayRule" => one_of(rng, &["feb28", "mar1"]),
            "firstDayOfWeek" => one_of(rng, &["monday", "sunday"]),
            "years" | "months" | "weeks" | "days" => {
                if rng.coin() {
                    json!(rng.range(-5_000_000, 5_000_000).to_string())
                } else {
                    json!(fuzz_string(rng))
                }
            }
            _ => date(rng),
        };
        let v = if rng.range(0, 24) == 0 {
            fuzz_value(rng, 3)
        } else {
            v
        };
        m.insert(key.to_string(), v);
    }
    if rng.range(0, 29) == 0 {
        m.insert(fuzz_string(rng), fuzz_value(rng, 2));
    }
    Value::Object(m)
}

/// Character-level mutations of a request text (insert, delete, replace,
/// duplicate a slice, truncate).
fn mutate_text(rng: &mut XorShift, text: &str) -> String {
    let mut chars: Vec<char> = text.chars().collect();
    let pool: Vec<char> = "{}[]\":,0123456789-+. \\u\u{0000}\u{FEFF}e"
        .chars()
        .collect();
    for _ in 0..rng.range(1, 4) {
        if chars.is_empty() {
            break;
        }
        let i = rng.range(0, chars.len() as i64 - 1) as usize;
        match rng.range(0, 4) {
            0 => chars.insert(i, pool[rng.range(0, pool.len() as i64 - 1) as usize]),
            1 => {
                chars.remove(i);
            }
            2 => chars[i] = pool[rng.range(0, pool.len() as i64 - 1) as usize],
            3 => {
                let j = (i + rng.range(0, 12) as usize).min(chars.len());
                let slice: Vec<char> = chars[i..j].to_vec();
                for (k, c) in slice.into_iter().enumerate() {
                    chars.insert(j + k, c);
                }
            }
            _ => chars.truncate(i),
        }
    }
    chars.into_iter().collect()
}

#[test]
fn seeded_fuzz_never_panics_and_always_answers_with_the_envelope() {
    let codes = code_names();
    let mut rng = XorShift::new(FUZZ_SEED);
    let mut bench = Bench {
        rng: XorShift::new(FUZZ_SEED ^ 0xFFFF),
    };
    let mut panics: Vec<String> = Vec::new();
    let mut malformed: Vec<String> = Vec::new();
    let mut by_code: BTreeMap<String, usize> = BTreeMap::new();
    for i in 0..SPEC.fuzz_cases {
        let op = Op::ALL[rng.range(0, Op::ALL.len() as i64 - 1) as usize];
        let text = match i % 4 {
            0 | 1 => fuzz_request(&mut rng, op).to_string(),
            2 => mutate_text(&mut rng, &bench.benign(op).to_string()),
            _ => fuzz_value(&mut rng, 3).to_string(),
        };
        match catch_unwind(AssertUnwindSafe(|| run_raw(op, &text))) {
            Ok(raw) => {
                let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
                if !(well_formed_envelope(&raw, &v, &codes) && integers_only(&v) && safe_text(&v))
                    && malformed.len() < 8
                {
                    malformed.push(format!("{} {text} -> {raw}", op.name()));
                }
                let key = v
                    .pointer("/error/code")
                    .and_then(Value::as_str)
                    .unwrap_or("ok")
                    .to_string();
                *by_code.entry(key).or_default() += 1;
            }
            Err(_) => panics.push(format!("{} {text}", op.name())),
        }
    }
    println!("FUZZ cases={} outcomes={by_code:?}", SPEC.fuzz_cases);
    assert!(panics.is_empty(), "panics: {panics:?}");
    assert!(malformed.is_empty(), "malformed responses: {malformed:?}");
    // The fuzz must exercise both success and validation paths.
    assert!(
        by_code.get("ok").copied().unwrap_or(0) > 1_000,
        "{by_code:?}"
    );
    assert!(by_code.len() >= 20, "{by_code:?}");
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

#[test]
fn business_counts_over_the_full_range_meet_the_time_bound() {
    let bound = SPEC.full_range_bound;
    let customs = json!([
        { "id": "c-00000001", "name": "Zq Yearly", "kind": "yearly", "month": 6, "day": 15 },
        { "id": "c-00000002", "name": "Zq Leap", "kind": "yearly", "month": 2, "day": 29 },
        { "id": "c-00000003", "name": "Zq Once", "kind": "date", "date": "2000-01-03" }
    ]);
    let mut worst = Duration::ZERO;
    let mut timed = |label: String, op: Op, req: Value| -> Value {
        let start = Instant::now();
        let out = call(op, &req);
        let elapsed = start.elapsed();
        println!("TIMING {label} {elapsed:?}");
        worst = worst.max(elapsed);
        assert!(
            elapsed < bound,
            "{label} took {elapsed:?} (bound {bound:?})"
        );
        out
    };
    for preset in ["none", "us", "uk", "eg"] {
        for weekend in [
            json!([6, 7]),
            json!([5, 6]),
            json!([5]),
            json!([]),
            json!([1, 2, 3, 4, 5, 6]),
        ] {
            let calendar = json!({ "preset": preset, "weekend": weekend, "customHolidays": customs, "observedMode": "both" });
            let out = timed(
                format!("count {preset} {weekend}"),
                Op::CalcBusinessDays,
                json!({ "startDate": "0001-01-01", "endDate": "9999-12-31", "includeEndDay": true, "calendar": calendar }),
            );
            let r = &out["result"];
            assert_eq!(r["calendarDays"], 3_652_059, "{out}");
            assert_eq!(
                r["businessDays"].as_i64().unwrap()
                    + r["weekendDays"].as_i64().unwrap()
                    + r["holidayDays"].as_i64().unwrap(),
                3_652_059
            );
            assert!(r["holidays"].as_array().unwrap().len() <= 500);
            for (date, op) in [("0001-01-01", "add"), ("9999-12-31", "subtract")] {
                let out = timed(
                    format!("step {op} {preset} {weekend}"),
                    Op::CalcAddSubtract,
                    json!({ "date": date, "operation": op, "days": "2000000", "businessDays": true, "calendar": calendar }),
                );
                assert!(
                    out["ok"] == "true"
                        || out.pointer("/error/code") == Some(&json!("result_out_of_range")),
                    "{out}"
                );
            }
        }
        timed(
            format!("list {preset}"),
            Op::HolidaysInRange,
            json!({ "startDate": "0001-01-01", "endDate": "9999-12-31", "calendar": { "preset": preset, "customHolidays": customs } }),
        );
    }
    println!("TIMING worst={worst:?} bound={bound:?}");
}

// ---------------------------------------------------------------------------
// Metamorphic invariants
// ---------------------------------------------------------------------------

#[test]
fn seeded_metamorphic_invariants_disjoint_from_golden() {
    let mut rng = XorShift::new(META_SEED);
    let mut bench = Bench {
        rng: XorShift::new(META_SEED ^ 0xABCD),
    };
    for _ in 0..300 {
        // between(a, b) mirrors between(b, a).
        let (a, b) = (rng.day(), rng.day());
        let include = rng.coin();
        let f = call(
            Op::CalcDaysBetween,
            &json!({ "startDate": iso(a), "endDate": iso(b), "includeEndDay": include }),
        );
        let r = call(
            Op::CalcDaysBetween,
            &json!({ "startDate": iso(b), "endDate": iso(a), "includeEndDay": include }),
        );
        for key in ["totalDays", "years", "months", "days", "breakdownText"] {
            assert_eq!(f["result"][key], r["result"][key], "{key} {a} {b}");
        }
        if a != b {
            assert_eq!(
                f["result"]["signedDays"],
                -r["result"]["signedDays"].as_i64().unwrap()
            );
        }

        // Business counts are additive over adjacent half-open ranges.
        let mut days = [
            rng.range(ymd(1890, 1, 1), ymd(2210, 12, 31)),
            rng.range(ymd(1890, 1, 1), ymd(2210, 12, 31)),
            rng.range(ymd(1890, 1, 1), ymd(2210, 12, 31)),
        ];
        days.sort_unstable();
        let calendar = bench.calendar();
        let count = |x: EpochDay, y: EpochDay| {
            call(
                Op::CalcBusinessDays,
                &json!({ "startDate": iso(x), "endDate": iso(y), "calendar": calendar }),
            )["result"]["businessDays"]
                .as_i64()
                .expect("valid calendar")
        };
        assert_eq!(
            count(days[0], days[1]) + count(days[1], days[2]),
            count(days[0], days[2]),
            "{days:?} {calendar}"
        );

        // Weekday repeats every 7 days.
        let z = rng.range(MIN_EPOCH_DAY, MAX_EPOCH_DAY - 7);
        let w1 = call(Op::CalcDateInfo, &json!({ "date": iso(z) }));
        let w2 = call(Op::CalcDateInfo, &json!({ "date": iso(z + 7) }));
        assert_eq!(w1["result"]["weekday"], w2["result"]["weekday"]);

        // Adding then subtracting whole days is the identity.
        let n = rng.range(0, 100_000);
        let start = rng.range(MIN_EPOCH_DAY, MAX_EPOCH_DAY - n);
        let fwd = call(
            Op::CalcAddSubtract,
            &json!({ "date": iso(start), "operation": "add", "days": n.to_string() }),
        );
        let mid = fwd["result"]["resultDate"]
            .as_str()
            .expect("in range")
            .to_string();
        let back = call(
            Op::CalcAddSubtract,
            &json!({ "date": mid, "operation": "subtract", "days": n.to_string() }),
        );
        assert_eq!(back["result"]["resultDate"], json!(iso(start)));
    }
}

// ---------------------------------------------------------------------------
// Statistics anchors
// ---------------------------------------------------------------------------

#[test]
fn statistical_intervals_and_holm_bonferroni_match_exact_values() {
    assert_eq!(wilson_ci_95(0, 0), (0.0, 1.0));
    for total in [1, 2, 10, 100, 1000, 1050] {
        for passes in [0, total / 2, total] {
            let (low, high) = wilson_ci_95(passes, total);
            let rate = passes as f64 / total as f64;
            assert!(0.0 <= low && low <= high && high <= 1.0);
            assert!(low <= rate + 1e-15 && rate <= high + 1e-15);
        }
        assert!(wilson_ci_95(0, total).0.abs() < 1e-15);
        assert!((wilson_ci_95(total, total).1 - 1.0).abs() < 1e-15);
    }
    let (low, high) = wilson_ci_95(5, 10);
    assert!((low - 0.236_593_090_512_564).abs() < 1e-12);
    assert!((high - 0.763_406_909_487_436).abs() < 1e-12);

    let paired = PairedContingency {
        n11: 90,
        n10: 10,
        n01: 0,
        n00: 0,
    };
    let (nc_lo, nc_hi) = newcombe_paired_diff_ci_95(paired);
    let (wd_lo, wd_hi) = wald_paired_diff_ci_95(paired);
    assert!(-1.0 <= nc_lo && nc_lo <= paired.diff() && paired.diff() <= nc_hi && nc_hi <= 1.0);
    assert!(-1.0 <= wd_lo && wd_lo <= paired.diff() && paired.diff() <= wd_hi && wd_hi <= 1.0);
    // Exact two-sided McNemar: 2 * (0.5)^10 = 2 / 1024.
    assert!((mcnemar_exact_p(paired) - (2.0 / 1024.0)).abs() < 1e-12);
    assert_eq!(
        mcnemar_exact_p(PairedContingency {
            n11: 50,
            n10: 0,
            n01: 0,
            n00: 10
        }),
        1.0
    );

    let adj = holm_bonferroni_adjust(&[0.012, 0.01, 0.03]);
    assert!((adj[1] - 0.03).abs() < 1e-12);
    assert!((adj[0] - 0.03).abs() < 1e-12);
    assert!((adj[2] - 0.03).abs() < 1e-12);
}
