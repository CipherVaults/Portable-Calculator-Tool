# Roadmap — Portable Calculator Tool

Milestones of the owner-approved [Portable Calculator Plan](specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B, section B17 (approved 2026-11-17; PBS v1.1: plan approval = Goal approval). Each milestone ends with a ledger entry. Owner clarifications at approval: no legacy history migration (start fresh), standing authority for fixes and hardening that matter, phone-first web app.

## v1.0.0 milestones

| M | Scope | Done when | Owner gate | Status |
|---|---|---|---|---|
| M0 | Repo, workflow-free `main`, `dev`, workspace, toolchain, CI skeleton, D-slice | CI green on `dev`; `main` has no workflows | **create the GitHub repo; push `main`; Pages enablement**; identifier, `libm`, serde_json rule, browser floor (approved with the plan) | done 2026-11-18: repo created and `main`/`dev` pushed on the owner's yes; CI run 44254904073 green on `482e52d`; `main` (`659311e`) has no workflows (Ledger E-01, E-02). Review fixes and the D-slice (`safety-eval.mjs` slice D, mutant proofs) in E-03, verified locally, CI pending push. Pages enablement waits for the owner's yes |
| M1 | `pcalc-api` (per-op caps), `pcalc-wasm`, `check-wasm`, single-file builder, CSP spike in four engines, IPC graph-payload measurement | goldens byte-equal native/WASM under 3 time zones; sizes and IPC timing recorded | — | **done 2026-11-18 locally** (Ledger E-04; CI pending push). Goldens byte-equal native/WASM under UTC, New York and Cairo (digest `d308c126…`), plus 200,000 seeded random requests (seed 20261118), 0 mismatches; every current op's 64 KiB cap at cap/cap+1 identical native/WASM. Sizes: engine.wasm 323,458 B (budget 1.5 MB), single file 470,365 B (budget 2 MB). CSP spike: both web builds boot in headless Edge with 0 violations and the engine hash verified (`browser-boot.mjs`, 41 checks incl. tampered, blocked and no-WASM with the rescue view); WebView2 via the desktop smoke. Boot median 41-46 ms served, 37 ms single file. IPC: 100 `engine_call` round trips 26.8 ms total (release). Not covered: WebKit/Gecko (manual on the owner's devices), graph-payload IPC (M8) |
| M2a | i18n and theme infrastructure (catalogs, formatter, plural table, logical CSS, tokens, pre-paint theme script, language and theme pickers) · shell, adapters, navigation, `pcalc-store` wiring, IndexedDB store, hashed service worker and upgrade test, rescue view | browser-boot incl. upgrade and no-WASM; desktop smoke | — | — |
| M2b | Date port | Date safety-eval B/C under both adapters | — | — |
| M2c | Percent port (incl. percent-core's two `.expect()` made total; new markup/tax/tip goldens) | PCT criteria under both adapters | — | known item: the discount/markup/tax/tip `label` carries `<br>` through the API (percent-core's output, kept byte-identical); the UI renders text only, so M2c uses the `*Text` fields or a split label |
| M3 | History (expression-based schema), settings, state, countdowns, export/import | corruption, read-error, quota, newer-schema and cap-edge tests; export round trip | export method | — |
| ~~M4~~ | ~~Legacy importers, consent-first card~~ | — | — | **dropped by the owner at plan approval** ("no legacy history migration") |
| M5a | `calc-num` + oracle | oracle suite, no-panic fuzz | — | skeleton only (parse, canonical text) |
| M5b | Standard key machine, memory, `%` semantics | key goldens; record → eval round trip | — | — |
| M5b+ | Mini Calculator (multi-window, single instance, shared history, Keep on top, web pop-out/PiP, keyboard Calculator key) | smoke with two Mini windows sharing history; AppKey toggle tests; key press opens Mini (manual) | `tauri-plugin-single-instance` (covered by plan approval) | — |
| M5c | Scientific | oracle + key goldens | — | tokenizer only |
| M6 | Programmer | BigInt oracle, hand vectors; bit keypad accessible | — | word sizes only |
| M7 | Converters (12) | NIST vectors and round trips | — | category list + Length table only |
| M8 | Graphing | analytic suite; budgets met or fallback documented; trace and table accessible | cut line if it slips (current answer: ship all) | viewport validator + bytecode set only |
| M9a | Languages: 11 translated catalogs, independent translation check, Arabic RTL polish | `check-i18n` clean; pseudo-locales and 390 px screenshots for ar/de/ja | owner Arabic review | — |
| M9b | Themes: Daylight and Retro, `System` option | AA contrast for every theme; no wrong-theme flash; screenshots in all 3 themes | — | — |
| M9 | Hardening, accessibility audit, docs, release notes | full checks; manual device checklist in the ledger | — | — |
| M10 | v1.0.0 via PR `dev` → `main` (release job added here) | 5 assets; `sha256sum -c` passes; Pages live | **merge → release** | — |
| M11 | Date v1.2.0, PCT v2.4.0 ("replaced by" notice and link only; no export-for-migration) | notice verified | **each merge and release** | — |

No time estimates are given (plan B17); the owner may ask for them after M1.

## Backlog (proposed, not authorized)

- `trim-paths` in `[profile.wasm]` once Cargo stabilises it (today `scripts/build-wasm.mjs` remaps paths through RUSTFLAGS).
- A real app icon (M0 reuses the Date Calculator icon set as a placeholder).
