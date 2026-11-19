# Handoff: Portable Calculator Tool

**Prepared:** 2026-11-19 by Claude Code (Opus 5.5), the coordinating executor until now.
**Prepared for:** **Ahmed Emara** (CipherVaults partner), moving from Mohamed Sayed's Claude account, which he used for these sessions, to his own. **Both partners, Mohamed Sayed and Ahmed Emara, have full authority**; either one's explicit yes satisfies a gate.
**Status:** *prepared*. It becomes *received* when the new executor has read it and confirmed the repo state in §2.

> **This is an extra layer on top of PBS v1.1, not a replacement.** The PBS records stay the source of truth: [CURRENT_STATE](Documentation/pbs/CURRENT_STATE.md) for authority and the accepted present, [CONTINUATION_STATE](Documentation/pbs/CONTINUATION_STATE.md) for unfinished work and the exact next action, the [Ledger](Documentation/pbs/EXECUTION_AND_CODING_LEDGER.md) for evidence and the [Source map](Documentation/pbs/SOURCE_OWNERSHIP_MAP.md) for ownership. This file only orients the new executor and gathers context that was in previous conversations. If anything here disagrees with those records, the records win.

Start here, then read in this order:
1. [AGENTS.md](AGENTS.md): the binding rules and the mandatory verification list.
2. [Documentation/pbs/CURRENT_STATE.md](Documentation/pbs/CURRENT_STATE.md) and [CONTINUATION_STATE.md](Documentation/pbs/CONTINUATION_STATE.md): the accepted present and the exact unfinished work.
3. [Documentation/handoff/DECISIONS_LOG.md](Documentation/handoff/DECISIONS_LOG.md): every owner decision, with quotes.
4. [Documentation/handoff/AI_WORKING_CONTEXT.md](Documentation/handoff/AI_WORKING_CONTEXT.md): how the work is run (PBS, Git & GitHub rhythm, workflows, gates, environment).
5. Specs:
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

## 2. State at handoff

| Item | State |
|---|---|
| Repo | `CipherVaults/Portable-Calculator-Tool` (public). Local copy: `D:\Claude Projects\Portable Calculator Tool` |
| `main` | `659311e`: the first commit only, with **no workflows**, so nothing can be released by accident. The release job arrives in M10 |
| `dev` (pushed) | **`e97b1a6`**, **CI green** (run 44501883562). Everything through ledger E-10 (M0–M2c and the review fixes) is on GitHub |
| Version | 0.1.0 (development); v1.0.0 at M10 |
| Done and verified locally | M0, M1, M2a, the phone bottom bar, M2b (the Date tool) and M2c (the Percentage tool). Evidence: ledger E-01 to E-10 |
| **In flight at handoff** | **M3 (unified history).** A workflow on the previous account was implementing it; its edits were **uncommitted** in the working tree: modified and **new untracked** files across `crates/`, `src-tauri/`, `web/` and `scripts/`, for example `crates/pcalc-api/src/history.rs`, `crates/pcalc-store/src/export.rs` and `web/src/history/`. See `git status`, including untracked files. **If the new executor works on another machine,** the previous coordinator commits this as a `WIP:` commit on `dev` and pushes it before the switch (§3a), so a fresh clone has it. That workflow stops when the previous Claude session ends. See §3, step 1 |
| Designed, not started | **M3b:** notes (headline + up to 100k words or unlimited), auto-save history, the countdown upgrade and the UX roadmap items ([7-](Documentation/specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md)) |
| Not started | M5a (decimal engine) → M5b Standard → M5b+ Mini Calculator → M5c Scientific → M6 Programmer → M7 Converters → M8 Graphing → M9a Languages → M9b Themes → M9 hardening → M10 release |
| GitHub Pages | **Not enabled** for this repo. Enabling it is an owner decision, needed at M10 |
| Manual checks still owed | Safari/iOS 16.4+, Firefox, real phones, a screen reader. Everything so far is verified in Chromium (headless Edge) and WebView2 only |

## 3. Exact next steps

1. **Recover M3.**
   - Run `git status` and `git diff --stat` and read the uncommitted M3 work.
   - If M3 was finished and committed by then, run the full AGENTS.md verification list and push.
   - If not, finish M3 to its spec:
     - plan **B10/B11** and the M3 brief in the local kit `workflow-scripts/portable-m3-history-*.js`;
     - include the **iPhone ± key** for signed fields (M3 owns the key; M3b's field-error work builds on it);
     - the owner gate "export method" is decided under the standing improvement authority: a fixed Downloads path on desktop (no new plugin) and a web Blob download plus a clipboard fallback. A CipherVaults owner may override;
     - keep what is sound in the tree.
   - Then verify, scan for personal paths, commit (Git & GitHub rhythm) and push `dev`. Add ledger entry E-11 and update CONTINUATION.
2. **Build M3b** per [7-](Documentation/specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md), in its build order, with two independent reviews.
   - **Owner requests win over the roadmap:** auto-save by default with one entry per editing burst; a manual-save mode; retention that never removes pinned, noted or manual entries; long notes in a separate store.
   - Nothing is released yet, so the history schema v1 can still be amended without an upgrade path.
3. Continue the **ROADMAP** in order from M5a. Close each milestone with the full verification list, a ledger entry and a pushed commit.
4. **Before M10, ask the owner** to enable GitHub Pages (Actions source). Merge and release under the standing authority only when every check passes.

## 3a. Ownership, live state and what not to repeat (PBS v1.1 handoff)

**Integration owner:** from receipt, **the new executor on Ahmed Emara's account** owns integration: commits, pushes, records and the release gate under the owner's authority. The previous coordinator (Claude on the original account) stops coordinating this repo. There must be one current-state owner, not two.

**Same PC (confirmed by Ahmed, 2026-11-19):** the new account runs on the same Windows machine. The uncommitted M3 work in this working tree, the local kit and the installed toolchain (Rust 1.99.1 + wasm32, Edge, Node, `gh`) carry over as they are. No `WIP:` push is needed for the switch. The previous account's Claude project memory was also copied to `~/.claude/projects/D--Claude-Projects-Portable-Calculator-Tool/memory/`, which Claude Code reads for this folder. If the new account uses a separate Claude data folder, copy it from the kit's `memory/`. **The GitHub CLI login is per Windows user:** check that `gh auth status` shows an account with write access to CipherVaults, and set your own `git config user.name` and `user.email` in this repo if commits should carry your identity.

**Recipient limits:** the new account does **not** see the previous Claude conversations, their background workflows, their scheduled prompts or their memory. Everything it needs is in this repo, plus the local kit (`D:\Claude Projects\_Handoff kit - Portable Calculator\`) on the original Windows machine.

**Live state at handoff** (not inherited):
- The M3 workflow and the hourly auto-continue prompt ran **in the previous Claude session only** and stop with it.
- Do not assume either is still running, or that it finished. Read `git status` and `git log` instead.

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

> Open `D:\Claude Projects\Portable Calculator Tool`, or a fresh clone of `dev` once any `WIP:` commit described in §2 is pushed. Read `HANDOFF.md`, `AGENTS.md`, `Documentation/pbs/CURRENT_STATE.md`, `CONTINUATION_STATE.md`, `Documentation/handoff/*` and the specs it links. Follow PBS v1.1 and the Git & GitHub rhythm. Recover M3 per HANDOFF §3, then continue with M3b and the ROADMAP. Use multi-agent workflows with independent review, and verify with the full AGENTS.md list before every push.
