# Changelog

## 0.2.1-beta.0 — Beta candidate (unpublished)

- Prepare an opt-in npm beta with synchronized package and CLI versions and an explicit npm file allowlist.
- Add tarball content assertions, a disposable package smoke check, and operator publishing instructions.
- Fix Windows test isolation for `%APPDATA%` and make the packaged dry-run independent of installed host runtimes.
- Refresh beta installation guidance and document audit evidence and limitations in `RELEASE_AUDIT_v0.2.1.md`.
- Verification is local only; GitHub CI, native host invocation, and publication have not been verified.

## 0.2.0 — Unreleased

- Accept valid manual edits to TierSplice configuration during profile changes and sync; validate both global and local sources.
- Separate editable source-config ownership from generated native-agent ownership, migrate v0.1 manifests safely, and roll back failed writes where possible.
- Constrain writes and uninstall to allowlisted TierSplice configs and direct native agent files; reject malformed manifests, path traversal, symlinked targets, and unsigned files even when a manifest hash matches.
- Add the debugging native agent and structured Claude agent rendering; validate generated Claude YAML and Codex TOML output.
- Add offline `resolve` JSON policy output with a documented v1 schema, provenance, and unverified model availability.
- Remove framework-specific detection from standard CLI flows. Existing framework files remain untouched.
- Expand CI to run syntax checks, tests, packaged CLI smoke installation, and package dry-run.
- Native runtime discovery and actual model invocation remain unverified; path and rollback hardening is incomplete.

## 0.1.0 — unreleased

- Added a dependency-free Node.js CLI with global and local configuration scopes.
- Added economy, balanced, and quality routing profiles with model and effort overrides.
- Added managed Claude Code Markdown agents and Codex TOML agents.
- Added `init`, `profile`, `status`, `doctor`, `config edit`, `sync`, and conflict-safe `uninstall` commands.
- Added ownership manifests, atomic file replacement, dry-run reporting, and modified-file protection.
- Runtime model access is reported as unverified; no credentials, network calls, or API fallback are used.

Validation and compatibility with installed Claude Code and Codex releases remain to be completed before npm publication.
