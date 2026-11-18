# 5. Portable Calculator Plan: Date v1.1.0 fixes and the merged Portable Calculator Tool

> **Status:** approved by the owner on 2026-11-17 (PBS: plan approval = Goal approval). The short plan of record is in [CURRENT_STATE](../pbs/CURRENT_STATE.md). This file is the full design behind it.
>
> **Owner clarifications at approval (these override the text below):**
> - **No legacy history migration.** "It is a very early start." The merged app starts fresh. Ignore B12 (importers, consent card), the `legacy.*` ops, the `origin`/`originKey` legacy fields, the M4 milestone, and the "Export my data" part of B13/M11. The old apps' final releases keep only the "replaced by" notice and link.
> - **Standing authority:** fixes, improvements and security hardening that matter are made without waiting. Merging to `main`, tags, releases and repo creation still need the owner's explicit yes.
> - **Phone-first web app.** The PWA is designed for phones first.

---

# Portable Calculator Tool: implementation plan, revised after the critique

This is a design only. No files were changed. Before relying on anything about the existing code, I read it:
- `ui/main.js`: `setField` :299, the mini calendars :708-817, `updateBusinessLive` anchoring :1075-1098, the countdown :1281-1466, `restoreHistoryEntry` :1590-1610, the `live()` bindings :2697/:2737, `initialize` :3368-3421.
- `src-tauri/src/commands.rs`: `load_history_from_path` :353, `backup_corrupt_file_once` :419, `parse_settings_value` :446-457, the version assert :3239.
- Other Date repo files: `main.rs` handler list, `mobile/sw.js`, the mobile CSP, `ui/styles.css` :1107-1161, `.github/workflows/{build,pages}.yml`, `gen_golden.rs`, `golden_parity.rs`, the safety-eval constants and mini-DOM, and `crates/date-core/Cargo.toml`. That file has serde only, with serde_json as a dev-dependency.
- PCT v2.3.0 through gh api.

**[A]** marks an assumption still to verify. **[D]** marks a choice between alternatives, with the reason.

**Facts that correct the source designs**
1. `setField` only sets `.value` and syncs the empty class. A calendar click must call `setField` and then `UPDATERS[key]()`, as history restore does (:1606).
2. `golden.json` (`crates/date-core/tests/fixtures/golden.json`) has a header `engine` that is asserted equal to `ENGINE_VERSION`. The CI node blocks (build.yml :115/:126 and :258/:269, pages.yml :107/:118) and the release PowerShell loop (build.yml :338) also lock date-core's `Cargo.toml` version and `golden.engine` to the **app** version. So does `check-mobile.mjs` versionChecks (:438).
3. `load_history_from_path` returns an empty list when the read fails, when parsing fails, or when an entry is dropped. The next append then overwrites the file. This is a history-loss path.
4. `cdTarget` and `cdTime` are bound to both `input` and `change` (:2737). In Chromium/WebView2, editing a date segment fires `input` with `""` in between.
5. `parse_settings_value` runs the strict deserialize **before** it checks `schemaVersion`.
6. Old service workers delete caches by prefix: `date-tool-*` (sw.js :101) and `pct-tool-*`. The new prefix starts with neither.
7. Legacy history ids are `u64` counters that start at 1 on each device and each surface, and restart after Clear.

---

## 1. Part A: Date Calculator v1.1.0

### A1. Clickable mini calendars

**DOM**
- `miniCalCell` (desktop :767, mobile ≈ :7322) emits `<button type="button" class="mini-cal-cell …" data-date title>` instead of `<span role="img">`.
- The classes stay the same and each grid still has 42 children, so safety-eval `live-results` holds.
- **Selection state comes from the field values, not from the engine flags.** The engine range is `[earlier, later)`, and without "include end date" `rangeEnd` is the later date minus one day (:1075-1098).
  - A cell whose `data-date` equals `bizStart` gets class `pick-start` and the `", start"` suffix.
  - A cell equal to `bizEnd` gets `pick-end` and `", end"`.
  - `infoDate` and `cdTarget` cells get `selected` and `", selected"`.
  - All of these cells get `aria-pressed="true"`.
  - Engine `inRange`/`isRangeStart`/`isRangeEnd` drive only the shading classes.
- `aria-label` is the engine `label` plus the suffix, taken from one shared table that is identical on both surfaces (`cross-surface-text`). Today's cell gets `aria-current="date"`.
- `outOfRange` cells are `disabled`. Out-of-month (`.out`) cells can be clicked; they select the day and move the view to its month.
- Each grid has one delegated `click` listener and one `keydown` listener via `addEventListener`. There are no `on*` attributes.

**What a click does.** `onMiniCalPick(key, iso, {shift})` calls `setField`, then `await UPDATERS[card]()`. It never writes history; only calculate, Enter and copy do, as today.

| Card | Click | Shift+click / Shift+Enter |
|---|---|---|
| Date Info | sets `infoDate` | same as click |
| Countdown | sets `cdTarget`, keeps `cdTime`; a past day is allowed (it shows the finished state); the countdown is saved (A2) | same as click |
| Business Days | sets the current pick target (below) | always sets `bizEnd` |

**Business Days pick target** **[D: a toggle with no auto-swap. Swapping would silently rewrite the user's pick, and the engine already handles backward ranges.]**
- `<fieldset class="cal-pick"><legend>Calendar click sets</legend>` holds the radios `bizPickStart` and `bizPickEnd` (44 px on coarse pointers).
- A `role="status"` hint, `bizCalHint`, reads "Next click sets the start date." or "Next click sets the end date."
- **Initial target:** Start if `bizStart` is empty, else End if `bizEnd` is empty, else Start.
- **After a pick:** Start→End and End→Start.
- Focusing `bizStart` or `bizEnd` selects the matching radio.

**The view follows the click.** `calAnchorOverride.biz = iso` is set only by a click and consumed once in `updateBusinessLive`, so the view does not jump back to the earlier month. Typed input keeps the v1.0.0 anchoring.

**Keyboard (roving `tabindex`)**
- Exactly one `tabindex=0` per grid: the last focused date if it is visible, else the selected cell or an endpoint, else today, else the 1st of the month.
- Arrows move ±1 day / ±1 week. Home/End go to the week's start/end (honouring `firstDayOfWeek`). PageUp/PageDown move ±1 month with the day clamped; with Shift, ±1 year. Enter/Space selects.
- Moving focus never selects anything.
- Leaving the visible month calls `shiftCalendar`. Focus is clamped to 0001-01-01…9999-12-31 and skips disabled cells.
- **Focus survives repaint.** `paintMiniCal` records `document.activeElement?.dataset.date` if focus is inside the grid and refocuses that cell after `replaceChildren`, as the holiday preview does (:2390-2408). The `view.seq` guard is unchanged, so a stale paint never moves focus.

**Month navigation.** The ‹ › buttons are unchanged. A new "Today" button in the header changes the view only; it does not select.

**CSS (desktop and mobile)**
- `.today`: an inset ring `box-shadow: inset 0 0 0 1px #eef2ff` replaces the outline.
- New `.today.holiday` rule: `box-shadow: inset 0 0 0 1px #eef2ff, inset 0 -2px 0 #E9A715`, so both markers survive.
- `.mini-cal-cell:focus-visible{outline:2px solid #eef2ff;outline-offset:-2px}`.
- `.out` text is raised from `#454c5e` to `#8f9aaf`, which is at least 4.5:1 on `#0E0F12` **[A: check-mobile computes the contrast]**. The very dim look is kept only for `disabled`: `opacity:.25;cursor:default`.
- New `.selected`, `.pick-start` and `.pick-end` rules. The dormant `button.mini-cal-cell` rules (:1107-1113) become live.
- The 44 px coarse-pointer rule is kept; at 440 px the grid is about 330 px wide.
- Mobile only toggles classes.
- Range hover preview: out of scope.

### A2. Countdown persistence

**Storage: a separate record, not `AppSettings`.** `deny_unknown_fields` would make a v1.0.0 binary `.bak` a v1.1.0 settings file and fail closed. A separate record also keeps the failure domains apart.

| | Desktop | Mobile |
|---|---|---|
| Location | `%APPDATA%\com.datecalculator.tool\countdown.json` | localStorage `date_tool_countdown_v1` |
| Corruption | `countdown.json.bak` once | `date_tool_countdown_v1_bak` once |
| Cap | 1 KiB | 1,024 chars |

**Schema** (Rust `CountdownState`, `deny_unknown_fields` + Strict; mobile `hasOnlyKeys`):
```json
{"schemaVersion":1,"targetDate":"2026-12-31","targetTime":"09:00","savedAtMs":1795400000000,"finishedSeenAtMs":null}
```
- `targetTime` is `""` or `HH:MM`. `finishedSeenAtMs` is `null` or ms.
- Validation reuses `INPUT_KEYS`/`validate_input_value` (:631/:738) and `validateInputValue` (:6269).
- **Parse order:** read `schemaVersion` from the raw value first.
  - Newer than 1: ignore the record, never write it, show no `.bak`. The card starts empty with the note "Saved countdown is from a newer version."
  - Equal to 1: strict parse.
  - Missing or invalid: treat as corrupt.

**Commands**
- `countdown_load() -> Option<CountdownState>`, `countdown_save(state)`, `countdown_clear()`.
- They use `read_regular_file_limited`, `ensure_private_parent_dir` and `write_atomic_private`. `backup_corrupt_file_once` gains a cap parameter.
- Smoke mode uses an in-memory store.
- Register them in `main.rs` `generate_handler!` (:80-102), in safety-eval `DESKTOP_COMMANDS` (:2980) and in the stub dispatch (:3013-3099).
- **[A]** `capabilities/default.json` needs no change (there is no app manifest in `build.rs`).

**Save triggers** **[D: save on commit, not on every keystroke]**
- `persistCountdown()` is called by:
  - a separate `change` listener on `cdTarget`/`cdTime`;
  - quick pills, the today button, calendar clicks and history restore;
  - a flush on `pagehide` and on `visibilitychange`→hidden.
- It writes only when both fields are valid and `(targetDate, targetTime)` differs from the stored pair. `savedAtMs` and `finishedSeenAtMs` are excluded from the comparison.
- A new target resets `finishedSeenAtMs` to `null`.
- `input` events and `checkDayRollover` re-render but never save.
- **An empty or invalid field never clears the record.**

**Clear: explicit actions only.**
- `resetCard("countdown")` (:1724).
- A new "Forget" button inside `cdSavedNote`, a muted line "Saved on this device. It resumes when you reopen the app." that is visible while a record exists.
- Mobile uses `removeItem` on that exact key, never `clear()`.
- A finished countdown stays saved until it is cleared or replaced.

**Restore on launch.** In `initialize()`, after `refreshCalendarInfo()` and before the `Promise.all` (:3397):
1. Load the record. Apply it only if `cdTarget` is still empty.
2. `setField("cdTarget")` and `setField("cdTime")`, then set `cdRestored = true`.
3. The existing `updateCountdownLive()` runs with a fresh `nowMoment()`, so the exact time left shows with no "—" flash.
4. Smoke mode reads only the in-memory store.

**Finished detection (no engine change: `past|now` is the finished signal)**
- On a render while `document.visibilityState === "visible"`, if the status is `past`/`now` and `finishedSeenAtMs` is null, the UI writes `finishedSeenAtMs = Date.now()` once. This is the only tick-time write, and it happens at most once per target. Returning from hidden counts as seen.
- On the first render after a restore with `past`/`now`:
  - `finishedSeenAtMs` null → **"finished while closed"**, then write `finishedSeenAtMs`;
  - otherwise → plain **"finished"**.
- A target the user sets in the past is "seen" immediately.

| `cdPhase` chip | Style | `cdStatus` (polite, once per `cdStatusKey`) |
|---|---|---|
| `counting down` | green outline | `Counting down to <when>.` |
| `restored` (first render, future) | green outline | `Countdown restored: <N> left until <when>.` |
| `finished` | gold fill `#E9A715` on `#0E0F12`, `is-finished` | `Finished: <when> has passed. Counting the time since.` |
| `finished while closed` | gold fill | `Finished while the app was closed: <when>. Counting the time since.` |

The count-up `is-past` clock stays. `role=timer` stays non-live (FROZEN §7).

**Ticks.** The pause-while-hidden tick is kept. Ticks recompute from absolute time. A `pageshow` (bfcache) listener is added next to `visibilitychange` (:3410).

**Multiple tabs (mobile).** The storage listener (:9358-9366) gets a `date_tool_countdown_v1` branch.
- If focus is outside `#card-countdown`, the tab adopts the newer `savedAtMs`, or the clear, and re-renders without writing.
- Otherwise it ignores the event, and the last writer wins.
- Desktop: the last atomic writer wins **[A: acceptable without a single-instance plugin]**.

**Time zones.** The target is local wall-clock time and is re-resolved with `offsetAt` on every launch, like an alarm. The release notes say so.

### A3. History-loss fix (recommended; owner yes at plan approval)
In `load_history_from_path` (:353), the outcome depends on what happened:

| Load outcome | Handling |
|---|---|
| `NotFound` | empty history, writable |
| Any other read error (sharing violation or lock, over-cap, symlink) | read-only mode; no `.bak` is attempted |
| Parse failure, or any dropped entry | `backup_corrupt_file_once(history.json, HISTORY_MAX_FILE_BYTES)` first, then read-only mode |

**In read-only mode:**
- `history_add`, `history_delete` and `history_clear` return `history_read_only`.
- The panel shows a banner: "History could not be read safely. Nothing will be overwritten." with **Retry** (reload) and **Start a new history** (explicit, confirmed; renames the current file to `history.json.bak` if no `.bak` exists).

Mobile mirrors this with `date_tool_history_v1_bak` and a `historyReadOnly` flag. The PCT equivalent (v2.3.0 commands.rs :295) is fixed in PCT v2.4.0 (B13).

### A4. Versioning (owner decision)
**[D: decouple app and engine versions.]** Lockstep would force regenerating a 22 MB golden for an unchanged engine, and Part B needs decoupling anyway.

- **App 1.1.0:** `tauri.conf.json`, `src-tauri/Cargo.toml` and its `Cargo.lock` entry, mobile `APP_VERSION`, `CACHE_NAME = "date-tool-v1.1.0-mobile-1"`, footers, safety-eval `APP_VERSION` (:68).
- **Engine stays 1.0.0:** date-core `Cargo.toml`, `ENGINE_VERSION` (lib.rs:80), the `/* date-core:begin v1.0.0 */` marker, the golden header, check-mobile and safety-eval `BEGIN_MARKER`.
- **Code:** commands.rs :3239 becomes `assert_eq!(date_core::ENGINE_VERSION, EXPECTED_ENGINE_VERSION)`.
- **CI (required, or CI fails):**
  - Both node blocks in build.yml (:115/:126, :258/:269) and the one in pages.yml (:107/:118) split into `ver` (from `tauri.conf.json`) and `engineVer` (from date-core `Cargo.toml`).
  - The new asserts are `pkgVer(date-core) === engineVer`, `golden.engine === engineVer`, and the mobile marker includes `engineVer`.
  - The three blocks stay byte-identical (`D.workflow-node-block-identical`).
  - The build.yml :338 PowerShell loop checks `src-tauri/Cargo.toml` against the app version and date-core against `EXPECTED_ENGINE_VERSION`.
- **check-mobile versionChecks (:438):** the same split, plus an assertion that the SHA-256 of the engine slice equals its v1.0.0 value.
- **Mutant proof:** setting date-core to 1.1.0 or `golden.engine` to the app version must fail.
- **AGENTS.md:** the version rule splits into "app version" and "engine version" (owner yes).
- **Fallback if declined:** lockstep 1.1.0 plus `gen_golden -- --write`, with a script proving that only line 1 changed.

### A5. Files
- `ui/index.html`, `ui/main.js`, `ui/styles.css`.
- `mobile/index.html`: the twins at about +6555, the storage branch, recomputed `style-src`/`script-src` SHA-256 in the meta CSP, `APP_VERSION`, footer.
- `mobile/sw.js`.
- `src-tauri/src/commands.rs`: `CountdownState`, three commands, A3, tests, a smoke round-trip before `SMOKE_TEST_OK`.
- `src-tauri/src/main.rs`, `tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`.
- `.github/workflows/build.yml` (two node blocks and the release loop) and `pages.yml`.
- `scripts/safety-eval.mjs`, `scripts/check-mobile.mjs`.
- `.github/release-notes-v1.1.0.md`, README.
- AGENTS.md: the private-state list gains `countdown.json`, `history.json.bak` and `date_tool_countdown_v1`, plus the version rule.
- PBS: `CURRENT_STATE`, `CONTINUATION_STATE`, Ledger.

### A6. Tests

**Rust**
- `countdown_roundtrip`, `countdown_rejects_unknown_field`, `_oversize`, `_symlink`, `_bad_time` (`24:00`, `9:30`).
- `countdown_newer_schema_ignored_not_backed_up`, `countdown_corrupt_bak_once_then_none`, `countdown_does_not_touch_settings`.
- `history_read_error_is_read_only_not_empty`, `history_corrupt_writes_bak_then_read_only`, `history_dropped_entry_writes_bak`, `history_add_refused_when_read_only`.
- `engine_version_pinned`.

**safety-eval B (mobile mini-DOM) and C (desktop mocked invoke)**

Calendars:
- `calendar-click-info`, `calendar-click-countdown`.
- `biz-range-pick`: start→end→start; Shift sets End; focusing an input sets the target; marks come from the field values with `includeEndDay=false` and with a backward range.
- `calendar-view-follows-click`.
- `calendar-keyboard`: arrows, PageDown across months, focus kept, exactly one `tabindex=0`.
- `calendar-out-of-range-disabled`.

Countdown:
- `countdown-restore-future`.
- `countdown-finished-while-closed`: seeded store, `finishedSeenAtMs` null, fixed clock.
- `countdown-finished-while-open-then-closed`: shows plain "finished".
- `countdown-empty-segment-keeps-record`: `input` with `""`, reload, record intact.
- `countdown-forget-clears`, `countdown-reset-clears`, `countdown-no-write-on-tick` (except the single `finishedSeenAtMs` write).
- `countdown-storage-event` (mobile).

History:
- `history-read-only-banner`.

**safety-eval D**
- `D.command-allowlist` covers the three new commands.
- `dom-safety`.
- `css-contrast-out-cells`.
- Mutant proofs: span cells, a deleted restore call, save-on-input, clear-on-empty, savedAtMs used as the finished signal, history read error returning empty, and the engine/app version mutants.

`live-results`, `ui-parity-seeded`, `cross-surface-text` and `ipc-race` pass with only new data. **[A]** The mini-DOM may need `tabIndex` and focus-skipping for disabled cells.

### A7. Verification and release gate
1. In PowerShell: the six AGENTS.md commands, plus `node scripts/check-mobile.mjs` (three time zones).
2. Commit on `dev` (git-github-rhythm). Check `git ls-remote origin dev` = `git rev-parse HEAD`. CI must be green, including the split version checks.
3. Manual checks on the installed exe and the phone PWA (Chrome at 440 px, iOS home screen):
   - click all three calendars;
   - a keyboard-only pass;
   - target tomorrow, then close/reopen: the exact time left is shown;
   - target +2 min, close, reopen after 3 min: "finished while closed";
   - target +1 min, watch it finish, close, reopen: "finished";
   - clear a date segment, close, reopen: the record is kept;
   - offline reload.

   Record the results in the Ledger.
4. Open a PR dev→main. **The owner's explicit yes is required to merge.** The release job refuses an existing tag.
5. After release, check:
   - `gh release view v1.1.0` shows the 5 assets;
   - `sha256sum -c SHA256SUMS.txt` passes;
   - a v1.0.0 install finds the update;
   - Pages serves the new `CACHE_NAME`.

---

## 2. Part B: Portable Calculator Tool v1.0.0

### B1. Repo and workspace
- **Repo:** `CipherVaults/Portable-Calculator-Tool`, public.
- **M0 (owner gate):**
  - create the repo;
  - push an initial commit with **no `.github/workflows`** to `main`, then branch `dev`, so `main` exists as a PR base and every later change reaches it by PR;
  - enable Pages with the Actions source (a separate owner gate).
- **Identifier:** `com.portablecalculator.tool` **[A: owner confirms]**.

```
rust-toolchain.toml   pinned channel + wasm32-unknown-unknown
crates/
  date-core/     from Date v1.1.0 (provenance SHA), own version, golden/vectors/chrono oracle
  percent-core/  from PCT v2.3.0; adds #![forbid(unsafe_code)]; the two .expect() (lib.rs:209-210) become total code, and goldens must pass unchanged; example renamed percent_bridge; NEW markup/tax/tip goldens
  calc-num/      34-digit decimal, integer limbs only
  calc-core/     Standard/Scientific key machine, expression parser/evaluator, Programmer
  units-core/    unit catalogue + exact conversion (uses calc-num)
  graph-core/    expr → bytecode, f64 sampling (uses the calc-core parser)
  pcalc-api/     dispatcher, envelope, Strict, per-op caps, store validators, legacy parsers
  pcalc-wasm/    cdylib raw ABI over pcalc-api
  pcalc-store/   native-only hardened storage, update check, clipboard, smoke (factored from both commands.rs; params {repoUrl, userAgent, sentinel})
src-tauri/       main.rs, commands.rs (thin), legacy_fs.rs
web/             src/**/*.js, styles/*.css, index.template.html, build-manifest.json, sw.template.js
scripts/         build-web.mjs, check-web.mjs, check-wasm.mjs, browser-boot.mjs, serve-web.mjs, check-versions.mjs, safety-eval.mjs
```

**Crate rules**
- Engine crates (`date-core`, `percent-core`, `calc-num`, `calc-core`, `units-core`, `graph-core`): `#![forbid(unsafe_code)]`, no clock, time zone or locale, no panics, **serde only**. The exception is `graph-core` → `libm` (owner yes, B7).
- `pcalc-api`: the same rules but **serde + serde_json** (owner yes). It declares `serde_json = { version = "1", features = ["float_roundtrip"] }` itself, so native and `-p pcalc-wasm` builds parse PCT f64 inputs identically. `check-wasm` includes a last-bit float case.
- `pcalc-wasm` and `pcalc-store` are the only crates allowed `unsafe` or I/O, as described in B3.

**Versions**
- Each engine asserts `ENGINE_VERSION == CARGO_PKG_VERSION`, and its golden header carries that version.
- `check-versions.mjs` locks the **app** version across `tauri.conf.json`, `src-tauri`/`pcalc-api`/`pcalc-wasm` `Cargo.toml`, `APP_VERSION`, `CACHE_NAME` and the footers. It never touches engines.
- `meta.versions` returns `{api:1, app, engines:{…}}`.

### B2. Unified API
- `pcalc_api::call(op:&str, req:&str) -> String`. The op string is parsed into a closed enum.
- **Ops:**
  - `date.*` (the existing nine);
  - `percent.change|percent|what|discount|base|markup|tax|tip`;
  - `calc.press`, `calc.eval`, `prog.press`, `prog.eval`;
  - `units.catalog`, `units.convert`;
  - `graph.compile`, `graph.sample`, `graph.trace`;
  - `history.validate`, `history.import_preview`, `settings.validate`, `state.validate`, `countdowns.validate`, `legacy.preview`;
  - `meta.versions`.
- **Envelope:** date-core's everywhere, `{"ok":"true","result":…}` or `{"ok":"false","error":{"code",…}}`. `pcalc-api` wraps percent-core's flat results, maps error strings to codes and normalises `DiscountResult`'s boolean `ok`.

**Per-op request caps** (checked before parsing; invalid UTF-8 returns `invalid_request`):

| Ops | Cap |
|---|---|
| calc, prog, date, percent, units, graph | 64 KiB |
| `settings.validate`, `state.validate`, `countdowns.validate` | 256 KiB |
| `history.validate` | 4.5 MiB (store cap 4 MiB + headroom) |
| `history.import_preview`, `legacy.preview` | 8 MiB |

- Oversize returns a distinct **`request_too_large`**. The storage layer treats it as "cannot validate": the store goes read-only and untouched, never down the corrupt path.
- Tests sit at exactly cap and cap+1.

**Desktop** exposes one engine command, `engine_call(op, req)`. **[D: desktop stays native, so its CSP is unchanged.]** Parity is proved in CI (B14).

**One validator.** Store validators exist once in Rust, replacing the JS twins of `INPUT_KEYS`/`HISTORY_INPUT_KINDS`.

### B3. WASM and the web shell
**Raw ABI, no wasm-bindgen.** The interface is one string in and one string out, with no pinned CLI and no glue to audit.
- **Buffers:** `thread_local! IN, OUT: RefCell<Vec<u8>>`.
- **Exports:** `pc_in(len)->u32`, `pc_call(op_len, req_len)->u32`, `pc_out()->u32`, `pc_abi()->u32`.
- **Lints:** `#![deny(unsafe_code)]`, with `#[allow(unsafe_code)]` only on the `#[unsafe(no_mangle)]` attributes. A safety-eval static check enforces this. **[A: lint behaviour on the pinned toolchain; fallback is an alloc/free shim confined to this crate.]**
- **Profile:** `[profile.wasm] inherits="release", opt-level="z", lto=true, codegen-units=1, panic="abort", strip=true`.
- **Memory:** `--max-memory=67108864`. **[A: an 8 MiB import fits; measured in M1.]**
- **Build:** `cargo build -p pcalc-wasm --target wasm32-unknown-unknown --profile wasm --locked`.
- **Size budget:** ≤ 1.5 MB.

**Loader (`web/src/core/engine-web.js`)**
- `TextEncoder`; re-reads `memory.buffer` after every call.
- Checks SHA-256 (`crypto.subtle.digest`) against a build-time constant before instantiating.
- On a trap: re-instantiate and return `internal`.

**Browser floor (owner decision): Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+**, stated in the README and release notes.
- If `typeof WebAssembly` is undefined, or instantiate fails (old WebKit, iOS Lockdown Mode), the boot shows an "Unsupported browser" screen.
- That screen includes a **JS-only, read-only rescue view**: it lists raw stored history entries as text and exports the raw stored JSON unchanged (`exportFile`/clipboard).
- The rescue view never writes, never validates, and points to the old apps, which still work.

**Pages (multi-file, content-hashed)**
- Files: `index.html`, `app.<hash>.js`, `app.<hash>.css`, `engine.<hash>.wasm`, `sw.js`, `manifest.webmanifest`, icons.
- WASM load path: `fetch` → `arrayBuffer` → `WebAssembly.instantiate`.
- **Service worker** (generated by `build-web.mjs` with the hashed list):
  - `CACHE_NAME = "pcalc-v<app>-<buildhash>"`;
  - at install, `cache.addAll` on **all** files (atomic);
  - hashed assets are cache-first from that versioned cache only and are never revalidated in place; if one is missing, fetch from the network and put it there;
  - navigations are network-first, falling back to the cached `index.html` of the same version;
  - at activate, delete only keys that start with `pcalc-` and are not current.
  - An index.html of version N always references assets of version N, so a mismatched pair cannot boot.
- **Meta CSP** (no `frame-ancestors`; the app refuses to render when `window.top !== window.self`):
  ```
  default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:;
  connect-src 'self' https://api.github.com; worker-src 'self'; manifest-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'
  ```

**Single-file "Mobile HTML" asset** (`build-web.mjs`, plain Node, no npm):
- concatenates the scripts in manifest order and inlines the CSS;
- embeds the WASM as base64 in `<script type="application/octet-stream" id="engineWasm">`, decoded with `atob`;
- computes the hashes and writes LF.
- **[A: `script-src` does not apply to non-JS script types]** must be proved in M1 in Chromium, WebKit, Gecko and WebView2.
- Budget 2 MB.

### B4. One frontend with a platform adapter
- **Scripts:** classic scripts on a frozen `window.PCalc` namespace, in order from `build-manifest.json`. CI builds twice and compares SHA-256.
- **`core/`:**
  - `dom.js` (textContent only);
  - `engine-web.js`;
  - `router.js` (hash routes);
  - `clock.js` (`localNowParts`, `offsetAt` moved from main.js:191-240);
  - `store-idb.js`;
  - `bus.js` (`BroadcastChannel("pcalc")`).
- **Other folders:** `platform/tauri.js`, `platform/web.js`; `tools/standard|scientific|programmer|graphing|converter|percent|date/`; `history/`; `settings/`.
- **Adapter interface:** `engine(op, req)`, `store.{load,save,clear}(name)`, `legacy.probe()`/`legacy.read(source)`, `clipboard.write`, `updates.check`, `openRelease`, `exportFile(name, text)`, `importFile()`.
- **DOM rule:** textContent/createElement/replaceChildren only, and `.style` is never set, on both surfaces.
- **`styles/tokens.css`:** the first custom properties from the shared palette:
  - `--bg #0E0F12`, `--surface #161822`, `--gold #E9A715`, `--green #94C59A`;
  - `--border #2a2d35`, `--border-strong #3a3f4c`;
  - text `#e2e4e8/#eef2ff/#cbd5e6`, muted `#a3adc2/#8f9aaf/#6b768e`.

  Dark theme, square corners, the monospace stack, `forced-colors`, reduced motion.
- **`components.css`:** merges Date's fork with PCT v2.3.0's card header, drag and collapse classes. `.quick-pill` and `.preset-btn` become `.chip`.

### B5. Navigation (Windows Calculator style)
- **Drawer (☰)**, pinned at ≥1100 px:
  - Calculator: Standard, Scientific, Graphing, Programmer.
  - Tools: Date, Percentage.
  - Converter: Volume, Length, Weight & mass, Temperature, Energy, Area, Speed, Time, Power, Data, Pressure, Angle.
- **History | Memory | Countdowns pane:** docked at ≥1100 px, an overlay from 760 to 1100 px, a bottom sheet below 760 px.
- Breakpoints 760/540/440 and safe-area insets stay. The last tool reopens on launch.
- Date and Percentage keep their card grids with reorder and collapse, and the live formula panel.
- **Shortcuts:**
  - Alt+1–4 the calculators, Alt+5 Date, Alt+6 Percentage;
  - Ctrl+H history, Ctrl+F search;
  - Esc C, Del CE, Backspace, F9 ±, R 1/x, @ √, Ctrl+M/P/Q/R/L memory;
  - F5–F8 HEX/DEC/OCT/BIN.

### B5a. Mini Calculator (pop-up windows and the keyboard Calculator key)
*Added 2026-11-17 at the owner's request, modelled on what the Windows Calculator key opens.*

**What it is.** A small, fast **Standard-only** calculator window, separate from the full app (Date, Percentage, Scientific, Graphing, Programmer and Converters are not loaded). The layout follows the Windows Calculator's compact Standard view in our dark-terminal design:
- display;
- MC MR M+ M− MS;
- % CE C ⌫;
- ¹⁄ₓ x² √x ÷;
- the digit pad;
- ± 0 . =

It also has a **Keep on top** toggle, a **History | Memory** flyout, and an **Open full app** button.

**Many windows, one history**
- Any number of Mini windows can be open at once. Each keeps its own display, pending operation and memory.
- **History is shared** with every other Mini window and with the full app. It is never cleared by closing a window.
- Every `=` is written through the single backend history store (B10). That store broadcasts a `history-changed` event to all windows.
- **Desktop: one process** via `tauri-plugin-single-instance` (an owner-approved dependency):
  - a second launch (`--mini` or plain) forwards its arguments to the running process, which opens a new window;
  - there are never two processes writing `history.json`.
- Windows are `WebviewWindow`s labelled `mini-<n>`, about 320×500 by default, resizable. The next window opens at the last window's remembered position.
- `capabilities/default.json` covers `["main","mini-*"]` with `permissions: []`. The CSP is unchanged.

**Launch paths**
- `PortableCalculator.exe --mini` opens a Mini window only, with no full-app window, so the key press feels instant.
- From the full app: a "Mini calculator" button in the Standard header (the ⧉ icon, as in Windows) and the shortcut **Ctrl+Shift+M**.
- **Keyboard Calculator key** (Settings → *Keyboard Calculator key*, Windows only, **off by default**):
  - **On** writes the per-user registry value `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AppKey\18\ShellExecute` = `"<current exe path>" --mini`. No admin is needed. AppKey 18 is the Calculator key; Windows reads it on each press.
  - **Off** deletes only that value, and only if it still points to a Portable Calculator exe. Windows then falls back to its built-in Calculator association. We never touch HKLM or other AppKeys.
  - The Settings row shows the current state, read back from the registry: "On: opens Portable Calculator", "Off: opens Windows Calculator", or "Set by another app". The last state is never overwritten without a confirm.
  - At startup, if the toggle is on and the stored path is a Portable Calculator exe at a different location (the portable exe moved), the value is re-pointed to the current exe.
  - **Uninstall cleanup:** an NSIS `NSIS_HOOK_PREUNINSTALL` hook and a WiX fragment (`RemoveRegistryValue` on uninstall) delete the value if it points to this app. That way the key never points to a missing exe.
  - Registry access lives only in the native store crate (`pcalc-store`, Windows-only module). Paths are fixed; the only input is the app's own exe path. Tests run against a temporary HKCU subkey.
- **Web / PWA:** the key cannot be bound from a browser.
  - On desktop browsers, a "Pop out" button opens the Mini route (`#/mini`) in a compact window. Where the **Document Picture-in-Picture** API exists (Chromium 116+), it opens as an always-on-top PiP window. In both cases history is shared through IndexedDB and `BroadcastChannel("pcalc")`.
  - **On phones, Mini is simply the Standard calculator** (full screen, one-handed); no pop-out.

**Engine and state.** Mini uses the same `calc.press` key machine (B6) and records history exactly as Standard does (`tool:"standard"`), so its entries restore into Standard in the full app and into any Mini window.

**Tests**
- Desktop smoke: open two Mini windows, press keys in each, assert one shared history with both entries and no second process.
- The AppKey toggle round-trips on a temp subkey.
- safety-eval: the Mini route renders with only the Standard bundle; `history-changed` sync across two simulated windows.
- browser-boot: the `#/mini` route boots.

### B5b. Themes: Terminal (default), Daylight and Retro
*Added 2026-11-18 at the owner's request.*

Every colour, border, shadow, radius and font comes from CSS custom properties in `styles/tokens.css` (B4). A theme is one `[data-theme="…"]` block of token values, plus a small set of component overrides where a theme needs a different shape (Retro bevels). No component hard-codes a colour. A static check fails the build if a raw colour literal appears outside `tokens.css`.

| Theme | Idea | Key tokens (starting values, tuned for AA contrast) |
|---|---|---|
| **Terminal** (default) | Today's dark terminal look | bg `#0E0F12`, surface `#161822`, gold `#E9A715`, green `#94C59A`, monospace, square corners |
| **Daylight** | Warm off-white "paper", not plain white; for people who dislike dark UIs | bg `#F4F1EA`, surface `#FBF9F4`, raised `#FFFFFF`, ink `#1F2330`, muted `#5D6475`, border `#D9D3C7`, accent gold deepened to `#9A6A00`, green `#2E7A4B`, the same monospace and square corners, soft 1px borders |
| **Retro** | A Windows 95/98 desktop with a nod to XP | desktop teal `#008080` behind the app; window face `#C0C0C0`; 3D bevels (`#FFFFFF` light, `#808080` shadow, `#000000` outer); navy title strips `#000080`→`#1084D0` on card headers and the Mini window; selection `#000080` with white text; `Tahoma`/`MS Sans Serif`-style system UI font for chrome and monospace for numbers; sunken input wells; beveled raised keys that press in on `:active`; dotted focus rectangle |

**Rules**
- **Settings → Appearance:** `System` (Terminal when the OS is dark, Daylight when it is light), `Terminal`, `Daylight`, `Retro`. It applies instantly with no reload.
- **No flash of the wrong theme.**
  - Web: a tiny inline pre-paint script (hash-pinned in the CSP) sets `data-theme` from the stored setting before first paint.
  - Desktop: the Tauri window background is set per theme at window creation.
- **Every theme passes WCAG AA:** 4.5:1 for text and 3:1 for UI parts and focus rings. `check-web.mjs` computes the contrast of every declared token pair per theme and fails below AA. `forced-colors` (Windows High Contrast) overrides all themes.
- The graph palette, calendar markers (today, holiday, range, selection), chips and the finished-countdown chip all have per-theme tokens.
- `prefers-reduced-motion` turns off the Retro key-press animation and every transition.
- The Mini Calculator (B5a) follows the app theme. Retro gives it a classic title-strip look.
- Phone first: themes change colour and texture only, never layout or target size. The Retro bevels are drawn with `box-shadow`, so they never shrink 44 px targets.
- The theme is stored in `settings.appearance.theme`; this is a new settings field, so the schema version bumps per the B10 rule.

### B5c. Languages (Arabic first, then 11 more)
*Added 2026-11-18 at the owner's request.*

**v1.0 languages (12):**

| Code | Language | Notes |
|---|---|---|
| `en` | English | source and fallback |
| `ar` | Arabic | **RTL**; owner-reviewed |
| `es` | Spanish | |
| `fr` | French | |
| `de` | German | |
| `pt-BR` | Portuguese (Brazil) | |
| `it` | Italian | |
| `ru` | Russian | |
| `tr` | Turkish | |
| `zh-Hans` | Chinese (Simplified) | |
| `ja` | Japanese | |
| `ko` | Korean | |

These are the languages most games and apps ship. More (Hindi, Indonesian, Polish …) can be added later as data only.

**Architecture**
- **Engines stay language-free** (rule unchanged: no locale in `*-core`). Engines return structured results (numbers, dates, codes, parts), plus English text used only for tests and as the fallback.
- **The UI owns all wording:**
  - message catalogs `web/i18n/<code>.json`, flat keys such as `"date.countdown.restored": "Countdown restored: {left} left until {when}."`;
  - a small formatter (no dependencies) with `{name}` placeholders and **CLDR plural categories**: Arabic has 6 forms (zero, one, two, few, many, other), Russian 3, and East Asian languages 1. A hand-written plural table covers the 12 languages and has unit tests.
- **Numbers and dates are formatted by the UI from built-in tables**, not `Intl`, so results are identical on every device:
  - per-language decimal and group separators (for example `1.234,5` in de/es/it/pt/tr/ru, `1 234,5` in fr);
  - month and weekday names;
  - the first day of the week default;
  - date order (for example `18/11/2026` in ar/fr, `2026/11/18` in ja/zh/ko).
- **Arabic digits:** a setting **Digits: Western 0-9 / Arabic-Indic ٠-٩**. The default is Arabic-Indic in `ar` and Western elsewhere. **Input accepts both everywhere**; the existing digit-normaliser is reused.
- **Calculator input** accepts both `.` and the language's decimal separator. Copy and history use the displayed format, with a "copy plain number" option.
- **History entries** store structured inputs (B10), so restoring an entry re-renders it in the current language. Stored `resultText`/`copyText` stay in the language used when it was recorded.
- **Holiday names** (US, UK, Egypt presets) get translated names in every catalog; Egyptian holidays have proper Arabic names.
- **The language picker** (Settings → Language) shows each language in its own script ("العربية", "Deutsch" …). The first run follows the browser or OS language when it is one of the 12; otherwise English. It switches instantly with no reload.

**RTL (Arabic)**
- `<html lang dir>` is set per language.
- All layout CSS uses **logical properties**: `margin-inline-start`, `inset-inline-end`, `text-align: start`. A static check bans physical `left/right` in layout rules (with an allowlist).
- The drawer and history pane swap sides, and icons with direction (‹ ›, back, swap ↔) mirror.
- **What stays left-to-right:**
  - numbers, the calculator display, expressions and the keypad order (as in the Windows and Android calculators in Arabic);
  - programmer bit grids;
  - graph axes.
- Mixed text uses `<bdi>` and Unicode isolation (`dir="auto"` on user text such as history notes and custom holiday names), so numbers and Latin names never scramble.
- Mini calendars follow reading direction: in RTL the first weekday is on the right and the ‹ › buttons swap meaning and position.

**Fonts.** The theme fonts keep the monospace stack for numbers. Text falls back to system fonts that have Arabic and CJK glyphs (`Segoe UI`, `Noto Sans Arabic`, `Noto Sans CJK`, `system-ui`), which keeps the app offline with no web fonts. Line height and sizes are adjusted per script where needed.

**Translation quality**
- `en` is the source. The other 11 catalogs are drafted by the agents, then checked by an independent translator agent per language for meaning, tone and length.
- Arabic is reviewed by the owner.
- Each non-English catalog carries a `_meta.reviewed` flag, and the About screen notes which languages are machine-assisted.
- Strings are written short so they fit on a phone.

**Tests**
- `check-i18n.mjs`:
  - every key exists in every catalog;
  - placeholders match the English source exactly;
  - plural sets are complete per language;
  - no HTML or markup in strings;
  - no unused keys.
- **Pseudo-locales** used in CI:
  - `en-XA`: about 35% longer, with accents; catches truncation and overflow at 360 px;
  - `ar-XB`: forced RTL; catches physical-direction bugs.
- browser-boot captures every tool in `ar`, `de` (long words) and `ja` at 390 px. A layout check fails on horizontal scroll or clipped text.
- Unit tests cover the plural table, separators, digit normalisation and RTL number isolation.

**Order of work.** The infrastructure goes in the shell milestone (**M2a**): catalogs, the formatter, logical CSS, the theme tokens, the pre-paint theme script and the language picker with `en` only. Every tool is then built with catalog keys from day one, and nothing is retrofitted. Translations and the two extra themes come later (**M9a**, **M9b**), once the strings are stable.

### B6. Numeric model
**`calc-num::Dec`**
- Sign, base-10⁹ `u32` limbs, |exponent| ≤ 9999, otherwise `overflow`.
- + − × ÷ are exact before rounding. Results are rounded half-even to 34 significant digits; transcendentals use 44 working digits.
- **[D: integer limbs]** give bit-identical native and WASM results. Rationals were rejected because they grow without bound.
- **Display:** ≤ 32 significant digits. Plain notation from 1e-7 to 1e16, otherwise scientific or F-E. Grouping `,`, thin space or none; the point is always `.`; Arabic-Indic digits are normalised on input.
- **Transcendentals:** faithful to 32 digits. Degree and gradian arguments are reduced exactly (sin 180° = 0; tan 90° is an error). Also ln, log, eˣ, xʸ (exact for integer y), roots, hyperbolics, and n! ≤ 3248.
- Every loop is bounded.
- **Errors:** `divide_by_zero` "Cannot divide by zero", `undefined` "Result is undefined", `invalid_input` "Invalid input", `overflow` "Overflow". The keypad locks until C/CE.
- **Floats banned:** `clippy.toml` `disallowed-methods` forbids f64 transcendentals outside `graph-core`.

**Key machine in Rust:** `calc.press{mode, angleUnit, state, key}` returns `{state, display, expression, memory, record?}`.
- `state` is opaque, `deny_unknown_fields`, ≤ 8 KiB.
- **Standard:** immediate execution (`2+3×4=` → 20). Repeated `=` repeats the last operation.
- **Windows `%`:** `a+b%`/`a−b%` → `a±a·b/100`; `a×b%`/`a÷b%` → `a×(b/100)`, `a÷(b/100)`; a bare `b%` → `b/100`. **[A: confirmed against Windows Calculator during the M5 spike.]**
- **Scientific:** precedence and parentheses.
- **Memory:** MC/MR/M+/M−/MS plus a list of up to 20.
- `record` is a **self-contained normalized expression** (B10): the operand values as Dec strings, operators and functions, with memory recalls and chained previous results materialised as literals.

**Programmer (`prog.press`, `prog.eval`)**
- QWORD/DWORD/WORD/BYTE as a masked `u64`. Signed display is two's complement. + − × wrap.
- **Shifts:**
  - a count ≥ the word size gives 0 for Lsh and logical Rsh, and sign-fill for arithmetic Rsh;
  - a negative count is invalid;
  - there is no count masking, so the implementation must not use `wrapping_shl`/`wrapping_shr`.
- **Rotates** take the count mod the word size. Rotate-through-carry keeps an explicit carry bit in `state`.
- **Division:** ÷ truncates toward zero and `%` takes the sign of the dividend. ÷0 and %0 give "Cannot divide by zero". MIN ÷ −1 wraps to MIN (as Windows does **[A: verify in the spike]**).
- HEX, DEC, OCT and BIN are shown together; there is a bit-toggle keypad and no floating point.

### B7. Graphing
- **`graph.compile{functions:[≤6]}`:** `y=f(x)` via the calc-core tokenizer, with implicit multiplication, 512 characters per function and depth ≤ 64. Errors carry spans. Output is stack bytecode.
- **`graph.sample{functions, xMin, xMax, yMin, yMax, widthPx, heightPx, angleUnit}`:**
  - 2 samples per column, with adaptive refinement to depth ≤ 6 where |Δy| > half the viewport;
  - segments break on NaN, ±∞, a domain error, or a non-monotone midpoint jump;
  - pixel polylines are rounded to 0.01.
- **Response format:** compact. Each function returns one flat array of numbers plus a break-index list. **[A: a pure Int32 encoding at 1/100 px if JSON size exceeds budget.]**
- **Parity (owner decision):** the pinned `libm` on both targets gives bit-identical results. The alternative is a 1e-12 relative tolerance for `graph.*` only.
- **Rendering:** Canvas 2D. Size comes from CSS classes plus `ResizeObserver` × `devicePixelRatio` via the `width`/`height` attributes. Colours come from tokens via `getComputedStyle`. Each function gets a colour and a dash pattern. Gridlines use 1-2-5 ticks.
- **Interaction:**
  - wheel or pinch zoom about the cursor; drag pans; + − fit reset buttons;
  - keys: arrows, +/−, 0, T for trace;
  - trace shows `x, f(x)` via `calc.eval` in `role="status"`.
- **Drag and zoom performance:** during a gesture the client affine-transforms the last polylines (canvas transform only). It requests a resample after a 120 ms settle, with a `requestAnimationFrame` throttle and a sequence-number guard.
- **Budget:** a full resample takes ≤ 16 ms in WASM and ≤ 50 ms over desktop IPC for 4 functions × 1200 px, measured in M1 (IPC round trip) and M8 **[A]**.
- **Accessibility:** the canvas is `role="img"` with a summary, plus a "Table of values" view.
- **Out of scope:** analysis and sliders.

### B8. Unit converters
`units-core` holds const tables `{id, label, symbol, factor:"num/den", exact, source}` relative to the SI base. Conversion is `x × f_from / f_to` in `Dec`.

| Category | Exact factors |
|---|---|
| Length | in 0.0254 m |
| Mass | lb 0.45359237 kg |
| Volume | US gal 231 in³ = 3.785411784 L; UK gal 4.54609 L |
| Energy | cal_th 4.184 J; BTU_IT 1055.05585262 J; eV 1.602176634e-19 J |
| Power | hp = 550 ft·lbf/s, derived |
| Pressure | atm 101325 Pa; mmHg 133.322387415 Pa; torr 101325/760 |

- **Temperature:** affine through kelvin, with exact rationals for °C, °F, K and °R.
- **Angle:** factors based on π are marked computed.
- **Data:** separate SI (kB = 10³) and IEC (KiB = 2¹⁰) groups, for bits and bytes.
- **Time:** ns through week, plus year (365 d) and Julian year (365.25 d). No month.
- **Sources:** NIST SP 811 and the SI Brochure.
- **UI:** two fields with unit selects, swap, keypad, and a live-formula line. Tables come from `units.catalog`.

### B9. Date and Percentage integration
- The cards are ported with unchanged behaviour: the v1.1.0 calendars, and PCT v2.3.0 reorder, collapse and Tip & Bill Split.
- The engines are called through `date.*` and `percent.*`.
- **Countdown:** a list of up to 20 with labels, all recalculated on open. Each item carries `finishedSeenAtMs`, with the A2 wording and rules. The list is mirrored in the Countdowns pane.

### B10. History (top priority)

**Store** **[D: web history uses IndexedDB, not localStorage. localStorage's ~5 MB per-origin quota is shared by every CipherVaults Pages app and their backups.]**

| | Desktop | Web |
|---|---|---|
| Location | `%APPDATA%\com.portablecalculator.tool\history.json` | IndexedDB database `pcalc`, object store `docs`, key `history` |
| Backups | timestamped `history.<yyyymmdd-hhmmss>.bak`, newest 3 kept | `history.bak.1..3` |
| Write | atomic file replace | one `put` per transaction, which is atomic |

- On the web, `settings`, `state` and `countdowns` live in the same store.
- `navigator.storage.persist()` is requested and `navigator.storage.estimate()` is shown in Settings.
- Change notices between tabs go through `BroadcastChannel("pcalc")`.
- If IndexedDB is unavailable, a memory store is used with the banner "History will not be saved in this browser mode."

**Schema**
```json
{"schemaVersion":1,"entries":[{
 "id":"h-<ms>-<n>","timestampMs":0,
 "tool":"standard|scientific|programmer|graphing|converter|percent|date",
 "calculator":"…","calculatorLabel":"…",
 "inputs":{ …strict, tagged by tool… },
 "expressionText":"…","inputsText":"…","resultText":"…","copyText":"…",
 "pinned":false,"note":null,"engine":"calc-core 1.0.0",
 "origin":"local|date-v1|pct-v2|import","originKey":null}]}
```

| Tool | `inputs` |
|---|---|
| Standard / Scientific | `{expr:[{n:"<Dec>"}|{op:"+"}|{fn:"sin"}|{p:"("}…], angleUnit, mode}` (self-contained; ≤ 256 tokens) |
| Programmer | `{expr:[…u64 literals as hex strings…], wordSize, base, signed, carryIn}` |
| Converter | `{category, from, to, value}` |
| Graphing | `{functions, view, angleUnit}` |
| Date | the 15-field `HistoryInputs`, validated by the ported `INPUT_KEYS` |
| Percent | `{inputA, inputB, inputC?, mode?}` as strings |

**Restore**
- **Calculators:** `calc.eval`/`prog.eval` on `expr` loads the expression and the result. It is deterministic and needs no key replay. A mismatch with the stored `resultText` (after an engine change) shows both values.
- **Other tools:** opens the owning tool with its inputs.
- **Use result:** inserts the value into the current tool.

**Caps**
- Text 1,024; `copyText` 4,096; `note` 200.
- 2,000 unpinned (oldest evicted) plus 200 pinned (never evicted).
- 4 MiB on both surfaces.
- `fit_history_to_file_cap` and the duplicate-newest merge are reused and evict unpinned entries only.

**Recording**
- `=` in the calculators. Date and Percent: as today.
- Converter: copy, Enter or "Add to history". Graphing: "Save graph".
- Live updates never record.

**Durability (every store)**
- **Parse order:** read `schemaVersion` from the raw JSON first.
  - Newer: read-only plus a banner, no `.bak`, never written.
  - Equal: strict parse.
  - Missing or invalid: corrupt.
- **Load outcomes:**

  | Outcome | Handling |
  |---|---|
  | NotFound | empty, writable |
  | Any other read error, or `request_too_large` | read-only, untouched |
  | Corrupt or a dropped entry | a timestamped backup first, then read-only |

- **Leaving read-only:** a successful Retry, or an explicit confirmed "Start a new history".
- **Written rule** (AGENTS.md and a test): any field change to a stored struct bumps its `schemaVersion`. A test fails if the serialized field set of a struct changes without a version bump (a frozen key-list fixture).
- **Write failure** (e.g. `QuotaExceededError`): entries are kept in memory, a banner offers export, and nothing is dropped silently.

**Panel**
- Search: case-insensitive with digit normalisation.
- Filters: All, Pinned and per-tool chips.
- Groups: Today, Yesterday, This week, Earlier. Local today is passed in.
- Rows: tag, muted expression, gold result; Restore (Enter), Copy, Pin, Note, and Delete with a 5 s undo.
- Clear all: confirms with the count; "keep pinned" is on by default.
- `history.enabled` controls recording. The subtitle reads "Saved locally on this device."

**Export and import**
- **JSON:** `{"format":"portable-calculator-export","formatVersion":1,"appVersion","exportedAtMs","history","countdowns","settings"}`.
- **CSV:** cells starting with `= + - @ \t \r` get a `'` prefix.
- **Import (≤ 8 MiB):**
  - `history.import_preview` shows "N new · M duplicates · K rejected", then commits in one atomic write;
  - entries are merged by `id`, or by `originKey` for legacy entries, and never replace existing ones;
  - near-duplicates (same content, timestamps within 1 s, different key) are listed and imported.
- **Desktop file I/O:** import via `<input type=file>`. `export_file` writes `%USERPROFILE%\Downloads\Portable-Calculator-<yyyymmdd-hhmmss>.json` and shows the path. **[A: `tauri-plugin-dialog` decided in M3.]**

**Privacy.** Data stays on the device, with no telemetry. The update check is a payload-free GET.

### B11. Settings, state, countdowns
**`settings`**: 64 KiB, `deny_unknown_fields` at every level, the B10 parse order. A corrupt file gets a backup, then fail-closed defaults with update checks off.
```
{schemaVersion:1, checkUpdatesOnStartup,
 history:{enabled}, display:{grouping}, calculator:{angleUnit, wordSize, base, shiftMode},
 date:{firstDayOfWeek, calendar:CalendarSpec, cardOrder:[6], collapsedCards:[]},
 percent:{cardOrder:[8 exact], collapsedCards:[]}}
```
- **`state`:** last route, per-tool memory, last units, graph functions and view, migration receipts. Each section is validated on its own.
- **`countdowns`:** `{schemaVersion:1, items:[≤20 {id, label≤60, targetDate, targetTime, createdAtMs, savedAtMs, finishedSeenAtMs}]}`. It is a separate failure domain.
- **Desktop files:** `settings.json`, `state.json`, `countdowns.json`.

### B12. Migration (copy only, never move)

**First-run card, consent first.**
- Before consent the app checks **existence only**: file metadata via `legacy.probe` on desktop, and `localStorage.getItem(key) !== null` on the web.
- It shows "Found data from Date Calculator and Percentage Calculator. Import a copy? [Review import] [Not now]".
- The click is the consent to read and parse. Only then does `legacy.preview` show the counts and duplicates, and a second click commits.
- The card can be reopened from Settings.

**Sources**
- **Desktop:** `legacy_fs.rs` reads `%APPDATA%\com.datecalculator.tool\{history,settings,countdown}.json` and `%APPDATA%\com.percentagecalculator.tool\{history,settings}.json` via `read_regular_file_limited`.
- **Web (same origin):** `date_tool_history_v1`, `date_tool_settings_v1`, `date_tool_countdown_v1`, `pct_tool_history_v2`, `pct_tool_settings_v1`.
- **Exports:** files from the old apps' final releases (B13).
- **Parsers:** `pcalc-api::legacy::{date_v1, pct_v2}` with the old structs and caps.

**Mapping**
- **`originKey` comes from content, not from legacy ids.** It is `sha256(family ‖ timestampMs ‖ calculator ‖ canonical-JSON(inputs) ‖ resultText)` in hex, with `family` = `date-v1`|`pct-v2`.
- Only an exact key match counts as a duplicate, so import is idempotent across sources and re-imports. Two entries in one file that share a key get an ordinal suffix in file order, and both are kept.
- The new `id` is `h-<timestampMs>-<ordinal>`.
- Date calendar and first day of week → `settings.date`. PCT `cardOrder`/`collapsedCards` → `settings.percent`.
- `checkUpdatesOnStartup` = the AND of both, so import never turns network access on.
- The v1.1.0 countdown becomes a list item, keeping `finishedSeenAtMs`.

**Old data is never written or deleted.** The one exception is a later, confirmed "Remove old app data on this device", offered only after a verified import, using exact `removeItem` keys.

**Caches:** prefix `pcalc-`, deletion filtered by `pcalc-` only.

**iOS:** home-screen storage is assumed isolated **[A]**. Data moves through the B13 export, by file or by paste.

### B13. Old apps' final releases (an owner yes for each)
Date v1.2.0 and PCT v2.4.0 get:
- a session-dismissible notice "Portable Calculator Tool replaces this app". It is not persisted, so the settings schema does not change.
- **Export my data** in the B10 format, with **both** "Save file" and **"Copy export to clipboard"** (≤ 1 MiB; above that, file only with a warning).
- a constant allowlisting exactly `https://github.com/CipherVaults/Portable-Calculator-Tool/releases` in `open_release_page`;
- release notes linking to the new app.
- **PCT v2.4.0 only:** the A3 history read-only fix (v2.3.0 commands.rs :295).

The clipboard export and the paste import are verified on an iOS home-screen install before release. Repo names and Pages paths do not change.

### B14. CI and release

| Job | What it runs |
|---|---|
| **rust-checks** (ubuntu) | `fmt --check`; clippy with `-D warnings`, native and `--target wasm32-unknown-unknown`; `test --workspace --locked`; each engine's `gen_golden -- --check`; the unsafe-location check |
| **web-build** (ubuntu) | `engine.wasm` built twice and SHA-256 compared, plus the size budget; `build-web.mjs` ×2 for determinism |
| | `check-wasm.mjs`: every golden of every engine through the shipped `.wasm` under TZ=UTC, America/New_York and Africa/Cairo; 200k seeded random requests native vs WASM, byte-diffed; per-op cap edges; the float_roundtrip case |
| | `check-web.mjs` (CSP hashes, `check-versions`); `safety-eval.mjs` on the built output |
| | `browser-boot.mjs`: headless Chrome boots the site and the single file (`data-boot="ok"`, no `securitypolicyviolation`); an **upgrade test** (serve N, boot, serve N+1, reload online and offline, boot OK, no mixed assets); a no-WASM test showing the rescue view |
| **windows-build** (`needs: web-build`) | `tauri build`; Start-Process `--smoke-test` gate (every tool, store round-trips, sentinel `portable-calc-smoke-test`) |
| **release** (push to main only) | refuses an existing tag; **5 assets**: NSIS `*setup*.exe`, `*.msi`, `Portable.Calculator.Tool.Portable.<ver>.exe`, `Portable-Calculator-Tool-Mobile.html`, LF `SHA256SUMS.txt`; `test ${#ASSETS[@]} -eq 5` |
| **pages** | deploys the same web-build artifact |

- `engine.wasm` is not a separate release asset: it is in Pages and inlined in the single-file asset.
- **Hygiene:** SHA-pinned Actions, `persist-credentials:false`, identical node blocks, and `workflow_dispatch` on `dev` as a dry run.

### B15. Oracles

| Area | Oracle |
|---|---|
| date-core | existing goldens, `vectors.json`, chrono over 3.65M days |
| percent-core | existing golden (must stay byte-equal after the `expect` removal) plus new markup/tax/tip cases checked against the PCT JS reference **[A]** |
| calc-num | Python `decimal` at 60 digits plus mpmath, committed offline (`tools/oracle/`, provenance); hand subset in `vectors.json`; identities |
| calc-core | key-sequence goldens from observed Windows behaviour (`5+=`→10, `2+3×4=`→20, `50+10%=`→55, `50×10%=`→5, `√(−1)`→Invalid input) **[A]**; `record` → `calc.eval` round trip equals the display |
| Programmer | JS `BigInt` with explicit `asIntN`/`asUintN` and the spec'd shift rules, independent of Rust `wrapping_*`; hand vectors (shift by 64, MIN÷−1, rotate through carry) |
| units | NIST vectors, A→B→A round trip, −40 °C = −40 °F, 0 K |
| graph | analytic cases (tan, 1/x, sqrt, ln, sin(1/x)), break counts, no-panic token fuzzing |
| WASM ABI | random bytes, oversize input and invalid UTF-8 give an error envelope, never a trap |
| storage and legacy | fixtures for Date 1.0/1.1 and PCT 2.2.1/2.3.0; corrupt, oversize, symlink, newer-schema, read error, quota; cross-source import with colliding legacy ids keeps all entries; old files hash-identical after import |
| Manual | iOS Safari 16.4+, Android Chrome, WebView2 on Windows 10/11 |

**safety-eval slices:**
- **A:** parity.
- **B:** UI under both adapters, with an IndexedDB fake in the mini-DOM **[A]**.
- **C:** storage and migration.
- **D:** static hygiene with mutant proofs.
- **E:** accessibility.

### B16. Security and accessibility
**Security**
- Desktop CSP unchanged: `connect-src 'none'`, no `'wasm-unsafe-eval'`.
- PWA CSP as in B3.
- WASM integrity-checked and memory-capped.
- Imports validated in Rust before any write.
- Consent comes before reading legacy data.

**Accessibility**
- Every key has an `aria-label`.
- The result is announced politely on `=` only.
- `fieldset`/`legend` for converter sides and modes.
- focus-visible everywhere; 44 px coarse targets.
- Graph table alternative.
- Contrast checked on calendar cells and chips.

### B17. Milestones (PBS v1.1: plan approval = goal approval; each milestone ends with a ledger entry)

| M | Scope | Done when | Owner gate |
|---|---|---|---|
| A1 | calendars | Part A calendar criteria green | plan approval incl. A3/A4 |
| A2 | countdown persistence, A3 history fix, CI version split | Part A criteria green, smoke round-trip, CI green | — |
| A3 | Date v1.1.0 release | A7 complete | **merge dev→main** |
| M0 | repo, workflow-free `main`, `dev`, workspace, toolchain, CI skeleton, D-slice | CI green on `dev`; `main` has no workflows | **create repo; `main` initial commit; Pages enablement; identifier; `libm`; serde_json rule; browser floor** |
| M1 | `pcalc-api` (per-op caps), `pcalc-wasm`, `check-wasm`, single-file builder, CSP spike in four engines, IPC graph-payload measurement | goldens byte-equal native/WASM under 3 time zones; sizes and IPC timing recorded | — |
| M2a | **+ i18n and theme infrastructure (B5b/B5c): catalogs, formatter, plural table, logical CSS, tokens, pre-paint theme script, language and theme pickers** · shell, adapters, tokens, navigation, `pcalc-store`, IndexedDB store, hashed SW and upgrade test, rescue view | browser-boot incl. upgrade and no-WASM; desktop smoke | — |
| M2b | Date port | Date safety-eval B/C under both adapters | — |
| M2c | Percent port | PCT criteria under both adapters | — |
| M3 | history (expression-based schema), settings, state, countdowns, export/import | corruption, read-error, quota, newer-schema and cap-edge tests; export round-trip | export method |
| M4 | legacy importers, consent-first card | cross-source fixtures idempotent; old files unchanged | — |
| M5a | `calc-num` + oracle | oracle suite, no-panic fuzz | — |
| M5b | Standard key machine, memory, `%` semantics | key goldens; record→eval round trip | — |
| M5b+ | **Mini Calculator** (B5a): multi-window, single instance, shared history, Keep on top, web pop-out/PiP, the keyboard Calculator key setting and uninstall cleanup | smoke with two Mini windows sharing history; AppKey toggle tests; the key press opens Mini on the owner's keyboard (manual) | the `tauri-plugin-single-instance` dependency (covered by plan approval) |
| M5c | Scientific | oracle + key goldens | — |
| M6 | Programmer | BigInt oracle, hand vectors; bit keypad accessible | — |
| M7 | converters (12) | NIST vectors and round trips | — |
| M8 | graphing | analytic suite; budgets met or fallback documented; trace and table accessible | cut line if it slips (current answer: ship all) |
| M9a | **Languages (B5c):** 11 translated catalogs (ar, es, fr, de, pt-BR, it, ru, tr, zh-Hans, ja, ko) incl. holiday names; independent translation check per language; Arabic RTL polish | `check-i18n` clean; pseudo-locale and 390 px screenshots for ar/de/ja without overflow; owner reviews Arabic | owner Arabic review |
| M9b | **Themes (B5b):** Daylight and Retro (95/98 with an XP nod), `System` option, per-theme graph/calendar tokens | AA contrast check passes for every theme; no wrong-theme flash; screenshots of every tool in all 3 themes at 390 px and desktop | — |
| M9 | hardening, accessibility audit, docs, release notes | full checks; manual device checklist in the ledger | — |
| M10 | v1.0.0 via PR dev→main | 5 assets; `sha256sum -c` passes; Pages live | **merge → release** |
| M11 | Date v1.2.0, PCT v2.4.0 | notice, file+clipboard export verified on iOS, PCT history fix | **each merge and release** |

No time estimates are given **[A: the owner may ask for them after M1, once sizes and timings are measured]**. M2c (both old tools working in the new shell) is a natural internal checkpoint. It is not a public release.

### B18. Top risks
1. **History loss.** Mitigation: read-only mode on any non-NotFound failure, backups before rewrites (3 kept), the newer-schema guard, per-op caps that never route to "corrupt", content-keyed import, tests.
2. **The custom decimal is wrong.** Mitigation: 60-digit independent oracles, guard digits, early M5a.
3. **Native and WASM diverge.** Mitigation: integer decimal, banned floats, `libm`, `float_roundtrip` declared in `pcalc-api`, full replay plus random diffs.
4. **The CSP data-block assumption fails.** Mitigation: the M1 spike; fallback is multi-file only.
5. **An old or locked-down browser cannot run WASM.** Mitigation: a stated floor, the unsupported screen, the read-only rescue export, the old apps still working.
6. **A stale service worker mixes asset versions.** Mitigation: hashed names, atomic precache, the upgrade boot test.
7. **Shared-origin quota.** Mitigation: IndexedDB for the new stores, `pcalc-`/`pcalc` names, never `clear()`, an estimate shown before import.
8. **iOS storage is isolated.** Mitigation: file and clipboard export in the final releases, paste import.
9. **A push to `main` auto-publishes.** Mitigation: a workflow-free initial `main`, PR-only, dry runs, never overwriting a tag, owner gates.
10. **Scope.** Mitigation: split milestones, ports and history first, a cut line.
11. **Fresh SmartScreen reputation.** Mitigation: release notes, SHA256SUMS, the Portable exe.
12. **Settings downgrade or schema churn.** Mitigation: separate stores, raw `schemaVersion` first, the bump-on-change rule with a test.

### B19. Out of scope for v1.0
- Currency, sync, accounts, telemetry; notifications or alarms.
- Code signing; macOS and Linux builds. (Translations and a light theme were moved into v1.0 on 2026-11-18: B5b, B5c.)
- Complex numbers, matrices, statistics, `rand`, gamma.
- Implicit, polar, parametric or inequality graphs; analysis, sliders, image export.
- Month as a time unit.
- Calendar range hover preview; calendars on Days Between, Add and Age.
- Auto-deleting or uninstalling the old apps.
- Browsers below the stated floor (beyond the rescue view).

**Owner decisions at plan approval:**
- A3: the history read-only/backup fix in v1.1.0.
- A4: decouple app and engine versions, including the CI split and the AGENTS.md rule.
- `libm` for graphing.
- serde_json allowed in `pcalc-api`.
- The identifier `com.portablecalculator.tool`.
- Desktop stays native.
- The browser floor (Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+).
- IndexedDB for web history.
- The M0 workflow-free `main` and Pages enablement.

**Next permitted action:** the owner reviews and approves this plan, and with it the Goal. Implementation then starts at A1 on `dev`.

---

### Critique items not adopted
None of the 21 findings was rejected. I checked the main claims against the code: the CI version asserts at build.yml :115/:126/:258/:269/:338 and pages.yml :107/:118, the `input`+`change` binding at main.js :2697/:2737, the `.holiday` inset shadow at styles.css :1129-1131, the `date-tool-` cache prefix at sw.js :101, and date-core being serde-only. Where a finding offered alternatives, this is what I chose:
- **Release assets:** dropped `engine.wasm` rather than making it a sixth asset.
- **Countdown saves:** save on change plus a flush on hide, not a debounce.
- **Web storage budget:** IndexedDB rather than splitting the localStorage budget.
- **Legacy dedupe key:** leaves out the source surface. That way the same entry arriving through two routes, such as a desktop file and an export of it, is still counted as a duplicate.
- **percent-core expect removal:** I could not read PCT v2.3.0 lib.rs:209-210 in this pass. The rule that the goldens must pass unchanged guards that change.