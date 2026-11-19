# AI working context: how this project has been built

This explains the working method so a new executor (a person, or Claude on another account) can continue the same way. It complements [AGENTS.md](../../AGENTS.md), which holds the binding rules.

## 1. Method: PBS v1.1 (The AI Project Bootstrap System)

- **Plan approval = Goal approval.** The owner approved [the plan](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md) on 2026-11-17. Later requests extend it ([6-](../specs/6-%20UX_ROADMAP.md), [7-](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md)). The executor continues in-scope work without asking again, and stops only at real gates (§4).
- **Records** (in `Documentation/pbs/`). Update only the ones whose answers changed.

  | Record | Question it answers |
  |---|---|
  | `CURRENT_STATE.md` | What is accepted now? Who has authority? |
  | `CONTINUATION_STATE.md` | What is unfinished, and what is the exact next permitted action? |
  | `EXECUTION_AND_CODING_LEDGER.md` | What was executed and verified? Dated E-entries with the commands and results, and what was *not* run. |
  | `SOURCE_OWNERSHIP_MAP.md` | Which file owns which answer? |

- **Milestones** are listed in [ROADMAP](../3-%20ROADMAP.md). Each closes with a ledger entry and a pushed, verified commit.
- **Labels are honest.** A pass in a check is not owner acceptance. "Implemented-verified locally (Chromium only)" means exactly that. Safari/iOS, Firefox, real phones and screen readers are still **owner/manual checks**.
- The PBS skill is `pbs-start-resume-handoff` (Start, Resume & Handoff, PBS v1.1). It may be installed as a Claude plugin; the complete package, with guides, lifecycle prompts and templates, is in the local kit at `skills/zips/pbs-start-resume-handoff.zip`. The original method source is the Notion page "The AI Project Bootstrap System" in the CipherVaults owners' Notion workspace; another account may not have access to it, and the zip is self-contained.

## 2. Git & GitHub rhythm (the owner's convention)

This is also summarised in AGENTS.md. The skill `git-github-rhythm` is installed for Claude; packages are in the local handoff kit, §6.

- Work happens on **`dev`**. **`main`** is reached only by PR from `dev`.
- In this repo, `main` holds only the first, workflow-free commit. No release job exists before M10.
- **One coherent step per commit.** Stage **explicit paths**, never `git add -A` while other agents edit, and read the staged diff first.
- **Commit messages:**
  - a plain-language subject;
  - a bullet body **Why / Changed / Checks / Remaining**;
  - Checks names the real commands and results, and what was not run;
  - unfinished work is committed as `WIP:`;
  - each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` when Claude co-wrote it.
- **Push after every verified milestone.** Check it with `git ls-remote origin dev` against `git rev-parse HEAD`. **Never force-push.**
- Before pushing, scan the new commits for personal paths and data: `git grep -I -i "Users[\\/]<name>" $(git rev-list origin/dev..HEAD)`. The build scripts already refuse an engine that embeds a local path.
- **Receipts** (SHA, checks, not covered) go in the closing report and in the ledger.

## 3. How work was executed

- **Workflows.** Every substantive task ran as a multi-agent workflow:
  1. implementer agents on disjoint files;
  2. two **independent reviewers** with different lenses (spec, correctness and data durability; phone UX, accessibility and security);
  3. a fix agent that verifies each finding before changing anything;
  4. a coordinator that **re-runs the full verification list itself**, commits, pushes and records.

  The workflow scripts are in the local kit (`workflow-scripts/`), as templates.
- **The verification list in AGENTS.md is mandatory.** Every step must exit 0. Run Cargo from **PowerShell only**: Git Bash's `/usr/bin/link` shadows the MSVC linker. browser-boot needs Microsoft Edge (headless over CDP, with a throwaway profile).
- **Mutant proofs.** Every safety rule in `scripts/safety-eval.mjs` has a planted bug that the eval must catch. A new rule without a mutant is incomplete.
- **Screenshots** for phone review come from headless Edge at 360, 390 and 440 px. `browser-boot.mjs --shots <dir>` saves them.
- **Auto-continue.** The owner asked that work resume by itself after usage-limit resets. The previous account used a session-only hourly scheduled prompt (`:47` each hour) saying "if nothing is running, continue the plan from CONTINUATION_STATE". It disappears when that Claude session ends. Recreate it on the new account if wanted.

## 4. Authority and gates (current)

| Action | Allowed? |
|---|---|
| In-scope implementation, fixes, improvements, security hardening | **Yes, without asking**, then report |
| Merge `dev` → `main` and release | **Yes, if every check passed and the result was verified** (standing release authority, 2026-11-18). Never for failing or untested work |
| Create repositories, change repository settings (e.g. **enable GitHub Pages** for this repo, needed at M10), new outward publication channels | **Ask the owner first** |
| Read, clear or export private per-device data (`%APPDATA%\com.portablecalculator.tool\`, browser IndexedDB/localStorage, the old apps' data) | **Owner only** |
| Work on Date Calculator or Percentage Calculator | **No.** They are frozen; focus is this app only (2026-11-19) |

## 5. Environment facts (Windows build machine)

| Item | Value |
|---|---|
| Rust | **1.99.1** (pinned in `rust-toolchain.toml`), targets `x86_64-pc-windows-msvc` and `wasm32-unknown-unknown` |
| Tauri | 2.12.5 crates; `tauri-cli =2.12.4` (installed with `cargo install tauri-cli --version "=2.12.4" --locked`; needed from M10 for bundling) |
| Node | 20+ (24 used). Scripts are plain Node with **no npm packages** |
| `gh` | Needed for PRs and runs. The account must have write access to `CipherVaults/Portable-Calculator-Tool` |
| Line endings | `git config core.autocrlf false` in the repo. LF everywhere (CSP hashes are byte-exact) |
| Engine build | `engine.wasm` only via `node scripts/build-wasm.mjs`. A bare `cargo build` embeds the local cargo-home path, which contains the Windows user name |

## 6. Local handoff kit (not in git)

`D:\Claude Projects\_Handoff kit - Portable Calculator\` on the previous build machine holds material that is private or local and therefore not in this public repo:

| Folder | Contents |
|---|---|
| `memory/` | The previous Claude account's project memory (owner preferences, project facts) |
| `plans/` | The approved plan with the M3b section, the original design document and the UX roadmap (their content is also in `Documentation/specs/`) |
| `workflow-scripts/` | Every workflow script used so far, plus helper scripts |
| `skills/` | The `git-github-rhythm` skill: the installed copy, and Claude and Codex packages |

If the new account works on the same Windows user, Claude Code may already see the same `~/.claude` memory. Otherwise, copy `memory/*.md` into the new project's memory folder, or paste their key points into the first session.
