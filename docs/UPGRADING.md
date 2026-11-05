# Upgrading a TierSplice setup

TierSplice has two independently versioned parts:

- **CLI package version** is the npm release currently running.
- **Setup version** is recorded in the global or project ownership manifest after managed assets are installed or upgraded.

Installing a newer npm package does not migrate a setup. For a one-off invocation, `npx tiersplice@beta upgrade` runs the beta CLI and leaves a separately installed global executable alone. To update that executable too, use `npm install -g tiersplice@beta` first.

## Preview and upgrade

Choose a scope explicitly in scripts and automation. A local upgrade affects the current repository only; a global upgrade affects the user-level TierSplice configuration and native files only.

```sh
tiersplice upgrade --global --dry-run
tiersplice upgrade --global

npx tiersplice@beta upgrade --local --dry-run --json
npx tiersplice@beta upgrade --local --yes
```

`--dry-run` reads configuration, manifests, managed files, and runtime detection results to build a plan. It does not create a directory, cache, or temporary file, make a discovery request, or change setup metadata. `--json` returns a versioned summary with the detected source setup, target CLI version, planned file actions, preserved model overrides, conflicts, and manual actions.

`--yes` suppresses routine prompts only. It does not resolve ownership conflicts, replace modified content, downgrade a newer setup, enable startup refresh, or start model discovery. `upgrade` does not automatically refresh the model catalog; run `tiersplice models refresh` separately when desired.

## Supported migration and preference preservation

The upgrader uses manifest `setupVersion` metadata when available. For older manifests without it, it checks the validated ownership records and known managed asset signatures. Historic v0.2 and v0.2.1 installations may have the same detectable layout, so they are reported as a compatible v0.2.x source where the layout does not distinguish them.

Valid profile, model, role, effort, escalation, and delegation values are retained. Existing explicit model IDs are treated as pinned unless the configuration explicitly carries a tracking policy. Local configuration remains local and continues to override inherited global policy.

The upgrader refreshes native agents for detected runtimes and updates only TierSplice's marked instruction blocks. User content outside those markers is retained. An obsolete managed file can be removed only when the manifest and on-disk ownership checks prove it is unchanged and owned. A modified or unsigned file is preserved and reported as a conflict.

## Conflicts and unsupported layouts

The upgrader stops before writing when configuration is invalid, a manifest is malformed, a managed target is modified, a path is unsafe, or setup-version metadata is newer than the running CLI. It does not repair by deleting and reinstalling files.

Review the exact conflict path. Preserve a copy of the affected config/manifest and managed file before making a manual repair. Restore an unchanged TierSplice file from a known-good installation or remove the TierSplice entry from the manifest only after confirming ownership; then rerun `upgrade --dry-run`. If ownership or version cannot be established, keep the files and seek maintainer guidance rather than deleting them.

If the requested scope has no configuration, `upgrade` explains how to run the matching `tiersplice init --global` or `--local` command. It never converts an upgrade into a new install.

## Rollback and reload

Upgrade operations snapshot the files in their plan and restore them if a later write fails. The error reports whether the previous state was restored or names paths whose rollback failed. Do not treat a reported incomplete rollback as success; inspect those paths before retrying.

Updated agent and instruction files are read by a new native session. A running Claude Code or Codex session is not promised to hot-reload them. Upgrade does not change unrelated repositories, activate lifecycle hooks, or add an always-running process.

## Status and doctor

Use `tiersplice status --global` or `--local` to see the CLI version and setup version separately. `tiersplice doctor` reports configuration problems, missing runtimes, and managed-file drift with remediation guidance. Neither command verifies account entitlement or performs a model inference request.
