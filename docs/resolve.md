# `tiersplice resolve` JSON contract

`resolve` reads TierSplice configuration and writes one JSON object to stdout. It does not invoke a runtime, access credentials, make network requests, or change files. It works when neither Claude Code nor Codex is installed.

```sh
tiersplice resolve --runtime claude --role implementation --json
tiersplice resolve --runtime codex --tier heavy --local --json
tiersplice resolve --runtime claude --role architecture --global --json
```

Supply exactly one of `--role` and `--tier`. `--global` reads only the global policy. The default and `--local` read global policy followed by local overrides. Invalid participating configuration returns exit code `2`, a diagnostic on stderr, and no JSON document. Successful resolution returns exit code `0`.

The v1 output is defined by [`../schemas/resolve.schema.json`](../schemas/resolve.schema.json). The `sources` object identifies the policy source for tier, model, effort, and profile. `assignment: "policy-only"` means it is a recommendation; `modelAvailability: "unverified"` means the CLI did not check whether the account or runtime can use that model. This output does not prove that parent routing instructions are installed or that the host invoked an agent. Consumers should ignore unknown future schema versions and must not interpret this output as an execution guarantee.

```json
{
  "schemaVersion": 1,
  "runtime": "claude",
  "role": "implementation",
  "tier": "standard",
  "model": "sonnet",
  "effort": "medium",
  "profile": "balanced",
  "sources": {
    "tier": "built-in-role",
    "model": "profile:balanced",
    "effort": "profile:balanced",
    "profile": "built-in"
  },
  "assignment": "policy-only",
  "modelAvailability": "unverified"
}
```
