# Source & Ownership Map — Portable Calculator Tool

## Purpose

Find the authoritative answer to each project question without confusing permission, implementation, verification, acceptance and history.

**Maintaining owner:** the integration owner (since 2026-11-20 the executor on Ahmed Emara's account, [CURRENT_STATE](CURRENT_STATE.md)); the project owners, CipherVaults partners Mohamed Sayed and Ahmed Emara, decide adoption and acceptance.
**Last verified:** 2026-11-20 (UTC+2), against the repository on `d7a6712` plus the PBS records set of Ledger E-13.
**Project entry:** [AGENTS.md](../../AGENTS.md). Alternate entry for a new executor: [HANDOFF.md](../../HANDOFF.md), which points back here.
**Authority boundary:** see [Current State — Current authority](CURRENT_STATE.md#current-authority).

## Canonical owners

| Question / information | Canonical source | Update trigger |
|---|---|---|
| Execution rules and onboarding | [AGENTS.md](../../AGENTS.md) | Durable convention, boundary or check change |
| Project identity, scope, people | [1- PROJECT_CONTEXT.md](../1-%20PROJECT_CONTEXT.md) | Accepted scope or ownership change |
| Structure: crates, API, web shell, tools, desktop, scripts, CI, toolchain and version inventory | [2- ARCHITECTURE.md](../2-%20ARCHITECTURE.md) | Structural change (new crate, op family, store, tool, script or CI job) |
| Approved design | [specs/5- PORTABLE_CALCULATOR_PLAN.md](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), Part B; the owner clarifications at its top override its body. Copied from `CipherVaults/Date-Calculator-Tool` (`Documentation/specs/`, commit `be06e59`), where it was approved | Owner-approved amendment only |
| Milestones and backlog | [3- ROADMAP.md](../3-%20ROADMAP.md) | Milestone closed or backlog decision |
| Session chronology (reasoning and history) | [4- SESSION_SUMMARY.md](../4-%20SESSION_SUMMARY.md) | Substantive session |
| Handoff entry (an orientation layer over these PBS records; the records win on conflict) | [HANDOFF.md](../../HANDOFF.md) | Change of executor, account or working method; milestone or checkpoint (§2, §3, §3a) |
| Working methodology (PBS use, Git & GitHub rhythm, workflows, gates, environment) | [handoff/AI_WORKING_CONTEXT.md](../handoff/AI_WORKING_CONTEXT.md) | Change of working method |
| Decision record: owner decisions with quotes (history, not authority) | [handoff/DECISIONS_LOG.md](../handoff/DECISIONS_LOG.md) | New owner decision |
| Workflow briefs (sanitized, reusable) | [workflows/](../workflows/README.md) | A new workflow used for this repository |
| UX/UI/structure roadmap | [specs/6- UX_ROADMAP.md](../specs/6-%20UX_ROADMAP.md) (design workflow output, 2026-11-19) | Adopted change to the roadmap |
| M3b design (notes, auto-save history, countdown upgrade + roadmap items) | [specs/7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md) | Owner request or design change |
| Accepted present + authority pointer | [CURRENT_STATE.md](CURRENT_STATE.md) | Acceptance or authority change |
| Acceptance criteria, acceptance decisions, owner checks outstanding | [ACCEPTANCE_RECORD.md](ACCEPTANCE_RECORD.md) | Acceptance decision or owner check done |
| Unfinished work, exact next action | [CONTINUATION_STATE.md](CONTINUATION_STATE.md) | Meaningful checkpoint |
| Execution evidence, coding lessons, spec deviations | [EXECUTION_AND_CODING_LEDGER.md](EXECUTION_AND_CODING_LEDGER.md) | Meaningful check or lesson |
| The verification system (what each check proves, coverage, budgets) | [TESTING_AND_VERIFICATION.md](TESTING_AND_VERIFICATION.md) | New or changed check, budget or CI job |
| Security controls and evidence | [SECURITY_HARDENING_DOSSIER.md](SECURITY_HARDENING_DOSSIER.md) | Security finding, mitigation or verification |
| Incidents, near-misses and their prevention | [FAILURE_INTELLIGENCE.md](FAILURE_INTELLIGENCE.md) | A real failure or near-miss |
| Date math | `crates/date-core/**` (copied from Date-Calculator-Tool `be06e59`, engine 1.0.0); hand-verified `tests/fixtures/vectors.json` (never regenerated); regression lock `tests/fixtures/golden.json` (`examples/gen_golden.rs`) | Intentional engine change (+ golden regeneration) |
| Percentage math | `crates/percent-core/**` (copied from Percentage-Calculator-Tool tag `v2.3.0`, commit `6edbfff`; made panic-free with byte-identical output in E-09); `tests/fixtures/golden.json` is the v1.1 JavaScript oracle (never regenerated) | Intentional engine change |
| Decimal, calculator, units, graph engines | `crates/{calc-num,calc-core,units-core,graph-core}` (M0 skeletons) | Their milestones (M5a–M8) |
| The engine API (ops, envelope, caps, store validators, history operations) | `crates/pcalc-api` (`call`, `Op`, `CAP_*`, `store.rs`, `history.rs`); evidence `tests/golden_replay.rs`, `scripts/check-wasm.mjs` | Any op or contract change (bump `API_VERSION` when incompatible) |
| WASM ABI | `crates/pcalc-wasm` (exports `pc_abi`, `pc_in`, `pc_call`, `pc_out`) and its loader `web/src/core/engine-web.js` | ABI change on both sides together |
| Native storage, export and update check | `crates/pcalc-store` (`fs`, `docs` incl. `save_if` and `docs.lock`, `export`, `update`) | Storage, export or update-check change |
| Desktop app | `src-tauri/**` (`engine_call`, store and export commands, smoke test, `tauri.conf.json` CSP and identity, `capabilities/default.json`) | Authorized native change |
| Web front end | `web/**` (`build-manifest.json` order, `src/core`, `src/platform`, `src/shell`, `src/tools`, `src/history`, `styles/tokens.css`, `i18n/*.json`) | Authorized UI change |
| Build and checks | `scripts/build-wasm.mjs` (sole writer of `target/engine/engine.wasm`), `build-web.mjs`, `check-wasm.mjs`, `check-i18n.mjs`, `check-web.mjs`, `browser-boot.mjs`, `check-versions.mjs`, `check-unsafe.mjs`, `safety-eval.mjs`, `serve-web.mjs`; shared rules `scripts/lib/{local-paths,web-hygiene,rust-hygiene}.mjs`; CI `.github/workflows/ci.yml` (on `dev` only) | Toolchain, check or CI change |
| App version locations | `node scripts/check-versions.mjs` lists them all | Version bump |
| Private per-device state | Listed in [AGENTS.md — Permission checks](../../AGENTS.md#permission-checks) | New store or backup name |
| Release notes and change history (planned) | `CHANGELOG.md` and `.github/release-notes-v<version>.md`, created at M10 | First release |
| Technical reference: op list, schemas, error codes (planned) | `Documentation/TECHNICAL_REFERENCE.md`, planned once the op surface settles after M3b; until then `crates/pcalc-api` and 2- ARCHITECTURE | Owner or integration-owner decision to create it |

## Conflict rules

1. The owner's latest explicit instruction wins, then the owner clarifications at the top of the plan, then the plan body. Later owner requests (specs 6 and 7) extend the plan; where spec 6 and spec 7 differ, spec 7's owner requests win.
2. Source code and fixtures win over descriptive docs for *what the code does*; docs are corrected, not the other way round, unless the owner decides otherwise.
3. For *what is accepted*, only an owner decision in ACCEPTANCE_RECORD counts; a ledger pass is evidence, not acceptance.
4. HANDOFF.md, the Session Summary and the workflow briefs are orientation and history. On any disagreement, CURRENT_STATE, CONTINUATION_STATE and the ledger win, and the stale document is corrected.

## Reading paths

- **Quick orientation:** AGENTS.md → CURRENT_STATE → 1- PROJECT_CONTEXT.
- **Resume work:** CURRENT_STATE (authority) → CONTINUATION_STATE (next action) → `git status` / `git log` / CI → the spec of the next milestone → the workflow brief to reuse.
- **Understand the system:** 2- ARCHITECTURE → TESTING_AND_VERIFICATION → SECURITY_HARDENING_DOSSIER → AI_WORKING_CONTEXT.
- **Investigate a claim:** ACCEPTANCE_RECORD → the ledger entry (E-xx) → the commit and the code.
- **Reconstruct history:** 4- SESSION_SUMMARY → DECISIONS_LOG → the ledger in order → `git log`.

## Copies and local material

- The local handoff kit (memory, plans, the original workflow scripts, skills) is kept on the build machine and is not in git, because it holds private working material. Its plans are copies of specs 5–7; the repository versions are canonical. The briefs in `Documentation/workflows/` are sanitized derivatives of its scripts.
- The Date Calculator repository holds the original approval of plan 5 (commit `be06e59`) and the Part A releases; it is frozen and is never changed from here.
