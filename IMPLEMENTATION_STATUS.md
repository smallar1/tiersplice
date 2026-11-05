# Implementation status

## Release context

- Target package version: `0.3.0-beta.0` (unpublished; implementation in progress).
- Baseline for this work: `main` at `6e47fac` (`0.2.1-beta.0`).
- No merge, tag, push, or npm publication was performed. The pre-existing `SPEC.md` deletion and untracked `docs/specs/` were preserved.
- Pre-existing workspace changes preserved: deleted `SPEC.md` and untracked `docs/specs/`.

## Feature inventory

| Area | Status | Evidence / limits |
| --- | --- | --- |
| CLI: init, profile, status, doctor, config edit, sync, uninstall | Implemented | Fixture CLI tests |
| CLI: `resolve` | Implemented | Offline policy-only JSON, role/tier validation, documented v1 schema and provenance fields |
| Profiles and global/local overrides | Implemented | Unit coverage exists |
| Claude and Codex agent definitions | Implemented; proactive descriptions added | Generated format parser tests exist; actual host discovery/invocation is unverified |
| Automatic parent routing guidance | Implemented as advisory managed blocks | Claude `CLAUDE.md` and Codex `AGENTS.md` blocks are installed by init/sync; no live runtime verification yet |
| Marker ownership and opt-out | Implemented; regression tested | Supports additive `delegation.automatic`, dry-run, drift refusal, moved-file cleanup, separator preservation, and rollback across init/sync/uninstall |
| Host model availability and invocation | Unsupported / unverified | No credentials or paid runtime calls are inspected or made |
| Third-party framework configuration | Unsupported by design | Generic `resolve` only; standard flows do not probe or write framework files |
| Filesystem ownership and rollback | Existing whole-file protections retained; instruction blocks added | Block ownership, symlink refusal, moved-file cleanup, whitespace preservation, and cross-operation rollback paths have regression coverage; hostile concurrent swaps remain unverified |

## Release evidence

See [RELEASE_AUDIT_v0.2.1.md](./RELEASE_AUDIT_v0.2.1.md) for the baseline, exact commands and results, package manifest, audit scope, and blockers. Local validation is not evidence of GitHub CI success or native runtime behavior.

## v0.3 implementation evidence

- Native routing blocks and proactive agent descriptions are generated from configured runtime detection and do not interpolate user configuration into instruction text.
- `status` reports configured and installed state separately from `observed: "unverified"`; `doctor` retains an invocation-unverified diagnostic.
- Automated regression coverage includes additive config validation, CRLF and surrounding-content preservation, moved-file uninstall, duplicate/malformed marker detection, symlink refusal, init installation, and opt-out with agents retained. Latest `npm test` run: 30 passed, 0 failed.
- `npm audit`: 0 vulnerabilities. `npm run check`, `git diff --check`, and package smoke passed on the latest completed run.
- Claude Code/Codex live invocation, native instruction discovery, dogfooding, and supported-platform CI remain outstanding. This is not evidence of a release-ready automatic dispatcher.
