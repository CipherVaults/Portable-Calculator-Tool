//! Tauri commands. Thin by design (plan B2): every calculation goes through
//! the single `engine_call`, which is `pcalc_api::call`, so the desktop app
//! returns byte-for-byte what `engine.wasm` returns on the web.

use tauri::{AppHandle, State};

use crate::SmokeState;

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
    passed: bool,
    details: String,
) -> Result<(), &'static str> {
    if !state.enabled {
        return Err("smoke test mode is not enabled");
    }
    let details = sanitize_details(&details);
    let native = native_engine_check();
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
    fn app_version_matches_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(conf["identifier"], "com.portablecalculator.tool");
        assert_eq!(pcalc_api::APP_VERSION, env!("CARGO_PKG_VERSION"));
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        assert!(csp.contains("connect-src 'none'"));
        assert!(!csp.contains("wasm-unsafe-eval"));
    }
}
