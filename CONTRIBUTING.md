# Contributing

TierSplice is a small Node.js ESM CLI with no runtime dependencies. It supports Node.js 20.11 and newer.

## Development

1. Install Node.js 20.11+.
2. Run `npm ci` for a reproducible dependency install.
3. Run `npm run check` to check JavaScript syntax.
4. Run the CLI with `node src/cli.js --help`.

TierSplice owns role and tier policy, configuration precedence, and its own named native agent definitions. Host runtimes own execution and delegation; framework integrations can consume `tiersplice resolve` but TierSplice must not rewrite their files. Adapter changes should preserve unrelated host configuration and only write allowlisted TierSplice-prefixed agents. Keep model access and invocation unverified unless observed. Do not read credentials or add network calls to routine commands.

Changes should include fixture-based tests for policy precedence, native output, filesystem ownership, and CLI behavior as applicable. Run `npm run check`, `npm test`, `npm run smoke:pack`, `npm pack --dry-run --json`, and `npm audit` before opening a PR. CI runs these checks on Linux, macOS, and Windows for Node 20 and 22; inspect the workflow result rather than assuming it passed.

Use a focused feature branch and review staged files before pushing. Do not commit `.env*`, `.npmrc` credentials, runtime auth stores, private transcripts, generated archives, caches, or local `.tiersplice-manifest.json` ownership records. The source-controlled `.tiersplice.json` policy file is intentionally not ignored. Never push or publish automatically from a local coding session.

Please include the operating system, Node version, runtime version, command, and redacted diagnostic output when reporting a problem. Never attach credentials or auth stores.
