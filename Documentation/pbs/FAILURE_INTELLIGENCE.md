# ⚠️ Failure Intelligence — Portable Calculator Tool

**Created:** 2026-11-20

**Last substantive update:** 2026-11-20 (FI-01 to FI-16 recorded from the ledger, the commit history and HANDOFF.md)

**Maintainer:** the integrating executor (Claude Code on Ahmed Emara's account since the handoff was received on 2026-11-20); adoption of rules is decided by the CipherVaults partners Mohamed Sayed and Ahmed Emara

**Scope:** this project's consequential failures, near-misses and system gaps, from M0 (2026-11-18) to the M3 review fixes (2026-11-20), plus two inherited from the Date Calculator that shaped this project's controls

**Ordering:** Newest incident first. Keep stable IDs and occurrence dates; put newest dated follow-ups first within an incident.

**Related owners:** [Execution & Coding Ledger](EXECUTION_AND_CODING_LEDGER.md) for chronology, evidence and coding lessons; [AGENTS.md](../../AGENTS.md) for adopted rules; [Security Hardening Dossier](SECURITY_HARDENING_DOSSIER.md) for the controls; [Testing & Verification](TESTING_AND_VERIFICATION.md) for the checks; the working tree and `git log` on `dev` for live state.

## Purpose

History is the owner's top priority ("the most important part is the history of the calculations"), the repository is public, and every milestone is closed on the strength of automated checks. This record explains what went wrong or nearly went wrong in those three areas, why, the actual impact, the correction, and a reusable prevention rule, so a later executor does not repeat it.

## Admission Boundary

An incident is admitted when it:
- could lose, overwrite or hide stored user data (history, countdowns, settings), or show a value other than the one stored;
- could publish personal or machine-local data from this public repository or its build outputs;
- let a check pass for the wrong reason, or made a verification claim unreliable;
- lost or stranded work in progress, or broke continuity between sessions or accounts;
- broke a release or integrity artifact.

Ordinary friction, style findings and review findings that were fixed without any of these consequences stay in the ledger.

Status words: **resolved with verification** means verified locally (Chromium and WebView2); no user data exists yet because nothing is released.

## Incidents

### FI-16 — Some reviewer findings were wrong or out of scope

**Occurrence / observation date:** 2026-11-18 to 2026-11-20 (the M0, M1/M2a, M2 and M3 reviews); recorded in HANDOFF.md on 2026-11-19

**Last resolution update:** 2026-11-20

**Classification:** System Gap

**Status:** contained

#### Context

Every milestone ran with two independent reviewers and a fix agent ([AI working context](../handoff/AI_WORKING_CONTEXT.md) §3).

#### Mistake / Gap

Observed: HANDOFF.md records that about 1 in 10 review findings was wrong or out of scope. The individual wrong findings were not recorded in the repository; the ledger records only dispositions (E-06: 19 of 20 fixed, 1 left for the owner; E-10: 12 of 12 confirmed against the code; E-12: 23 findings, some "fixed differently" or "partly").

#### Root Cause

Reviewers read code without running it and can misread intent or scope. A fix agent that applies findings unchecked would turn a wrong finding into a regression. The cause of each wrong finding is not recorded.

**Evidence / limits:** HANDOFF.md §3a "Do not repeat"; ledger E-06, E-10, E-12. The 1-in-10 rate is a coordinator estimate, not a counted figure.

#### Impact

**Actual impact:** none established; the fix step verified each finding before changing code.

**Potential impact:** a wrong finding applied unchecked could have changed engine behaviour or removed a control.

#### Resolution

The fix agent verifies every finding against the code before changing anything; E-10 records all 12 findings confirmed first.

**Verification:** dispositions per finding in E-06, E-10 and E-12.

**Outstanding action / owner:** record each rejected finding and its reason in the ledger row of the review that raised it (integrating executor).

#### Lesson

A review finding is a hypothesis about the code, not a fact.

#### Prevention Rule

**When:** a review returns findings.

**Do:** check each finding against the code (and reproduce it where possible) before any fix; record rejected ones with a reason.

**Check:** the ledger row lists every finding as fixed, fixed differently, partly, rejected or recorded.

**Adoption:** adopted as working practice in HANDOFF.md §3a and AI_WORKING_CONTEXT.md §3 (coordinator, 2026-11-19).

**Durable owner:** AI_WORKING_CONTEXT.md §3 (workflow step 3).

#### Pattern / Confidence

**Pattern:** verification of inputs; see FI-07 (claims of "done" that were not).

**Confidence:** high that the practice is in place; low on the exact rate.

**Limits / revisit trigger:** a counted record of rejected findings.

#### Dated Follow-up

- None yet.

### FI-15 — Calculate could record the values typed after the click

**Occurrence / observation date:** 2026-11-20 (M3 review, Ledger E-12)

**Last resolution update:** 2026-11-20

**Classification:** Failure

**Status:** resolved with verification

#### Context

The Date and Percentage tools record a history entry on Calculate or Enter (M3, `2d73568`).

#### Mistake / Gap

Observed by the review: typing right after a Calculate click could record the newer inputs instead of the calculation the click computed. In the same review run, two timing-dependent safety-eval tests failed: a test that clicked and moved on without awaiting, with an `until()` that returned quietly on timeout, both hid this race and made it flaky.

#### Root Cause

The record step read the live inputs at write time rather than the values of the click's own calculation. The tests did not await each step and treated a timeout as success.

**Evidence / limits:** commit `b7d50b1` body; Ledger E-12 and §3 lessons ("A test that clicks and moves on without awaiting…").

#### Impact

**Actual impact:** none on users (unreleased). A history entry could have held inputs and a result that never appeared together.

**Potential impact:** a wrong calculation stored as history, which the user trusts.

#### Resolution

Percentage records the calculation its own click computed; a Date Calculate superseded by a newer pending update records nothing, and the next Calculate records the newer values (Ledger §8). The two-window test awaits every Calculate and fails on any timeout; the announcer test counts every write to the live region.

**Verification:** safety-eval "click-then-type" test (E-12); safety-eval 453 passed in two consecutive runs.

**Outstanding action / owner:** None.

#### Lesson

What is recorded must be what the action computed, and a test must fail loudly when a wait times out.

#### Prevention Rule

**When:** an action records or saves derived data, or a test waits for an asynchronous effect.

**Do:** capture the action's own inputs and result at the action; await each test step and fail on timeout.

**Check:** a click-then-type test exists and passes; no `until()` returns quietly.

**Adoption:** adopted in Ledger §3 lessons (E-12).

**Durable owner:** `scripts/lib/eval-history.mjs` and the Percentage/Date tool tests.

#### Pattern / Confidence

**Pattern:** race between UI events and writes; checks passing for the wrong reason (FI-04, FI-10).

**Confidence:** high (reproduced by the test).

**Limits / revisit trigger:** auto-save in M3b changes when entries are recorded (spec 7 §2).

#### Dated Follow-up

- None yet.

### FI-14 — A failed re-read emptied the history view and Export, and refused entries vanished without a word

**Occurrence / observation date:** 2026-11-20 (M3 review, Ledger E-12). The pattern was first seen in the Date Calculator before this project started (plan Part A, fact 3)

**Last resolution update:** 2026-11-20

**Classification:** Failure

**Status:** resolved with verification

#### Context

The web history store re-reads the stored document after other windows write. In the Date Calculator v1.0.0, `load_history_from_path` returned an empty list on any read or parse failure, and the next append overwrote the file (plan "Facts that correct the source designs", item 3; fixed in Date v1.1.0). This project designed read-only-on-any-doubt from the start (plan B10).

#### Mistake / Gap

Observed by the review: a reload that could not read the history emptied the list on screen and the Export, although the stored document was untouched. Entries the engine refused were dropped with no message. Pinned entries over the 4 MiB cap blocked every later write.

#### Root Cause

The view treated "could not read" as "no entries", the same load-as-empty shape as the Date app, one layer up. A refusal without an operation index blocked the whole batch.

**Evidence / limits:** commits `43f4f01`, `b7d50b1`; Ledger E-12 and §3 ("A refusal with no operation index…").

#### Impact

**Actual impact:** no data loss (the store stayed read-only); the user would have seen an empty history and could have exported an empty file.

**Potential impact:** a user acting on an empty view (Start fresh, or keeping an empty export as a backup).

#### Resolution

A reload that cannot read keeps the last good entries on screen and in Export; a refused operation is dropped on its own with a banner, never blocking the others; the operation that would put pinned entries alone over the cap is refused at its own index (`ops[i]`); an `isolate()` guard keeps every operation when the stored document itself is refused.

**Verification:** E-12 tests "rejected and missing" and "a reload that cannot read keeping the view"; 66 history mutants caught.

**Outstanding action / owner:** a "Restore previous history" action from `history.bak.N` was not added (E-12, finding 1); integrating executor, with M3b.

#### Lesson

"Could not read" is never "empty", in the store or in the view.

#### Prevention Rule

**When:** any read of a stored document fails or is refused.

**Do:** keep the last good state on screen and in Export, go read-only, and say so; drop only the refused operation.

**Check:** a test reads a failing document and asserts the view and Export still hold the last good entries.

**Adoption:** adopted in AGENTS.md "History" ("nothing is dropped silently").

**Durable owner:** AGENTS.md; `scripts/lib/eval-history.mjs`.

#### Pattern / Confidence

**Pattern:** history loss (FI-12, FI-13, FI-05); inherited from the Date app.

**Confidence:** high.

**Limits / revisit trigger:** the separate notes store in M3b adds a second document to keep consistent.

#### Dated Follow-up

- None yet.

### FI-13 — "Start a new history" could delete a history that had become readable again

**Occurrence / observation date:** 2026-11-20 (M3 review, Ledger E-12)

**Last resolution update:** 2026-11-20

**Classification:** Near-Miss

**Status:** resolved with verification

#### Context

When the history cannot be read, a banner offers Retry and "Start a new history" (`clear`). The Date Calculator had a related defect, found in its review before v1.1.0: reset could overwrite an unbacked history (Date dossier, E-15 there).

#### Mistake / Gap

Observed by the review: a banner shown during a passing read error stayed on screen; choosing "Start a new history" then deleted a document that was valid again.

#### Root Cause

The clear trusted the state at the time the banner was shown instead of re-checking the document inside the clear.

**Evidence / limits:** commit `43f4f01`; Ledger E-12 and §3 ("'Start fresh' must re-check the document inside the clear").

#### Impact

**Actual impact:** none (unreleased; a backup is written before any clear since E-06).

**Potential impact:** a full, valid history replaced by an empty one, leaving only the backup.

#### Resolution

`DocStore::clear` and the web store re-check the stored document inside the clear and refuse one that validates again as `recovered`; the shell then reloads it, as Retry would.

**Verification:** tests `a_history_that_validates_again_is_never_cleared` (desktop) and the E-12 "Start new after recovery" safety-eval test (web).

**Outstanding action / owner:** None.

#### Lesson

A destructive action must re-check its precondition at the moment it acts.

#### Prevention Rule

**When:** a reset, clear or overwrite is offered from an earlier observation.

**Do:** re-read and re-validate inside the same operation; refuse if the reason no longer holds.

**Check:** a test where the document becomes valid between the banner and the click.

**Adoption:** adopted in AGENTS.md "Stores".

**Durable owner:** AGENTS.md; `crates/pcalc-store/src/docs.rs` tests.

#### Pattern / Confidence

**Pattern:** history loss (FI-05, FI-12, FI-14).

**Confidence:** high.

**Limits / revisit trigger:** the notes store in M3b must follow the same rule.

#### Dated Follow-up

- None yet.

### FI-12 — "Keep pinned" was decided from one window's copy and deleted an entry pinned in another

**Occurrence / observation date:** 2026-11-20 (M3 review, Ledger E-12)

**Last resolution update:** 2026-11-20

**Classification:** Failure

**Status:** resolved with verification

#### Context

M3 (`2d73568`) wrote history with compare-and-save and re-applied the same operations on a conflict, so two windows never overwrote each other's entries.

#### Mistake / Gap

Observed by the review: "Clear all, keep pinned" sent the ids this window believed unpinned. An entry pinned in another window was deleted. What Undo put back was also taken from this window's copy, not from what the write removed.

#### Root Cause

A choice that depends on the stored state was made from a window's own copy. Compare-and-save does not help: the retry re-applies the same stale ids. Two desktop processes could also overwrite each other's files.

**Evidence / limits:** commit `43f4f01`; Ledger E-12 and §3 ("A choice that depends on the stored state…").

#### Impact

**Actual impact:** none (unreleased).

**Potential impact:** loss of entries the user had pinned to keep.

#### Resolution

`clear {keepPinned}` sends the intent; the engine decides what is pinned on the stored document at write time and again on a retry, and `opResults` returns what each operation removed, so Undo puts back exactly those entries as stored. Every DocStore write holds an exclusive `docs.lock` across processes.

**Verification:** cargo test for clear at write time with per-op results; `another_process_holding_the_store_lock_blocks_every_write`; safety-eval "Undo putting back another window's note".

**Outstanding action / owner:** a real two-process desktop race (owner check); the second process's view stays stale until its next write (consider `tauri-plugin-single-instance` with M5b+, spec 7).

#### Lesson

Send intent, not a stale selection; let the engine decide on the stored document.

#### Prevention Rule

**When:** an operation's effect depends on stored state another window can change.

**Do:** express it as an intent the engine evaluates at write time, and return what it changed.

**Check:** a two-window test where the other window changes the deciding state first.

**Adoption:** adopted in AGENTS.md "History".

**Durable owner:** AGENTS.md; `crates/pcalc-api/src/history.rs`.

#### Pattern / Confidence

**Pattern:** lost update across windows (FI-09).

**Confidence:** high.

**Limits / revisit trigger:** M3b's "keep protected" (pinned, noted or manual) and the notes store (spec 7 "What the M3 review leaves for M3b", items 2 and 3).

#### Dated Follow-up

- None yet.

### FI-11 — Invisible raw characters were written into source files

**Occurrence / observation date:** 2026-11-19 (M3, Ledger E-11), again 2026-11-20 (E-12)

**Last resolution update:** 2026-11-20

**Classification:** Failure

**Status:** contained

#### Context

Code and tests that handle U+FEFF, U+2212, U+FFFD, no-break and thin spaces and bidi override characters.

#### Mistake / Gap

Observed: `\uXXXX` escapes typed into commands and files came out as the raw characters, leaving an invisible byte order mark in a source file (E-11). In E-12 a regex with no-break and thin spaces and a test with RLO characters came out raw.

#### Root Cause

The tool inputs of the session turned some escapes into the characters themselves. Raw invisible characters are hard to review and, for bidi controls, can make code read differently from how it runs.

**Evidence / limits:** Ledger §3 last lesson; E-12 "Fixed on resume".

#### Impact

**Actual impact:** none established beyond the edited files; they were rewritten as escapes before commit.

**Potential impact:** a hidden character changing a regex or a test, or reaching a CSP-hashed file.

#### Resolution

The raw characters were rewritten as escapes; a scan script that builds its character set from code points found them.

**Verification:** E-12 scan before commit.

**Outstanding action / owner:** make the scan a check in the verification list (integrating executor; not yet assigned to a script).

#### Lesson

Escapes typed through tools may not arrive as escapes.

#### Prevention Rule

**When:** writing a file that should contain `\uXXXX` escapes or special characters.

**Do:** build them from character codes, then scan the changed files for raw special characters.

**Check:** the scan reports none.

**Adoption:** adopted in Ledger §3 (E-11, E-12); not yet automated.

**Durable owner:** Not yet assigned.

#### Pattern / Confidence

**Pattern:** tooling transforms content silently (FI-08, FI-01).

**Confidence:** high in the observation; medium on the exact mechanism.

**Limits / revisit trigger:** a recurrence after the scan is automated.

#### Dated Follow-up

- 2026-11-20 — Recurred in E-12 (regex and test); found by the scan and fixed before commit.

### FI-10 — The fake IndexedDB made two-writer tests meaningless

**Occurrence / observation date:** 2026-11-19 (M3, Ledger E-11)

**Last resolution update:** 2026-11-20

**Classification:** System Gap

**Status:** resolved with verification

#### Context

safety-eval slices B and C run the web store in a mini-DOM with a fake IndexedDB (`scripts/lib/mini-dom.mjs`).

#### Mistake / Gap

Observed: the fake let two overlapping readwrite transactions each commit a whole snapshot, so it lost writes no browser loses, and a two-writer test could not mean anything.

#### Root Cause

The test double did not model the browser's serialisation of readwrite transactions.

**Evidence / limits:** Ledger §8 "Test tooling", §3 ("A two-writer test on a fake IndexedDB proves nothing…").

#### Impact

**Actual impact:** none on users; until the fix, concurrency claims in the mini-DOM were not supported.

**Potential impact:** a real race shipped behind a passing test.

#### Resolution

The fake runs readwrite transactions one at a time; since E-12 it commits only the keys written.

**Verification:** two-window tests in safety-eval (E-11, E-12), each awaited.

**Outstanding action / owner:** None.

#### Lesson

A fake must reproduce the property under test.

#### Prevention Rule

**When:** a test relies on a fake for concurrency, ordering or failure behaviour.

**Do:** model that behaviour in the fake and add a mutant that breaks it.

**Check:** the mutant fails the test.

**Adoption:** adopted in Ledger §3.

**Durable owner:** `scripts/lib/mini-dom.mjs`.

#### Pattern / Confidence

**Pattern:** checks passing for the wrong reason (FI-04, FI-15).

**Confidence:** high.

**Limits / revisit trigger:** a two-object-store transaction for notes (M3b).

#### Dated Follow-up

- 2026-11-20 — The fake commits only the keys written (commit `b7d50b1`).

### FI-09 — Countdowns: last writer won the whole list across tabs

**Occurrence / observation date:** 2026-11-19 (M2 review, Ledger E-10)

**Last resolution update:** 2026-11-19

**Classification:** Failure

**Status:** resolved with verification

#### Context

The Date tool's countdown list (M2b, `9e50b52`) is one stored document.

#### Mistake / Gap

Observed by the review and reproduced in Edge: a countdown added in another tab disappeared when this tab saved its list.

#### Root Cause

Each tab wrote its whole in-memory list ("last writer wins"), which is data loss, not a conflict rule.

**Evidence / limits:** commit `f204e77`; Ledger E-10 and §3 ("'Last writer wins' for a whole list…").

#### Impact

**Actual impact:** none on users (unreleased).

**Potential impact:** lost countdowns whenever two tabs or windows were open.

#### Resolution

A write reads the stored list and merges by id; only ids changed here compete by `savedAtMs`; deletions are kept for the session; another tab's change is adopted even while focus is in the card.

**Verification:** browser-boot `date.two-tabs-keep-both-countdowns`; safety-eval `C.countdowns-multitab-other-tab-item-survives`, `-merge-on-write`; the negative control lost the tab-B countdown (E-10).

**Outstanding action / owner:** None.

#### Lesson

A copy this tab did not change is only a cache.

#### Prevention Rule

**When:** a list is written whole.

**Do:** read the stored list inside the write and merge by id.

**Check:** a two-tab test where both tabs add an item.

**Adoption:** adopted in AGENTS.md "Tools" (countdowns written only on a commit) and Ledger §3.

**Durable owner:** the Date tool's countdown code and its tests.

#### Pattern / Confidence

**Pattern:** lost update across windows (FI-12).

**Confidence:** high. A side finding: a fixed test clock gives equal `savedAtMs`, so the merge treats unchanged copies as caches.

**Limits / revisit trigger:** M3b's New/Duplicate countdowns and notes.

#### Dated Follow-up

- None yet.

### FI-08 — A PowerShell loop variable overwrote the verify script's scratch path

**Occurrence / observation date:** 2026-11-19 (recorded with the E-07 records, commit `268c110`)

**Last resolution update:** 2026-11-19

**Classification:** Near-Miss

**Status:** contained

#### Context

The full verification list runs as one PowerShell script.

#### Mistake / Gap

Observed: `foreach ($s in …)` overwrote `$S`, the scratch path, and the script sent output into a directory named after the command.

#### Root Cause

PowerShell variable names are case-insensitive.

**Evidence / limits:** Ledger §3; HANDOFF.md §3a.

#### Impact

**Actual impact:** misplaced verification output; no repository file is recorded as changed.

**Potential impact:** a verification run writing outside its folder, or reading the wrong evidence.

#### Resolution

Distinct names in verify scripts.

**Verification:** later runs (E-08 to E-12) wrote their output where expected.

**Outstanding action / owner:** None.

#### Lesson

Names that differ only in case are one name in PowerShell.

#### Prevention Rule

**When:** writing a PowerShell script.

**Do:** use names that differ by more than case.

**Check:** a review of the script's variable names.

**Adoption:** adopted in HANDOFF.md §3a "Do not repeat".

**Durable owner:** HANDOFF.md §3a; Ledger §3.

#### Pattern / Confidence

**Pattern:** shell and tooling traps (FI-01, FI-11).

**Confidence:** high.

**Limits / revisit trigger:** None.

#### Dated Follow-up

- None yet.

### FI-07 — Session restarts and stopped workflows left work uncommitted or reported as done

**Occurrence / observation date:** 2026-11-18 (E-02), 2026-11-19 (E-08 and the handoff), 2026-11-20 (E-12)

**Last resolution update:** 2026-11-20

**Classification:** Failure

**Status:** contained

#### Context

Work ran as multi-agent workflows inside Claude sessions; an hourly prompt resumed work after usage-limit resets on the previous account.

#### Mistake / Gap

Observed:
- E-02: the session was interrupted before committing M0; the tree was re-verified.
- E-08: the M2b executor ended its run with the work verified but uncommitted; its last report was only that it would be notified when a run completed. Its own evidence (screenshots, timings) was not recovered.
- 2026-11-19: at the handoff the M3 workflow on the previous account was mid-flight with uncommitted edits; workflows, scheduled prompts and memory of that account stop with its session (HANDOFF.md §3a).
- E-12: the session that started the M3 review fixes was interrupted; its uncommitted edits in 20 files were read hunk by hunk, kept and completed.

#### Root Cause

A subagent that ends its turn while waiting for a background run may never resume; session state does not survive a restart or an account change.

**Evidence / limits:** Ledger E-02, E-08, E-11, E-12 and §3; HANDOFF.md §2, §3a.

#### Impact

**Actual impact:** delay and repeated verification; the M2b executor's own evidence lost (the M2c executor's re-run stands in for it). No code loss established.

**Potential impact:** building on a milestone reported done but never committed.

#### Resolution

Each successor read `git status`, file times and the diff, verified the tree with the full list and committed it as its own step (E-08: `9e50b52`; E-11: the uncommitted Rust half kept; E-12: 20 files completed).

**Verification:** E-08, E-11 and E-12 full runs green.

**Outstanding action / owner:** None; the handoff to Ahmed Emara's account was received on 2026-11-20.

#### Lesson

A report of "done" is not a commit.

#### Prevention Rule

**When:** resuming, or building on a milestone reported done.

**Do:** check `git status`, `git log` and file times first; verify and commit what is there as its own step; push after each verified milestone.

**Check:** `git ls-remote origin dev` equals `git rev-parse HEAD`.

**Adoption:** adopted in Ledger §3 and HANDOFF.md §3a ("Live state at handoff").

**Durable owner:** AGENTS.md "Git & GitHub rhythm" (push after each verified milestone).

#### Pattern / Confidence

**Pattern:** continuity.

**Confidence:** high.

**Limits / revisit trigger:** a new scheduled auto-continue prompt on the new account.

#### Dated Follow-up

- 2026-11-20 — Interrupted again during the M3 review fixes; recovered and committed as `43f4f01`, `b7d50b1`.

### FI-06 — A new service worker could pair with a stale index.html and delete the only matching cache

**Occurrence / observation date:** 2026-11-18 (M1/M2a review, Ledger E-06)

**Last resolution update:** 2026-11-18

**Classification:** Near-Miss

**Status:** resolved with verification

#### Context

The Pages build caches hashed assets plus the unhashed `index.html` and `sw.js` (plan B3; risk B18-6 "a stale service worker mixes asset versions").

#### Mistake / Gap

Found by the review: a worker that caches `index.html` straight from the network could store a stale N `index.html` (as a CDN edge may still serve) under build N+1 and then delete N's cache, the only one that matched it.

#### Root Cause

The worker trusted network bytes for files whose names carry no hash.

**Evidence / limits:** commit `b2e2050`; Ledger E-06 and §3.

#### Impact

**Actual impact:** none (no Pages site exists).

**Potential impact:** an installed PWA that no longer boots, online or offline.

#### Resolution

`sw.js` carries every cached file's SHA-256 and fails the install on a mismatch, so the old worker and cache stay.

**Verification:** browser-boot `upgrade` group (11 checks); run against the old worker: both caches kept, then no boot verdict (E-06).

**Outstanding action / owner:** a real phone upgrade once Pages is live (owner check, M10).

#### Lesson

Hash every cached file, not only the ones whose names change.

#### Prevention Rule

**When:** a file is added to the cached list.

**Do:** add it to build-info with its hash.

**Check:** `D.dist.service-worker-caches-exactly-this-build` and the stale-index upgrade case pass.

**Adoption:** adopted in CONTINUATION_STATE "Do not repeat".

**Durable owner:** `web/sw.template.js`; `scripts/browser-boot.mjs` `upgrade`.

#### Pattern / Confidence

**Pattern:** release integrity (FI-01).

**Confidence:** high in Chromium; WebKit's worker behaviour is not observed.

**Limits / revisit trigger:** first upgrade on a real iPhone home-screen app.

#### Dated Follow-up

- None yet.

### FI-05 — A clock set back pruned the backup that "Start fresh" relied on

**Occurrence / observation date:** 2026-11-18 (M1/M2a review, Ledger E-06)

**Last resolution update:** 2026-11-18

**Classification:** Near-Miss

**Status:** resolved with verification

#### Context

The desktop DocStore keeps the newest 3 backups, named by time stamp.

#### Mistake / Gap

Found by the review: with the clock set back (a reset CMOS, or a date set ahead to test countdowns and then corrected) the backup just written sorted oldest and was pruned at once; `load()` still reported it, and "Start fresh" then removed the document, leaving no copy. Separately, "Start fresh" would back up and delete a document written by a newer app.

#### Root Cause

Pruning trusted the clock in file names; `clear` did not confirm the backup existed or refuse a newer document.

**Evidence / limits:** commit `a4ee029`; Ledger E-06 and §3.

#### Impact

**Actual impact:** none (unreleased).

**Potential impact:** total loss of a history the user chose to reset in the belief a backup existed.

#### Resolution

`backup()` never prunes the file it just wrote; `clear()` loads an unseen document first, refuses a newer one, and removes the document only after reading the backup back and comparing it byte for byte. The web store got the same rules.

**Verification:** tests `a_clock_set_back_never_prunes_the_new_backup`, `a_newer_document_is_never_cleared`; a Rust mutant (the old pruning) fails the rollback test.

**Outstanding action / owner:** None.

#### Lesson

Never trust the clock to protect data.

#### Prevention Rule

**When:** pruning or removing stored data.

**Do:** never prune the file just written; read the backup back before removing the original.

**Check:** the rollback test with future-stamped backups passes.

**Adoption:** adopted in Ledger §3; AGENTS.md "Stores".

**Durable owner:** `crates/pcalc-store/src/docs.rs` tests.

#### Pattern / Confidence

**Pattern:** history loss (FI-13, FI-14).

**Confidence:** high.

**Limits / revisit trigger:** None.

#### Dated Follow-up

- None yet.

### FI-04 — Edge ignored the flag that was meant to disable WebAssembly

**Occurrence / observation date:** 2026-11-18 (M1, Ledger E-04)

**Last resolution update:** 2026-11-18

**Classification:** System Gap

**Status:** resolved with verification

#### Context

browser-boot proves the no-WebAssembly rescue path.

#### Mistake / Gap

Observed: Edge 157 silently ignores `--js-flags=--noexpose_wasm` and four other spellings (`--no-expose-wasm`, `--no_expose_wasm`, `--expose-wasm=false`, `--jitless`); `typeof WebAssembly` stays "object". A no-WASM test trusting the flag would pass for the wrong reason.

#### Root Cause

A browser flag was assumed to work without an in-page assertion.

**Evidence / limits:** Ledger E-04, §3, §5; HANDOFF.md §3a.

#### Impact

**Actual impact:** none; caught by a probe before any check relied on it.

**Potential impact:** a rescue path claimed verified but never exercised.

#### Resolution

The no-WASM tabs delete the global by a CDP pre-page script and assert `typeof WebAssembly` in the page.

**Verification:** browser-boot `no-wasm` group (16 checks).

**Outstanding action / owner:** None.

#### Lesson

Never trust a browser flag without an in-page assertion.

#### Prevention Rule

**When:** a test changes the environment to simulate a condition.

**Do:** assert the condition inside the page; add a positive control.

**Check:** the assertion is in the report.

**Adoption:** adopted in CONTINUATION_STATE "Do not repeat" and Ledger §3.

**Durable owner:** `scripts/browser-boot.mjs`.

#### Pattern / Confidence

**Pattern:** checks passing for the wrong reason (FI-10, FI-15, FI-03).

**Confidence:** high.

**Limits / revisit trigger:** a new Edge version.

#### Dated Follow-up

- None yet.

### FI-03 — Comment-stripping scanners hid banned code after a string with slashes

**Occurrence / observation date:** 2026-11-18 (M0 review, Ledger E-03)

**Last resolution update:** 2026-11-18

**Classification:** System Gap

**Status:** resolved with verification

#### Context

The static rules ban HTML sinks, inline style writes and `unsafe` outside allowed places.

#### Mistake / Gap

Found by the review: the `//` comment strippers also cut the rest of a line after `"a//"` or `"http://"`, so a sink or an `unsafe {` after such a string passed the scan.

#### Root Cause

A regex comment stripper cannot tell a comment from `//` inside a string.

**Evidence / limits:** commit `f0a9c53`; Ledger E-03 and §3.

#### Impact

**Actual impact:** none found in the code at the time.

**Potential impact:** a banned sink or `unsafe` block passing every check.

#### Resolution

The rules scan raw text (comments included) in `scripts/lib/web-hygiene.mjs` and `rust-hygiene.mjs`, with more bans, and every rule has a mutant.

**Verification:** `D.e2e.build-web-refuses-sink-after-string-with-slashes`, `D.e2e.check-unsafe-refuses-block-after-url-string`, `D.mutant.js.every-ban-has-a-mutant`.

**Outstanding action / owner:** None.

#### Lesson

Scan raw text and keep banned words out of comments.

#### Prevention Rule

**When:** adding a static rule.

**Do:** scan raw text and add a mutant, including one after a string with slashes.

**Check:** the mutant is caught.

**Adoption:** adopted in AGENTS.md "Verification workflow".

**Durable owner:** `scripts/lib/web-hygiene.mjs`, `scripts/lib/rust-hygiene.mjs`.

#### Pattern / Confidence

**Pattern:** checks passing for the wrong reason.

**Confidence:** high.

**Limits / revisit trigger:** None.

#### Dated Follow-up

- None yet.

### FI-02 — A bare cargo build put the local cargo-home path into the engine that the web build shipped

**Occurrence / observation date:** 2026-11-18 (M0, Ledger E-01 to E-03)

**Last resolution update:** 2026-11-18

**Classification:** Near-Miss

**Status:** resolved with verification

#### Context

The repository is public, and the web build embeds `engine.wasm` in the Pages site and the single file.

#### Mistake / Gap

Observed: a bare `cargo build` of the wasm32 cdylib embeds absolute dependency paths, including the local cargo home and so the Windows user name, in panic-location strings (E-02). The M0 review found that such an engine reached `dist/web` and the single file unchecked; a bare build also overwrote the remapped engine at cargo's output path, and the web build shipped it.

#### Root Cause

`trim-paths` is unstable on Cargo 1.99.1; the shipped engine came from a path another command also wrote.

**Evidence / limits:** commit `f0a9c53`; Ledger E-02, E-03, §3.

#### Impact

**Actual impact:** no publication established: `dist/` and `target/` are git-ignored, there is no release and no Pages site, and CI builds its engine on Linux runners.

**Potential impact:** a personal path published in a public release asset.

#### Resolution

`scripts/build-wasm.mjs` remaps the cargo home and the repo through RUSTFLAGS, is the only writer of `target/engine/engine.wasm` and fails if any local path remains; `build-web.mjs`, `check-wasm.mjs` and `safety-eval.mjs` refuse a leaky engine (`scripts/lib/local-paths.mjs`).

**Verification:** after a bare build, `build-web` stops (exit 1, no `dist/web`) and refuses `--wasm` on cargo's output (E-03); `D.e2e.build-web-refuses-engine-with-local-path`, `D.dist.no-local-paths`.

**Outstanding action / owner:** adopt `trim-paths` once stable (ROADMAP backlog).

#### Lesson

Never ship from a path another command also writes; scan every consumer.

#### Prevention Rule

**When:** building or shipping `engine.wasm`, or pushing commits.

**Do:** build only through `build-wasm.mjs`; scan new commits for personal paths before pushing.

**Check:** the leak scans pass; `git grep` over `origin/dev..HEAD` finds no user path.

**Adoption:** adopted in AGENTS.md "Verification workflow" and AI_WORKING_CONTEXT.md §2.

**Durable owner:** `scripts/build-wasm.mjs`, `scripts/lib/local-paths.mjs`.

#### Pattern / Confidence

**Pattern:** privacy in a public repository.

**Confidence:** high.

**Limits / revisit trigger:** a toolchain update, or a new artifact that embeds paths.

#### Dated Follow-up

- None yet.

### FI-01 — SHA256SUMS.txt written with CRLF failed sha256sum -c in the Date app

**Occurrence / observation date:** 2026-11-17 (Date-Calculator-Tool PR #1 CI, that repo's Ledger E-12)

**Last resolution update:** 2026-11-20 (recorded here as an inherited lesson)

**Classification:** Failure

**Status:** resolved with verification in the Date app; the control for this project is planned for M10

#### Context

This project's release job arrives in M10 and must publish an LF `SHA256SUMS.txt` (plan B14).

#### Mistake / Gap

Observed in the Date app: `SHA256SUMS.txt` written by PowerShell `Set-Content` had CRLF, so `sha256sum -c` on Linux and macOS failed every line.

#### Root Cause

PowerShell `Set-Content` writes CRLF on Windows runners.

**Evidence / limits:** the Date repo's ledger E-12 and fix `9c06553`; HANDOFF.md §3a; HANDOFF.md §5 notes that Percentage-Calculator-Tool's CI still lacks this fix (recorded only, not to be changed under the focus rule).

#### Impact

**Actual impact:** a failing checksum file in a Date app CI artifact before release; fixed before the v1.0.0 release.

**Potential impact:** users unable to verify downloads.

#### Resolution

In the Date app: `[System.IO.File]::WriteAllText` with LF, and the step fails if any CR byte remains.

**Verification:** in the Date app, 0 CR and `sha256sum -c` OK 4/4 on later runs.

**Outstanding action / owner:** build the M10 release job with LF output and a CR check (integrating executor, M10).

#### Lesson

Write release files with explicit LF.

#### Prevention Rule

**When:** a workflow writes a checksum or release text file.

**Do:** use `[IO.File]::WriteAllText` with `\n`; fail on any CR byte; run `sha256sum -c` in the job.

**Check:** the release job's own `sha256sum -c` passes.

**Adoption:** adopted in HANDOFF.md §3a "Do not repeat".

**Durable owner:** the M10 release job (not yet written).

#### Pattern / Confidence

**Pattern:** tooling transforms content silently (FI-08, FI-11).

**Confidence:** high.

**Limits / revisit trigger:** M10.

#### Dated Follow-up

- None yet.
