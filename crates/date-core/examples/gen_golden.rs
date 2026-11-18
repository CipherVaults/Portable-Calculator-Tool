//! Deterministic generator of `tests/fixtures/golden.json`, the regression
//! lock that the Rust engine and the mobile JS mirror both replay.
//!
//! ```text
//! cargo run -p date-core --example gen_golden -- --write   # regenerate
//! cargo run -p date-core --example gen_golden -- --check   # CI guard
//! ```
//!
//! `--check` regenerates the fixture in memory and exits non-zero on any
//! byte difference from the committed file. Regenerate only for an
//! intentional engine change (AGENTS.md); never to make a parity failure
//! pass.
//!
//! # Format
//!
//! LF only, one case per line so diffs stay reviewable, and valid JSON as a
//! whole:
//!
//! ```text
//! {"version":1,"generator":"gen_golden 1.0.0","engine":"1.0.0","seed":"0xDA7E2026","count":N,"cases":[
//! {"op":"calc_days_between","req":{...},"res":{"ok":"true","result":{...}}},
//! ...
//! ]}
//! ```
//!
//! - `op` is a FROZEN §2 function name, `req` its request object and `res`
//!   the exact bytes of the serialized `Outcome` envelope (key order is the
//!   Rust struct declaration order).
//! - `req` is written in canonical form (keys sorted recursively), so the
//!   bytes never depend on `serde_json`'s map implementation.
//! - No case produces `invalid_request`: that code is an IPC-boundary error
//!   and is not part of the parity contract (spec 1 §5.2).
//!
//! # Case mix
//!
//! A fixed-seed xorshift64 stream drives every choice. Dates are dense around
//! edges (0001-01-01, 9999-12-31, month ends, Feb 28/29, ISO week boundaries,
//! the 1900..=2199 holiday window), calendars cover every preset, weekend
//! shape, observed mode, Hijri offset/override, exclusion and custom-holiday
//! form, and a share of each op's cases is deliberately invalid so every
//! validation path is locked.
//!
//! After the random cases come deterministic full-year `holidays_in_range`
//! sweeps (build plan §9): US and UK for every year 1899..=2199 in the
//! `observed` and `both` modes, and Egypt for every year with the Hijri
//! offset cycling through -1/0/+1 (all three every tenth year).

use std::collections::BTreeMap;
use std::process::ExitCode;

use date_core::api::{self, Op};
use date_core::civil::{
    anniversary, civil_from_days, days_from_civil, days_in_month, is_leap_year, Civil, EpochDay,
    LeapDayRule, MAX_EPOCH_DAY, MIN_EPOCH_DAY,
};
use date_core::format::format_iso;
use date_core::holidays::preset_def;
use date_core::{ErrorCode, HijriEvent, HolidayPreset, ENGINE_VERSION};
use serde_json::{json, Map, Value};

/// Fixed PRNG seed (also printed in the fixture header).
const SEED: u64 = 0xDA7E_2026;
/// Generator id written to the header.
const GENERATOR: &str = "gen_golden 1.0.0";
/// Fixture path.
const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/golden.json");
/// Minimum number of cases (FROZEN §13).
const MIN_CASES: usize = 12_000;

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/// Marsaglia xorshift64 (13/7/17): tiny, deterministic and dependency-free.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// Uniform-ish in `0..n` (`n > 0`; modulo bias is irrelevant here).
    fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    /// Uniform-ish in `lo..=hi`.
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        let span = hi.abs_diff(lo) + 1;
        lo + (self.next_u64() % span) as i64
    }

    /// `true` with probability `pct` percent.
    fn chance(&mut self, pct: u64) -> bool {
        self.below(100) < pct
    }

    /// `true` with probability 1/2.
    fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }
}

// ---------------------------------------------------------------------------
// Value pools
// ---------------------------------------------------------------------------

/// Hand-picked edge dates.
const EDGE_DATES: &[(i64, u32, u32)] = &[
    (1, 1, 1),
    (1, 1, 2),
    (1, 1, 7),
    (1, 12, 31),
    (2, 1, 1),
    (4, 2, 29),
    (100, 2, 28),
    (100, 3, 1),
    (400, 2, 29),
    (1582, 10, 4),
    (1582, 10, 15),
    (1752, 9, 2),
    (1752, 9, 14),
    (1899, 12, 31),
    (1900, 1, 1),
    (1900, 2, 28),
    (1900, 3, 1),
    (1969, 12, 31),
    (1970, 1, 1),
    (1981, 7, 29),
    (1999, 12, 31),
    (2000, 1, 1),
    (2000, 2, 29),
    (2000, 12, 31),
    (2001, 1, 1),
    (2020, 12, 28),
    (2020, 12, 31),
    (2021, 1, 3),
    (2021, 1, 4),
    (2021, 12, 31),
    (2022, 1, 1),
    (2023, 1, 31),
    (2023, 2, 28),
    (2023, 3, 1),
    (2024, 1, 1),
    (2024, 1, 5),
    (2024, 1, 31),
    (2024, 2, 29),
    (2024, 3, 1),
    (2024, 12, 30),
    (2025, 1, 1),
    (2025, 3, 31),
    (2025, 4, 30),
    (2026, 11, 16),
    (2027, 12, 31),
    (2100, 2, 28),
    (2100, 3, 1),
    (2199, 12, 31),
    (2200, 1, 1),
    (9998, 12, 31),
    (9999, 1, 1),
    (9999, 2, 28),
    (9999, 12, 1),
    (9999, 12, 30),
    (9999, 12, 31),
];

/// Years worth visiting on purpose.
const EDGE_YEARS: &[i64] = &[
    1, 2, 4, 100, 400, 1582, 1600, 1700, 1752, 1800, 1899, 1900, 1901, 1970, 1981, 1995, 1999,
    2000, 2002, 2011, 2012, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2033, 2100, 2198, 2199,
    2200, 2400, 9998, 9999,
];

/// Date strings that fail validation (each with a distinct first error),
/// plus padded forms that are valid.
const ODD_DATES: &[&str] = &[
    "",
    "   ",
    "2023-02-29",
    "1900-02-29",
    "2100-02-29",
    "0000-01-01",
    "0000-13-45",
    "10000-01-01",
    "2024-13-01",
    "2024-00-10",
    "2024-01-00",
    "2024-01-32",
    "2024-04-31",
    "2024-06-31",
    "2024-1-05",
    "2024-01-5",
    "2024/01/05",
    "2024.01.05",
    "+02024-01-01",
    "-2024-01-01",
    "20240105",
    "\u{FF12}\u{FF10}\u{FF12}\u{FF14}-01-01",
    "\u{0662}\u{0660}\u{0662}\u{0664}-01-01",
    "2024-01-05T00:00",
    "2024-01-05 ",
    " 2024-02-29",
    "\t2024-02-29\n",
    "\r\n9999-12-31\r\n",
    "\u{FEFF}2024-01-05",
    "2024-01-05\u{00A0}",
    "abc",
    "null",
    "2024-02-3a",
];

/// Amount strings with interesting parse behaviour.
const ODD_AMOUNTS: &[&str] = &[
    "1.5",
    "1e3",
    "1,000",
    "+",
    "-",
    "--1",
    "+-1",
    "\u{0663}",
    "\u{FF13}",
    "0x10",
    "12a",
    " 7 ",
    "\t-3\n",
    "007",
    "-0",
    "+0",
    "000000000000001",
    "-000000000000000",
    "0000000000000001",
    "99999999999999999999",
    "1 000",
];

/// Time strings, valid and invalid.
const TIMES: &[&str] = &[
    "00:00", "00:00:00", "00:00:01", "12:00", "12:30:15", "23:59", "23:59:59", " 08:15 ", "24:00",
    "7:00", "12:60", "12:00:60", "12:00:0", "noon", "12-00", "1200",
];

/// UTC offsets in minutes (east-positive), valid and invalid.
const OFFSETS: &[i64] = &[
    0, 60, 120, 180, -300, -240, -420, 330, 345, 570, -570, 840, -720, 765, 1080, -1080, 1081,
    -1081, 99_999,
];

/// Weekend shapes (ISO weekdays).
const WEEKENDS: &[&[i64]] = &[
    &[6, 7],
    &[5, 6],
    &[5],
    &[7],
    &[],
    &[6],
    &[7, 6],
    &[1],
    &[4, 5],
    &[1, 2, 3, 4, 5, 6],
    &[2, 4, 6],
];

/// Custom holiday names (all valid).
const NAMES: &[&str] = &[
    "Founders' Day",
    "Company Offsite",
    "Plant Shutdown",
    "Inventory Day",
    "Team Day",
    "Fete nationale",
    "F\u{00EA}te nationale",
    "D\u{00ED}a del Trabajo",
    "\u{0639}\u{064A}\u{062F} \u{0627}\u{0644}\u{0634}\u{0631}\u{0643}\u{0629}",
    "\u{65E5}\u{672C}\u{306E}\u{795D}\u{65E5}",
    "<b>Bold</b> & \"quoted\"",
    "X",
    "Sixty characters exactly................................end",
];

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

fn ymd(y: i64, m: u32, d: u32) -> EpochDay {
    days_from_civil(Civil::new(y, m, d))
}

fn clamp_day(z: i64) -> EpochDay {
    z.clamp(MIN_EPOCH_DAY, MAX_EPOCH_DAY)
}

fn iso(z: EpochDay) -> String {
    format_iso(clamp_day(z))
}

struct Gen {
    rng: Rng,
    cases: Vec<(Op, Value)>,
}

impl Gen {
    fn push(&mut self, op: Op, req: Value) {
        self.cases.push((op, req));
    }

    fn year(&mut self) -> i64 {
        match self.rng.below(10) {
            0..=4 => self.rng.range(1900, 2199),
            5 | 6 => self.rng.range(1, 9999),
            _ => *self.rng.pick(EDGE_YEARS),
        }
    }

    fn month_end(&mut self) -> EpochDay {
        let y = self.year();
        let m = self.rng.range(1, 12) as u32;
        let dim = days_in_month(y, m);
        let d = dim - self.rng.below(2) as u32;
        ymd(y, m, d)
    }

    fn iso_boundary(&mut self) -> EpochDay {
        let y = self.year().clamp(2, 9998);
        ymd(y, 12, 28) + self.rng.range(0, 7)
    }

    fn leap_edge(&mut self) -> EpochDay {
        let mut y = self.year();
        if self.rng.chance(60) {
            while !is_leap_year(y) {
                y += 1;
            }
            if y > 9999 {
                y = 9996;
            }
        }
        ymd(y, 2, 28) + self.rng.range(0, 2)
    }

    /// A day number, dense around edges.
    fn day(&mut self) -> EpochDay {
        match self.rng.below(100) {
            0..=24 => {
                let &(y, m, d) = self.rng.pick(EDGE_DATES);
                ymd(y, m, d)
            }
            25..=37 => self.month_end(),
            38..=45 => self.iso_boundary(),
            46..=52 => self.leap_edge(),
            53..=79 => self.rng.range(ymd(1895, 1, 1), ymd(2205, 12, 31)),
            _ => self.rng.range(MIN_EPOCH_DAY, MAX_EPOCH_DAY),
        }
    }

    /// The ISO string of `z`, occasionally replaced by an odd (often
    /// invalid) string.
    fn date_str(&mut self, z: EpochDay, odd_pct: u64) -> String {
        if self.rng.chance(odd_pct) {
            (*self.rng.pick(ODD_DATES)).to_string()
        } else {
            iso(z)
        }
    }

    fn amount(&mut self, max: i64, typical: i64) -> String {
        let sign = *self.rng.pick(&["", "", "", "-", "+"]);
        match self.rng.below(100) {
            0..=9 => String::new(),
            10..=16 => "0".to_string(),
            17..=54 => format!("{sign}{}", self.rng.range(1, typical.min(max))),
            55..=74 => format!("{sign}{}", self.rng.range(1, (typical * 40).min(max))),
            75..=83 => format!("{sign}{}", self.rng.range(1, max)),
            84..=88 => {
                let v = *self.rng.pick(&[max, max + 1, max - 1]);
                format!("{sign}{v}")
            }
            _ => (*self.rng.pick(ODD_AMOUNTS)).to_string(),
        }
    }

    fn time(&mut self) -> String {
        if self.rng.chance(15) {
            (*self.rng.pick(TIMES)).to_string()
        } else if self.rng.chance(30) {
            format!("{:02}:{:02}", self.rng.range(0, 23), self.rng.range(0, 59))
        } else {
            format!(
                "{:02}:{:02}:{:02}",
                self.rng.range(0, 23),
                self.rng.range(0, 59),
                self.rng.range(0, 59)
            )
        }
    }

    fn offset(&mut self) -> i64 {
        if self.rng.chance(6) {
            *self.rng.pick(OFFSETS)
        } else {
            *self.rng.pick(&OFFSETS[..16])
        }
    }

    fn weekend(&mut self, preset: &str) -> Value {
        if preset == "eg" && self.rng.chance(60) {
            return json!([5, 6]);
        }
        if self.rng.chance(70) {
            return json!(self.rng.pick(WEEKENDS));
        }
        // Random subset in random order, never all seven days.
        let mut days: Vec<i64> = (1..=7).filter(|_| self.rng.chance(30)).collect();
        if days.len() == 7 {
            days.pop();
        }
        for i in (1..days.len()).rev() {
            let j = self.rng.below(i as u64 + 1) as usize;
            days.swap(i, j);
        }
        json!(days)
    }

    fn hijri_override(&mut self, seen: &mut Vec<(i64, HijriEvent)>) -> Option<Value> {
        let event = *self.rng.pick(&HijriEvent::ALL);
        let hy = self.rng.range(1318, 1625);
        if seen.contains(&(hy, event)) {
            return None;
        }
        seen.push((hy, event));
        let date = event.tabular_day(hy) + self.rng.range(-3, 3);
        Some(json!({ "hijriYear": hy, "event": event, "date": iso(date) }))
    }

    fn custom_id(&mut self) -> String {
        format!("c-{:08x}", self.rng.next_u64() as u32)
    }

    fn custom_holiday(&mut self, anchor_year: i64) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.custom_id()));
        m.insert("name".into(), json!(*self.rng.pick(NAMES)));
        let near = (anchor_year + self.rng.range(-1, 1)).clamp(1900, 2199);
        if self.rng.chance(45) {
            m.insert("kind".into(), json!("date"));
            let y = if self.rng.chance(70) {
                near
            } else {
                self.rng.range(1900, 2199)
            };
            let mo = self.rng.range(1, 12) as u32;
            let d = self.rng.range(1, i64::from(days_in_month(y, mo))) as u32;
            m.insert("date".into(), json!(iso(ymd(y, mo, d))));
        } else {
            m.insert("kind".into(), json!("yearly"));
            let mo = self.rng.range(1, 12);
            let max_day = i64::from(days_in_month(2000, mo as u32));
            let d = if mo == 2 && self.rng.chance(30) {
                29
            } else {
                self.rng.range(1, max_day)
            };
            m.insert("month".into(), json!(mo));
            m.insert("day".into(), json!(d));
            if self.rng.chance(30) {
                m.insert("fromYear".into(), json!(near));
            }
        }
        if self.rng.chance(20) {
            m.insert("enabled".into(), json!(self.rng.chance(50)));
        }
        Value::Object(m)
    }

    /// A random calendar. `preset` forces the preset when given; `bad_permille`
    /// is the chance (per 1000) of one deliberate validation error.
    fn calendar(
        &mut self,
        preset: Option<HolidayPreset>,
        anchor_year: i64,
        bad_permille: u64,
    ) -> Value {
        let mut m = Map::new();
        let preset = preset.unwrap_or_else(|| {
            *self.rng.pick(&[
                HolidayPreset::None,
                HolidayPreset::Us,
                HolidayPreset::Uk,
                HolidayPreset::Eg,
            ])
        });
        if preset != HolidayPreset::None || self.rng.chance(60) {
            m.insert("preset".into(), json!(preset));
        }
        if !self.rng.chance(12) {
            let w = self.weekend(preset.key());
            m.insert("weekend".into(), w);
        }
        if self.rng.chance(25) {
            m.insert(
                "observedMode".into(),
                json!(*self.rng.pick(&["observed", "actual", "both"])),
            );
        }
        let eg = preset == HolidayPreset::Eg;
        if (eg && self.rng.chance(40)) || self.rng.chance(4) {
            m.insert("hijriOffsetDays".into(), json!(self.rng.range(-2, 2)));
        }
        if (eg && self.rng.chance(15)) || self.rng.chance(3) {
            let mut seen = Vec::new();
            let n = self.rng.range(1, 3);
            let list: Vec<Value> = (0..n)
                .filter_map(|_| self.hijri_override(&mut seen))
                .collect();
            m.insert("hijriOverrides".into(), Value::Array(list));
        }
        if self.rng.chance(15) {
            let mut ex = Map::new();
            for p in [HolidayPreset::Us, HolidayPreset::Uk, HolidayPreset::Eg] {
                if p != preset && !self.rng.chance(15) {
                    continue;
                }
                let Some(def) = preset_def(p) else { continue };
                let ids: Vec<&str> = def.ids().collect();
                let n = self.rng.range(1, 3);
                let chosen: Vec<&str> = (0..n).map(|_| *self.rng.pick(&ids)).collect();
                ex.insert(p.key().into(), json!(chosen));
            }
            m.insert("excludedHolidays".into(), Value::Object(ex));
        }
        if self.rng.chance(22) {
            let n = self.rng.range(1, 4);
            let list: Vec<Value> = (0..n).map(|_| self.custom_holiday(anchor_year)).collect();
            m.insert("customHolidays".into(), Value::Array(list));
        }
        if self.rng.chance(5) {
            m.insert("schemaVersion".into(), json!(1));
        }
        if self.rng.below(1000) < bad_permille {
            self.corrupt(&mut m, anchor_year);
        }
        Value::Object(m)
    }

    /// Introduces exactly one calendar validation error (never a shape
    /// error: the request must still deserialize).
    fn corrupt(&mut self, m: &mut Map<String, Value>, anchor_year: i64) {
        let custom = |g: &mut Gen, edit: &dyn Fn(&mut Map<String, Value>)| {
            let mut h = g.custom_holiday(anchor_year);
            if let Value::Object(obj) = &mut h {
                edit(obj);
            }
            json!([h])
        };
        match self.rng.below(24) {
            0 => {
                m.insert("weekend".into(), json!([1, 2, 3, 4, 5, 6, 7]));
            }
            1 => {
                m.insert("weekend".into(), json!([7, 6, 5, 4, 3, 2, 1]));
            }
            2 => {
                m.insert("weekend".into(), json!([0, 6]));
            }
            3 => {
                m.insert("weekend".into(), json!([6, 6]));
            }
            4 => {
                m.insert("weekend".into(), json!([8]));
            }
            5 => {
                m.insert("schemaVersion".into(), json!(*self.rng.pick(&[0, 2, -1])));
            }
            6 => {
                m.insert(
                    "hijriOffsetDays".into(),
                    json!(*self.rng.pick(&[3, -3, 99])),
                );
            }
            7 => {
                let mut seen = Vec::new();
                let list: Vec<Value> = (0..200)
                    .filter_map(|_| self.hijri_override(&mut seen))
                    .take(51)
                    .collect();
                m.insert("hijriOverrides".into(), Value::Array(list));
            }
            8 => {
                let hy = *self.rng.pick(&[1316, 1627, 0]);
                m.insert(
                    "hijriOverrides".into(),
                    json!([{ "hijriYear": hy, "event": "eidAlFitr", "date": "2024-04-10" }]),
                );
            }
            9 => {
                let tab = HijriEvent::EidAlAdha.tabular_day(1445);
                let date = self
                    .rng
                    .pick(&[
                        iso(tab + 4),
                        iso(tab - 4),
                        "2024-02-30".to_string(),
                        format!(" {}", iso(tab)),
                    ])
                    .clone();
                m.insert(
                    "hijriOverrides".into(),
                    json!([{ "hijriYear": 1445, "event": "eidAlAdha", "date": date }]),
                );
            }
            10 => {
                let tab = HijriEvent::Mawlid.tabular_day(1450);
                m.insert(
                    "hijriOverrides".into(),
                    json!([
                        { "hijriYear": 1450, "event": "mawlid", "date": iso(tab) },
                        { "hijriYear": 1450, "event": "mawlid", "date": iso(tab + 1) }
                    ]),
                );
            }
            11 => {
                let key = *self.rng.pick(&["us", "uk", "eg"]);
                let id =
                    *self
                        .rng
                        .pick(&["notAHoliday", "__proto__", "constructor", "", "NewYear"]);
                let mut ex = Map::new();
                ex.insert(key.into(), json!([id]));
                m.insert("excludedHolidays".into(), Value::Object(ex));
            }
            12 => {
                let key = *self.rng.pick(&["us", "uk", "eg"]);
                let ids: Vec<&str> = std::iter::repeat_n("newYear", 60).collect();
                let mut ex = Map::new();
                ex.insert(key.into(), json!(ids));
                m.insert("excludedHolidays".into(), Value::Object(ex));
            }
            13 => {
                let list: Vec<Value> = (0..101).map(|_| self.custom_holiday(anchor_year)).collect();
                m.insert("customHolidays".into(), Value::Array(list));
            }
            14 => {
                let id =
                    *self
                        .rng
                        .pick(&["c-ABCDEF12", "x-12345678", "c-1234567", "c-123456789", ""]);
                let v = custom(self, &|h| {
                    h.insert("id".into(), json!(id));
                });
                m.insert("customHolidays".into(), v);
            }
            15 => {
                let name = *self.rng.pick(&[
                    "Sixty-one characters......................................end",
                    "",
                    " Leading space",
                    "Trailing space ",
                    "Bell\u{0007}",
                    "\u{202E}Reversed",
                    "Line\u{2028}Separator",
                    "Zero\u{200F}Width",
                ]);
                let v = custom(self, &|h| {
                    h.insert("name".into(), json!(name));
                });
                m.insert("customHolidays".into(), v);
            }
            16 => {
                let v = custom(self, &|h| {
                    h.insert("kind".into(), json!("date"));
                    h.insert("date".into(), json!("2024-05-01"));
                    h.insert("month".into(), json!(5));
                });
                m.insert("customHolidays".into(), v);
            }
            17 => {
                let date = *self.rng.pick(&[
                    "2024-02-30",
                    "1899-12-31",
                    "2200-01-01",
                    " 2024-01-01",
                    "2024-1-1",
                ]);
                let v = custom(self, &|h| {
                    h.remove("month");
                    h.remove("day");
                    h.remove("fromYear");
                    h.insert("kind".into(), json!("date"));
                    h.insert("date".into(), json!(date));
                });
                m.insert("customHolidays".into(), v);
            }
            18 => {
                let (mo, d) = *self.rng.pick(&[(13, 1), (0, 1), (2, 30), (4, 31), (1, 0)]);
                let v = custom(self, &|h| {
                    h.remove("date");
                    h.insert("kind".into(), json!("yearly"));
                    h.insert("month".into(), json!(mo));
                    h.insert("day".into(), json!(d));
                });
                m.insert("customHolidays".into(), v);
            }
            19 => {
                let fy = *self.rng.pick(&[1899, 2200, 0]);
                let v = custom(self, &|h| {
                    h.remove("date");
                    h.insert("kind".into(), json!("yearly"));
                    h.insert("month".into(), json!(6));
                    h.insert("day".into(), json!(1));
                    h.insert("fromYear".into(), json!(fy));
                });
                m.insert("customHolidays".into(), v);
            }
            20 => {
                let v = custom(self, &|h| {
                    h.remove("month");
                    h.remove("day");
                    h.remove("fromYear");
                    h.insert("kind".into(), json!("yearly"));
                    h.insert("date".into(), json!("2024-05-01"));
                });
                m.insert("customHolidays".into(), v);
            }
            21 => {
                let a = self.custom_holiday(anchor_year);
                let mut b = self.custom_holiday(anchor_year);
                if let (Some(id), Value::Object(obj)) = (a.get("id").cloned(), &mut b) {
                    obj.insert("id".into(), id);
                }
                m.insert("customHolidays".into(), json!([a, b]));
            }
            22 => {
                let v = custom(self, &|h| {
                    h.remove("month");
                    h.remove("date");
                    h.insert("kind".into(), json!("yearly"));
                    h.insert("day".into(), json!(1));
                });
                m.insert("customHolidays".into(), v);
            }
            _ => {
                m.insert("weekend".into(), json!([-1]));
            }
        }
    }

    // -- per-op generators --------------------------------------------------

    fn days_between(&mut self) {
        let a = self.day();
        let b = match self.rng.below(10) {
            0..=2 => a + self.rng.range(-800, 800),
            3 => a,
            4 => {
                anniversary(a, self.rng.range(-60, 60), LeapDayRule::Feb28) + self.rng.range(-2, 2)
            }
            5..=7 => self.day(),
            8 => *self.rng.pick(&[MIN_EPOCH_DAY, MAX_EPOCH_DAY]),
            _ => a + self.rng.range(-3_652_058, 3_652_058),
        };
        let mut m = Map::new();
        m.insert("startDate".into(), json!(self.date_str(a, 4)));
        m.insert("endDate".into(), json!(self.date_str(clamp_day(b), 4)));
        if !self.rng.chance(30) {
            m.insert("includeEndDay".into(), json!(self.rng.coin()));
        }
        self.push(Op::CalcDaysBetween, Value::Object(m));
    }

    fn add_subtract(&mut self) {
        let z = self.day();
        let business = self.rng.chance(40);
        let mut m = Map::new();
        m.insert("date".into(), json!(self.date_str(z, 3)));
        m.insert(
            "operation".into(),
            json!(if self.rng.coin() { "add" } else { "subtract" }),
        );
        let (py, pm, pw, pd) = if business {
            (12, 15, 35, 75)
        } else {
            (30, 40, 25, 55)
        };
        let fields = [
            ("years", py, 9_999, 20),
            ("months", pm, 119_988, 30),
            ("weeks", pw, 521_722, 12),
            ("days", pd, 3_652_058, 60),
        ];
        for (key, pct, max, typical) in fields {
            if self.rng.chance(pct) {
                let v = self.amount(max, typical);
                m.insert(key.into(), json!(v));
            } else if self.rng.chance(10) {
                m.insert(key.into(), json!(""));
            }
        }
        if business {
            m.insert("businessDays".into(), json!(true));
            let y = civil_from_days(z).year;
            let cal = self.calendar(None, y, 30);
            m.insert("calendar".into(), cal);
        } else {
            if self.rng.chance(40) {
                m.insert("businessDays".into(), json!(false));
            }
            if self.rng.chance(15) {
                let cal = self.calendar(None, 2024, 100);
                m.insert("calendar".into(), cal);
            }
        }
        self.push(Op::CalcAddSubtract, Value::Object(m));
    }

    fn business_days(&mut self) {
        let a = if self.rng.chance(60) {
            self.rng.range(ymd(1895, 1, 1), ymd(2205, 12, 31))
        } else {
            self.day()
        };
        let span = match self.rng.below(100) {
            0..=49 => self.rng.range(0, 120),
            50..=76 => self.rng.range(0, 1_500),
            77..=89 => self.rng.range(0, 60 * 366),
            90..=94 => self.rng.range(0, 300 * 366),
            95..=96 => MAX_EPOCH_DAY - MIN_EPOCH_DAY,
            _ => 0,
        };
        // Long spans list up to 500 holidays each; keep most of them
        // preset-free so the fixture stays reviewable in size.
        let preset = (span > 1_500 && !self.rng.chance(12)).then_some(HolidayPreset::None);
        let (mut lo, mut hi) = (a, clamp_day(a + span));
        if span == MAX_EPOCH_DAY - MIN_EPOCH_DAY {
            (lo, hi) = (MIN_EPOCH_DAY, MAX_EPOCH_DAY);
        } else if self.rng.chance(4) {
            // Straddle a holiday-window edge.
            let edge = *self.rng.pick(&[ymd(1900, 1, 1), ymd(2200, 1, 1)]);
            lo = edge - self.rng.range(1, 400);
            hi = edge + self.rng.range(0, 400);
        }
        if self.rng.chance(30) {
            std::mem::swap(&mut lo, &mut hi);
        }
        let mut m = Map::new();
        m.insert("startDate".into(), json!(self.date_str(lo, 3)));
        m.insert("endDate".into(), json!(self.date_str(hi, 3)));
        if !self.rng.chance(25) {
            m.insert("includeEndDay".into(), json!(self.rng.coin()));
        }
        if !self.rng.chance(8) {
            let y = civil_from_days(lo.min(hi)).year;
            let cal = self.calendar(preset, y, 25);
            m.insert("calendar".into(), cal);
        }
        self.push(Op::CalcBusinessDays, Value::Object(m));
    }

    fn age(&mut self) {
        let birth = match self.rng.below(100) {
            0..=24 => {
                let mut y = self.year();
                while !is_leap_year(y) {
                    y += 1;
                }
                ymd(y.min(9996), 2, 29)
            }
            25..=39 => self.month_end(),
            _ => self.day(),
        };
        let rule = if self.rng.coin() {
            LeapDayRule::Feb28
        } else {
            LeapDayRule::Mar1
        };
        let as_of = match self.rng.below(100) {
            0..=29 => anniversary(birth, 12 * self.rng.range(0, 120), rule) + self.rng.range(-2, 2),
            30..=49 => {
                let y = (civil_from_days(birth).year + self.rng.range(0, 90)).min(9999);
                ymd(y, 2, 28) + self.rng.range(0, 2)
            }
            50..=84 => birth + self.rng.range(0, 120 * 366),
            85..=89 => birth - self.rng.range(1, 400),
            90..=94 => MAX_EPOCH_DAY - self.rng.range(0, 400),
            _ => birth,
        };
        let mut m = Map::new();
        m.insert("birthDate".into(), json!(self.date_str(birth, 3)));
        m.insert("asOfDate".into(), json!(self.date_str(clamp_day(as_of), 3)));
        match self.rng.below(3) {
            0 => {}
            _ => {
                m.insert("leapDayRule".into(), json!(rule));
            }
        }
        self.push(Op::CalcAge, Value::Object(m));
    }

    fn date_info(&mut self) {
        let z = if self.rng.coin() {
            self.iso_boundary()
        } else {
            self.day()
        };
        let mut m = Map::new();
        m.insert("date".into(), json!(self.date_str(z, 4)));
        match self.rng.below(100) {
            0..=29 => {}
            30..=39 => {
                m.insert("today".into(), Value::Null);
            }
            40..=54 => {
                m.insert("today".into(), json!(iso(z)));
            }
            55..=96 => {
                let t = if self.rng.coin() {
                    z + self.rng.range(-1_000, 1_000)
                } else {
                    self.day()
                };
                m.insert("today".into(), json!(iso(t)));
            }
            _ => {
                let s = *self.rng.pick(ODD_DATES);
                m.insert("today".into(), json!(s));
            }
        }
        self.push(Op::CalcDateInfo, Value::Object(m));
    }

    fn moment(&mut self, date: String, time: Option<String>, offset: Option<i64>) -> Value {
        let mut m = Map::new();
        m.insert("date".into(), json!(date));
        if let Some(t) = time {
            m.insert("time".into(), json!(t));
        }
        if let Some(o) = offset {
            m.insert("utcOffsetMinutes".into(), json!(o));
        }
        Value::Object(m)
    }

    fn countdown(&mut self) {
        let now_day = if self.rng.chance(70) {
            self.rng.range(ymd(1970, 1, 1), ymd(2100, 12, 31))
        } else {
            self.day()
        };
        let now_time = if self.rng.chance(4) {
            String::new()
        } else {
            self.time()
        };
        let now_off = if self.rng.chance(30) {
            None
        } else {
            Some(self.offset())
        };
        let now_date = self.date_str(now_day, 2);
        let exact = self.rng.chance(5);
        let (tgt_date, tgt_time, tgt_off) = if exact {
            (now_date.clone(), Some(now_time.clone()), now_off)
        } else {
            let td = match self.rng.below(100) {
                0..=39 => now_day,
                40..=69 => now_day + self.rng.range(-400, 400),
                70..=84 => now_day + self.rng.range(-40 * 366, 40 * 366),
                85..=94 => self.day(),
                _ => *self.rng.pick(&[MIN_EPOCH_DAY, MAX_EPOCH_DAY]),
            };
            let tt = match self.rng.below(100) {
                0..=24 => Some(String::new()),
                25..=34 => None,
                _ => Some(self.time()),
            };
            let to = if self.rng.chance(30) {
                None
            } else {
                Some(self.offset())
            };
            (self.date_str(clamp_day(td), 2), tt, to)
        };
        let now = self.moment(now_date, Some(now_time), now_off);
        let target = self.moment(tgt_date, tgt_time, tgt_off);
        self.push(Op::CalcCountdown, json!({ "now": now, "target": target }));
    }

    fn holidays_in_range(&mut self) {
        let preset = *self.rng.pick(&[
            HolidayPreset::Us,
            HolidayPreset::Us,
            HolidayPreset::Uk,
            HolidayPreset::Uk,
            HolidayPreset::Eg,
            HolidayPreset::Eg,
            HolidayPreset::None,
        ]);
        let year = if self.rng.chance(85) {
            if self.rng.chance(10) {
                *self.rng.pick(&[1899, 1900, 1901, 2198, 2199, 2200])
            } else {
                self.rng.range(1900, 2199)
            }
        } else {
            self.year()
        };
        let (mut lo, mut hi) = match self.rng.below(100) {
            0..=44 => (ymd(year, 1, 1), ymd(year, 12, 31)),
            45..=69 => {
                let mo = self.rng.range(1, 12) as u32;
                (ymd(year, mo, 1), ymd(year, mo, days_in_month(year, mo)))
            }
            70..=86 => {
                let a = ymd(year, 1, 1) + self.rng.range(0, 364);
                (a, a + self.rng.range(0, 120))
            }
            87..=98 => (
                ymd(year, 1, 1),
                ymd((year + self.rng.range(1, 2)).min(9999), 12, 31),
            ),
            // Long ranges reach the 1,000-instance listing cap; keep them rare.
            _ if !self.rng.chance(30) => (ymd(year, 1, 1), ymd(year, 1, 1)),
            _ => {
                let a = ymd(1900, 1, 1) + self.rng.range(-800, 30 * 366);
                (a, a + self.rng.range(30 * 366, 120 * 366))
            }
        };
        hi = clamp_day(hi);
        lo = clamp_day(lo);
        if self.rng.chance(15) {
            std::mem::swap(&mut lo, &mut hi);
        }
        let mut m = Map::new();
        m.insert("startDate".into(), json!(self.date_str(lo, 2)));
        m.insert("endDate".into(), json!(self.date_str(hi, 2)));
        let cal = self.calendar(Some(preset), year, 20);
        m.insert("calendar".into(), cal);
        self.push(Op::HolidaysInRange, Value::Object(m));
    }

    fn month_grid(&mut self) {
        let (year, month) = match self.rng.below(100) {
            0..=3 => (*self.rng.pick(&[1, 9999]), *self.rng.pick(&[1, 12])),
            4 => (
                *self.rng.pick(&[0, 10_000, -1, 99_999]),
                self.rng.range(1, 12),
            ),
            5 => (self.year(), *self.rng.pick(&[0, 13, -1])),
            6..=60 => (self.rng.range(1900, 2199), self.rng.range(1, 12)),
            _ => (self.year(), self.rng.range(1, 12)),
        };
        let mut m = Map::new();
        m.insert("year".into(), json!(year));
        m.insert("month".into(), json!(month));
        if !self.rng.chance(40) {
            m.insert(
                "firstDayOfWeek".into(),
                json!(if self.rng.coin() { "monday" } else { "sunday" }),
            );
        }
        let base = if (1..=9999).contains(&year) && (1..=12).contains(&month) {
            ymd(year, month as u32, 1)
        } else {
            ymd(2024, 1, 1)
        };
        if self.rng.chance(40) {
            let t = base + self.rng.range(-10, 40);
            let s = self.date_str(clamp_day(t), 3);
            m.insert("today".into(), json!(s));
        }
        if self.rng.chance(45) {
            let a = clamp_day(base + self.rng.range(-40, 40));
            let b = clamp_day(a + self.rng.range(-60, 60));
            if self.rng.chance(85) {
                m.insert("rangeStart".into(), json!(self.date_str(a, 3)));
            }
            if self.rng.chance(85) {
                m.insert("rangeEnd".into(), json!(self.date_str(b, 3)));
            }
        }
        if !self.rng.chance(15) {
            let cal = self.calendar(None, year.clamp(1, 9999), 25);
            m.insert("calendar".into(), cal);
        }
        self.push(Op::MonthGrid, Value::Object(m));
    }

    fn validate_calendar(&mut self) {
        let req = match self.rng.below(100) {
            0..=1 => json!({}),
            2..=3 => json!({ "calendar": {} }),
            _ => {
                let y = self.rng.range(1900, 2199);
                json!({ "calendar": self.calendar(None, y, 450) })
            }
        };
        self.push(Op::ValidateCalendar, req);
    }

    /// Deterministic full-year listings (build plan §9), independent of the
    /// PRNG: random sampling leaves some years uncovered, and a mirror bug in
    /// an observed-date rule can hide in exactly one year.
    ///
    /// - US and UK: every year in [`SWEEP_FIRST_YEAR`]..=[`SWEEP_LAST_YEAR`],
    ///   once in the default `observed` mode and once in `both` (which also
    ///   lists the actual date of every shifted holiday).
    /// - Egypt: every year once, with `hijriOffsetDays` cycling -1/0/+1 by
    ///   year, and every tenth year with all three offsets.
    fn year_sweeps(&mut self) {
        let span = |y: i64| {
            json!({
                "startDate": iso(ymd(y, 1, 1)),
                "endDate": iso(ymd(y, 12, 31)),
            })
        };
        for preset in ["us", "uk"] {
            for y in SWEEP_FIRST_YEAR..=SWEEP_LAST_YEAR {
                for mode in [None, Some("both")] {
                    let mut req = span(y);
                    let mut cal = json!({ "preset": preset });
                    if let Some(mode) = mode {
                        cal["observedMode"] = json!(mode);
                    }
                    req["calendar"] = cal;
                    self.push(Op::HolidaysInRange, req);
                }
            }
        }
        for y in SWEEP_FIRST_YEAR..=SWEEP_LAST_YEAR {
            let cycled = y.rem_euclid(3) - 1;
            let offsets: &[i64] = if y % 10 == 0 {
                &[-1, 0, 1]
            } else {
                std::slice::from_ref(&cycled)
            };
            for &offset in offsets {
                let mut req = span(y);
                req["calendar"] = json!({ "preset": "eg", "hijriOffsetDays": offset });
                self.push(Op::HolidaysInRange, req);
            }
        }
    }
}

/// First year of the deterministic holiday sweeps (one before the preset
/// window, to lock the `presetYearOutOfRange` path).
const SWEEP_FIRST_YEAR: i64 = 1899;
/// Last year of the deterministic holiday sweeps (the end of the window).
const SWEEP_LAST_YEAR: i64 = 2199;

/// Builds every case, in a fixed order.
fn build_cases() -> Vec<(Op, Value)> {
    let mut g = Gen {
        rng: Rng::new(SEED),
        cases: Vec::new(),
    };
    let plan: [(Op, usize); 9] = [
        (Op::CalcDaysBetween, 2_100),
        (Op::CalcAddSubtract, 2_600),
        (Op::CalcBusinessDays, 2_200),
        (Op::CalcAge, 1_000),
        (Op::CalcDateInfo, 1_500),
        (Op::CalcCountdown, 1_100),
        (Op::HolidaysInRange, 700),
        (Op::MonthGrid, 400),
        (Op::ValidateCalendar, 800),
    ];
    for (op, n) in plan {
        for _ in 0..n {
            match op {
                Op::CalcDaysBetween => g.days_between(),
                Op::CalcAddSubtract => g.add_subtract(),
                Op::CalcBusinessDays => g.business_days(),
                Op::CalcAge => g.age(),
                Op::CalcDateInfo => g.date_info(),
                Op::CalcCountdown => g.countdown(),
                Op::HolidaysInRange => g.holidays_in_range(),
                Op::MonthGrid => g.month_grid(),
                Op::ValidateCalendar => g.validate_calendar(),
            }
        }
    }
    g.year_sweeps();
    g.cases
}

/// Writes `v` as compact JSON with object keys sorted recursively (byte
/// order, which equals UTF-16 order for the ASCII keys used here).
fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(k.clone()).to_string());
                out.push(':');
                write_canonical(&map[k], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// Statistics printed to stderr.
#[derive(Default)]
struct Stats {
    per_op: BTreeMap<&'static str, (usize, usize)>,
    codes: BTreeMap<&'static str, usize>,
}

/// Renders the fixture, or explains why the case set is unacceptable.
fn render(cases: &[(Op, Value)], stats: &mut Stats) -> Result<String, String> {
    if cases.len() < MIN_CASES {
        return Err(format!("only {} cases (need {MIN_CASES})", cases.len()));
    }
    let mut out = format!(
        "{{\"version\":1,\"generator\":\"{GENERATOR}\",\"engine\":\"{ENGINE_VERSION}\",\"seed\":\"0x{SEED:X}\",\"count\":{},\"cases\":[\n",
        cases.len()
    );
    for (i, (op, req)) in cases.iter().enumerate() {
        let response = api::call(*op, req);
        let entry = stats.per_op.entry(op.name()).or_default();
        match response.error() {
            None => entry.0 += 1,
            Some(e) if e.code == ErrorCode::InvalidRequest => {
                let mut r = String::new();
                write_canonical(req, &mut r);
                return Err(format!("case #{i} ({}) is invalid_request: {r}", op.name()));
            }
            Some(e) => {
                entry.1 += 1;
                *stats.codes.entry(e.code.as_str()).or_default() += 1;
            }
        }
        let res = serde_json::to_string(&response).map_err(|e| e.to_string())?;
        out.push_str("{\"op\":\"");
        out.push_str(op.name());
        out.push_str("\",\"req\":");
        write_canonical(req, &mut out);
        out.push_str(",\"res\":");
        out.push_str(&res);
        out.push('}');
        if i + 1 < cases.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("]}\n");
    Ok(out)
}

fn main() -> ExitCode {
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode != "--write" && mode != "--check" {
        eprintln!("usage: gen_golden --write | --check");
        return ExitCode::from(2);
    }
    let cases = build_cases();
    let mut stats = Stats::default();
    let text = match render(&cases, &mut stats) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("gen_golden: {e}");
            return ExitCode::FAILURE;
        }
    };
    for (op, (ok, err)) in &stats.per_op {
        eprintln!("{op:<20} ok={ok:<6} err={err}");
    }
    for (code, n) in &stats.codes {
        eprintln!("  {code:<26} {n}");
    }
    eprintln!("cases={} bytes={}", cases.len(), text.len());

    if mode == "--write" {
        if let Err(e) = std::fs::write(FIXTURE, text.as_bytes()) {
            eprintln!("gen_golden: cannot write {FIXTURE}: {e}");
            return ExitCode::FAILURE;
        }
        eprintln!("wrote {FIXTURE}");
        return ExitCode::SUCCESS;
    }

    let current = match std::fs::read(FIXTURE) {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("gen_golden --check: cannot read {FIXTURE}: {e}");
            return ExitCode::FAILURE;
        }
    };
    if current == text.as_bytes() {
        eprintln!("golden.json is up to date");
        return ExitCode::SUCCESS;
    }
    let current = String::from_utf8_lossy(&current);
    let line = current
        .split('\n')
        .zip(text.split('\n'))
        .position(|(a, b)| a != b)
        .unwrap_or_else(|| current.split('\n').count().min(text.split('\n').count()));
    let show = |s: &str| -> String {
        let l = s.split('\n').nth(line).unwrap_or("<missing>");
        l.chars().take(300).collect()
    };
    eprintln!(
        "golden.json differs from the generator output (first difference on line {}):\n  file:      {}\n  generator: {}",
        line + 1,
        show(&current),
        show(&text)
    );
    ExitCode::FAILURE
}
