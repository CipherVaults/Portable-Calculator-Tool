# Agent entry: Portable Calculator Tool

This file holds the project's persistent execution instructions for AI and human collaborators. It is not the current task and grants no permission. The owner's latest bounded request or approved Goal defines current work (see [Current State](Documentation/pbs/CURRENT_STATE.md#current-authority)).

**Applies to:** the Rust workspace (`crates/*`, `src-tauri`), the shared frontend (`web/`), `scripts/`, CI and documentation.
**Siblings / sources:** `CipherVaults/Date-Calculator-Tool` (date-core, hardened storage, smoke test, CI) and `CipherVaults/Percentage-Calculator-Tool` v2.3.0 (percent-core). This app replaces both; their repos are never modified from here.

## Read the smallest sufficient context

1. The owner's request, then [Current State](Documentation/pbs/CURRENT_STATE.md) and [Continuation](Documentation/pbs/CONTINUATION_STATE.md).
2. [Source & Ownership Map](Documentation/pbs/SOURCE_OWNERSHIP_MAP.md) for who owns each answer.
3. Design: [`Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md`](Documentation/specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B. The **owner clarifications at the top override the body** (no legacy migration, standing authority for fixes and hardening, phone-first web app).

## Project conventions

- **Engine purity.** `date-core`, `percent-core`, `calc-num`, `calc-core`, `units-core` and `graph-core` are pure: `#![forbid(unsafe_code)]`, serde only (the one exception is `graph-core` -> `libm`), no clock, no time zone, no locale, no I/O, no panics on any input (`check-unsafe.mjs` refuses `unwrap()`, `expect(…)`, `panic!`, `unreachable!`, `todo!` and `unimplemented!` in their non-test code and in `pcalc-api`). "Today" and "now" are always inputs.
- **One API.** Every surface calls `pcalc_api::call(op, req) -> String`. `pcalc-api` follows the engine rules but may use `serde_json` (it declares `float_roundtrip` itself so native and WASM parse floats identically). Ops are a closed list; unknown ops return `unknown_op`; per-op request caps return `request_too_large`.
- **Unsafe and I/O live in two crates only.** `pcalc-wasm` (`#![deny(unsafe_code)]`, `allow` only on the `#[unsafe(no_mangle)]` exports) and `pcalc-store` (native file I/O, update check). Nothing else touches the file system or the network.
- **Result envelope.** date-core's everywhere: `{"ok":"true","result":...}` / `{"ok":"false","error":{"code","field","message"}}`; camelCase JSON; `deny_unknown_fields` on every request struct.
- **Fixtures.** `crates/date-core/tests/fixtures/vectors.json` and `crates/percent-core/tests/fixtures/golden.json` are hand-verified or inherited oracles and are never regenerated to make code pass. `crates/date-core/tests/fixtures/golden.json` is regenerated only for an intentional engine change (`cargo run -p date-core --example gen_golden -- --write`), and CI runs `--check`.
- **Native = WASM.** `node scripts/check-wasm.mjs` replays every golden case through the native bridges and the built `engine.wasm` and must byte-match.
- **DOM safety.** `textContent` / `createElement` / `replaceChildren` only. No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function`. Scripts toggle classes and never set `.style`.
- **CSP.** Desktop (`tauri.conf.json`): `connect-src 'none'`, no `'wasm-unsafe-eval'`. Web: the meta CSP from plan B3, written by `scripts/build-web.mjs`, plus `require-trusted-types-for 'script'` (the one policy, `pcalc` in `boot.js`, passes only `sw.js`; the single file allows none). Never put `frame-ancestors` in a meta CSP. Any byte change to an inline script or style needs its SHA-256 recomputed (the build does this).
- **Colours and themes.** Every colour, border, radius and font comes from custom properties in `web/styles/tokens.css`. No raw colour literal outside it. Each theme (`terminal`, `daylight`, `retro`) defines the same tokens and passes WCAG AA (`check-web.mjs`); a new token or pair goes into every theme block and into `PAIRS`.
- **RTL.** Layout CSS uses logical properties only (`margin-inline-start`, `inset-inline-end`, `text-align: start`); physical left/right is refused by the build unless the line carries a `/* physical-ok: <reason> */` comment.
- **Wording.** UI text comes from `web/i18n/<lang>.json` catalogs from day one (`t("key", {params})`, plural objects keyed by CLDR category); engines stay language-free. Numbers and dates are formatted by `web/src/core/format.js` tables, never `Intl`. `check-i18n.mjs` fails on an unused key or a call to a missing one.
- **Stores.** `settings`, `state`, `history` and `countdowns` are validated only by the engine ops `<name>.validate` (`pcalc-api/src/store.rs`); the desktop (`pcalc-store/src/docs.rs`) and the web (`web/src/core/store.js`, IndexedDB `pcalc`/`docs`) give the same outcomes: any non-NotFound failure is read-only, corrupt is backed up first (newest 3), newer and `request_too_large` are never written or backed up.
- **Tools.** A tool is a module under `web/src/tools/<tool>/` that `views.js` renders for its route and tells to `leave()` (stop timers, flush) when another route renders. Engine calls only through `ctx.platform.engine(op, req)`. Explicit actions record through `PCalc.history.record(entry)` (a memory queue until M3 attaches the store); live updates never record. Card order and collapsed cards live in `settings.<tool>` and go through `web/src/shell/card-layout.js`. Countdowns are the `countdowns` document, written only on a commit (and once per target for `finishedSeenAtMs`), never on a tick.
- **Line endings.** `git config core.autocrlf false`; `.gitattributes` forces LF on every text file because CSP hashes, the WASM hash and fixtures are byte-exact.
- **Versions.** The **app** version must match in `src-tauri/tauri.conf.json`, the `src-tauri`, `pcalc-api` and `pcalc-wasm` `Cargo.toml` files, `web/build-manifest.json` (`appVersion`) and the footers; `node scripts/check-versions.mjs` enforces it. **Engine** versions are separate: each engine asserts `ENGINE_VERSION == CARGO_PKG_VERSION`, its golden header carries that version, and it changes only with engine behaviour.
- **Stored structs.** Any field change to a stored struct (history, settings, state, countdowns) bumps its `schemaVersion`.
- **Windows.** Run Cargo/Tauri from **PowerShell**, never Git Bash: Git Bash's `/usr/bin/link` shadows the MSVC linker. Node and git are fine in either shell.

## Git & GitHub rhythm

Commits follow the owner's *Git & GitHub Rhythm* (Claude skill `git-github-rhythm`).

- **Branches:** work happens on `dev`. `main` is reached only by PR from `dev`. The first `main` commit has **no `.github/workflows`**, so `main` can exist as a PR base without triggering a release.
- **Who does what:**
  - The coordinating maintainer integrates, commits and pushes `dev`. Parallel agents edit files but do not commit.
  - The public repository `CipherVaults/Portable-Calculator-Tool` and its `origin` remote were created on the owner's yes (2026-11-18). Merging `dev` → `main`, tags and releases follow the owners' **standing release authority** (2026-11-18: "don't wait for my approval to release, I already grant it to you if you tested it and it's good"): allowed only for work that passed the full verification list and was verified. Enabling Pages, any other repository setting change and creating repositories need an explicit yes from a CipherVaults owner.
- **One coherent step per commit.** Stage explicit paths, never a blanket `git add -A` while other agents are editing. Read the staged diff before committing.
- **Message format:**
  - A plain-language subject.
  - A bullet body with `Why / Changed / Checks / Remaining`. `Checks` names the real commands and results, and says what was not run.
  - Unfinished work is preserved as `WIP:`.
  - Every commit ends with the required `Co-Authored-By:` trailer.
- **Push and verify:** push after each verified milestone; verify with `git ls-remote origin dev` against `git rev-parse HEAD`; never force-push.
- **Receipts** (SHA, checks, not covered) go in the closing report and, for milestones, in the [Execution & Coding Ledger](Documentation/pbs/EXECUTION_AND_CODING_LEDGER.md).

## Permission checks

- Private per-device state must not be read, cleared or exported without owner authority: `%APPDATA%\com.portablecalculator.tool\*`, the old apps' `%APPDATA%\com.datecalculator.tool\*` and Percentage Calculator data, browser `localStorage`, IndexedDB and PWA caches.
- Pushing to `main`, tags and releases is outward-facing: only under the standing release authority above, with every check passed and the result verified.

## Verification workflow

```powershell
node scripts/build-web.mjs --desktop-only   # src-tauri embeds dist/desktop at compile time
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo clippy -p pcalc-api -p pcalc-wasm -p date-core -p percent-core -p calc-num -p calc-core -p units-core -p graph-core --target wasm32-unknown-unknown --locked -- -D warnings
cargo test --workspace --locked
cargo run -p date-core --example gen_golden --locked -- --check
node scripts/build-wasm.mjs --check-twice   # the only writer of target/engine/engine.wasm (local paths remapped, leak-checked, reproducible)
node scripts/build-web.mjs                  # run twice and compare dist/ for determinism
node scripts/check-wasm.mjs                 # builds the release bridges itself (cargo), then goldens + 200k seeded random requests, native vs WASM in 3 time zones
node scripts/check-i18n.mjs                 # catalogs (keys, placeholders, CLDR plurals, no markup, no unused keys) and the formatter/plural units
node scripts/check-web.mjs                  # every theme has the same tokens and passes WCAG AA; every inline block of the built pages is CSP-pinned
node scripts/browser-boot.mjs               # headless Edge (CDP, throwaway profiles): both web builds boot under their CSPs; rescue paths; the shell (drawer, bottom sheet, phone bottom bar, theme pre-paint, tab sync); 360/390/440 px and phone-landscape layouts incl. pseudo-locales (--shots <dir> saves PNGs); the Date tool (real taps on calendars, Move menu, a mouse drag, reload restore, Countdowns pane, themes, pseudo-locales; --date-only runs just that); the Percentage tool (real typing and taps, text-only results, Move menu, reload restore, Reset, themes, pseudo-locales; --percent-only); the service-worker upgrade test
node scripts/check-versions.mjs
node scripts/check-unsafe.mjs               # unsafe only where allowed; no panicking calls in engine code
node scripts/safety-eval.mjs                # slices B and C (shell, Date and Percentage tools and stores in a mini-DOM with a fake IndexedDB and a fixed clock, both adapters, real engine.wasm; the tool tests are scripts/lib/eval-date.mjs and eval-percent.mjs) and D (static hygiene), each rule with a mutant proof; and the built dist/
cargo run -p portable-calculator-tool --locked -- --smoke-test
```

Build `engine.wasm` through `scripts/build-wasm.mjs`, never a bare `cargo build`: that embeds the local cargo-home path (with the user name) in panic-location strings. `build-web.mjs` ships only `target/engine/engine.wasm`, which only `build-wasm.mjs` writes, and `build-web.mjs`, `check-wasm.mjs` and `safety-eval.mjs` all refuse an engine that contains a local path of the machine (`scripts/lib/local-paths.mjs`). The static rules (`scripts/lib/web-hygiene.mjs`, `scripts/lib/rust-hygiene.mjs`) scan raw text: a banned name (an HTML sink, an inline style write, the unsafe keyword before a brace, fn, impl, trait or extern) may not appear even in a comment. The CI equivalent is `.github/workflows/ci.yml` (on `dev` only; no release job before M10). Every Action is SHA-pinned with `persist-credentials: false` and `permissions: contents: read`.

## Reporting and stopping

Report the concrete result, the exact artifacts each check applied to, what was not run, and the next permitted action. Update only the PBS records whose answers changed.
