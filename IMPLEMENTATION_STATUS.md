# Implementation status

## Release context

- Target package version: `0.2.1-beta.0` (beta candidate; not published).
- Observed checkout: branch `feature/v0.2-native-routing-interop`, HEAD `a381b6df26f42e092782970c1d38fdb936a0e1b0`.
- Requested `feature/v0.2.1-release-hardening` branch was not created: Git metadata is read-only in this workspace. No fetch, push, merge, tag, or publication was performed.
- Pre-existing workspace changes preserved: deleted `SPEC.md` and untracked `docs/specs/`.

## Feature inventory

| Area | Status | Evidence / limits |
| --- | --- | --- |
| CLI: init, profile, status, doctor, config edit, sync, uninstall | Implemented | Fixture CLI tests |
| CLI: `resolve` | Implemented | Offline policy-only JSON, role/tier validation, documented v1 schema and provenance fields |
| Profiles and global/local overrides | Implemented | Unit coverage exists |
| Claude and Codex agent definitions | Implemented; host verification partial | Generated format parser tests exist; actual host discovery/invocation is unverified |
| Host model availability and invocation | Unsupported / unverified | No credentials or paid runtime calls are inspected or made |
| Third-party framework configuration | Unsupported by design | Generic `resolve` only; standard flows do not probe or write framework files |
| Filesystem ownership and rollback | Implemented with residual race risk | Traversal, symlink paths, allowlists, signatures, and partial-write rollback have tests; hostile concurrent swaps and rollback failure cases are not comprehensively verified |

## Release evidence

See [RELEASE_AUDIT_v0.2.1.md](./RELEASE_AUDIT_v0.2.1.md) for the baseline, exact commands and results, package manifest, audit scope, and blockers. Local validation is not evidence of GitHub CI success or native runtime behavior.
