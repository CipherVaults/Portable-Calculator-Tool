# Workflow briefs

Every substantive step of this project ran as a multi-agent workflow: an orchestration script that starts agents in phases, passes each one a written brief, and collects their reports. This folder keeps a **sanitized brief** of each workflow used for this repository, so a successor executor can run the same kind of work the same way.

The briefs keep each workflow's phases, agent roles, review lenses, verification demands and hard gates, and the substance of its prompts. They leave out every local path (user folders, temporary and scratch folders, session ids) and anything private. The original scripts are in the local handoff kit (`workflow-scripts/`), which is not in git because it also holds private material. Where a brief and the repository disagree, the repository and the PBS records win.

## The briefs

| Brief | Kind | Used | Result |
|---|---|---|---|
| [design-portable-calculator](design-portable-calculator.md) | read-only design: 3 lenses → synthesis → adversarial critique → revision | 2026-11-17 | [spec 5](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), approved by the owner; the critique had 21 findings |
| [portable-m0-scaffold](portable-m0-scaffold.md) | build: one implementer → one reviewer → fix | 2026-11-18 | M0 (Ledger E-01 to E-03) |
| [portable-m1-m2a](portable-m1-m2a.md) | build: M1 → M2a → two reviews → fix | 2026-11-18 | M1 (E-04), M2a (E-05), review fixes (E-06, 20 findings) |
| [portable-m2b-m2c](portable-m2b-m2c.md) | build: bottom bar → M2b → M2c → two reviews → fix | 2026-11-19 | E-07 to E-10 (M2 review: 12 findings) |
| [portable-ux-ideation](portable-ux-ideation.md) | read-only design: 6 lenses → synthesis → essence critic | 2026-11-19 | [spec 6](../specs/6-%20UX_ROADMAP.md) |
| [portable-m3-history](portable-m3-history.md) | build: M3 → two reviews → fix | 2026-11-19 | M3 (E-11); its review phase was run again as the next workflow |
| [portable-m3-review](portable-m3-review.md) | review of committed work: two reviews → fix | 2026-11-20 | E-12 (23 findings) |
| [portable-pbs-records-update](portable-pbs-records-update.md) | records: three writers → accuracy and privacy review → fix | 2026-11-20 | the PBS records set (E-13) |

The Date Calculator repository has its own workflows (date-core, the apps, M8, v1.1.0 to v1.3.0, the docs refresh). They are in the same kit and are not described here.

## The common pattern

1. **Context block.** Every agent gets the same context: the repository and branch, the commit it starts from, what to read first (AGENTS.md, CONTINUATION_STATE, the ledger, the relevant plan sections), the owner clarifications that override the plan, and the binding rules (Cargo only from PowerShell; LF; DOM only through the dom helpers; no `.style`; tokens only; logical CSS; every UI string in the catalog; native = WASM).
2. **Implementers** work on disjoint files, in coherent steps. A build phase ends only when the **full AGENTS.md verification list** exits 0, the work is committed on `dev` (owner style: plain subject; Why / Changed / Checks / Remaining; the `Co-Authored-By` trailer; explicit staging) and the ledger, CONTINUATION_STATE and ROADMAP are updated.
3. **Two independent reviewers** with different lenses read the diffs, re-run the verification list themselves and return findings in a fixed schema. They do not edit.
   - Lens A: spec conformance, correctness and data durability, and CI. For history work, "try hard to lose or corrupt data".
   - Lens B: phone UX, accessibility, security, themes and RTL, from a served build in headless Edge at 360/390/440 px, in landscape and on the desktop.
4. **A fix agent** verifies each finding against the code before changing anything, skips wrong ones with a reason, adds tests and mutant proofs, re-runs the full list, commits and adds a ledger entry.
5. **The coordinator** (the integration owner) re-runs the verification list itself, scans for personal paths, pushes `dev`, checks `git ls-remote origin dev` against `HEAD`, confirms CI and records the receipt.

The reviewers' findings schema used in every build workflow:

```js
{ findings: [{ severity: 'blocker' | 'major' | 'minor', file, problem, fix }], checks, summary }
```

Hard gates repeated in every brief: never push from a workflow agent (the coordinator pushes), never touch `main`, never create releases or repositories, never change repository settings or enable Pages, never read or clear users' private stored data.

## How to reuse a brief

1. Pick the brief closest to the next task (a build milestone: [portable-m3-history](portable-m3-history.md); a review of committed work: [portable-m3-review](portable-m3-review.md); a design pass: [portable-ux-ideation](portable-ux-ideation.md)).
2. Write a new script in the workflow tool with the same phases. Set the placeholders: `<REPO>` (the local repository), the start commit, the milestone and its plan or spec sections (for M3b: [spec 7](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), including "What the M3 review leaves for M3b").
3. Copy the rules and gates from [AGENTS.md](../../AGENTS.md) as they are **now**, not from the brief: the verification list grows with every milestone.
4. Keep scratch output (screenshots, throwaway browser profiles, clones of other repositories) in a session scratch folder, and never write those paths into repository files. Committed screenshots are not used; `target/` is git-ignored.
5. If a session restarts mid-workflow, run the interrupted phase again with a **resume note**: "an earlier run was interrupted; inspect `git status` and `git diff` first; keep what is sound, finish or redo what is incomplete; do not discard work blindly". The M2a and M3 review fix runs were recovered this way.
6. After the workflow, the coordinator integrates as in step 5 of the pattern and updates the records under the keep-records rule in AGENTS.md.
