# Brief: design-portable-calculator

**Kind:** read-only design. **Used:** 2026-11-17, in the Date Calculator repository sessions. **Result:** the plan that became [5- PORTABLE_CALCULATOR_PLAN.md](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md), approved by the owner on 2026-11-17. The critique had 21 findings; none was rejected.

## Purpose

Design the two Date fixes (Date v1.1.0) and the merged Portable Calculator Tool v1.0.0 from the owner's request, using three independent designs, one synthesis, an adversarial critique and a revision.

## Phases

| Phase | Agents | Role |
|---|---|---|
| Propose | 3 in parallel | Independent designs, one per lens |
| Synthesize | 1 | Merge into one executable plan; where designs disagree, choose and say why |
| Critique | 1 | Adversarial reviewer: try to break the plan; structured findings |
| Revise | 1 | Apply the correct findings; list skipped ones with a reason under "Critique items not adopted" |

## Shared context (substance)

- **Read-only:** no file edits, no commits, no builds that write outside `target/`. Reading code, grep and read-only `gh api` calls are fine.
- **The owner's request:**
  - merge Percentage Calculator Tool and Date Calculator Tool into one app for the Windows desktop (Tauri 2) and the web/PWA;
  - add Standard, Scientific, Graphing and Programmer calculators and the unit converters (offline, so no currency);
  - "very good design";
  - history of calculations as the most important part;
  - plus the two Date fixes (the countdown persists across restarts; clickable mini calendars).
- **The owner's answers:** Date v1.1.0 first; one Rust engine compiled to WebAssembly; a new public repository at v1.0.0; all modes in the first release.
- **Project rules that carry over:**
  - pure engines;
  - DOM safety;
  - a strict CSP;
  - hardened JSON storage;
  - SHA-pinned Actions;
  - LF;
  - Cargo from PowerShell;
  - releases only on an owner's yes (at the time);
  - PBS v1.1;
  - accessibility (44 px targets, status regions, focus-visible, safe areas).
- **Code facts for both apps,** with file and line references, so designers start from the real code: the countdown and calendar implementation, the storage options and their downgrade risks, the history and settings schemas, the CI jobs, the shared infrastructure, and the shared GitHub Pages origin of both PWAs (shared localStorage and CacheStorage, quota, iOS isolation).

## Lenses

1. **Engine and architecture:** one correct engine, clean crate boundaries, one shared UI codebase, WASM parity, maintainability.
2. **Product and UX:** a Windows-Calculator-class experience in the dark-terminal design, history UX, keyboard and touch, phone layout, and the two Date fixes.
3. **Risk, migration and delivery:** zero data loss, migration safety, CSP correctness with WASM, CI and release safety, realistic milestone sizing for an agent team, and honest verification.

## Required output (every design)

A markdown design of 1,500–3,000 words:
- **Part A:** exact behaviour, storage choice, files, tests, verification and the release gate.
- **Part B:**
  - the workspace and crates;
  - the unified engine API and envelope;
  - the WASM approach (raw ABI vs wasm-bindgen: decide and justify) and its loading under the CSP, including the single-file asset;
  - the shared frontend with a platform adapter, and navigation;
  - the numeric model, graphing and converters;
  - the Date and Percentage integration;
  - history (the top priority), settings, migration and the old apps' final releases;
  - CI and release, testing oracles, security and accessibility;
  - milestones with "done when" criteria and owner gates, top risks, and what is out of scope.

Be concrete (crates, files, commands, keys, schema fields), prefer reuse of existing code, and flag every assumption.

## Critique demands

Check:
- technical feasibility: the WASM raw ABI under the CSP, including `file://`; `'wasm-unsafe-eval'` support in iOS Safari, Android Chrome and WebView2; Tauri 2 specifics; serde_json in wasm32; the purity rule against needed dependencies;
- numeric correctness claims;
- migration data-loss paths;
- whether the history schema is complete;
- Part A against the actual code at the cited lines;
- the CI and release gates;
- missing owner gates, milestone sizing and contradictions;
- anything the owner asked for that is missing.

Report only real problems with evidence. Schema: `{ findings: [{ area, problem, evidence?, fix, severity: blocker|major|minor }], verdict }`.

## Reuse

Use for a large new design: keep the read-only rule, give the designers a dense code-facts block, keep three lenses that pull in different directions (build, experience, risk), and always end with an adversarial critique and a full revision, not a diff.
