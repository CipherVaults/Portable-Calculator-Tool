# Source & Ownership Map — Portable Calculator Tool

## Purpose

Find the authoritative answer to each project question without confusing permission, implementation, verification, acceptance and history.

**Maintaining owner:** coordinating maintainer; the project owner decides adoption and acceptance.
**Project entry:** [AGENTS.md](../../AGENTS.md).
**Authority boundary:** see [Current State — Current authority](CURRENT_STATE.md#current-authority).

## Canonical owners

| Question / information | Canonical source | Update trigger |
|---|---|---|
| Execution rules and onboarding | [AGENTS.md](../../AGENTS.md) | Durable convention, boundary or check change |
| Approved design | [specs/5- PORTABLE_CALCULATOR_PLAN.md](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B; the owner clarifications at its top override its body. Copied from `CipherVaults/Date-Calculator-Tool` (`Documentation/specs/`, commit `be06e59`), where it was approved | Owner-approved amendment only |
| Milestones and backlog | [3- ROADMAP.md](../3-%20ROADMAP.md) | Milestone closed or backlog decision |
| Accepted present + authority pointer | [CURRENT_STATE.md](CURRENT_STATE.md) | Acceptance or authority change |
| Unfinished work, exact next action | [CONTINUATION_STATE.md](CONTINUATION_STATE.md) | Meaningful checkpoint |
| Execution evidence, coding lessons | [EXECUTION_AND_CODING_LEDGER.md](EXECUTION_AND_CODING_LEDGER.md) | Meaningful check or lesson |
| Date math | `crates/date-core/**` (copied from Date-Calculator-Tool `be06e59`, engine 1.0.0); hand-verified `tests/fixtures/vectors.json` (never regenerated); regression lock `tests/fixtures/golden.json` (`examples/gen_golden.rs`) | Intentional engine change (+ golden regeneration) |
| Percentage math | `crates/percent-core/**` (copied from Percentage-Calculator-Tool tag `v2.3.0`, commit `6edbfff`); `tests/fixtures/golden.json` is the v1.1 JavaScript oracle (never regenerated) | Intentional engine change |
| Decimal, calculator, units, graph engines | `crates/{calc-num,calc-core,units-core,graph-core}` (M0 skeletons) | Their milestones (M5a–M8) |
| The engine API (ops, envelope, caps) | `crates/pcalc-api` (`call`, `Op`, `CAP_*`); evidence `tests/golden_replay.rs`, `scripts/check-wasm.mjs` | Any op or contract change (bump `API_VERSION` when incompatible) |
| WASM ABI | `crates/pcalc-wasm` (exports `pc_abi`, `pc_in`, `pc_call`, `pc_out`) and its loader `web/src/core/engine-web.js` | ABI change on both sides together |
| Native storage and update check | `crates/pcalc-store` (`fs`, `update`) | Storage or update-check change |
| Desktop app | `src-tauri/**` (`engine_call`, smoke test, `tauri.conf.json` CSP and identity, `capabilities/default.json`) | Authorized native change |
| Web front end | `web/**` (`build-manifest.json` order, `src/core`, `src/platform`, `styles/tokens.css`, `i18n/*.json`) | Authorized UI change |
| Build and checks | `scripts/build-wasm.mjs` (sole writer of `target/engine/engine.wasm`), `build-web.mjs`, `check-wasm.mjs`, `check-versions.mjs`, `check-unsafe.mjs`, `safety-eval.mjs` (slice D), `serve-web.mjs`; shared rules `scripts/lib/{local-paths,web-hygiene,rust-hygiene}.mjs`; CI `.github/workflows/ci.yml` (on `dev` only) | Toolchain, check or CI change |
| App version locations | `node scripts/check-versions.mjs` lists them all | Version bump |

## Conflict rules

1. The owner's latest explicit instruction wins, then the owner clarifications at the top of the plan, then the plan body.
2. Source code and fixtures win over descriptive docs for *what the code does*; docs are corrected, not the other way round, unless the owner decides otherwise.
