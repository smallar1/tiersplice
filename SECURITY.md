# Security policy

## Reporting a vulnerability

Please report security issues privately to the repository maintainers before public disclosure. Include the affected command, platform, Node.js version, impact, and a minimal reproduction. Do not include credentials, tokens, private repositories, or other secrets.

## Security boundaries

Routine TierSplice commands are local-only and make no network requests. TierSplice does not read coding-runtime credentials or execute project configuration. Generated files use the `tiersplice-` prefix. If a managed file is modified after installation, sync and uninstall preserve it and report the conflict.
