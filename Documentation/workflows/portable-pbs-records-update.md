# Brief: portable-pbs-records-update

**Kind:** documentation records. **Used:** 2026-11-20, on `d7a6712`. **Result:** the PBS records set in Ledger E-13.

## Purpose

After M3, bring every record up to date under PBS v1.1: architecture and project context, session summaries, security, testing, failure intelligence, acceptance, these workflow briefs, and the PBS and handoff records. Then run an accuracy review and fix its findings.

## Phases

| Phase | Agents | Role |
|---|---|---|
| Write | 3 in parallel, on disjoint files | A: `1- PROJECT_CONTEXT.md`, `2- ARCHITECTURE.md`. B: `pbs/SECURITY_HARDENING_DOSSIER.md`, `TESTING_AND_VERIFICATION.md`, `FAILURE_INTELLIGENCE.md`, `ACCEPTANCE_RECORD.md`. C: `4- SESSION_SUMMARY.md`, `workflows/`, and the refresh of CURRENT_STATE, CONTINUATION_STATE, SOURCE_OWNERSHIP_MAP, ROADMAP, the ledger, AGENTS.md and HANDOFF.md |
| Review | 1 | Accuracy, privacy and links; no edits |
| Fix | 1 | Apply the verified findings; re-run the privacy grep and the link check |

## Shared context (substance)

- **PBS v1.1 templates** give the contract of each record. Where the Date Calculator repository already has a format for the same record (`1- PROJECT_CONTEXT`, `2- ARCHITECTURE`, `4- SESSION_SUMMARY`, `SECURITY_HARDENING_DOSSIER`), follow that format exactly: headings, order and emoji.
- **Ground every claim** in the repository (code, AGENTS.md, HANDOFF.md, the PBS records, the ledger, specs 5–7, the ROADMAP, the handoff documents) and never invent numbers. Mark unverified things honestly: Chromium only, manual owner checks outstanding.
- **Privacy:** the repository is public. No Windows user paths, email addresses or scratch and temp paths. Names allowed: the CipherVaults partners Mohamed Sayed and Ahmed Emara.
- **Rules:** LF; writers do not stage, commit or push (the coordinator does); each writer edits only its assigned files.

## Review demands

- Check every factual claim against the code, the ledger, `git log` and read-only `gh`.
- Formats match the Date repository's equivalents or the PBS templates.
- No duplicated live facts that will drift (link instead).
- Cross-record consistency: CURRENT_STATE, CONTINUATION_STATE, HANDOFF, ROADMAP, the ledger and AGENTS.md.
- Every relative link resolves; LF only.
- **Privacy grep** of all changed and new files for user-folder paths, temp folders, scratch folders and email-like strings. Any hit is a major finding.

## Reuse

Run it at every milestone or checkpoint that changes the project's structure or state, under the keep-records rule in AGENTS.md. Split the writers so that no two touch the same file, and keep the privacy grep in the review.
