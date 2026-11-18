# Continuation State — Portable Calculator Tool v1.0.0 build

## Checkpoint identity

- Record type: recoverable working checkpoint (PBS v1.1).
- Goal: build Portable Calculator Tool v1.0.0 per the approved [plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B (milestones in the [Roadmap](../3-%20ROADMAP.md)).
- Recorded at: 2026-11-18 · writer: Claude Code (Opus 5.5) · next integrating owner: the coordinating session or any successor executor.
- Mission state: **M0 implemented and verified** (Ledger E-01, E-02); GitHub CI run 44254904073 green on `482e52d` (all three jobs). The M0 review fixes and the D-slice (E-03) **M1** (E-04: `0398fd0`, `2b9e412`, `f2a60d9`, `84c7ad9`, `fa1f746`, `605147c`) and **M2a** (E-05: `adae5b2`, `db6e554`, `e56f996`, `ac10bdb`, `0673f1b`, `2be8557`, plus the records commit) are committed on local `dev` and verified locally; they reach GitHub when the coordinator pushes `dev`. Remote: `origin` = `CipherVaults/Portable-Calculator-Tool` (public), created on the owner's yes on 2026-11-18; `origin/main` = `659311e` has no workflows.
- Latest authorization: [Current State — Current authority](CURRENT_STATE.md#current-authority).

## Recovery inventory

| ID | Item | Classification | Evidence / notes |
|---|---|---|---|
| R0 | Workflow-free first `main` commit; `dev` branch | implemented-verified | `git ls-tree -r main` has no `.github` entry; all later work on `dev` |
| R1 | Toolchain pin, Cargo workspace, date-core + percent-core copies | implemented-verified | Ledger E-01, E-02; goldens of both engines pass unchanged |
| R2 | Engine skeletons (calc-num, calc-core, units-core, graph-core) | implemented-verified (skeleton) | Real module layout, docs, tests; arithmetic, key machines, converters and graphing are later milestones |
| R3 | `pcalc-api`, `pcalc-wasm`, `pcalc-store` | implemented-verified (engine caps only; store/import caps attach in M3) | Ledger E-01: the 64 KiB engine cap at cap and cap+1, every golden case through the API, check-wasm byte parity in 3 time zones. The 256 KiB, 4.5 MiB and 8 MiB caps exist as constants but have no ops and no cap/cap+1 tests yet. E-03: above the WASM input limit an unknown op is still `unknown_op`, as on native |
| R4 | Tauri shell + `--smoke-test` | implemented-verified | debug `cargo run -- --smoke-test`: exit 0, `SMOKE_TEST_OK` |
| R5 | Web skeleton, build scripts | implemented-verified | `build-web.mjs` deterministic (two builds identical); multi-file and single-file builds boot in Chromium (`data-boot="ok"`, no console errors, no horizontal scroll at 375 px) |
| R6 | CI (`ci.yml` on `dev`) | implemented-verified on `482e52d` | Run 44254904073: rust-checks, web-build and windows-build green. The E-03 additions (safety-eval step, engine leak gate, self-building check-wasm) have not run on GitHub yet |
| R7 | D-slice: `scripts/safety-eval.mjs` slice D (static hygiene with mutant proofs) | implemented-verified locally | E-03: 77 checks pass (clean tree, a mutant for every rule incl. the string-with-// cases, end-to-end refusals by build-web, check-wasm and check-unsafe, and the built dist/); E-04: 78 (+ the random-diff loader mutant). Slices A (check-wasm), B, C and E follow their milestones |
| R8 | M1: 200k seeded random native-vs-WASM diff, per-op cap edges | implemented-verified locally | E-04: seed 20261118, 200,000 requests per time zone over all 18 ops + unknown ops, malformed JSON, invalid UTF-8, cap-1/cap/cap+1; 0 mismatches, same digests in 3 time zones; 34 s wall. Larger caps attach with the store ops in M3 |
| R9 | M1: `scripts/browser-boot.mjs` (headless Edge over CDP) and the read-only rescue view | implemented-verified locally (Chromium only) | E-04: 41 checks pass: served site and file:// single file boot with 0 CSP violations, 0 console errors, engine hash verified, positive control blocked; tampered/blocked/no-WASM show the rescue view. WebKit and Gecko not driven (manual on real devices); the upgrade test is M2a |
| R10 | M1: sizes, boot time, desktop IPC timing | recorded | E-04: engine 323,458 B, single file 470,365 B; boot median 41-46 ms served, 37 ms single; release smoke 100x `engine_call` 26.8 ms total, median 0.3 ms. Graph-payload timing deferred to M8 |
| R11 | M2a: store validators (pcalc-api) and the desktop DocStore (pcalc-store) | implemented-verified locally | E-05: four `*.validate` ops with store caps, frozen key lists; DocStore read-only on any non-NotFound outcome, backups newest 3, save-before-load protection; 206 cargo tests; the random diff covers the validators |
| R12 | M2a: phone-first shell, themes (3 token sets, pre-paint), i18n infrastructure (en catalog, plurals for 12 languages, pseudo-locales, format tables), IndexedDB store, service worker, desktop wiring | implemented-verified locally | E-05: check-i18n, check-web (AA), debug and release smoke; translated catalogs are M9a, theme polish M9b |
| R13 | M2a: browser-boot shell, layout and upgrade tests | implemented-verified locally (Chromium only) | E-05: 117 checks incl. 48 phone layout cases with screenshots, pre-paint without a flash, tab sync, service-worker upgrade online and offline |
| R14 | M2a: safety-eval slices B and C (mini-DOM, fake IndexedDB, both adapters) | implemented-verified locally | E-05: 172 checks, all 16 B/C mutants caught; slice E is M9 |

## Exact next permitted action

1. Coordinator: push `dev` (the E-03 and M1 commits) and confirm CI is green, including the safety-eval step, the 200k random diff in web-build and browser-boot in windows-build (first run of both on GitHub). Enabling Pages stays an owner decision.
2. Owner, when convenient: open the single file and the served site on an iPhone (Safari 16.4+) and in Firefox, the manual WebKit/Gecko half of the M1 CSP spike.
3. Coordinator: push `dev` with the M2a commits and confirm CI (new check-i18n and check-web steps, safety-eval B/C/D, browser-boot with the upgrade test on windows-latest).
4. Owner, when convenient: try the shell on a phone (drawer, bottom sheet, themes) through the single file, or on Pages once enabled; Pages enablement stays an owner decision.
5. Without waiting: M2b (Date port into the shell, with Date safety-eval B/C under both adapters).

## Do not repeat / known pitfalls

- Never run Cargo from Git Bash (its `/usr/bin/link` shadows the MSVC linker). Node and git are fine anywhere.
- `src-tauri` embeds `dist/desktop` at compile time: run `node scripts/build-web.mjs --desktop-only` (or the full build) before any Cargo command that compiles the desktop app on a fresh checkout.
- Build `engine.wasm` with `node scripts/build-wasm.mjs`, not bare `cargo build`: bare builds embed the local cargo-home path (and so the user name) in panic locations and differ between machines. `trim-paths` is not stable on Cargo 1.99.1. `build-web.mjs` now ships only `target/engine/engine.wasm` (written by `build-wasm.mjs`) and refuses any engine with a local path.
- The static rules scan raw text, comments included: do not write a banned name (HTML sinks, inline style writes, the unsafe keyword before a brace/fn/impl/trait/extern) even in a comment.
- percent-core labels for discount, markup, tax and tip contain `<br>` and cross the API unchanged. The UI must never render them as HTML; M2c decides between the `*Text` fields and a split label.
- Keep `core.autocrlf=false`; CSP hashes, the WASM hash and fixtures are byte-exact.
- Edge ignores `--js-flags=--noexpose_wasm`; browser-boot removes the `WebAssembly` global by CDP and asserts `typeof WebAssembly` in the page. Never trust a browser flag without an in-page assertion.
- The mini-DOM (scripts/lib/mini-dom.mjs) deliberately ignores `inert` and models no layout; layout, tap targets and real focus belong to browser-boot.
- Keep every new UI string in `web/i18n/en.json` and use it: check-i18n fails on unused keys and on calls to missing ones. A new theme token goes into all three theme blocks (check-web).
- `date-core` and `percent-core` are copies: engine behaviour changes need regenerated goldens (date-core) or new hand-checked goldens (percent-core), never edits to make tests pass.
