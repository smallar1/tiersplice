# Changelog

## 0.1.0 — unreleased

- Added a dependency-free Node.js CLI with global and local configuration scopes.
- Added economy, balanced, and quality routing profiles with model and effort overrides.
- Added managed Claude Code Markdown agents and Codex TOML agents.
- Added `init`, `profile`, `status`, `doctor`, `config edit`, `sync`, and conflict-safe `uninstall` commands.
- Added ownership manifests, atomic file replacement, dry-run reporting, and modified-file protection.
- Added local GSD detection and precedence warnings. GSD configuration remains unchanged because a supported version/schema contract is not verified.
- Runtime model access is reported as unverified; no credentials, network calls, or API fallback are used.

Validation and compatibility with installed Claude Code, Codex, and GSD releases remain to be completed before npm publication.
