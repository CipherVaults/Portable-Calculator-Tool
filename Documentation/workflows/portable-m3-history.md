# Brief: portable-m3-history

**Kind:** build. **Used:** 2026-11-19, from `e97b1a6`. **Result:** M3 (Ledger E-11: `a0a8152`, `2d73568`, records `9f87931`). It ran across the handoff: an uncommitted Rust half from an earlier run was found, reviewed and kept. Its review phase was run again on the committed work as [portable-m3-review](portable-m3-review.md).

## Purpose

Build M3 per plan B10/B11: the unified history (the owner's top priority), settings/state/countdowns durability, export/import, and the iPhone ± key. Then review and fix.

## Phases

| Phase | Agents | Role |
|---|---|---|
| M3 | 1 implementer | History store, panel, export/import, ± key, tests |
| Review | 2 in parallel | Lens A (durability first) and lens B (phone, accessibility, security) |
| Fix | 1 | Verify, fix, re-run, commit, ledger |

## Context (substance)

Read AGENTS.md (the verification list is mandatory), CONTINUATION_STATE, the ledger including the deviations and open actions, and plan B10, B11, B5a (the Mini Calculator will share this history) and B16. No legacy migration: no `origin`/`originKey`, no `legacy.*` ops. The usual rules and gates apply (no push, no `main`, no releases, no settings).

## Implementer demands

1. **History store:**
   - one document `{schemaVersion:1, entries}` with the B10 entry schema;
   - caps: text 1,024, copyText 4,096, note 200, 2,000 unpinned (oldest evicted) + 200 pinned (never evicted), 4 MiB, duplicate-newest merge;
   - `history.validate` in `pcalc-api`, strict per tool: Date's 15 input fields, Percentage's `{inputA, inputB, inputC?, mode?}`; the other tools refuse everything until their milestones;
   - durability per B10:
     - the raw `schemaVersion` is read first; newer → read-only and never written;
     - NotFound → empty and writable; any other error or too-large → read-only and untouched;
     - corrupt → a timestamped backup, then read-only; Retry;
     - "Start a new history" always keeps a copy;
     - a write failure keeps entries in memory with an Export banner, and nothing is dropped silently;
   - BroadcastChannel sync between windows with no lost writes when two record at once, proven with a two-writer test.
2. **Wire** the Date and Percentage `history.record` hooks into the store. Calculate, Enter and Copy record; live typing never does.
3. **History panel** (the bottom sheet on phones):
   - search ignoring case, with Western and Arabic-Indic digits normalised;
   - filter chips All / Pinned / per tool; groups Today / Yesterday / This week / Earlier;
   - Restore, Copy, Pin, Note, and Delete with Undo;
   - Use result into a compatible field;
   - Clear all with a count and "keep pinned" on by default;
   - the `history.enabled` setting;
   - windowed rendering that keeps 2,200 entries smooth on a phone;
   - restore re-renders in the current language.
4. **Export and import:**
   - JSON (`portable-calculator-export`, formatVersion 1) and CSV, where cells starting with `= + - @`, tab or CR get a `'` prefix;
   - import up to 8 MiB through `history.import_preview` ("N new · M duplicates · K rejected"), then one atomic commit; merge by id, never replacing existing entries;
   - web: a Blob download and "Copy export to clipboard" (iOS standalone apps);
   - desktop: a new file in Downloads. Decide between the dialog plugin and a fixed path, preferring no new plugin, and document the choice.
5. **The ± key** on every signed numeric field (the iOS decimal keypad has no minus): 44 px, `inputmode` kept, Arabic-Indic digits still accepted.
6. **Tests:**
   - Rust: validators at cap/cap+1, durability paths, import idempotence, CSV escaping, two-writer merge;
   - safety-eval B/C with a mutant for every durability and UI rule;
   - browser-boot: the panel at 360/390/440 px with a stated 2,200-entry performance budget and the measured time, a real export download and the clipboard fallback, and the import preview.

## Review lenses

- **A: data durability first, then B10/B11 and correctness.** "Try hard to lose or corrupt history": concurrent writers, quota errors, a crash mid-write, corrupt, oversize or newer files, hostile imports (CSV/JSON injection, 8 MiB+1, duplicate ids, wrong types), eviction never touching pinned entries, undo races, clear-all with keep-pinned.
- **B: phone UX, accessibility, security and i18n/RTL.** Check thumb reach in the bottom sheet, 44 px targets, search/filter/undo by keyboard and screen-reader semantics (live regions not chatty, focus after delete/undo/restore), contrast in 3 themes, ar-XB with mixed digits, en-XA overflow, 2,200-entry scrolling, no HTML sinks, no data leaving the device, export names and the clipboard fallback.

## Reuse

Use for a data-durability milestone. Keep "try hard to lose data" as the first lens, demand a fake that models real concurrency (the fake IndexedDB serialises readwrite transactions), and state performance budgets in the test with measured values.
