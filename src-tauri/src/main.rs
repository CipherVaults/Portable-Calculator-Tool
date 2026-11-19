// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

mod commands;

use std::time::Duration;

use pcalc_store::docs::DocStore;
use tauri::window::Color;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Whether the process runs the `--smoke-test` self-check.
pub struct SmokeState {
    pub enabled: bool,
}

/// The document store (plan B10, B11): `%APPDATA%\com.portablecalculator.tool`
/// normally, in memory for `--smoke-test` (which never touches real data).
pub struct AppStore(pub DocStore);

/// How long the renderer has to report before the smoke test fails.
const SMOKE_WATCHDOG: Duration = Duration::from_secs(30);

/// The concrete theme for a stored preference: `system` follows the OS
/// as the pre-paint script does (light -> Daylight, otherwise Terminal);
/// an unknown OS theme counts as dark.
pub fn resolve_theme(pref: &'static str, os: Option<tauri::Theme>) -> &'static str {
    match (pref, os) {
        ("system", Some(tauri::Theme::Light)) => "daylight",
        ("system", _) => "terminal",
        (other, _) => other,
    }
}

/// The window background per concrete theme (plan B5b: no flash of the
/// wrong theme). Each value equals the theme's `--bg` in
/// `web/styles/tokens.css` (a test checks it). Anything else, `system`
/// included, is Terminal's; main() resolves `system` first.
pub fn theme_background(theme: &str) -> Color {
    match theme {
        "daylight" => Color(0xF4, 0xF1, 0xEA, 0xFF),
        "retro" => Color(0x00, 0x80, 0x80, 0xFF),
        _ => Color(0x0E, 0x0F, 0x12, 0xFF),
    }
}

fn main() {
    let smoke_enabled = std::env::args().any(|arg| arg == "--smoke-test");

    tauri::Builder::default()
        .manage(SmokeState {
            enabled: smoke_enabled,
        })
        .setup(move |app| {
            let store = if smoke_enabled {
                DocStore::memory()
            } else {
                DocStore::in_dir(app.path().app_data_dir()?)
            };
            let theme = store.theme();
            app.manage(AppStore(store));

            // Created here, not in tauri.conf.json, so the background is
            // the stored theme's from the very first frame. The window is
            // built hidden: for `system` (the default) the OS theme is only
            // known once the window exists, and a light OS must not see a
            // dark first frame.
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Portable Calculator Tool")
                .inner_size(1120.0, 860.0)
                .min_inner_size(360.0, 560.0)
                .center()
                .background_color(theme_background(resolve_theme(theme, None)))
                .visible(false)
                .build()?;
            if theme == "system" {
                let resolved = resolve_theme(theme, window.theme().ok());
                window.set_background_color(Some(theme_background(resolved)))?;
            }
            if !smoke_enabled {
                window.show()?;
            }

            if smoke_enabled {
                // Safety watchdog so a broken renderer cannot hang CI forever.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(SMOKE_WATCHDOG);
                    eprintln!("SMOKE_TEST_TIMEOUT: renderer did not report within 30s.");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::engine_call,
            commands::store_load,
            commands::store_save,
            commands::store_save_if,
            commands::store_clear,
            commands::export_file,
            commands::is_smoke_test,
            commands::report_smoke_result,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Portable Calculator Tool");
}
