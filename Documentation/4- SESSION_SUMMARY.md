# Session Summary

Factual record of the Portable Calculator Tool work from the merged-app plan (2026-11-17) to M3 and its review (2026-11-20). Sources: `git log` on `dev` in this repository and in `CipherVaults/Date-Calculator-Tool`, the [Execution & Coding Ledger](pbs/EXECUTION_AND_CODING_LEDGER.md) (evidence IDs E-01 to E-13), [HANDOFF.md](../HANDOFF.md) and the [Decisions Log](handoff/DECISIONS_LOG.md). Milestones are defined in [3- ROADMAP.md](3-%20ROADMAP.md) and in Part B of [5- PORTABLE_CALCULATOR_PLAN.md](specs/5-%20PORTABLE_CALCULATOR_PLAN.md). Times are UTC+2 (the commit time zone) unless marked Z.

Sessions until 2026-11-19 were driven by Ahmed Emara using Mohamed Sayed's Claude account; from 2026-11-20 the work continues on Ahmed's own account. Both CipherVaults partners have full authority. The executor throughout was Claude Code (Opus 5.5), coordinating multi-agent workflows ([workflow briefs](workflows/README.md)).

---

## Session: November 17th, 2026 - The Merged-App Plan

---

## Time

Start: November 17th, 2026, evening, after Date Calculator v1.0.0 was released (2026-11-17T19:22:53Z), in the Date Calculator repository sessions
End: November 17th, 2026, with the Mini Calculator added to the plan (Date repo `96f72a7`, 23:40)
Commits (Date repo): `5b0749b` (23:20, the approved plan recorded), `96f72a7` (23:40)

---

## Session Goal

Turn the owner's request to merge Percentage Calculator Tool (PCT) and Date Calculator Tool (DCT) into one app into an approved, executable plan.

---

## What We Worked On

### 1. The request

The owner asked for "one holistic app … called the portable calculator tool":
- Percentage + Date + a full calculator like Windows (Standard, Scientific, Graphing, Programmer);
- converters for volume, length, weight/mass, temperature, energy, area, speed, power, data, pressure and angle (12 categories in the plan);
- "the most important part is the history of the calculations";
- two Date fixes: a countdown that survives closing, and clickable calendar days.

### 2. Owner answers

| Question | Answer |
|---|---|
| Date fixes | ship first as Date v1.1.0 |
| Web engine | one Rust engine compiled to WebAssembly |
| Repository | a new repo, `CipherVaults/Portable-Calculator-Tool`, v1.0.0 |
| First release scope | all of Standard + Scientific, Programmer, Unit converters, Graphing |

### 3. Design workflow

A read-only workflow ([brief](workflows/design-portable-calculator.md)):
- three independent designs (engine and architecture; product and UX; risk, migration and delivery);
- one synthesis;
- an adversarial critique with **21 findings**, none rejected (spec 5, "Critique items not adopted");
- a full revision.

The result is [5- PORTABLE_CALCULATOR_PLAN.md](specs/5-%20PORTABLE_CALCULATOR_PLAN.md): Part A (Date v1.1.0) and Part B (this app, milestones M0–M11).

### 4. Approval and clarifications

"Yeah, I approve of that" (PBS v1.1: plan approval = Goal approval). Clarifications at approval, which override the plan body:
- no legacy history migration ("We are almost starting afresh"): B12, the `legacy.*` ops, `origin`/`originKey` and M4 are dropped;
- standing improvement authority for fixes, improvements and security hardening that matter;
- a phone-first web app.

### 5. Mini Calculator (plan B5a)

Added on request: any number of small Standard windows sharing one history with the full app, plus a setting that makes the keyboard's Calculator key open it (the per-user `AppKey\18` registry value, no admin rights). Planned for M5b+.

---

## Session: November 18th, 2026 - Themes, Languages, Date v1.1.0 and v1.2.0, the New Repository and M0

---

## Time

Start: November 18th, 2026, with themes and languages added to the plan (Date repo `65097d4`, 03:55)
End: November 18th, 2026, with the Date v1.2.0 release recorded (Date repo `c99cb98`, 18:54). The M1 work of the next session ran alongside from 09:33
Commits: this repo `659311e` (04:33, `main`), `e1f1ddc`, `a5b2160`, `3b6bbb0` (05:05), `3ef9e3a`, `e28fecb`, `40a3076`, `482e52d` (08:53), `f0a9c53` (09:13) on `dev`; Date repo `c66843a`, `be06e59`, `2b24700`, `a9488cc`, `605a407`, `c99cb98`

---

## Session Goal

Finish Part A in the Date repo, create the new repository and build milestone M0: the workspace, the one engine API, the WebAssembly build and the CI skeleton.

---

## What We Worked On

### 1. Themes and languages in the plan (plan B5b, B5c)

- **Themes:** Terminal (default), a "white-ish but not plain white" Daylight, and a Retro theme in the Windows 95/XP spirit.
- **Languages:** 12, Arabic first and right-to-left: en, ar, es, fr, de, pt-BR, it, ru, tr, zh-Hans, ja, ko.

### 2. Date v1.1.0 and v1.2.0 (Part A and A8)

Built and released in the Date repo: v1.1.0 (clickable calendars, a remembered countdown, the history-loss fix, separate app and engine versions) and v1.2.0 (collapsible, reorderable cards). Their evidence is that repo's ledger E-15 to E-17 and its own Session Summary. date-core stayed at engine 1.0.0.

### 3. Repository and M0 scaffold (E-01, E-02)

- The owner wrote: "I authorize the creation of a repository for the portable calculator tool, and I want it from the start". `CipherVaults/Portable-Calculator-Tool` (public) was created and `main` and `dev` pushed.
- `main` is `659311e`, the first commit, with **no `.github/workflows`**, so nothing can be released by accident before M10.
- On `dev` ([brief](workflows/portable-m0-scaffold.md)):
  - the toolchain pin (Rust 1.99.1, wasm32);
  - date-core (copied unchanged from the Date repo, engine 1.0.0) and percent-core (from PCT tag `v2.3.0`);
  - skeletons of calc-num, calc-core, units-core and graph-core;
  - `pcalc-api` (one `call(op, req)`, date-core's envelope, per-op caps), `pcalc-wasm` (raw ABI) and `pcalc-store`;
  - the Tauri shell with `--smoke-test`;
  - the web skeleton, the build and parity scripts, and a dev-only CI.
- E-01: 183 tests; engine.wasm 323,458 B through `build-wasm.mjs`, two clean builds byte-identical; check-wasm 0 native/WASM mismatches under UTC, America/New_York and Africa/Cairo. E-02 re-ran everything after the session was interrupted before committing.
- CI run 44254904073 on `482e52d`: all three jobs green.

### 4. M0 review: the engine path leak (E-03, `f0a9c53`)

- **Found:** a bare `cargo build` of the wasm32 engine embeds the local cargo-home path, which contains the Windows user name, in panic-location strings. Such an engine was shippable.
- **Fixed:** `scripts/build-wasm.mjs` remaps the paths and is the only writer of `target/engine/engine.wasm`; `build-web.mjs`, `check-wasm.mjs` and `safety-eval.mjs` refuse any engine that contains a local path of the machine (`scripts/lib/local-paths.mjs`).
- Also: safety-eval slice D (static hygiene, raw-text scans, a mutant for every rule; 77 checks), the loader's `unknown_op` order above the WASM input limit, and check-wasm building its own bridges.

### 5. Standing release authority

"don't wait for my approval to release, I already grant it to you if you tested it and it's good". Merging `dev` → `main` and releasing verified work needs no new ask; creating repositories and changing repository settings (for example enabling Pages) still do.

---

## Session: November 18th–19th, 2026 - M1, M2a, the Phone Bottom Bar, M2b and M2c

---

## Time

Start: November 18th, 2026, with M1's cap tests (`0398fd0`, 09:33)
End: November 19th, 2026, with the M2 review fixes recorded (`e97b1a6`, 11:56), pushed, CI green (run 44501883562)
Commits: `0398fd0`, `2b9e412`, `f2a60d9`, `84c7ad9`, `fa1f746`, `605147c` (M1); `adae5b2`, `db6e554`, `e56f996`, `ac10bdb`, `0673f1b`, `2be8557`, `ffa9d22` (M2a); `a4ee029`, `0118df6`, `b2e2050`, `b56032a` (review fixes); `02bf56e`, `268c110` (bottom bar); `9e50b52` (M2b); `2b9f5c1`, `1c2422c`, `22e2c52`, `89c1c05` (M2c); `f204e77`, `e97b1a6` (M2 review fixes)

---

## Session Goal

Prove that the native and WebAssembly engines are identical and boot under the real CSPs (M1), build the phone-first shell (M2a), then port the Date and Percentage tools into it (M2b, M2c), each with independent reviews.

---

## What We Worked On

### 1. M1: parity and boot proof (E-04)

Workflow: [portable-m1-m2a](workflows/portable-m1-m2a.md).
- **Random diff:** 200,000 seeded requests (seed 20261118) per time zone over all 18 ops, unknown ops, malformed JSON, invalid UTF-8 and cap edges: 0 native/WASM mismatches, the same digests in 3 time zones, 34.1 s wall.
- **Caps:** every op's 64 KiB cap at cap-1/cap/cap+1, byte-identical on both.
- **Boot proof:** `scripts/browser-boot.mjs` drives headless Edge over CDP with throwaway profiles. Both web builds boot with 0 CSP violations and the engine hash verified; a positive control is blocked; tampered, blocked and no-WASM engines show the read-only rescue view. 41 checks.
- Edge 157 ignores `--js-flags=--noexpose_wasm`, so the no-WASM tests delete the `WebAssembly` global by CDP and assert it in the page.
- **Measured:** engine 323,458 B, single file 470,365 B; boot median 41–46 ms served; 100 desktop `engine_call` round trips 26.8 ms (release).

### 2. M2a: the phone-first shell (E-05)

The first M2a attempt was interrupted by a session restart; the workflow was resumed with a resume note that kept the uncommitted work after reading it.
- the shell: drawer, bottom sheet / overlay / docked pane, 21 routes, last route restored;
- three token sets with a pre-paint theme script (no flash, proven in Edge) and AA contrast checked per theme;
- i18n infrastructure: the en catalog, plurals for 12 languages, pseudo-locales en-XA and ar-XB, format tables;
- store validators in the engine, hardened DocStore files on the desktop, IndexedDB on the web, with the same read-only and backup outcomes;
- a hashed service worker with an upgrade test online and offline.

E-05: 206 tests, safety-eval 172 (B 29, C 24, D 119), browser-boot 117 (48 phone layout cases), smoke OK.

### 3. M1/M2a review (E-06)

Two independent reviews (spec, correctness, durability and CI; phone UX, accessibility and security) found **20 findings**; 19 were fixed. Among them:
- the desktop backup just written is never pruned, even with the clock set back;
- a newer document is never reset;
- the service worker checks every cached file's SHA-256, so a stale `index.html` fails the install;
- Trusted Types on both web CSPs.

The 20th, one-handed reach on phones, went to the owner. safety-eval 187, browser-boot 145.

### 4. The phone bottom bar (E-07)

Coordinator decision under the owner's phone-first instruction ([brief](workflows/portable-m2b-m2c.md)): below 760 px a bottom bar holds ☰ Menu, a quick switch back to the previous tool, and History. It hides while a keyboard field has focus. safety-eval 201, browser-boot 161 (landscape cases added).

### 5. M2b: the Date tool (E-08, `9e50b52`)

Six cards, clickable calendars, the Business Days pick, Date settings, the countdown list and pane, the card layout and the history hook. The M2b executor ended its run with the work verified but uncommitted; the M2c executor re-ran the full list on the unchanged tree and committed it as its own step. safety-eval 263, browser-boot 204.

### 6. M2c: the Percentage tool (E-09)

- Eight cards with live results and formulas, built from the engine's `*Text` fields as text; percent-core's `<br>` labels are never shown.
- percent-core's two `expect()` calls were replaced with byte-identical output. `check-unsafe.mjs` now refuses panicking calls in every engine.
- safety-eval 314 (29 percent mutants), browser-boot 245.

### 7. M2 review (E-10, `f204e77`)

**12 findings**, all confirmed against the code and fixed:
- countdowns merge by id across tabs;
- engine English in LTR runs inside RTL;
- typed Arabic-Indic digits compute;
- one polite announcement region per tool;
- AA hint and placeholder colours.

safety-eval 364, browser-boot 263. `dev` was pushed through `e97b1a6`, and CI was green (run 44501883562).

---

## Session: November 19th, 2026 - Focus Change, the UX Roadmap, the M3b Design, M3 and the Handoff

---

## Time

Start: November 19th, 2026, with the countdown request and the focus change (Date repo `d188547` and `1f1dc34`, 12:14–12:15)
End: November 19th, 2026, with M3 recorded as done locally (`9f87931`, 17:08)
Commits: Date repo `d188547`, `1f1dc34`, `f0feb2e`; this repo `213aee1` (16:42), `d9afdcf` (16:45), `a0a8152` (17:06), `2d73568`, `9f87931` (17:08)

---

## Session Goal

Fold the owner's new requests into this app, design the next milestones, build M3 (unified history, the owner's top priority) and prepare the handoff to Ahmed Emara's own account.

---

## What We Worked On

### 1. Focus on the Portable Calculator Tool only

The owner asked for countdown notes, New/Duplicate countdowns in a different colour, and "allow for the user to change these automatically selected colors". A Date v1.3.0 plan was written (Date repo `d188547`) and withdrawn a minute later on the owner's word: "stop working on them separately, and focus all of our efforts on the Portable Calculator tool". **DCT is frozen at v1.2.0** (`1f1dc34`) and **PCT is left at v2.3.0**.

### 2. UX roadmap (spec 6)

A read-only design workflow ([brief](workflows/portable-ux-ideation.md)) ran six lenses: phone, structure, history, terminal look, the Daylight and Retro themes, and power users with accessibility. A synthesis and an essence critic followed. The result is [6- UX_ROADMAP.md](specs/6-%20UX_ROADMAP.md). Its brief: "think creatively … without affecting the essence of it and its core iconic design", and "don't forget the two other themes".

### 3. History notes and auto-save: M3b (spec 7)

- **Notes:** a headline plus an expandable note on every history entry and countdown; "the limit can be up to 100k words, or endless in the options".
- **Auto-save:** "make this as an option to auto save by default … or make a button to save history for this calculation", plus a settings toggle.

Designed as milestone M3b in [7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), with retention that never removes pinned, noted or manual entries and long notes in a separate store.

### 4. The handoff (`213aee1`, `d9afdcf`)

- Ahmed clarified: "I'm currently Ahmed talking to you from Mohamed's account, but both of us are partners in CipherVaults, and both of us have authority."
- [HANDOFF.md](../HANDOFF.md), the [Decisions Log](handoff/DECISIONS_LOG.md) and [AI_WORKING_CONTEXT](handoff/AI_WORKING_CONTEXT.md) were written as a layer over the PBS records, together with specs 6 and 7.
- An independent accuracy review found **16 issues**; all were addressed.
- Ahmed confirmed the same PC, so the working tree, the local handoff kit (memory, plans, workflow scripts, skills; kept out of git because it holds private material) and the toolchain carry over.

### 5. M3: unified history (E-11, `a0a8152`, `2d73568`)

Built by the workflow [portable-m3-history](workflows/portable-m3-history.md). An uncommitted Rust half from an earlier M3 run was found, reviewed, kept and verified with the rest.
- **Engine:**
  - strict per-tool history entries (Date and Percentage; the other tools refuse every entry until their milestones);
  - caps: 2,000 unpinned + 200 pinned, 4 MiB;
  - the ops `history.apply`, `history.import_preview` and `history.export_csv`.
- **Writes:** compare-and-save on both surfaces (`saveIf` / `store_save_if`), so two windows never lose an entry.
- **Web:** BroadcastChannel sync and the History panel: search with digit normalisation, filters, groups, Restore, Use result, Pin, Note, Delete with Undo, Clear all keeping pinned.
- **Export and import:** JSON and CSV export (the desktop writes a new file into Downloads without a dialog plugin; the web uses a download plus a clipboard fallback) and an import preview.
- **The iPhone ± key** on signed fields.
- **E-11:** 228 cargo tests; check-wasm 200,000 random requests over 25 ops, 0 mismatches. safety-eval 422 (16 new tests, 42 mutants). browser-boot 283: 2,200 entries under 4x CPU, render 49 ms, search 65 ms, Show more 48 ms. Not pushed that day.

---

## Session: November 20th, 2026 - Handoff Received, the M3 Review and the PBS Records

---

## Time

Start: November 20th, 2026, on Ahmed Emara's own account, with the handoff read and the repository state confirmed
End: November 20th, 2026, with `d7a6712` pushed (18:59), CI run 44779154165 green (completed 17:15:41Z), and this records update written (E-13, uncommitted at writing)
Commits: `43f4f01` (18:58), `b7d50b1` (18:58), `d7a6712` (18:59)

---

## Session Goal

Receive the handoff, review M3 independently and fix what the review finds, push the verified result, and bring the PBS records, the handoff and the architecture and session records up to date.

---

## What We Worked On

### 1. Handoff received

The executor on Ahmed's account read HANDOFF.md, AGENTS.md and the PBS records and confirmed the state in the repository: `dev` at `9f87931`, with M3 committed locally (E-11) and `origin/dev` at `d9afdcf`. It is now the integration owner ([CURRENT_STATE](pbs/CURRENT_STATE.md)).

### 2. M3 review and fixes (E-12, `43f4f01`, `b7d50b1`)

Workflow: [portable-m3-review](workflows/portable-m3-review.md). Two independent reviews (durability and spec; phone, accessibility and security) found **23 findings: 9 major, 14 minor** (ledger E-12). The first fix run was interrupted by a session restart: it left uncommitted edits in 20 files, which were read hunk by hunk, kept and completed.

Data-loss paths closed:
- "Keep pinned" and what Undo puts back were decided from a window's own copy. The engine now decides them at write time on the stored document (`clear {keepPinned}`, `opResults`).
- "Start fresh" could delete a history that reads again after a passing error. The clear now re-checks the document and refuses one that validates as `recovered`.
- A reload that cannot read keeps the last good entries on screen and in Export.
- An operation the engine refuses is dropped alone with a banner, never silently, and never blocking the others.
- A cross-process `docs.lock` around every desktop write.

On a phone: the data actions moved above the list, rows got an Actions button, a sticky 10 s Undo bar was added, focus fixes, and export fallbacks for iOS home-screen apps. Two items were fixed differently (a lock file instead of the single-instance plugin; reused rows instead of virtualisation), four partly, and one was recorded for M3b in spec 7 ("What the M3 review leaves for M3b").

E-12: the full AGENTS.md list, all exit 0, twice:
- 234 cargo tests;
- check-wasm 0 mismatches in 3 time zones;
- browser-boot 293 (a change with 2,200 rows loaded: 431 ms against a 700 ms budget);
- safety-eval 453 (B 223, C 101, D 129; 66 history mutants), run twice;
- smoke `SMOKE_TEST_OK`.

### 3. Push and CI

`dev` was pushed through `d7a6712` (`git ls-remote origin dev` equals `HEAD`). CI run 44779154165 on `d7a6712` completed with all three jobs green (rust-checks, web-build, windows-build), observed with `gh run view`.

### 4. Keep-records rule and the PBS records set (E-13)

The owner asked for the PBS records, the handoff, the architecture and the session summaries to be kept up to date. A PBS v1.1 documentation assessment produced this set:
- [1- PROJECT_CONTEXT.md](1-%20PROJECT_CONTEXT.md) and [2- ARCHITECTURE.md](2-%20ARCHITECTURE.md);
- this Session Summary;
- the security dossier, testing and verification, failure intelligence and acceptance records in [pbs/](pbs/);
- the sanitized [workflow briefs](workflows/README.md);
- refreshed CURRENT_STATE, CONTINUATION_STATE, SOURCE_OWNERSHIP_MAP, ROADMAP, HANDOFF and AGENTS.md.

The rule is now in [AGENTS.md](../AGENTS.md) under "Reporting and stopping".

---

## Key Concepts Learned

### 1. A build can leak who built it

A bare wasm32 `cargo build` writes the cargo-home path, and so the Windows user name, into the engine. One script writes the engine, and every consumer re-scans it for local paths, because a path another command also writes can be overwritten after the check.

### 2. Goldens are not enough for "native = WASM"

The goldens prove known cases. The 200,000-request seeded random diff over every op, with malformed input, invalid UTF-8 and cap edges, compared byte for byte in three time zones, is what shows that two builds of one engine really agree.

### 3. A quiet check needs a positive control

"Zero CSP violations" passed with a browser flag that Edge ignores. A check is trusted only when a planted violation is seen and every safety rule has a mutant that makes it fail.

### 4. Decide at write time, on the stored document

Under compare-and-save, a choice taken from a window's own copy ("keep pinned", what Undo restores) is still a lost update, because the retry re-applies stale ids. Send the intent as an operation and let the engine decide on the stored document, returning what it removed.

### 5. A fake must model the real concurrency

A fake IndexedDB that commits whole snapshots per transaction loses writes no browser loses and hides the real race. Two-writer tests mean something only once the fake serialises readwrite transactions as browsers do.

### 6. Engine text is data, never markup

percent-core's labels contain `<br>`. The UI builds each line from the structured fields and proves parity by joining its lines with the engine's separator, so nothing from the engine is ever rendered as HTML.

### 7. A reported "done" is checked against the tree

A subagent that ends while waiting for a background run may never resume (M2b, E-08). Before building on a milestone, read `git status`, `git log` and file times, then verify and commit what is there as its own step.

---

## Issues / Frictions

- **Git Bash shadows the MSVC linker.** Cargo runs from PowerShell only.
- **PowerShell variable names are case-insensitive.** A loop variable overwrote a verify script's path variable and sent output into a wrong directory.
- **Edge 157 ignores `--js-flags=--noexpose_wasm`** (and four other spellings). The no-WASM tests delete the global by CDP instead (E-04).
- **Session restarts interrupted workflows:** the M0 commit step (E-02), the first M2a attempt, the M2b executor (E-08) and the M3 review's fix step (E-12). Each was resumed from the working tree with a resume note, keeping sound uncommitted work.
- **Escapes typed into tool inputs became raw characters** (U+FEFF, U+2212, no-break and thin spaces, RLO). A scan that builds its character set from code points found them (E-12).
- **Headless Chromium keeps a minimum window width** of about 500 px. Phone widths are checked with device emulation.
- **WebKit and Gecko are not installed** on the build machine. Every browser claim is Chromium (headless Edge) and WebView2 only.
- **The iOS decimal keypad has no minus key.** The ± key (M3) replaces it; its behaviour on a real iPhone is still an owner check.
- **Reviewer findings are not always right.** Every fix step verifies each finding against the code first; about 1 in 10 was wrong or out of scope (HANDOFF §3a).
- **Timing-dependent tests** failed in the M3 review's first safety-eval run. The two-window test now awaits every step and fails on any timeout.
- **The history filter chips still wrap** to a second line at 360 px. A sideways-scrolling row was tried and dropped, because the layout check refuses a chip outside the viewport.

---

## Important Decisions

- The owner approved plan 5 on 2026-11-17: no legacy migration, standing improvement authority, phone-first web app.
- One Rust engine behind `pcalc_api::call`: native on the desktop, WebAssembly on the web, proven byte-identical by `check-wasm.mjs`.
- `main` holds only the workflow-free first commit (`659311e`); the release job arrives in M10.
- **Standing release authority (2026-11-18):** merge and release only work that passed every check and was verified. Enabling Pages, other repository settings and new repositories still need a CipherVaults owner's explicit yes.
- **Focus rule (2026-11-19):** only this app is developed. DCT stays at v1.2.0 and PCT at v2.3.0; their sunset releases are M11.
- Coordinator decisions under the standing authority:
  - the phone bottom bar below 760 px (E-07);
  - IndexedDB for web history;
  - the old engines copied unchanged and only made total where they could panic;
  - the export method: a fixed Downloads path on the desktop with no dialog plugin, and a web download with a clipboard fallback. A CipherVaults owner may override it.
- Every history change is an engine operation applied to the stored document at write time (E-11, E-12).
- Once released, widening a closed value list in a stored struct bumps its `schemaVersion` (AGENTS.md, E-12).
- **Both partners, Mohamed Sayed and Ahmed Emara, have full authority.** From 2026-11-20 the executor on Ahmed's own account owns integration.
- **Keep-records rule (2026-11-20):** see AGENTS.md "Reporting and stopping".

---

## Current State

| Milestone | State |
|---|---|
| M0 scaffold, review fixes, D-slice | done, verified (E-01 to E-03); CI green |
| M1 parity and boot proof | done, verified locally (E-04), Chromium only; WebKit/Gecko are owner checks |
| M2a shell, themes, i18n, stores, service worker | done, verified locally (E-05, E-06), Chromium only |
| Phone bottom bar | done, verified locally (E-07), Chromium only |
| M2b Date tool, M2c Percentage tool | done, verified locally (E-08 to E-10), Chromium only |
| M3 history, export/import, ± key | done, verified locally (E-11), reviewed and fixed (E-12); pushed at `d7a6712`, CI run 44779154165 green |
| PBS records set | written 2026-11-20 (E-13); to be committed and pushed by the integration owner after review |
| M3b notes, auto-save, countdown upgrade | designed (spec 7); next |
| M5a–M10 | not started (skeleton crates only) |
| Release, Pages | none; Pages not enabled (an owner decision, needed at M10) |

Nothing is accepted by an owner yet ([ACCEPTANCE_RECORD](pbs/ACCEPTANCE_RECORD.md)). A pass in a check is not acceptance.

---

## Next Steps

### Owner checks

- Open the app on a real iPhone (Safari/iOS 16.4+) and an Android phone, and in Firefox.
- On an iPhone home-screen app: after a ± tap the field keeps focus, the keypad stays up and the caret stays by the same digit. Export opens the share sheet (or the download works), and Copy export works. The Undo bar at the bottom of the History sheet is reachable with a thumb.
- A screen-reader pass (VoiceOver, TalkBack, NVDA).
- A desktop export into the real Downloads folder, and two desktop processes writing at once.

### Next work

- Commit and push this records set, and confirm CI on that commit.
- M3b per [spec 7](specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), in its build order, with two independent reviews. The owner's requests win over spec 6.
- Then M5a onward per the [ROADMAP](3-%20ROADMAP.md). Before M10, ask a CipherVaults owner to enable GitHub Pages.

### Not run yet

- WebKit (Safari/iOS) and Gecko (Firefox) in any form; real phones; a real screen reader.
- The installers (`tauri build`, M10) and a clean-machine install.
- Desktop multi-window sync (no Mini windows before M5b+).

---

## Session Outcome

The merged app went from a request to a pushed, CI-green M3 in four days. It has one Rust engine proven identical on native and WebAssembly, a phone-first shell with three themes and the i18n base for 12 languages, the Date and Percentage tools ported with parity tests, and a unified history that two windows can write without losing entries. Every milestone was reviewed independently, and every finding was checked before it was fixed. The handoff to Ahmed Emara's own account is received, and the records now say who owns what and what comes next: M3b.

---

## Confidence Level

High for engine correctness and native/WASM parity. Both inherited goldens pass unchanged, and `check-wasm` replays them plus 200,000 random requests over 25 ops with 0 mismatches in three time zones. There are 234 cargo tests, the engines are panic-free (enforced by `check-unsafe`), and CI is green on `d7a6712`.

High for data durability within the tested scope. The read-only, backup, newer, quota, conflict and write-time rules are covered by Rust tests and by 453 safety-eval checks with mutant proofs, including two-writer tests on a fake IndexedDB that serialises transactions.

Medium for the phone experience. All browser evidence is Chromium (headless Edge at 360/390/440 px and in landscape) and WebView2. Safari/iOS, Firefox, real phones and screen readers have not been tried, and the iOS-specific fixes (± focus, share sheet, Undo reach) are unobserved. Nothing has been released or accepted by an owner.
