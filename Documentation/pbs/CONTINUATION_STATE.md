# Continuation State — Portable Calculator Tool v1.0.0 build

## Checkpoint identity

- Record type: recoverable working checkpoint (PBS v1.1).
- Goal: build Portable Calculator Tool v1.0.0 per the approved [plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B (milestones in the [Roadmap](../3-%20ROADMAP.md)).
- Recorded at: 2026-11-20, 19:15 (UTC+2) · writer: the executor on Ahmed Emara's account (Claude Code, Opus 5.5) · next integrating owner: the same executor, the integration owner since the handoff was received on 2026-11-20 ([CURRENT_STATE](CURRENT_STATE.md)).
- Mission state: **active**.
  - **M0 to M3 and the M3 review fixes are implemented, verified locally and pushed:** `dev` = `origin/dev` = `d7a6712` (checked with `git ls-remote origin dev`).
  - CI run 44779154165 on `d7a6712`: rust-checks, web-build and windows-build all green (observed with `gh run view`; completed 2026-11-20T17:15:41Z).
  - Evidence: Ledger E-01 to E-12. The PBS records set (E-13) is written 2026-11-20 in the working tree; to be committed and pushed by the integration owner after review.
  - Remote: `origin` = `CipherVaults/Portable-Calculator-Tool` (public), created on the owner's yes on 2026-11-18. `origin/main` = `659311e` has no workflows.
- Latest authorization: [Current State — Current authority](CURRENT_STATE.md#current-authority).
- Accepted baseline: none ([ACCEPTANCE_RECORD](ACCEPTANCE_RECORD.md)).

## Recovery inventory

| ID | Item | Classification | Evidence / notes |
|---|---|---|---|
| R0 | Workflow-free first `main` commit; `dev` branch | implemented-verified | `git ls-tree -r main` has no `.github` entry; all later work on `dev` |
| R1 | Toolchain pin, Cargo workspace, date-core + percent-core copies | implemented-verified | Ledger E-01, E-02; goldens of both engines pass unchanged |
| R2 | Engine skeletons (calc-num, calc-core, units-core, graph-core) | implemented-verified (skeleton) | Real module layout, docs, tests; arithmetic, key machines, converters and graphing are later milestones |
| R3 | `pcalc-api`, `pcalc-wasm`, `pcalc-store` | implemented-verified | Ledger E-01: the 64 KiB engine cap at cap and cap+1, every golden case through the API, check-wasm byte parity in 3 time zones. E-03: above the WASM input limit an unknown op is still `unknown_op`, as on native. The store and import caps attached with their ops in M2a and M3 (E-05, E-11) |
| R4 | Tauri shell + `--smoke-test` | implemented-verified | debug `cargo run -- --smoke-test`: exit 0, `SMOKE_TEST_OK` |
| R5 | Web skeleton, build scripts | implemented-verified | `build-web.mjs` deterministic (two builds identical); multi-file and single-file builds boot in Chromium (`data-boot="ok"`, no console errors, no horizontal scroll at 375 px) |
| R6 | CI (`ci.yml` on `dev`) | implemented-verified on `d7a6712` | Run 44254904073 green on `482e52d`; run 44501883562 green on `e97b1a6`; run 44779154165 green on `d7a6712` (rust-checks, web-build with the 200k random diff, windows-build with browser-boot and the smoke test) |
| R7 | D-slice: `scripts/safety-eval.mjs` slice D (static hygiene with mutant proofs) | implemented-verified | E-03: 77 checks pass (clean tree, a mutant for every rule incl. the string-with-// cases, end-to-end refusals by build-web, check-wasm and check-unsafe, and the built dist/); E-04: 78 (+ the random-diff loader mutant); D 129 since E-10. Slices A (check-wasm), B, C follow their milestones; slice E is M9 |
| R8 | M1: 200k seeded random native-vs-WASM diff, per-op cap edges | implemented-verified | E-04: seed 20261118, 200,000 requests per time zone over all 18 ops + unknown ops, malformed JSON, invalid UTF-8, cap-1/cap/cap+1; 0 mismatches, same digests in 3 time zones; 34 s wall. 25 ops since E-11 |
| R9 | M1: `scripts/browser-boot.mjs` (headless Edge over CDP) and the read-only rescue view | implemented-verified (Chromium only) | E-04: 41 checks pass: served site and file:// single file boot with 0 CSP violations, 0 console errors, engine hash verified, positive control blocked; tampered/blocked/no-WASM show the rescue view. WebKit and Gecko not driven (manual on real devices) |
| R10 | M1: sizes, boot time, desktop IPC timing | recorded | E-04: engine 323,458 B, single file 470,365 B; boot median 41-46 ms served, 37 ms single; release smoke 100x `engine_call` 26.8 ms total, median 0.3 ms. Graph-payload timing deferred to M8. At E-12: engine 452,648 B, single file 1,067,036 B |
| R11 | M2a: store validators (pcalc-api) and the desktop DocStore (pcalc-store) | implemented-verified | E-05: four `*.validate` ops with store caps, frozen key lists; DocStore read-only on any non-NotFound outcome, backups newest 3, save-before-load protection; 206 cargo tests; the random diff covers the validators |
| R12 | M2a: phone-first shell, themes (3 token sets, pre-paint), i18n infrastructure (en catalog, plurals for 12 languages, pseudo-locales, format tables), IndexedDB store, service worker, desktop wiring | implemented-verified | E-05: check-i18n, check-web (AA), debug and release smoke; translated catalogs are M9a, theme polish M9b |
| R13 | M2a: browser-boot shell, layout and upgrade tests | implemented-verified (Chromium only) | E-05: 117 checks incl. 48 phone layout cases with screenshots, pre-paint without a flash, tab sync, service-worker upgrade online and offline |
| R14 | M2a: safety-eval slices B and C (mini-DOM, fake IndexedDB, both adapters) | implemented-verified | E-05: 172 checks, all 16 B/C mutants caught; slice E is M9 |
| R15 | M1/M2a review fixes (20 findings) | implemented-verified (19 fixed); 1 resolved in E-07 | E-06: desktop backups survive a clock set back and a newer document is never reset (both stores); the service worker verifies every cached file's SHA-256 (stale index.html fails the install); select focus, Safari opener, modal footer/scroll lock, 1100 px crossing, shortcut guard, Retro selected focus ring, no wrapped values or mid-word breaks, two-line titles, safe areas, Trusted Types (web builds). 209 tests, safety-eval 187, browser-boot 145. Open: desktop Trusted Types (needs a smoke check that watches violations) |
| R16 | Phone one-handed reach: bottom bar below 760 px | implemented-verified (Chromium only) | E-07: ☰ Menu, a quick switch back to the previous tool and History in a bottom bar (44 px, safe areas, hidden while a keyboard field has focus); top bar = title; drawer and sheet open from the bar; a phone turned to landscape keeps an open modal and focus; 760 px and up unchanged. safety-eval 201, browser-boot 161. Not covered: real phones, WebKit/Gecko, safe-area insets, a keyboard dismissed without blur |
| R17 | M2b: the Date tool in the shell | implemented-verified (Chromium only) | E-08: six cards, calendars, Business Days pick, Date settings, countdown list and pane, card layout, history hook; safety-eval 263, browser-boot 204, smoke with the Date tool live. Committed by the M2c executor after the M2b executor stopped without committing |
| R18 | M2c: the Percentage tool in the shell; percent-core total | implemented-verified (Chromium only) | E-09: eight cards with live results and formulas, swap, tax mode, tip presets and people, paste cleaning, layout and Reset, history hook; results are text built from the engine's `*Text` fields; percent-core's two `expect()` calls gone with byte-identical output and check-unsafe refuses panicking calls in engines; safety-eval 314, browser-boot 245. Open: engine English text (M9a); new markup/tax/tip goldens need an independent oracle |
| R19 | M2 review fixes (12 findings) | implemented-verified (Chromium only) | E-10: countdowns merge by id on every write, labels by code points, pane Open reveals the card, engine English in LTR runs and LTR number fields, Percentage text fields take typed Arabic-Indic digits, one polite region per tool, calendar arrows mirrored once, AA tool hint and placeholders, v1.2.0 Date wording, Clear all on a phone. safety-eval 364, browser-boot 263. Open: Percentage engine numbers in Arabic-Indic digits (M9a); real phones and a screen reader |
| R20 | M3 (E-11): history store, panel, export/import, ± key | implemented-verified (Chromium only); pushed; CI green on `d7a6712` | `a0a8152` (engine: strict per-tool entries, `history.apply` / `import_preview` / `export_csv`, desktop `save_if` and `export_file`), `2d73568` (web history store with compare-and-save and BroadcastChannel sync, History panel, export/import, Settings > History, the ± key, tests), records `9f87931`. cargo 228, safety-eval 422, browser-boot 283 (2,200 entries: render 49 ms, search 65 ms, Show more 48 ms under 4x CPU), smoke OK. Open: real phones and WebKit/Gecko, a screen reader, desktop multi-window sync (M5b+), Ctrl+F |
| R21 | M3 review and fixes (E-12, 23 findings: 9 major, 14 minor) | implemented-verified (Chromium only); pushed; CI green on `d7a6712` | `43f4f01` (engine `clear {keepPinned}` at write time, `opResults`, per-op pinned-cap refusal, near-duplicates, hidden bidi characters refused, `recovered` clear, cross-process `docs.lock`), `b7d50b1` (web: no silent drops, the last good view kept on a failed read, own-click recording, data actions above the list, row Actions, row reuse, a sticky 10 s Undo, focus fixes, export fallbacks, ± caret), records `d7a6712`. cargo 234, safety-eval 453 (run twice), browser-boot 293 (a change with 2,200 rows loaded 431 ms, a record 412 ms at 4x CPU). Open, for M3b (spec 7 "What the M3 review leaves for M3b"): an `update` operation, undo across the history and notes stores, write cost off the main thread before auto-save, a canonical result value, the single-instance plugin; manual: iOS ± focus, share sheet, Undo reach |
| R22 | PBS records set (E-13): `1-`, `2-`, `4-`, four new PBS records, `Documentation/workflows/`, refreshed state records, AGENTS.md keep-records rule, HANDOFF received | written, unreviewed | Docs only, in the working tree at writing. An accuracy, privacy and link review follows in the same workflow; the integration owner commits and pushes. No code check applies |

## Exact next permitted action

**Current order (2026-11-20):**
- **A.** ~~Push `dev` with M3 (E-11) and its review (E-12) and confirm CI.~~ **Done:** `d7a6712` pushed, CI run 44779154165 green on all three jobs.
- **A3.** Commit the PBS records set (E-13) after its review, push `dev`, check `git ls-remote origin dev` against `HEAD`, and confirm CI on that commit (docs only; CI still runs on every `dev` push).
- **B.** **M3b** per [7-](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), in its build order and including its section "What the M3 review leaves for M3b", with two independent reviews ([workflow briefs](../workflows/README.md)). The owner's requests win over [6-](../specs/6-%20UX_ROADMAP.md) where they differ. Nothing is released, so history schema v1 can still be amended without an upgrade path.
- **C.** **M5a onward** per the ROADMAP. Close each milestone with the full AGENTS.md list, a ledger entry, the record updates under the keep-records rule and a pushed commit. Ask a CipherVaults owner to enable Pages before M10.
- **Owner, when convenient:** the manual checks in [ACCEPTANCE_RECORD](ACCEPTANCE_RECORD.md). On an iPhone: the ± key keeps focus, the keypad and the caret; Export (share sheet or download), Copy export and Import from the History pane; the Undo bar at the bottom of the sheet is in thumb reach. Plus Firefox, an Android phone and a screen reader.

**History.** At the handoff (2026-11-19) the order was:
- **A.** Recover and finish M3. Done locally on 2026-11-19 (E-11: `a0a8152`, `2d73568`, `9f87931`). The export method stays as decided (a fixed Downloads path with no plugin; a web Blob download plus clipboard); a CipherVaults owner may override it.
- **A2.** Review M3 and fix the findings. Done locally on 2026-11-20 (E-12: `43f4f01`, `b7d50b1`, `d7a6712`), with the full AGENTS.md list green and safety-eval run twice.
- **B.** M3b; **C.** M5a onward.

The numbered list below is the earlier sequence (2026-11-18/19):

1. Coordinator: push `dev` (the E-03 and M1 commits) and confirm CI is green, including the safety-eval step, the 200k random diff in web-build and browser-boot in windows-build (first run of both on GitHub). Enabling Pages stays an owner decision.
2. Owner, when convenient: open the single file and the served site on an iPhone (Safari 16.4+) and in Firefox, the manual WebKit/Gecko half of the M1 CSP spike.
3. Coordinator: push `dev` with the M2a commits and confirm CI (new check-i18n and check-web steps, safety-eval B/C/D, browser-boot with the upgrade test on windows-latest).
4. Owner, when convenient: try the shell on a phone (drawer, bottom sheet, themes) through the single file, or on Pages once enabled; Pages enablement stays an owner decision.
5. Coordinator: push `dev` with the E-06 review-fix and E-07 bottom-bar commits and confirm CI (browser-boot now has the stale-index upgrade case and the Trusted Types controls).
6. ~~Owner decision before M5b: phone one-handed reach.~~ Resolved in E-07 (coordinator decision under the owner's phone-first instruction): a bottom bar below 760 px. Owner, when convenient: try it on a phone.
7. ~~Without waiting: M2b (Date port into the shell, with Date safety-eval B/C under both adapters).~~ Done (E-08), and M2c (E-09).
8. Coordinator: push `dev` with the M2b and M2c commits and confirm CI (safety-eval now runs the percent suites; browser-boot the percent group; check-unsafe the engine panic rule).
9. Owner, when convenient: try #/date and #/percent on a phone.
10. Coordinator: push `dev` with the E-10 commits and confirm CI (browser-boot gains two-tab, ar-XB and contrast checks; safety-eval 364).
11. Owner, when convenient: on an iPhone, type a negative value in a Percentage field (since E-10 the decimal keypad has no minus key; the ± key arrived in M3) and tap Clear all (the keyboard should stay down).
12. ~~Without waiting: M3 (history store, settings/state/countdowns export and import; history restore for Date and Percentage).~~ Done (E-11, E-12). Optional hardening still open: Trusted Types in the desktop CSP once the smoke test reports CSP and Trusted Types violations from the WebView2 page.

Items 1, 3, 5, 8 and 10 are done: every commit through `d7a6712` is on GitHub with CI green.

## Do not repeat / known pitfalls

- Never run Cargo from Git Bash (its `/usr/bin/link` shadows the MSVC linker). Node and git are fine anywhere.
- `src-tauri` embeds `dist/desktop` at compile time: run `node scripts/build-web.mjs --desktop-only` (or the full build) before any Cargo command that compiles the desktop app on a fresh checkout.
- Build `engine.wasm` with `node scripts/build-wasm.mjs`, not a bare `cargo build`: bare builds embed the local cargo-home path (and so the user name) in panic locations and differ between machines. `trim-paths` is not stable on Cargo 1.99.1. `build-web.mjs` ships only `target/engine/engine.wasm` (written by `build-wasm.mjs`) and refuses any engine with a local path.
- The static rules scan raw text, comments included: do not write a banned name (HTML sinks, inline style writes, the unsafe keyword before a brace/fn/impl/trait/extern) even in a comment.
- percent-core labels for discount, markup, tax and tip contain `<br>` and cross the API unchanged. The Percentage tool never shows them for those cards (it builds lines from the `*Text` fields as text); keep it that way, and never render any engine text as HTML (safety-eval B.percent-no-markup).
- Engine code may not call `unwrap()`, `expect(…)`, `panic!`, `unreachable!`, `todo!` or `unimplemented!` above `#[cfg(test)]`; check-unsafe refuses it (raw-text scan, comments included).
- Keep `core.autocrlf=false`; CSP hashes, the WASM hash and fixtures are byte-exact.
- Edge ignores `--js-flags=--noexpose_wasm`; browser-boot removes the `WebAssembly` global by CDP and asserts `typeof WebAssembly` in the page. Never trust a browser flag without an in-page assertion.
- The mini-DOM (scripts/lib/mini-dom.mjs) deliberately ignores `inert` and models no layout; layout, tap targets and real focus belong to browser-boot.
- Keep every new UI string in `web/i18n/en.json` and use it: check-i18n fails on unused keys and on calls to missing ones. A new theme token goes into all three theme blocks (check-web).
- `date-core` and `percent-core` are copies: engine behaviour changes need regenerated goldens (date-core) or new hand-checked goldens (percent-core), never edits to make tests pass.
- With Trusted Types on the web CSPs, a new script-URL or HTML sink fails at runtime: route any new service-worker or script URL through the one `pcalc` policy in boot.js (it allows only `sw.js`); the single file allows no policy at all.
- sw.js caches only bytes whose SHA-256 matches the build (`BUILD.sha256`): any file added to the cached list must be in build-info with its hash.
- A history choice that depends on the stored state ("keep pinned", what Undo puts back) is decided by the engine at write time, never from a window's own copy (E-12). New operations (M3b's `update`) follow the same rule.
- Do not re-run the M3 review: its findings and outcomes are in E-12, and what remains is in spec 7. Do not re-create the PBS records set of E-13 from scratch; update it.
