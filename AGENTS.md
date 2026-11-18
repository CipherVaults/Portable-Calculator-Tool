# Agent entry: Portable Calculator Tool

This file holds the project's persistent execution instructions for AI and human collaborators. It is not the current task and grants no permission. The owner's latest bounded request or approved Goal defines current work (see [Current State](Documentation/pbs/CURRENT_STATE.md#current-authority)).

**Applies to:** the Rust workspace (`crates/*`, `src-tauri`), the shared frontend (`web/`), `scripts/`, CI and documentation.
**Siblings / sources:** `CipherVaults/Date-Calculator-Tool` (date-core, hardened storage, smoke test, CI) and `CipherVaults/Percentage-Calculator-Tool` v2.3.0 (percent-core). This app replaces both; their repos are never modified from here.

## Read the smallest sufficient context

1. The owner's request, then [Current State](Documentation/pbs/CURRENT_STATE.md) and [Continuation](Documentation/pbs/CONTINUATION_STATE.md).
2. [Source & Ownership Map](Documentation/pbs/SOURCE_OWNERSHIP_MAP.md) for who owns each answer.
3. Design: [`Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`](Documentation/specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B. The **owner clarifications at the top override the body** (no legacy migration, standing authority for fixes and hardening, phone-first web app).

## Project conventions

- **Engine purity.** `date-core`, `percent-core`, `calc-num`, `calc-core`, `units-core` and `graph-core` are pure: `#![forbid(unsafe_code)]`, serde only (the one exception is `graph-core` -> `libm`), no clock, no time zone, no locale, no I/O, no panics on any input. "Today" and "now" are always inputs.
- **One API.** Every surface calls `pcalc_api::call(op, req) -> String`. `pcalc-api` follows the engine rules but may use `serde_json` (it declares `float_roundtrip` itself so native and WASM parse floats identically). Ops are a closed list; unknown ops return `unknown_op`; per-op request caps return `request_too_large`.
- **Unsafe and I/O live in two crates only.** `pcalc-wasm` (`#![deny(unsafe_code)]`, `allow` only on the `#[unsafe(no_mangle)]` exports) and `pcalc-store` (native file I/O, update check). Nothing else touches the file system or the network.
- **Result envelope.** date-core's everywhere: `{"ok":"true","result":...}` / `{"ok":"false","error":{"code","field","message"}}`; camelCase JSON; `deny_unknown_fields` on every request struct.
- **Fixtures.** `crates/date-core/tests/fixtures/vectors.json` and `crates/percent-core/tests/fixtures/golden.json` are hand-verified or inherited oracles and are never regenerated to make code pass. `crates/date-core/tests/fixtures/golden.json` is regenerated only for an intentional engine change (`cargo run -p date-core --example gen_golden -- --write`), and CI runs `--check`.
- **Native = WASM.** `node scripts/check-wasm.mjs` replays every golden case through the native bridges and the built `engine.wasm` and must byte-match.
- **DOM safety.** `textContent` / `createElement` / `replaceChildren` only. No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`. Scripts toggle classes and never set `.style`.
- **CSP.** Desktop (`tauri.conf.json`): `connect-src 'none'`, no `'wasm-unsafe-eval'`. Web: the meta CSP from plan B3, written by `scripts/build-web.mjs`. Never put `frame-ancestors` in a meta CSP. Any byte change to an inline script or style needs its SHA-256 recomputed (the build does this).
- **Colours and themes.** Every colour, border, radius and font comes from custom properties in `web/styles/tokens.css`. No raw colour literal outside it.
- **Wording.** UI text comes from `web/i18n/<lang>.json` catalogs from day one; engines stay language-free.
- **Line endings.** `git config core.autocrlf false`; `.gitattributes` forces LF on every text file because CSP hashes, the WASM hash and fixtures are byte-exact.
- **Versions.** The **app** version must match in `src-tauri/tauri.conf.json`, the `src-tauri`, `pcalc-api` and `pcalc-wasm` `Cargo.toml` files, `web/build-manifest.json` (`appVersion`) and the footers; `node scripts/check-versions.mjs` enforces it. **Engine** versions are separate: each engine asserts `ENGINE_VERSION == CARGO_PKG_VERSION`, its golden header carries that version, and it changes only with engine behaviour.
- **Stored structs.** Any field change to a stored struct (history, settings, state, countdowns) bumps its `schemaVersion`.
- **Windows.** Run Cargo/Tauri from **PowerShell**, never Git Bash: Git Bash's `/usr/bin/link` shadows the MSVC linker. Node and git are fine in either shell.

## Git & GitHub rhythm

Commits follow the owner's *Git & GitHub Rhythm* (Claude skill `git-github-rhythm`).

- **Branches:** work happens on `dev`. `main` is reached only by PR from `dev`. The first `main` commit has **no `.github/workflows`**, so `main` can exist as a PR base without triggering a release.
- **Who does what:**
  - The coordinating maintainer integrates, commits and pushes `dev`. Parallel agents edit files but do not commit.
  - Creating the GitHub repository, adding a remote, enabling Pages, merging to `main`, tags and releases need the owner's explicit yes.
- **One coherent step per commit.** Stage explicit paths, never a blanket `git add -A` while other agents are editing. Read the staged diff before committing.
- **Message format:**
  - A plain-language subject.
  - A bullet body with `Why / Changed / Checks / Remaining`. `Checks` names the real commands and results, and says what was not run.
  - Unfinished work is preserved as `WIP:`.
  - Every commit ends with the required `Co-Authored-By:` trailer.
- **Push and verify** (once a remote exists): push after each verified milestone; verify with `git ls-remote origin dev` against `git rev-parse HEAD`; never force-push.
- **Receipts** (SHA, checks, not covered) go in the closing report and, for milestones, in the [Execution & Coding Ledger](Documentation/pbs/EXECUTION_AND_CODING_LEDGER.md).

## Permission checks

- Private per-device state must not be read, cleared or exported without owner authority: `%APPDATA%\com.portablecalculator.tool\*`, the old apps' `%APPDATA%\com.datecalculator.tool\*` and Percentage Calculator data, browser `localStorage`, IndexedDB and PWA caches.
- Pushing to `main`, tags and releases is outward-facing and needs the owner's explicit yes.

## Verification workflow

```powershell
node scripts/build-web.mjs --desktop-only   # src-tauri embeds dist/desktop at compile time
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo clippy -p pcalc-api -p pcalc-wasm -p date-core -p percent-core -p calc-num -p calc-core -p units-core -p graph-core --target wasm32-unknown-unknown --locked -- -D warnings
cargo test --workspace --locked
cargo run -p date-core --example gen_golden --locked -- --check
node scripts/build-wasm.mjs                 # cargo build -p pcalc-wasm --target wasm32-unknown-unknown --profile wasm --locked, with local paths remapped
node scripts/build-web.mjs
cargo build --release --locked -p pcalc-api -p date-core -p percent-core --examples
node scripts/check-wasm.mjs
node scripts/check-versions.mjs
node scripts/check-unsafe.mjs
cargo run -p portable-calculator-tool --locked -- --smoke-test
```

Build `engine.wasm` through `scripts/build-wasm.mjs`: a bare `cargo build` embeds the local cargo-home path (with the user name) in panic-location strings. The CI equivalent is `.github/workflows/ci.yml` (on `dev` only; no release job before M10). Every Action is SHA-pinned with `persist-credentials: false` and `permissions: contents: read`.

## Reporting and stopping

Report the concrete result, the exact artifacts each check applied to, what was not run, and the next permitted action. Update only the PBS records whose answers changed.
