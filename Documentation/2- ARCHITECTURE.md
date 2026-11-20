# Architecture

## Overview

Portable Calculator Tool **v0.1.0** (in development; API 1, WASM ABI 1; engines date-core 1.0.0 and percent-core 2.3.0, four more at 0.1.0 as skeletons) is one shared web front end (`web/`) with two surfaces: a **Tauri 2 + Rust** Windows desktop app and a **phone-first PWA** (a multi-file GitHub Pages site and a single-file HTML). Both run the same Rust engine API, `crates/pcalc-api`: natively on the desktop through one Tauri command, and compiled to WebAssembly on the web. `scripts/check-wasm.mjs` proves the two byte-identical.

It merges and replaces CipherVaults' Date Calculator Tool v1.2.0 and Percentage Calculator Tool v2.3.0 and reuses their proven parts on purpose: date-core, percent-core, the hardened storage, the smoke test, the CSP discipline and the safety-eval harness. Where this document and the code disagree, the code wins ([SOURCE_OWNERSHIP_MAP.md](pbs/SOURCE_OWNERSHIP_MAP.md#conflict-rules)). Where design texts disagree, the owner clarifications at the top of [5- PORTABLE_CALCULATOR_PLAN.md](specs/5-%20PORTABLE_CALCULATOR_PLAN.md) win, then its Part B. Parts marked **planned** are designed but not built. Last structural review: 2026-11-20, at `d7a6712`.

```text
+--------------------------------------------------------------------+
| Shared front end (web/: classic scripts on window.PCalc, tokens)   |
|  - boot, router (21 routes), shell: drawer, pane, phone bottom bar |
|  - tools: Date (6 cards), Percentage (8 cards); others planned     |
|  - History panel + history store (operations, compare-and-save)    |
|  - themes (tokens.css, pre-paint), i18n catalogs, format tables    |
|  - platform adapter: engine(op, req), store, export               |
+-------------------------------+------------------------------------+
                                |
        +-----------------------+-----------------------+
        | desktop (platform/tauri.js)                   | web (platform/web.js)
        | invoke("engine_call", {op, req})              | engine-web.js: SHA-256 check,
        | store_load/save/save_if/clear, export_file    | pc_in / pc_call / pc_out
        v                                               v
+-------------------------------+   +--------------------------------+
| Tauri shell (src-tauri)       |   | engine.wasm (crates/pcalc-wasm)|
|  - engine_call = pcalc_api    |   |  - raw ABI, no wasm-bindgen    |
|  - store_* = pcalc-store docs |   |  - 64 MiB memory cap           |
|  - export_file, --smoke-test  |   +---------------+----------------+
|  - CSP connect-src 'none'     |                   |
+-------+-----------------------+                   |
        |                                           |
        v                                           v
+--------------------------------------------------------------------+
| pcalc-api: closed op list (25 ops), per-op caps, one envelope,     |
| store validators, history.apply / import_preview / export_csv      |
+----+----------------+----------------+-----------------------------+
     |                |                |
     v                v                v
 date-core 1.0.0  percent-core 2.3.0  calc-num, calc-core, units-core,
 (pure)           (pure)              graph-core 0.1.0 (skeletons)

+-----------------------------+   +----------------------------------+
| pcalc-store (native only)   |   | Web storage (web/src/core)       |
|  %APPDATA%\                 |   |  IndexedDB "pcalc" / "docs"      |
|  com.portablecalculator.tool|   |  localStorage mirrors pcalc.theme|
|  backups (newest 3),        |   |  and pcalc.lang (pre-paint only) |
|  docs.lock, Downloads export|   |  BroadcastChannel("pcalc")       |
+-----------------------------+   |  sw.js (hash-verified cache)     |
                                  +----------------------------------+
```

---

## Workspace layout

```text
Cargo.toml                 workspace (resolver 2) of 10 packages; [profile.wasm]
rust-toolchain.toml        Rust 1.99.1, targets x86_64-pc-windows-msvc + wasm32-unknown-unknown
crates/date-core/          date engine 1.0.0 (copied from Date-Calculator-Tool be06e59), examples
                           date_bridge.rs + gen_golden.rs, tests + fixtures/{vectors,golden}.json
crates/percent-core/       percentage engine 2.3.0 (from Percentage-Calculator-Tool v2.3.0),
                           percent_bridge example, tests + fixtures/golden.json
crates/calc-num/           34-digit decimal (M0 skeleton: parse, canonical text)
crates/calc-core/          key machine, parser, Programmer (M0 skeleton: tokenizer, word sizes)
crates/units-core/         unit tables (M0 skeleton: 12 categories, Length table)
crates/graph-core/         graphing (M0 skeleton: viewport validator, bytecode set); uses libm
crates/pcalc-api/          lib, op, envelope, date, percent, meta, store, history; examples/api_bridge.rs;
                           tests/golden_replay.rs, fixtures/store-keys.json
crates/pcalc-wasm/         lib.rs (the four exports), build.rs (memory cap)
crates/pcalc-store/        fs, docs, export, update (native only)
src-tauri/                 main.rs, commands.rs, tauri.conf.json, capabilities/default.json, icons/
web/                       index.template.html, build-manifest.json, sw.template.js, manifest.webmanifest,
                           src/{prepaint,boot,rescue}.js, src/core/, src/platform/, src/shell/,
                           src/tools/{date,percent}/, src/history/, styles/, i18n/en.json, icons/
scripts/                   build-wasm, build-web, check-wasm, check-i18n, check-web, check-versions,
                           check-unsafe, browser-boot, safety-eval, serve-web (.mjs); lib/ helpers
dist/                      build output (git-ignored): desktop/, web/, the single file, build-info.json
.github/workflows/ci.yml   CI on dev (no release job before M10)
Documentation/             context, architecture, roadmap, specs/, pbs/, handoff/
```

---

## Main Architectural Parts

### 1. Pure engines (`crates/date-core`, `percent-core`, `calc-num`, `calc-core`, `units-core`, `graph-core`)

**Purity contract** (AGENTS.md, plan B1):
- `#![forbid(unsafe_code)]`; serde is the only dependency. The one exception is `graph-core` → `libm =0.2.11` (owner-approved), so native and WASM transcendentals are bit-identical.
- No clock, time zone, locale, environment or I/O. "Today" and "now" are always request fields (the web takes them from `web/src/core/clock.js`).
- No input can panic. `scripts/check-unsafe.mjs` refuses `unwrap()`, `expect(…)`, `panic!`, `unreachable!`, `todo!` and `unimplemented!` above `#[cfg(test)]` in every engine and in `pcalc-api` (raw-text scan, comments included).
- Each engine asserts `ENGINE_VERSION == CARGO_PKG_VERSION`; its golden header carries that version.

| Crate | Version | State | Notes |
|---|---|---|---|
| `date-core` | 1.0.0 | working | Copied unchanged from Date Calculator Tool `be06e59` (last engine change `84e7347`); only its bridge example was renamed `date_bridge`. Civil math 0001-01-01..9999-12-31, US/UK/Egypt holidays 1900–2199, tabular Hijri, business days, `month_grid`, the `Strict` deserializer. Its full description is the Date repo's `Documentation/2- ARCHITECTURE.md` |
| `percent-core` | 2.3.0 | working | From Percentage Calculator Tool tag `v2.3.0` (`6edbfff`). Added `#![forbid(unsafe_code)]` and `ENGINE_VERSION`; the two `expect()` calls in `js_exponential` replaced by total code with byte-identical output (E-09). Its discount, markup, tax and tip `label` contains a literal `<br>`, which the UI never renders |
| `calc-num` | 0.1.0 | skeleton | `Dec`: sign, base-10⁹ `u32` limbs, decimal exponent; no floats. Parsing and canonical text only. **Planned (M5a):** arithmetic rounded half-even to 34 digits, transcendentals, a 60-digit oracle |
| `calc-core` | 0.1.0 | skeleton | `Mode`, `AngleUnit`, the tokenizer, Programmer word sizes. **Planned (M5b, M5c, M6):** `calc.press`, `calc.eval`, `prog.press`, `prog.eval` |
| `units-core` | 0.1.0 | skeleton | The twelve categories in drawer order and the Length table. **Planned (M7):** the other eleven tables, `units.catalog`, `units.convert` |
| `graph-core` | 0.1.0 | skeleton | Request limits, the `Viewport` validator, the bytecode set. The only engine that uses `f64`. **Planned (M8):** `graph.compile`, `graph.sample`, `graph.trace` |

**Fixtures and oracles** (never regenerated to make code pass):
- `date-core/tests/fixtures/vectors.json`: 195 hand-verified cases.
- `date-core/tests/fixtures/golden.json`: 13,965 cases (seed `0xDA7E2026`). It is regenerated only for an intentional engine change (`gen_golden -- --write`); CI runs `--check`.
- the `chrono` oracle over all 3,652,059 days (dev-dependency only), plus the holiday, business-day, property, copy-text and safety suites carried over from the Date app.
- `percent-core/tests/fixtures/golden.json`: the v1.1 JavaScript oracle, 10,661 cases.
- The ROADMAP's new markup/tax/tip goldens were not added: they need an independent oracle first (Ledger §7).

### 2. The one API (`crates/pcalc-api`)

Every surface calls `pcalc_api::call(op, req) -> String` (or `call_bytes` on raw bytes): the Tauri command `engine_call`, the WASM ABI and the NDJSON `api_bridge` example. The crate follows the engine rules but may use `serde_json`; it declares the `float_roundtrip` feature itself, so native and WASM builds parse percent `f64` inputs identically.

**Order of checks** (`lib.rs`):
1. The op name is looked up in the closed list. Anything else, including invalid UTF-8 or more than 64 bytes, is `unknown_op`.
2. The raw request length is checked against the op's cap **before any parsing**. Over the cap is `request_too_large`, which storage treats as "cannot validate", never as corrupt.
3. Invalid UTF-8, malformed JSON, a wrong shape or an unknown field is `invalid_request`.

**Envelope:** date-core's everywhere. A success is `{"ok":"true","result":{...}}` and a failure is `{"ok":"false","error":{"code":"…","field":…,"message":"…"}}`. The tags are strings, JSON is camelCase and every request struct has `deny_unknown_fields`. Percent results are wrapped into it, with error codes `zero_divisor`, `negative_value` and `invalid_people` and percent-core's English messages.

**Ops and caps** (`op.rs`, 25 ops; the match is exhaustive, so a new op cannot compile without a cap):

| Ops | Cap |
|---|---|
| `meta.versions`; `date.days_between`, `date.add_subtract`, `date.business_days`, `date.age`, `date.date_info`, `date.countdown`, `date.holidays_in_range`, `date.month_grid`, `date.validate_calendar`; `percent.change`, `percent.percent`, `percent.what`, `percent.discount`, `percent.base`, `percent.markup`, `percent.tax`, `percent.tip` | 64 KiB (`CAP_ENGINE`) |
| `settings.validate`, `state.validate`, `countdowns.validate` | 256 KiB (`CAP_STORE`) |
| `history.validate`, `history.export_csv` | 4.5 MiB (`CAP_HISTORY_VALIDATE`) |
| `history.apply`, `history.import_preview` | 8 MiB (`CAP_IMPORT`, also the largest request) |

The `date.*` names drop date-core's `calc_` prefix; the mapping is tested. `meta.versions` returns `{api: 1, app, engines: {date-core, percent-core, calc-num, calc-core, units-core, graph-core}}`. `API_VERSION` changes only with an incompatible change to ops, envelope or caps. The `calc.*`, `prog.*`, `units.*` and `graph.*` ops are **planned** and answer `unknown_op` until their milestones.

**Store validators** (`store.rs`). The four documents `settings`, `state`, `history` and `countdowns` are judged only by `<name>.validate`, on the stored raw text: `ok` (with the canonical document), `newer` or `invalid_request`. All four are at `schemaVersion` 1. Their key paths are frozen in `tests/fixtures/store-keys.json`; any field change to a stored struct bumps its `schemaVersion`. Top-level keys:
- `settings`: `appearance`, `calculator`, `checkUpdatesOnStartup`, `date`, `display`, `history`, `language`, `percent`;
- `state`: `dev`, `pane`, `route`;
- `history`: `entries`;
- `countdowns`: `items`, at most 20.

**History** (`history.rs`, plan B10, M3):
- Entries are strict per tool. Date has 15 input fields parsed by date-core; Percentage has `{inputA, inputB, inputC?, mode?}`. The other five tools of the closed list (`standard`, `scientific`, `programmer`, `graphing`, `converter`) refuse every entry until their milestones.
- Caps: text 1,024, `copyText` 4,096, note 200 code points; 2,000 unpinned plus 200 pinned entries; 4 MiB written.
- Hidden bidi controls, U+2028/2029 and U+FEFF are refused in every history text.
- `history.apply` applies the operations `add`, `import`, `delete`, `clear {keepPinned}`, `pin` and `note` (at most 5,000) to the **stored** document as it is at write time. It sorts newest first, enforces the caps (evicting the oldest unpinned entries only) and returns `opResults`: what each operation removed, so Undo puts back exactly that. An operation that would put the pinned entries alone over 4 MiB is refused at its index.
- `history.import_preview` checks an export file entry by entry ("N new · M duplicates · K rejected", near-duplicates counted). `history.export_csv` writes formula-escaped CSV cells.
- The export format is `portable-calculator-export`, `formatVersion` 1.

### 3. WASM engine (`crates/pcalc-wasm`) and the native == WASM proof

**Raw ABI, version 1, no wasm-bindgen** (`lib.rs`):

| Export | Meaning |
|---|---|
| `pc_abi() -> u32` | the ABI version (1) |
| `pc_in(len) -> u32` | sizes the input buffer and returns its address, or 0 when `len` is over 64 + 8 MiB |
| `pc_call(op_len, req_len) -> u32` | runs `call_bytes` on the buffered op and request, stores the envelope, returns its length |
| `pc_out() -> u32` | the address of the stored envelope |

- The buffers are `thread_local!` `RefCell<Vec<u8>>` with `try_borrow*` only, so nothing panics. Capacity above 64 KiB is released after each call.
- `#![deny(unsafe_code)]`; the only `#[allow(unsafe_code)]` items sit on the four `#[unsafe(no_mangle)]` exports (`check-unsafe.mjs` enforces it). The crate is `cdylib` + `rlib`, so its safe core is unit-tested natively.
- `build.rs` caps linear memory at 64 MiB (`--max-memory=67108864`) for wasm32 builds.
- `[profile.wasm]`: inherits release, `opt-level = "z"`, `lto`, `codegen-units = 1`, `panic = "abort"`, `strip`.
- **Build only through `scripts/build-wasm.mjs`.** It remaps the cargo home and the repository paths in panic locations, refuses any engine that still contains a local path (`scripts/lib/local-paths.mjs`), and with `--check-twice` rebuilds in an emptied `target/wasm-repro` and compares the bytes. It is the only writer of `target/engine/engine.wasm`; `build-web`, `check-wasm` and `safety-eval` refuse a leaky engine. A bare `cargo build` embeds the builder's home path. The bytes are reproducible per OS, not across Windows and Linux.

**Loader** (`web/src/core/engine-web.js`): checks the bytes' SHA-256 against the build-time constant before compiling, re-reads `memory.buffer` after every call, and re-instantiates after a trap, answering that call with `internal`. When `pc_in` refuses, it asks about the op alone, so an unknown op is still `unknown_op` as on native. Failure codes: `no_wasm`, `no_crypto`, `integrity`, `instantiate` (and `load` from the web adapter).

**Parity proof** (`scripts/check-wasm.mjs`, plan B14), one child process per time zone (UTC, America/New_York, Africa/Cairo):
- every date-core golden case through `date_bridge`, `api_bridge` and `engine.wasm`, equal to the stored bytes;
- every percent-core golden case through `api_bridge` and WASM, with fields equal to the JavaScript oracle;
- 200,000 seeded random requests (seed 20261118, `scripts/lib/random-requests.mjs`) over all 25 ops, unknown ops, malformed JSON, invalid UTF-8 and cap edges, byte-compared native vs WASM;
- the single file must embed the same engine.

The script builds the release bridges itself. E-12: 0 mismatches in all three zones.

### 4. Native storage (`crates/pcalc-store`)

The native-only crate, and with `pcalc-wasm` the only crate allowed I/O. It never builds for wasm32. Its rules are factored out of the Date app's `commands.rs`.

- **`fs`:** `read_regular_file_limited` refuses symlinks and non-regular files and checks the size before, during and after the read. Writes go to a unique `create_new` temp file, then `sync_all` and `rename`, with private parent directories; the temp file is removed on any failure.
- **`docs`** (`DocStore`, plan B10/B11): `%APPDATA%\com.portablecalculator.tool\<name>.json`. Every load decides through `pcalc_api::store::check`:

| Load outcome | Status | Handling |
|---|---|---|
| no file | `empty` | writable |
| any other read error | `unreadable` | read-only, untouched |
| over the validator's cap | `tooLarge` | read-only, untouched (never "corrupt") |
| a newer `schemaVersion` | `newer` | read-only, untouched, no backup |
| not valid | `corrupt` | timestamped backup first, then read-only |
| valid | `ok` | writable; canonical document returned |

  - Backups are `<name>.<yyyymmdd-hhmmss>[-n].bak`, newest 3 kept. The backup just written is never pruned, even when the clock was set back.
  - A save of a document not yet loaded loads it first.
  - `save_if` is the compare-and-save every history write uses.
  - `clear` ("Start fresh") backs up and reads the backup back, never clears a newer document, and refuses one that validates again as `recovered`.
  - Writes are serialised in the process and, across processes, by an exclusive lock on `docs.lock` (a symlinked lock is never followed).
  - Write caps: settings and countdowns 64 KiB, state 256 KiB, history 4 MiB.
  - `DocStore::memory()` serves the smoke test.
- **`export`:** a new `Portable-Calculator-<yyyymmdd-hhmmss>.json|csv` in the Downloads folder, never overwriting (`-2` … `-99`). The renderer passes only the kind and a checked time stamp, never a path. No dialog plugin (the M3 "export method" decision).
- **`update`:** the payload-free GitHub "latest release" check through the system `curl` (HTTPS only, TLS 1.2+, 8 s, 64 KiB), with release-URL sanitising and semver comparison, parameterised by an `AppIdentity`. **Not wired yet:** there is no Tauri command or UI for it.

### 5. Web shell (`web/`)

Plain classic scripts, no framework, bundler or npm. `web/build-manifest.json` fixes the load order. Each script adds one frozen member to `window.PCalc` (`core/ns.js`), and `boot.js` freezes the namespace last. DOM changes go only through `core/dom.js`: `textContent`, `createElement`, an attribute allowlist, `classList` and `replaceChildren`. There is never an HTML sink, `eval`, `new Function` or a `.style` write (`scripts/lib/web-hygiene.mjs`, raw-text scan, comments included).

- **Pre-paint** (`src/prepaint.js`): the first script in `<head>`. It sets `data-theme`, `lang` and `dir` from the localStorage mirrors `pcalc.theme` and `pcalc.lang`, so no wrong theme or direction flashes. It is inline and hash-pinned on the web, an external file on the desktop. The settings document stays the source of truth.
- **Boot** (`src/boot.js`): picks the adapter and loads the engine, then:
  - runs the engine self-checks, opens the store and loads settings and state;
  - applies the theme and language and starts the shell on the last route;
  - refuses to render inside a frame;
  - exposes its verdict for the headless checks as `data-boot` (`ok`, `error`, `unsupported`, `integrity`, `load-failed`, `framed`), plus `data-engine`, `data-store`, `data-assets` and `data-boot-ms`.

  On the desktop `--smoke-test` run it drives every route, the store round trips and the themes, and times `engine_call`.
- **Rescue view** (`src/rescue.js`): when the engine cannot start (no WebAssembly, iOS Lockdown Mode, a damaged or missing file), it lists the app's stored raw values (localStorage `pcalc*` keys and IndexedDB `docs`) for copy or save. It never writes, validates or creates the database.
- **Router** (`core/router.js`): a closed list of 21 hash routes. They are `standard`, `scientific`, `graphing`, `programmer`, `date`, `percent`, twelve `converter/<category>` routes, `settings`, `about` and `mini`. An unknown hash falls back to `standard`, and nothing in the hash is evaluated. Alt+1 to Alt+6 open the first six. The calculator, converter and `mini` routes are placeholders naming their milestone (**planned**).
- **Shell** (`shell/shell.js`), by width:
  - below 760 px the top bar holds only the title, and a bottom bar holds ☰ Menu, a quick switch back to the previous tool and History (44 px, safe-area insets, hidden while a keyboard field has focus); the drawer is a modal sheet and the pane a bottom sheet;
  - from 760 to 1100 px the drawer is modal and the pane a modal overlay;
  - from 1100 px both are docked columns.

  The pane has History | Memory | Countdowns tabs; Memory is a placeholder until M5b. Ctrl+H opens history.
- **Platform adapters** (`platform/tauri.js`, `platform/web.js`): `engine(op, req)`, `store.load/save/saveIf/clear`, export and the share sheet. Desktop: `engine_call`, `store_*` and `export_file` over Tauri IPC. Web: `engine.wasm` (fetched with its content hash, or base64 in `<script type="application/octet-stream" id="engineWasm">` in the single file) and IndexedDB.
- **Stores** (`core/store.js`): IndexedDB database `pcalc`, object store `docs`, key = document name. It has the desktop's outcomes, plus `unvalidated` (read-only) when the engine cannot answer. Backups are `<name>.bak.1` to `.bak.3`, rotated in one transaction. `saveIf` reads and replaces in one readwrite transaction. Without IndexedDB the store runs in memory, with a banner.
- **Cross-window bus** (`core/bus.js`): `BroadcastChannel("pcalc")` with `{v: 1, type}` messages from the closed list `history-changed`, `settings-changed`, `state-changed` and `countdowns-changed`; anything else is ignored. Without BroadcastChannel it is a no-op.
- **Service worker** (`sw.template.js` → `dist/web/sw.js`, cache `pcalc-v<app>-<buildhash>`):
  - `install` fetches every build file past the HTTP cache and checks each one against its SHA-256 in `BUILD.sha256`. A stale `index.html` fails the install and the old worker stays in charge;
  - `activate` deletes only other `pcalc-` caches;
  - navigations are network-first with this build's cached `index.html` as the fallback, and build assets are cache-first from this build's cache only.
- **CSP and Trusted Types** (written by `scripts/build-web.mjs`):
  - Pages: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval' '<prepaint sha256>'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.github.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types pcalc`. The one policy, `pcalc` in `boot.js`, passes only `sw.js`.
  - Single file: the inline script and style pinned by their SHA-256, `connect-src https://api.github.com` and `trusted-types 'none'`.
  - No `frame-ancestors` in a meta CSP. The desktop CSP is in part 7. `check-web.mjs` proves every inline block is pinned and no hash is stale.
- **Tokens and themes** (`styles/tokens.css`): every colour, border, radius and font is a custom property. There is no raw colour literal elsewhere, and layout CSS uses logical properties only (RTL). The `terminal`, `daylight` and `retro` blocks define the same tokens and pass WCAG AA on 34 declared pairs each (E-12). `system` follows `prefers-color-scheme`. Daylight's accent (`#8A5F00`) and Retro's title-strip gradient end (`#0f78bd`) differ from plan B5b so that they pass AA (Ledger §6).
- **i18n and formatting** (`core/i18n.js`, `core/format.js`):
  - flat catalogs `web/i18n/<lang>.json`, read through `t("key", {params})`, with plural objects by CLDR category. Hand-written plural rules for the twelve languages (`en`, `ar`, `es`, `fr`, `de`, `pt-BR`, `it`, `ru`, `tr`, `zh-Hans`, `ja`, `ko`). Pseudo-locales `en-XA` and `ar-XB`;
  - number and date tables per language, never `Intl`; Arabic-Indic input normalised everywhere; a Digits setting;
  - only `en.json` exists (627 keys at E-12). The translated catalogs are **planned** (M9a). Until then, engine-produced English is shown inside `<bdi dir="ltr">` runs.
- **Shared shell parts:** `shell/card-layout.js` (collapse, reorder by pointer, keyboard or the Move menu), `shell/announcer.js` (one polite live region per tool, spoken on a pause or on Calculate), `shell/sign-toggle.js` (the ± key), `shell/history.js` (the `record(entry)` hook), `shell/prefs.js` (defaults that must pass the engine's validators) and `shell/views.js` (route → view, Settings, About).

### 6. Tools (`web/src/tools/`, `web/src/history/`)

A tool is a module that `views.js` renders for its route and tells to `leave()` (stop timers, flush) when another route renders. It calls engines only through `ctx.platform.engine(op, req)`. It records history only on explicit actions (Calculate, Enter, Copy), through `PCalc.history.record(entry)`, and live updates never record. It restores an entry through `restore(entry)`: the stored inputs go back and are computed again in the current language. Card order and collapsed cards live in `settings.<tool>`.

- **Date** (`tools/date/`, M2b):
  - `date-tool.js`: the six cards with live results and the live-formula panel. Per-card sequence counters drop stale answers;
  - `mini-cal.js`: the engine's 42-cell grids as buttons, with a roving tabindex and Today;
  - `date-settings.js`: weekend, presets, Hijri, custom holidays and exclusions, first day. Every change is checked by `date.validate_calendar` before it replaces the calendar;
  - `countdowns.js`: up to 20 labelled countdowns in the `countdowns` document. Saved on commit only, `finishedSeenAtMs` written once per target, merged by id across tabs, and mirrored in the Countdowns pane.
- **Percentage** (`tools/percent/percent-tool.js`, M2c):
  - the eight cards with live results, formulas, swap, tax Add/Extract, tip presets 10/15/18/20 % and people from 1, paste cleaning and Clear all;
  - result lines are built as text from the engine's `*Text` fields inside catalog text; the `<br>` label is never shown;
  - fields are `type="text"` with `inputmode="decimal"` and `dir="ltr"`, so typed Arabic-Indic digits compute.
- **History** (`history/`, M3; the owner's top priority):
  - `history-store.js`: every change is an operation list. It is applied by `history.apply` to the stored document and written with `saveIf` / `store_save_if`. On `conflict` it reads again and re-applies, up to 12 times, then shows a banner with the entries kept. Other windows follow through the bus. On a read-only store or a failed write, the operations stay in memory with an Export banner. An operation the engine refuses is dropped alone, with a banner; nothing is dropped silently;
  - `history-panel.js`:
    - "Your history data" (Export, Copy export, Import, Delete history) sits above the list;
    - search with digit normalisation, filter chips, groups by local day, and paged rows (60 at a time, rows reused on redraw);
    - each row offers Restore and Actions (Copy, Use result, Pin, Note, Delete);
    - Undo stays in a sticky 10 s bar;
  - `history-io.js`: the JSON export (history, countdowns and settings; import applies history only) and the CSV with a UTF-8 byte order mark. Web: a Blob download, the share sheet in an iOS home-screen app, the clipboard, or the export text shown selected. Desktop: `export_file`. Import (≤ 8 MiB) shows the preview, then makes one write.
  - Budgets under 4x CPU throttling, stated in browser-boot: render 250 ms, search 250 ms, Show more 150 ms, one change with 2,200 rows loaded 700 ms, one recorded entry 700 ms.
- **Planned tools** (not built): Standard with memory (M5b), the Mini Calculator (M5b+), Scientific (M5c), Programmer (M6), twelve converters (M7) and Graphing (M8). See part 11.

### 7. Desktop app (`src-tauri/`)

`main.rs` builds the window itself, not `tauri.conf.json`:
- label `main`, 1120×860, minimum 360×560, centred;
- built **hidden** with the stored theme's background (Terminal `#0E0F12`, Daylight `#F4F1EA`, Retro `#008080`, each equal to that theme's `--bg`, which a test checks); for `system` the OS theme is resolved before the window is shown;
- it loads `dist/desktop`, which `tauri::generate_context!` embeds at compile time, so `node scripts/build-web.mjs --desktop-only` must run before any Cargo build of the app.

It manages `SmokeState` and `AppStore` (a `DocStore` in the app data folder, in memory under `--smoke-test`) and registers 8 commands (`commands.rs`):

| Group | Commands |
|---|---|
| Engine (1) | `engine_call(op, req) -> String`, exactly `pcalc_api::call`. Caps, UTF-8 and JSON are checked inside the API, as on WASM |
| Store (4) | `store_load` (also Retry), `store_save`, `store_save_if`, `store_clear`. Each returns `pcalc-store`'s outcome and error codes |
| Export (1) | `export_file(kind, stamp, text)`: a new file in Downloads, a temp folder in smoke mode; returns the full path |
| Smoke test (2) | `is_smoke_test`, `report_smoke_result` |

**Security configuration:**
- **CSP** (`tauri.conf.json`): `default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. There is no `'wasm-unsafe-eval'`: the desktop engine is native. Trusted Types are not yet in the desktop CSP (Ledger §6); that waits until the smoke test watches for violations.
- **Capability** (`capabilities/default.json`): window `main`, `permissions: []`. The UI reaches Rust only through the commands above. No Tauri plugin is used (the Date app's clipboard plugin dropped out; Copy uses the web clipboard API).
- `#![forbid(unsafe_code)]`; release builds use `windows_subsystem = "windows"`.
- Identifier `com.portablecalculator.tool`. The bundle targets NSIS (`installMode: both`) and MSI with the embedded WebView2 bootstrapper are configured but **not built before M10**.

**Smoke test** (`--smoke-test`):
- the window stays hidden and the store is in memory, so real data is never touched;
- the renderer drives every route, the three themes plus System, the settings, state and countdowns round trips through `store_save`/`store_load`, a refused invalid save, both tools live, a history entry through `store_save_if` and `export_file`, and 100 timed `engine_call` round trips;
- it calls `report_smoke_result`. Rust checks `meta.versions` against its own version and that settings and state were saved, then prints `SMOKE_TEST_OK` and exits 0, or prints `SMOKE_TEST_FAILED` and exits 1;
- the renderer's details are stripped of control characters and capped at 2,000 characters;
- a 30 s watchdog exits 1 if the renderer never reports.

### 8. Build and check scripts (`scripts/`)

Plain Node (20+), no npm packages. Shared rules live in `scripts/lib/`: `web-hygiene`, `rust-hygiene`, `local-paths`, `static-server`, `mini-dom`, `random-requests` and the `eval-*` suites.

| Script | Role |
|---|---|
| `build-wasm.mjs` | Builds `engine.wasm` with path remapping and the leak scan; `--check-twice` proves reproducibility. Sole writer of `target/engine/engine.wasm` |
| `build-web.mjs` | Runs the static hygiene rules, then writes `dist/desktop/`, `dist/web/` (hashed `app.*.js`, `app.*.css`, `engine.*.wasm`, `sw.js`, the manifest, icons), `dist/Portable-Calculator-Tool-Mobile.html` and `dist/build-info.json`. Deterministic, LF only, single-pass templates. Budgets: engine ≤ 1,500,000 B, single file ≤ 2,000,000 B |
| `check-wasm.mjs` | Native vs WASM parity in three time zones (part 3) |
| `check-i18n.mjs` | Catalog keys, placeholders, CLDR plurals, no markup, no unused or missing keys; the formatter and plural units |
| `check-web.mjs` | Same token set in every theme, WCAG AA per declared pair; every inline block of the built pages CSP-pinned |
| `check-versions.mjs` | One app version in `tauri.conf.json`, the `src-tauri`, `pcalc-api` and `pcalc-wasm` manifests and their `Cargo.lock` entries, `build-manifest.json`, and the built footers, `build-info.json` and the `sw.js` cache name |
| `check-unsafe.mjs` | `unsafe` only on the `pcalc-wasm` exports; no panicking calls in engine or API code |
| `browser-boot.mjs` | Headless Microsoft Edge over CDP with throwaway profiles. It covers: both web builds booting under their CSPs (with positive controls); tampered, blocked and no-WASM rescue paths; the shell at 360/390/440 px and in phone landscape, with pseudo-locales; the Date, Percentage and History groups with real taps and typing (`--date-only`, `--percent-only`, `--history-only`); the service-worker upgrade online and offline; `--shots <dir>` for screenshots. 293 checks at E-12 |
| `safety-eval.mjs` | Slices B (the UI under both adapters), C (store durability) and D (static hygiene), with the real web sources and the real `engine.wasm` in a mini-DOM with a fake IndexedDB, a BroadcastChannel hub and a fixed clock. Every rule has a mutant proof. 453 checks at E-12 (B 223, C 101, D 129). Slice A is `check-wasm.mjs`; slice E (accessibility) is **planned** for M9 |
| `serve-web.mjs` | Serves `dist/web` read-only at `http://127.0.0.1:8788/Portable-Calculator-Tool/`, the Pages path |

The mandatory local order is the verification list in [AGENTS.md](../AGENTS.md). Cargo runs from PowerShell only: Git Bash's `/usr/bin/link` shadows the MSVC linker.

### 9. CI (`.github/workflows/ci.yml`)

It runs on a push to `dev`, on a pull request to `main` and by `workflow_dispatch`. It has `permissions: contents: read`, every Action pinned to a 40-hex commit SHA, and `persist-credentials: false`.

| Job | What it runs |
|---|---|
| **rust-checks** (ubuntu-latest) | `cargo fmt --check`; clippy `-D warnings`, native (without the desktop app, which needs WebKitGTK on Linux) and wasm32 (engines, `pcalc-api`, `pcalc-wasm`); `cargo test` (without the desktop app); `gen_golden --check`; percent-core golden parity; `check-unsafe`; `check-versions` |
| **web-build** (ubuntu-latest) | `build-wasm --check-twice`; `build-web` twice with a SHA-256 diff of `dist/`; release bridges; `check-wasm` (goldens and the 200k random diff); `check-versions`; `check-i18n`; `check-web`; `safety-eval`; uploads the `web-dist` artifact |
| **windows-build** (windows-latest, `needs: web-build`) | `browser-boot` on the `web-dist` artifact; `build-web --desktop-only`; clippy and tests of the desktop app; the release build; the real-window smoke test via `Start-Process -Wait -PassThru` with redirected stdout, gated on exit code 0 **and** `SMOKE_TEST_OK` |

`main` (`659311e`) has no workflows, so nothing can publish by accident. The **release** and **pages** jobs (five assets: NSIS, MSI, portable `.exe`, single-file HTML and an LF `SHA256SUMS.txt`) are **planned** for M10. Run 44779154165 on `d7a6712` was green on all three jobs; the live CI state is owned by [Current State](pbs/CURRENT_STATE.md#present-state-identity).

### 10. App and engine versions

- **App version** (now 0.1.0; 1.0.0 at M10): `src-tauri/tauri.conf.json`, the `src-tauri`, `pcalc-api` and `pcalc-wasm` `Cargo.toml` files, `web/build-manifest.json` (`appVersion`) and the footers, all enforced by `check-versions.mjs`.
- **Engine versions** are separate. Each engine's `ENGINE_VERSION` equals its crate version, and it changes only with engine behaviour, together with its golden (`gen_golden -- --write` for date-core). An app release never bumps an engine.
- **Contract versions:** `API_VERSION` 1 (`pcalc-api`), `ABI_VERSION` 1 (`pcalc-wasm`), store `schemaVersion` 1 for all four documents, export `formatVersion` 1. Before the first release (M10), the closed value lists of a stored document may grow at version 1; after it, widening one bumps the version, so an older build reads `newer` instead of `corrupt`.

### 11. Planned parts (not built)

These parts are designed in the plan and specs. Nothing below exists in code beyond the skeletons named in part 1.

| Milestone | Part | Architectural effect |
|---|---|---|
| M3b | Notes for history entries and countdowns (headline + body, up to 100,000 words or unlimited) | A separate `notes` store (an IndexedDB object store; per-note files on the desktop), outside the 4 MiB history cap |
| M3b | Auto-save history (default, one entry per editing burst), a manual Save mode, retention | `savedBy` on entries; pinned, noted and manual entries never removed automatically; write cost moved off the main thread first |
| M3b | Countdown New/Duplicate and colours; UX roadmap items (data shapes incl. `ref`, signature tokens, trace console, Show working, field errors, shortcut registry) | Amendments to schema v1 while nothing is released ([7-](specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), [6-](specs/6-%20UX_ROADMAP.md)) |
| M5a | `calc-num` arithmetic | 34-digit half-even decimal, transcendentals, a 60-digit offline oracle |
| M5b | Standard calculator | `calc.press` key machine, Windows `%` rules, memory (the pane's Memory tab) |
| M5b+ | **Mini Calculator** (plan B5a) | `WebviewWindow`s `mini-<n>` sharing one history; one process via `tauri-plugin-single-instance` (approved); `--mini`; the capability widened to `["main","mini-*"]` with `permissions: []`; the keyboard Calculator key as an HKCU AppKey value, off by default, removed at uninstall; web pop-out / Document Picture-in-Picture |
| M5c, M6 | Scientific, Programmer | `calc.eval`, `prog.press`, `prog.eval` |
| M7 | Twelve converters | `units.catalog`, `units.convert` over exact `Dec` factors |
| M8 | Graphing | `graph.compile`, `graph.sample`, `graph.trace`; Canvas 2D; graph-payload IPC timing |
| M9a, M9b | Eleven translated catalogs (owner Arabic review); theme polish | Engine English moved into the catalogs or formatted in the UI |
| M9 | Hardening, accessibility audit, docs | safety-eval slice E; the manual device checklist in the ledger |
| M10 | v1.0.0 | The release and Pages jobs, installers, `SHA256SUMS.txt`, the Pages site (enablement needs an owner's yes); a real app icon |
| M11 | Date v1.3.0, PCT v2.4.0 | "Replaced by" notice and link only, in those repos |

### 12. Toolchain & version inventory (as of 2026-11-20, `d7a6712`)

| Item | Version / value | Source |
|---|---|---|
| Rust (rustc, cargo) | 1.99.1, profile `minimal` with `rustfmt` and `clippy` | `rust-toolchain.toml`; `rustc 1.99.1 (58cf8f9c3 2026-10-13)` on the build machine |
| Rust targets | `x86_64-pc-windows-msvc`, `wasm32-unknown-unknown` | `rust-toolchain.toml` |
| Edition / resolver | 2021 / 2 | crate manifests, `Cargo.toml` |
| serde / serde_json | 1.0.229 / 1.0.154 (`float_roundtrip` declared in `pcalc-api`) | `Cargo.lock` |
| libm | =0.2.11 (graph-core only) | `crates/graph-core/Cargo.toml` |
| chrono | 0.4.45 (date-core dev-dependency only) | `Cargo.lock` |
| Tauri crates | `tauri` 2.12.5, `tauri-build` 2.7.4, `tauri-macros` 2.7.4, `tauri-runtime` 2.12.2, `tauri-runtime-wry` 2.12.3, `tauri-utils` 2.10.2, `wry` 0.57.1, `webview2-com` 0.39.1 | `Cargo.lock` (seeded from the Date repo) |
| Tauri CLI | `tauri-cli` 2.12.4 installed locally (`=2.12.4`); not used before M10 bundling | `cargo tauri --version` |
| Node | v24.14.0 locally; Node 22 in CI (`actions/setup-node`); scripts need Node 20+, no npm packages | ledger §1, `ci.yml` |
| git | 2.40 locally, `core.autocrlf false`, LF forced by `.gitattributes` | ledger §1 |
| Edge used by browser-boot | Edg/157.0.4341.60 locally (E-04 to E-12); the preinstalled Edge of `windows-latest` in CI (version not recorded) | ledger, `browser-boot.mjs` |
| WebView2 | the system Evergreen runtime (Chromium), proven through the desktop smoke test; version not recorded | ledger E-04 |
| Browser floor (planned) | Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+. **Verified only in Chromium (headless Edge) and WebView2**; WebKit and Gecko are manual checks still owed | plan B3, `README.md` |
| App version | 0.1.0 (development) | `check-versions.mjs` |
| Engine versions | date-core 1.0.0, percent-core 2.3.0, calc-num / calc-core / units-core / graph-core 0.1.0 | each `ENGINE_VERSION` |
| Contract versions | API 1, WASM ABI 1, store schema 1 (×4), export format 1 | `pcalc-api`, `pcalc-wasm` |
| `engine.wasm` size | 452,648 B (`engine.134207cac4b746fa.wasm`), budget 1,500,000 B. Earlier: 323,458 (M1), 398,350 (M2a), 397,244 (M2c), 446,127 (M3) | Ledger E-04 to E-12 |
| Single-file HTML size | 1,067,036 B, budget 2,000,000 B. Earlier: 470,365 (M1), 663,371 (M2a), 885,248 (M2c), 1,035,375 (M3) | Ledger E-04 to E-12 |
| Desktop IPC | 100× `engine_call` (72 B) total 26.8 ms, median 0.3 ms (release, E-04); graph-payload timing waits for M8 | Ledger E-04 |
| Pinned Actions | `actions/checkout` v4, `dtolnay/rust-toolchain` (toolchain 1.99.1), `Swatinem/rust-cache` v2, `actions/setup-node` v4.4.0, `actions/upload-artifact` v4, `actions/download-artifact` v4, each by full commit SHA | `ci.yml` |

---

## Internal Structure

```text
Cargo.toml              workspace manifest (10 packages) and [profile.wasm]
rust-toolchain.toml     pinned Rust 1.99.1 + wasm32-unknown-unknown
.gitattributes          LF on every text file (CSP hashes, the WASM hash and fixtures are byte-exact)
crates/                 pure engines, the one API, the WASM ABI, native storage
src-tauri/              Tauri 2 desktop app: engine_call, store and export commands, smoke test
web/                    shared front end: boot, core, platform adapters, shell, tools, history, styles, i18n
scripts/                build, parity, i18n, theme/CSP, version, unsafe, browser and safety checks
dist/                   build output (not committed)
.github/workflows/      ci.yml (dev; release and pages jobs arrive in M10)
Documentation/          context, architecture, roadmap, specs/, pbs/, handoff/
```
