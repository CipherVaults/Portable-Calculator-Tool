# Continuation State — Portable Calculator Tool v1.0.0 build

## Checkpoint identity

- Record type: recoverable working checkpoint (PBS v1.1).
- Goal: build Portable Calculator Tool v1.0.0 per the approved [plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B (milestones in the [Roadmap](../3-%20ROADMAP.md)).
- Recorded at: 2026-11-18 · writer: Claude Code (Opus 5.5) · next integrating owner: the coordinating session or any successor executor.
- Mission state: **M0 local work implemented, verified and committed on `dev`** (Ledger E-01, re-verified in E-02). The repository exists only locally; nothing is pushed.
- Latest authorization: [Current State — Current authority](CURRENT_STATE.md#current-authority).

## Recovery inventory

| ID | Item | Classification | Evidence / notes |
|---|---|---|---|
| R0 | Workflow-free first `main` commit; `dev` branch | implemented-verified | `git ls-tree -r main` has no `.github` entry; all later work on `dev` |
| R1 | Toolchain pin, Cargo workspace, date-core + percent-core copies | implemented-verified | Ledger E-01, E-02; goldens of both engines pass unchanged |
| R2 | Engine skeletons (calc-num, calc-core, units-core, graph-core) | implemented-verified (skeleton) | Real module layout, docs, tests; arithmetic, key machines, converters and graphing are later milestones |
| R3 | `pcalc-api`, `pcalc-wasm`, `pcalc-store` | implemented-verified | Ledger E-01: caps at cap and cap+1, every golden case through the API, check-wasm byte parity in 3 time zones |
| R4 | Tauri shell + `--smoke-test` | implemented-verified | debug `cargo run -- --smoke-test`: exit 0, `SMOKE_TEST_OK` |
| R5 | Web skeleton, build scripts | implemented-verified | `build-web.mjs` deterministic (two builds identical); multi-file and single-file builds boot in Chromium (`data-boot="ok"`, no console errors, no horizontal scroll at 375 px) |
| R6 | CI (`ci.yml` on `dev`) | implemented-unverified | Never run on GitHub (no repository yet) |

## Exact next permitted action

1. **Owner decision:** create the public repository `CipherVaults/Portable-Calculator-Tool`, push `main` (workflow-free) and then `dev`, and later enable Pages. Until then nothing is published and CI has not run.
2. Without waiting on that: M1 locally (CSP data-block spike in WebKit, Gecko and WebView2; 200k seeded random native-vs-WASM diff; desktop IPC timing for graph payloads), then M2a.

## Do not repeat / known pitfalls

- Never run Cargo from Git Bash (its `/usr/bin/link` shadows the MSVC linker). Node and git are fine anywhere.
- `src-tauri` embeds `dist/desktop` at compile time: run `node scripts/build-web.mjs --desktop-only` (or the full build) before any Cargo command that compiles the desktop app on a fresh checkout.
- Build `engine.wasm` with `node scripts/build-wasm.mjs`, not bare `cargo build`: bare builds embed the local cargo-home path (and so the user name) in panic locations and differ between machines. `trim-paths` is not stable on Cargo 1.99.1.
- Keep `core.autocrlf=false`; CSP hashes, the WASM hash and fixtures are byte-exact.
- `date-core` and `percent-core` are copies: engine behaviour changes need regenerated goldens (date-core) or new hand-checked goldens (percent-core), never edits to make tests pass.
