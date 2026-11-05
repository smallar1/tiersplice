# Model tracking and refresh

TierSplice keeps model routing inside Claude Code and Codex. Model discovery is read-only metadata lookup; it is not an inference test, an account entitlement check, or a provider marketplace.

## Tracking policies

| Policy | Behavior |
| --- | --- |
| `native-alias` | Keep a native family alias such as Claude Code's `sonnet`; Claude Code resolves the concrete generation. |
| `latest-compatible` | Consider only validated models discovered from the native runtime and an explicit compatible recommendation. |
| `pinned` | Preserve a concrete model ID until the user changes it. |

Built-in Claude family routes use native aliases. TierSplice does not claim which exact generation a session selected. Existing explicit model IDs remain pinned unless a tracking policy is explicitly configured. Tracking metadata is optional and the existing `resolve` JSON schema v1 remains unchanged.

Codex updates require a catalog entry marked visible and an explicit recommended upgrade. The proposed model must have the same known family and support the configured reasoning effort. If the family, visibility, recommendation, or effort is unknown, TierSplice keeps the current route and reports why it skipped the update. A model catalog does not prove that a user's account can use that model.

## Commands

```sh
tiersplice models list --runtime codex --json
tiersplice models status --global
tiersplice models refresh --global --dry-run
tiersplice models refresh --global
tiersplice models refresh --global --offline
```

`models list` asks the supported native discovery adapter for current catalog data and stores valid results in the user cache. Claude Code currently has no supported TierSplice read-only catalog adapter; the command reports native alias behavior instead of inventing model data.

`models status` reports effective assignments, tracking, pin state, cache age, and whether cached data is stale. `models refresh` proposes compatible updates; online discovery happens only when explicitly running refresh without `--dry-run` or `--offline`. A dry run uses cached data only and does not write the cache. `--offline` uses validated cached data and performs no native lookup.

Catalog discovery or validation failures leave current model choices intact. Model changes apply only after ownership/conflict preflight, and regenerated native agent definitions require a new native session to take effect.

## Catalog cache and privacy

Catalog data is cached per user outside project repositories. The cache records its schema version, runtime, source, fetch time, validation state, and model capabilities. It rejects oversized or malformed results, unsafe IDs, and unsupported effort values. Cache data is metadata only; TierSplice does not store runtime credentials, source code, transcripts, or inference output.

Codex discovery uses the native `codex app-server` stdio protocol's `model/list` operation with a short timeout and bounded output. The actual capability depends on the installed Codex version and its environment. Failures are reported; TierSplice does not fall back to a public API catalog, scrape release announcements, or test a model by inference.

## Pins, opt-out, and automation

An explicit model override without tracking metadata is treated as pinned. A `tracking: "pinned"` route must name a concrete model. `modelUpdates.enabled: false` opts the selected scope out of automatic compatible-generation updates; it does not prevent users from editing model assignments themselves.

Automatic session-start refresh is not implemented. No hook is installed or activated, and no daemon, cron job, or background service runs. Use the manual refresh command when you want to check for updates.

## Evidence boundaries

Discovery means that a native catalog returned model metadata. It does not establish account entitlement, successful execution, quality, billing, or that an already-running session has loaded a refreshed agent definition. Verify model use in the native runtime if execution evidence is needed. Do not share credentials or tokens for that check.
