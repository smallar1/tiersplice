# Security policy

## Reporting a vulnerability

Please report security issues privately to the repository maintainers before public disclosure. Include the affected command, platform, Node.js version, impact, and a minimal reproduction. Do not include credentials, tokens, private repositories, or other secrets.

## Security boundaries

Routine TierSplice commands are local-only and make no network requests. TierSplice does not read coding-runtime credentials or execute project configuration. Configuration is user-editable source; generated native agents use the `tiersplice-` prefix and manifest hashes. Manifest paths are treated as untrusted and constrained to the selected config and native-agent locations. If a generated file is modified after installation, sync and uninstall preserve it and report the conflict.
