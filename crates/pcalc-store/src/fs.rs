//! Hardened file primitives (from the Date Calculator's `commands.rs`).
//!
//! Every function returns `Result<_, String>` with a short English reason;
//! callers decide whether a failure means "read-only" or "corrupt" (plan
//! B10: only NotFound is empty-and-writable).

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Reads a regular file of at most `max_bytes`. Symlinks, directories and
/// other non-regular files are refused, the size is checked before and
/// while reading, and `label` names the file in error messages.
pub fn read_regular_file_limited(
    path: &Path,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let lstat =
        std::fs::symlink_metadata(path).map_err(|err| format!("failed to stat {label}: {err}"))?;
    if lstat.file_type().is_symlink() || !lstat.file_type().is_file() {
        return Err(format!("refusing to read non-regular or symlinked {label}"));
    }
    if lstat.len() > max_bytes as u64 {
        return Err(format!("{label} exceeds max allowed size"));
    }

    let file = File::open(path).map_err(|err| format!("failed to open {label}: {err}"))?;
    let fstat = file
        .metadata()
        .map_err(|err| format!("failed to inspect opened {label}: {err}"))?;
    if !fstat.is_file() || fstat.len() > max_bytes as u64 {
        return Err(format!("{label} invalid or exceeds max allowed size"));
    }

    let mut bytes = Vec::with_capacity((fstat.len() as usize).min(max_bytes));
    file.take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("failed to read {label}: {err}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("{label} exceeded max allowed size while reading"));
    }
    Ok(bytes)
}

/// Creates `parent` (0700 on Unix when newly created) and checks it is a
/// real directory, not a symlink.
pub fn ensure_private_parent_dir(parent: &Path) -> Result<(), String> {
    #[cfg(unix)]
    let created = !parent.exists();
    std::fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create app data directory: {err}"))?;
    let meta = std::fs::symlink_metadata(parent)
        .map_err(|err| format!("failed to inspect app data directory: {err}"))?;
    if meta.file_type().is_symlink() || !meta.file_type().is_dir() {
        return Err("app data directory path is not a regular directory".to_string());
    }
    #[cfg(unix)]
    if created {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Writes `data` to `path` atomically: a fresh `create_new` temporary file
/// in the same directory (0600 on Unix), `sync_all`, then rename over the
/// target. Refuses to replace a symlink or non-regular file, and removes the
/// temporary file on any failure.
pub fn write_atomic_private(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "file path has no parent directory".to_string())?;
    ensure_private_parent_dir(parent)?;

    if let Ok(existing) = std::fs::symlink_metadata(path) {
        if existing.file_type().is_symlink() || !existing.file_type().is_file() {
            return Err("refusing to overwrite non-regular or symlinked file".to_string());
        }
    }

    let pid = std::process::id();
    let seq = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let stem = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data");
    let tmp_path = parent.join(format!("{stem}.{pid}.{seq}.tmp"));

    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }

    let mut file = opts
        .open(&tmp_path)
        .map_err(|err| format!("failed to create temporary file: {err}"))?;

    let write_res = (|| -> Result<(), String> {
        file.write_all(data)
            .map_err(|err| format!("failed to write temporary file: {err}"))?;
        file.sync_all()
            .map_err(|err| format!("failed to flush temporary file: {err}"))?;
        Ok(())
    })();

    drop(file);
    if let Err(err) = write_res {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }

    if let Err(err) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("failed to commit file: {err}"));
    }
    Ok(())
}

/// `settings.json` -> `settings.json.bak`.
pub fn backup_path(path: &Path) -> Option<PathBuf> {
    let mut name = path.file_name()?.to_os_string();
    name.push(".bak");
    Some(path.with_file_name(name))
}

/// Copies a corrupt or invalid file once to a single `<name>.bak` before it
/// can be overwritten.
///
/// "Once" is per corrupt file: repeated loads of the same bad bytes write
/// nothing new, but a later, different corruption replaces an older `.bak`,
/// so the most recent bad file is never lost to the next save. A `.bak` that
/// is a symlink, a directory, unreadable or over `max_bytes` is left alone,
/// and symlinked, non-regular or over-cap source files are never copied.
/// Returns whether a backup was written.
///
/// (Plan B10 replaces the single `.bak` with timestamped backups, newest 3
/// kept, in M3; this is the proven v1 rule it starts from.)
pub fn backup_corrupt_file_once(path: &Path, max_bytes: usize) -> bool {
    let Some(bak) = backup_path(path) else {
        return false;
    };
    let Ok(bytes) = read_regular_file_limited(path, max_bytes, "file to back up") else {
        return false;
    };
    match std::fs::symlink_metadata(&bak) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Ok(meta) if meta.file_type().is_file() => {
            match read_regular_file_limited(&bak, max_bytes, "existing backup") {
                Ok(existing) if existing != bytes => {}
                _ => return false,
            }
        }
        _ => return false,
    }
    write_atomic_private(&bak, &bytes).is_ok()
}

/// True only when nothing exists at `p` (any other lookup error is not
/// "free": the name may still hold something that must not be replaced).
pub fn path_is_missing(p: &Path) -> bool {
    matches!(
        std::fs::symlink_metadata(p),
        Err(ref err) if err.kind() == std::io::ErrorKind::NotFound
    )
}

/// `history.json` -> a free `history.json.bak-<ms>` (or `-<ms>-<n>`), so a
/// second backup never replaces the first.
pub fn unique_backup_path(path: &Path) -> Option<PathBuf> {
    let bak = backup_path(path)?;
    let base = bak.file_name()?.to_os_string();
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    (0..100u32).find_map(|n| {
        let mut name = base.clone();
        if n == 0 {
            name.push(format!("-{ms}"));
        } else {
            name.push(format!("-{ms}-{n}"));
        }
        let candidate = bak.with_file_name(name);
        path_is_missing(&candidate).then_some(candidate)
    })
}

/// Keeps a file that cannot be read or copied safely by renaming it aside
/// whole (never copying, truncating or replacing anything): to `<name>.bak`
/// when that name is free, else to a fresh [`unique_backup_path`]. A symlink
/// is moved as a link; its target is never touched.
pub fn move_aside(path: &Path) -> Result<PathBuf, String> {
    let bak = backup_path(path).ok_or_else(|| "path has no file name".to_string())?;
    let target = if path_is_missing(&bak) {
        bak
    } else {
        unique_backup_path(path).ok_or_else(|| "no free backup name".to_string())?
    };
    std::fs::rename(path, &target)
        .map_err(|err| format!("failed to move the file aside: {err}"))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{try_symlink_file, TestTempDir};

    #[test]
    fn rejects_oversized_files_and_writes_atomically() {
        let temp = TestTempDir::new("pcalc-store-test");
        let base = temp.path();

        let target = base.join("history.json");
        write_atomic_private(&target, br#"[]"#).unwrap();
        assert_eq!(
            read_regular_file_limited(&target, 1024, "history file").unwrap(),
            b"[]"
        );

        let big = base.join("big.json");
        std::fs::write(&big, vec![b'a'; 200]).unwrap();
        assert!(read_regular_file_limited(&big, 100, "history file").is_err());
        assert!(read_regular_file_limited(&big, 200, "history file").is_ok());

        // Directories are not regular files.
        assert!(read_regular_file_limited(base, 1 << 20, "history file").is_err());
        // Missing files are an error (the caller maps NotFound to "empty").
        assert!(read_regular_file_limited(&base.join("none.json"), 10, "x").is_err());

        let link = base.join("link.json");
        if try_symlink_file(&target, &link).is_some() {
            assert!(read_regular_file_limited(&link, 1024, "history file").is_err());
            assert!(write_atomic_private(&link, b"[]").is_err());
            // The target is untouched by the refused write.
            assert_eq!(std::fs::read(&target).unwrap(), b"[]");
        }

        let leftover_tmp = std::fs::read_dir(base)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftover_tmp, 0);
    }

    #[test]
    fn atomic_write_refuses_a_directory_target() {
        let temp = TestTempDir::new("pcalc-store-dir");
        let dir_target = temp.path().join("settings.json");
        std::fs::create_dir(&dir_target).unwrap();
        assert!(write_atomic_private(&dir_target, b"{}").is_err());
        assert!(dir_target.is_dir());
    }

    #[test]
    fn corrupt_files_are_backed_up_once() {
        let temp = TestTempDir::new("pcalc-store-bak");
        let path = temp.path().join("settings.json");
        let bak = temp.path().join("settings.json.bak");
        assert_eq!(backup_path(&path).unwrap(), bak);

        // Missing source: nothing to back up.
        assert!(!backup_corrupt_file_once(&path, 1024));
        assert!(!bak.exists());

        let first = b"{\"checkUpdatesOnStartup\": tru".to_vec();
        std::fs::write(&path, &first).unwrap();
        assert!(backup_corrupt_file_once(&path, 1024));
        assert_eq!(std::fs::read(&bak).unwrap(), first);
        // The original stays in place.
        assert_eq!(std::fs::read(&path).unwrap(), first);

        // The same bytes again: nothing new is written.
        assert!(!backup_corrupt_file_once(&path, 1024));
        assert_eq!(std::fs::read(&bak).unwrap(), first);

        // A different corruption replaces the older backup.
        let second = br#"{"calendar":{"weekend":[1,2,3,4,5,6,7]}}"#.to_vec();
        std::fs::write(&path, &second).unwrap();
        assert!(backup_corrupt_file_once(&path, 1024));
        assert_eq!(std::fs::read(&bak).unwrap(), second);

        // Over-cap sources are never copied.
        std::fs::write(&path, vec![b'x'; 2048]).unwrap();
        assert!(!backup_corrupt_file_once(&path, 1024));
        assert_eq!(std::fs::read(&bak).unwrap(), second);

        // A directory squatting on the .bak name is left alone.
        std::fs::remove_file(&bak).unwrap();
        std::fs::create_dir(&bak).unwrap();
        std::fs::write(&path, b"bad").unwrap();
        assert!(!backup_corrupt_file_once(&path, 1024));
        assert!(bak.is_dir());
    }

    #[test]
    fn move_aside_never_replaces_an_existing_backup() {
        let temp = TestTempDir::new("pcalc-store-aside");
        let path = temp.path().join("history.json");
        std::fs::write(&path, b"one").unwrap();
        let first = move_aside(&path).unwrap();
        assert_eq!(first, backup_path(&path).unwrap());
        assert!(path_is_missing(&path));

        std::fs::write(&path, b"two").unwrap();
        let second = move_aside(&path).unwrap();
        assert_ne!(second, first);
        assert!(second
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("history.json.bak-"));
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        assert!(move_aside(&path).is_err());
    }
}
