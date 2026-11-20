# Handoff: Portable Calculator Tool

**Prepared:** 2026-11-19 by Claude Code (Opus 5.5), the coordinating executor until now.
**Prepared for:** **Ahmed Emara** (CipherVaults partner), moving from Mohamed Sayed's Claude account, which he used for these sessions, to his own. **Both partners, Mohamed Sayed and Ahmed Emara, have full authority**; either one's explicit yes satisfies a gate.
**Status:** *received 2026-11-20*. The executor on Ahmed Emara's own account read this file, AGENTS.md and the PBS records and confirmed the repo state (then `dev` at `9f87931` with M3 committed locally, `origin/dev` at `d9afdcf`). It is now the integration owner (§3a). §2 and §3 below are kept current under the keep-records rule in AGENTS.md; the handoff as prepared on 2026-11-19 is in `git log` (`213aee1`, `d9afdcf`).

> **This is an extra layer on top of PBS v1.1, not a replacement.** The PBS records stay the source of truth: [CURRENT_STATE](Documentation/pbs/CURRENT_STATE.md) for authority and the accepted present, [CONTINUATION_STATE](Documentation/pbs/CONTINUATION_STATE.md) for unfinished work and the exact next action, the [Ledger](Documentation/pbs/EXECUTION_AND_CODING_LEDGER.md) for evidence and the [Source map](Documentation/pbs/SOURCE_OWNERSHIP_MAP.md) for ownership. This file only orients the new executor and gathers context that was in previous conversations. If anything here disagrees with those records, the records win.

Start here, then read in this order:
1. [AGENTS.md](AGENTS.md): the binding rules and the mandatory verification list.
2. [Documentation/pbs/CURRENT_STATE.md](Documentation/pbs/CURRENT_STATE.md) and [CONTINUATION_STATE.md](Documentation/pbs/CONTINUATION_STATE.md): the accepted present and the exact unfinished work.
3. [Documentation/handoff/DECISIONS_LOG.md](Documentation/handoff/DECISIONS_LOG.md): every owner decision, with quotes.
4. [Documentation/handoff/AI_WORKING_CONTEXT.md](Documentation/handoff/AI_WORKING_CONTEXT.md): how the work is run (PBS, Git & GitHub rhythm, workflows, gates, environment).
5. The overview and structure: [1- PROJECT_CONTEXT.md](Documentation/1-%20PROJECT_CONTEXT.md), [2- ARCHITECTURE.md](Documentation/2-%20ARCHITECTURE.md), and the chronology in [4- SESSION_SUMMARY.md](Documentation/4-%20SESSION_SUMMARY.md). Reusable workflow briefs: [Documentation/workflows/](Documentation/workflows/README.md).
6. Specs:
   - [5- PORTABLE_CALCULATOR_PLAN.md](Documentation/specs/5-%20PORTABLE_CALCULATOR_PLAN.md): the approved plan;
   - [6- UX_ROADMAP.md](Documentation/specs/6-%20UX_ROADMAP.md);
   - [7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](Documentation/specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md);
   - [ROADMAP](Documentation/3-%20ROADMAP.md).

## 1. What this is

One app that merges CipherVaults' Percentage Calculator Tool and Date Calculator Tool and adds:
- a full calculator: Standard, Scientific, Programmer and Graphing;
- 12 unit converters;
- a **Mini Calculator** pop-up, which the keyboard's Calculator key can open;
- **three themes:** Terminal, Daylight and Retro;
- **12 languages**, including Arabic right-to-left;
- a **unified history**, the owner's top priority.

It ships as a **phone-first PWA** on GitHub Pages and a **Windows desktop app** (Tauri 2). There is **one Rust engine**: native on desktop, compiled to WebAssembly for the web, and proven byte-identical.

**Focus rule (2026-11-19):** only this app is developed. Date Calculator (frozen at v1.2.0) and Percentage Calculator (left at v2.3.0) are not changed.

## 2. Current state (as of 2026-11-20)

| Item | State |
|---|---|
| Repo | `CipherVaults/Portable-Calculator-Tool` (public). Local copy: `D:\Claude Projects\Portable Calculator Tool` |
| `main` | `659311e`: the first commit only, with **no workflows**, so nothing can be released by accident. The release job arrives in M10 |
| `dev` (pushed) | **`d7a6712`** = `origin/dev`, **CI green** (run 44779154165: rust-checks, web-build, windows-build). Everything through ledger E-12 is on GitHub. The live CI and remote state are owned by [CURRENT_STATE](Documentation/pbs/CURRENT_STATE.md#present-state-identity) |
| Version | 0.1.0 (development); v1.0.0 at M10 |
| Done and verified | M0, M1, M2a, the phone bottom bar, M2b (the Date tool), M2c (the Percentage tool), **M3 (unified history, export/import, the ± key)** and the **M3 review fixes**. Evidence: ledger E-01 to E-12. Local full list on `d7a6712` (at ledger E-12): 234 Rust tests, check-wasm 0 mismatches in 3 time zones, browser-boot 293, safety-eval 453, smoke `SMOKE_TEST_OK` |
| Records | The PBS v1.1 records set (ledger E-13): 1- PROJECT_CONTEXT, 2- ARCHITECTURE, 4- SESSION_SUMMARY, the security, testing, failure-intelligence and acceptance records, and the workflow briefs. Written 2026-11-20; to be committed and pushed by the integration owner after review |
| Next | **M3b:** notes (headline + up to 100k words or unlimited), auto-save history, the countdown upgrade and the UX roadmap items ([7-](Documentation/specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), including "What the M3 review leaves for M3b") |
| Not started | M5a (decimal engine) → M5b Standard → M5b+ Mini Calculator → M5c Scientific → M6 Programmer → M7 Converters → M8 Graphing → M9a Languages → M9b Themes → M9 hardening → M10 release |
| GitHub Pages | **Not enabled** for this repo. Enabling it is an owner decision, needed at M10 |
| Accepted by an owner | **Nothing yet** ([ACCEPTANCE_RECORD](Documentation/pbs/ACCEPTANCE_RECORD.md)) |
| Manual checks still owed | Safari/iOS 16.4+, Firefox, real phones, a screen reader. Everything so far is verified in Chromium (headless Edge) and WebView2 only. From M3 and its review (E-12), on an iPhone home-screen app: after a ± tap the field keeps focus, the keypad stays up and the caret stays by the same digit; Export opens the share sheet (or the download works), Copy export works, and if both fail the export text is shown selected; the Undo bar at the bottom of the History sheet is reachable with a thumb. On the desktop: an export into the real Downloads folder, and two processes writing at once |

## 3. Exact next steps

The live list is [CONTINUATION_STATE — Exact next permitted action](Documentation/pbs/CONTINUATION_STATE.md#exact-next-permitted-action); this is its summary.

1. **Commit and push the records set (E-13)** after its review: explicit paths, the Git & GitHub rhythm, `git ls-remote origin dev` against `HEAD`, CI confirmed.
2. **Build M3b** per [7-](Documentation/specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), in its build order, with two independent reviews (reuse the [M3 briefs](Documentation/workflows/portable-m3-history.md)).
   - **Owner requests win over the roadmap:** auto-save by default with one entry per editing burst; a manual-save mode; retention that never removes pinned, noted or manual entries; long notes in a separate store.
   - Start from spec 7's "What the M3 review leaves for M3b": an `update` operation decided by the engine, undo across the history and notes stores, write cost off the main thread before auto-save, a canonical `resultValue`, and the two-desktop-process question.
   - Nothing is released yet, so history schema v1 can still be amended without an upgrade path.
3. Continue the **ROADMAP** in order from M5a. Close each milestone with the full verification list, a ledger entry, the record updates of the keep-records rule (AGENTS.md) and a pushed commit.
4. **Before M10, ask a CipherVaults owner** to enable GitHub Pages (Actions source). Merge and release under the standing authority only when every check passes.

## 3a. Ownership, live state and what not to repeat (PBS v1.1 handoff)

**Handoff received (2026-11-20).** The executor on Ahmed Emara's own account read this file, AGENTS.md and the PBS records, and checked the live repository: the working tree, `git log`, and `origin/dev` against local `dev`. It found M3 committed locally (`a0a8152`, `2d73568`, `9f87931`, ledger E-11) and not pushed, and `origin/dev` at `d9afdcf`. It then ran the M3 review and fixes (E-12) and pushed `dev` through `d7a6712` (CI run 44779154165 green).

**Integration owner:** since receipt, **the executor on Ahmed Emara's account** owns integration: commits, pushes, records and the release gate under the owners' authority. The previous coordinator (Claude on Mohamed Sayed's account) no longer coordinates this repo. There is one current-state owner, not two.

**Same PC (confirmed by Ahmed, 2026-11-19):** the new account runs on the same Windows machine. The M3 work in this working tree, the local kit and the installed toolchain (Rust 1.99.1 + wasm32, Edge, Node, `gh`) carry over as they are. No `WIP:` push is needed for the switch. The previous account's Claude project memory was also copied to Claude Code's per-project memory folder for this repository, which Claude Code reads for this folder. If the new account uses a separate Claude data folder, copy it from the kit's `memory/`. **The GitHub CLI login is per Windows user:** check that `gh auth status` shows an account with write access to CipherVaults, and set your own `git config user.name` and `user.email` in this repo if commits should carry your identity.

**Recipient limits:** the new account does **not** see the previous Claude conversations, their background workflows, their scheduled prompts or their memory. Everything it needs is in this repo, plus the local kit (`D:\Claude Projects\_Handoff kit - Portable Calculator\`) on the original Windows machine.

**Live state at handoff** (not inherited):
- The M3 workflow and the hourly auto-continue prompt ran **in the previous Claude session only** and stopped with it.
- Do not assume either is still running, or that it finished. Read `git status` and `git log` instead.

**Live state now (2026-11-20):**
- `dev` = `origin/dev` = `d7a6712`; CI green. The PBS records set (E-13) is written 2026-11-20 in the working tree; to be committed and pushed by the integration owner after review.
- Apart from the records workflow that writes E-13 ([brief](Documentation/workflows/portable-pbs-records-update.md)), no background workflow, scheduled prompt or auto-continue job is known to run for this repository on the new account. Any that is set up later is recorded in CONTINUATION_STATE, and none may be assumed from this file.
- The previous account's conversations, workflows and memory are not visible here; the repository and the local kit are the only carriers of context.

**Do not repeat** (these failed or caused harm before):
- Running Cargo from Git Bash (the MSVC linker is shadowed). Building `engine.wasm` with a bare `cargo build` (it embeds the Windows user path).
- Disabling WebAssembly in Edge with `--js-flags=--noexpose_wasm` (ignored by Edge 157). `browser-boot.mjs` deletes the global through CDP instead.
- PowerShell variable names that differ only in case: PowerShell treats them as one variable. One verification script overwrote its own path variable this way.
- Writing release files with PowerShell `Set-Content`: it writes CRLF and broke `sha256sum -c` in the Date app. Use `[IO.File]::WriteAllText` with LF.
- Treating a reviewer's finding as true without checking the code. Every fix step verifies each finding first; about 1 in 10 was wrong or out of scope.
- Committing with `git add -A` while agents are editing. Short SHAs in `gh pr merge --match-head-commit`: it needs the full SHA.
- Recomputing a mobile/web CSP hash with a script passed through a shell heredoc: backslashes in regexes get mangled. Use a script file.

## 4. Rules that matter most

These are summarised from AGENTS.md; read it in full.
- Run Cargo from **PowerShell only**. **LF** endings. Build `engine.wasm` only via `scripts/build-wasm.mjs`.
- **Web code:**
  - DOM only via the dom helpers (Trusted Types are enforced);
  - no `innerHTML`, `eval` or `.style`;
  - colours only via `tokens.css`;
  - logical CSS properties;
  - every UI string in `web/i18n/en.json`.
- **Engines are pure:** no clock, time zone or locale, no panics, serde only (approved exceptions are listed in the plan). Native and WASM must stay byte-identical (`check-wasm`).
- **Data is never silently lost:**
  - read-only on any doubt;
  - backups before any reset;
  - a newer schema is never written;
  - a full quota keeps data in memory and shows a banner.
- **Gates:**
  - Merge and release verified work freely.
  - **Ask a CipherVaults owner before creating repos or changing repo settings.**
  - Never touch users' private stored data.

## 5. Related repositories

| Repo | State | Notes |
|---|---|---|
| `CipherVaults/Date-Calculator-Tool` | v1.2.0 released 2026-11-18; **frozen** | Its `HANDOFF.md` and PBS records describe it. Source of `crates/date-core` (engine 1.0.0, copied unchanged) |
| `CipherVaults/Percentage-Calculator-Tool` | v2.3.0; **left as is** | Source of `crates/percent-core` (made panic-free with identical outputs). Its CI lacks two fixes the Date repo has: the `Start-Process` smoke gate and LF `SHA256SUMS.txt`. Recorded only, not to be changed under the focus rule |

The sunset releases with a "replaced by Portable Calculator Tool" notice (DCT v1.3.0, PCT v2.4.0) are milestone M11, after this app ships.

## 6. First message for the new Claude session

> Open `D:\Claude Projects\Portable Calculator Tool`, or a fresh clone of `dev`. Read `HANDOFF.md`, `AGENTS.md`, `Documentation/pbs/CURRENT_STATE.md`, `CONTINUATION_STATE.md`, `Documentation/handoff/*` and the specs it links. Follow PBS v1.1 and the Git & GitHub rhythm. Continue from CONTINUATION_STATE's exact next action (M3b, then the ROADMAP). Use multi-agent workflows with independent review (briefs in `Documentation/workflows/`), verify with the full AGENTS.md list before every push, and keep the records as AGENTS.md says.

This was the first message for the account switch of 2026-11-20 (adjusted since M3 is done); it serves any later session the same way.
