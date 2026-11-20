# 🧪 Testing & Verification — Portable Calculator Tool

**Record type:** verification-system reference (PBS v1.1). It says what each check proves and where its numbers come from. Dated results and commands live in the [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) (E-01 to E-12); when this record and the ledger differ, the ledger wins. A pass here is a technical result, not owner acceptance ([Acceptance Record](ACCEPTANCE_RECORD.md)).

**As of:** 2026-11-20 · `dev` at `d7a6712` (M0–M3 and the M3 review fixes; `d7a6712` changes records only, so its code equals `b7d50b1`).

## 📍 Current verification state

| Scope | State |
|---|---|
| Local, full [AGENTS.md](../../AGENTS.md) list on `d7a6712` (at Ledger E-12) | **Green.** 234 cargo tests; `check-wasm` 0 mismatches in 3 time zones; browser-boot 293 passed; safety-eval 453 passed (B 223, C 101, D 129); smoke `SMOKE_TEST_OK` (Ledger E-12) |
| GitHub CI on `d7a6712` | **Green.** Run 44779154165: rust-checks, web-build and windows-build all succeeded (observed with `gh run view`). The live CI state is owned by [Current State](CURRENT_STATE.md#present-state-identity) |
| Engines and browsers covered | Rust native (Windows MSVC; Linux in CI), WASM in Node, **Chromium only** (headless Edge 157 over CDP) and WebView2 through the desktop smoke |
| Not covered by any automated check | Safari/WebKit, Firefox/Gecko, real phones, screen readers, the desktop export into the real Downloads folder, a real two-process desktop race ([owner checks](ACCEPTANCE_RECORD.md#-owner-checks-outstanding)) |

## 🔁 The verification list

Run in this order from PowerShell (Cargo never from Git Bash). Every step must exit 0. Latest results are from Ledger E-12.

| # | Command | What it proves | Latest result (E-12) |
|---|---|---|---|
| 1 | `node scripts/build-web.mjs --desktop-only` | `dist/desktop` exists, so `src-tauri` can embed it at compile time | exit 0 |
| 2 | `cargo fmt --all -- --check` | Formatting is canonical | clean |
| 3 | `cargo clippy --workspace --all-targets --locked -- -D warnings` | No lint warning in any native crate or test | clean |
| 4 | `cargo clippy -p pcalc-api -p pcalc-wasm -p date-core -p percent-core -p calc-num -p calc-core -p units-core -p graph-core --target wasm32-unknown-unknown --locked -- -D warnings` | The engines and API also lint clean for the WASM target | clean |
| 5 | `cargo test --workspace --locked` | Engine goldens (date-core, percent-core), the chrono oracle, API caps at cap/cap+1, store validators, DocStore durability (corrupt, newer, unreadable, too large, backups, clock set back, compare-and-save, `docs.lock`), history operations, import and export | 234 passed |
| 6 | `cargo run -p date-core --example gen_golden --locked -- --check` | `golden.json` matches the engine; no unintended date behaviour change | up to date |
| 7 | `node scripts/build-wasm.mjs --check-twice` | The only writer of `target/engine/engine.wasm`: local paths remapped and leak-scanned; an independent build in an emptied target dir is byte-identical | identical, `engine.134207cac4b746fa.wasm` 452,648 B |
| 8 | `node scripts/build-web.mjs` (twice, every `dist/` file hashed and compared) | Deterministic web build; size budgets; CSP hashes written; refuses a leaky engine, colour literals, physical sides, catalog markup | 14 files identical; single file 1,067,036 B |
| 9 | `node scripts/check-wasm.mjs` | Native and WASM answer byte for byte: every golden plus 200,000 seeded random requests (seed 20261118) over all ops, under UTC, America/New_York, Africa/Cairo | 0 mismatches over 25 ops in 3 zones (random digest `dafe8a58…`) |
| 10 | `node scripts/check-i18n.mjs` | Catalog keys, placeholders, CLDR plurals, no markup, no unused key, no call to a missing key; formatter and plural units | 627 keys, 168/168 units |
| 11 | `node scripts/check-web.mjs` | Every theme defines the same tokens and passes WCAG AA; every inline block of the built pages is CSP-pinned | 3 themes × 34 pairs AA, 3 pages pinned |
| 12 | `node scripts/browser-boot.mjs` | Both web builds boot in headless Edge under their real CSPs, plus the groups below | 293 passed, 0 failed |
| 13 | `node scripts/check-versions.mjs` | The app version is the same everywhere, incl. the service-worker cache name and the built pages | 13/13 at E-05; exit 0 at E-12 |
| 14 | `node scripts/check-unsafe.mjs` | `unsafe` only where allowed; no panicking calls in engine or `pcalc-api` code | OK |
| 15 | `node scripts/safety-eval.mjs` | Slices B (shell and tools in a mini-DOM under both adapters), C (stores, history, countdowns, rescue) and D (static hygiene and the built `dist/`), each rule with a mutant proof | 453 passed (B 223, C 101, D 129), run twice |
| 16 | `cargo run -p portable-calculator-tool --locked -- --smoke-test` | The real Tauri window in WebView2: every route, themes, store round trips through `store_save`/`store_save_if`/`store_load`, a history entry exported through `export_file` (temp folder), timed IPC | `SMOKE_TEST_OK` |

**Safety-eval slices.** Slice A (parity) is `check-wasm.mjs`. Slice E (accessibility) arrives with M9 (plan B15).

## 📈 Coverage numbers by milestone

From the ledger. "—" means the ledger row does not state the number.

| Ledger | Milestone | cargo tests | check-wasm | safety-eval (B / C / D) | browser-boot | i18n keys | AA pairs |
|---|---|---|---|---|---|---|---|
| E-01 | M0 | 183 | 24,650 cases per zone | — | — (browser pane only) | — | — |
| E-02 | M0 re-run | 183 | 26,170 per zone | — | — | — | — |
| E-03 | M0 review fixes, D-slice | 184 | 26,173 per zone | 77 (D) | — | — | — |
| E-04 | M1 | 186 | + 200,000 random over 18 ops | 78 (D) | 41 | — | — |
| E-05 | M2a | 206 | 200,000 random over 22 ops | 172 (29 / 24 / 119) | 117 | 132 | 3 × 24 |
| E-06 | M1/M2a review fixes | 209 | 0 mismatches | 187 (37 / 30 / 120) | 145 | 132 | 3 × 25 |
| E-07 | Phone bottom bar | 209 | 0 mismatches | 201 (51 / 30 / 120) | 161 | 136 | 3 × 25 |
| E-08 | M2b Date | — | 0 mismatches | 263 (96 / 47 / 120) | 204 | 378 | 3 × 33 |
| E-09 | M2c Percentage | — | 0 mismatches | 314 (135 / 51 / 128) | 245 | 525 | 3 × 33 |
| E-10 | M2 review fixes | 210 | 0 mismatches | 364 (169 / 66 / 129) | 263 | 526 | 3 × 34 |
| E-11 | M3 history | 228 | 200,000 random over 25 ops | 422 (203 / 90 / 129) | 283 | — | — |
| E-12 | M3 review fixes | 234 | 0 mismatches, 25 ops | 453 (223 / 101 / 129) | 293 | 627 | 3 × 34 |

## 🧬 Mutant proofs and negative controls

A rule without a planted bug that it catches is incomplete ([AI working context](../handoff/AI_WORKING_CONTEXT.md) §3). A mutant must fail on its assertion, not by a throw (E-07).

- **safety-eval mutants.** The local report of the E-12 run (`target/verify/safety-eval.json`, git-ignored) lists 311 mutant checks among the 453: B 152, C 58, D 101. Every one was caught.
- **Milestone additions (ledger):** E-03 a mutant for every static rule, incl. code after a `"a//"` string; E-05 all 16 B/C mutants; E-06 9 new plus a Retro focus-ring contrast mutant; E-07 10 new; E-09 29 Percentage mutants; E-10 a mutant per new criterion and catalog mutants for the v1.2.0 wording; E-11 42 history mutants; E-12 66 history mutants in all.
- **End-to-end refusals (slice D):** `build-web` refuses an engine with a local path, a colour literal, a physical side, catalog markup and a sink after a string with slashes; `check-unsafe` refuses a missing `forbid`, an `unsafe` block after a URL string and an engine `expect`; `check-wasm` refuses a leaky engine and its random diff catches the old loader logic.
- **Rust mutant:** restoring the old backup pruning makes the rollback test fail (E-06).
- **browser-boot negative controls:** an injected inline script, a `data:` import and `DOMParser` must be blocked and seen (E-04, E-06); run against the old service worker and CSS, 20 checks failed (E-06); without the page's 5rem bottom reserve, 33 cases failed (E-07); with the pre-E-10 behaviours restored, exactly the new checks failed with the review's numbers (E-10).
- **Removed code end-to-end:** percent-core's old `expect()` code restored is refused (E-09).

## 🌐 Browser-boot groups

Headless Edge over CDP, throwaway profiles, 390 × 844 unless stated. Counts from the local report of the E-12 run (`target/verify/browser-boot.json`, git-ignored; 293 passed, 0 failed, Edg/157.0.4341.60).

| Group | Checks | What it proves |
|---|---|---|
| `served` | 12 | The multi-file Pages build boots under its CSP: `data-boot="ok"`, 0 violations, 0 console errors, engine hash verified, positive controls blocked |
| `single` | 11 | The same for the file:// single file |
| `tampered` | 5 | A changed engine fails the integrity check and shows the rescue view |
| `blocked` | 5 | A missing engine (404) gives `load-failed` and the rescue view |
| `no-wasm` | 16 | With the `WebAssembly` global removed by CDP: `unsupported`, the engine is never fetched, raw stored text listed byte for byte, storage unchanged |
| `shell` | 17 | Drawer, bottom sheet, focus trap and return, bottom bar, shortcuts, rotation keeping a modal |
| `theme` / `store` / `sync` | 3 / 1 / 1 | Theme switch and pre-paint without a flash; the theme stored in IndexedDB; a second tab following |
| `layout` | 82 | 360/390/440 px, landscape 740 × 360 and 844 × 390, 900 and 1280 px, three themes, en-XA and ar-XB: no horizontal scroll, nothing outside the viewport, no clipped or wrapped values, 44 px targets |
| `date` | 50 | Real taps on calendars, the Move menu, a mouse drag, reload restore, the Countdowns pane, two tabs keeping both countdowns, LTR runs in ar-XB, contrast as rendered (`--date-only`) |
| `percent` | 49 | Real typing and taps, text-only results, presets, swap, layout restore, Reset, spoken once, Arabic-Indic digits typed (`--percent-only`) |
| `history` | 30 | 2,200 entries timed under 4× CPU, layouts, real JSON/CSV downloads, clipboard export, import preview, Restore, a second tab, the ± key, Undo after a deep delete (`--history-only`) |
| `upgrade` | 11 | Service worker N → N+1 online and offline with no mixed assets; a stale `index.html` fails the install; data survives byte for byte |

## 🤖 CI jobs

`.github/workflows/ci.yml` runs on pushes to `dev`, on pull requests to `main` and on `workflow_dispatch`. Every Action is pinned to a 40-char SHA with `persist-credentials: false`; the token is `contents: read`. There is no release job and no Pages deploy before M10.

| Job | Runner | Steps |
|---|---|---|
| `rust-checks` | ubuntu-latest | fmt; clippy native (desktop crate excluded: it needs WebKitGTK) and wasm32; tests (desktop excluded); `gen_golden --check`; percent-core `golden_parity`; `check-unsafe`; `check-versions` |
| `web-build` | ubuntu-latest | `build-wasm --check-twice`; `build-web` twice with a SHA-256 diff of `dist/`; release bridges; `check-wasm` (goldens + 200k random, 3 zones); `check-versions`; `check-i18n`; `check-web`; `safety-eval`; uploads `web-dist` |
| `windows-build` | windows-latest, `needs: web-build` | browser-boot on the downloaded `web-dist` artifact (the Linux-built engine); `build-web --desktop-only`; clippy and tests of the desktop crate; release build; the real Tauri window smoke via `Start-Process -Wait -PassThru`, gated on exit code 0 and `SMOKE_TEST_OK` |

The published engine is the one CI builds on Linux; `engine.wasm` is reproducible per OS, not across Windows and Linux (Ledger §3).

## ⏱️ Performance budgets

### Measured (from the ledger)

| Measure | Value | Ledger | Conditions |
|---|---|---|---|
| `engine.wasm` size | 323,458 B (M1) → 398,350 B (M2a) → 397,244 B (M2c) → 446,127 B (M3) → **452,648 B** (E-12) | E-04, E-05, E-09, E-11, E-12 | via `build-wasm.mjs`; gzip 111,568 / brotli 92,936 at E-04, gzip 130,089 / brotli 106,371 at E-05 |
| Single file size | 470,365 B (M1) → 663,371 B (M2a) → 885,248 B (M2c) → 1,035,375 B (M3) → **1,067,036 B** (E-12) | E-04 to E-12 | |
| Web boot (navigation start to verdict) | served median 41–46 ms (first 399–803 ms), single median 37 ms (E-04); served median 55 ms (first 192), single 49 ms (first 89) (E-05) | E-04, E-05 | headless Edge, not throttled |
| Desktop IPC | release: 100 × `engine_call(date.days_between)` 72 B total 26.8 ms, median 0.3, p95 0.4, max 0.6 ms; 20 × at the 64 KiB cap median 1.3, p95 5.2 ms; boot 55 ms (E-04). Release 100 × 72 B total 32.5 ms, median 0.3 ms; 64 KiB median 1.1 ms (E-05) | E-04, E-05 | WebView2 `--smoke-test` |
| Random diff wall time | native 13.0 s and WASM 13.1 s per zone; 34.1 s wall for three zones (E-04); 36.3 s (E-05) | E-04, E-05 | |
| History with 2,200 entries (2,000 + 200 pinned), 4× CPU throttling | E-11: render 49 ms, search keystroke 65 ms, Show more 48 ms, boot 543 ms. **E-12: render 45 ms, search 105 ms, Show more 38 ms, a change with all 2,200 rows loaded 431 ms (2,020 ms before the fix), a recorded entry 412 ms**; panel 24,494 nodes with every row loaded | E-11, E-12 | headless Edge 157, 390 px |

### Enforced by a check today

| Budget | Value | Enforced by |
|---|---|---|
| `engine.wasm` | ≤ 1,500,000 B (plan B3) | `scripts/build-web.mjs` `WASM_BUDGET` |
| Single file | ≤ 2,000,000 B (plan B3) | `scripts/build-web.mjs` `SINGLE_BUDGET` |
| History at 2,200 entries, 4× CPU | render 250 ms, search 250 ms, Show more 150 ms, one change with all rows 700 ms, one recorded entry 700 ms | `scripts/browser-boot.mjs` `HISTORY_BUDGET_MS` |

### Planned (not yet enforced)

| Budget | Source | Gap today |
|---|---|---|
| History pane opens in ≤ 100 ms with 2,200 entries at 4× CPU, median of 5 runs, in each theme | [spec 6](../specs/6-%20UX_ROADMAP.md) item 2 acceptance | browser-boot times a single render in one theme against 250 ms |
| Input to result p95 ≤ 50 ms; history search ≤ 30 ms | spec 6 item 9 (M9) | Search measured 105 ms at E-12 against an enforced 250 ms; no input-to-result measurement yet |
| Graph resample ≤ 16 ms in WASM and ≤ 50 ms over desktop IPC for 4 functions × 1200 px | plan B7 (M1 IPC, M8) | Deferred to M8: no `graph.*` ops yet |
| Recording cost off the main thread (batch after an idle delay, or a Worker) before auto-save; keep the `record` budget | [spec 7](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md) "What the M3 review leaves for M3b" item 5 | About 0.4 to 0.5 s per recorded entry at 4× CPU with 2,200 entries |

## 👤 Manual and owner checks

Nothing outside Chromium and WebView2 has been driven. The checklist, with what each check is for, is in the [Acceptance Record](ACCEPTANCE_RECORD.md#-owner-checks-outstanding). Ledger E-09 to E-12 also list as not covered: a real clipboard in Edge (Copy is proven in the mini-DOM; the clipboard export is read back in browser-boot since E-11), safe-area insets (no notch emulation headless) and a light-mode desktop launch by eye.

## ⚠️ Known limits of the checks

- The mini-DOM (`scripts/lib/mini-dom.mjs`) ignores `inert` and models no layout; layout, tap targets and real focus belong to browser-boot.
- Headless Chromium keeps a minimum window width of about 500 px; phone widths use device emulation.
- Two timing-dependent safety-eval tests failed in the M3 review's first run; since E-12 every step is awaited and a timeout fails the test ([FI-15](FAILURE_INTELLIGENCE.md#fi-15--calculate-could-record-the-values-typed-after-the-click)).
- A test double must model the real behaviour it stands in for: the fake IndexedDB serialises readwrite transactions since E-11 ([FI-10](FAILURE_INTELLIGENCE.md#fi-10--the-fake-indexeddb-made-two-writer-tests-meaningless)).
