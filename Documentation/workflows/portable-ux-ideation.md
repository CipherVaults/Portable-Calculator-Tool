# Brief: portable-ux-ideation

**Kind:** read-only design. **Used:** 2026-11-19, while M3 was being built in the same repository. **Result:** [6- UX_ROADMAP.md](../specs/6-%20UX_ROADMAP.md), folded into M3b ([spec 7](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md)) and later milestones.

The original script's description says "5 lens designers"; it was edited in place to add a sixth lens for the Daylight and Retro themes, and its body defines six.

## Purpose

The owner asked: "think creatively on how we can improve the overall app, its structure and UX & UI, without affecting the essence of it and its core iconic design", and "don't forget the two other themes".

## Phases

| Phase | Agents | Role |
|---|---|---|
| Ideate | 6 in parallel | One proposal set per lens |
| Synthesize | 1 | One ranked roadmap; merge duplicates, drop weak or essence-diluting ideas, resolve conflicts |
| Critique | 1 | Essence, phone and feasibility critic; returns the roadmap revised in full plus "Critic changes" |

## Context (substance)

- **Strictly read-only:** no file edits, no servers or browsers (another workflow was building M3 in the repository), no Cargo. Read code, docs and existing screenshots only: phone-width shots of the current shell and the original Date app's v1.1/v1.2 shots, both from a scratch folder.
- **The essence to preserve:**
  - the dark terminal look (`#0E0F12`, gold `#E9A715`, green `#94C59A`, monospace, square corners, thin borders);
  - the live-formula panel;
  - live results while typing;
  - plain, honest wording;
  - offline and privacy-first;
  - no frameworks;
  - strict security.
- **Owner priorities:** phone-first; history is the most important part; solid quality.
- **All three themes:** every proposal must work in Terminal, Daylight (warm off-white paper, not plain white) and Retro (Windows 95/98 with an XP nod), and say how it renders in each.
- **Queued requests to build on:** countdown notes; New/Duplicate countdowns with user-changeable colours.

## Lenses

1. **Phone-first UX:** one-handed flows, input speed (keypads, the ± key, chips, paste), sheets, accessible gestures, landscape, install, start-up speed, fewer taps.
2. **Information architecture:** navigation across 7 tools and 12 converters, search or a command palette, favourites and recents, cross-tool flows, consistent card anatomy, settings, empty states.
3. **History as the hero:** timeline, tags, notes, pinning, re-run with edits, compare, share/export, privacy, the Mini Calculator.
4. **Terminal aesthetic:** typography, the live formula as a signature, micro-interactions within reduced motion, faithful Daylight and Retro.
5. **The two other themes:** each component in Daylight and Retro, theme switching, AA contrast, and what must stay identical across themes.
6. **Power users, accessibility and trust:** keyboard-first use, screen readers, high contrast and large text, precision controls, explainability, error messages, performance budgets, the saved-locally signal, desktop niceties.

## Required output

- **Each lens:** 8–15 concrete proposals in 600–1,200 words. Each gives a name, the problem with evidence (file, screenshot or plan section), the change on phone and desktop, why it keeps the essence, the effort (S/M/L), the milestone fit and the risks. No vague advice.
- **Synthesis:** design principles (5–7), a Top 10 with testable acceptance criteria, "Also worth doing" (≤10), "Rejected and why", and a milestone mapping.
- **Critic:**
  - reject or fix items that only work in Terminal;
  - check the essence (no rounded corners, gradients, emoji-heavy UI, framework-ish components, illustrations);
  - check phone-first (no added taps);
  - check security and privacy (CSP, no HTML sinks, offline, no telemetry);
  - check feasibility in the current architecture and the owner's priorities.

## Reuse

Use for a creative design pass that must not dilute the product. Keep it read-only when a build runs in parallel, state the essence explicitly, and give each lens its own direction so the synthesis has real alternatives. Where the result conflicts with later owner requests, the owner wins (as spec 7 records for long notes and auto-save).
