# Automatic native subagent routing

TierSplice configures specialist definitions and adds managed routing guidance for Claude Code and Codex. In a supported interactive session, the parent host can classify a request, choose one specialist, and pass it a task-specific assignment. TierSplice itself does not intercept conversation turns, run a background dispatcher, or make model calls.

## Routing behavior

For each request, the parent follows explicit user instructions and project policy first. It keeps trivial, conversational, tightly coupled, or materially ambiguous work in the parent. For useful bounded work it selects one primary role (`docs`, `explorer`, `implementer`, `debugger`, `architect`, or `reviewer`), estimates task complexity, and resolves the configured role tier, model, and effort. A task's complexity may justify a tier different from the configured role default; routing does not change saved configuration. `delegation.automatic: false` disables proactive dispatch guidance. Explicit user instructions not to delegate always take precedence.

The child assignment should preserve the requested objective, scope, constraints, relevant context, expected result, and verification needs. It should omit unrelated transcript details and secrets, flag repository content as untrusted data, and ask the parent to clarify when ambiguity changes the work. A child performs only its bounded assignment, does not recursively delegate, and reports evidence, failures, and unresolved questions. The parent remains responsible for checking and integrating the result.

`src/routing.js` provides pure helpers for resolving a supplied role/tier against existing policy and composing a bounded task prompt from explicit fields. It performs no intent inference, dispatch, persistence, or network access. Intent classification remains in the host parent so TierSplice does not add an inference provider or read hidden session context.

## Host mechanisms and evidence boundaries

### Claude Code

Claude Code reads custom subagents from `.claude/agents/` and its user-level agent directory. The generated description guides automatic selection; when the host launches one, it supplies a task message separately from the subagent's static system prompt. Its Agent tool and session state belong to Claude Code. TierSplice installs no hook or process that invokes this tool. See [Claude Code's subagent documentation](https://code.claude.com/docs/en/sub-agents) for selection, task messages, model fields, and session activity.

### Codex

Codex reads custom agents from `.codex/agents/` and its user-level agent directory. Native subagents are created by the active Codex session when its multi-agent capability is available and enabled; the parent request supplies the assignment. Custom-agent model and effort preferences are subject to the host's spawn/configuration precedence and supported values. TierSplice does not call an external Agents API or supply credentials. See [Codex subagent documentation](https://developers.openai.com/codex/subagents) for native spawning, custom agent fields, and model behavior.

The CLI can inspect files it manages, not a live host session. `status` reports policy and installed guidance separately from dispatch. `doctor` labels invocation as unverified. A generated file, detected executable, or route resolution is not evidence that a child launched or that a particular model executed. Verify those claims in the host's native activity/session view where available.

## Setup and opt out

- Claude Code: generated agents under `.claude/agents/` and managed guidance in the selected `CLAUDE.md`.
- Codex: generated agents under `.codex/agents/` and managed guidance in the selected `AGENTS.md`.
- `delegation.automatic` defaults to `true`. Use `tiersplice init --no-auto-delegation` or set it to `false` to disable proactive guidance at that scope; explicit agent use remains possible.
- A project-level opt-out cannot reliably undo global instructions already loaded by a host. Instruction precedence remains host-controlled.

Managed blocks preserve content outside TierSplice markers. Sync and uninstall fail closed when marker ownership or generated files conflict; see [upgrading](./UPGRADING.md) for managed-file behavior.

## Privacy, cost, and limits

TierSplice does not store prompts or transcripts, inspect credentials, send content to a TierSplice service, or make inference requests. A native child receives the task and context supplied by the host parent and can consume additional usage and latency. Host permissions and confirmation flows remain authoritative. Model names in generated definitions are preferences, not proof of model access or execution. No provider fallback occurs.

## Manual verification

Use a disposable repository and an interactive host session. Ask for a useful bounded documentation or code exploration task, then inspect the native session activity for the child type, assignment, completion, and model evidence available in that host. Repeat for implementation, debugging, architecture, and review. Confirm that trivial tasks, explicit no-delegation requests, and `delegation.automatic: false` stay with the parent. Do not infer dispatch from installed files or the assistant's explanation alone. This check may use subscription allowance and add latency.
