# Automatic native delegation

TierSplice installs concise advisory instructions for Claude Code and Codex alongside its six configured native agents. After `tiersplice init --global` or `tiersplice init --local`, ordinary coding requests can be delegated by the host to a matching specialist without a special TierSplice prompt. The host remains in control: instructions cannot guarantee that it will dispatch an agent.

## What gets installed

- Claude Code: agents in `.claude/agents` at the selected scope and a managed block in the user `CLAUDE.md` or project `CLAUDE.md` instruction file.
- Codex: agents in `.codex/agents` and a managed block in the user `AGENTS.md` or project `AGENTS.md` instruction file.
- The managed block is under 200 words, profile-agnostic, and delimited with TierSplice markers. Existing bytes outside the block remain user-owned.
- `delegation.automatic` defaults to `true`; use `tiersplice init --no-auto-delegation` or set it to `false` to disable proactive guidance at that scope. Native agents remain available for explicit use.

For a project-level opt-out under an enabled global policy, TierSplice installs a project instruction asking the host not to proactively dispatch TierSplice agents. Hosts may already have loaded global guidance, and instruction precedence is host-controlled; the override is advisory.

## Verify behavior

Run `tiersplice status --global` or `tiersplice status --local` to inspect configured state and installed instruction blocks. Run `tiersplice doctor` for diagnostics. These commands do not inspect credentials or invoke a model. `native delegation not verified` means TierSplice has not observed actual agent invocation.

To verify manually, start a fresh Claude Code or Codex session after initialization and give it an ordinary, nontrivial task, such as “Find where reconnect handling is implemented and summarize the flow.” Inspect the host's native subagent activity or session trace to confirm which agent actually ran. Repeat for documentation, implementation, debugging, architecture, and review requests. Do not infer invocation from the presence of generated files or from a model's explanation. A host session may consume subscription allowance and increase latency or token use.

## Ownership and conflicts

`sync` updates an intact managed block while preserving edits outside it. Modified, duplicate, malformed, or mismatched TierSplice markers fail closed and are reported. `uninstall` removes only an unchanged managed block; it preserves user-owned instruction files and blocks it cannot verify. Use `--dry-run` to preview changes. If a conflict is reported, inspect the named file and resolve the marker conflict manually before syncing.

Global setup changes only user-level configuration and native instruction/agent files; it does not traverse repositories. Local setup changes only the selected project. Claude and Codex use separate instruction files. Existing workflow choices and explicit user instructions take precedence according to the host's instruction hierarchy.

## Limits

Routing is advisory, not enforced. Native host versions, account entitlements, model access, instruction discovery, and actual invocation are not verified by offline TierSplice commands. TierSplice pins the configured model on child-agent definitions; it does not change the parent conversational model, switch subscriptions, bypass permissions, or guarantee usage savings. The `resolve` command remains a framework-neutral policy interface and does not imply execution.
