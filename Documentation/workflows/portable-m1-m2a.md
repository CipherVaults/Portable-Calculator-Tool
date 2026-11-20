# Brief: portable-m1-m2a

**Kind:** build. **Used:** 2026-11-18. **Result:** M1 (Ledger E-04), M2a (E-05), and the review fixes (E-06: 20 findings, 19 fixed, 1 to the owner, then resolved by E-07).

## Purpose

Finish M1 (native/WASM parity and the CSP boot proof), build M2a (the phone-first shell, adapters, theme and i18n infrastructure, stores, the service worker and the rescue view), then review and fix.

## Phases

| Phase | Agents | Role |
|---|---|---|
| M1 | 1 implementer | Random parity, CSP and boot proof, budgets |
| M2a | 1 implementer | Shell, adapters, stores, service worker, i18n and theme infrastructure |
| Review | 2 in parallel | Lens A and lens B (below); no edits |
| Fix | 1 | Verify, fix, re-run, commit, ledger |

## Context (substance)

- The repository on `dev` with `origin` (public). Read AGENTS.md, CONTINUATION_STATE and the ledger first.
- **Rules:** Cargo only from PowerShell; LF; DOM through textContent / createElement / replaceChildren only; never `.style`; no innerHTML, eval or new Function; the strict web CSP (`script-src 'self' 'wasm-unsafe-eval'`, hash-pinned inline only); pure engines; plain Node scripts.
- **Gates:** commit on `dev` in the owner's style; no push, no `main`, no releases, no settings, no Pages.

## M1 demands

1. A seeded random native-vs-WASM differential test in `check-wasm.mjs`: at least 200,000 requests over every op, unknown ops, malformed JSON, invalid UTF-8 and cap edges, byte-compared, with the seed printed and the runtime stated.
2. Attach the B2 per-op caps; `request_too_large` behaves identically on native and WASM.
3. `scripts/browser-boot.mjs`: headless Edge over CDP with throwaway profiles. Boot the served multi-file site and the `file://` single file, and assert `data-boot="ok"`, 0 `securitypolicyviolation` events, 0 console errors, and the engine SHA-256 check. A no-WASM case shows the read-only rescue view. WebView2 is covered by the desktop smoke test; WebKit and Gecko are recorded as manual owner checks, not installed.
4. Record the WASM size, boot time and desktop `engine_call` IPC timing (the graph payload waits for M8).
5. Wire the random diff and browser-boot into CI (browser-boot in the Windows job, where Edge is preinstalled).

## M2a demands

The M2a phase ran with a resume note: inspect the uncommitted tree first and keep what is sound.
1. **Phone-first shell:**
   - a top bar with the ☰ drawer and the tool title; the drawer groups Calculator, Tools and Converter, and routes exist as placeholders;
   - the History | Memory | Countdowns pane as a bottom sheet below 760 px, an overlay at 760–1100 px and docked above that;
   - a hash router that restores the last route, and the Alt+1..6 and Ctrl+H shortcuts;
   - no horizontal scroll at 360–440 px.
2. **Tokens:**
   - three themes as token sets, with a hash-pinned pre-paint script;
   - a Settings > Appearance picker;
   - forced-colors and reduced motion handled;
   - a static ban on raw colours outside `tokens.css`;
   - AA contrast computed per theme.
3. **i18n:**
   - the en catalog with placeholders and CLDR plurals for the 12 languages;
   - format tables with Western and Arabic-Indic digits;
   - `<html lang dir>` and logical CSS only, statically checked;
   - pseudo-locales en-XA and ar-XB;
   - `check-i18n.mjs`.
4. **Stores:**
   - `load`, `save` and `clear` for settings, state, history and countdowns;
   - desktop: hardened files with raw `schemaVersion` first, the newest 3 timestamped backups, read-only on any non-NotFound failure, and `request_too_large` never treated as corrupt;
   - web: IndexedDB with BroadcastChannel notices and a memory fallback with a banner;
   - validation through engine ops.
5. **Service worker:** a hashed asset list, a versioned cache, atomic precache and prefix-limited cleanup, plus an upgrade test (build N, then N+1, online and offline).
6. **Desktop:** the same shell, the theme background from the first frame, and a smoke test covering routes, store round trips and theme switches.
7. **safety-eval** slices B and C for the shell, with mutant proofs.

Verification: all earlier checks plus check-i18n, contrast and browser-boot with the upgrade test, and phone screenshots in a scratch folder.

## Review lenses

- **A: spec conformance, correctness, data durability and CI.** Re-run the full list. Check that unreadable data is never overwritten, backups exist, a newer schema stays read-only, quota failures are never silent, the service-worker upgrade is safe, the pre-paint hash is in the CSP, the parity claims hold, and the records are accurate.
- **B: phone UX, accessibility, security, themes and i18n.** Serve the build and inspect it at 360/390/440 px and on the desktop. Check one-handed reach, 44 px targets, safe areas, focus trap / Escape / focus return, no horizontal scroll, theme switches without a flash and with contrast, ar-XB mirroring with numbers kept LTR, en-XA clipping, shortcuts, ARIA, DOM safety and the CSP, and no personal paths in the built output.

## Reuse

Use for an infrastructure milestone followed by a UI milestone. Keep the positive controls (a planted CSP violation must be seen) and the in-page assertions instead of trusting browser flags: Edge 157 ignores `--js-flags=--noexpose_wasm`.
