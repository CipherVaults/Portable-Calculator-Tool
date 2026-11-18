# Current State — Portable Calculator Tool

## Present-state identity

- Record type: accepted present and active authority pointer (PBS v1.1).
- Canonical project home: local repository `D:\Claude Projects\Portable Calculator Tool` (branches `main` and `dev`). **No GitHub repository and no remote yet**: creating `CipherVaults/Portable-Calculator-Tool` is an owner gate. Repository entry: [AGENTS.md](../../AGENTS.md).
- Chosen granularity: combined small-project checkpoint. [Continuation](CONTINUATION_STATE.md) owns unfinished milestone work; the [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) owns execution evidence.
- State owner: coordinating maintainer (Claude Code, Opus 5.5); the project owner (Ahmed) decides acceptance.
- As of: **2026-11-18**: M0 local work done, verified and committed on `dev` (Ledger E-01, E-02). App version `0.1.0` (development). Nothing published.

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
- **Still gated on an explicit owner yes:** creating the GitHub repository, adding a remote and pushing, enabling Pages, merging to `main`, tags and releases.

## Operational orientation

- Current phase: **M0 done locally; M1 next** (WebKit/Gecko/WebView2 CSP spike, random native-vs-WASM diff, IPC timing). Live operational source: the working tree and `git log` on `dev`.
- Source/owner map: [SOURCE_OWNERSHIP_MAP.md](SOURCE_OWNERSHIP_MAP.md).
- Unaccepted work pointer: [CONTINUATION_STATE.md](CONTINUATION_STATE.md).
