# Current State — Portable Calculator Tool

## Present-state identity

- Record type: accepted present and active authority pointer (PBS v1.1).
- Canonical project home: local repository `D:\Claude Projects\Portable Calculator Tool` (branches `main` and `dev`), remote `origin` = public GitHub repository [CipherVaults/Portable-Calculator-Tool](https://github.com/CipherVaults/Portable-Calculator-Tool), created by the coordinating session on the owner's yes on 2026-11-18 (recorded in the Date repo's CONTINUATION_STATE, commit `2b24700`). Observed 2026-11-18: `origin/main` = `659311e` (workflow-free), `origin/dev` = `482e52d`; later local `dev` commits are pushed by the coordinator. Repository entry: [AGENTS.md](../../AGENTS.md).
- Chosen granularity: combined small-project checkpoint. [Continuation](CONTINUATION_STATE.md) owns unfinished milestone work; the [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) owns execution evidence.
- State owner: coordinating maintainer (Claude Code, Opus 5.5); the project owner (Ahmed) decides acceptance.
- As of: **2026-11-18**: M0 done on `dev` (Ledger E-01, E-02; CI run 44254904073 green on `482e52d`), plus the M0 review fixes and the D-slice (E-03), M1 (E-04) and M2a (E-05), verified locally, CI pending their push. App version `0.1.0` (development). No release and no Pages site.

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
- **Still gated on an explicit owner yes:** enabling Pages, merging to `main`, tags and releases.

## Operational orientation

- Current phase: **M0 done (E-01 to E-03); M1 done locally (E-04); M2a done locally (E-05: phone-first shell, theme and i18n infrastructure, store validators, desktop and IndexedDB stores, service worker with the upgrade test; WebKit/Gecko stay manual); M2b (Date port) next**. Live operational source: the working tree and `git log` on `dev`.
- Source/owner map: [SOURCE_OWNERSHIP_MAP.md](SOURCE_OWNERSHIP_MAP.md).
- Unaccepted work pointer: [CONTINUATION_STATE.md](CONTINUATION_STATE.md).
