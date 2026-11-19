# Owner decisions log (CipherVaults calculators, 2026-11-16 to 2026-11-19)

Chronological record of the owner's decisions and requests, collected from the working sessions for the handoff. Quotes are the owner's words. This log records **what was decided**. **Authority** lives in [CURRENT_STATE](../pbs/CURRENT_STATE.md#current-authority), and the **design** in [specs/](../specs/).

**Owners:** CipherVaults, Mohamed Sayed and Ahmed Emara. The decisions below were given by **Ahmed Emara**, working from Mohamed Sayed's Claude account. **Both partners have full authority** (confirmed 2026-11-19): an explicit yes from either one satisfies any gate.
**Executor so far:** Claude Code (Opus 5.5), coordinating multi-agent workflows.

## 2026-11-16: Date Calculator Tool (DCT) started

- **Build:** a sibling of `CipherVaults/Percentage-Calculator-Tool` (PCT, then v2.2.1): a Rust + Tauri 2 Windows desktop app and a single-file PWA on GitHub Pages, with the same design and hardening. The functional baseline is calculator.net's date calculator. Work follows **PBS v1.1** (The AI Project Bootstrap System): plan approval is goal approval.
- **Modes:** six: Days Between, Add/Subtract (with a business-day option), Business Days, Age, Date Info, Countdown.
- **Holidays:**
  - US, UK and Egypt presets, plus custom holidays; a configurable weekend.
  - Egypt switches the weekend to Fri/Sat. Coptic Easter is included.
  - Islamic dates use the tabular Hijri calendar (offset 0 by default, ±2, per-year overrides) and are labelled "estimated".
- **Month ends** clamp (Jan 31 + 1 month = Feb 28/29).
- **Repository:** public `CipherVaults/Date-Calculator-Tool`, UNLICENSED, identifier `com.datecalculator.tool`.
- The Notion project hub was deferred: "skip notion for now".

## 2026-11-17: DCT v1.0.0 and the merged-app plan

- "Yes, switch it": `main` became the default branch.
- "I give you my authorization to do that if you tested it and agreed it's ready." The coordinator merged PR #1, and **DCT v1.0.0 was released**.
- **The merged app was requested:** "plan for a merger between both tools to be one holistic app … called the portable calculator tool".
  - It includes Percentage + Date + a full calculator like Windows (Standard, Scientific, Graphing, Programmer) and converters (volume, length, weight/mass, temperature, energy, area, speed, power, data, pressure, angle).
  - "the most important part is the history of the calculations".
  - Also requested: a countdown that survives closing, and clickable calendar days.
- **Answers to the plan questions:**

  | Question | Answer |
  |---|---|
  | DCT fixes | ship first as **v1.1.0** |
  | Engine | **one Rust engine compiled to WASM** for the web app |
  | Repository | a **new repo `CipherVaults/Portable-Calculator-Tool`, v1.0.0** |
  | First release scope | **all of** Standard + Scientific, Programmer, Unit converters, Graphing |

- **Plan approved:** "Yeah, I approve of that". The full design is [5- PORTABLE_CALCULATOR_PLAN.md](../specs/5-%20PORTABLE_CALCULATOR_PLAN.md). Clarifications at approval:
  - **No legacy history migration:** "It doesn't matter the old history … We are almost starting afresh".
  - **Standing improvement authority:** "if you have any improvement and fixes and the security concerns that matters, obviously do it without waiting for me … I need you to build something that's solid".
  - **Phone-first web app:** "focus on the web app to be phone friendly, because it's all about that".
- **Mini Calculator (plan B5a):** like the pop-up the Windows Calculator key opens. Any number of small Standard windows, sharing one history with the full app, plus a setting so the keyboard's Calculator key opens it.

## 2026-11-18: themes, languages, v1.1.0 / v1.2.0, new repo, release authority

- **Themes (plan B5b):** the default **Terminal**, a "white-ish but not plain white" **Daylight**, and a **Retro** theme in the Windows 95/XP spirit.
- **Languages (plan B5c):** Arabic first, plus about ten common app and game languages. The plan has 12: en, ar (RTL), es, fr, de, pt-BR, it, ru, tr, zh-Hans, ja, ko.
- **New repo created:** "I authorize the creation of a repository for the portable calculator tool, and I want it from the start". The owner merged DCT PR #3, and **DCT v1.1.0 was released**.
- **DCT v1.2.0:** collapsible, reorderable cards with a saved layout and a reset in Settings, like PCT v2.3.0. It was released 2026-11-18.
- **Standing release authority:** "don't wait for my approval to release, I already grant it to you if you tested it and it's good." Merging and releasing **verified** work needs no new ask. Creating repos and changing repo settings (for example enabling Pages) still need the owner.

## 2026-11-19: focus on the Portable Calculator Tool only

- **Countdowns:** a note box on each countdown, and New/Duplicate countdowns in a different colour. "allow for the user to change these automatically selected colors".
- **Focus change:** "don't make it Date Calculator v1.3 … focus on adding this to the wholistic Portable Calculator Tool" and "stop working on them separately, and focus all of our efforts on the Portable Calculator tool".
  - **DCT is frozen at v1.2.0** (maintenance only; a later "replaced by" sunset release is DCT v1.3.0).
  - **PCT is left as is at v2.3.0.**
- **Design pass:** "think creatively on how we can improve the overall app, its structure and UX & UI, without affecting the essence of it and its core iconic design", and "don't forget the two other themes". The result is [6- UX_ROADMAP.md](../specs/6-%20UX_ROADMAP.md).
- **History notes:**
  - a headline plus an expandable note on every history entry;
  - "the limit can be up to 100k words, or endless in the options".
- **Auto-save history:**
  - "make this as an option to auto save by default … or make a button to save history for this calculation";
  - plus a settings toggle.
  - Designed in [7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](../specs/7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md).
- **Handoff:** "prepare a full on handoff to another account … to Ahmed's account, as he's the partner in CipherVaults who will continue the development … alongside the AI PBS … and The Git & GitHub". Ahmed then clarified: "I'm currently Ahmed talking to you from Mohamed's account, but both of us are partners in CipherVaults, and both of us have authority." This log and [HANDOFF.md](../../HANDOFF.md) are that handoff.

## Coordinator decisions taken under the standing improvement authority

| Decision | Reason |
|---|---|
| Phone bottom bar below 760 px: ☰ Menu · quick switch · History (E-07) | One-handed reach |
| Desktop stays native Rust; only the web uses WASM; CSP unchanged on desktop | Plan |
| Web history in IndexedDB, not localStorage | Shared-origin quota |
| Engine versions decoupled from the app version | DCT v1.1.0 onward, and the Portable app |
| Old engines are copied unchanged (date-core 1.0.0, percent-core from PCT v2.3.0), and only made total where they could panic. Goldens unchanged | Safety without behaviour change |
| No notes in copy text unless chosen; countdown notes never written into history | Privacy |
