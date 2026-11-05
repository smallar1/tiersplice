# Implementation status

## Release context

- Target package version: `0.5.0-beta.0`.
- Work branch: `feat/v0.5-automatic-routing`, created from the fetched and up-to-date `origin/main`.
- This is an implementation beta. No merge, tag, npm publication, or live Claude Code/Codex dispatch validation is claimed.
- The working tree contains user-provided untracked setup/spec files; they are preserved and are not part of this implementation unless listed in the final change review.

## Feature inventory

| Area | Status | Evidence and limits |
| --- | --- | --- |
| Existing setup, sync, upgrade, uninstall, profiles, and model policy | Implemented | Existing `node:test` regression suite; see verification below. |
| Role/tier/model resolution for a supplied route | Implemented | `src/routing.js` resolves an explicit role and optional task tier without changing saved configuration. Intent classification remains the host parent's responsibility. |
| Contextual handoff prompt composition | Implemented | Pure helper preserves provided objective, scope, constraints, context, deliverable, verification, and limits; rejects missing/oversized/control-character fields. Prompt content is not persisted. |
| Claude Code specialist definitions | Implemented; runtime behavior host-controlled | Generated descriptions and system prompts define bounded roles and contextual assignment expectations. Claude Code owns its Agent tool, launch, task message, permissions, and session evidence. |
| Codex specialist definitions | Implemented; runtime behavior host-controlled | Generated custom agents and descriptions define bounded roles and contextual assignment expectations. Codex owns native subagent availability, launch, task message, permissions, and session evidence. |
| `status` and `doctor` invocation evidence | Implemented; live state unverified | Configured policy and installed instructions are separate from `native-host-controlled` dispatch, `unverified` invocation, and `unverified` model execution. CLI does not read live session activity. |
| User opt-outs, native permissions, and privacy boundaries | Implemented in guidance | Explicit no-delegation instructions and `delegation.automatic: false` take precedence; no API credentials, telemetry, prompt store, background dispatcher, or inference service was added. |
| Real-host dispatch and observed model identity | Unverified | Requires interactive tests on supported Claude Code and Codex installations; offline tests cannot establish child invocation or the model actually used. |
| Cross-platform CI and release audit | Outstanding | Local verification does not establish GitHub Actions results or cross-platform compatibility. |

## Verification evidence

Fresh local verification on this feature branch:

- `npm run check` — passed on Node.js `v26.13.0`.
- `npm test` — passed, 50 tests and 0 failures.
- `npm run smoke:pack` — passed for `0.5.0-beta.0`; package prepack checks and tests passed, and the tarball installed and exercised the CLI in a disposable directory.
- `npm audit --omit=dev` — found 0 vulnerabilities.
- Gitleaks `dir --redact` scans of `src`, `tests`, `docs`, `scripts`, and the changed root documentation/package files — no leaks found.
- `git diff --check` — passed.

These offline checks do not establish cross-platform behavior or live host dispatch. No real-host test or model execution claim is made.

## Remaining checks

- Cross-platform CI and supported-version host validation remain outstanding.
- Keep dispatch and model execution labeled unverified until native session evidence is available.

See [automatic delegation](./docs/automatic-delegation.md), [upgrading](./docs/UPGRADING.md), [model updates](./docs/MODEL_UPDATES.md), and [publishing](./docs/PUBLISHING.md) for operational details.
