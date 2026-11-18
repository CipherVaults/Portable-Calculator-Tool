//! Tauri commands. Thin by design (plan B2): every calculation goes through
//! the single `engine_call`, which is `pcalc_api::call`, so the desktop app
//! returns byte-for-byte what `engine.wasm` returns on the web. The store
//! commands are `pcalc_store::docs` (plan B10, B11): the same outcomes the
//! web adapter produces from IndexedDB.

use pcalc_api::store::Doc;
use pcalc_store::docs::{LoadOutcome, Status, StoreError};
use tauri::{AppHandle, State};

use crate::{AppStore, SmokeState};

/// Longest smoke-report `details` text kept, in characters.
const MAX_SMOKE_DETAILS_CHARS: usize = 2000;

/// The one engine command: `engine_call(op, req) -> envelope JSON`.
///
/// Size caps, UTF-8 and JSON validation all happen inside `pcalc_api` (the
/// same checks as the WASM path).
#[tauri::command]
pub fn engine_call(op: String, req: String) -> String {
    pcalc_api::call(&op, &req)
}

fn doc(name: &str) -> Result<Doc, &'static str> {
    Doc::from_name(name).ok_or(StoreError::UnknownDoc.code())
}

/// `store_load(name)`: the load outcome (`{name, status, readOnly, doc,
/// schemaVersion, backup, field}`). Also the "Retry" action.
#[tauri::command]
pub fn store_load(store: State<'_, AppStore>, name: String) -> Result<LoadOutcome, &'static str> {
    Ok(store.0.load(doc(&name)?))
}

/// `store_save(name, text)`: validates and writes atomically; answers the
/// canonical text written, or refuses with `read_only`, `invalid`,
/// `too_large` or `write_failed`.
#[tauri::command]
pub fn store_save(
    store: State<'_, AppStore>,
    name: String,
    text: String,
) -> Result<String, &'static str> {
    store.0.save(doc(&name)?, &text).map_err(StoreError::code)
}

/// `store_clear(name)`: the explicit, UI-confirmed "Start fresh": backs the
/// current file up, removes it and makes the document writable. Returns the
/// backup file name, if one was written.
#[tauri::command]
pub fn store_clear(
    store: State<'_, AppStore>,
    name: String,
) -> Result<Option<String>, &'static str> {
    store.0.clear(doc(&name)?).map_err(StoreError::code)
}

#[tauri::command]
pub fn is_smoke_test(state: State<'_, SmokeState>) -> bool {
    state.enabled
}

/// Strips control characters and bounds the renderer's report so a hostile
/// or broken page cannot flood or forge CI log lines.
fn sanitize_details(details: &str) -> String {
    details
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_SMOKE_DETAILS_CHARS)
        .collect()
}

/// The renderer's smoke verdict. Only accepted in `--smoke-test` mode; the
/// native side re-checks the engine itself before printing `SMOKE_TEST_OK`.
#[tauri::command]
pub fn report_smoke_result(
    app: AppHandle,
    state: State<'_, SmokeState>,
    store: State<'_, AppStore>,
    passed: bool,
    details: String,
) -> Result<(), &'static str> {
    if !state.enabled {
        return Err("smoke test mode is not enabled");
    }
    let details = sanitize_details(&details);
    let native = native_engine_check().and_then(|()| native_store_check(&store.0));
    match (passed, native) {
        (true, Ok(())) => {
            println!("SMOKE_TEST_OK: renderer, IPC and engine checks passed. [{details}]");
            app.exit(0);
        }
        (_, native) => {
            let native = native.err().unwrap_or_default();
            eprintln!(
                "SMOKE_TEST_FAILED: renderer_passed={passed} native=[{native}] details=[{details}]"
            );
            app.exit(1);
        }
    }
    Ok(())
}

/// The native half of the smoke test: the engine answers `meta.versions`
/// with this app's version.
fn native_engine_check() -> Result<(), String> {
    let versions: serde_json::Value = serde_json::from_str(&pcalc_api::call("meta.versions", "{}"))
        .map_err(|err| format!("meta.versions is not JSON: {err}"))?;
    if versions["ok"] != "true" {
        return Err("meta.versions failed".to_string());
    }
    if versions["result"]["app"] != env!("CARGO_PKG_VERSION") {
        return Err("pcalc-api and the app disagree on the version".to_string());
    }
    Ok(())
}

/// The native half of the store smoke: the smoke store is in memory, and
/// the renderer's round trips must have left valid settings and state in
/// it (written through `store_save`, read back through `store_load`).
fn native_store_check(store: &pcalc_store::docs::DocStore) -> Result<(), String> {
    if !store.is_memory() {
        return Err("the smoke run must use the in-memory store".to_string());
    }
    for doc in [Doc::Settings, Doc::State] {
        let out = store.load(doc);
        if out.status != Status::Ok {
            return Err(format!(
                "{} not saved by the renderer: {:?}",
                doc.name(),
                out.status
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_call_is_pcalc_api_call() {
        for (op, req) in [
            ("meta.versions", "{}"),
            (
                "date.days_between",
                r#"{"startDate":"2024-01-01","endDate":"2024-12-31","includeEndDay":false}"#,
            ),
            ("percent.tip", r#"{"bill":100,"tipPercent":20,"people":3}"#),
            ("nope", "{}"),
        ] {
            assert_eq!(engine_call(op.into(), req.into()), pcalc_api::call(op, req));
        }
    }

    #[test]
    fn native_check_passes_and_details_are_sanitised() {
        assert_eq!(native_engine_check(), Ok(()));
        assert_eq!(sanitize_details("a\nb\u{1b}[31m"), "a b [31m");
        assert_eq!(
            sanitize_details(&"x".repeat(MAX_SMOKE_DETAILS_CHARS + 10)).len(),
            MAX_SMOKE_DETAILS_CHARS
        );
    }

    #[test]
    fn store_check_needs_the_renderer_round_trips() {
        let store = pcalc_store::docs::DocStore::memory();
        assert!(native_store_check(&store).is_err());
        store
            .put_raw(Doc::State, br#"{"schemaVersion":1,"route":"about","pane":{"open":false,"tab":"history"},"dev":{"pseudoLocale":"off"}}"#)
            .unwrap();
        assert!(native_store_check(&store)
            .unwrap_err()
            .starts_with("settings"));
        assert_eq!(doc("history"), Ok(Doc::History));
        assert_eq!(doc("../settings"), Err("unknown_doc"));
        let disk =
            pcalc_store::docs::DocStore::in_dir(std::env::temp_dir().join("pcalc-never-written"));
        assert!(native_store_check(&disk).is_err());
    }

    /// The window background at creation equals each theme's --bg token.
    #[test]
    fn window_backgrounds_match_the_theme_tokens() {
        let tokens = include_str!("../../web/styles/tokens.css");
        for theme in ["terminal", "daylight", "retro"] {
            let block = tokens
                .split(&format!("[data-theme=\"{theme}\"]"))
                .nth(1)
                .unwrap_or_else(|| panic!("no {theme} block"));
            let bg = block
                .split("--bg:")
                .nth(1)
                .unwrap()
                .split(';')
                .next()
                .unwrap()
                .trim();
            let tauri::window::Color(r, g, b, a) = crate::theme_background(theme);
            assert_eq!(
                bg.to_ascii_uppercase(),
                format!("#{r:02X}{g:02X}{b:02X}"),
                "{theme}"
            );
            assert_eq!(a, 255);
        }
        let tauri::window::Color(r, g, b, _) = crate::theme_background("system");
        assert_eq!((r, g, b), (0x0E, 0x0F, 0x12));
    }

    #[test]
    fn app_version_matches_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(conf["identifier"], "com.portablecalculator.tool");
        assert_eq!(pcalc_api::APP_VERSION, env!("CARGO_PKG_VERSION"));
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        assert!(csp.contains("connect-src 'none'"));
        assert!(!csp.contains("wasm-unsafe-eval"));
        // The main window is created in main.rs (with the theme's
        // background), so the config declares none.
        assert_eq!(conf["app"]["windows"], serde_json::json!([]));
    }
}
