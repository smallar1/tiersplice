# TierSplice v0.2.1 beta release audit

**Verdict: BLOCKED for publication pending branch/CI confirmation and final local verification.** No merge, push, tag, npm login, or publication was performed. This is a risk-based repository review, not a guarantee that all vulnerabilities are absent.

## Baseline and workspace

- Before edits: branch `feature/v0.2-native-routing-interop`, HEAD `a381b6df26f42e092782970c1d38fdb936a0e1b0`, package version `0.2.0`.
- Existing changes: deleted tracked `SPEC.md`; untracked `docs/specs/`. Preserved.
- `git diff --check` initially passed. `.git` was available for read only; requested release branch could not be created and no remote fetch was run. `gitleaks git --redact --no-banner` scanned the 3 locally available commits (~144.63 KB) and reported no leaks. This does not include un-fetched remote history or guarantee absence of secrets.
- Root inventory showed source, schemas, docs, tests, package metadata, workflow, and release docs. Ignored `.DS_Store` files were present; they are now covered by `.gitignore`.

## Findings

| Status | Finding | Evidence / disposition |
| --- | --- | --- |
| fixed | Package/CLI/smoke versions disagreed with beta target | Package and lockfile set to `0.2.1-beta.0`; CLI reads package metadata; tests compare dynamically; smoke check compares CLI and installed metadata |
| fixed | README promoted `@latest` while describing an unpublished development release | README now documents explicit `@beta` installation and current feature status |
| fixed | npm file shipping was implicit and had no content assertion | `files` allowlist retained and pack smoke now asserts the complete expected file set |
| fixed | Local secrets and machine ownership manifest lacked ignore guidance | Added minimal `.gitignore`; `.tiersplice.json` is intentionally not ignored |
| fixed | No operator beta publishing procedure | Added `docs/PUBLISHING.md` with manual beta-only flow and recovery guidance |
| warning | Requested release branch and remote push scope were not audited | Local available history scanned with Gitleaks; no fetch and no writable Git metadata, so remote-only commits and final push scope remain unverified |
| warning | Native runtime execution and real model access are unverified | No authenticated or paid runtime tests were performed |
| warning | Concurrent symlink swaps, rollback failure, and Windows CI failures are not fully assessed | Existing tests cover common path/rollback cases; no current GitHub logs available here |

## Dependency and command review

- `npm ci`: passed; zero dependencies audited.
- `npm audit`: passed, 0 vulnerabilities.
- `npm audit --omit=dev`: passed, 0 vulnerabilities.
- `npm run check`: passed on Node `v26.13.0` / npm `11.20.0`.
- `npm test`: passed, 22 tests.
- `npm run smoke:pack`: passed, including package metadata/bin checks, exact package file allowlist, `--version`, `--help`, offline `resolve`, and local dry-run in a disposable project.
- `npm pack --dry-run --json`: passed; package is `tiersplice@0.2.1-beta.0`, exactly 13 allowlisted entries, 20,755 bytes compressed / 74,304 bytes unpacked. No fixtures, tests, credentials, archives, or machine manifests are included.
- Package scripts use local Node/npm commands; `prepack` runs check and tests. `pack-smoke` installs a locally produced tarball into a disposable directory with scripts ignored; no application network request is introduced.
- Workflow uses `actions/checkout@v4` and `actions/setup-node@v4`; actions are major-version tags, not immutable SHA pins.

## Package allowlist

Expected npm files (verified exactly): `CHANGELOG.md`, `IMPLEMENTATION_STATUS.md`, `LICENSE`, `README.md`, `RELEASE_AUDIT_v0.2.1.md`, `docs/resolve.md`, `package.json`, both JSON schemas, and `src/{adapters,cli,config,filesystem}.js`. `docs/PUBLISHING.md`, tests, workflow, and specs are Git documentation and intentionally excluded from npm.

## Required remaining gates

- Run all local checks after the final changes and inspect actual packed file list.
- Obtain a writable checkout on the intended feature branch; fetch and verify origin baseline; run history-aware secret scanning and inspect intended push scope.
- Observe the supported OS/Node CI matrix, investigate Windows results, and review the exact tarball plus `npm publish --dry-run --tag beta --access public`.
- Maintainer approval is required before any merge or publication. Use `npx tiersplice@beta init --local --dry-run` as the first real-repository trial.
