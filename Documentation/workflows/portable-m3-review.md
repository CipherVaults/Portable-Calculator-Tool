# Brief: portable-m3-review

**Kind:** review of committed work, then fixes. **Used:** 2026-11-20, on M3 as committed in `a0a8152`, `2d73568` and `9f87931` (diff `d9afdcf..HEAD`). **Result:** Ledger E-12 (23 findings: 9 major, 14 minor), fixes in `43f4f01` and `b7d50b1`, records in `d7a6712`.

This script was written after the local handoff kit was prepared, so the kit's `workflow-scripts/` does not hold a copy as of 2026-11-20.

## Purpose

Give M3 the independent reviews its own workflow could not finish across the handoff, and fix what they find. Flag anything in M3 that would make M3b ([spec 7](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md)) hard, without implementing M3b.

## Phases

| Phase | Agents | Role |
|---|---|---|
| Review | 2 in parallel | Lens A (durability and spec) and lens B (phone, accessibility, security); no edits |
| Fix | 1 | Verify each finding, fix, add tests and mutants, re-run the full list, commit, add E-12 |

## Context (substance)

Read AGENTS.md (the verification list is mandatory), HANDOFF.md and CONTINUATION_STATE. M3 is committed locally and not pushed. Owner priorities: no legacy migration; fixes and security without waiting; phone-first; history first. The usual rules and gates apply (no push, no `main`, no releases, no settings).

## Review lenses

- **A: data durability first, then B10/B11 and correctness.** Try to lose or corrupt history through:
  - concurrent writers (two tabs or windows, compare-and-save conflicts);
  - quota errors and a crash mid-write;
  - corrupt, oversize or newer files;
  - hostile imports (CSV/JSON injection, 8 MiB+1, duplicate ids, wrong types);
  - eviction touching pinned entries, undo races, clear-all with keep-pinned;
  - export naming and overwrites.

  Re-run the full AGENTS.md list and report the results in `checks`.
- **B: phone UX, accessibility, security and i18n/RTL.** Build and serve the web app and inspect it in headless Edge at 360/390/440 px, in landscape and on the desktop. Check:
  - thumb reach in the bottom sheet and 44 px targets;
  - search, filter and undo by keyboard, with screen-reader semantics (live regions not chatty; focus after delete, undo and restore);
  - contrast in 3 themes, ar-XB with mixed digits, en-XA overflow;
  - smooth scrolling with 2,000+ entries;
  - no HTML sinks and no data leaving the device;
  - export names, the clipboard fallback and the ± key.

  Stop the servers afterwards.

## Fix demands

The fix step ran with a resume note after a session restart: an earlier fix run had left uncommitted partial fixes in about 20 files. "Inspect git diff first; keep sound changes, finish or redo incomplete ones, and do not discard work blindly."

Then:
- verify each finding first and skip wrong ones with a reason;
- add tests and mutant proofs where it matters;
- re-run the full list;
- commit on `dev` in coherent steps;
- add ledger E-12 with an outcome for every finding.

The reviewers' `checks` summaries are passed to the fix agent with the findings.

## Outcome notes

- Data-loss paths found and closed: "keep pinned" and Undo decided from a window's own copy (now decided by the engine at write time); "Start fresh" over a history that reads again (now refused as `recovered`); a refused operation blocking the others; no lock across desktop processes (now `docs.lock`).
- The first safety-eval run in the review failed on two timing-dependent tests. The fix made the two-window test await every step and fail on any timeout, and the list was run twice.
- What M3b must change is in spec 7, "What the M3 review leaves for M3b".

## Reuse

Use whenever a build workflow's review phase did not complete, or for any milestone that crossed a session or account change: point both reviewers at an exact diff range, keep the lenses of the build workflow, and pass the reviewers' check summaries on to the fix step.
