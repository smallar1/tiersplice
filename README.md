# TierSplice

**Model routing for coding agents, without another agent harness.**

TierSplice is an open-source, installable CLI that helps existing coding tools send light, standard, and complex tasks to appropriate models. It configures the native delegation features of **Claude Code** and **Codex**, while aiming to keep usage efficient and your current development workflow intact.

Instead of replacing your agents, TierSplice gives them a shared, configurable model-tier policy.

> **Project status: v0.1.0 implementation.** The CLI is implemented in this repository but has not been published to npm. Runtime model availability is not probed, and GSD integration is detection-only until a supported compatibility contract can be verified. See [CHANGELOG.md](./CHANGELOG.md) for the shipped scope.

## What TierSplice does

- **Routes by task tier:** Light, standard, and heavy work can use different models and reasoning effort.
- **Uses native agents:** Claude Code and Codex still own task execution, tools, permissions, and verification.
- **Offers routing profiles:** Choose `economy`, `balanced`, or `quality`.
- **Works globally or per project:** Reuse your preferences everywhere or override them in one repository.
- **Detects supported environments:** No integrations checklist or mandatory extra model providers.
- **Plays well with existing workflows:** Where supported, TierSplice can align with GSD Core's model policies without replacing GSD's delegation.
- **Keeps configuration transparent:** Inspect configured versus effective routing, unsupported models, and conflicts.

TierSplice is meant to work with your **existing CLI authentication**. The core package is not designed to require paid API keys, a hosted service, or third-party LLMs.

## Planned installation

Interactive setup asks for scope and profile when those were not supplied as flags. Supported coding environments are detected automatically.

```bash
# Interactive
npx tiersplice@latest init

# Configure for all repositories
npx tiersplice@latest init --global

# Configure only the current repository
npx tiersplice@latest init --local

# Non-interactive example
npx tiersplice@latest init --global --profile balanced --yes
```

Global setup configures native user-level agents. Local setup writes only to the current project and its supported local configuration. Global setup does not rewrite every existing repository.

**Prerequisites:** Node.js 20.11+. Claude Code or Codex is needed to generate native agents; with neither detected, TierSplice still saves its policy and reports that routing is inactive.

## Routing profiles

| Profile | Light tasks | Standard tasks | Heavy tasks |
| --- | --- | --- | --- |
| **Economy** | Favor the lightest capable model | Prefer efficient implementation models | Escalate only when necessary |
| **Balanced** (default) | Lightweight models | General-purpose implementation models | Strong reasoning models |
| **Quality** | Prefer more capable models | Higher reasoning effort | Strongest configured models |

The **Balanced** policy favors **Haiku / Sonnet / Opus** for Claude Code's light / standard / heavy tiers and **gpt-6-luna / gpt-6-luna / gpt-6-sol** for Codex. These are configured preferences; TierSplice does not verify that the installed runtime or account can use them.

Model and effort settings can be overridden in the JSON configuration. Claude agent files currently pin the selected model but leave effort advisory because compatibility is not verified. Codex agent files set model and reasoning effort; model access remains unverified.

## Configuration and commands

```bash
# Change the active profile for all projects
npx tiersplice@latest profile economy --global

# Override the profile in the current project
npx tiersplice@latest profile quality --local

# Inspect model assignments and compatibility
npx tiersplice@latest status
npx tiersplice@latest doctor

# Open the configuration file
npx tiersplice@latest config edit

# Reapply owned settings after changing configuration
npx tiersplice@latest sync --local

# See exactly what would be removed
npx tiersplice@latest uninstall --local --dry-run
```

Planned configuration locations:

- **Global:** a platform-appropriate user configuration path (for example `~/.config/tiersplice/config.json` on Unix).
- **Local:** `.tiersplice.json` at the repository root.

A minimal local configuration would be:

```json
{
  "schemaVersion": 1,
  "profile": "balanced"
}
```

Local configuration overrides applicable global defaults. TierSplice will preserve unrelated user settings and report conflicts instead of overwriting them silently.

## Compatibility and limitations

TierSplice is **not** a standalone coding agent. It relies on the native subagent and model-selection capabilities of your installed tools. Some routing can be pinned in native agent files; other routing advice is heuristic and depends on the parent agent or workflow actually delegating.

When a local GSD project is detected, TierSplice reports its presence and possible precedence conflicts. v0.1 does not edit `.planning/config.json`, because this implementation does not yet pin and validate a supported GSD schema/version.

TierSplice does **not** bypass Claude Code or Codex subscription limits, guarantee usage savings, or silently switch to paid API providers.

## Feature roadmap

| Target | Features | Status |
| --- | --- | --- |
| **v0.1** | CLI, global/local setup, profiles, Claude/Codex agents, configuration, status/doctor, safe sync/uninstall; GSD detection only | Implemented; unpublished |
| **v0.2** | Broader framework compatibility and more precise per-role configuration | Future |
| **v0.3** | Explicit, user-triggered Claude Code ↔ Codex task handoffs | Future |
| **v0.4+** | Optional, bounded cross-platform failover on supported usage-limit errors | Exploratory |

Feature availability will be updated as code actually ships; this roadmap is not a commitment to any date.

## Contributing

TierSplice is intended as a small, maintainable open-source project. Contributions should favor native runtime features, minimal dependencies, safe configuration edits, and compatibility checks for every supported adapter. See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

**MIT is planned.** A `LICENSE` file will be added before publication; until then, no license grant is implied by this draft README alone.

---

TierSplice aims to be the routing layer you install once, customize when needed, and otherwise leave out of your way.
