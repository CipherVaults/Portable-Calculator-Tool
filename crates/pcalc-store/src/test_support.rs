//! Test helpers: unique temporary directories and best-effort symlinks.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// A unique directory under the system temp dir, removed on drop.
pub(crate) struct TestTempDir {
    path: PathBuf,
}

impl TestTempDir {
    pub(crate) fn new(prefix: &str) -> Self {
        let base = std::env::temp_dir();
        std::fs::create_dir_all(&base).unwrap();
        let tid: String = format!("{:?}", std::thread::current().id())
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect();
        for _ in 0..32 {
            let seq = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = base.join(format!("{prefix}-{}-{tid}-{seq}", std::process::id()));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Self { path: dir },
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => panic!("failed to create test temp dir {}: {err}", dir.display()),
            }
        }
        panic!("exhausted attempts to allocate unique test temp dir");
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestTempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Creates a file symlink. On Unix this always succeeds or panics, so the
/// symlink checks can never be skipped there. Only Windows may return
/// `None`, where the OS refuses without Developer Mode or the symlink
/// privilege.
pub(crate) fn try_symlink_file(target: &Path, link: &Path) -> Option<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).expect("create test symlink");
        Some(())
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link).ok()
    }
}
