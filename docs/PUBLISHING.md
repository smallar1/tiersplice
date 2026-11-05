# Manual beta publishing

Publishing is an operator action. Review and approve the release branch and audit first; this repository has not been published by this workflow.

## Before publishing

1. Confirm the package name `tiersplice` is controlled by the intended npm account. Check `npm view tiersplice version` and `npm view tiersplice@0.2.1-beta.0 version`; stop if the name is owned by another party or this version already exists.
2. Merge the reviewed release branch through GitHub. In a clean checkout, run `git switch main`, `git pull --ff-only`, and `npm ci`.
3. Verify identity with `node -p 'JSON.stringify({name: require("./package.json").name, version: require("./package.json").version, bin: require("./package.json").bin}, null, 2)'`, `node src/cli.js --version`, and `npm config get registry`. Expected version is `0.2.1-beta.0`; expected registry is `https://registry.npmjs.org/` unless intentionally changed.
4. Run `npm run check`, `npm test`, `npm run smoke:pack`, `npm audit`, `npm audit --omit=dev`, `npm pack --dry-run --json`, and `npm publish --dry-run --tag beta --access public`. Inspect every package path against the explicit allowlist and read the audit report.
5. Authenticate interactively with `npm login`, confirm `npm whoami`, and follow npm's 2FA prompt. Never put an npm token or 2FA code in source, chat, CI, or a committed `.npmrc`.

## Publish and verify

Publish only with `npm publish --tag beta --access public`. Do not run bare `npm publish`, because that can update `latest`. Verify with `npm view tiersplice@beta version`, `npm dist-tag ls tiersplice`, and `npm view tiersplice@0.2.1-beta.0 dist.tarball`. Confirm `beta` points to `0.2.1-beta.0`; do not promote `latest` as part of this beta. A first beta may leave `latest` unset.

In a disposable directory, verify `npx --yes tiersplice@beta --version`, `npx --yes tiersplice@beta --help`, and `npx --yes tiersplice@beta resolve --runtime claude --role implementation --json`. Test installation with `init --local --dry-run` inside a disposable Git repository and inspect its proposed paths.

An optional annotated tag is `v0.2.1-beta.0`; create it only after verifying the exact published commit. Do not create stable `v0.2.1` or promote `latest` during beta.

## If something goes wrong

Do not try to overwrite a published version. Correct the issue and use `0.2.1-beta.1`. For a serious issue, halt promotion and consider deprecation plus a patched prerelease. Follow current npm incident guidance; unpublishing does not guarantee cached copies disappear. If a dist-tag changes unexpectedly, inspect current tags and deliberately restore only an approved previous version.

## Later prereleases

Increment the prerelease identifier for each new publication (`0.2.1-beta.1`, then `0.2.1-beta.2`, etc.). Synchronize package metadata and lockfile, CLI version output, changelog, smoke checks, and audit evidence each time. Stable `0.2.1` requires separate maintainer approval and a fresh release review.
