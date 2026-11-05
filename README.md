# TierSplice

**Model routing for coding agents, without another agent harness.**

TierSplice is an open-source, installable CLI that helps existing coding tools send light, standard, and complex tasks to appropriate models. It configures the native delegation features of **Claude Code** and **Codex**, while aiming to keep usage efficient and your current development workflow intact.

Instead of replacing your agents, TierSplice gives them a shared, configurable model-tier policy.

> **Project status: `0.2.1-beta.0` beta candidate.** This prerelease is opt-in and is not promoted to npm `latest`. Runtime model availability and actual agent invocation are not verified. See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for evidence and [docs/PUBLISHING.md](./docs/PUBLISHING.md) for the manual release procedure.

## What TierSplice does

- **Routes by task tier:** Light, standard, and heavy work can use different models and reasoning effort.
- **Uses native agents:** Claude Code and Codex still own task execution, tools, permissions, and verification.
- **Offers routing profiles:** Choose `economy`, `balanced`, or `quality`.
- **Works globally or per project:** Reuse your preferences everywhere or override them in one repository.
- **Detects supported environments:** No integrations checklist or mandatory extra model providers.
- **Framework-neutral policy:** Other tools can read a routing decision with `resolve`; TierSplice does not rewrite their configuration or control their delegation.
- **Keeps configuration transparent:** Inspect configured versus effective routing, unsupported models, and conflicts.

TierSplice is meant to work with your **existing CLI authentication**. The core package is not designed to require paid API keys, a hosted service, or third-party LLMs.

## Installation

Install the beta explicitly with `npx tiersplice@beta`. Interactive setup asks for scope and profile when those were not supplied as flags. Supported native coding environments are detected automatically.

```bash
# Interactive
npx tiersplice@beta init

# Configure for all repositories
npx tiersplice@beta init --global

# Configure only the current repository
npx tiersplice@beta init --local

# Non-interactive example
npx tiersplice@beta init --global --profile balanced --yes
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

Model and effort settings can be overridden in the JSON configuration. Claude agent files pin the selected model and leave effort advisory. Codex files set the selected model and requested effort where the renderer supports it; actual model access and invocation remain unverified.

## Configuration and commands

```bash
# Change the active profile for all projects
npx tiersplice@beta profile economy --global

# Override the profile in the current project
npx tiersplice@beta profile quality --local

# Inspect model assignments and compatibility
npx tiersplice@beta status
npx tiersplice@beta doctor
npx tiersplice@beta resolve --runtime codex --role implementation --json

# Open the configuration file
npx tiersplice@beta config edit

# Reapply owned settings after changing configuration
npx tiersplice@beta sync --local

# See exactly what would be removed
npx tiersplice@beta uninstall --local --dry-run
```

Configuration locations:

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

`resolve` returns one offline JSON policy decision for a runtime and role or tier. Its stable v1 schema and provenance fields are documented in [docs/resolve.md](./docs/resolve.md) and [schemas/resolve.schema.json](./schemas/resolve.schema.json). It reports configured preference only; it does not test model access or execution.

## Compatibility and limitations

TierSplice is **not** a standalone coding agent. It relies on the native subagent and model-selection capabilities of your installed tools. Some routing can be pinned in native agent files; other routing advice is heuristic and depends on the parent agent or workflow actually delegating.

Third-party workflow tools retain their own planning and delegation. `resolve` reports TierSplice's configured policy only; it does not launch a model or guarantee that another tool uses the result.

TierSplice does **not** bypass Claude Code or Codex subscription limits, guarantee usage savings, or silently switch to paid API providers.

## Feature roadmap

| Target | Features | Status |
| --- | --- | --- |
| **v0.1** | CLI, global/local setup, profiles, Claude/Codex agents, configuration, status/doctor, sync/uninstall | Implemented |
| **v0.2** | Debugger agent, policy resolution API, framework-neutral operation | Implemented; native host invocation unverified |
| **v0.3** | Explicit, user-triggered Claude Code ↔ Codex task handoffs | Future |
| **v0.4+** | Optional, bounded cross-platform failover on supported usage-limit errors | Exploratory |

Optional external framework adapters may be considered later if users request them; they are not part of v0.2.

Feature availability will be updated as code actually ships; this roadmap is not a commitment to any date.

## Contributing

TierSplice is intended as a small, maintainable open-source project. Contributions should favor native runtime features, minimal dependencies, safe configuration edits, and compatibility checks for every supported adapter. See [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and [docs/PUBLISHING.md](./docs/PUBLISHING.md).

## License

MIT; see [LICENSE](./LICENSE).

---

TierSplice aims to be the routing layer you install once, customize when needed, and otherwise leave out of your way.
