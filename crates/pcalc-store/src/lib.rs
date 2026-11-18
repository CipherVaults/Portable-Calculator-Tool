//! pcalc-store: the native-only side of Portable Calculator Tool.
//!
//! Factored out of the Date Calculator's `src-tauri/src/commands.rs` (and
//! shared with the Percentage Calculator's design) so the desktop app keeps
//! one hardened implementation:
//!
//! - [`fs`]: size-capped, symlink-refusing reads; private parent
//!   directories; atomic writes through a unique temporary file; the
//!   backup-once rule for corrupt files and move-aside for unreadable ones.
//! - [`docs`]: the durable document store (plan B10, B11) for `settings`,
//!   `state`, `history` and `countdowns`: every load decides through the
//!   `<name>.validate` op (`pcalc_api::store::check`), read-only on any
//!   non-NotFound failure, timestamped backups (newest 3) before anything
//!   corrupt can be replaced, and an in-memory variant for smoke tests.
//! - [`update`]: the payload-free GitHub "latest release" check, release
//!   JSON parsing with URL sanitising, and semver comparison, parameterised
//!   by an [`update::AppIdentity`] `{repoUrl, userAgent, sentinel}` instead
//!   of the old per-app constants.
//!
//! This crate (with `pcalc-wasm`) is the only place allowed I/O. It never
//! builds for `wasm32`; the web app's storage is IndexedDB in JS (plan B10).
#![forbid(unsafe_code)]
#![cfg(not(target_arch = "wasm32"))]

pub mod docs;
pub mod fs;
pub mod update;

#[cfg(test)]
pub(crate) mod test_support;
