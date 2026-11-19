# 6. UX, UI and structure roadmap

> **Status:** produced 2026-11-19 by a read-only design workflow (six lenses: phone, structure, history, terminal look, the Daylight and Retro themes, power users and accessibility; then a synthesis and an essence critic) at the owner's request: "think creatively on how we can improve the overall app, its structure and UX & UI, without affecting the essence of it and its core iconic design", plus "don't forget the two other themes". It is folded into milestone M3b ([7- M3B_NOTES_AUTOSAVE_COUNTDOWNS.md](7-%20M3B_NOTES_AUTOSAVE_COUNTDOWNS.md)) and later milestones as mapped in section 5. Where it conflicts with the owner's later requests (long notes, auto-save), the owner wins.


This roadmap merges six proposal sets: phone, structure, history, terminal look, Daylight/Retro, and power/accessibility. A critic then checked it against the three themes, the essence, phone-first use, the security rules, the current architecture and the owner's priorities. Nothing was changed in any repo; files and screenshots were only read.

I checked these facts myself:
- Milestones M3–M10 match plan §B17 (B12 is Migration, which the owner removed).
- `tokens.css` sets Daylight `--gold` to `#8A5F00`, but plan B5b says `#9A6A00`. Use the token value and fix the plan.
- `tokens.css` sets Retro `--gold` to `#000080`. It sets `--font-ui` to Segoe UI in both Terminal and Daylight. Plan B4 and B5b both say "monospace", and the v1.1 screenshots are mono throughout.
- Daylight `--surface-raised` is `#FFFFFF`, which conflicts with "not plain white".
- `web/i18n/en.json` lines 68–69 still show users "History arrives in M3." and "…in M5b." The 390 px pane screenshot shows "Countdowns arrive with the Date tool in M2b." and the title "History, memory and countdowns".
- **Critic:** `date-tool.js:451` resolves an empty Age "as of" field to `clock.todayIso()` at run time. `date_info` also takes `today` (:504), and countdowns depend on "now". Re-running a stored Date entry later therefore gives a different answer unless the resolved reference date is stored with it.
- **Critic:** `shell/history.js` already defines the entry as `{tool, calculator, inputs:{name:string}, inputsText, resultText, copyText}` plus `timestampMs`. B10 already has `engine`, `pinned` and `note`.
- **Critic:** countdown items today are `{id, label≤60, targetDate, targetTime, createdAtMs, savedAtMs, finishedSeenAtMs}`. The finished wording already exists (`date.cd.phase.finished`).
- **Critic:** the only gradients in CSS are the title strips: `linear-gradient(--bar-bg, --bar-bg-end)`. They are flat in Terminal and Daylight because the two tokens are equal there, and visible only in Retro. That is correct and must stay so.

## 1. Design principles

- **The working is the product.**
  - Every result is shown together with its live formula: steps, then a gold `→ result`, updated as you type.
  - Nothing is animated, flashed or faded. A changed result is simply the new text.
  - This applies to every tool and to every history entry.
- **History first.** A result is not finished until it can be found, explained, restored, re-run and trusted later:
  - each save gives visible, static feedback;
  - every entry can show its working, deterministically, against the date it was recorded;
  - the app never deletes anything without the user asking for it.
- **Thumb first.**
  - Design at 360–390 px first, then scale up to desktop.
  - Primary actions sit within thumb reach and are 44 px or larger.
  - The answer stays in view while the keyboard is up.
  - Every gesture has a button that does the same thing.
  - Nothing moves under a finger while you type: no layout change is triggered by an input event.
  - The most frequent action on a row (Restore) takes one tap. Copy also gets its own button.
- **One structure, three skins.**
  - Terminal, Daylight and Retro share the same DOM, layout, order, wording, 44 px targets and monospace tabular numbers.
  - Themes change only colour, border texture (bevels, etched lines) and the chrome font, through role tokens in `tokens.css`. No theme gets different elements: Retro's "group box" is a border style on the same `<section>`, not a `<fieldset>`.
  - Colour never carries meaning alone: each colour comes with a name or glyph.
  - Every new token gets a value in all three theme blocks. It is AA-checked by `check-web` against the surfaces it is actually drawn on. Retro's teal `--bg` is a backdrop only, never under content.
- **Plain, honest wording.**
  - Rounding is shown (`≈`, "rounded half-even").
  - Storage state is shown when it is not the normal state (session only, read-only, not recording).
  - No internal codes such as "M5b" appear in the UI.
- **Local, private, safe by construction.**
  - No network, no frameworks, no HTML sinks, no `.style`, and no new CSP sources (no `font-src`, no `style-src` hashes beyond the existing ones).
  - Colours the user picks are stored as palette names and applied as classes, never as hex values. That keeps them within the CSP and lets them work in all three themes.
  - Copy text is always built from data, never from the DOM selection.
- **Build shared parts once, before the tools that use them.** The history entry shape lands in M3 core. Tokens, the trace console and the shortcut registry land before M5b. The calculators then inherit the look without extra work.
- **No engine behaviour changes for UI work.** Trace lines are built by each tool's UI from the numeric fields the engines already return, as `date-tool.js` and `percent-tool.js` do today. No golden regeneration and no engine-version bump.

## 2. Top 10, ranked by impact for the effort (history first)

### 1. Settle the M3 data shapes now (history, countdowns, state)

- **What:**
  - **History entry, schema v1.** It keeps the B10 fields:
    - `id`, `timestampMs`, `tool`, `calculator`, `calculatorLabel`;
    - structured `inputs`, `expressionText`, `inputsText`, `resultText`, `copyText`;
    - `pinned`, `note` (at most 200);
    - `engine` (the existing field; no second `engineVersion`).
  - It drops the legacy `origin`/`originKey` fields (owner clarification).
  - It adds only:
    - `parentId` (string or null);
    - `surface` (`"main"` or `"mini"`; no window number, which means nothing after a restart);
    - `mark` (a palette name or null);
    - **`ref`: the resolved reference instant the result depended on.** For Date this is `today`/`asOf`, the countdown "now" and the offset. For other tools it is null. Show working re-runs against `ref`, not against today.
  - **No `tags[]` in v1.** Marks plus notes plus pins cover finding and grouping with far less phone UI. Tags can come later with a normal schema bump.
  - **No rendered formula lines are stored.** The working is re-rendered from `inputs` + `ref` (see 5). `expressionText`/`inputsText` stay, because search and row display must not re-run the engine 2,000 times.
  - **Countdowns:**
    - `note` (at most 200 code points, `dir="auto"` when shown);
    - `mark` (a palette name; a New countdown takes the first mark not yet used, cycling).
  - **State:**
    - `nav.recent` (last 3 routes, which fixes the ⇄ quick switch being empty after a relaunch);
    - `nav.convertersFolded`;
    - `history.lastFilter`;
    - `cards.<tool>.introSeen` (see 8).
  - **Settings:** `history.enabled` already exists in B11; no new field.
- **Where:** `pcalc-api` validators (`history.validate`, `countdowns.validate`, `state.validate`), `shell/history.js`, `countdowns.js`, the frozen key-list fixtures, export/import.
- **Themes:** data only. `mark` is a name such as `"teal"`, which each theme maps to its own AA-safe value (item 7). Daylight and Retro need nothing extra.
- **Milestone:** M3 core, and it must be in schema v1. Tell the M3 workflow now. **Effort:** S.
- **Acceptance:**
  - The key-list fixtures include the new fields, and the bump-on-change test passes.
  - Export, then import into an empty store, then export again gives byte-equal output.
  - An unknown `mark` on import does not reject the entry. The entry is kept, `mark` becomes null, and the preview says "1 colour mark not recognised, cleared". History is never lost over a colour.
  - A Date Age entry recorded with an empty "as of" re-runs to the same result on a later simulated day.
  - The cap-edge test still holds 4 MiB with every new field at its maximum.
  - A newer-schema test refuses writes.

### 2. A thumb-first history pane (the hero)

- **What:**
  - **Sheet (below 760 px):**
    - Half and full heights, switched by a grab bar that is also a real Expand/Collapse button.
    - The title is the active tab's name.
    - Tabs History | Memory | Countdowns are always present and in a fixed order. Memory shows an honest empty line when the tool has no memory, so tabs never appear or disappear between tools.
    - The Countdowns tab shows a count and, when one has finished, a "finished" glyph plus the word in its accessible name.
  - **Filters:** one chip row (This tool · All · Pinned · Noted · each mark in use). The row scrolls horizontally inside itself only, with a visible fade-free edge and nothing past the edge that cannot be reached from the keyboard. The pane opens on the last filter, and on "This tool" the first time.
  - **Groups:** Today / Yesterday / This week / Earlier, as in B10, with counts. "Today" comes from `clock.js`.
  - **Rows:** two lines, like a terminal log:
    - first line: the time, a tool tag from the catalog (`[DATE]`, translated, with a `min-width` in `ch`, not fixed text), and the muted expression;
    - second line: the gold `= result`.
  - **Row actions:**
    - Tapping the row restores it (one tap, as B10 says: Restore = Enter).
    - A 44 px Copy button sits on the row.
    - A 44 px `⋯` opens Show working, Edit & re-run, Use result, Pin, Note, Mark, Make countdown (Date results only) and Delete.
    - Delete has a 5 s Undo that is also reachable with the keyboard (Ctrl+Z). Undo stays available from the pane menu until the pane closes, so the timer is not the only way back.
  - **Keyboard and screen readers:**
    - roving tabindex;
    - row keys Enter, C, P, N, Del and Ctrl+Z, ignored while typing in search;
    - the accessible name starts with the result: "55, Percentage, 50 + 10%, 2 min ago".
  - **Search:** on phones the search field sits at the bottom of the sheet, above the keyboard. Ctrl+F opens it (B5).
  - **Long lists:** windowed rendering in pages of 100.
  - **Clear all:** as B10 says (count confirmation; keep pinned on by default).
- **Where:** the pane, `shell.js`, `history.js`, `shell.css`. Docked on desktop at 1100 px and wider.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | Log rows on `--surface`, a 1 px `--border` rule between rows, muted expression, gold result, gold focus ring. |
  | Daylight | Paper rows on `--surface` with `--border` rules (a ledger), result in `#8A5F00`, focus ring `#8A5F00`. No white cards inside the pane. |
  | Retro | A white sunken list well (`--sunken`, `--field-bg #FFFFFF`), rows without per-row shadows, selection `#000080` with white text, a dotted focus rectangle, the day separator as an etched line (`#808080` over `#FFFFFF`), and a navy title strip with a bevelled × button. |

- **Milestone:** M3 (the list, restore, copy, delete and undo are B10's own scope); the extras go to M3b. **Effort:** L.
- **Acceptance:**
  - Every row action can be reached with keyboard only and with a screen reader; no action is gesture-only.
  - Delete announces itself once through the polite region, and Undo restores the entry with the same `id`.
  - With 2,200 entries the pane opens in 100 ms or less at 4× CPU throttling (median of 5 runs) in each theme.
  - At 360 px in en-XA and ar-XB, no row overflows, every target is 44 px or larger, and Copy and `⋯` sit at the inline end (left side in RTL).
  - Retro screenshot: the selected row is navy with white text and focus is dotted. Daylight screenshot: no `#FFFFFF` surface in the pane.

### 3. Save feedback and an honest storage status you can see

- **What:**
  - After a recorded save, the card shows a static line under its result: "✓ Saved to history". It is a link that opens the pane on that entry and never records anything itself. It stays until the next input, so there is no timer and no toast.
  - The polite region announces "Saved to history" once.
  - **Exception states** show as a persistent chip in the top bar (desktop) or on the bottom bar's History button (phone), only when storage is not normal:
    - `[session only]` (memory store; IndexedDB unavailable);
    - `[read-only]` (B10 load outcomes, `lastSaveError`);
    - `[not saving]` (`history.enabled` off).
    Tapping the chip opens Settings → Storage. In the normal state, nothing is added; the pane subtitle "Saved locally on this device." from B10 covers it.
  - **Recording toggle:** Settings → History (the B11 field) and the pane's `⋯` menu. Not a permanent control in the pane header, where it would cost phone space.
  - **No session count badge.** It is noise, and it was not asked for.
- **Where:** under each card's result, the bottom bar's History button, the desktop top bar, and the existing single polite region.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | `✓` and text in `--ok` (green). Exception chip: mono brackets in `--banner-text` on `--banner-bg`. No border flash. |
  | Daylight | `✓` in `#2E7A4B`. Exception chip uses the Daylight banner pair (`#4d3500` on `#f6ead0`). |
  | Retro | Plain black status-bar text with a `✓`. Exception chip is a tooltip-style yellow `#FFFFE1` with a 1 px black border. On desktop it sits in a sunken status-bar panel. |

- **Milestone:** M3. **Effort:** S.
- **Acceptance:**
  - Live typing never records and never shows the line.
  - Calculate, Enter or Copy shows the line once, and the announcer speaks once.
  - With recording off, an entry-count test shows no new rows and the chip reads `[not saving]`.
  - The read-only fixture shows `[read-only]`, and the no-IndexedDB boot shows `[session only]`.
  - Nothing animates in any theme or under `prefers-reduced-motion`.

### 4. One trace console for the live formula

- **What:**
  - A shared `shell/trace.js` module that renders an `<ol class="trace">` from `[{kind, text}]`.
  - Line kinds: `input` (`$`), `step` (`│`), `exact`, `rounded` (`≈`), `result` (`→`, gold, bold).
  - Glyphs are separate `aria-hidden="true"` spans. The CSS `content: "x" / ""` alt-text syntax is not used, because iOS 16.4 (our floor) does not support it.
  - `[copy steps]` builds plain text from the same data array, wrapped in LTR marks for RTL. Glyphs are never in it.
  - **Idle state:** the card's hint as plain text, with a `$` glyph.
  - **Error lines:** a `!` glyph in `--danger` plus the fix-it text from item 9.
  - **No changed-line highlight** (rejected below).
  - **Phone vs desktop:**
    - Date and Percentage: the trace is always open, as in v1.1/v1.2.
    - Standard, Scientific and Programmer on phones: the expression line and the `→ result` line always show. The full trace opens with one "Show steps" tap, and that choice is remembered per tool in `state`.
    - Open by default on desktop.
  - **Wording:** the UI builds the lines from the engines' numeric fields through catalog keys (B5c). There are no engine changes, so the percent-core `*Text`/`<br>` labels stay unused, as today.
- **Where:** first in the Date and Percentage cards (replacing their own formula code); Standard, Scientific, Programmer and the converters (with the NIST "exact" line) reuse it as-is.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | A `--trace-bg` well one shade darker than `--surface`, a green `--formula-label` "LIVE FORMULA", a 1 px `--border` rule above the result, the result in gold. This is exactly `v110-countdown.png`. |
  | Daylight | A `--trace-bg` paper well (`#F4F1EA` on a `#FBF9F4` card), label `#2E7A4B`, result `#8A5F00`. A plain `--border` rule above the result; no ruled-paper background image. |
  | Retro | The same section with an etched border (`--trace-border`: 1 px `#808080` + 1 px `#FFFFFF`), the label as black bold text on the first line, and the trace in a white sunken well with black mono text and the result in navy. Same DOM as the other themes; no `<fieldset>`. |

- **Milestone:** M3b, before M5b (M3 core is busy with storage). **Effort:** M.
- **Acceptance:**
  - Date and Percentage produce the same text as their current formulas (safety-eval B criteria and check-i18n line keys are ported).
  - Copy output contains no glyphs, and it is identical with and without CSS.
  - Nothing sets `.style`, and no `aria-hidden` glyph is announced by a screen reader.
  - Screenshots exist for all 3 themes at 390 px, plus ar-XB with LTR numbers inside RTL.

### 5. "Show working" and "Edit & re-run" from history

- **What:**
  - **Show working:**
    - Expanding a row re-runs the engine on `inputs` + `ref` and renders the trace (item 4) in the current language.
    - If the re-run result differs from `resultText`, both values are shown with "Recorded: … / Now: …" (the B10 rule).
    - Long traces show 8 lines plus "Show all".
    - Countdown entries show their working as of the recorded instant (`ref`), labelled "as of 14:02".
  - **Edit & re-run:**
    - It opens the owning card with a status line, "From history, 14:02 → 409 days". Calculators get this in M5b.
    - While you type, a muted `was: 409 days` line sits above the new gold result.
    - Calculate records a new entry with `parentId` set. The original is never changed.
    - The new row's `⋯` menu has "Go to original (14:02)". No extra line is added to every row on phones.
- **Where:** the history rows and the Date and Percentage cards in M3b; the calculators in M5b.
- **Themes:**
  - Shown inline in the pane, using the same trace component in all three themes.
  - The `was:` line uses `--muted-2`:
    - Terminal `#8f9aaf`;
    - Daylight `#5D6475`;
    - Retro `#333333`, with no extra frame. It sits inside the card's sunken well, so a second bevel would only be noise.
  - The mismatch pair uses `--danger` plus the words "Recorded"/"Now", so colour is never the only signal.
- **Milestone:** M3b (Date, Percentage); M5b (calculators). **Effort:** M.
- **Acceptance:**
  - Re-run output equals the original for every golden case, including Age, Date Info and Countdown entries replayed on a later simulated day.
  - A simulated engine change shows both values.
  - `parentId` survives export and import.
  - Switching the language re-renders the working in that language, while `resultText` stays as recorded.

### 6. Bring back the signature look on a role-token tier

- **What:**
  - **Fonts:** a mono UI font in Terminal and Daylight, with the Arabic/CJK fallbacks inside the mono stack: `--font-ui: <mono list>, "Noto Sans Arabic", "Noto Sans CJK SC/JP/KR", monospace`. Retro keeps Tahoma for chrome and mono for numbers.
  - **Type:** a type scale (`--fs-xs … --fs-display`) and `font-variant-numeric: tabular-nums` on every number.
  - **Primary button:** filled gold, with `--on-accent` for its text.
  - **Rail:** a gold inline-start rail on the result and on the focused card (`--rail-width`, `border-inline-start`, so it mirrors in Arabic).
  - **Labels:** a green "LIVE FORMULA" label (`--formula-label`) and a gold countdown clock (`--clock`).
  - **Role tokens:**
    - `--field-bg`, `--trace-bg`, `--trace-border`;
    - `--display-bg/-text`, `--key-*`;
    - `--mark-*` (item 7);
    - `--plot-*` (M8).
  - **Lint:** `check-web` fails when `components.css`, `shell.css` or `tools.css` read `--gold`/`--green` directly; components use role tokens only.
- **Where:** `tokens.css`, `components.css`, `tools.css` (`.result`, `.formula-title`, `.cd-clock`, `.btn-primary`), `check-web.mjs`.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | Exactly the v1.1 look: mono throughout, a 4 px gold rail, a green label, a gold clock, square corners, 1 px borders. |
  | Daylight | Fill `#8A5F00` with `#FBF9F4` text. Rail `#8A5F00`, label `#2E7A4B`. `--surface-raised` changes from `#FFFFFF` to `#FFFDF8` (no plain white; `--finished-text` stays a light value). Mono, square corners. |
  | Retro | No fill: the primary button is a raised silver button with the Win95 1 px black "default button" outer ring. `--rail-width: 0`, because the sunken result well marks the result. `--field-bg #FFFFFF`. Tahoma for chrome, mono for numbers. |

- **Milestone:** M3b, because the lint refactors existing CSS that the M3 workflow is editing now. Checked again in M9b. **Effort:** S–M.
- **Acceptance:**
  - `check-web` passes AA for every new pair in all three themes.
  - The lint fails if a component reads a palette token directly (mutant proof).
  - browser-boot at 360 px for en-XA (mono is wider) and ar-XB shows no horizontal overflow and no clipped drawer labels.
  - The rail is on the right side in `dir=rtl`, and Arabic text renders in an Arabic font, not tofu.
  - Terminal screenshots match `v110-countdown.png` for the rail, label and clock colours.
  - Plan B5b gets the Daylight `#8A5F00` and `#FFFDF8` values.

### 7. Countdowns with marks, notes and New/Duplicate (the queued request)

- **What:**
  - **Colour palette:** 8 named marks (gold, green, sky, violet, coral, teal, rose, slate), defined as `--mark-<name>` in all three themes and applied as `.mark-<name>` classes. Each mark also has a glyph (● ▲ ■ ◆ ★ ✚ ▼ ⬟) and a translated name ("Teal").
  - **Colour use:** a mark is always a UI part (rail, swatch, glyph), never coloured text. Labels stay `--text`, so marks need 3:1.
  - **Picker:** a radiogroup of 44 px swatches, each showing its glyph, with arrow-key navigation and the name in the accessible label. The user can change the mark at any time; that is the owner's request.
  - **Date card:**
    - It edits one selected countdown.
    - A "Countdown: [label ▾]" switcher (a native `<select>`, so two taps on a phone) sits above the label field.
    - "New" and "Duplicate" buttons sit next to it.
    - Duplicate copies the target, label (with " (copy)" from the catalog), note and mark, then moves to the next free mark.
  - **Countdowns tab:** a vertical list of all countdowns (up to 20), the full manager. Each row shows:
    - the mark rail and glyph;
    - the label;
    - a compact tabular clock;
    - the finished wording (`date.cd.phase.finished`, existing);
    - the first line of the note as a muted `# note`.
    There is no horizontal scroll-snap strip, which would hide countdowns off-screen on phones.
  - **Readout on the card:** a jitter-free clock (`--fs-display`, tabular, zero-padded), as in v110.
  - **Shared colours:** the same marks colour history entries (`mark`) and, in M8, graph series, together with dash patterns.
- **Where:** `countdowns.js`, the Date Countdown card, the Countdowns tab, `tokens.css`.
- **Themes:**

  | Theme | Marks and clock |
  |---|---|
  | Terminal | Muted hues in the gold/green family, with no neon or glow. Each value is at least 3:1 on `#161822` and `#0E0F12`. The clock is gold mono on the dark well, as in v110. |
  | Daylight | Deepened inks, each at least 3:1 on `#FBF9F4` and `#FFFDF8` (the gold mark is `#8A5F00`). The clock is `#8A5F00` mono. |
  | Retro | VGA-style values checked on silver `#C0C0C0` and white `#FFFFFF`. Starting set: gold `#806000`, green `#005A00`, sky `#000080`, violet `#800080`, coral `#800000`, teal `#005F5F`, rose `#80003F`, slate `#404040`. Plain `#008080` teal is about 2.5:1 on silver and fails 3:1, so it is darkened. Swatches are drawn as bevelled squares. The clock sits in a white sunken well in black or navy mono; there is no seven-segment font. |

- **Milestone:** M3 core (schema, item 1) + M3b (UI). **Effort:** M.
- **Acceptance:**
  - All 24 mark/theme pairs reach 3:1 or better against every surface they are drawn on in that theme.
  - Label, glyph and name always show, so countdowns can be told apart without colour, including in `forced-colors`.
  - Duplicate copies the note and the target.
  - Re-importing an exported countdown keeps its mark and note.
  - The clock width stays constant across 60 ticks (measured).
  - At 360 px the switcher, New and Duplicate fit on one line in en-XA, or wrap without overflow.

### 8. Keep the answer in view on phones, and compact card intros

- **What:**
  - **Answer in view:**
    - Below 760 px, when a field gets focus, the card scrolls (`scrollIntoView({block: "nearest"})` on a wrapper around the focused field and the card's result line) so both are visible above the keyboard.
    - The result line sits directly under the input block in DOM order on every card.
    - **No duplicate sticky "answer strip"** (rejected below). A `position: sticky` element cannot follow the iOS visual viewport without setting `.style`, which our rules forbid.
    - The E-07 bottom bar already hides while a field has focus, which frees the space.
  - **Compact intros:**
    - Below 540 px, a card's description shows in full until the card has been used once, tracked in `state.cards.<tool>.introSeen`. After that it collapses to an `ⓘ` toggle.
    - The collapse happens on blur or Calculate, never while a field has focus, so the field never jumps under the finger.
  - **Reordering stays:** the v1.2 drag handle and the Move menu both remain.
- **Where:** `card-layout.js`, `tools.css`, every card, the `shell.js` focus handling.
- **Themes:** layout only, so it is the same in all three. The `ⓘ` toggle uses the existing button tokens:
  - Terminal: a thin-bordered mono `ⓘ`;
  - Daylight: a `--border` outline on paper;
  - Retro: a small raised bevelled button with a dotted focus rectangle.
- **Milestone:** M3b; the calculators reuse it in M5b. **Effort:** S–M.
- **Acceptance:**
  - At 390 px, with a field focused and the keyboard simulated (both the visualViewport-shrink and layout-resize cases), the field and the result are both inside the visible viewport for every Date and Percentage card.
  - No element changes position while typing (layout-shift check during input events).
  - At 390 px, a used card's header is 64 CSS px or less.
  - The Move menu works by keyboard and screen reader alone.

### 9. Honest number entry and field-level errors

- **What:**
  - **Field errors:** a shared `fieldError(input, key)` helper that:
    - sets `aria-invalid` and `aria-describedby`;
    - shows a `!` glyph and a `--danger` border, so the error is not shown by colour alone;
    - puts a "Go to Cost" link in the result box;
    - gives every error key a fix-it sentence, for example "Cost cannot be zero. Enter the price you paid.";
    - stops Date from showing engine English text (catalog keys per error code).
  - **Number entry:**
    - A `±` button at the inline end of **only the fields that accept negative values** (Percentage change and difference fields, later calculator fields). Date fields and count fields do not get one. This fixes the E-10 open item: the iOS decimal keypad has no minus key.
    - `enterkeyhint="next"` moves to the next field, and "done" on the last field calculates.
    - **No grouped "ghost line" under each field.** The trace's `$` input line already shows the grouped value, so there is no extra line per field on phones.
- **Where:** `percent-tool.js` (cardError), `date-tool.js` (errorText), the shared field helpers; later inherited by M5–M8.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | A `--danger` (`#F0857A`) `!` and border, and a `.chip`-style `±` with a thin border. |
  | Daylight | `--danger #B3261E` `!` and border on paper, and an outlined `±`. |
  | Retro | The error text as an inline line under the sunken field, in `--banner-bg #FFFFE1` with a 1 px black border (balloon colours; an inline line, not a positioned popup). A maroon `#800000` `!`, and a raised bevelled `±` that presses in. |

- **Milestone:** M3b; inherited by M5–M8. **Effort:** S.
- **Acceptance:**
  - A grep test shows `aria-invalid` set on every error path and cleared on recovery.
  - Only the polite region speaks.
  - Entering a negative value with `±` passes the PCT vectors that have negative values.
  - The caret position is unchanged after `±`.
  - No Date error shows raw engine English in en-XA.

### 10. A shortcut registry (Find palette later)

- **What:**
  - **Registry:** `shell/shortcuts.js`, a frozen table of `{id, keys, scope, labelKey, run, allowInBrowser}`. It drives:
    - the key handler;
    - `aria-keyshortcuts`;
    - the About list;
    - a `?`/F1 cheat sheet (ignored while a field has focus).
    It covers the B5 bindings (Alt+1–6, Ctrl+H, Ctrl+F, Ctrl+Shift+M, …).
  - **Drawer:**
    - Recent tools are persisted (item 1 `nav.recent`) so ⇄ works after a relaunch.
    - The Converter group can be folded. It starts folded on phones, and the choice is remembered.
    - No Pinned section in v1.0, which would add drawer height on phones.
  - **One Find palette** (Ctrl+K: routes, actions, settings rows, countdown labels, units) is **deferred to M9**, after the tools exist. History search stays in the pane (Ctrl+F) and is not duplicated.
- **Where:** `shell.js` (`onKey`), the drawer, About, `en.json about.shortcuts.*`. It reuses `openModal`/`trap` for the cheat sheet.
- **Themes:**

  | Theme | Treatment |
  |---|---|
  | Terminal | The cheat sheet is a mono two-column list with thin 1 px keycaps in `--border-strong`. |
  | Daylight | The same list on paper, with keycaps in `--border` and `#1F2330` text. |
  | Retro | A dialog with a navy title strip, bevelled keycaps and a `[+]`/`[−]` fold on the drawer's Converter group. |

- **Milestone:** registry, cheat sheet and drawer state in M3b; Find palette in M9. **Effort:** S–M.
- **Acceptance:**
  - safety-eval fails if a key is bound twice in one scope (mutant proof).
  - The About list, the cheat sheet and the handler all come from the one table.
  - The cheat sheet passes the focus-trap and inert checks in browser-boot.
  - Recent tools persist across a relaunch (state schema).
  - At 390 px, Settings and About are reachable without scrolling the drawer when Converter is folded.

## 3. Also worth doing

1. **Shared keypad and calculator display** (M5b):
   - one keypad component in the bottom-bar slot, with `00 . ± % ⌫ Next =`;
   - the display shrinks long numbers with `.len-*` classes;
   - fields keep a native-keyboard fallback.

   | Theme | Keypad |
   |---|---|
   | Terminal | Square 1 px-bordered keys and a gold `=`. |
   | Daylight | Ink digits on paper keys and a `#8A5F00` `=`. |
   | Retro | Navy digits and maroon operators on raised silver keys that press in (`--pressed`; no animation under reduced motion), as in the Win95 calculator. |

2. **Card jump chips** (M3b): one non-sticky chip row under the tool title on phones, linking to each card. It is hidden at 1100 px and wider. The "One card at a time" mode is dropped, because the v1.2 collapse already covers it.
   - Terminal: mono `.chip`.
   - Daylight: outlined chips.
   - Retro: raised buttons with a dotted focus rectangle, not fake tabs.
3. **"Use in…" typed handoff** (`{kind, value, unit, from}` over `bus.js`):
   - the contract in M3b, Standard as a target in M5b;
   - the same path as history's Use result;
   - it shows a removable "from Date · 1,234 days" chip, which uses the chip tokens in each theme.
4. **Mini Calculator history tape** (M5b+):
   - the last 20 Standard entries;
   - inserting a non-numeric entry is disabled with "Not a number";
   - entries recorded from Mini carry `surface:"mini"`;
   - Ctrl+V shows the parsed expression before evaluating it.

   It follows the theme like the rest of Mini. In Retro it is a white sunken list under the title strip.
5. **Copy as text, Share and an export preview** (M3):
   - `navigator.share({text})`, user-initiated only, hidden where it is unsupported (WebView2);
   - CSV/JSON for the selected entries, with B10's CSV injection rule;
   - "3 entries, 2 notes will be exported" shown first.
6. **Settings split into sections plus a Display section** (M3 schema, wired in M5a):
   - Display covers grouping, decimals, notation and display rounding, formatted by the UI tables (B5c), with `≈` shown when a value was rounded;
   - Retro already draws Settings sections as title-strip windows (see the 1280 px screenshot), and that stays.
7. **Honest empty states** (M3):
   - replace the `en.json` strings at lines 68–69 and any "M2b"/"M5b" text with plain sentences such as "No calculations yet. Results you calculate or copy are saved here.";
   - a `check-i18n` rule fails on `\bM\d` in user-facing strings;
   - the `offline · local · private` tagline comes back in About and the drawer footer.
8. **Finishing Daylight and Retro** (M9b):
   - **Retro:**
     - tool-card title strips;
     - on phones, the bottom bar as a silver taskbar with a pressed active item;
     - the ☰ button as a raised "Menu" button. It never says "Start". Any XP-green fill must pass AA with white text, or it stays silver.
   - **Calendars:**
     - Daylight calendar ends drawn as inked outlines;
     - the Retro calendar in one white sunken well.
   - **Theme picker:** live specimens drawn from the same tokens.
   - **Browser chrome:**
     - `theme-color` meta set with `setAttribute` from the stored theme's `--bar-bg` (not `.style`);
     - themed scrollbars through `scrollbar-color` (bevelled `::-webkit-scrollbar` in Retro only).
9. **Test harness:**
   - a build-flagged `#/specimen` route, excluded from release builds, that renders every component in the three themes with computed contrast checks (M3b, growing each milestone);
   - an invariants lint: `[data-theme]` rules may not set layout properties;
   - a no-animation lint: no `@keyframes`, and `transition` only through `--transition`;
   - performance budgets (M9): input to result p95 ≤ 50 ms, history search ≤ 30 ms.
10. **Comfort options:**
    - text size 100–150% (M9b);
    - honour `prefers-contrast: more` with a 7:1 token set per theme rather than a new setting (M9b, only if time allows);
    - an "Install for offline use" row and "Offline ready" in Settings → Storage (M9);
    - a side rail for landscape phones (M9).

## 4. Rejected and why

| Idea | Why |
|---|---|
| Free hex colour picker | It needs `.style` or a dynamic stylesheet, which the DOM rule and the CSP forbid. It also cannot pass contrast in all three themes. Use named marks. |
| Storing rendered formula lines in history | The text would be stuck in one language, add pressure on the 4 MiB cap, and drift from the engine. Re-render from `inputs` + `ref` and show both values on a mismatch. |
| Swipe-to-delete or any gesture-only action | It clashes with the back gesture, and a `⋯` button already covers it. |
| Automatic retention trimming | It silently deletes the owner's top-priority data. Only a manual "Clear a date range" with a count confirmation. |
| Per-field "Recent values" chips | They clutter phone cards and show values on a shared screen. Edit & re-run covers the need. |
| Private session mode (for now) | It adds a third storage state. The Recording toggle covers the need; revisit in M9. |
| Compare two entries (for now) | Large effort for niche value. Revisit after M9 with engine-computed differences only. |
| Removing the drag handle on phones | It undoes a v1.2 feature the owner asked for. Collapse the intro instead. |
| Separate Ctrl+F and Ctrl+K palettes | They would duplicate each other. Ctrl+F is history search; one Find palette comes in M9. |
| Typewriter or animated formula, animated save toasts, border flashes | A result must be immediate and honest. Nothing animates. |
| **Changed-line highlight in the trace** (critic) | Most lines change on every keystroke, so it would flicker constantly. That is noise, not information, and a fade is an animation. |
| **Sticky phone "answer strip"** (critic) | It duplicates the result. It cannot follow the iOS visual viewport without `.style`. Scrolling field + result into view does the job. |
| **Grouped "ghost line" under every field** (critic) | It adds a line per field on phones. The trace's input line already shows the grouped value. |
| **History `tags[]` in v1** (critic) | A tag editor is fiddly on phones and overlaps with marks, notes and pins. Add it later with a normal schema bump. |
| **Timed "Saved · Undo" toast and session count badge** (critic) | Undoing a save is not needed, and timed controls hurt accessibility. A static "✓ Saved to history" link is honest and calm. |
| **Horizontal scroll-snap strip of countdown tiles** (critic) | It hides up to 19 countdowns off-screen on phones. Use a vertical list in the tab and a switcher on the card. |
| **`<fieldset>` group box only in Retro** (critic) | Themes may not change the DOM. Retro draws an etched border on the same section. |
| **Tabs that appear and disappear per tool** (critic) | A changing tab set moves targets under the thumb. Memory stays in place with an honest empty line. |
| **`surface: "mini-<n>"`** (critic) | Window numbers mean nothing after a restart. Use `"main"` or `"mini"`. |
| **CSS `content` alt-text for trace glyphs** (critic) | iOS 16.4 does not support it. Use `aria-hidden` spans, and build Copy from data. |
| **Drawer "Pinned tools" section** (critic) | It adds drawer height on phones. Recent + ⇄ + Alt shortcuts cover it in v1.0. |
| Retro bitmap font | Extra weight and a CSP `font-src` change. Use Lucida Console/Consolas with `slashed-zero`. |
| Onboarding tour or tip system | The card intros and empty states already say it plainly; revisit only if testing shows a need. |
| Pane title "History, memory and countdowns" | The pane title is the active tab's name in every theme. |

## 5. Milestone mapping

M3 is being built right now. Only item 1 changes the M3 schema v1, and it must reach the M3 workflow before M3 core closes. Changing it later costs a schema bump and an upgrade path. The countdown `mark`/`note` fields from item 7 are part of item 1.

Everything else changes UI or CSS that the M3 workflow is also touching, so it goes into a new small milestone, **M3b "History and signature pass"**, before M5a. M5b+ then inherit it.

**Build order inside M3b:** tokens (6), then trace (4), then pane extras (2), then show working (5), then countdown UI (7), then field errors (9), then answer in view (8), then registry (10).

| # | Improvement | Milestone | Effort |
|---|---|---|---|
| 1 | Data shapes: history `parentId`/`surface`/`mark`/`ref`, countdown `mark`/`note`, state nav | **M3 core (blocking)** | S |
| 2 | Thumb-first history pane | M3 (B10 list, restore, copy, delete, undo) + M3b (filters by mark, Show working entry points) | L |
| 3 | Save feedback and exception-only storage status | M3 | S |
| 4 | Trace console | M3b; reused in M5b, M5c, M6, M7, M8 | M |
| 5 | Show working and Edit & re-run | M3b (Date, Percentage); M5b (calculators) | M |
| 6 | Signature look on role tokens + lint | M3b; checked again in M9b | S–M |
| 7 | Countdown marks, notes and New/Duplicate | M3 core (schema) + M3b (UI) | M |
| 8 | Answer in view and compact intros | M3b; reused in M5b | S–M |
| 9 | Number entry (`±` where negatives are valid) and field errors | M3b; inherited by M5–M8 | S |
| 10 | Shortcut registry, cheat sheet, drawer state | M3b; Find palette M9 | S–M |
| Also 1 | Shared keypad and display | M5b | L |
| Also 2 | Jump chips (non-sticky) | M3b | S |
| Also 3 | Use in… handoff | M3b (contract); M5b (targets) | M |
| Also 4 | Mini history tape | M5b+ | M |
| Also 5 | Share and export preview | M3 | M |
| Also 6 | Settings sections and Display | M3 (schema); M5a (wiring) | M |
| Also 7 | Honest empty states (en.json :68–69) | M3; the check-i18n rule from M3 | S |
| Also 8 | Daylight and Retro finishing | M9b | M |
| Also 9 | Specimen route, invariants and no-animation lints, performance budgets | M3b (harness, lints); M9 (budgets) | M |
| Also 10 | Text size, contrast-more tokens, install row, landscape rail | M9b / M9 | S–M |
| — | Fix plan B5b: Daylight gold `#8A5F00`, raised `#FFFDF8`, mono `--font-ui` in Terminal and Daylight | next plan or docs commit | S |

The main files behind these findings:
- `D:\Claude Projects\Portable Calculator Tool\Documentation\specs\5- PORTABLE_CALCULATOR_PLAN.md`
- `D:\Claude Projects\Portable Calculator Tool\web\styles\tokens.css`
- `D:\Claude Projects\Portable Calculator Tool\web\src\shell\history.js`
- `D:\Claude Projects\Portable Calculator Tool\web\src\tools\date\date-tool.js` (:451, :504)
- `D:\Claude Projects\Portable Calculator Tool\web\src\tools\date\countdowns.js`
- `D:\Claude Projects\Portable Calculator Tool\web\i18n\en.json` (:68–69)
- `D:\Claude Projects\Portable Calculator Tool\Documentation\pbs\CONTINUATION_STATE.md`

## Critic changes

1. **Re-ranked for history first.** Data shapes, the pane, save feedback, the trace and Show working are now ranked 1–5. The signature look moved to 6.
2. **Added a `ref` reference instant to history entries.** Date results depend on today and now (`date-tool.js:451/:504`), so a re-run without it would report false mismatches.
3. **Trimmed the schema.**
   - Dropped `tags[]` (phone UI cost, overlaps marks).
   - Reused the existing `engine` field instead of adding `engineVersion`.
   - Changed `surface` from `mini-<n>` to `"main"|"mini"`.
   - Kept `expressionText`/`inputsText` so search does not re-run the engine.
   - Removed the legacy `origin`/`originKey` per the owner.
   - An unknown `mark` on import now clears the mark instead of rejecting the entry, so history is never lost over a colour.
4. **Themes: removed DOM differences between themes.** Retro no longer gets a `<fieldset>`; it gets an etched border on the same section. The answer strip and Retro balloon popups are now inline lines. Every item states its Terminal, Daylight and Retro treatment.
5. **Themes: fixed failing values.**
   - Retro marks are checked on silver and white, not teal. `#008080` on `#C0C0C0` (about 2.5:1) is replaced with `#005F5F`, and named starting values are given.
   - Marks are UI parts (3:1) and never coloured text.
   - Daylight raised surface `#FFFDF8` to honour "not plain white".
   - Terminal marks are muted, not "neon".
6. **Essence: removed all motion and noise.** No changed-line fade, no border flash, no timed toast, no session badge, no horizontal tile strip. A no-animation lint was added.
7. **Phone-first changes.**
   - Row tap = Restore, plus a direct Copy button; `⋯` holds the rest.
   - Tabs no longer appear and disappear between tools.
   - Card intros never collapse mid-typing.
   - `±` appears only where negatives are valid.
   - The ghost grouping line is dropped.
   - The drawer Pinned section is dropped.
   - The jump chips are no longer sticky.
   - The Recording toggle moved out of the pane header.
8. **Feasibility.**
   - The sticky answer strip is replaced by scrolling the field and the result into view. iOS visual-viewport tracking would need `.style`.
   - CSS `content` alt text is replaced by `aria-hidden` spans, because iOS 16.4 lacks it.
   - Trace lines are built by the UI from existing engine numbers, so there is no engine change and no golden regeneration.
   - The Arabic/CJK fallbacks are put inside the mono UI font stack.
9. **Scope and timing.**
   - Only the schema goes into the in-flight M3 core. The UI and CSS-refactor items move to M3b to avoid clashing with the M3 workflow.
   - The Find palette is deferred to M9, after the tools exist.
   - "More contrast" now follows `prefers-contrast` instead of a new setting.
   - Save feedback shows storage state only when it is abnormal.
10. **Kept from the original:**
    - the plan B10 groups (added back "This week");
    - the existing finished wording;
    - the v1.2 drag handle and Move menu;
    - Retro's existing title-strip gradient, which is the only gradient and stays flat in Terminal and Daylight.