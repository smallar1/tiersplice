# TierSplice v0.2.1 beta release audit

**Verdict: BLOCKED for publication pending branch/CI confirmation and final local verification.** No merge, push, tag, npm login, or publication was performed. This is a risk-based repository review, not a guarantee that all vulnerabilities are absent.

## Baseline and workspace

- Before edits: branch `feature/v0.2-native-routing-interop`, HEAD `a381b6df26f42e092782970c1d38fdb936a0e1b0`, package version `0.2.0`.
- Existing changes: deleted tracked `SPEC.md`; untracked `docs/specs/`. Preserved.
- `git diff --check` initially passed. `.git` was read-only at first; the requested release branch was later created and pushed with only the hardening files staged. No remote fetch was run. `gitleaks git --redact --no-banner` scanned the 3 locally available commits (~144.63 KB) and reported no leaks. This does not cover separate, un-fetched remote history or guarantee absence of secrets.
- Root inventory showed source, schemas, docs, tests, package metadata, workflow, and release docs. Ignored `.DS_Store` files were present; they are now covered by `.gitignore`.

## Findings

| Status | Finding | Evidence / disposition |
| --- | --- | --- |
| fixed | Package/CLI/smoke versions disagreed with beta target | Package and lockfile set to `0.2.1-beta.0`; CLI reads package metadata; tests compare dynamically; smoke check compares CLI and installed metadata |
| fixed | README promoted `@latest` while describing an unpublished development release | README now documents explicit `@beta` installation and current feature status |
| fixed | npm file shipping was implicit and had no content assertion | `files` allowlist retained and pack smoke now asserts the complete expected file set |
| fixed | Local secrets and machine ownership manifest lacked ignore guidance | Added minimal `.gitignore`; `.tiersplice.json` is intentionally not ignored |
| fixed | No operator beta publishing procedure | Added `docs/PUBLISHING.md` with manual beta-only flow and recovery guidance |
| fixed | Cross-platform CI failed in tests and package smoke | Windows tests expected XDG paths instead of the Windows `%APPDATA%` path; smoke dry-run returned the CLI's warning exit when no host runtimes were installed. Fixtures now isolate `%APPDATA%` and seed synthetic runtime markers. GitHub run `41941489250` passed all six matrix jobs on commit `72ed76956188040ec55fe79fc0e27e4b210b34cc`. |
| warning | Remote-only history from other branches was not audited | Gitleaks scanned local history and the working tree; the release commit staged only the intended 13 files, but no remote fetch was run |
| warning | Native runtime execution and real model access are unverified | No authenticated or paid runtime tests were performed |
| warning | Concurrent symlink swaps and rollback failure are not fully assessed | Existing tests cover common path/rollback cases; hostile concurrency and rollback-failure matrix remains incomplete |

## Dependency and command review

- `npm ci`: passed; zero dependencies audited.
- `npm audit`: passed, 0 vulnerabilities.
- `npm audit --omit=dev`: passed, 0 vulnerabilities.
- `npm run check`: passed on Node `v26.13.0` / npm `11.20.0`.
- `npm test`: passed, 22 tests.
- `npm run smoke:pack`: passed, including package metadata/bin checks, exact package file allowlist, `--version`, `--help`, offline `resolve`, and local dry-run in a disposable project.
- `npm pack --dry-run --json`: passed; package is `tiersplice@0.2.1-beta.0`, exactly 13 allowlisted entries. No fixtures, tests, credentials, archives, or machine manifests are included.
- Package scripts use local Node/npm commands; `prepack` runs check and tests. `pack-smoke` installs a locally produced tarball into a disposable directory with scripts ignored; no application network request is introduced.
- Workflow uses `actions/checkout@v4` and `actions/setup-node@v4`; actions are major-version tags, not immutable SHA pins.

## Package allowlist

Expected npm files (verified exactly): `CHANGELOG.md`, `IMPLEMENTATION_STATUS.md`, `LICENSE`, `README.md`, `RELEASE_AUDIT_v0.2.1.md`, `docs/resolve.md`, `package.json`, both JSON schemas, and `src/{adapters,cli,config,filesystem}.js`. `docs/PUBLISHING.md`, tests, workflow, and specs are Git documentation and intentionally excluded from npm.

## GitHub CI failure diagnosis

The initial workflow attempts for commit `30c9b49ba98f0905f11a2fc76d691792c774a1aa` failed in two independent places: Windows tests used an expected global config path under XDG even though Windows resolves global config under `%APPDATA%`; all-platform pack smoke ran local init without a detected Claude/Codex runtime, so its warning exit code caused the smoke command to fail. The Ubuntu Node 20 job was cancelled by matrix fail-fast after other jobs failed. Regression fixes were pushed and the complete matrix then passed.

- Failed push run: [41940928391](https://github.com/smallar1/tiersplice/actions/runs/41940928391).
- Failed pull-request run: [41940955807](https://github.com/smallar1/tiersplice/actions/runs/41940955807).
- Passing follow-up matrix: [41941489250](https://github.com/smallar1/tiersplice/actions/runs/41941489250), all six jobs successful.

## Required remaining gates

- Run all local checks after the final changes and inspect actual packed file list.
- Obtain a writable checkout on the intended feature branch; fetch and verify origin baseline; run history-aware secret scanning and inspect intended push scope.
- Review the exact tarball and run `npm publish --dry-run --tag beta --access public` on the publishing machine.
- Maintainer approval is required before any merge or publication. Use `npx tiersplice@beta init --local --dry-run` as the first real-repository trial.
