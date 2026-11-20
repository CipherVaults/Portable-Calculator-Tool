# Current State — Portable Calculator Tool

## Present-state identity

- Record type: accepted present and active authority pointer (PBS v1.1).
- Canonical project home: local repository `D:\Claude Projects\Portable Calculator Tool` (branches `main` and `dev`) with remote `origin` = the public GitHub repository [CipherVaults/Portable-Calculator-Tool](https://github.com/CipherVaults/Portable-Calculator-Tool). It was created by the coordinating session on the owner's yes on 2026-11-18 (recorded in the Date repo's CONTINUATION_STATE, commit `2b24700`). Observed 2026-11-20 (`git ls-remote origin`): `origin/main` = `659311e` (workflow-free), `origin/dev` = `d7a6712`, equal to local `HEAD`. Repository entry: [AGENTS.md](../../AGENTS.md).
- Chosen granularity: combined small-project checkpoint. [Continuation](CONTINUATION_STATE.md) owns unfinished milestone work, and the [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) owns execution evidence.
- **State owner: the executor on Ahmed Emara's account** (Claude Code, Opus 5.5), the integration owner since the handoff was received. It owns commits, pushes, these records and the release gate under the owners' authority. The previous coordinator (Claude on Mohamed Sayed's account) no longer coordinates this repository. The project owners are the CipherVaults partners **Mohamed Sayed and Ahmed Emara**. Both have full authority, so an explicit yes from either partner satisfies any gate (confirmed by Ahmed on 2026-11-19). Sessions until 2026-11-19 were driven by Ahmed Emara using Mohamed Sayed's Claude account; from 2026-11-20 the work continues on Ahmed's own account.
- **Handoff: prepared 2026-11-19, received 2026-11-20.** The executor on Ahmed's account read [HANDOFF.md](../../HANDOFF.md), AGENTS.md and these records and confirmed the repository state: `dev` at `9f87931` with M3 committed locally, and `origin/dev` at `d9afdcf`. HANDOFF.md is an entry layer *on top of* these PBS records; where they differ, these records win.
- As of: **2026-11-20, 19:15 (UTC+2)**.
  - M0–M3 and the M3 review fixes are done, verified locally and pushed (`d7a6712`).
  - CI run 44779154165 on `d7a6712` completed with all three jobs green, observed with `gh run view`.
  - Evidence: Ledger E-01 to E-12. The PBS records set of E-13 is written 2026-11-20; to be committed and pushed by the integration owner after review.
  - App version `0.1.0` (development). No release and no Pages site.

## Accepted present

- Released present: **none**. No release, no Pages site.
- Accepted baseline: **none yet**. No owner has accepted any milestone; the acceptance criteria and the outstanding owner checks are in [ACCEPTANCE_RECORD.md](ACCEPTANCE_RECORD.md).
- Verified technically (not accepted): M0 to M3 on `d7a6712`, as listed in the [Ledger](EXECUTION_AND_CODING_LEDGER.md) E-01 to E-12. Browser evidence is Chromium (headless Edge) and WebView2 only. A pass in a check is a technical result, not acceptance.

## Current authority

- **Active authority:** the owner's 2026-11-17 approval of the [Portable Calculator Plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md) ("Yeah, I approve of that"), which is the approved Goal for Part B, Portable Calculator Tool v1.0.0.
- Owner clarifications at approval (override the plan text):
  - no legacy history migration: ignore B12, the `legacy.*` ops, the `origin`/`originKey` fields and milestone M4;
  - fixes, improvements and security hardening that matter are done without waiting;
  - the web app is phone-first.
- Decisions approved with the plan: identifier `com.portablecalculator.tool`; `libm` for graphing; `serde_json` allowed in `pcalc-api`; the desktop engine stays native; browser floor Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+; IndexedDB for web history; the workflow-free first `main` commit.
- Repository creation, the `origin` remote and pushing `main` (workflow-free) and `dev`: done on the owner's yes, 2026-11-18.
- **Extensions of the Goal (owner requests, 2026-11-19):**
  - the Mini Calculator (plan B5a);
  - themes and languages (B5b/B5c);
  - the countdown notes/colours, history notes, auto-save history and the UX roadmap, collected as milestone **M3b**: [7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md) and [6- UX_ROADMAP.md](../specs/6-%20UX_ROADMAP.md).
- **Focus (2026-11-19):** "stop working on them separately, and focus all of our efforts on the Portable Calculator tool". Date Calculator (v1.2.0) and Percentage Calculator (v2.3.0) are not changed.
- **Standing release authority (2026-11-18):** "don't wait for my approval to release, I already grant it to you if you tested it and it's good". Merging `dev` → `main`, tags and releases are allowed for work that passed every check and was verified; never for failing or untested work.
- **Keep-records rule (2026-11-20, owner request):** keep the PBS records, HANDOFF, the architecture and the session summaries up to date. The rule is in AGENTS.md, "Reporting and stopping".
- **Still gated on an explicit owner yes:** enabling Pages, any other repository setting change, creating repositories.
- The owner decisions, with quotes, are in [DECISIONS_LOG.md](../handoff/DECISIONS_LOG.md).

## Operational orientation

- Current phase: **M0 to M3 done, reviewed and pushed (E-01 to E-12). Next: M3b** per spec 7, then M5a onward per the [ROADMAP](../3-%20ROADMAP.md). Live operational source: the working tree, `git log` on `dev`, and the CI runs on GitHub.
- Project overview: [1- PROJECT_CONTEXT.md](../1-%20PROJECT_CONTEXT.md); structure: [2- ARCHITECTURE.md](../2-%20ARCHITECTURE.md); chronology: [4- SESSION_SUMMARY.md](../4-%20SESSION_SUMMARY.md).
- percent-core's `<br>` labels (discount, markup, tax, tip) are never shown: the Percentage tool builds each line from the `*Text` fields as text (E-09). Engine-produced English text in the Date and Percentage tools waits for M9a; deviations are in Ledger sections 7 and 8.
- Source/owner map: [SOURCE_OWNERSHIP_MAP.md](SOURCE_OWNERSHIP_MAP.md).
- Unaccepted work and the exact next action: [CONTINUATION_STATE.md](CONTINUATION_STATE.md).
