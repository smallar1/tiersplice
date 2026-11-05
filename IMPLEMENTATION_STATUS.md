# Implementation status

## Release context

- Target package version: `0.4.0-beta.0`.
- Work branch: `feature/v0.4-upgrades-model-tracking`, based on `main` at `c37230b`.
- No merge, tag, push, npm publication, or real-host validation is part of this implementation task.
- Existing user changes and untracked files in the workspace are being preserved.

## Feature inventory

| Area | Status | Evidence and limits |
| --- | --- | --- |
| Existing setup and routing commands | Implemented | Existing CLI and fixture coverage; `resolve` remains JSON schema v1. |
| Global/local setup version reporting | Implemented | `npm test` passes status and setup-version assertions; setup version is stored separately from the CLI package version. |
| `upgrade` dry run, migration planning, managed asset refresh, rollback | Implemented; partial fixture coverage | `npm test` covers a read-only v0.3-shaped local dry run, setup metadata update, idempotence, and missing-install guidance. Other legacy layouts and injected upgrade rollback failures remain unverified. |
| Legacy setup detection | Partial | Uses explicit manifest metadata when present and supported manifest/config/asset signatures otherwise. Historical v0.2 and v0.2.1 layouts may be indistinguishable; full historical fixtures and both-scope migration coverage remain outstanding. |
| Model tracking configuration and explicit pins | Implemented | `npm test` validates optional tracking fields and pin protection without changing existing `resolve` output. Legacy explicit model IDs remain pinned. |
| Claude model selection | Implemented | Built-in family aliases (`haiku`, `sonnet`, `opus`) are delegated to Claude Code. TierSplice does not infer the concrete resolved generation. No supported read-only Claude model catalog is implemented. |
| Codex model discovery | Implemented; native capability unverified | Uses the Codex app-server `model/list` method with a bounded child-process lifetime and output size. Discovery failures do not replace current choices. |
| Catalog cache and offline status | Implemented; unit coverage | Tests cover validated cache writes, offline reads, and TTL status. Catalog presence does not prove entitlement or successful inference. |
| Compatible model refresh | Implemented; fake-adapter unit coverage | Tests cover explicit same-family recommendations, visibility, effort compatibility, and pin preservation. Native discovery is not tested by default. |
| Automatic session-start refresh | Not implemented | No lifecycle hook is installed; refresh is an explicit command. |
| Host invocation, account entitlement, paid inference | Unverified / unsupported | TierSplice does not inspect credentials or make inference calls. |
| Filesystem ownership, conflict protection, rollback | Implemented; regression coverage | Existing tests cover symlink refusal, managed-file conflicts, marker preservation, and injected partial-write rollback. Concurrent hostile filesystem swaps remain outside verified guarantees. |

## Verification evidence

Reported local verification on the current workspace:

- `npm run check` — passed.
- `npm test` — passed, 44 tests and 0 failures.
- `npm run smoke:pack` — passed. The script packs and installs the tarball in a disposable directory, checks the packaged CLI version/help/resolve, creates a disposable local setup, previews its upgrade, and exercises models status plus offline dry-run refresh.

These local results do not establish cross-platform CI, a dependency audit, or real-host behavior. The package smoke test deliberately uses offline model refresh; fake catalog selection is covered by unit tests. Live Codex discovery, Claude/Codex invocation, account entitlement, and host reload behavior remain unverified.

## Release gates still outstanding

- Add distinct v0.2.1 historical layout evidence where it differs from v0.2; those manifests can be indistinguishable and currently migrate as the compatible v0.2.x layout. Local and global scope coverage includes a global-scope noninterference check.
- Add upgrade-specific injected rollback-failure coverage; existing filesystem rollback tests cover partial managed writes.
- Run `npm audit` and supported-platform CI; current evidence is local only.
- Record manual host evidence or keep the corresponding capability labeled unverified.

See [docs/UPGRADING.md](./docs/UPGRADING.md), [docs/MODEL_UPDATES.md](./docs/MODEL_UPDATES.md), and [docs/PUBLISHING.md](./docs/PUBLISHING.md) for operator guidance.
