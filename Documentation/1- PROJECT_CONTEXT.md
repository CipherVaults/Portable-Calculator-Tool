# Project Context

## Project Name

Portable Calculator Tool (Desktop & Web)

---

## Project Purpose

The purpose of this project is to build one small, private, offline calculator app for Windows and phones that replaces CipherVaults' two earlier tools, [Date Calculator Tool](https://github.com/CipherVaults/Date-Calculator-Tool) (frozen at v1.2.0) and [Percentage Calculator Tool](https://github.com/CipherVaults/Percentage-Calculator-Tool) (left at v2.3.0), and gives the same answer on every surface.

The app should:

- work fully offline, with no accounts, telemetry or cloud
- carry over the Date and Percentage tools unchanged in behaviour, and add Standard, Scientific, Programmer and Graphing calculators and twelve unit converters, in the style of the Windows Calculator
- offer a Mini Calculator pop-up that the keyboard's Calculator key can open (owner request, plan B5a)
- keep one unified, durable history, the owner's top priority
- be **phone-first** on the web (owner clarification at plan approval), and also install on Windows (NSIS or MSI) or run as a portable `.exe`
- offer three themes (Terminal, Daylight, Retro) and twelve languages, including Arabic right-to-left
- be honest about what it cannot do or could not save, instead of guessing or dropping data silently
- be documented clearly enough to be picked up again by another person or AI executor

It is a personal utility, not a commercial product. The source is public for transparency; no open-source licence is granted ([LICENSE](../LICENSE), UNLICENSED).

---

## Final Core Idea

The app is a thin, shared web interface around one Rust engine API:

```text
User input (web/ tool cards, later keypads)
-> platform adapter: ctx.platform.engine(op, req)
   desktop: Tauri command engine_call(op, req)       -> pcalc_api::call      (native Rust)
   web:     engine.wasm raw ABI (pc_in/pc_call/pc_out) -> pcalc_api::call_bytes (the same Rust, compiled to WASM)
-> one closed op list over the pure engines (date-core, percent-core; later calc-num, calc-core, units-core, graph-core)
-> {"ok":"true","result":{...}} or {"ok":"false","error":{"code","field","message"}}
-> live result, live formula, polite announcement; history recorded on explicit actions only
```

The main design decision is to keep **all** calculation in pure Rust crates behind one API (`crates/pcalc-api`), run it natively on the desktop and as WebAssembly on the web, and prove the two byte-identical (`scripts/check-wasm.mjs`). This replaces the Date app's approach of a hand-kept JavaScript mirror of the engine.

The second decision is that every stored document (settings, state, history, countdowns) is judged by the engine's own validators, and that both stores (desktop files and web IndexedDB) give the same outcomes: read-only on any doubt, a backup before anything is replaced, a newer schema never written.

The project reuses, on purpose, what the two older apps proved: date-core 1.0.0 (copied unchanged from Date Calculator Tool), percent-core 2.3.0 (copied from Percentage Calculator Tool v2.3.0 and made panic-free with byte-identical output), the hardened storage and `--smoke-test` of the Date app, its CSP discipline and its safety-eval harness with mutant proofs.

---

## Final Scope Definition

### Included in the current development build (v0.1.0 on `dev`, `d7a6712`)

Nothing is released yet. Milestones M0 to M3 of the [Roadmap](3-%20ROADMAP.md) are done and verified locally (Ledger E-01 to E-12).

- Cargo workspace of ten packages (`Cargo.toml`):
  - engines: `date-core` 1.0.0 and `percent-core` 2.3.0 (working), `calc-num`, `calc-core`, `units-core`, `graph-core` 0.1.0 (M0 skeletons only);
  - `pcalc-api` (the one API), `pcalc-wasm` (the WASM ABI), `pcalc-store` (native storage), `src-tauri` (the desktop app)
- one API with a closed list of **25 ops** (`crates/pcalc-api/src/op.rs`): `meta.versions`, nine `date.*`, eight `percent.*`, four `<name>.validate` store validators and three `history.*` ops; per-op request caps checked before parsing (64 KiB, 256 KiB, 4.5 MiB, 8 MiB)
- `engine.wasm` built reproducibly (`scripts/build-wasm.mjs`), integrity-checked by the loader, memory-capped at 64 MiB; native and WASM proven byte-identical on every golden case and 200,000 seeded random requests in three time zones
- a phone-first shell (`web/src/shell/shell.js`):
  - below 760 px a bottom bar with ☰ Menu, a quick switch back to the previous tool and History, in thumb reach;
  - a drawer (Calculator, Tools, Converter, Settings, About) and a History | Memory | Countdowns pane (bottom sheet, overlay or docked column by width);
  - 21 hash routes, the last one restored at launch, Alt+1 to Alt+6 and Ctrl+H
- the **Date tool** (M2b): the six cards of Date Calculator v1.2.0, the clickable mini calendars, Business Days range pick, Date settings (weekend, US/UK/Egypt holidays, Hijri offset and overrides, custom holidays), card collapse and reorder, and a list of up to 20 labelled countdowns
- the **Percentage tool** (M2c): the eight cards of Percentage Calculator v2.3.0 with live results, formulas, swap, tax Add/Extract, tip presets and bill split, card collapse and reorder
- **unified history** (M3, `web/src/history/`):
  - strict per-tool entries checked by the engine; caps of 2,000 unpinned and 200 pinned entries and 4 MiB;
  - every change is an operation applied by the engine to the stored document and written with a compare-and-save, so two windows or tabs never lose each other's entries;
  - a panel with search (Arabic-Indic digits included), filters, Today/Yesterday/This week/Earlier groups, Restore, Use result, Pin, a one-line note, Delete with a 10 s Undo, and Delete history (keeping pinned entries by default);
  - JSON and CSV export (desktop: a new file in Downloads; web: a download, the share sheet in an iOS home-screen app, or the clipboard) and import with a preview
- the ± key for signed fields (the iPhone decimal keypad has no minus key)
- durable stores on both surfaces with the same outcomes:
  - desktop: hardened JSON files in `%APPDATA%\com.portablecalculator.tool\`, timestamped backups (newest 3), a `docs.lock` file lock across processes;
  - web: IndexedDB database `pcalc`, object store `docs`
- three theme token sets (Terminal, Daylight, Retro, plus System) with a pre-paint script (no flash of the wrong theme), each passing WCAG AA (`check-web.mjs`)
- language infrastructure: the English catalog (`web/i18n/en.json`), CLDR plural tables for all twelve languages, the `en-XA` and `ar-XB` pseudo-locales, built-in number and date tables (never `Intl`), RTL through logical CSS properties only
- a service worker that caches only bytes whose SHA-256 matches the build, a read-only rescue view when the engine cannot start, and Trusted Types on both web builds
- three build outputs (`scripts/build-web.mjs`, deterministic): the desktop front end, the multi-file Pages site and a single-file "Mobile HTML"
- a Tauri 2 desktop app with one engine command, the store and export commands, `permissions: []` and a real-window `--smoke-test`
- checks with no npm packages: `check-wasm`, `check-i18n`, `check-web`, `check-versions`, `check-unsafe`, `browser-boot` (headless Edge) and `safety-eval` (slices B, C and D with mutant proofs)
- CI on `dev` (`.github/workflows/ci.yml`): rust-checks, web-build and windows-build; no release job before M10
- PBS v1.1 continuity records under `Documentation/pbs/` and an entry layer in [HANDOFF.md](../HANDOFF.md) and `Documentation/handoff/`

### Planned for v1.0.0 (designed, not built)

These parts exist in the plan, the specs or as skeletons only:

- **M3b**: notes (headline and body, in their own store) for history entries and countdowns; auto-save history with a manual Save mode and retention; countdown New/Duplicate and colours; the UX roadmap items ([7-](specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), [6-](specs/6-%20UX_ROADMAP.md))
- **M5a** decimal engine (`calc-num`), **M5b** Standard calculator with memory, **M5b+** the **Mini Calculator** (multi-window, single instance, shared history, Keep on top, web pop-out, the keyboard Calculator key), **M5c** Scientific, **M6** Programmer, **M7** the twelve converters, **M8** Graphing
- **M9a** eleven translated catalogs with Arabic RTL polish, **M9b** theme polish, **M9** hardening, the accessibility audit (safety-eval slice E) and docs
- **M10** v1.0.0: the release job, installers, the portable `.exe`, `SHA256SUMS.txt` and the GitHub Pages site (Pages enablement needs an owner's yes)
- **M11** the old apps' final releases (Date v1.3.0, PCT v2.4.0) with a "replaced by" notice

---

### Calculation types

| Tool | Engine ops | What it answers | Status |
|---|---|---|---|
| Date | `date.days_between`, `date.add_subtract`, `date.business_days`, `date.age`, `date.date_info`, `date.countdown`, plus `date.holidays_in_range`, `date.month_grid`, `date.validate_calendar` | Date Calculator v1.2.0's six modes, byte-identical (date-core 1.0.0) | done (M2b) |
| Percentage | `percent.change`, `percent.percent`, `percent.what`, `percent.discount`, `percent.base`, `percent.markup`, `percent.tax`, `percent.tip` | Percentage Calculator v2.3.0's eight cards (percent-core 2.3.0) | done (M2c) |
| History | `history.validate`, `history.apply`, `history.import_preview`, `history.export_csv` | the unified history document, its merge, import check and CSV | done (M3) |
| Standard, Scientific | `calc.press`, `calc.eval` (planned) | key machine on 34-digit decimals, Windows `%` rules | planned (M5a–M5c) |
| Mini Calculator | `calc.press` (planned) | Standard-only pop-up windows sharing one history | planned (M5b+) |
| Programmer | `prog.press`, `prog.eval` (planned) | QWORD to BYTE, HEX/DEC/OCT/BIN | planned (M6) |
| Converters | `units.catalog`, `units.convert` (planned) | twelve categories with exact factors (NIST SP 811) | planned (M7) |
| Graphing | `graph.compile`, `graph.sample`, `graph.trace` (planned) | `y = f(x)` on a canvas, with a table of values | planned (M8) |

Supporting ops: `meta.versions` (`{api, app, engines}`) and `settings.validate`, `state.validate`, `countdowns.validate`. Until their milestones, the planned ops answer `unknown_op`.

---

## What Is Not Included

The project intentionally does not include (plan B19 and the owner clarifications at approval):

- user accounts, cloud sync, telemetry or analytics; notifications or alarms
- network calls for calculations; the only network use is an optional, payload-free update check (its native code exists in `pcalc-store`, but no command or UI calls it yet, and `checkUpdatesOnStartup` defaults to `false`)
- **migration of the old apps' history** (owner: "no legacy history migration"; plan B12, the `legacy.*` ops and milestone M4 are dropped)
- changes to Date Calculator Tool or Percentage Calculator Tool (focus rule, 2026-11-19) other than their planned M11 sunset releases
- a currency converter; complex numbers, matrices, statistics, `rand` or gamma
- implicit, polar, parametric or inequality graphs; graph analysis, sliders or image export
- month as a time unit
- paid code signing; macOS and Linux builds
- native App Store / Play Store apps (the PWA covers phones)
- a frontend framework, bundler or npm runtime dependencies
- browsers below the floor (Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+), beyond the read-only rescue view

---

## Development Philosophy

- one engine, proven identical on every surface (native == WASM, byte for byte)
- engines are pure and total: no clock, time zone, locale or I/O, no panics; "today" and "now" are inputs
- data is never lost silently: read-only on any doubt, backups before any reset, a newer schema never written, unsaved entries kept in memory with a banner and Export
- phone first: thumb reach, 44 px targets, no horizontal scroll at 360 px
- defence in depth: strict CSPs, Trusted Types, no HTML sinks, colours only from tokens, unsafe code and I/O in two crates only
- hand-verified fixtures are never regenerated to make code pass
- every rule a check enforces is proven by a mutant that breaks it
- honest limits: Chromium-only verification is said as such; manual device checks are listed as owed
- document the real work, not an idealized version
- use Git commits (Why / Changed / Checks / Remaining) as part of the project memory

---

## Success Criteria

The project is successful at v1.0.0 if:

- every tool gives the documented answers, and the inherited Date and Percentage tools behave as Date v1.2.0 and PCT v2.3.0 did
- the native and WASM engines produce byte-identical answers for every golden case and the random diff, in any time zone
- history survives corruption, read errors, a full quota, a newer schema and two windows writing at once, on both surfaces, and is never lost silently
- every theme passes WCAG AA, and the app works at 360/390/440 px and in Arabic right-to-left
- the security rules in [AGENTS.md](../AGENTS.md) hold and are checked automatically
- CI builds and checks everything, and the M10 release ships the installers, portable `.exe`, single-file HTML and checksums, with the Pages site live
- the manual device checklist (iPhone, Android, Firefox, a screen reader) is done and recorded in the ledger
- the documentation and Git history explain what was built and why

---

## Current Final State

At **`d7a6712` on `dev` (2026-11-20)** the project is:

- in development at app version **0.1.0**; no release and no Pages site; `main` is still `659311e`, the workflow-free first commit
- in the public repository `CipherVaults/Portable-Calculator-Tool`, created on the owner's yes on 2026-11-18; `origin/dev` is `d7a6712`
- M0, M1, M2a (with the phone bottom bar), M2b, M2c and M3 done and verified locally, together with the independent reviews of M0, M1/M2a, M2 and M3 and their fixes (Ledger E-01 to E-12)
- verified locally on `d7a6712` with the full [AGENTS.md](../AGENTS.md) list (dated evidence, Ledger E-12):
  - 234 Rust tests; `gen_golden --check`; `build-wasm --check-twice` and two identical web builds;
  - `check-wasm`: 0 native/WASM mismatches in UTC, America/New_York and Africa/Cairo;
  - `browser-boot`: 293 checks passed in headless Edge 157;
  - `safety-eval`: 453 passed (B 223, C 101, D 129);
  - desktop `--smoke-test`: `SMOKE_TEST_OK`
- sizes (Ledger E-12): `engine.wasm` 452,648 B (budget 1,500,000), single file 1,067,036 B (budget 2,000,000)
- **CI:** run 44779154165 on `d7a6712` completed green on all three jobs (observed with `gh run view`). The live CI and remote state are owned by [Current State](pbs/CURRENT_STATE.md#present-state-identity) ("As of")
- owners: the CipherVaults partners **Mohamed Sayed and Ahmed Emara**, both with full authority (an explicit yes from either satisfies a gate). Sessions until 2026-11-19 were driven by Ahmed Emara on Mohamed Sayed's Claude account; from 2026-11-20 the work continues on Ahmed Emara's own account. The handoff in [HANDOFF.md](../HANDOFF.md) is **received**: the new executor read it and confirmed the repository state
- next: M3b per [spec 7](specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), then M5a onward per the [Roadmap](3-%20ROADMAP.md); ask an owner to enable Pages before M10
- still open (not verified): everything is verified in Chromium (headless Edge) and WebView2 only. Safari/iOS, Firefox, real phones and a screen reader are manual checks still owed, including the iPhone ± key focus, the Export share sheet and the reach of the Undo bar. The desktop export into the real Downloads folder and a real two-process desktop race were not run. The app icons are still the Date Calculator's placeholder set
