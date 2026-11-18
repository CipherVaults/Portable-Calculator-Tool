// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

mod commands;

use std::time::Duration;
use tauri::Manager;

/// Whether the process runs the `--smoke-test` self-check.
pub struct SmokeState {
    pub enabled: bool,
}

/// How long the renderer has to report before the smoke test fails.
const SMOKE_WATCHDOG: Duration = Duration::from_secs(20);

fn main() {
    let smoke_enabled = std::env::args().any(|arg| arg == "--smoke-test");

    tauri::Builder::default()
        .manage(SmokeState {
            enabled: smoke_enabled,
        })
        .setup(move |app| {
            // M0 keeps no files at all; from M2a the smoke run keeps every
            // store in memory and never touches the real app data.
            if smoke_enabled {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                // Safety watchdog so a broken renderer cannot hang CI forever.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(SMOKE_WATCHDOG);
                    eprintln!("SMOKE_TEST_TIMEOUT: renderer did not report within 20s.");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine_call,
            commands::is_smoke_test,
            commands::report_smoke_result,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Portable Calculator Tool");
}
