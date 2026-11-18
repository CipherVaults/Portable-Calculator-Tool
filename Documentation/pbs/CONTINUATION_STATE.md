# Continuation State — Portable Calculator Tool v1.0.0 build

## Checkpoint identity

- Record type: recoverable working checkpoint (PBS v1.1).
- Goal: build Portable Calculator Tool v1.0.0 per the approved [plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B (milestones in the [Roadmap](../3-%20ROADMAP.md)).
- Recorded at: 2026-11-18 · writer: Claude Code (Opus 5.5) · next integrating owner: the coordinating session or any successor executor.
- Mission state: **M0 implemented and verified** (Ledger E-01, E-02); GitHub CI run 44254904073 green on `482e52d` (all three jobs). The M0 review fixes and the D-slice are committed on local `dev` after it (E-03, verified locally); they reach GitHub when the coordinator pushes `dev`. Remote: `origin` = `CipherVaults/Portable-Calculator-Tool` (public), created on the owner's yes on 2026-11-18; `origin/main` = `659311e` has no workflows.
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
| R7 | D-slice: `scripts/safety-eval.mjs` slice D (static hygiene with mutant proofs) | implemented-verified locally | E-03: 77 checks pass (clean tree, a mutant for every rule incl. the string-with-// cases, end-to-end refusals by build-web, check-wasm and check-unsafe, and the built dist/). Slices A (check-wasm), B, C and E follow their milestones |

## Exact next permitted action

1. Coordinator: push `dev` (the E-03 commit) and confirm CI is green, including the new safety-eval step. Enabling Pages stays an owner decision.
2. Without waiting on that: M1 locally (CSP data-block spike in WebKit, Gecko and WebView2; 200k seeded random native-vs-WASM diff; desktop IPC timing for graph payloads), then M2a.

## Do not repeat / known pitfalls

- Never run Cargo from Git Bash (its `/usr/bin/link` shadows the MSVC linker). Node and git are fine anywhere.
- `src-tauri` embeds `dist/desktop` at compile time: run `node scripts/build-web.mjs --desktop-only` (or the full build) before any Cargo command that compiles the desktop app on a fresh checkout.
- Build `engine.wasm` with `node scripts/build-wasm.mjs`, not bare `cargo build`: bare builds embed the local cargo-home path (and so the user name) in panic locations and differ between machines. `trim-paths` is not stable on Cargo 1.99.1. `build-web.mjs` now ships only `target/engine/engine.wasm` (written by `build-wasm.mjs`) and refuses any engine with a local path.
- The static rules scan raw text, comments included: do not write a banned name (HTML sinks, inline style writes, the unsafe keyword before a brace/fn/impl/trait/extern) even in a comment.
- percent-core labels for discount, markup, tax and tip contain `<br>` and cross the API unchanged. The UI must never render them as HTML; M2c decides between the `*Text` fields and a split label.
- Keep `core.autocrlf=false`; CSP hashes, the WASM hash and fixtures are byte-exact.
- `date-core` and `percent-core` are copies: engine behaviour changes need regenerated goldens (date-core) or new hand-checked goldens (percent-core), never edits to make tests pass.
