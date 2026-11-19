//! Desktop export (plan B10, M3): `Portable-Calculator-<yyyymmdd-hhmmss>`
//! `.json` or `.csv` in the user's Downloads folder.
//!
//! Decision (the plan's [A] "tauri-plugin-dialog decided in M3"): no new
//! plugin. The file goes to the fixed Downloads folder (Tauri's own path
//! API, no dependency) and the app shows the full path; a save dialog would
//! add a plugin, a capability and a second way to choose paths for one
//! button. The renderer never names a path: it passes only the kind and
//! the local time stamp, both checked here.
//!
//! The file is created new (never overwriting anything: `-2`, `-3` … are
//! tried when the name exists), written whole and flushed; the folder must
//! already exist.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Largest export written, in bytes (the 4 MiB history plus countdowns
/// and settings, CSV quoting included, fit well below this).
pub const EXPORT_MAX_BYTES: usize = 16 * 1024 * 1024;

/// The export file kinds.
pub const KINDS: [&str; 2] = ["json", "csv"];

/// `Portable-Calculator-<stamp>[-n].<kind>` for a checked stamp
/// (`yyyymmdd-hhmmss`, local time as the renderer reads its clock) and
/// kind; `None` for anything else.
pub fn file_name(stamp: &str, kind: &str, n: u32) -> Option<String> {
    let b = stamp.as_bytes();
    let shape = b.len() == 15
        && b.iter().enumerate().all(|(i, c)| {
            if i == 8 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        });
    if !shape || !KINDS.contains(&kind) {
        return None;
    }
    Some(if n <= 1 {
        format!("Portable-Calculator-{stamp}.{kind}")
    } else {
        format!("Portable-Calculator-{stamp}-{n}.{kind}")
    })
}

/// Writes `bytes` as a new export file in `dir` and returns its path.
pub fn write_export(dir: &Path, stamp: &str, kind: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.len() > EXPORT_MAX_BYTES {
        return Err("export too large".to_string());
    }
    file_name(stamp, kind, 1).ok_or_else(|| "invalid export name".to_string())?;
    let meta = std::fs::metadata(dir).map_err(|err| format!("no export folder: {err}"))?;
    if !meta.is_dir() {
        return Err("the export folder is not a folder".to_string());
    }
    for n in 1..=99 {
        let Some(name) = file_name(stamp, kind, n) else {
            break;
        };
        let path = dir.join(name);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(f) => f,
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("cannot create the export file: {err}")),
        };
        let written = file.write_all(bytes).and_then(|()| file.sync_all());
        if let Err(err) = written {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(format!("cannot write the export file: {err}"));
        }
        return Ok(path);
    }
    Err("too many exports with this time stamp".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestTempDir;

    #[test]
    fn names_are_checked() {
        assert_eq!(
            file_name("20261119-143005", "json", 1).as_deref(),
            Some("Portable-Calculator-20261119-143005.json")
        );
        assert_eq!(
            file_name("20261119-143005", "csv", 3).as_deref(),
            Some("Portable-Calculator-20261119-143005-3.csv")
        );
        for bad in [
            "",
            "2026111-1430051",
            "20261119_143005",
            "../../x",
            "20261119-14300a",
        ] {
            assert_eq!(file_name(bad, "json", 1), None, "{bad}");
        }
        assert_eq!(file_name("20261119-143005", "exe", 1), None);
        assert_eq!(file_name("20261119-143005", "json/../x", 1), None);
    }

    #[test]
    fn exports_are_new_files_and_never_overwrite() {
        let temp = TestTempDir::new("pcalc-export");
        let dir = temp.path();
        let a = write_export(dir, "20261119-143005", "json", b"{\"a\":1}").unwrap();
        let b = write_export(dir, "20261119-143005", "json", b"{\"b\":2}").unwrap();
        assert_eq!(
            a.file_name().unwrap(),
            "Portable-Calculator-20261119-143005.json"
        );
        assert_eq!(
            b.file_name().unwrap(),
            "Portable-Calculator-20261119-143005-2.json"
        );
        assert_eq!(std::fs::read(&a).unwrap(), b"{\"a\":1}");
        assert_eq!(std::fs::read(&b).unwrap(), b"{\"b\":2}");
        assert!(write_export(dir, "x", "json", b"").is_err());
        assert!(write_export(&dir.join("missing"), "20261119-143005", "csv", b"").is_err());
        let big = vec![b' '; EXPORT_MAX_BYTES + 1];
        assert!(write_export(dir, "20261119-143006", "json", &big).is_err());
        assert!(!dir
            .join("Portable-Calculator-20261119-143006.json")
            .exists());
    }
}
