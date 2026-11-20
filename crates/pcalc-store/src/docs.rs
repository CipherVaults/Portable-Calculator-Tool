//! The durable document store (plan B10, B11): `settings`, `state`,
//! `history` and `countdowns` as hardened JSON files in the app data folder
//! (`%APPDATA%\com.portablecalculator.tool\<name>.json` on Windows).
//!
//! Every load decides through `pcalc_api::store::check`, the
//! `<name>.validate` op on the raw bytes, and follows B10's table:
//!
//! | Load outcome | Status | Handling |
//! |---|---|---|
//! | the file does not exist | `empty` | writable |
//! | any other read error (a symlink, a directory, no permission, a lock) | `unreadable` | read-only, untouched |
//! | over the op's cap (`request_too_large`) | `tooLarge` | read-only, untouched (never "corrupt") |
//! | a newer `schemaVersion` | `newer` | read-only, untouched, no backup |
//! | not valid | `corrupt` | a timestamped backup first, then read-only |
//! | valid | `ok` | writable; the canonical document is returned |
//!
//! Read-only documents refuse [`DocStore::save`] with `read_only`. They
//! leave read-only only through a successful reload ([`DocStore::load`],
//! "Retry") or an explicit [`DocStore::clear`] ("Start fresh", confirmed by
//! the UI), which backs the old file up (and reads the backup back) before
//! removing it; a newer document is never cleared. A save of a
//! document this process has not loaded yet loads it first, so a save can
//! never overwrite a file nobody has looked at (corrupt, newer or
//! unreadable).
//!
//! Backups are `<name>.<yyyymmdd-hhmmss>[-n].bak` (UTC), newest 3 kept per
//! document; a backup identical to a kept one is not written again, so
//! reloading the same corrupt file does not rotate good backups away, and the
//! backup just written is never the one pruned (the clock may have been set
//! back).
//!
//! [`DocStore::save_if`] is the compare-and-save every history write uses
//! (plan B10, M3): it writes only while the stored document is still the
//! one the caller read, so two windows recording at once never overwrite
//! each other (the loser gets `conflict`, reads again and re-applies its
//! operation). Saves, compare-and-saves and clears are serialised by one
//! write lock in the process and, for a store in a directory, by an
//! exclusive lock on `docs.lock` across processes (two desktop instances
//! started side by side never write over each other's history entries).
//! [`DocStore::clear`] removes only a document that is not valid now: one
//! that validates again is refused as `recovered`, so "Start fresh" after a
//! passing read error never wipes a good history.
//!
//! [`DocStore::memory`] keeps everything in memory (the `--smoke-test` run
//! never touches the real app data).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use pcalc_api::store::{check, Checked, Doc};
use serde::Serialize;

use crate::fs::{read_regular_file_limited, write_atomic_private};

/// The cross-process lock file in a store directory.
pub const LOCK_FILE: &str = "docs.lock";

/// Holds the cross-process store lock (released when dropped: the handle
/// closes). `None` for the memory store, or when the file system offers no
/// lock (the in-process write lock still applies).
struct DirLock(#[allow(dead_code)] Option<std::fs::File>);

/// Backups kept per document.
pub const BACKUPS_KEPT: usize = 3;

/// Largest document written, in bytes (B10: history 4 MiB; B11: settings
/// 64 KiB). Reading allows up to the validator's cap.
pub const fn write_cap(doc: Doc) -> usize {
    match doc {
        Doc::Settings | Doc::Countdowns => 64 * 1024,
        Doc::State => pcalc_api::CAP_STORE,
        Doc::History => 4 * 1024 * 1024,
    }
}

/// Largest file read, in bytes: the `<name>.validate` op's cap.
pub fn read_cap(doc: Doc) -> usize {
    pcalc_api::Op::Validate(doc).request_cap()
}

/// What a load found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// No file: empty and writable.
    Empty,
    /// Valid and writable.
    Ok,
    /// Written by a newer app: read-only.
    Newer,
    /// Not valid: backed up, then read-only.
    Corrupt,
    /// Could not be read safely: read-only.
    Unreadable,
    /// Over the validator's cap: read-only.
    TooLarge,
}

/// The answer of [`DocStore::load`] (the `store_load` command's JSON).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOutcome {
    /// The document name.
    pub name: &'static str,
    /// What was found.
    pub status: Status,
    /// Whether saves are refused until a successful reload or a clear.
    pub read_only: bool,
    /// The canonical document JSON when `status` is `ok`.
    pub doc: Option<String>,
    /// The stored `schemaVersion` when `status` is `newer`.
    pub schema_version: Option<u64>,
    /// The backup file written by this load, if any.
    pub backup: Option<String>,
    /// The JSON path at fault when `status` is `corrupt`.
    pub field: Option<String>,
}

/// Why a save or clear was refused (`{"code": …}` on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StoreError {
    /// Not one of the four document names.
    UnknownDoc,
    /// The document is read-only (see the load table).
    ReadOnly,
    /// The text is not a valid current document.
    Invalid,
    /// The canonical document is over [`write_cap`].
    TooLarge,
    /// The file system refused the write.
    WriteFailed,
    /// [`DocStore::save_if`]: the stored document changed since it was read.
    Conflict,
    /// [`DocStore::clear`]: the stored document is valid again (a read
    /// error passed, another window repaired it), so nothing is removed;
    /// the caller reloads it ("Retry") instead.
    Recovered,
}

impl StoreError {
    /// The wire code.
    pub fn code(self) -> &'static str {
        match self {
            StoreError::UnknownDoc => "unknown_doc",
            StoreError::ReadOnly => "read_only",
            StoreError::Invalid => "invalid",
            StoreError::TooLarge => "too_large",
            StoreError::WriteFailed => "write_failed",
            StoreError::Conflict => "conflict",
            StoreError::Recovered => "recovered",
        }
    }
}

/// What a raw read found (backend-independent).
enum Raw {
    Missing,
    Bytes(Vec<u8>),
    TooLarge,
    Unreadable,
}

/// Where documents live.
enum Backend {
    Dir(PathBuf),
    Memory(Mutex<MemoryFiles>),
}

#[derive(Default)]
struct MemoryFiles {
    files: HashMap<String, Vec<u8>>,
}

/// The document store. One per process; every method is thread-safe.
pub struct DocStore {
    backend: Backend,
    read_only: Mutex<HashMap<&'static str, Status>>,
    loaded: Mutex<HashSet<&'static str>>,
    writes: Mutex<()>,
    clock: fn() -> u64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `yyyymmdd-hhmmss` (UTC) for `secs` since the Unix epoch.
pub fn stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's civil_from_days.
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
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Parses `<name>.<yyyymmdd-hhmmss>[-n].bak` into its sort key.
fn backup_key(name: &str, file: &str) -> Option<(String, u32)> {
    let rest = file
        .strip_prefix(name)?
        .strip_prefix('.')?
        .strip_suffix(".bak")?;
    let (ts, seq) = match rest.split_once('-') {
        Some((date, tail)) => match tail.split_once('-') {
            Some((time, n)) => (format!("{date}-{time}"), n.parse::<u32>().ok()?),
            None => (format!("{date}-{tail}"), 0),
        },
        None => return None,
    };
    let b = ts.as_bytes();
    let shape = b.len() == 15
        && b.iter().enumerate().all(|(i, c)| {
            if i == 8 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    shape.then_some((ts, seq))
}

impl DocStore {
    /// A store in `dir` (created on the first write, private on Unix).
    pub fn in_dir(dir: impl Into<PathBuf>) -> Self {
        DocStore {
            backend: Backend::Dir(dir.into()),
            read_only: Mutex::new(HashMap::new()),
            loaded: Mutex::new(HashSet::new()),
            writes: Mutex::new(()),
            clock: now_secs,
        }
    }

    /// A store that never touches the disk (smoke tests).
    pub fn memory() -> Self {
        DocStore {
            backend: Backend::Memory(Mutex::new(MemoryFiles::default())),
            read_only: Mutex::new(HashMap::new()),
            loaded: Mutex::new(HashSet::new()),
            writes: Mutex::new(()),
            clock: now_secs,
        }
    }

    /// Whether this is the in-memory store.
    pub fn is_memory(&self) -> bool {
        matches!(self.backend, Backend::Memory(_))
    }

    #[cfg(test)]
    fn with_clock(mut self, clock: fn() -> u64) -> Self {
        self.clock = clock;
        self
    }

    /// Takes the cross-process lock of a store directory (blocking until
    /// another process releases it).
    fn dir_lock(&self) -> DirLock {
        let Backend::Dir(dir) = &self.backend else {
            return DirLock(None);
        };
        if crate::fs::ensure_private_parent_dir(dir).is_err() {
            return DirLock(None);
        }
        let path = dir.join(LOCK_FILE);
        // Never follow a symlink planted in place of the lock file.
        if std::fs::symlink_metadata(&path).is_ok_and(|m| !m.file_type().is_file()) {
            return DirLock(None);
        }
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
        {
            Ok(file) => match file.lock() {
                Ok(()) => DirLock(Some(file)),
                Err(_) => DirLock(None),
            },
            Err(_) => DirLock(None),
        }
    }

    fn file_name(doc: Doc) -> String {
        format!("{}.json", doc.name())
    }

    fn read_raw(&self, doc: Doc) -> Raw {
        let cap = read_cap(doc);
        match &self.backend {
            Backend::Memory(m) => match m.lock() {
                Ok(m) => match m.files.get(&Self::file_name(doc)) {
                    None => Raw::Missing,
                    Some(b) if b.len() > cap => Raw::TooLarge,
                    Some(b) => Raw::Bytes(b.clone()),
                },
                Err(_) => Raw::Unreadable,
            },
            Backend::Dir(dir) => {
                let path = dir.join(Self::file_name(doc));
                match std::fs::symlink_metadata(&path) {
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => Raw::Missing,
                    Err(_) => Raw::Unreadable,
                    Ok(meta) if meta.file_type().is_file() && meta.len() > cap as u64 => {
                        Raw::TooLarge
                    }
                    Ok(_) => match read_regular_file_limited(&path, cap, doc.name()) {
                        Ok(bytes) => Raw::Bytes(bytes),
                        Err(_) => Raw::Unreadable,
                    },
                }
            }
        }
    }

    fn set_read_only(&self, doc: Doc, status: Option<Status>) {
        if let Ok(mut seen) = self.loaded.lock() {
            seen.insert(doc.name());
        }
        if let Ok(mut map) = self.read_only.lock() {
            match status {
                Some(s) => {
                    map.insert(doc.name(), s);
                }
                None => {
                    map.remove(doc.name());
                }
            }
        }
    }

    /// Whether `doc` has been loaded (or cleared) by this process.
    fn was_loaded(&self, doc: Doc) -> bool {
        self.loaded
            .lock()
            .map(|s| s.contains(doc.name()))
            .unwrap_or(false)
    }

    /// The read-only status of `doc` as of its last load, if any.
    fn status_of(&self, doc: Doc) -> Option<Status> {
        self.read_only
            .lock()
            .ok()
            .and_then(|m| m.get(doc.name()).copied())
    }

    /// Whether `doc` is read-only right now (as of its last load; a
    /// document never loaded is loaded by its first save).
    pub fn is_read_only(&self, doc: Doc) -> bool {
        self.read_only
            .lock()
            .map(|m| m.contains_key(doc.name()))
            .unwrap_or(true)
    }

    /// Loads `doc` (see the module table). Also the "Retry" action: a
    /// successful load makes a read-only document writable again.
    pub fn load(&self, doc: Doc) -> LoadOutcome {
        let mut out = LoadOutcome {
            name: doc.name(),
            status: Status::Empty,
            read_only: false,
            doc: None,
            schema_version: None,
            backup: None,
            field: None,
        };
        match self.read_raw(doc) {
            Raw::Missing => {}
            Raw::Unreadable => out.status = Status::Unreadable,
            Raw::TooLarge => out.status = Status::TooLarge,
            Raw::Bytes(bytes) => match check(doc, &bytes) {
                Checked::Current(canonical) => {
                    out.status = Status::Ok;
                    out.doc = Some(canonical);
                }
                Checked::Newer(version) => {
                    out.status = Status::Newer;
                    out.schema_version = Some(version);
                }
                Checked::TooLarge => out.status = Status::TooLarge,
                Checked::Invalid(error) => {
                    out.status = Status::Corrupt;
                    out.field = error.field;
                    // The backup comes first; whatever happens to it, the
                    // file stays where it is and nothing overwrites it.
                    out.backup = self.backup(doc, &bytes);
                }
            },
        }
        out.read_only = !matches!(out.status, Status::Empty | Status::Ok);
        self.set_read_only(doc, out.read_only.then_some(out.status));
        out
    }

    /// Validates `text` through `<name>.validate` and writes its canonical
    /// form atomically; returns that canonical text. Refused while
    /// read-only. A document not loaded yet is loaded first (so a corrupt
    /// file is backed up and protected, never overwritten unseen).
    pub fn save(&self, doc: Doc, text: &str) -> Result<String, StoreError> {
        let _writing = self.writes.lock().map_err(|_| StoreError::WriteFailed)?;
        let _other_processes = self.dir_lock();
        self.save_locked(doc, text)
    }

    /// Compare-and-save: like [`DocStore::save`], but only while the stored
    /// document is still `expected` (its canonical text as the caller's
    /// last load or save returned it; `None` = no document). Anything else
    /// is `conflict` and nothing is written. A stored document that became
    /// unreadable, corrupt, newer or too large since is loaded again (so it
    /// is backed up and protected) and the answer is `read_only`.
    pub fn save_if(
        &self,
        doc: Doc,
        expected: Option<&str>,
        text: &str,
    ) -> Result<String, StoreError> {
        let _writing = self.writes.lock().map_err(|_| StoreError::WriteFailed)?;
        let _other_processes = self.dir_lock();
        if !self.was_loaded(doc) {
            self.load(doc);
        }
        if self.is_read_only(doc) {
            return Err(StoreError::ReadOnly);
        }
        let current = match self.read_raw(doc) {
            Raw::Missing => None,
            Raw::Bytes(bytes) => match check(doc, &bytes) {
                Checked::Current(canonical) => Some(canonical),
                _ => {
                    self.load(doc);
                    return Err(StoreError::ReadOnly);
                }
            },
            Raw::TooLarge | Raw::Unreadable => {
                self.load(doc);
                return Err(StoreError::ReadOnly);
            }
        };
        if current.as_deref() != expected {
            return Err(StoreError::Conflict);
        }
        self.save_locked(doc, text)
    }

    fn save_locked(&self, doc: Doc, text: &str) -> Result<String, StoreError> {
        if !self.was_loaded(doc) {
            self.load(doc);
        }
        if self.is_read_only(doc) {
            return Err(StoreError::ReadOnly);
        }
        let canonical = match check(doc, text.as_bytes()) {
            Checked::Current(canonical) => canonical,
            Checked::TooLarge => return Err(StoreError::TooLarge),
            Checked::Newer(_) | Checked::Invalid(_) => return Err(StoreError::Invalid),
        };
        if canonical.len() > write_cap(doc) {
            return Err(StoreError::TooLarge);
        }
        self.write_file(&Self::file_name(doc), canonical.as_bytes())
            .map_err(|_| StoreError::WriteFailed)?;
        Ok(canonical)
    }

    /// "Start fresh": backs the current file up (or moves an unreadable
    /// one aside whole), removes it, and makes `doc` writable and empty.
    /// Refused with `read_only` for a document written by a newer app (B10:
    /// never written, never backed up), and with `recovered` for one that
    /// validates now (it stays as it is and becomes writable, as a "Retry"
    /// would make it); a document not loaded yet is loaded first to find
    /// that out.
    pub fn clear(&self, doc: Doc) -> Result<Option<String>, StoreError> {
        let _writing = self.writes.lock().map_err(|_| StoreError::WriteFailed)?;
        let _other_processes = self.dir_lock();
        if !self.was_loaded(doc) {
            self.load(doc);
        }
        if self.status_of(doc) == Some(Status::Newer) {
            return Err(StoreError::ReadOnly);
        }
        let backup = match self.read_raw(doc) {
            Raw::Missing => None,
            Raw::Bytes(bytes) => {
                match check(doc, &bytes) {
                    Checked::Newer(_) => {
                        // A newer app replaced it since the last load.
                        self.set_read_only(doc, Some(Status::Newer));
                        return Err(StoreError::ReadOnly);
                    }
                    Checked::Current(_) => {
                        // Valid again: never removed.
                        self.set_read_only(doc, None);
                        return Err(StoreError::Recovered);
                    }
                    Checked::TooLarge | Checked::Invalid(_) => {}
                }
                let backup = self.backup(doc, &bytes);
                // Never remove data that is not safely in a backup: the file
                // just written (read back and compared) or, when none was
                // written, an existing backup with the same bytes.
                let safe = match &backup {
                    Some(file) => self.read_backup(file).is_some_and(|b| b == bytes),
                    None => self.any_backup_equals(doc, &bytes),
                };
                if !safe {
                    return Err(StoreError::WriteFailed);
                }
                self.remove_file(&Self::file_name(doc))
                    .map_err(|_| StoreError::WriteFailed)?;
                backup
            }
            Raw::TooLarge | Raw::Unreadable => Some(self.move_aside(doc)?),
        };
        self.set_read_only(doc, None);
        Ok(backup)
    }

    // -- backups ------------------------------------------------------------

    /// Every backup file of `doc`, newest first.
    pub fn backups(&self, doc: Doc) -> Vec<String> {
        let names: Vec<String> = match &self.backend {
            Backend::Memory(m) => m
                .lock()
                .map(|m| m.files.keys().cloned().collect())
                .unwrap_or_default(),
            Backend::Dir(dir) => std::fs::read_dir(dir)
                .map(|it| {
                    it.filter_map(Result::ok)
                        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                        .filter_map(|e| e.file_name().into_string().ok())
                        .collect()
                })
                .unwrap_or_default(),
        };
        let mut keyed: Vec<((String, u32), String)> = names
            .into_iter()
            .filter_map(|n| backup_key(doc.name(), &n).map(|k| (k, n)))
            .collect();
        keyed.sort();
        keyed.reverse();
        keyed.into_iter().map(|(_, n)| n).collect()
    }

    fn read_backup(&self, file: &str) -> Option<Vec<u8>> {
        match &self.backend {
            Backend::Memory(m) => m.lock().ok()?.files.get(file).cloned(),
            Backend::Dir(dir) => {
                read_regular_file_limited(&dir.join(file), 8 * 1024 * 1024, "backup").ok()
            }
        }
    }

    /// Whether one of the kept backups holds exactly `bytes` (all of them,
    /// not only the newest by name: a clock set back makes a new backup
    /// sort before older ones).
    fn any_backup_equals(&self, doc: Doc, bytes: &[u8]) -> bool {
        self.backups(doc)
            .iter()
            .any(|f| self.read_backup(f).is_some_and(|b| b == bytes))
    }

    /// Writes a timestamped backup of `bytes` unless a kept backup has the
    /// same bytes, then keeps the new one plus the newest
    /// [`BACKUPS_KEPT`]` - 1` others. The file just written is never pruned,
    /// whatever its time stamp says (a clock set back, a date set ahead to
    /// test countdowns). Returns the new backup's file name.
    fn backup(&self, doc: Doc, bytes: &[u8]) -> Option<String> {
        if self.any_backup_equals(doc, bytes) {
            return None;
        }
        let ts = stamp((self.clock)());
        let existing = self.backups(doc);
        let file = (0..1000u32)
            .map(|n| {
                if n == 0 {
                    format!("{}.{ts}.bak", doc.name())
                } else {
                    format!("{}.{ts}-{n}.bak", doc.name())
                }
            })
            .find(|f| !existing.contains(f) && self.name_is_free(f))?;
        self.write_file(&file, bytes).ok()?;
        for old in self
            .backups(doc)
            .into_iter()
            .filter(|f| *f != file)
            .skip(BACKUPS_KEPT - 1)
        {
            let _ = self.remove_file(&old);
        }
        Some(file)
    }

    fn name_is_free(&self, file: &str) -> bool {
        match &self.backend {
            Backend::Memory(m) => m
                .lock()
                .map(|m| !m.files.contains_key(file))
                .unwrap_or(false),
            Backend::Dir(dir) => crate::fs::path_is_missing(&dir.join(file)),
        }
    }

    /// Renames an unreadable file aside whole (never read, copied or
    /// truncated) as a backup name.
    fn move_aside(&self, doc: Doc) -> Result<String, StoreError> {
        let ts = stamp((self.clock)());
        let file = (0..1000u32)
            .map(|n| format!("{}.{ts}-unreadable{n}.bak", doc.name()))
            .find(|f| self.name_is_free(f))
            .ok_or(StoreError::WriteFailed)?;
        match &self.backend {
            Backend::Memory(m) => {
                let mut m = m.lock().map_err(|_| StoreError::WriteFailed)?;
                let bytes = m
                    .files
                    .remove(&Self::file_name(doc))
                    .ok_or(StoreError::WriteFailed)?;
                m.files.insert(file.clone(), bytes);
            }
            Backend::Dir(dir) => {
                std::fs::rename(dir.join(Self::file_name(doc)), dir.join(&file))
                    .map_err(|_| StoreError::WriteFailed)?;
            }
        }
        Ok(file)
    }

    // -- raw files ------------------------------------------------------------

    fn write_file(&self, file: &str, bytes: &[u8]) -> Result<(), String> {
        match &self.backend {
            Backend::Memory(m) => {
                m.lock()
                    .map_err(|_| "store lock poisoned".to_string())?
                    .files
                    .insert(file.to_string(), bytes.to_vec());
                Ok(())
            }
            Backend::Dir(dir) => write_atomic_private(&dir.join(file), bytes),
        }
    }

    fn remove_file(&self, file: &str) -> Result<(), String> {
        match &self.backend {
            Backend::Memory(m) => {
                m.lock()
                    .map_err(|_| "store lock poisoned".to_string())?
                    .files
                    .remove(file);
                Ok(())
            }
            Backend::Dir(dir) => remove_regular(&dir.join(file)),
        }
    }

    /// Test and smoke helper: puts raw bytes where `doc` lives.
    pub fn put_raw(&self, doc: Doc, bytes: &[u8]) -> Result<(), String> {
        self.write_file(&Self::file_name(doc), bytes)
    }

    /// The theme stored in valid settings (`system` when there are none),
    /// for the desktop window background at creation (plan B5b).
    pub fn theme(&self) -> &'static str {
        let Raw::Bytes(bytes) = self.read_raw(Doc::Settings) else {
            return "system";
        };
        let Checked::Current(canonical) = check(Doc::Settings, &bytes) else {
            return "system";
        };
        let value: serde_json::Value = serde_json::from_str(&canonical).unwrap_or_default();
        let theme = value["appearance"]["theme"].as_str().unwrap_or("system");
        pcalc_api::store::THEMES
            .into_iter()
            .find(|t| *t == theme)
            .unwrap_or("system")
    }
}

/// Removes a regular file (never a directory; a symlink is removed as a
/// link). A missing file is fine.
fn remove_regular(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
        Ok(meta) if meta.file_type().is_dir() => Err("refusing to remove a directory".to_string()),
        Ok(_) => std::fs::remove_file(path).map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{try_symlink_file, TestTempDir};

    const SETTINGS: &str = r#"{"schemaVersion":1,"checkUpdatesOnStartup":false,"history":{"enabled":true},"display":{"grouping":"comma"},"calculator":{"angleUnit":"deg","wordSize":"qword","base":"dec","shiftMode":"arithmetic"},"date":{"firstDayOfWeek":"monday","calendar":{},"cardOrder":["between","add","business","age","info","countdown"],"collapsedCards":[]},"percent":{"cardOrder":["change","percent","what","discount","base","markup","tax","tip"],"collapsedCards":[]},"appearance":{"theme":"retro"},"language":{"code":"auto","digits":"auto"}}"#;
    const STATE: &str = r#"{"schemaVersion":1,"route":"date","pane":{"open":false,"tab":"history"},"dev":{"pseudoLocale":"off"}}"#;

    static TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1_795_400_000);
    fn ticking() -> u64 {
        TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }
    fn frozen() -> u64 {
        1_795_400_000
    }

    fn stores(temp: &TestTempDir) -> Vec<DocStore> {
        vec![
            DocStore::in_dir(temp.path().join("app")).with_clock(ticking),
            DocStore::memory().with_clock(ticking),
        ]
    }

    #[test]
    fn stamps_are_utc_civil_time() {
        assert_eq!(stamp(0), "19700101-000000");
        assert_eq!(stamp(951_782_400), "20000229-000000");
        assert_eq!(stamp(1_795_400_000 + 59), "20261123-021419");
        assert_eq!(
            backup_key("history", "history.20261118-135501.bak"),
            Some(("20261118-135501".into(), 0))
        );
        assert_eq!(
            backup_key("history", "history.20261118-135501-2.bak"),
            Some(("20261118-135501".into(), 2))
        );
        assert_eq!(backup_key("history", "history.json.bak"), None);
        assert_eq!(backup_key("history", "state.20261118-135501.bak"), None);
        assert_eq!(backup_key("state", "state.2026111-1355011.bak"), None);
    }

    #[test]
    fn missing_is_empty_and_writable_then_round_trips() {
        let temp = TestTempDir::new("pcalc-docs-rt");
        for store in stores(&temp) {
            for doc in Doc::ALL {
                let out = store.load(doc);
                assert_eq!(
                    (out.status, out.read_only),
                    (Status::Empty, false),
                    "{doc:?}"
                );
            }
            store.save(Doc::Settings, SETTINGS).unwrap();
            let out = store.load(Doc::Settings);
            assert_eq!(out.status, Status::Ok);
            let doc = out.doc.unwrap();
            assert!(doc.contains(r#""theme":"retro""#));
            assert_eq!(store.theme(), "retro");
            // Saving writes the canonical form (a fixed point).
            store.save(Doc::Settings, &doc).unwrap();
            assert_eq!(store.load(Doc::Settings).doc.unwrap(), doc);
            assert_eq!(store.save(Doc::Settings, "{}"), Err(StoreError::Invalid));
            assert_eq!(
                store.save(Doc::Settings, r#"{"schemaVersion":2}"#),
                Err(StoreError::Invalid)
            );
            assert_eq!(store.save(Doc::State, SETTINGS), Err(StoreError::Invalid));
            store.save(Doc::State, STATE).unwrap();
            assert!(store.backups(Doc::Settings).is_empty());
        }
    }

    #[test]
    fn corrupt_is_backed_up_first_then_read_only() {
        let temp = TestTempDir::new("pcalc-docs-corrupt");
        for store in stores(&temp) {
            store
                .put_raw(Doc::Settings, b"{\"schemaVersion\":1,\"x\":")
                .unwrap();
            let out = store.load(Doc::Settings);
            assert_eq!((out.status, out.read_only), (Status::Corrupt, true));
            let bak = out.backup.clone().unwrap();
            assert!(
                bak.starts_with("settings.") && bak.ends_with(".bak"),
                "{bak}"
            );
            assert_eq!(
                store.read_backup(&bak).unwrap(),
                b"{\"schemaVersion\":1,\"x\":"
            );
            assert_eq!(store.theme(), "system");
            // Read-only: nothing is overwritten.
            assert_eq!(
                store.save(Doc::Settings, SETTINGS),
                Err(StoreError::ReadOnly)
            );
            assert_eq!(
                store.read_raw_for_test(Doc::Settings),
                b"{\"schemaVersion\":1,\"x\":"
            );
            // Reloading the same bytes writes no second backup.
            assert_eq!(store.load(Doc::Settings).backup, None);
            assert_eq!(store.backups(Doc::Settings).len(), 1);
            // A field-level failure reports its path.
            store.put_raw(Doc::State, br#"{"schemaVersion":1,"route":"date","pane":{"open":1,"tab":"history"},"dev":{"pseudoLocale":"off"}}"#).unwrap();
            let out = store.load(Doc::State);
            assert_eq!(
                (out.status, out.field.as_deref()),
                (Status::Corrupt, Some("pane.open"))
            );
            // Retry after a repair leaves read-only.
            store.put_raw(Doc::Settings, SETTINGS.as_bytes()).unwrap();
            let out = store.load(Doc::Settings);
            assert_eq!((out.status, out.read_only), (Status::Ok, false));
            store.save(Doc::Settings, SETTINGS).unwrap();
        }
    }

    #[test]
    fn newest_three_backups_are_kept() {
        let temp = TestTempDir::new("pcalc-docs-rotate");
        for store in stores(&temp) {
            let mut made = Vec::new();
            for i in 0..5 {
                store
                    .put_raw(Doc::History, format!("bad {i}").as_bytes())
                    .unwrap();
                made.push(store.load(Doc::History).backup.unwrap());
            }
            let kept = store.backups(Doc::History);
            assert_eq!(kept.len(), BACKUPS_KEPT);
            assert_eq!(
                kept,
                vec![made[4].clone(), made[3].clone(), made[2].clone()]
            );
            assert_eq!(store.read_backup(&kept[0]).unwrap(), b"bad 4");
            // Backups of one document never touch another's.
            store.put_raw(Doc::State, b"bad").unwrap();
            store.load(Doc::State);
            assert_eq!(store.backups(Doc::History).len(), BACKUPS_KEPT);
            assert_eq!(store.backups(Doc::State).len(), 1);
        }
    }

    #[test]
    fn same_second_backups_get_a_sequence_number() {
        let temp = TestTempDir::new("pcalc-docs-seq");
        let store = DocStore::in_dir(temp.path()).with_clock(frozen);
        store.put_raw(Doc::Countdowns, b"one").unwrap();
        let a = store.load(Doc::Countdowns).backup.unwrap();
        store.put_raw(Doc::Countdowns, b"two").unwrap();
        let b = store.load(Doc::Countdowns).backup.unwrap();
        assert_eq!(a, "countdowns.20261123-021320.bak");
        assert_eq!(b, "countdowns.20261123-021320-1.bak");
        assert_eq!(store.backups(Doc::Countdowns), vec![b, a]);
    }

    #[test]
    fn newer_schema_is_read_only_without_a_backup() {
        let temp = TestTempDir::new("pcalc-docs-newer");
        for store in stores(&temp) {
            store
                .put_raw(Doc::History, br#"{"schemaVersion":2,"whatever":true}"#)
                .unwrap();
            let out = store.load(Doc::History);
            assert_eq!(
                (out.status, out.read_only, out.schema_version),
                (Status::Newer, true, Some(2))
            );
            assert_eq!(out.backup, None);
            assert!(store.backups(Doc::History).is_empty());
            assert_eq!(
                store.save(Doc::History, r#"{"schemaVersion":1,"entries":[]}"#),
                Err(StoreError::ReadOnly)
            );
            assert_eq!(
                store.read_raw_for_test(Doc::History),
                br#"{"schemaVersion":2,"whatever":true}"#
            );
        }
    }

    #[test]
    fn too_large_is_read_only_and_never_corrupt() {
        let temp = TestTempDir::new("pcalc-docs-large");
        for store in stores(&temp) {
            let mut big = br#"{"schemaVersion":1,"route":"date","pane":{"open":false,"tab":"history"},"dev":{"pseudoLocale":"off"}}"#.to_vec();
            big.resize(read_cap(Doc::State), b' ');
            store.put_raw(Doc::State, &big).unwrap();
            assert_eq!(
                store.load(Doc::State).status,
                Status::Ok,
                "exactly at the cap"
            );
            big.push(b' ');
            store.put_raw(Doc::State, &big).unwrap();
            let out = store.load(Doc::State);
            assert_eq!(
                (out.status, out.read_only, out.backup.clone()),
                (Status::TooLarge, true, None)
            );
            assert!(store.backups(Doc::State).is_empty());
            assert_eq!(store.save(Doc::State, STATE), Err(StoreError::ReadOnly));
            assert_eq!(store.read_raw_for_test(Doc::State), big);
        }
    }

    #[test]
    fn unreadable_is_read_only_and_untouched() {
        let temp = TestTempDir::new("pcalc-docs-unreadable");
        let dir = temp.path().join("app");
        let store = DocStore::in_dir(&dir);
        // A directory squatting on the file name.
        std::fs::create_dir_all(dir.join("settings.json")).unwrap();
        let out = store.load(Doc::Settings);
        assert_eq!((out.status, out.read_only), (Status::Unreadable, true));
        assert_eq!(
            store.save(Doc::Settings, SETTINGS),
            Err(StoreError::ReadOnly)
        );
        assert!(dir.join("settings.json").is_dir());
        // A symlink is never followed.
        let target = temp.path().join("elsewhere.json");
        std::fs::write(&target, STATE).unwrap();
        if try_symlink_file(&target, &dir.join("state.json")).is_some() {
            let out = store.load(Doc::State);
            assert_eq!(out.status, Status::Unreadable);
            assert_eq!(store.save(Doc::State, STATE), Err(StoreError::ReadOnly));
            assert_eq!(
                store
                    .clear(Doc::State)
                    .unwrap()
                    .map(|f| f.contains("unreadable")),
                Some(true)
            );
            assert_eq!(
                std::fs::read_to_string(&target).unwrap(),
                STATE,
                "link target untouched"
            );
            assert_eq!(store.load(Doc::State).status, Status::Empty);
        }
    }

    #[test]
    fn clear_backs_up_then_starts_fresh() {
        let temp = TestTempDir::new("pcalc-docs-clear");
        for store in stores(&temp) {
            store.put_raw(Doc::Countdowns, b"[corrupt]").unwrap();
            assert!(store.load(Doc::Countdowns).read_only);
            // The corrupt load already backed it up; clear does not duplicate it.
            let backup = store.clear(Doc::Countdowns).unwrap();
            assert_eq!(backup, None);
            assert_eq!(store.backups(Doc::Countdowns).len(), 1);
            assert!(!store.is_read_only(Doc::Countdowns));
            assert_eq!(store.load(Doc::Countdowns).status, Status::Empty);
            store
                .save(Doc::Countdowns, r#"{"schemaVersion":1,"items":[]}"#)
                .unwrap();
            // Valid data is never cleared: "recovered", untouched, writable.
            assert_eq!(store.clear(Doc::Countdowns), Err(StoreError::Recovered));
            assert!(!store.is_read_only(Doc::Countdowns));
            assert_eq!(store.load(Doc::Countdowns).status, Status::Ok);
            assert_eq!(store.backups(Doc::Countdowns).len(), 1);
            // Damaged again: the load backs it up, then clear removes it.
            store.put_raw(Doc::Countdowns, b"[still corrupt]").unwrap();
            assert!(store.load(Doc::Countdowns).read_only);
            assert_eq!(store.clear(Doc::Countdowns), Ok(None));
            assert_eq!(store.backups(Doc::Countdowns).len(), 2);
            assert_eq!(
                store.clear(Doc::Countdowns),
                Ok(None),
                "nothing left to clear"
            );
        }
    }

    #[test]
    fn a_save_before_any_load_never_overwrites_unseen_data() {
        let temp = TestTempDir::new("pcalc-docs-unseen");
        for store in stores(&temp) {
            store.put_raw(Doc::Settings, b"{damaged").unwrap();
            // No load yet: the save loads first, finds it corrupt, backs it
            // up and refuses.
            assert_eq!(
                store.save(Doc::Settings, SETTINGS),
                Err(StoreError::ReadOnly)
            );
            assert_eq!(store.read_raw_for_test(Doc::Settings), b"{damaged");
            assert_eq!(store.backups(Doc::Settings).len(), 1);
            store
                .put_raw(Doc::History, br#"{"schemaVersion":3}"#)
                .unwrap();
            assert_eq!(
                store.save(Doc::History, r#"{"schemaVersion":1,"entries":[]}"#),
                Err(StoreError::ReadOnly)
            );
            assert!(store.backups(Doc::History).is_empty());
            // A missing document is simply written.
            assert!(store
                .save(Doc::State, STATE)
                .unwrap()
                .contains("\"route\":\"date\""));
        }
    }

    static FUTURE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1_900_000_000);
    fn future() -> u64 {
        FUTURE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// A clock set back below the stamps of the kept backups: the backup a
    /// corrupt load writes must survive the pruning, and "Start fresh" must
    /// only remove the document once a backup really holds its bytes.
    #[test]
    fn a_clock_set_back_never_prunes_the_new_backup() {
        let temp = TestTempDir::new("pcalc-docs-rollback");
        let dir = temp.path().join("app");
        for store in [
            DocStore::in_dir(&dir).with_clock(future),
            DocStore::memory().with_clock(future),
        ] {
            for i in 0..3 {
                store
                    .put_raw(Doc::History, format!("old {i}").as_bytes())
                    .unwrap();
                assert!(store.load(Doc::History).backup.is_some());
            }
            let store = store.with_clock(frozen);
            store.put_raw(Doc::History, b"the only copy").unwrap();
            let out = store.load(Doc::History);
            assert_eq!(out.status, Status::Corrupt);
            let bak = out.backup.clone().expect("a backup was written");
            assert_eq!(
                store.read_backup(&bak).as_deref(),
                Some(&b"the only copy"[..]),
                "the reported backup exists and holds the document"
            );
            assert!(store.backups(Doc::History).contains(&bak));
            assert_eq!(store.backups(Doc::History).len(), BACKUPS_KEPT);
            // Reloading the same bytes still writes nothing new.
            assert_eq!(store.load(Doc::History).backup, None);
            // Start fresh: the bytes are in a backup, so the file may go.
            assert_eq!(store.clear(Doc::History), Ok(None));
            assert!(store
                .backups(Doc::History)
                .iter()
                .any(|f| store.read_backup(f).as_deref() == Some(&b"the only copy"[..])));
        }
    }

    #[test]
    fn a_newer_document_is_never_cleared() {
        let temp = TestTempDir::new("pcalc-docs-newer-clear");
        for store in stores(&temp) {
            let newer = br#"{"schemaVersion":9,"fromTheFuture":true}"#;
            store.put_raw(Doc::Settings, newer).unwrap();
            // Not loaded yet: clear loads first and refuses.
            assert_eq!(store.clear(Doc::Settings), Err(StoreError::ReadOnly));
            assert_eq!(store.read_raw_for_test(Doc::Settings), newer);
            assert!(store.backups(Doc::Settings).is_empty());
            assert_eq!(store.load(Doc::Settings).status, Status::Newer);
            assert_eq!(store.clear(Doc::Settings), Err(StoreError::ReadOnly));
            // A newer app wrote it after a corrupt load here: still refused.
            store.put_raw(Doc::State, b"{bad").unwrap();
            assert_eq!(store.load(Doc::State).status, Status::Corrupt);
            store
                .put_raw(Doc::State, br#"{"schemaVersion":5}"#)
                .unwrap();
            assert_eq!(store.clear(Doc::State), Err(StoreError::ReadOnly));
            assert_eq!(
                store.read_raw_for_test(Doc::State),
                br#"{"schemaVersion":5}"#
            );
        }
    }

    const HISTORY_A: &str = r#"{"schemaVersion":1,"entries":[{"id":"h-1-0","timestampMs":1,"tool":"date","calculator":"info","calculatorLabel":"Date Info","inputs":{"date":"2026-11-19"},"expressionText":"","inputsText":"2026-11-19","resultText":"Thursday","copyText":"2026-11-19","pinned":false,"note":null,"engine":"date-core 1.0.0"}]}"#;

    fn history_with(id: &str) -> String {
        HISTORY_A.replace("h-1-0", id)
    }

    #[test]
    fn compare_and_save_refuses_a_stale_writer() {
        let temp = TestTempDir::new("pcalc-docs-cas");
        for store in stores(&temp) {
            let doc = Doc::History;
            assert_eq!(store.load(doc).status, Status::Empty);
            // Window A writes on top of "no document".
            let a = store.save_if(doc, None, &history_with("h-1-0")).unwrap();
            // Window B still believes there is none: conflict, nothing written.
            assert_eq!(
                store.save_if(doc, None, &history_with("h-2-0")),
                Err(StoreError::Conflict)
            );
            assert_eq!(store.load(doc).doc.as_deref(), Some(a.as_str()));
            // B reads again and writes on top of A's document.
            let b = store
                .save_if(doc, Some(&a), &history_with("h-2-0"))
                .unwrap();
            assert_eq!(
                store.save_if(doc, Some(&a), &history_with("h-3-0")),
                Err(StoreError::Conflict)
            );
            assert_eq!(store.load(doc).doc.as_deref(), Some(b.as_str()));
            // A document that turned corrupt underneath: read-only, backed up.
            store.put_raw(doc, b"{broken").unwrap();
            assert_eq!(
                store.save_if(doc, Some(&b), &history_with("h-4-0")),
                Err(StoreError::ReadOnly)
            );
            assert!(store.is_read_only(doc));
            assert_eq!(store.backups(doc).len(), 1);
            assert_eq!(StoreError::Conflict.code(), "conflict");
        }
    }

    /// The B5a case: several windows of one process record at the same
    /// time. Each writer loops load -> history.apply -> save_if until its
    /// write lands; no entry is ever lost.
    #[test]
    fn two_threads_recording_at_once_keep_every_entry() {
        use serde_json::{json, Value};
        let temp = TestTempDir::new("pcalc-docs-2w");
        let store = std::sync::Arc::new(DocStore::in_dir(temp.path().join("app")));
        store.load(Doc::History);
        let writers: Vec<_> = (0..2)
            .map(|w| {
                let store = store.clone();
                std::thread::spawn(move || {
                    let mut conflicts = 0usize;
                    for i in 0..15 {
                        let text = history_with(&format!("h-{}-{w}", i + 10));
                        let mut entry =
                            serde_json::from_str::<Value>(&text).unwrap()["entries"][0].clone();
                        entry["resultText"] = json!(format!("w{w} i{i}"));
                        loop {
                            let current = store.load(Doc::History).doc;
                            let doc: Value = current
                                .as_deref()
                                .map(|t| serde_json::from_str(t).unwrap())
                                .unwrap_or(Value::Null);
                            let req = json!({"doc": doc, "ops": [{"add": entry}]}).to_string();
                            let res: Value =
                                serde_json::from_str(&pcalc_api::call("history.apply", &req))
                                    .unwrap();
                            let next = res["result"]["doc"].to_string();
                            match store.save_if(Doc::History, current.as_deref(), &next) {
                                Ok(_) => break,
                                Err(StoreError::Conflict) => conflicts += 1,
                                Err(other) => panic!("{other:?}"),
                            }
                        }
                    }
                    conflicts
                })
            })
            .collect();
        let conflicts: usize = writers.into_iter().map(|t| t.join().unwrap()).sum();
        let stored: Value = serde_json::from_str(&store.load(Doc::History).doc.unwrap()).unwrap();
        assert_eq!(
            stored["entries"].as_array().unwrap().len(),
            30,
            "conflicts {conflicts}"
        );
    }

    #[test]
    fn another_process_holding_the_store_lock_blocks_every_write() {
        // A second desktop instance is a second DocStore on the same folder
        // (its own in-process lock): writes wait for the folder's docs.lock,
        // so the compare and the write of save_if are one step across
        // processes too.
        let temp = TestTempDir::new("pcalc-docs-xproc");
        let dir = temp.path().join("app");
        let first = DocStore::in_dir(&dir);
        first.save(Doc::History, &history_with("h-1-1")).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(dir.join(LOCK_FILE))
            .unwrap();
        held.lock().unwrap();
        let second = std::sync::Arc::new(DocStore::in_dir(&dir));
        let expected = second.load(Doc::History).doc;
        let writer = {
            let second = second.clone();
            std::thread::spawn(move || {
                second.save_if(Doc::History, expected.as_deref(), &history_with("h-2-2"))
            })
        };
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(
            !writer.is_finished(),
            "wrote while another process held the lock"
        );
        assert!(first.load(Doc::History).doc.unwrap().contains("h-1-1"));
        held.unlock().unwrap();
        assert!(writer.join().unwrap().is_ok());
        assert!(first.load(Doc::History).doc.unwrap().contains("h-2-2"));
        // A symlink in place of the lock file is never followed or locked.
        let _ = std::fs::remove_file(dir.join(LOCK_FILE));
        let target = temp.path().join("not-a-lock");
        std::fs::write(&target, b"x").unwrap();
        if try_symlink_file(&target, &dir.join(LOCK_FILE)).is_some() {
            assert!(first.save(Doc::History, &history_with("h-3-3")).is_ok());
            assert_eq!(std::fs::read(&target).unwrap(), b"x");
        }
    }

    #[test]
    fn a_history_that_validates_again_is_never_cleared() {
        // "Start a new history" pressed after a passing read error: the
        // stored history is valid now, so it is kept and becomes writable.
        let temp = TestTempDir::new("pcalc-docs-recovered");
        for store in stores(&temp) {
            store.put_raw(Doc::History, b"{not json").unwrap();
            assert!(store.load(Doc::History).read_only);
            let good = history_with("h-7-7");
            store.put_raw(Doc::History, good.as_bytes()).unwrap();
            assert_eq!(store.clear(Doc::History), Err(StoreError::Recovered));
            let after = store.load(Doc::History);
            assert_eq!(after.status, Status::Ok);
            assert!(after.doc.unwrap().contains("h-7-7"));
        }
    }

    #[test]
    fn memory_store_never_touches_the_disk() {
        let store = DocStore::memory();
        assert!(store.is_memory());
        store.save(Doc::State, STATE).unwrap();
        assert_eq!(store.load(Doc::State).status, Status::Ok);
    }

    impl DocStore {
        fn read_raw_for_test(&self, doc: Doc) -> Vec<u8> {
            match &self.backend {
                Backend::Memory(m) => m.lock().unwrap().files[&Self::file_name(doc)].clone(),
                Backend::Dir(dir) => std::fs::read(dir.join(Self::file_name(doc))).unwrap(),
            }
        }
    }
}
