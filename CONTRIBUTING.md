# Contributing

TierSplice is a small Node.js ESM CLI with no runtime dependencies. It supports Node.js 20.11 and newer.

## Development

1. Install Node.js 20.11+.
2. Run `npm install` if you need the local package metadata installed.
3. Run `npm run check` to check JavaScript syntax.
4. Run the CLI with `node src/cli.js --help`.

Adapter changes should preserve host configuration and only write TierSplice-prefixed native agents. Keep model access explicitly unverified unless tested against a documented host capability. Do not read credentials or add network calls to routine commands. GSD changes require a pinned, supported schema/version and compatibility evidence before implementation.

Please include the operating system, Node version, runtime version, command, and redacted diagnostic output when reporting a problem. Never attach credentials or auth stores.
