# Brief: portable-m2b-m2c

**Kind:** build. **Used:** 2026-11-19. **Result:** the phone bottom bar (Ledger E-07), M2b (E-08), M2c (E-09) and the M2 review fixes (E-10, 12 findings).

## Purpose

Put the phone's primary controls in thumb reach, port the Date tool (behaviour parity with Date Calculator v1.2.0) and the Percentage tool (parity with Percentage Calculator Tool v2.3.0) into the shell, then review and fix.

## Phases

| Phase | Agents | Role |
|---|---|---|
| Bottom bar | 1 | Coordinator decision under the owner's phone-first instruction |
| M2b | 1 | Date tool port |
| M2c | 1 | Percentage tool port |
| Review | 2 in parallel | Lens A (parity and spec) and lens B (phone, accessibility, security) |
| Fix | 1 | Verify, fix, re-run, commit, ledger |

**Every phase ends** with the full AGENTS.md verification list (all exit 0), a commit, and updates to the ledger, CONTINUATION_STATE and ROADMAP.

## Context (substance)

- Read AGENTS.md, CONTINUATION_STATE, the ledger and plan sections B4, B5, B5b, B5c, B9, B10, B11, A1, A2 and A8.
- The Date app's sources are read from its repository; PCT v2.3.0 from a read-only clone in a scratch folder.
- **Rules:**
  - DOM through the dom helpers (Trusted Types are enforced on the web); no `.style`; tokens only; logical CSS;
  - every UI string in `web/i18n/en.json`; engine-produced English may be shown as is for now and is recorded for M9a;
  - engine calls only through `ctx.platform.engine(op, req)`; extend `pcalc-api` only if an op is missing, keeping check-wasm green.
- **Gates:** no push, no `main`, no releases, no settings.

## Phase demands

- **Bottom bar:**
  - below 760 px: [☰ Menu] [quick switch] [History], 44 px or more, safe-area padding;
  - hidden while a text field has focus, so it never covers inputs;
  - the drawer and the sheet open from it; tablet and desktop unchanged;
  - layout cases at 360/390/440 px and in landscape; safety-eval criteria with mutants; screenshots.
- **M2b, the Date tool:**
  - the 6 cards with live results and the live-formula panels;
  - the v1.1.0 clickable calendars (Start/End pick, Shift sets the end, roving tabindex, Today, out-of-range disabled, focus kept across repaint);
  - the v1.2.0 card layout (collapse, reorder by pointer and keyboard, the Move menu with `aria-disabled` ends) saved in `settings.date`, with Reset;
  - the calendar settings;
  - **countdowns:** a list of up to 20 in the `countdowns` document, ticks from absolute time that pause while hidden, saved on commit only, never cleared by an empty field;
  - a no-op `history.record` hook for M3;
  - tests ported into safety-eval B/C with mutants, and 390 px screenshots.
- **M2c, the Percentage tool:**
  - the 8 cards with swaps, copy, tax add/extract, and tip presets 10/15/18/20 % with a people count of at least 1;
  - the same card layout component, saved in `settings.percent`;
  - the engine's `<br>` labels never interpreted: lines are rendered from structured fields as text;
  - percent-core's two `.expect()` calls made total **without changing output** (the goldens stay byte-identical, and so does native = WASM);
  - tests with mutants and screenshots.

## Review lenses

- **A: spec, behaviour parity, correctness and durability.** Compare both ports with the original apps on real inputs (same results, same live formulas, the calendar, countdown and layout behaviour), check countdown durability, the B11 settings schema and the history hook, and re-run the full list.
- **B: phone UX, accessibility, security, i18n/RTL and themes.** Use a served build at 360/390/440 px, 844x390 landscape and the desktop. Check thumb reach, 44 px targets, keyboard-cover behaviour, focus, live regions (no announcement per countdown tick), contrast in all 3 themes, ar-XB with numbers LTR, en-XA overflow, and no innerHTML, `.style`, raw colours or engine markup rendered as HTML.

## Lessons from this run

The M2b executor ended its turn while waiting for a background run and never resumed: its work was verified but uncommitted. The M2c executor re-ran the full list on that unchanged tree and committed it as its own step (E-08). Before building on a phase reported done, check `git status`, `git log` and file times.

## Reuse

Use for porting an existing feature with parity: give the reviewer the original source to compare against on real inputs, and make every phase end in a verified commit, so an interrupted run loses at most one phase.
