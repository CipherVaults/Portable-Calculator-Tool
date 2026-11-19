# 7. M3b: notes, auto-save history and the countdown upgrade (owner requests, 2026-11-19; build right after M3)

> **Status:** owner-requested on 2026-11-19 and accepted into the plan by the coordinator (the owner's standing direction: "if you have any improvement and fixes … do it without waiting"). It is built right after M3. It extends [5- PORTABLE_CALCULATOR_PLAN.md](5-%20PORTABLE_CALCULATOR_PLAN.md) B9–B11. Where it differs from [6- UX_ROADMAP.md](6-%20UX_ROADMAP.md), the owner's requests in sections 1–3 win.

*Focus: Portable Calculator Tool only. PCT and DCT stay as they are.*

**1. One shared Note component** (history entries and countdowns)
- Each history entry and each countdown can have a **note**: a **headline** (≤ 120 characters) plus a **body** (plain text with line breaks).
- **History row:** the headline is shown in gold above the muted expression, and a `≡` mark shows that a body exists. **Note** (or tapping the headline) opens the note.
- **Note editor:**
  - On phones, a full-height sheet; on desktop, a side panel.
  - Headline field and body area.
  - Autosaves 600 ms after typing stops and on close, with a "saved" indicator.
  - Shows a word and character count, and has a Done button. `dir="auto"`, so Arabic works.
- **Limits (Settings → History → Note length):** **100,000 words** (default) or **Unlimited**.
  - In both modes, a technical per-note guard (≈ 10 MB) protects storage.
  - Unlimited warns when device storage passes 80 %.
- **Storage:** notes live in a **separate `notes` store**, keyed by entry or countdown id. That keeps the history list fast and outside the 4 MiB history cap.
  - Web: an IndexedDB object store, one record per note.
  - Desktop: hardened per-note files.
  - Deleting an entry deletes its note, and Undo restores both.
- **Search** covers headlines always, and bodies optionally (a toggle, for speed). JSON export includes notes; CSV includes headlines.
- **Countdowns** use the same component, replacing the earlier "≤ 500 note" idea. Countdown notes are never copied into history entries.

**2. Auto-save history** (results are live, so pressing "calculate" should not be required)
- **Settings → History → Save calculations: Automatically (default) / Only when I press Save.**
- **Automatic mode:**
  - When to record: a valid result is recorded once it settles — 2 s after the last edit, or straight away on leaving the card or tool, hiding the app, Enter, or Copy.
  - **Coalescing:** edits to the same card in one burst update **the same entry**, so typing "1234" never makes four entries. A new entry starts after leaving the card or 60 s idle.
  - The result box shows a small status: "saving…" or "● saved" in green. The **×** on that chip removes this entry, with Undo.
  - The countdown records on commit only, never on ticks.
- **Manual mode:** the old **calculate** button becomes **⊕ save** (results are live anyway), with Enter or Ctrl+S. It shows ✓ "saved" for the current inputs and re-arms when the inputs change.
- **No overwhelm:**
  - Each entry carries `savedBy: auto|manual`, and there is a filter chip "Saved by me".
  - **Settings → History → Keep auto-saved entries:** Forever (default) / 90 days / 30 days. **Pinned entries, entries with notes, and manual saves are never removed automatically.**
  - Existing caps and duplicate-merging still apply.
- Everything still goes through the one durable history store from M3 (read-only on doubt, backups, two-window merge).

**3. Countdown upgrade** (queued earlier): New and Duplicate countdowns; an automatic accent colour per extra countdown, which the user can change ("Automatic" or a swatch picker of colours that pass AA in all three themes); notes via the shared Note component.

**4. Design-pass roadmap folded into M3b** (full text: [6- UX_ROADMAP.md](6-%20UX_ROADMAP.md); workflow `wf_3cecf56b-c90`, 6 lenses incl. Daylight/Retro, then synthesis and an essence critic)
- **Precedence:** where the roadmap and the owner's requests above differ, the owner wins. Notes use headline + body, 100k words or Unlimited, in a separate store (not "note ≤ 200"). Auto-save is the default.
- Nothing has been released, so the history v1 schema can still be amended in M3b without any upgrade cost. M3 is therefore not interrupted.
- **Principles:**
  - The working is the product.
  - History first.
  - Thumb first.
  - One structure, three skins: the same DOM in Terminal, Daylight and Retro; themes change only colour, texture and chrome font, through role tokens.
  - Plain, honest wording.
  - Local, private and safe.
  - Shared parts before tools.
  - No engine changes for UI work.
- **Scope, in build order:**
  1. **Data shapes:** the history entry gains `parentId`, `surface` (main/mini), `mark` (a palette name) and **`ref`**. `ref` is the resolved reference date or now, so Date entries re-run identically later. Countdowns gain `mark`. State gains `nav.recent`, `history.lastFilter` and `cards.<tool>.introSeen`.
  2. **Signature look on role tokens:**
     - a mono UI font in Terminal and Daylight;
     - a type scale and tabular numbers;
     - a filled-gold primary button;
     - a gold inline-start rail;
     - green LIVE FORMULA labels;
     - `--mark-*` palettes per theme;
     - fix plan B5b to match `tokens.css` (Daylight gold `#8A5F00`, raised `#FFFDF8`, not plain white).
  3. **One trace console (`shell/trace.js`)** for every live formula: `$` inputs, `│` steps, `≈` rounding, a gold `→` result, and copy steps.
  4. **A thumb-first history pane:**
     - half and full sheet heights with a grab bar that is also a button;
     - fixed History | Memory | Countdowns tabs;
     - filter chips: This tool / All / Pinned / Noted / marks;
     - two-line terminal-log rows: time, `[TOOL]` tag and expression, then a gold `= result`;
     - Restore in one tap, plus a Copy button.
  5. **Show working and Edit & re-run** from history, re-running against `ref`. Shows "Recorded: … / Now: …" when the results differ.
  6. **Countdown UI:** marks (auto or user-chosen), notes, New and Duplicate.
  7. **Honest number entry and field-level errors:** `fieldError()` with `aria-invalid`, a `!` glyph, fix-it sentences, and `±` where negatives are valid.
  8. **Answer in view on phones:** the focused field and the result line scroll into view together. Card intros collapse to `ⓘ` after first use.
  9. **A shortcut registry** with a `?`/F1 cheat sheet (the Find palette comes in M9).
  10. **Also:**
      - honest empty states: remove the internal "M2b/M5b" wording from the UI, plus a `check-i18n` rule against it;
      - jump chips on phones;
      - a save-feedback line and an exception-only storage chip;
      - a "Use in…" handoff contract;
      - a specimen route (dev builds only), plus theme-invariant and no-animation lints.
- **Later milestones:**
  - M5b: the shared keypad and display, Mini history tape.
  - M9b: Daylight and Retro finishing (Retro silver taskbar, theme specimens in the picker, themed scrollbars, `theme-color`).
  - M9: text size 100–150 %, performance budgets, the install row.

**Tests:**
- coalescing (one entry per burst);
- the settle timing;
- manual mode;
- retention never removing pinned, noted or manual entries;
- note limits (100k words and unlimited) and the storage guard;
- note storage durability;
- search in note bodies;
- export with notes;
- two-window sync of notes;
- all three themes;
- phones at 360, 390 and 440 px.

## Clarifications after the handoff review (2026-11-19)

These override the text above where they are more specific.

1. **Caps, eviction and protected entries.**
   - The 2,000-entry cap and duplicate-merging act only on *unprotected* auto-saved entries.
   - Pinned entries, entries with a note, and manual saves are *protected*. Eviction and retention never remove them, and duplicate-merging never folds a protected entry into another.
   - Protected entries have their own cap, **2,000**. When it is reached, a new manual save or note is refused with the message "History is full of saved and noted entries. Unpin or delete some to save more." Nothing is deleted.
   - When unprotected entries are full, the oldest unprotected entry is evicted, as in B10.
2. **Note size and the API caps.**
   - The per-note technical guard is **6 MiB of UTF-8**. It applies even in Unlimited mode; 100,000 words is far below it.
   - A new op, `notes.validate`, has its own cap: 6.5 MiB. That stays under the 8 MiB WASM input and import caps.
   - **Export** writes a bundle: `history.json` plus one `notes-<n>.json` part per 7 MiB. A web export downloads them together; the desktop writes them to one folder. **Import** accepts the bundle part by part, each within the 8 MiB import cap, so any export imports back.
3. **Schema v1 amendments before release.** Until v1.0.0 is released no user data exists, so the history, countdown and state v1 schemas may be amended in place in M3b. The bump-on-change rule in AGENTS.md applies from the first release. When M3b lands, AGENTS.md is updated in the same milestone:
   - the store list gains `notes`;
   - "live updates never record" becomes "records per the auto-save rules (spec 7 §2)".
4. **The ± key** is owned by M3, if M3 delivers it. M3b's field-error work builds on it; if M3 did not deliver it, M3b adds it.
5. **Extra acceptance tests for M3b:**
   - the trace console renders `$ │ ≈ →` lines from data, and its copy-steps text holds no glyphs;
   - Show working re-runs against `ref`, so a Date Age entry recorded with an empty "as of" gives the same result on a later simulated day, and differing results show both values;
   - Edit & re-run opens the owning card with the inputs;
   - the shortcut registry drives keys, `aria-keyshortcuts` and the cheat sheet, and ignores keys while typing;
   - `check-i18n` fails on milestone wording such as `\bM\d` in user-facing strings;
   - each of these has a mutant proof in safety-eval.
