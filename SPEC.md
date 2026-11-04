# TierSplice — Product and Implementation Specification

> **Status:** Draft specification; not a claim of implemented functionality  
> **Target:** First public release, v0.1.0  
> **Updated:** 2026-11-04  
> **Distribution:** Open-source GitHub repository and npm CLI (package name subject to registry availability)

## 1. Product summary

**TierSplice** is a lightweight, installable **model-routing policy manager for coding-agent runtimes**. It helps existing tools delegate light, standard, and heavy work to appropriately capable models, configure reasoning effort when supported, and limit unnecessary usage without replacing each tool's orchestration engine.

The initial supported runtimes are **Claude Code** and **Codex**. **GSD Core** is treated as an optional, automatically detected *framework compatibility layer*: where GSD exposes supported model-policy settings, TierSplice maps its settings to them without taking over GSD's planning, execution, verification, or task state.

A single npm package and configuration format is the source of truth. Native agents, prompts, and compatible framework settings are generated or synchronized from that configuration.

**Product promise:** Install in minutes; use existing Claude Code or Codex authentication; inspect exactly what was configured; change or uninstall without damaging existing setups.

**Boundary:** v0.1.0 does **not** implement an AI-agent execution loop, classify every user prompt with a separate LLM, manage subscription quotas, or automatically migrate a running conversation between Claude Code and Codex.

## 2. Goals and non-goals

### Goals — v0.1.0

1. Provide a public, cross-platform npm CLI with global and repository-local setup.
2. Ask at most **two routine setup questions** in interactive mode: scope and profile.
3. Support equivalent non-interactive flags for CI, scripting, and experienced users.
4. Detect installed/supported coding runtimes automatically; **no integrations checkbox**.
5. Configure native Claude Code and Codex subagents for three tiers: `light`, `standard`, `heavy`.
6. Supply `economy`, `balanced` (default), and `quality` profiles and persistent configuration.
7. Allow global defaults, local overrides, and explicit model/effort customization.
8. Support safe, non-destructive GSD Core compatibility where detected and verified.
9. Explain **requested**, **effective**, **enforced**, and **advisory** routing separately.
10. Keep auth inside native tools. No required third-party model or paid API key.
11. Make setup, synchronization, and uninstall idempotent and reversible for owned changes.
12. Keep dependency count, model-visible instructions, and maintenance burden small.

### Non-goals — v0.1.0

- Implement a new LLM harness, scheduler, task database, or always-on daemon.
- Replace GSD Core agents, reimplement GSD execution, or fork GSD.
- Guarantee optimal model choice for every prompt or exact subscription savings.
- Guarantee availability of specific model generations on any account.
- Fetch or use private CLI credentials, OAuth tokens, or API keys.
- Auto-switch across exhausted Claude/Codex quotas or silently invoke paid APIs.
- Read all repositories when installing globally, or rewrite all existing GSD projects.
- Promise that changing a config file instantly affects already-running agent sessions.
- Install or configure unsupported third-party agent frameworks opportunistically.

## 3. Users and scenarios

**Primary user:** A developer using Claude Code or Codex via their existing account, with a mixture of coding, planning, documentation, research, and debugging tasks.

**Scenario A — first install:** `npx tiersplice@latest init` prompts for global/local and economy/balanced/quality, detects supported runtimes, shows an action summary, and installs native routing configurations.

**Scenario B — non-interactive setup:** `npx tiersplice@latest init --global --profile balanced --yes` performs safe installation, or exits nonzero with an actionable warning if an existing configuration requires manual resolution.

**Scenario C — repository override:** An existing global `balanced` profile remains unchanged while a single repository uses `quality`.

**Scenario D — GSD project:** Running local initialization or synchronization inside a project that uses GSD configures supported GSD model/effort controls where safe. GSD continues to own delegation and execution.

**Scenario E — audit:** `tiersplice doctor` identifies missing runtimes, unsupported model IDs, mismatched generated files, conflicting GSD overrides, and changes requiring regeneration.

**Scenario F — clean uninstall:** TierSplice removes only its managed files and owned configuration fragments; user-authored files and settings remain.

## 4. Product vocabulary and routing semantics

- **Runtime:** Claude Code or Codex (where native agent execution occurs).
- **Framework:** A higher-level workflow such as GSD Core that uses a runtime's delegation facilities.
- **Tier:** `light`, `standard`, or `heavy` — a coarse requirement for a task or agent role, **not** a measured IQ score.
- **Profile:** A mapping from tier to preferred model and reasoning effort (`economy`, `balanced`, `quality`).
- **Role:** An implementation or investigation specialty, e.g., documentation, exploration, implementation, architecture, debugging, review.
- **Native configuration:** Files that the runtime reads directly, e.g., Claude agent Markdown or Codex agent TOML.
- **Managed change:** A precisely tracked file or configuration fragment written by TierSplice.
- **Requested routing:** The user's TierSplice setting.
- **Effective routing:** The model and effort after resolving profile, overrides, runtime capabilities, and conflicts.
- **Enforced routing:** A concrete native model/effort pin that the runtime is confirmed to honor.
- **Advisory routing:** Instructions or agent descriptions encouraging delegation but not deterministically controlling it.

**Crucial limitation:** Agent descriptions and parent-agent routing instructions are advisory. Parent agents may choose not to delegate, and some host settings or explicit per-invocation choices override generated files. Do not present advisory behavior as guaranteed automatic routing. A task's GSD native dynamic routing is enforced only to the extent supported by the installed GSD/runtime combination.

## 5. Installation and CLI contract

### 5.1 Entry point

Publish one npm package exposing the `tiersplice` binary. `npx tiersplice@latest …` is the canonical no-permanent-install form. A persistent `tiersplice` shell command is available after users install the package in a way that places the binary on PATH.

**Prerequisite:** Node.js >= 20.11, Git only when needed for repository discovery; Windows, macOS, and Linux supported. `init --local` requires the current project directory (prefer Git root when available; allow explicit `--cwd`).

### 5.2 CLI commands

| Command | Behavior | v0.1 |
| --- | --- | --- |
| `init` | Interactive setup, two routine decisions | Required |
| `init --global` | User-level configuration and native agents | Required |
| `init --local` | Current-project configuration and native agents | Required |
| `init --global\|--local --profile <name> --yes` | Non-interactive setup, rejects unresolved conflicts | Required |
| `profile <economy\|balanced\|quality> --global\|--local` | Select profile at selected scope | Required |
| `status [--json]` | Show configured/inherited/effective routes and sync status | Required |
| `doctor [--json]` | Validate runtime support, files, models, ownership, conflicts | Required |
| `config edit [--global\|--local]` | Open config in preferred editor (or print path if no editor) | Required |
| `sync [--global\|--local] [--dry-run]` | Re-render managed native/framework config | Required |
| `uninstall --global\|--local [--dry-run]` | Remove managed files and owned fragments | Required |
| `--version`, `--help` | CLI metadata and usage | Required |
| `update` | Upgrade/reconcile installed assets | Later/alias only |
| `handoff`, `resume`, `watch` | Cross-platform task continuity | Future |

If `--global` and `--local` are both provided, fail. If both omitted in interactive setup, prompt. In non-TTY mode, `init` must require explicit scope (and use an explicit `--profile` or documented default with `--yes`); never silently modify global settings.

**Prompt #1:** `Install scope? Global (recommended) / Local`.

**Prompt #2:** `Routing profile? Economy / Balanced (recommended) / Quality`.

Show a short **read-only summary** of environments detected, files to create/patch, skips/conflicts, and whether a runtime restart is needed. This is not an integrations-selection screen. Only request additional confirmation if a potentially destructive operation is explicitly requested (never as part of normal initialization).

### 5.3 Runtime detection

- Detect only known local executables/config paths; prefer stable version/help checks and allow offline detection.
- Report runtime as `detected`, `not found`, or `unsupported version/unknown capability`.
- Configure every **supported detected runtime** without requesting an integration checkbox.
- If no supported runtime is found, write TierSplice's own config but return a clearly visible warning and provide next steps; do not claim native routing is active.
- Detection does not grant permission to read arbitrary repositories, execute AI prompts, or upload source code.
- GSD detection is project-scoped when `.planning/config.json` and/or a supported install marker is present. Do not scan unrelated directories.

### 5.4 Global versus local

- Global config: platform-appropriate user config directory, e.g. `${XDG_CONFIG_HOME:-~/.config}/tiersplice/config.json` on Unix, appropriate AppData location on Windows.
- Local config: `<repository-root>/.tiersplice.json`.
- Global generated Claude agents: under `~/.claude/agents/` with a `tiersplice-` prefix.
- Local generated Claude agents: under `<repo>/.claude/agents/` with a `tiersplice-` prefix.
- Global generated Codex agents: under `~/.codex/agents/` with a `tiersplice-` prefix.
- Local generated Codex agents: under `<repo>/.codex/agents/` with a `tiersplice-` prefix.
- Global setup must **not** walk through or alter existing repositories. Local settings override global TierSplice settings for their keys.
- Local uninstall must preserve global configuration, and vice versa.

## 6. Configuration schema and precedence

### 6.1 Minimal schema

```json
{
  "schemaVersion": 1,
  "profile": "balanced"
}
```

Before publishing, expose a real, versioned JSON Schema and document it; do not ship placeholder schema URLs.

### 6.2 Optional advanced schema (illustrative v0.1 target)

```json
{
  "schemaVersion": 1,
  "profile": "balanced",
  "models": {
    "claude": {
      "light": { "model": "haiku", "effort": "medium" },
      "standard": { "model": "sonnet", "effort": "medium" },
      "heavy": { "model": "opus", "effort": "high" }
    },
    "codex": {
      "light": { "model": "luna", "effort": "medium" },
      "standard": { "model": "luna", "effort": "high" },
      "heavy": { "model": "sol", "effort": "high" }
    }
  },
  "roles": {
    "documentation": "light",
    "exploration": "light",
    "implementation": "standard",
    "debugging": "standard",
    "architecture": "heavy",
    "review": "standard"
  },
  "escalation": {
    "enabled": true,
    "maxRetries": 1
  }
}
```

The `luna`/`sol` names are **TierSplice aliases** resolved by adapters to validated host model IDs (e.g., available GPT-6 family models); they are not raw model IDs to write into Codex configs. Likewise `haiku`/`sonnet`/`opus` are native tier aliases where supported. Support explicit full IDs as an advanced override, with runtime capability validation.

**Avoid any implicit API provider fallback.** If a requested model is unavailable, report a diagnostic and require a user's explicit change or allow native inheritance where valid. Never substitute DeepSeek, Kimi, Qwen, or another external provider by default.

### 6.3 Precedence

Resolve TierSplice policy in this order (low to high):

1. Built-in `balanced` defaults.
2. Selected profile's defaults.
3. Global configuration's explicitly set fields.
4. Local configuration's explicitly set fields.
5. Runtime-specific explicit model/effort overrides, if defined in the effective config.
6. Per-role overrides, if defined in the effective config.
7. Host-specific explicit invocation/environment overrides (reported, not overwritten).

**Implementation note:** Treat config merge and route resolution as distinct operations. The final user-visible output must show where each decision came from, and must distinguish TierSplice policy from actual host precedence. Invalid values should fail validation with exact paths and accepted values, not silently fall back.

### 6.4 Profiles

Default mappings are **policy recommendations**, not billing or capability guarantees. Reasoning levels must be capped/omitted based on actual host support.

| Profile | Claude light / standard / heavy | Codex light / standard / heavy | Intent |
| --- | --- | --- | --- |
| Economy | Haiku / Sonnet / Sonnet | Luna / Luna / Sol | Favor economical models, escalate only when needed |
| Balanced | Haiku / Sonnet / Opus | Luna / Luna / Sol | General-use balance of quality and usage |
| Quality | Sonnet / Sonnet / Opus | Luna / Sol / Sol | Prefer capable models for standard/heavy work |

Proposed default efforts:

- Economy: light `low` or `medium`, standard `medium`, heavy `high`.
- Balanced: light `medium`, standard `medium`/`high`, heavy `high`.
- Quality: light `medium`/`high`, standard `high`, heavy `high`/`max` **only where validated**.

Do not assume that higher effort is always more economical. The `doctor` command should flag unsupported combinations, not quietly write invalid pins.

### 6.5 Escalation

- Treat `maxRetries: 1` as a policy ceiling, **not a promise that TierSplice executes retries**.
- In native Claude/Codex usage, escalation may be advisory unless the host or existing framework offers a supported enforcement mechanism.
- When GSD provides supported soft-failure escalation, map the policy to **GSD's** native `dynamic_routing` controls.
- No retry loops on quota or authentication errors, and no hidden provider change.
- Do not escalate solely because a user asks for a longer answer; use task complexity, concrete failure/verification evidence, or explicit override.

## 7. Native adapter contracts

Each adapter implements a small, testable interface:

```ts
interface RuntimeAdapter {
  id: string;
  detect(context: DetectContext): Promise<Detection>;
  capabilities(context: DetectContext): Promise<Capabilities>;
  planSync(context: SyncContext): Promise<ManagedChange[]>;
  validate(context: SyncContext): Promise<Diagnostic[]>;
}
```

`planSync` must **only plan** changes. A single transactional file-operations layer applies plans with backups/ownership tracking. Adapters must never directly overwrite unrelated content.

### 7.1 Claude Code adapter

- Render minimal, distinct, `tiersplice-*` subagent Markdown definitions with valid YAML frontmatter (`name`, `description`, `model`, `effort` where supported).
- Suggested roles: `tiersplice-docs`, `tiersplice-explorer`, `tiersplice-implementer`, `tiersplice-architect`, `tiersplice-reviewer`. Avoid duplicate role definitions when GSD's own agents already own a workflow.
- Keep prompts concise and task-specific; read-only explorers/reviewers where supported, code-writing implementers only within host permissions.
- Add only one small, clearly delimited TierSplice routing advisory block to the appropriate global/project `CLAUDE.md` **if safely supported**. Prefer dedicated native agent descriptions to large persistent prompts.
- Never overwrite an existing user-authored `CLAUDE.md` or user-owned agent file. An existing conflicting marker or file must produce a conflict diagnostic.
- Respect host flags/env settings that override subagent `model` or `effort`. `doctor` should identify such overrides when detectable and otherwise state they may exist.
- Do not promise deterministic automatic delegation: subagents are selected by Claude or explicitly by the user.

### 7.2 Codex adapter

- Render valid `tiersplice-*` custom agent TOML definitions under user/project `.codex/agents/`.
- Use documented fields such as `name`, `description`, `model`, `model_reasoning_effort`, `developer_instructions`.
- When a model alias is resolved, ensure that the installed Codex version and authenticated account support the selected ID if possible to probe without using paid tokens. Otherwise label as `configured; availability unverified`.
- Avoid changing unrelated user settings such as sandbox, approvals, MCP servers, or global model selection.
- Set `[agents]` defaults only if explicitly needed and safely mergeable; prefer self-contained named agents to changing the whole session's defaults.
- A small managed `AGENTS.md` advisory block may be used; preserve all existing instructions and precedence.
- Avoid name collisions with built-ins and third-party custom agents.

### 7.3 Framework compatibility adapter: GSD Core

**Core rule:** GSD owns its own workflow. TierSplice is a policy/configuration source, not a substitute planner or executor.

- Detect a supported GSD installation **within the current project**.
- Read current project configuration and GSD's version/capabilities before proposing edits.
- Where supported, map TierSplice's profile to GSD `model_profile`, `models`, `model_overrides`, `model_policy`, `dynamic_routing`, and/or effort settings **using the smallest compatible set of keys**. Do not write redundant competing keys.
- Respect that GSD's `model_overrides` may take precedence over dynamic routing. Show the effective result, not merely the desired result.
- **Important:** Current GSD may shadow global model defaults whenever `.planning/config.json` exists; global TierSplice installation must not claim it reconfigured all existing GSD projects. `doctor` inside such a project must report when `sync --local` is required.
- Avoid editing GSD-generated agents/workflow files directly. If a supported GSD CLI requires regeneration of materialized Codex configs, emit a specific action and, only when safe and compatible, offer a documented command to run. Do not call an unknown installer blindly.
- Do not automatically alter existing explicit per-agent model assignments. Preserve them and report their precedence over TierSplice until the user opts in to a supported reconfiguration.
- Do not prompt for a generic 'GSD integration' checkbox. Detection and safe configuration are automatic; conflicts and consent-sensitive edits are surfaced as actions, not hidden.
- Absence of GSD is ordinary and must not affect installation.

**GSD acceptance gate:** A GSD project still creates and delegates the same work before and after TierSplice; only supported model/effort policy changes, and unrelated `.planning/config.json` fields are byte-equivalent in meaning. If this cannot be proven for an installed GSD version, do not mutate it; emit a compatibility warning.

## 8. Filesystem safety, ownership, and rollback

### 8.1 Ownership rules

- TierSplice owns files whose paths and contents it previously recorded in its install manifest.
- Use a manifest per scope recording package version, schema version, created paths, original hashes, current hashes, and any inserted marked-block identifiers.
- If an owned file has been modified by the user since the last sync, **do not overwrite or delete it** without a safe conflict-resolution path.
- Never delete or rewrite an entire `CLAUDE.md`, `AGENTS.md`, `config.toml`, or `.planning/config.json` just because it contains TierSplice settings.
- Never touch `.env`, secrets, credential stores, Git remotes, or application code in normal initialization.
- Missing files and unsupported versions are not grounds for broad permission changes.

### 8.2 Write procedure

1. Detect environment, read config, validate syntax and schema.
2. Calculate a complete write plan; show a dry-run diff/summary.
3. Check file ownership, conflicts, permissions, and targeted parent directories.
4. Back up every file to be modified, using private file permissions where possible.
5. Apply to temporary sibling paths and atomically rename where possible.
6. Write/update the ownership manifest only after the write succeeds.
7. On failure, restore prior state, and report exactly what remains changed.
8. On uninstall, remove only unchanged owned files and owned marked blocks; preserve and report divergences.

Prefer safe JSON/TOML/YAML parsers and minimal targeted patches. Unknown fields must round-trip intact. Preserve comments/order when practical, and avoid modifying a config just to reformat it.

### 8.3 Security

- No LLM/network calls during `init`, `status`, `doctor`, `sync`, or `uninstall` unless the user explicitly requests an optional online check.
- Never read or print CLI auth tokens; runtime availability checks must not dump environment variables.
- Never send repository content to TierSplice servers; there should be **no TierSplice backend** in v0.1.
- Do not run code from project configuration files or untrusted repository content.
- Validate paths against traversal and symlink escapes; refuse writes outside the selected scope except documented native global directories.
- Provide `--dry-run` and useful diagnostics before filesystem mutation.
- Dependency and publish pipeline should use lockfiles, CI scanning, and npm trusted publishing when available.

## 9. Diagnostic UX and actual routing visibility

### 9.1 `status`

Display: selected scope/profile; global/local sources; detected native runtimes; assigned roles/tiers; resolved model IDs and efforts; sync state; GSD configuration status; conflicts; whether values are **native pinned**, **framework enforced**, **advisory**, or **unverified**.

Example (illustrative, never claim unverified things are verified):

```text
TierSplice v0.1.0 (example)
Profile: balanced (global)  |  Project override: none
Claude Code: detected; native agents synchronized
  docs        light     haiku   medium   native pin
  implementer standard  sonnet  medium   native pin
  architect   heavy     opus    high     native pin
Codex: detected; model access not tested
  implementer standard  luna → gpt-6-luna       high  configured / unverified
  architect   heavy     sol  → gpt-6.1-sol      high  configured / unverified
GSD: detected; .planning/config.json overrides global model policy
  Action: run tiersplice sync --local in this repository
``` 

### 9.2 `doctor`

Checks: Node/runtime versions, parseable configs, scope resolution, installed native agents, model aliases, effort support, GSD shadowing/precedence, ownership drift, obsolete manifest records, mismatched generated assets, required native restart/reload, conflicts, and no-runtimes-detected scenario.

Return stable exit codes:

- `0`: valid and synchronized; benign absence of optional GSD.
- `1`: actionable warnings / partial configuration, e.g. unsupported runtime or model availability unverified (document exact behavior).
- `2`: invalid configuration, unsafe conflict, or unexpected error.

Provide machine-readable JSON output with versioned keys for both `status --json` and `doctor --json`.

## 10. Suggested repository layout

```text
tiersplice/
├── README.md
├── SPEC.md
├── LICENSE
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── CHANGELOG.md
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── cli/
│   ├── config/          # schema, merge, profile resolver
│   ├── routing/         # tier/role mapping and validation
│   ├── adapters/
│   │   ├── claude/
│   │   ├── codex/
│   │   └── gsd/
│   ├── filesystem/      # safe plan, apply, backup, manifest, uninstall
│   └── diagnostics/
├── templates/           # concise native agent templates
├── schemas/             # published config schema
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/        # bare repo, Claude, Codex, GSD, conflicts
└── .github/
    ├── workflows/       # lint, types, tests, packaging, release
    └── ISSUE_TEMPLATE/
```

Use **one package**, one CLI, one version. Do not introduce a plugin marketplace dependency, MCP server, database, monorepo, or local service solely to support v0.1.

## 11. Test plan and acceptance criteria

### Unit tests

- Profile mappings and tier-to-role resolution; explicit overrides and merge precedence.
- Invalid schema versions, malformed JSON, unsupported tiers, unknown roles, bad effort values.
- Deterministic model alias resolution without secretly changing providers.
- Capability filtering: unsupported effort omitted or flagged, never emitted as invalid.
- Exact, minimal native Claude YAML and Codex TOML generation.
- Parseable and stable JSON diagnostics.

### Filesystem integration tests

- Clean global install and clean local install.
- Repeated `init` and `sync` produce zero unnecessary changes.
- Existing CLAUDE.md and AGENTS.md are preserved; owned blocks changed surgically.
- Existing `.codex/config.toml` unrelated keys and comments survive where possible.
- User-modified managed file triggers conflict rather than overwrite.
- Atomic write failure rolls back changed files and manifest state.
- Local uninstall does not affect global; global uninstall does not affect local.
- Paths with spaces, Windows-style paths, symlinks, readonly directories, multiple Git worktrees, no Git repository.
- Offline/no-runtimes setup succeeds with clear partial status; never claims active routing.
- Non-interactive `init` without required flags refuses silent global mutation.

### GSD compatibility tests

- Non-GSD project is untouched.
- GSD project with no prior routing policy receives only compatible, supported policy fields.
- Existing explicit per-agent GSD overrides are preserved, with truthful effective-route diagnostics.
- Project `.planning/config.json` shadowing global GSD model defaults is detected.
- Unsupported GSD version yields warning and **no GSD mutations**.
- GSD Codex static/materialized configurations requiring regeneration get an actionable instruction.
- GSD's original workflow and user settings remain semantically equivalent except documented routing changes.

### CLI end-to-end tests

- Both interactive questions appear once and only once in a normal TTY install.
- `init --global --profile balanced --yes` runs unattended.
- `profile economy --local` changes local output only.
- `status` truthfully distinguishes native pin vs advisory instruction vs unverified access.
- `doctor` catches missing/invalid settings with stable exit code and concise repair advice.
- `uninstall --dry-run` makes no changes and lists exactly what would be removed.
- Installed `npx` package exposes the correct binary in a packed-tarball smoke test.

### Release acceptance checklist

- [ ] All above tests pass on Linux, macOS, and Windows CI where applicable.
- [ ] CLI help matches actual behavior; README never advertises unimplemented functionality as shipping.
- [ ] No credentials, repository content, or API requests transmitted by routine commands.
- [ ] Fresh and existing configurations are handled safely and idempotently.
- [ ] `doctor` catches GSD global/local shadowing rather than reporting a false success.
- [ ] Named npm package is actually publishable; release and version provenance are documented.
- [ ] `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md` and release notes are present.
- [ ] Test on a disposable GSD project and a disposable plain repository with Claude Code and Codex.
- [ ] Manual spot-check: native subagent model shown by host UI agrees with intended config when that host exposes verification.

## 12. Implementation phases

### Milestone 1 — Core CLI and configuration

Implement CLI scaffolding, schema and precedence, profiles, reliable scope resolution, `init`, `profile`, `status`, dry-run, safe write engine, manifest, and unit tests. No runtime mutations beyond TierSplice-owned config initially.

**Gate:** Repeated install, profile change, rollback, and uninstall are lossless on fixture repositories.

### Milestone 2 — Native runtime adapters

Add Claude Code and Codex detection, model/effort capability mapping, generated native agent files, concise routing advice, truthful `status`/`doctor` diagnostics, and compatibility tests.

**Gate:** Both runtimes can discover native agent definitions in their supported scope; unsupported model IDs never masquerade as confirmed working.

### Milestone 3 — GSD compatibility

Add project-scoped GSD detection, supported model-policy mapping, `dynamic_routing`/effort handling where available, precedence analysis, and safe sync or warning on conflicts.

**Gate:** GSD remains operational, existing explicit overrides survive, and global shadowing is detected. This milestone is a **v0.1 release gate** if GSD integration is advertised as a v0.1 feature; otherwise ship native adapters as v0.1 and label GSD support v0.2 without ambiguity.

### Milestone 4 — Public release quality

Add cross-platform CI, packed npm smoke test, contributor docs, license, security policy, trusted publishing, release process, and examples.

**Gate:** All v0.1 acceptance criteria pass; release notes accurately list what is implemented.

## 13. Future roadmap — not part of v0.1

### v0.2 — More framework compatibility

Refine GSD integration across supported releases, test global/local precedence deeply, expose richer role mapping, improve compatibility diagnostics, and add additional adapters only when genuine user demand exists.

### v0.3 — Explicit cross-platform handoff

Add a user-triggered command to produce a portable task handoff (requirements, branch, changed files, tests, remaining work). Resume in the other authenticated CLI, with conflict protection and no automatic repository rewriting. The handoff is explicit; hidden reasoning state is not transferable.

### v0.4+ — Opt-in external failover controller

Only after v0.3 is reliable: an external, bounded CLI controller may recognize supported usage-limit failures, checkpoint safely, and launch a different authenticated runtime. One active writer; no quota bypass, no hidden paid API fallback, no infinite retries, and no guarantee that the other subscription has capacity.

Future candidates: plugin distribution where it adds value, additional coding runtimes, model capability catalog updates, profile comparison and recommendations based on user-approved local telemetry. Do not add a daemon or remote backend unless a real requirement demands one.

## 14. Open-source and maintenance policy

- Target **MIT**, subject to adding a real `LICENSE` before publishing; do not claim licensed until added.
- Semantic versioning; every release updates `CHANGELOG.md` with significant changes and `README.md` with accurate implemented/future features.
- For every milestone or PR, maintain a precise implementation status (tests run, unsupported capabilities, known issues). Never mark proposals as complete.
- Prefer test-driven changes, no unexpected Git commits/pushes from installers, and small reviewable PRs.
- Require unit/integration tests for adapter changes; pin compatibility tests to specific host versions where available.
- Contributor guidance should explain adapter boundaries and the non-destructive config policy.
- GitHub Actions: typecheck, lint, tests, build/package validation; optional npm trusted publishing.
- Support documented Node LTS; minimize runtime dependencies; avoid shell assumptions that break Windows.

## 15. Technical reference links (recheck at implementation time)

- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Codex custom subagents: https://developers.openai.com/codex/multi-agent
- GSD Core model profiles: https://github.com/open-gsd/gsd-core/blob/next/docs/how-to/configure-model-profiles.md
- GSD Core configuration: https://github.com/open-gsd/gsd-core/blob/next/docs/CONFIGURATION.md

These are upstream interfaces that can change. Verify syntax and behavior against **installed runtime versions** before implementation; never infer actual subscription availability solely from the presence of a model alias.
