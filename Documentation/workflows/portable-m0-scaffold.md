# Brief: portable-m0-scaffold

**Kind:** build. **Used:** 2026-11-18. **Result:** milestone M0 (Ledger E-01, E-02); the review findings fixed in E-03 (the engine path-leak gate and safety-eval slice D).

## Purpose

Create the local repository and build M0: the workspace with the two ported engines and the new crate skeletons, the wasm32 build, the desktop shell with its smoke test, the web skeleton and scripts, the dev-only CI and the PBS records.

## Phases

| Phase | Agents | Role |
|---|---|---|
| Scaffold | 1 implementer | Builds the repository in a fixed order (below) and verifies |
| Review | 1 independent reviewer | Reads everything, runs the checks, structured findings; no edits |
| Fix | 1 | Verifies each finding against the code, fixes the confirmed ones, re-runs the checks, commits |

## Context (substance)

- Read the plan's owner clarifications, then B1–B5c, B10, B11, B14, B16, B17 and B19.
- The owner clarifications override the plan: no legacy migration; fixes and hardening without waiting; phone-first.
- **Hard gates at the time:** no GitHub repository, no remote, no push; the Date repository is read-only; no user data.
- **Shell rules:** Cargo only from PowerShell; LF everywhere (`core.autocrlf false`, `.gitattributes`).

## Implementer steps

1. `git init`. The **first commit, on `main`, has no `.github/workflows`**, so a later push of `main` cannot release. Everything else goes on `dev`, in several coherent commits in the owner's style.
2. `rust-toolchain.toml` pins the installed stable Rust with the MSVC and wasm32 targets, rustfmt and clippy.
3. The Cargo workspace (plan B1):
   - **date-core**, copied from the Date repository with its tests and fixtures; its example is renamed `date_bridge`, and `gen_golden --check` must pass;
   - **percent-core**, from a read-only shallow clone of PCT tag `v2.3.0` in a scratch folder (its scripts are not run): `#![forbid(unsafe_code)]` added, the example renamed `percent_bridge`, the goldens unchanged;
   - skeletons of **calc-num**, **calc-core**, **units-core** and **graph-core**, each with a module layout, docs and a real test;
   - **pcalc-api**: one `call(op, req) -> String` with date-core's envelope, real dispatch for `meta.versions`, `date.*` and `percent.*`, `unknown_op`, per-op caps with `request_too_large`, and serde_json with `float_roundtrip`;
   - **pcalc-wasm**: the raw ABI `pc_in`, `pc_call`, `pc_out` and `pc_abi`, with unsafe confined to the export attributes;
   - **pcalc-store**: the hardened file helpers and the update check, factored from the Date app with parameters.
4. `src-tauri`: the identifier `com.portablecalculator.tool`, version 0.1.0, the desktop CSP with `connect-src 'none'`, empty capabilities, one `engine_call` command, and the `--smoke-test` pattern (a hidden window, in memory, `SMOKE_TEST_OK`, a watchdog). Cargo.lock is seeded from the Date repository to keep the Tauri versions.
5. `web/` skeleton (plan B4: core, platform adapters, Terminal tokens, the en catalog) and the scripts `build-web.mjs` (multi-file and single file with the CSP), `check-wasm.mjs` (both goldens through native and WASM, byte-compared, in three time zones), `serve-web.mjs` and `check-versions.mjs`. Plain Node, no npm.
6. `.github/workflows/ci.yml` on `dev` only: rust-checks, web-build and windows-build (smoke through `Start-Process -Wait`). Actions SHA-pinned, `persist-credentials: false`, `contents: read`, no release job.
7. Records: AGENTS.md, README, the plan copy, the four PBS records and the ROADMAP (M4 struck as dropped).

## Verification demanded

fmt; clippy native and wasm32 with `-D warnings`; `cargo test --workspace --locked`; `gen_golden --check`; the wasm32 build (report its size); `build-web.mjs`; `check-wasm.mjs` (byte-equal for every golden case of both engines); `--smoke-test` (exit 0 and `SMOKE_TEST_OK`). Return every command and result and any deviation from the spec with reasons.

## Review lens

1. `main` has no workflows, and there is no remote.
2. The workspace matches B1: the purity rules, serde only, unsafe confined, no panic paths in request handling.
3. The engine copies are faithful.
4. The envelope, caps and errors follow B2.
5. The raw ABI and loader (SHA-256 check before instantiate), the built CSP and DOM safety.
6. The desktop identity, CSP, capabilities and smoke gate.
7. CI hardening.
8. LF.
9. The records claim no more than was done.

## Reuse

Use for starting a new repository. Keep the workflow-free first `main` commit and the PowerShell rule. Today, add the engine leak gate from the start: build `engine.wasm` only through `scripts/build-wasm.mjs`, which the M0 review added after a bare `cargo build` was found to embed the local user path.
