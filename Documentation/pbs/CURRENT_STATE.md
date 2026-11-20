# Current State — Portable Calculator Tool

## Present-state identity

- Record type: accepted present and active authority pointer (PBS v1.1).
- Canonical project home: local repository `D:\Claude Projects\Portable Calculator Tool` (branches `main` and `dev`), remote `origin` = public GitHub repository [CipherVaults/Portable-Calculator-Tool](https://github.com/CipherVaults/Portable-Calculator-Tool), created by the coordinating session on the owner's yes on 2026-11-18 (recorded in the Date repo's CONTINUATION_STATE, commit `2b24700`). Observed 2026-11-18: `origin/main` = `659311e` (workflow-free), `origin/dev` = `482e52d`; later local `dev` commits are pushed by the coordinator. Repository entry: [AGENTS.md](../../AGENTS.md).
- Chosen granularity: combined small-project checkpoint. [Continuation](CONTINUATION_STATE.md) owns unfinished milestone work; the [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) owns execution evidence.
- State owner: coordinating maintainer (Claude Code, Opus 5.5) until the handoff is received. From receipt, **the executor on Ahmed Emara's account** (CipherVaults partner) owns integration and these records ([HANDOFF.md](../../HANDOFF.md) §3a). The project owners are the CipherVaults partners **Mohamed Sayed and Ahmed Emara**. Both have full authority, so an explicit yes from either partner satisfies any gate (confirmed by Ahmed on 2026-11-19). The sessions so far were driven by Ahmed Emara using Mohamed Sayed's Claude account; the handoff moves the work to Ahmed's own account.
- **Handoff (2026-11-19): prepared, not yet received.** [HANDOFF.md](../../HANDOFF.md) is an entry layer *on top of* these PBS records. Where they differ, these records win.
- As of: **2026-11-20**: the M3 review fixes done locally (Ledger E-12: `43f4f01`, `b7d50b1`), not pushed. 2026-11-19: M3 (history, export/import, the ± key) done locally (Ledger E-11: `a0a8152`, `2d73568`), not pushed. M2b and M2c done locally (Ledger E-08, E-09) and their review fixes (E-10), pushed; CI green on `e97b1a6` (run 44501883562). Earlier, 2026-11-18: M0 done on `dev` (Ledger E-01, E-02; CI run 44254904073 green on `482e52d`), plus the M0 review fixes and the D-slice (E-03), M1 (E-04), M2a (E-05) and the M1/M2a review fixes (E-06), verified locally, CI pending their push. App version `0.1.0` (development). No release and no Pages site.

## Accepted present

- Released present: **none**. No release, no Pages site.
- Accepted baseline: **none yet**.
- Verified locally (not accepted): the Cargo workspace (date-core 1.0.0, percent-core 2.3.0, four engine skeletons, `pcalc-api`, `pcalc-wasm`, `pcalc-store`, the Tauri shell), the web skeleton and build scripts. See Ledger E-01 and E-02.

## Current authority

- **Active authority:** the owner's 2026-11-17 approval of the [Portable Calculator Plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md) ("Yeah, I approve of that"), which is the approved Goal for Part B, Portable Calculator Tool v1.0.0.
- Owner clarifications at approval (override the plan text):
  - no legacy history migration: ignore B12, the `legacy.*` ops, the `origin`/`originKey` fields and milestone M4;
  - fixes, improvements and security hardening that matter are done without waiting;
  - the web app is phone-first.
- Decisions approved with the plan: identifier `com.portablecalculator.tool`; `libm` for graphing; `serde_json` allowed in `pcalc-api`; desktop engine stays native; browser floor Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+; IndexedDB for web history; the workflow-free first `main` commit.
- Repository creation, the `origin` remote and pushing `main` (workflow-free) and `dev`: done on the owner's yes, 2026-11-18.
- **Extensions of the Goal (owner requests, 2026-11-19):**
  - the Mini Calculator (plan B5a);
  - themes and languages (B5b/B5c);
  - the countdown notes/colours, history notes, auto-save history and the UX roadmap, collected as milestone **M3b**: [7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md) and [6- UX_ROADMAP.md](../specs/6-%20UX_ROADMAP.md).
- **Focus (2026-11-19):** "stop working on them separately, and focus all of our efforts on the Portable Calculator tool". Date Calculator (v1.2.0) and Percentage Calculator (v2.3.0) are not changed.
- **Standing release authority (2026-11-18):** "don't wait for my approval to release, I already grant it to you if you tested it and it's good". Merging `dev` → `main`, tags and releases are allowed for work that passed every check and was verified; never for failing or untested work.
- **Still gated on an explicit owner yes:** enabling Pages, any other repository setting change, creating repositories.
- The owner decisions, with quotes, are in [DECISIONS_LOG.md](../handoff/DECISIONS_LOG.md).

## Operational orientation

- Current phase: **M0 done (E-01 to E-03); M1 done locally (E-04); M2a done locally (E-05: phone-first shell, theme and i18n infrastructure, store validators, desktop and IndexedDB stores, service worker with the upgrade test; WebKit/Gecko stay manual); M1/M2a review fixes done locally (E-06); phone bottom bar below 760 px done locally (E-07: ☰ Menu, quick switch, History in thumb reach); M2b (Date port) done locally (E-08); M2c (Percentage port, percent-core made total, engine panic rule) done locally (E-09); M2 review fixes done locally (E-10); M3 next**. Live operational source: the working tree and `git log` on `dev`.
- percent-core's `<br>` labels (discount, markup, tax, tip) are never shown: the Percentage tool builds each line from the `*Text` fields as text (E-09). Engine-produced English text in the Date and Percentage tools waits for M9a; deviations in Ledger section 7.
- Source/owner map: [SOURCE_OWNERSHIP_MAP.md](SOURCE_OWNERSHIP_MAP.md).
- Unaccepted work pointer: [CONTINUATION_STATE.md](CONTINUATION_STATE.md).
