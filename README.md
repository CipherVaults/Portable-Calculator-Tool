# Portable Calculator Tool

**Status: in development (v0.1.0 on `dev`). No release yet.**

One offline calculator app that merges the CipherVaults Date Calculator Tool and Percentage Calculator Tool and adds Standard, Scientific, Programmer and Graphing calculators plus twelve unit converters, in the style of the Windows Calculator.

- **Desktop:** a Windows app built with Tauri 2 and Rust (installer and portable exe).
- **Web:** a **phone-first** installable web app (PWA) that runs the same Rust engines compiled to WebAssembly, plus a single-file HTML version.
- **One engine, every surface.** All calculation happens in pure Rust crates (`crates/*-core`) behind one API (`pcalc-api`), so the desktop app and the web app give byte-identical results.
- **Private by design.** Everything stays on the device. No accounts, no telemetry; the only network call is an optional, payload-free update check.

Browser floor (planned): Safari/iOS 16.4+, Chrome/Edge 97+, Firefox 102+.

The full design is in [Documentation/specs/5- PORTABLE_CALCULATOR_PLAN.md](Documentation/specs/5-%20PORTABLE_CALCULATOR_PLAN.md) (Part B) and the milestones in [Documentation/3- ROADMAP.md](Documentation/3-%20ROADMAP.md). Contributors (human or AI) start at [AGENTS.md](AGENTS.md).

## License

All rights reserved (UNLICENSED). The source is public for transparency and review; no open-source license is granted. See [LICENSE](LICENSE).
