# Publishing a TierSplice release

Publishing, tagging, merging, and changing npm dist-tags are operator actions. This document describes release checks; implementation or passing local checks alone does not authorize publication.

## Prepare a beta

1. Complete the implementation and release audit on `feature/v0.4-upgrades-model-tracking`. Do not release from an unreviewed branch.
2. Synchronize `package.json`, `package-lock.json`, CLI version output, `CHANGELOG.md`, and implementation evidence. Use an opt-in prerelease such as `0.4.0-beta.0` and the npm `beta` tag.
3. Confirm the npm package name and registry with `npm view tiersplice version`, `npm config get registry`, and the intended npm account. Do not publish if the name, owner, or registry is unexpected.
4. In a clean checkout, run `npm ci`, `npm run check`, `npm test`, `npm run smoke:pack`, `npm audit`, `npm audit --omit=dev`, `npm pack --dry-run --json`, and `npm publish --dry-run --tag beta --access public` where supported. Record exact commands, results, platform, and commit in the release audit.
5. Inspect the package tarball. Confirm new source modules, schemas, and every intended user document are included by the explicit `package.json` `files` allowlist. Confirm no fixtures, caches, credentials, or unrelated workspace files are present.
6. Install the generated tarball in a disposable directory. The `npm run smoke:pack` script checks `--version`, `--help`, policy-only `resolve`, a disposable local setup, a v0.3-shaped upgrade dry run, model status, and offline dry-run refresh. Unit tests exercise model refresh with injected fake catalogs. These checks do not contact a native model catalog or verify account entitlement; never use a real account or inference request in default CI.
7. Run the supported Node versions on Linux, macOS, and Windows in CI. Record any host-specific limitation rather than implying that local results cover every platform.

## Runtime evidence

Real Claude Code/Codex checks are separate, manual validation. Use disposable global and project scopes, confirm managed agent discovery and alias behavior, test the supported Codex catalog capability when available, and observe whether a new session is required after agent refresh. Capture versions and non-sensitive behavior only. Do not capture credentials, tokens, private transcripts, or user project content.

If a runtime cannot be checked, leave it labeled unverified in `IMPLEMENTATION_STATUS.md`. A catalog listing is not proof of entitlement or successful inference.

## Publish and verify

Only after release approval and the required audit, publish with `npm publish --tag beta --access public`. Do not run bare `npm publish`, because it can move the `latest` tag. Verify the published version, tarball, and dist-tags with `npm view tiersplice@beta version`, `npm dist-tag ls tiersplice`, and a disposable `npx --yes tiersplice@beta --version` check.

Do not push, tag, merge, publish, or alter npm tags as an implicit consequence of implementation work. A stable release or promotion to `latest` needs its own explicit release decision and fresh verification.

## If a release check fails

Stop promotion, preserve logs without secrets, fix the issue, and use a new prerelease number instead of overwriting an already published version. For a published security issue, follow current npm and repository incident guidance; cached tarballs may persist after deprecation.
