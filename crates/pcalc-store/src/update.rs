//! The GitHub "latest release" update check (from the Date Calculator's
//! `commands.rs`), parameterised by an [`AppIdentity`].
//!
//! The request is a payload-free HTTPS GET through the system `curl`
//! (`--proto =https`, TLS 1.2+, 8 s timeout, 64 KiB cap). The response is
//! parsed by [`parse_github_release_json`], which skips drafts and
//! prereleases, requires a semver tag, and only accepts a release URL under
//! the identity's own `/releases/` path.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

/// Longest accepted release URL, in bytes.
const MAX_URL_LEN: usize = 256;

/// Longest accepted `published_at`, in bytes.
const MAX_PUBLISHED_AT_LEN: usize = 64;

/// Largest release JSON curl may download.
const MAX_RELEASE_JSON_BYTES: &str = "65536";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Who is asking: `{repoUrl, userAgent, sentinel}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    /// `https://github.com/<owner>/<repo>` (no trailing slash).
    pub repo_url: String,
    /// The `User-Agent` product token, e.g. `Portable-Calculator-Tool/1.0.0`.
    pub user_agent: String,
    /// The clipboard sentinel the `--smoke-test` run writes and reads back.
    pub sentinel: String,
}

impl AppIdentity {
    /// Validates and builds an identity: `repo_url` must be
    /// `https://github.com/<owner>/<repo>` with ASCII `[A-Za-z0-9._-]` names;
    /// `user_agent` 1..=128 printable ASCII bytes; `sentinel` 1..=64
    /// printable ASCII bytes.
    pub fn new(repo_url: &str, user_agent: &str, sentinel: &str) -> Result<Self, String> {
        let path = repo_url
            .strip_prefix("https://github.com/")
            .ok_or_else(|| "repoUrl must start with https://github.com/".to_string())?;
        let mut parts = path.split('/');
        let name_ok = |s: &str| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        };
        match (parts.next(), parts.next(), parts.next()) {
            (Some(owner), Some(repo), None) if name_ok(owner) && name_ok(repo) => {}
            _ => return Err("repoUrl must be https://github.com/<owner>/<repo>".to_string()),
        }
        let printable = |s: &str, max: usize| {
            !s.is_empty() && s.len() <= max && s.bytes().all(|b| (0x20..0x7F).contains(&b))
        };
        if !printable(user_agent, 128) {
            return Err("userAgent must be 1..=128 printable ASCII bytes".to_string());
        }
        if !printable(sentinel, 64) {
            return Err("sentinel must be 1..=64 printable ASCII bytes".to_string());
        }
        Ok(AppIdentity {
            repo_url: repo_url.to_string(),
            user_agent: user_agent.to_string(),
            sentinel: sentinel.to_string(),
        })
    }

    /// `https://api.github.com/repos/<owner>/<repo>/releases/latest`.
    pub fn latest_release_api(&self) -> String {
        let path = self
            .repo_url
            .strip_prefix("https://github.com/")
            .unwrap_or_default();
        format!("https://api.github.com/repos/{path}/releases/latest")
    }

    /// `<repoUrl>/releases/latest`: the fallback release page.
    pub fn releases_url(&self) -> String {
        format!("{}/releases/latest", self.repo_url)
    }

    /// `<repoUrl>/releases/`: the only accepted release URL prefix.
    pub fn releases_prefix(&self) -> String {
        format!("{}/releases/", self.repo_url)
    }
}

/// The update check result returned to the UI.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    /// The check itself worked.
    pub ok: bool,
    /// A newer, non-draft, non-prerelease version exists.
    pub update_available: bool,
    /// The running version.
    pub current_version: String,
    /// The latest release's `major.minor.patch`.
    pub latest_version: Option<String>,
    /// A sanitised release page URL.
    pub release_url: String,
    /// The release date text, when short and non-blank.
    pub published_at: Option<String>,
    /// Why the check failed.
    pub error: Option<String>,
}

impl UpdateCheckResult {
    /// A failed check.
    pub fn failed(identity: &AppIdentity, current_version: &str, error: String) -> Self {
        UpdateCheckResult {
            ok: false,
            update_available: false,
            current_version: current_version.to_string(),
            latest_version: None,
            release_url: identity.releases_url(),
            published_at: None,
            error: Some(error),
        }
    }
}

#[derive(Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
}

/// `v1.2.3`, `V1.2.3`, `1.2.3-beta+x` -> `(1, 2, 3)`; anything else `None`.
pub fn parse_semver_triplet(version_or_tag: &str) -> Option<(u64, u64, u64)> {
    let trimmed = version_or_tag.trim();
    let without_v = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    let core = without_v.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let parse_part = |s: &str| -> Option<u64> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse::<u64>().ok()
    };
    let major = parse_part(parts.next()?)?;
    let minor = parse_part(parts.next()?)?;
    let patch = parse_part(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// `candidate_tag` is a strictly newer semver than `current`.
pub fn is_newer_version(current: &str, candidate_tag: &str) -> bool {
    match (
        parse_semver_triplet(current),
        parse_semver_triplet(candidate_tag),
    ) {
        (Some(cur), Some(cand)) => cand > cur,
        _ => false,
    }
}

/// Parses GitHub's `releases/latest` JSON for `identity`.
pub fn parse_github_release_json(
    identity: &AppIdentity,
    current_version: &str,
    bytes: &[u8],
) -> Result<UpdateCheckResult, String> {
    let parsed: GitHubReleaseResponse =
        serde_json::from_slice(bytes).map_err(|err| format!("invalid release JSON: {err}"))?;
    if parsed.draft || parsed.prerelease {
        return Ok(UpdateCheckResult {
            ok: true,
            update_available: false,
            current_version: current_version.to_string(),
            latest_version: None,
            release_url: identity.releases_url(),
            published_at: None,
            error: None,
        });
    }
    let (maj, min, patch) = parse_semver_triplet(&parsed.tag_name)
        .ok_or_else(|| "invalid release tag format".to_string())?;
    let latest_version = format!("{maj}.{min}.{patch}");
    let prefix = identity.releases_prefix();
    let release_url = parsed
        .html_url
        .filter(|u| {
            u.starts_with(&prefix)
                && u.len() <= MAX_URL_LEN
                && !u.contains("..")
                && !u.contains('\\')
                && !u.chars().any(|c| c.is_whitespace() || c.is_control())
        })
        .unwrap_or_else(|| identity.releases_url());
    let published_at = parsed
        .published_at
        .filter(|s| !s.trim().is_empty() && s.len() <= MAX_PUBLISHED_AT_LEN);

    Ok(UpdateCheckResult {
        ok: true,
        update_available: is_newer_version(current_version, &parsed.tag_name),
        current_version: current_version.to_string(),
        latest_version: Some(latest_version),
        release_url,
        published_at,
        error: None,
    })
}

/// `%SystemRoot%\System32\<name>` (never a PATH lookup).
#[cfg(windows)]
pub fn windows_system32_tool(name: &str) -> PathBuf {
    let fallback = PathBuf::from(r"C:\Windows");
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_dir())
        .unwrap_or(fallback);
    root.join("System32").join(name)
}

/// The `curl` executable used for the check.
fn curl_path() -> PathBuf {
    #[cfg(windows)]
    {
        windows_system32_tool("curl.exe")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("curl")
    }
}

/// Runs the update check (blocking; call it off the UI thread). Never
/// panics; every failure is an `ok: false` result with a short,
/// control-character-free reason.
pub fn check_for_updates_blocking(
    identity: &AppIdentity,
    current_version: &str,
) -> UpdateCheckResult {
    let mut cmd = Command::new(curl_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let user_agent = format!("User-Agent: {}", identity.user_agent);
    let output = cmd
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--location",
            "--max-time",
            "8",
            "--max-filesize",
            MAX_RELEASE_JSON_BYTES,
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--tlsv1.2",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            &user_agent,
            &identity.latest_release_api(),
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            parse_github_release_json(identity, current_version, &out.stdout)
                .unwrap_or_else(|err| UpdateCheckResult::failed(identity, current_version, err))
        }
        Ok(out) => {
            let raw_err = String::from_utf8_lossy(&out.stderr);
            let sanitized: String = raw_err
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .collect();
            let collapsed = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
            let msg = if collapsed.is_empty() {
                format!("Update check failed (status {})", out.status)
            } else {
                collapsed.chars().take(180).collect()
            };
            UpdateCheckResult::failed(identity, current_version, msg)
        }
        Err(_) => UpdateCheckResult::failed(
            identity,
            current_version,
            "Failed to launch curl for update check".to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn date_identity() -> AppIdentity {
        AppIdentity::new(
            "https://github.com/CipherVaults/Date-Calculator-Tool",
            "Date-Calculator-Tool/1.0.0",
            "date-tool-smoke-test",
        )
        .unwrap()
    }

    fn releases_url() -> String {
        "https://github.com/CipherVaults/Date-Calculator-Tool/releases/latest".to_string()
    }

    #[test]
    fn identity_derives_urls_and_validates_input() {
        let id = AppIdentity::new(
            "https://github.com/CipherVaults/Portable-Calculator-Tool",
            "Portable-Calculator-Tool/0.1.0",
            "portable-calc-smoke-test",
        )
        .unwrap();
        assert_eq!(
            id.latest_release_api(),
            "https://api.github.com/repos/CipherVaults/Portable-Calculator-Tool/releases/latest"
        );
        assert_eq!(
            id.releases_url(),
            "https://github.com/CipherVaults/Portable-Calculator-Tool/releases/latest"
        );
        assert_eq!(
            id.releases_prefix(),
            "https://github.com/CipherVaults/Portable-Calculator-Tool/releases/"
        );
        for bad in [
            "http://github.com/a/b",
            "https://github.com/a",
            "https://github.com/a/b/",
            "https://github.com/a/b/c",
            "https://github.com/../b",
            "https://github.com/a/b c",
            "https://evil.example/a/b",
            "https://github.com.evil/a/b",
        ] {
            assert!(AppIdentity::new(bad, "ua", "s").is_err(), "{bad}");
        }
        let repo = "https://github.com/a/b";
        assert!(AppIdentity::new(repo, "", "s").is_err());
        assert!(AppIdentity::new(repo, "ua\n", "s").is_err());
        assert!(AppIdentity::new(repo, &"u".repeat(129), "s").is_err());
        assert!(AppIdentity::new(repo, "ua", "").is_err());
        assert!(AppIdentity::new(repo, "ua", &"s".repeat(65)).is_err());
    }

    #[test]
    fn semver_comparison_and_release_json_parsing_work() {
        let id = date_identity();
        assert_eq!(parse_semver_triplet("v1.0.0"), Some((1, 0, 0)));
        assert_eq!(parse_semver_triplet("V1.2.0"), Some((1, 2, 0)));
        assert_eq!(parse_semver_triplet("1.10.0-beta.1"), Some((1, 10, 0)));
        assert_eq!(parse_semver_triplet("invalid"), None);
        assert_eq!(parse_semver_triplet("vv1.2.0"), None);
        assert_eq!(parse_semver_triplet("1.+10.0"), None);
        assert_eq!(parse_semver_triplet("1..0"), None);
        assert_eq!(parse_semver_triplet("1.1.0.4"), None);
        assert_eq!(parse_semver_triplet("1.1"), None);

        assert!(is_newer_version("1.0.0", "v1.1.0"));
        assert!(is_newer_version("1.0.0", "v1.0.1"));
        assert!(!is_newer_version("1.0.0", "v1.0.0"));
        assert!(!is_newer_version("1.0.1", "v1.0.0"));
        assert!(!is_newer_version("1.0.0", "vv1.1.0"));

        let payload = br#"{
            "tag_name": "v1.0.1",
            "html_url": "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.0.1",
            "published_at": "2026-11-20T12:00:00Z"
        }"#;
        let parsed = parse_github_release_json(&id, "1.0.0", payload).unwrap();
        assert!(parsed.ok);
        assert!(parsed.update_available);
        assert_eq!(parsed.latest_version.as_deref(), Some("1.0.1"));
        assert_eq!(
            parsed.release_url,
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.0.1"
        );

        let untrusted_url_payload = br#"{
            "tag_name": "v1.0.0",
            "html_url": "https://evil.example.com/phish"
        }"#;
        let sanitized = parse_github_release_json(&id, "1.0.0", untrusted_url_payload).unwrap();
        assert!(!sanitized.update_available);
        assert_eq!(sanitized.release_url, releases_url());

        // Another app's release page is not accepted for this identity.
        let sibling = br#"{
            "tag_name": "v9.0.0",
            "html_url": "https://github.com/CipherVaults/Percentage-Calculator-Tool/releases/tag/v9.0.0"
        }"#;
        assert_eq!(
            parse_github_release_json(&id, "1.0.0", sibling)
                .unwrap()
                .release_url,
            releases_url()
        );

        assert!(parse_github_release_json(&id, "1.0.0", b"not json").is_err());
        assert!(parse_github_release_json(&id, "1.0.0", br#"{"tag_name":"latest"}"#).is_err());
        assert!(parse_github_release_json(&id, "1.0.0", br#"{"draft":false}"#).is_err());
    }

    #[test]
    fn release_json_rejects_draft_prerelease_long_published_at_and_bad_urls() {
        let id = date_identity();
        for flag in ["draft", "prerelease"] {
            let payload = json!({
                "tag_name": "v99.0.0",
                flag: true,
                "html_url": "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v99.0.0",
                "published_at": "2026-11-16T12:00:00Z"
            });
            let res =
                parse_github_release_json(&id, "1.0.0", &serde_json::to_vec(&payload).unwrap())
                    .unwrap();
            assert!(res.ok);
            assert!(!res.update_available);
            assert_eq!(res.latest_version, None);
            assert_eq!(res.release_url, releases_url());
            assert_eq!(res.published_at, None);
            assert_eq!(res.error, None);
        }

        // Draft/prerelease is skipped before semver parsing.
        let draft_non_semver = br#"{
            "tag_name": "nightly-draft",
            "draft": true
        }"#;
        let draft_res = parse_github_release_json(&id, "1.0.0", draft_non_semver).unwrap();
        assert!(draft_res.ok);
        assert!(!draft_res.update_available);
        assert_eq!(draft_res.latest_version, None);

        let exact_64 = "T".repeat(64);
        let over_65 = "T".repeat(65);
        for (published, expected_some) in [
            (exact_64.as_str(), true),
            (over_65.as_str(), false),
            ("   \t ", false),
        ] {
            let payload = json!({
                "tag_name": "v1.1.0",
                "published_at": published
            });
            let res =
                parse_github_release_json(&id, "1.0.0", &serde_json::to_vec(&payload).unwrap())
                    .unwrap();
            assert_eq!(res.published_at.is_some(), expected_some);
        }

        for bad_url in [
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/../evil",
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.1.0\\evil",
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.1.0 extra",
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.1.0\n",
            "https://github.com/CipherVaults/Date-Calculator-Tool/releases/tag/v1.1.0\0",
            "https://github.com/CipherVaults/Date-Calculator-Tool/releasesX/tag/v1.1.0",
        ] {
            let payload = json!({
                "tag_name": "v1.1.0",
                "html_url": bad_url
            });
            let res =
                parse_github_release_json(&id, "1.0.0", &serde_json::to_vec(&payload).unwrap())
                    .unwrap();
            assert_eq!(
                res.release_url,
                releases_url(),
                "bad html_url must fall back: {bad_url:?}"
            );
        }
    }

    #[test]
    fn failed_result_shape() {
        let id = date_identity();
        let res = UpdateCheckResult::failed(&id, "1.0.0", "offline".into());
        assert!(!res.ok && !res.update_available);
        assert_eq!(res.release_url, releases_url());
        assert_eq!(res.error.as_deref(), Some("offline"));
        assert_eq!(
            serde_json::to_value(&res).unwrap()["currentVersion"],
            "1.0.0"
        );
    }
}
