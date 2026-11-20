# ✅ Acceptance — ACC-1.0.0: Portable Calculator Tool v1.0.0

## 🪪 Review identity
- Record type: requirement-to-evidence decision record
- Acceptance ID: ACC-1.0.0
- Project / Goal: Portable Calculator Tool (`CipherVaults/Portable-Calculator-Tool`) / the [Portable Calculator Plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md) Part B, approved by the owner on 2026-11-17 ("Yeah, I approve of that"), with the owner clarifications at its top and the 2026-11-19 extensions recorded in [Current State](CURRENT_STATE.md#current-authority) (Mini Calculator, themes and languages, M3b per [spec 7](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md) and [spec 6](../specs/6-%20UX_ROADMAP.md))
- Review scope: the v1.0.0 release (milestones M0 to M10 of the [Roadmap](../3-%20ROADMAP.md)); this record also tracks per-milestone technical results as they arrive
- Target baseline: `dev` at `d7a6712` (M0–M3 and the M3 review fixes, verified locally; GitHub CI run 44779154165 on it green on all three jobs, observed with `gh run view`; live CI state: [Current State](CURRENT_STATE.md#present-state-identity)). No release, no Pages site; `main` is `659311e` (workflow-free)
- Integrating owner: the integrating executor (Claude Code on Ahmed Emara's account since the handoff was received on 2026-11-20)
- Technical reviewer: the integrating executor, with two independent reviewers per milestone ([AI working context](../handoff/AI_WORKING_CONTEXT.md) §3)
- Human/product decision owner: the CipherVaults partners Mohamed Sayed and Ahmed Emara (either one's explicit yes satisfies a gate)
- Reviewed / last reassessed: 2026-11-20 (UTC+2, the commit time zone)
- Record state: awaiting assessment

## 🎯 Contract being assessed
- Requirements source: plan B17 (milestones and "done when"), B3 (size budgets, browser floor), B10 (history durability), B14 (CI and release), B15 (oracles, manual checks), B16 (security and accessibility); Roadmap M3b row; spec 7 test list
- Endpoint and required acceptance layers: technical (every check of the [AGENTS.md](../../AGENTS.md) list green, CI green, the manual device checklist in the ledger, M9), human/product (owner Arabic review at M9a; the owner's own use), delivery (the M10 release with 5 assets and Pages live)
- Out-of-scope claims: plan B19 (currency, sync, telemetry, code signing, macOS/Linux builds, and the rest listed there); legacy history migration and M4 (dropped by the owner at approval); the old apps' sunset releases (M11, after v1.0.0)
- Approved exclusions or changes: M4 dropped and B12 ignored (owner clarification, 2026-11-17); export method decided under the standing improvement authority (Ledger §8: fixed Downloads path on desktop, no dialog plugin; web Blob download plus clipboard; a CipherVaults owner may override)
- Mandatory-condition rule: An unmet mandatory condition remains pending or rejected unless its authorized owner explicitly approves an exception or requirement amendment. "Accepted with limits" does not waive it.

## 🧾 Requirement decisions
### AC-01 — M0: repository, workflow-free `main`, CI on `dev`
- Requirement source: plan B17 M0; Roadmap M0
- Required condition: CI green on `dev`; `main` has no workflows
- Target and scope: `482e52d` (M0) and the current `main`
- Evidence: Ledger E-01, E-02; CI run 44254904073 green on `482e52d`; `main` `659311e` has no `.github` (CONTINUATION R0)
- Outcome: pass
- Applicability: historical for M0; `main` unchanged since
- Coverage and gaps: Pages enablement (also listed under M0 in the plan) is still an owner decision
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: none until the release review

### AC-02 — M1: native = WASM parity, sizes, IPC timing, CSP spike in four engines
- Requirement source: plan B17 M1; B3; B14
- Required condition: goldens byte-equal native/WASM under 3 time zones; sizes and IPC timing recorded; the single-file data-block CSP proved in Chromium, WebKit, Gecko and WebView2
- Target and scope: `d7a6712` for parity; M1 commits for timing
- Evidence: Ledger E-04 (200k random, sizes, IPC); E-12 (25 ops, 0 mismatches in 3 zones)
- Outcome: inconclusive (parity and timing pass; the CSP spike ran in Chromium and WebView2 only)
- Applicability: current
- Coverage and gaps: WebKit and Gecko not run (owner checks); the graph-payload IPC measurement is deferred to M8
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: owner runs the single file and the served site in Safari/iOS 16.4+ and Firefox

### AC-03 — M2a: shell, stores, service-worker upgrade, rescue view
- Requirement source: plan B17 M2a
- Required condition: browser-boot incl. upgrade and no-WASM; desktop smoke
- Target and scope: `d7a6712`
- Evidence: Ledger E-05, E-06, E-07; E-12 browser-boot 293 passed (groups `upgrade` 11, `no-wasm` 16); smoke `SMOKE_TEST_OK`
- Outcome: pass (Chromium only)
- Applicability: current
- Coverage and gaps: real phones, WebKit/Gecko, safe-area insets not observed
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: owner phone check of the shell

### AC-04 — M2b: the Date tool
- Requirement source: plan B17 M2b
- Required condition: Date safety-eval B/C under both adapters
- Target and scope: `d7a6712`
- Evidence: Ledger E-08, E-10; E-12 safety-eval 453 passed; browser-boot `date` 50 checks
- Outcome: pass (Chromium only)
- Applicability: current
- Coverage and gaps: real phones and a screen reader not run; the M2b executor's own evidence was not recovered (E-08 is a re-run)
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: owner tries `#/date` on a phone

### AC-05 — M2c: the Percentage tool
- Requirement source: plan B17 M2c; B1 (percent-core made total; new markup/tax/tip goldens)
- Required condition: PCT criteria under both adapters; percent-core goldens pass unchanged after the `expect()` removal; new markup/tax/tip goldens
- Target and scope: `d7a6712`
- Evidence: Ledger E-09, E-10; percent-core golden (10,661 cases) unchanged
- Outcome: inconclusive (PCT criteria pass; the new markup/tax/tip goldens were not added)
- Applicability: current
- Coverage and gaps: no independent oracle for the new goldens yet (Ledger §7); coverage is PCT's hand vectors, the random diff and the UI parity tests. Engine English text and Percentage digits wait for M9a
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: an independent oracle for markup/tax/tip, or an owner-approved amendment

### AC-06 — M3: history, settings, state, countdowns, export/import
- Requirement source: plan B17 M3; B10; B11
- Required condition: corruption, read-error, quota, newer-schema and cap-edge tests; export round trip
- Target and scope: `d7a6712`
- Evidence: Ledger E-11, E-12 (234 cargo tests; safety-eval C 101; 66 history mutants; browser-boot `history` 30 incl. real downloads and import preview); [Failure Intelligence](FAILURE_INTELLIGENCE.md) FI-12 to FI-15
- Outcome: pass (local, Chromium and WebView2)
- Applicability: current
- Coverage and gaps: iOS share sheet and download, the ± key on an iPhone keypad, the desktop export into the real Downloads folder, a real two-process desktop race, a screen reader
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: owner checks below

### AC-07 — M3b: notes, auto-save history, countdown upgrade, UX roadmap items
- Requirement source: Roadmap M3b; spec 7 (incl. "Clarifications after the handoff review" and "What the M3 review leaves for M3b"); spec 6
- Required condition: spec 7's test list green in all three themes and at 360/390/440 px
- Target and scope: not built
- Evidence: none
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: designed only
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: build M3b in its build order

### AC-08 — M5a to M6: decimal engine, Standard, Mini Calculator, Scientific, Programmer
- Requirement source: plan B17 M5a, M5b, M5b+, M5c, M6; B5a; B6; B15
- Required condition: M5a oracle suite and no-panic fuzz; M5b key goldens and record → eval round trip; M5b+ smoke with two Mini windows sharing history, AppKey toggle tests, the key press opening Mini on the owner's keyboard (manual); M5c oracle and key goldens; M6 BigInt oracle, hand vectors, accessible bit keypad
- Target and scope: skeletons only (`calc-num`, `calc-core`)
- Evidence: none beyond skeleton tests
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: not started
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: M5a after M3b

### AC-09 — M7 and M8: converters and graphing
- Requirement source: plan B17 M7, M8; B7; B8
- Required condition: NIST vectors and round trips for 12 converters; graphing analytic suite, budgets met or fallback documented (B7: resample ≤ 16 ms WASM, ≤ 50 ms desktop IPC), trace and table accessible
- Target and scope: skeletons only (`units-core`, `graph-core`)
- Evidence: none beyond skeleton tests
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: not started; cut line for graphing if it slips (current answer: ship all)
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: after M6

### AC-10 — M9a: languages
- Requirement source: plan B17 M9a; B5c
- Required condition: 11 translated catalogs with an independent translation check per language; `check-i18n` clean; pseudo-locale and 390 px screenshots for ar/de/ja without overflow; owner Arabic review
- Target and scope: en catalog and pseudo-locales only
- Evidence: Ledger E-12 check-i18n 627 keys (en)
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: also carries engine-produced English, Percentage digits and comma-decimal input (Roadmap M9a)
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: M9a; owner Arabic review

### AC-11 — M9b: themes
- Requirement source: plan B17 M9b; B5b
- Required condition: AA contrast for every theme; no wrong-theme flash; screenshots of every tool in all 3 themes at 390 px and desktop
- Target and scope: `d7a6712` for the current tools
- Evidence: Ledger E-12 check-web 3 × 34 pairs AA; E-05 pre-paint without a flash in Edge
- Outcome: inconclusive (current tools only)
- Applicability: partially current
- Coverage and gaps: tools not yet built; Daylight and Retro finishing is M9b
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: M9b

### AC-12 — M9: hardening, accessibility audit, manual device checklist
- Requirement source: plan B17 M9; B15 "Manual"; B16
- Required condition: full checks; the manual device checklist recorded in the ledger (iOS Safari 16.4+, Android Chrome, WebView2 on Windows 10/11); accessibility (every key labelled, result announced politely, 44 px coarse targets, graph table alternative, contrast); safety-eval slice E
- Target and scope: not started
- Evidence: partial: 44 px targets and polite announcements checked in browser-boot and safety-eval (E-07, E-10, E-12)
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: no slice E; no screen-reader run; the checklist below is not done
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: the owner checks below; M9

### AC-13 — Size budgets and browser floor
- Requirement source: plan B3
- Required condition: `engine.wasm` ≤ 1.5 MB; single file ≤ 2 MB; works on Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+, with the unsupported screen and rescue view below the floor
- Target and scope: `d7a6712`
- Evidence: Ledger E-12 engine 452,648 B, single file 1,067,036 B (enforced by `build-web.mjs`); browser-boot `no-wasm`, `tampered`, `blocked`
- Outcome: inconclusive (budgets pass; only Edge 157 and WebView2 observed)
- Applicability: current; sizes grow with each milestone
- Coverage and gaps: no browser at the floor versions was run
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: not assessed
- Next action: owner checks on Safari/iOS and Firefox

### AC-14 — M10: release
- Requirement source: plan B17 M10; B14
- Required condition: PR `dev` → `main` with the release job added; the job refuses an existing tag; 5 assets (NSIS setup, MSI, Portable exe, Mobile HTML, LF `SHA256SUMS.txt`); `sha256sum -c` passes; Pages live from the same web-build artifact
- Target and scope: not started
- Evidence: none
- Outcome: not-run
- Applicability: unavailable
- Coverage and gaps: Pages is not enabled; enabling it needs an explicit owner yes ([FI-01](FAILURE_INTELLIGENCE.md#fi-01--sha256sumstxt-written-with-crlf-failed-sha256sum--c-in-the-date-app) applies)
- Decision: pending
- Decision-maker / date / source: none recorded
- Decision rationale and limits: merging and releasing are covered by the standing release authority (2026-11-18) only for work that passed every check and was verified
- Next action: ask a CipherVaults owner to enable Pages before M10

## 🧩 Result maturity and integration
- Implemented / produced: M0–M3 and the M3 review fixes on `dev` at `d7a6712` ([Continuation](CONTINUATION_STATE.md) R0–R21)
- Verified within the tested scope: the full AGENTS.md list green locally on `d7a6712` (Ledger E-12); Chromium and WebView2 only
- Integrated in the intended context: the desktop app and both web builds run the same engine (`check-wasm` parity); no phone, Safari or Firefox context observed
- Delivered/published when required: not delivered; no release, no Pages site
- Material worker returns: per-milestone workflows (implementers, two reviewers, a fix agent); their results are recorded in Ledger E-01 to E-12
- Contradictions resolved: none open in this record
- Affected records reconciled: this record is new (2026-11-20); its milestone facts follow the Roadmap and Ledger
- Remaining blocking gaps: AC-07 to AC-14 not run; AC-02, AC-05, AC-11, AC-13 inconclusive; the owner checks below

## 👤 Human/product acceptance
- Required by the Goal: yes, at least the owner Arabic review (M9a) and the M5b+ keyboard Calculator key check on the owner's keyboard; owner use on real devices is the only route to the manual checks
- Decision: pending
- Material presented: none yet for acceptance
- Actual decision-maker / date / source: none recorded
- Decision scope: none
- Conditions or requested changes: none recorded
- Accepted baseline: **none**. Nothing has been accepted.

## ⚖️ Overall disposition
- Technical acceptance: pending
- Human/product acceptance: pending
- Required delivery state: pending (M10)
- Overall decision: pending
- Decision owner / date / source: none recorded
- Residual limitations: Chromium and WebView2 only; manual checks outstanding
- Mission consequence: continue authorized work (M3b, then M5a onward)
- Current/Continuation update: [Current State](CURRENT_STATE.md) (accepted baseline none); [Continuation](CONTINUATION_STATE.md) (next action)
- Successor authority: none implied by this decision

## 🔄 Reassessment history
### 2026-11-20 — ACC-1.0.0-R0
- Trigger: record created during the PBS v1.1 records update after M3 and its review fixes
- Affected claims: all
- Previous decision preserved at: none (first version)
- Revised applicability / decision: none; every decision pending
- New evidence or action: CI run 44779154165 on `d7a6712` green (all three jobs); the owner checks below

## 📱 Owner checks outstanding

Checks no automated run here can make. Each one needs a real device or the owner's decision. Tick a box only with a ledger entry that records the device, version and result.

- [ ] **Safari / iOS 16.4+:** open the served site and the single file; both boot under their CSPs (the WebKit half of the M1 spike), and the shell works (drawer, bottom sheet, themes).
- [ ] **Firefox (102+):** the same in Gecko.
- [ ] **Real Android and iPhone, installed and used:** add to the home screen, use offline, try `#/date`, `#/percent` and the History pane; the bottom bar is in thumb reach; the Undo bar at the bottom of the History sheet is reachable with a thumb; safe-area insets in landscape; Clear all keeps the keyboard down.
- [ ] **Screen reader (NVDA on Windows, VoiceOver on iOS, TalkBack on Android):** results spoken once (on a pause or Enter), row actions named with their row, Undo reachable without gestures. So far only the accessibility tree via CDP was checked.
- [ ] **iOS keypad and the ± key:** a negative value in a Percentage field and a Date amount; after a ± tap the field keeps focus, the keypad stays up and the caret stays by the same digit.
- [ ] **Downloads and the share sheet:** on an iPhone home-screen app, Export opens the share sheet (or the download works), Copy export works, and if both fail the export text is shown selected; Import from a file works.
- [ ] **Desktop export to the real Downloads folder:** Export from the desktop app writes a new `Portable-Calculator-<yyyymmdd-hhmmss>.json` (and `.csv`) there and shows the path; the smoke test only writes to a temp folder.
- [ ] **Two-process desktop race:** two desktop instances record at once; no entry is lost (`docs.lock`), and the stale view of the second process catches up at its next write.
- [ ] **Pages enablement at M10:** a CipherVaults owner enables GitHub Pages (Actions source) for this repository. This is a repository setting change and needs an explicit yes.
- [ ] Later milestones: the keyboard Calculator key opens the Mini Calculator on the owner's keyboard (M5b+); owner Arabic review (M9a); WebView2 on Windows 10 (plan B15).
