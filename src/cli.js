#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { detectRuntimes, renderClaude, renderCodex } from './adapters.js';
import { PROFILES, readConfig, resolvePolicy, validateConfig } from './config.js';
import { applyInstructionBlocks, applyManaged, assertNoSymlinkPath, atomicWrite, hash, inspectInstructionBlock, listOwned, readManifest, resolvePaths, uninstallOwned } from './filesystem.js';

const { version: VERSION } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const EXIT = { ok: 0, warning: 1, error: 2 };

function parseArgs(argv) {
  const positionals = [];
  const options = { yes: false, json: false, dryRun: false, autoDelegation: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (arg === '--global') options.global = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-auto-delegation') options.autoDelegation = false;
    else if (arg === '--auto-delegation') options.autoDelegation = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--profile') options.profile = argv[++i];
    else if (arg === '--runtime') options.runtime = argv[++i];
    else if (arg === '--role') options.role = argv[++i];
    else if (arg === '--tier') options.tier = argv[++i];
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++i] || '.');
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else positionals.push(arg);
  }
  if (options.global && options.local) throw new Error('Choose only one of --global or --local.');
  return { command: positionals[0] || 'help', args: positionals.slice(1), options };
}

function scopeOption(options) { return options.global ? 'global' : options.local ? 'local' : null; }

async function chooseScopeAndProfile(options) {
  let scope = scopeOption(options);
  let profile = options.profile || null;
  if (scope && profile) return { scope, profile };
  if (!stdin.isTTY || !stdout.isTTY) {
    if (!scope) throw new Error('Non-interactive init requires --global or --local.');
    if (!options.yes) throw new Error('Non-interactive init requires --yes.');
    return { scope, profile: profile || 'balanced' };
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!scope) {
      const answer = (await rl.question('Install scope? Global (recommended) / Local [global]: ')).trim().toLowerCase();
      scope = answer === 'local' ? 'local' : 'global';
    }
    if (!profile) {
      const answer = (await rl.question('Routing profile? Economy / Balanced (recommended) / Quality [balanced]: ')).trim().toLowerCase();
      profile = answer || 'balanced';
    }
  } finally { rl.close(); }
  return { scope, profile };
}

async function readPolicyInputs(paths, cwd = process.cwd()) {
  const globalPaths = await resolvePaths('global');
  const localPaths = await resolvePaths('local', cwd);
  const global = await readConfig(globalPaths.config);
  const local = await readConfig(localPaths.config);
  return { globalPaths, localPaths, global, local, policy: resolvePolicy(global.value, local.value) };
}

function nativeChanges(paths, policy, runtimes) {
  const changes = [];
  if (runtimes.claude.status === 'detected') {
    for (const agent of renderClaude(policy)) changes.push({ path: path.join(paths.claudeAgents, `tiersplice-${agent.name}.md`), content: agent.content });
  }
  if (runtimes.codex.status === 'detected') {
    for (const agent of renderCodex(policy)) changes.push({ path: path.join(paths.codexAgents, `tiersplice-${agent.name}.toml`), content: agent.body });
  }
  return changes;
}

function instructionChanges(paths, policy, runtimes, { scope, localOverridesGlobal = false } = {}) {
  const changes = [];
  const automatic = policy.automatic !== false;
  for (const runtime of ['claude', 'codex']) {
    if (runtimes[runtime].status !== 'detected') continue;
    const file = runtime === 'claude' ? paths.claudeInstructions : paths.codexInstructions;
    const enabled = automatic || localOverridesGlobal;
    if (!enabled) {
      changes.push({ path: file, content: '', kind: 'instruction-remove' });
      continue;
    }
    const body = localOverridesGlobal
      ? 'In this project, do not proactively dispatch TierSplice agents; follow project workflow choices.'
      : 'For useful bounded work, proactively delegate to the matching TierSplice specialist: docs, explorer, implementer, debugger, architect, or reviewer. Skip trivial tasks, honor explicit instructions, avoid duplicate or recursive work, and preserve existing workflow choices. The parent integrates results. Delegation is advisory and host-controlled.';
    changes.push({ path: file, content: body, kind: 'instruction-block' });
  }
  return changes;
}

async function withFileRollback(files, manifestPath, allowedRoots, operation) {
  const targets = [...new Set([...files, manifestPath])];
  const snapshot = new Map();
  for (const file of targets) {
    const boundary = allowedRoots.map((root) => path.resolve(root)).filter((root) => file === root || file.startsWith(`${root}${path.sep}`)).sort((a, b) => b.length - a.length)[0];
    if (!boundary) throw new Error(`Refusing rollback snapshot outside the selected scope: ${file}`);
    await assertNoSymlinkPath(path.dirname(file), boundary);
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing rollback snapshot through a symlink: ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    snapshot.set(file, await readFile(file).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)));
  }
  try { return await operation(); }
  catch (error) {
    const failures = [];
    for (const [file, content] of snapshot) {
      const boundary = allowedRoots.map((root) => path.resolve(root)).filter((root) => file === root || file.startsWith(`${root}${path.sep}`)).sort((a, b) => b.length - a.length)[0];
      try {
        if (content === null) await rm(file, { force: true });
        else await atomicWrite(file, content, { boundary: boundary || path.dirname(file) });
      } catch (rollbackError) { failures.push(`${file}: ${rollbackError.message}`); }
    }
    if (failures.length) throw new Error(`Operation failed and rollback was incomplete (${failures.join('; ')}): ${error.message}`);
    throw new Error(`Operation failed; prior files restored: ${error.message}`);
  }
}

function outputJson(value) { stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function isKnownManagedPath(paths, file) {
  const target = path.resolve(file);
  if (target === paths.config) return true;
  if ([paths.claudeAgents, paths.codexAgents].some((root) => path.dirname(target) === path.resolve(root) && /^tiersplice-[a-z0-9_-]+\.(md|toml)$/.test(path.basename(target)))) return true;
  const instructions = [paths.claudeInstructions, paths.codexInstructions];
  if (path.basename(paths.manifest) === '.tiersplice-manifest.json') instructions.push(path.join(paths.root, '.claude', 'CLAUDE.md'), path.join(paths.root, '.codex', 'AGENTS.md'), path.join(paths.root, 'CLAUDE.md'), path.join(paths.root, 'AGENTS.md'));
  return instructions.some((candidate) => path.resolve(candidate) === target);
}

function printRoutes(policy, runtimes) {
  for (const runtime of ['claude', 'codex']) {
    const detected = runtimes[runtime];
    stdout.write(`${runtime === 'claude' ? 'Claude Code' : 'Codex'}: ${detected.status}${detected.version ? ` (${detected.version})` : ''}${detected.status === 'detected' ? '; model access unverified' : ''}\n`);
    if (detected.status !== 'detected') continue;
    for (const [role, tier] of Object.entries(policy.roles)) {
      const route = policy.routes[runtime][tier];
      const enforcement = runtime === 'claude' || route.effort === 'max' ? 'model preference generated; effort advisory' : 'model/effort preferences generated';
      stdout.write(`  ${role.padEnd(16)} ${tier.padEnd(8)} ${route.model.padEnd(18)} ${route.effort.padEnd(7)} ${enforcement}; invocation and access unverified\n`);
    }
  }
}

async function createInitialConfig(file, manifestPath, profile, dryRun, automatic = true) {
  const current = await readConfig(file);
  if (current.errors.length) throw new Error(current.errors.join('\n'));
  if (current.value) return { created: false, planned: false, exists: true, content: JSON.stringify(current.value, null, 2) + '\n' };
  const content = `${JSON.stringify({ schemaVersion: 1, profile, delegation: { automatic } }, null, 2)}\n`;
  const result = await applyManaged([{ path: file, content }], manifestPath, { dryRun });
  if (result.conflicts.length) throw new Error(result.conflicts.join('\n'));
  if (!dryRun) {
    const manifest = await readManifest(manifestPath);
    if (manifest.files[file]) {
      manifest.files[file].kind = 'config';
      await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: path.dirname(manifestPath) });
    }
  }
  return { created: !dryRun, planned: true, exists: false, content };
}

async function commandInit(options) {
  const { scope, profile } = await chooseScopeAndProfile(options);
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile "${profile}"; choose economy, balanced, or quality.`);
  const paths = await resolvePaths(scope, options.cwd);
  const inputs = await readPolicyInputs(paths, options.cwd);
  const invalid = [...inputs.global.errors, ...inputs.local.errors];
  if (invalid.length) throw new Error(invalid.join('\n'));
  const current = scope === 'global' ? inputs.global.value : inputs.local.value;
  const selectedConfig = current ? { ...current, profile } : { schemaVersion: 1, profile, delegation: { automatic: true } };
  if (options.autoDelegation !== null) selectedConfig.delegation = { ...selectedConfig.delegation, automatic: options.autoDelegation };
  const globalConfig = scope === 'global' ? selectedConfig : inputs.global.value;
  const policy = scope === 'global' ? resolvePolicy(selectedConfig, null) : resolvePolicy(globalConfig, selectedConfig);
  const runtimes = await detectRuntimes(paths);
  const changes = nativeChanges(paths, policy, runtimes);
  const blockChanges = instructionChanges(paths, { ...policy, automatic: selectedConfig.delegation?.automatic }, runtimes, { scope, localOverridesGlobal: scope === 'local' && selectedConfig.delegation?.automatic === false && Boolean(inputs.global.value && inputs.global.value.delegation?.automatic !== false) });
  const roots = [paths.root, paths.claudeAgents, paths.codexAgents, path.dirname(paths.claudeInstructions), path.dirname(paths.codexInstructions)];
  const preflight = await applyManaged(changes, paths.manifest, { dryRun: true, allowedRoots: roots.slice(0, 3) });
  const blockPreflight = await applyInstructionBlocks(blockChanges, paths.manifest, { dryRun: true, allowedRoots: roots, allowedInstructionFiles: [paths.claudeInstructions, paths.codexInstructions] });
  preflight.conflicts.push(...blockPreflight.conflicts);
  if (preflight.conflicts.length) {
    if (options.json) outputJson({ schemaVersion: 1, command: 'init', scope, profile: policy.profile, dryRun: options.dryRun, runtimes, changes: [], warnings: preflight.conflicts });
    else for (const conflict of preflight.conflicts) stdout.write(`Conflict: ${conflict}\n`);
    return EXIT.warning;
  }
  const { initial, profileUpdated, applied, blocks } = await withFileRollback(
    [paths.config, ...changes.map((item) => item.path), ...blockChanges.map((item) => item.path)],
    paths.manifest,
    roots,
    async () => {
      const initial = await createInitialConfig(paths.config, paths.manifest, profile, options.dryRun, options.autoDelegation ?? true);
      let profileUpdated = false;
      if (initial.exists && initial.content) {
        const old = await readConfig(paths.config);
        if (old.value && (old.value.profile !== profile || options.autoDelegation !== null && old.value.delegation?.automatic !== options.autoDelegation)) { await setProfileAtPath(paths, profile, options.dryRun, null, options.autoDelegation); profileUpdated = true; }
      }
      const applied = await applyManaged(changes, paths.manifest, { dryRun: options.dryRun, allowedRoots: roots.slice(0, 3) });
      const blocks = await applyInstructionBlocks(blockChanges, paths.manifest, { dryRun: options.dryRun, allowedRoots: roots, allowedInstructionFiles: [paths.claudeInstructions, paths.codexInstructions] });
      if (applied.conflicts.length || blocks.conflicts.length) throw new Error(`Conflict during initialization: ${[...applied.conflicts, ...blocks.conflicts].join('; ')}`);
      return { initial, profileUpdated, applied, blocks };
    }
  );
  const warnings = [...applied.conflicts, ...blocks.conflicts];
  if (runtimes.claude.status !== 'detected' && runtimes.codex.status !== 'detected') warnings.push('No supported runtime detected; TierSplice policy was saved but native routing is not active.');
  const configAction = initial.planned ? 'create' : profileUpdated ? 'update' : null;
  if (options.json) outputJson({ schemaVersion: 1, command: 'init', scope, profile: policy.profile, config: paths.config, autoDelegation: selectedConfig.delegation?.automatic !== false, dryRun: options.dryRun, runtimes, changes: [...(configAction ? [{ path: paths.config, action: options.dryRun ? configAction : `${configAction}d` }] : []), ...applied.applied, ...blocks.applied], warnings });
  else {
    stdout.write(`TierSplice ${VERSION}: ${options.dryRun ? 'planned' : 'configured'} ${scope} profile ${policy.profile}.\n`);
    for (const change of applied.applied) stdout.write(`  ${change.action}: ${change.path}\n`);
    for (const change of blocks.applied) stdout.write(`  ${change.action}: ${change.path}\n`);
    if (initial.planned) stdout.write(`  ${options.dryRun ? 'create' : 'created'}: ${paths.config}\n`);
    else if (profileUpdated) stdout.write(`  ${options.dryRun ? 'update' : 'updated'}: ${paths.config}\n`);
    for (const warning of warnings) stdout.write(`Warning: ${warning}\n`);
    printRoutes(policy, runtimes);
    if (!options.dryRun && blocks.applied.length) stdout.write('Start a fresh host session to load updated instructions and agents.\n');
  }
  return warnings.length ? EXIT.warning : EXIT.ok;
}

async function commandProfile(profile, options) {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile "${profile}"; choose economy, balanced, or quality.`);
  const scope = scopeOption(options);
  if (!scope) throw new Error('profile requires --global or --local.');
  const inputs = await readPolicyInputs(null, options.cwd);
  const invalid = [...inputs.global.errors, ...inputs.local.errors];
  if (invalid.length) throw new Error(invalid.join('\n'));
  const paths = await resolvePaths(scope, options.cwd);
  return await setProfileAtPath(paths, profile, options.dryRun, scope);
}

async function setProfileAtPath(paths, profile, dryRun, scope = null, autoDelegation = null) {
  const current = await readConfig(paths.config);
  if (current.errors.length) throw new Error(current.errors.join('\n'));
  const value = { ...(current.value || {}), schemaVersion: 1, profile };
  if (autoDelegation !== null) value.delegation = { ...value.delegation, automatic: autoDelegation };
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const manifest = await readManifest(paths.manifest);
  const previous = manifest.files[paths.config];
  if (!dryRun) {
    const oldContent = current.value ? await readFile(paths.config) : null;
    const oldManifest = await readFile(paths.manifest).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    try {
      await atomicWrite(paths.config, content, { boundary: paths.root });
      if (previous) {
        if (oldContent && hash(oldContent) !== previous.currentHash) previous.userModified = true;
        previous.currentHash = hash(content);
        previous.kind = 'source-config';
        manifest.files[paths.config] = previous;
        await atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: paths.root });
      } else if (!current.value) {
        manifest.files[paths.config] = { created: true, originalHash: null, currentHash: hash(content), kind: 'source-config' };
        await atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: paths.root });
      }
    } catch (error) {
      const rollbackErrors = [];
      if (oldContent) await atomicWrite(paths.config, oldContent, { boundary: paths.root }).catch((failure) => rollbackErrors.push(`${paths.config}: ${failure.message}`));
      else await rm(paths.config, { force: true }).catch((failure) => rollbackErrors.push(`${paths.config}: ${failure.message}`));
      if (oldManifest) await atomicWrite(paths.manifest, oldManifest, { boundary: paths.root }).catch((failure) => rollbackErrors.push(`${paths.manifest}: ${failure.message}`));
      else await rm(paths.manifest, { force: true }).catch((failure) => rollbackErrors.push(`${paths.manifest}: ${failure.message}`));
      throw new Error(`Profile update failed; ${rollbackErrors.length ? `rollback incomplete (${rollbackErrors.join('; ')})` : 'prior state restored'}: ${error.message}`);
    }
  }
  if (scope) stdout.write(`${dryRun ? 'Would set' : 'Set'} ${scope} profile to ${profile} at ${paths.config}.\n`);
  return EXIT.ok;
}

async function buildStatus(scope, cwd) {
  const paths = await resolvePaths(scope, cwd);
  const { globalPaths, localPaths, global, local, policy } = await readPolicyInputs(paths, cwd);
  const runtimePaths = scope === 'global' ? paths : localPaths;
  const runtimes = await detectRuntimes(runtimePaths);
  const manifest = await readManifest(paths.manifest);
  const files = [];
  for (const [file, record] of Object.entries(manifest.files)) {
    let status = 'missing';
    if (!isKnownManagedPath(paths, file)) {
      files.push({ path: file, type: record.kind || 'native-agent', status: 'outside-allowlist' });
      continue;
    }
    try {
      const contents = await readFile(file);
      const matches = hash(contents) === record.currentHash;
      if (record.kind === 'instruction-block') {
        let block = null;
        try { block = inspectInstructionBlock(contents.toString('utf8')); } catch {}
        status = block && hash(block) === record.currentHash ? 'instruction-block-installed' : 'instruction-block-conflict';
      } else status = ['config', 'source-config'].includes(record.kind) ? (matches ? 'source-config' : 'user-edited-config') : (matches ? 'synchronized' : 'modified');
    } catch {}
    files.push({ path: file, type: record.kind || (file === paths.config ? 'config' : 'native-agent'), status });
  }
  const automatic = scope === 'global' ? global.value?.delegation?.automatic !== false : (local.value?.delegation?.automatic ?? global.value?.delegation?.automatic ?? true);
  const instructionFiles = files.filter((file) => file.type === 'instruction-block');
  const autoSource = scope === 'global' ? (global.value?.delegation?.automatic === undefined ? 'default:on' : 'global:delegation') : (local.value?.delegation?.automatic !== undefined ? 'local:delegation' : global.value?.delegation?.automatic !== undefined ? 'global:delegation' : 'default:on');
  return { schemaVersion: 1, version: VERSION, scope, config: { global: globalPaths.config, local: localPaths.config, globalProfile: global.value?.profile ?? null, localProfile: local.value?.profile ?? null, effectiveProfile: policy.profile, profileSource: local.value?.profile ? 'local:profile' : global.value?.profile ? 'global:profile' : 'built-in' }, routes: policy.routes, roles: policy.roles, runtimes, autoDelegation: { configured: automatic ? 'enabled' : 'disabled', source: autoSource, installed: instructionFiles.length > 0 && instructionFiles.every((file) => file.status === 'instruction-block-installed'), observed: 'unverified', instructions: instructionFiles, globalPolicy: global.value?.delegation?.automatic === false ? 'disabled' : 'enabled', localOverrideLimit: scope === 'local' && local.value?.delegation?.automatic === false && global.value?.delegation?.automatic !== false ? 'project guidance is advisory and cannot reliably undo already-loaded global guidance' : null }, managedFiles: files };
}

async function commandStatus(options) {
  const scope = scopeOption(options) || 'local';
  const status = await buildStatus(scope, options.cwd);
  if (options.json) outputJson(status);
  else {
    stdout.write(`TierSplice v${VERSION}\nProfile: ${status.config.effectiveProfile} (${status.config.localProfile ? 'local' : status.config.globalProfile ? 'global' : 'default'})\n`);
    printRoutes({ profile: status.config.effectiveProfile, roles: status.roles, routes: status.routes }, status.runtimes);
    for (const file of status.managedFiles) stdout.write(`Managed file: ${file.status} ${file.path}\n`);
    stdout.write(`Auto-delegation: ${status.autoDelegation.configured}; ${status.autoDelegation.installed ? 'instruction installed' : 'instruction not installed'}; native delegation not verified.\n`);
  }
  return EXIT.ok;
}

async function commandDoctor(options) {
  const scope = scopeOption(options) || 'local';
  const paths = await resolvePaths(scope, options.cwd);
  const status = await buildStatus(scope, options.cwd);
  const diagnostics = [];
  const inputs = await readPolicyInputs(paths, options.cwd);
  for (const config of [inputs.global, inputs.local]) diagnostics.push(...config.errors.map((message) => ({ severity: 'error', code: 'CONFIG_INVALID', message, remediation: 'Correct the indicated JSON value; TierSplice will not reset invalid configuration.' })));
  const config = scope === 'global' ? inputs.global : inputs.local;
  if (!config.value && !config.errors.length) diagnostics.push({ severity: 'warning', code: 'CONFIG_MISSING', message: `No ${scope} TierSplice config at ${paths.config}; using inherited/default policy.`, remediation: 'Run tiersplice init with an explicit scope and profile to save a policy.' });
  for (const runtime of Object.values(status.runtimes)) {
    if (runtime.status !== 'detected') diagnostics.push({ severity: 'warning', code: 'RUNTIME_NOT_FOUND', message: `${runtime.id} was not detected.`, remediation: 'Install that runtime if you want TierSplice to generate its native agents.' });
    else {
      diagnostics.push({ severity: 'warning', code: 'MODEL_ACCESS_UNVERIFIED', message: `${runtime.id} is detected; model access is unverified and no credentials were inspected.`, remediation: 'Check model availability in the native runtime without sharing credentials with TierSplice.' });
      diagnostics.push({ severity: 'warning', code: 'AGENT_INVOCATION_UNVERIFIED', message: `${runtime.id} native agent selection and execution have not been observed.`, remediation: 'Explicitly invoke a generated agent in a disposable project to verify host behavior.' });
    }
  }
  diagnostics.push({ severity: 'warning', code: status.autoDelegation.configured === 'enabled' ? (status.autoDelegation.installed ? 'AUTO_DELEGATION_UNVERIFIED' : 'AUTO_DELEGATION_NOT_INSTALLED') : 'AUTO_DELEGATION_DISABLED', message: status.autoDelegation.configured === 'enabled' ? (status.autoDelegation.installed ? 'TierSplice routing guidance is installed; native delegation has not been verified.' : 'Automatic delegation is configured but no valid managed routing block is installed.') : 'Automatic TierSplice delegation is disabled at this scope; generated agents remain available.', remediation: 'Start a normal session and inspect native agent invocation evidence; use tiersplice sync to install or refresh guidance.' });
  if (status.runtimes.claude.status === 'detected') diagnostics.push({ severity: 'warning', code: 'CLAUDE_EFFORT_ADVISORY', message: 'Claude agent model preferences are generated; reasoning effort remains advisory.', remediation: 'Set effort in the native runtime if you require a verified per-agent effort setting.' });
  if (status.runtimes.codex.status === 'detected' && Object.values(status.routes.codex).some((route) => route.effort === 'max')) diagnostics.push({ severity: 'warning', code: 'CODEX_EFFORT_OMITTED', message: 'Codex effort "max" is not emitted because host support has not been verified.', remediation: 'Choose a supported effort level or configure max directly in a compatible Codex release.' });
  for (const file of status.managedFiles) if (file.type === 'instruction-block' ? file.status !== 'instruction-block-installed' : !['config', 'source-config'].includes(file.type) && file.status !== 'synchronized') diagnostics.push({ severity: 'error', code: 'MANAGED_FILE_DRIFT', message: `${file.path} is ${file.status}; sync will refuse to overwrite it.`, remediation: 'Review the TierSplice block and restore or remove it before syncing; TierSplice preserves user instructions.' });
  const code = diagnostics.some((d) => d.severity === 'error') ? EXIT.error : diagnostics.length ? EXIT.warning : EXIT.ok;
  if (options.json) outputJson({ schemaVersion: 1, version: VERSION, scope, status: code === 0 ? 'ok' : code === 1 ? 'warning' : 'error', diagnostics });
  else {
    stdout.write(`TierSplice doctor (${scope})\n`);
    if (!diagnostics.length) stdout.write('No issues found.\n');
    for (const d of diagnostics) stdout.write(`${d.severity.toUpperCase()} ${d.code}: ${d.message}\n`);
  }
  return code;
}

async function commandSync(options) {
  const scope = scopeOption(options) || 'local';
  const paths = await resolvePaths(scope, options.cwd);
  const inputs = await readPolicyInputs(paths, options.cwd);
  const invalid = [...inputs.global.errors, ...inputs.local.errors];
  if (invalid.length) throw new Error(invalid.join('\n'));
  const policy = scope === 'global' ? resolvePolicy(inputs.global.value, null) : inputs.policy;
  const runtimes = await detectRuntimes(paths);
  const changes = nativeChanges(paths, policy, runtimes);
  const automatic = scope === 'global' ? inputs.global.value?.delegation?.automatic !== false : (inputs.local.value?.delegation?.automatic ?? inputs.global.value?.delegation?.automatic ?? true);
  const blockChanges = instructionChanges(paths, { ...policy, automatic }, runtimes, { scope, localOverridesGlobal: scope === 'local' && inputs.local.value?.delegation?.automatic === false && Boolean(inputs.global.value && inputs.global.value.delegation?.automatic !== false) });
  const roots = [paths.root, paths.claudeAgents, paths.codexAgents, path.dirname(paths.claudeInstructions), path.dirname(paths.codexInstructions)];
  const preManaged = await applyManaged(changes, paths.manifest, { dryRun: true, allowedRoots: roots.slice(0, 3) });
  const preBlocks = await applyInstructionBlocks(blockChanges, paths.manifest, { dryRun: true, allowedRoots: roots, allowedInstructionFiles: [paths.claudeInstructions, paths.codexInstructions] });
  let result;
  let blocks;
  if (preManaged.conflicts.length || preBlocks.conflicts.length || options.dryRun) {
    result = preManaged;
    blocks = preBlocks;
  } else {
    ({ result, blocks } = await withFileRollback(
      [...changes.map((item) => item.path), ...blockChanges.map((item) => item.path)],
      paths.manifest,
      roots,
      async () => {
        const result = await applyManaged(changes, paths.manifest, { allowedRoots: roots.slice(0, 3) });
        const blocks = await applyInstructionBlocks(blockChanges, paths.manifest, { allowedRoots: roots, allowedInstructionFiles: [paths.claudeInstructions, paths.codexInstructions] });
        if (result.conflicts.length || blocks.conflicts.length) throw new Error(`Conflict during sync: ${[...result.conflicts, ...blocks.conflicts].join('; ')}`);
        return { result, blocks };
      }
    ));
  }
  result.conflicts.push(...blocks.conflicts);
  if (options.json) outputJson({ schemaVersion: 1, command: 'sync', scope, autoDelegation: automatic, dryRun: options.dryRun, changes: [...result.applied, ...blocks.applied], conflicts: result.conflicts, runtimes });
  else {
    stdout.write(`${options.dryRun ? 'Sync plan' : 'Sync'} (${scope})\n`);
    for (const item of result.applied) stdout.write(`  ${item.action}: ${item.path}\n`);
    for (const item of blocks.applied) stdout.write(`  ${item.action}: ${item.path}\n`);
    for (const conflict of result.conflicts) stdout.write(`Conflict: ${conflict}\n`);
  }
  return result.conflicts.length || (runtimes.claude.status !== 'detected' && runtimes.codex.status !== 'detected') ? EXIT.warning : EXIT.ok;
}

async function commandUninstall(options) {
  const scope = scopeOption(options);
  if (!scope) throw new Error('uninstall requires --global or --local.');
  const paths = await resolvePaths(scope, options.cwd);
  const instructionFiles = scope === 'local'
    ? [paths.claudeInstructions, paths.codexInstructions, path.join(paths.root, '.claude', 'CLAUDE.md'), path.join(paths.root, '.codex', 'AGENTS.md'), path.join(paths.root, 'CLAUDE.md'), path.join(paths.root, 'AGENTS.md')]
    : [paths.claudeInstructions, paths.codexInstructions];
  const instructionAllowlist = [...new Set(instructionFiles.map((file) => path.resolve(file)))];
  const ownership = await readManifest(paths.manifest);
  const ownedInstructionFiles = Object.entries(ownership.files).filter(([, record]) => record.kind === 'instruction-block').map(([file]) => path.resolve(file));
  const staleInstructionConflicts = ownedInstructionFiles.filter((file) => !instructionAllowlist.includes(file)).map((file) => `${file}: managed instruction block is outside the current native instruction locations; inspect and remove it manually`);
  const removalFiles = [...new Set([...instructionAllowlist, ...ownedInstructionFiles.filter((file) => instructionAllowlist.includes(file))])];
  const nativeRoots = [paths.root, paths.claudeAgents, paths.codexAgents, ...instructionAllowlist.map((file) => path.dirname(file))];
  const nativeOwnership = await listOwned(paths.manifest, { allowedRoots: [paths.root, paths.claudeAgents, paths.codexAgents], allowedConfig: paths.config });
  const { blockResult, result } = await withFileRollback(
    [...removalFiles, ...nativeOwnership.removable],
    paths.manifest,
    nativeRoots,
    async () => {
      const blockResult = await applyInstructionBlocks(removalFiles.map((file) => ({ path: file, content: '', kind: 'instruction-remove' })), paths.manifest, {
        dryRun: options.dryRun,
        allowedRoots: nativeRoots,
        allowedInstructionFiles: instructionAllowlist
      });
      const result = await uninstallOwned(paths.manifest, options.dryRun, { allowedRoots: [paths.root, paths.claudeAgents, paths.codexAgents], allowedConfig: paths.config });
      return { blockResult, result };
    }
  );
  result.conflicts.push(...blockResult.conflicts, ...staleInstructionConflicts);
  const removed = [...blockResult.applied.map((item) => item.path), ...result.removable];
  if (options.json) outputJson({ schemaVersion: 1, command: 'uninstall', scope, dryRun: options.dryRun, removed, preservedConflicts: result.conflicts });
  else {
    stdout.write(`${options.dryRun ? 'Would remove' : 'Removed'} ${removed.length} unchanged TierSplice-managed item(s).\n`);
    for (const file of removed) stdout.write(`  ${file}\n`);
    for (const file of result.conflicts) stdout.write(`Preserved modified file: ${file}\n`);
  }
  return result.conflicts.length ? EXIT.warning : EXIT.ok;
}

async function commandResolve(options) {
  if (!['claude', 'codex'].includes(options.runtime)) throw new Error('resolve requires --runtime claude or --runtime codex.');
  if (Boolean(options.role) === Boolean(options.tier)) throw new Error('resolve requires exactly one of --role or --tier.');
  if (options.tier && !['light', 'standard', 'heavy'].includes(options.tier)) throw new Error(`Unknown tier "${options.tier}".`);
  const globalPaths = await resolvePaths('global');
  const localPaths = await resolvePaths('local', options.cwd);
  const global = await readConfig(globalPaths.config);
  const local = options.global ? { value: null, errors: [] } : await readConfig(localPaths.config);
  const errors = [...global.errors, ...local.errors];
  if (errors.length) throw new Error(errors.join('\n'));
  const policy = resolvePolicy(global.value, local.value);
  const role = options.role ?? null;
  const tier = options.tier ?? policy.roles[role];
  if (!tier) throw new Error(`Unknown role "${role}"; define it in the TierSplice roles config.`);
  const route = policy.routes[options.runtime][tier];
  outputJson({ schemaVersion: 1, runtime: options.runtime, role, tier, model: route.model, effort: route.effort, profile: policy.profile, sources: { tier: options.tier ? 'argument' : local.value?.roles?.[role] ? 'local:roles' : global.value?.roles?.[role] ? 'global:roles' : 'built-in-role', model: local.value?.models?.[options.runtime]?.[tier]?.model ? 'local:models' : global.value?.models?.[options.runtime]?.[tier]?.model ? 'global:models' : `profile:${policy.profile}`, effort: local.value?.models?.[options.runtime]?.[tier]?.effort ? 'local:models' : global.value?.models?.[options.runtime]?.[tier]?.effort ? 'global:models' : `profile:${policy.profile}`, profile: local.value?.profile ? 'local:profile' : global.value?.profile ? 'global:profile' : 'built-in' }, assignment: 'policy-only', modelAvailability: 'unverified' });
  return EXIT.ok;
}

async function commandEdit(options) {
  const scope = scopeOption(options) || 'local';
  const paths = await resolvePaths(scope, options.cwd);
  const inputs = await readPolicyInputs(paths, options.cwd);
  const invalid = [...inputs.global.errors, ...inputs.local.errors];
  if (invalid.length) throw new Error(invalid.join('\n'));
  await createInitialConfig(paths.config, paths.manifest, 'balanced', false);
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) { stdout.write(`${paths.config}\n`); return EXIT.ok; }
  const [program, ...args] = editor.split(/\s+/);
  const child = spawn(program, [...args, paths.config], { stdio: 'inherit', windowsHide: true });
  return await new Promise((resolve) => child.on('exit', (code) => resolve(code === 0 ? EXIT.ok : EXIT.warning)));
}

function help() {
  stdout.write(`TierSplice v${VERSION} — model policy for coding agents\n\nUsage:\n  tiersplice init [--global|--local] [--profile economy|balanced|quality] [--no-auto-delegation] [--yes] [--dry-run]\n  tiersplice profile <name> --global|--local [--dry-run]\n  tiersplice status [--global|--local] [--json]\n  tiersplice doctor [--global|--local] [--json]\n  tiersplice sync [--global|--local] [--dry-run] [--json]\n  tiersplice config edit [--global|--local]\n  tiersplice uninstall --global|--local [--dry-run] [--json]\n  tiersplice resolve --runtime <claude|codex> (--role <role>|--tier <tier>) [--global|--local] --json\n\nNode.js >=20.11. Runtime model availability and native invocation are not probed.\n`);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const { command, args, options } = parseArgs(argv);
    if (options.version) { stdout.write(`${VERSION}\n`); return EXIT.ok; }
    if (options.help || command === 'help') { help(); return EXIT.ok; }
    if (command === 'init') return await commandInit(options);
    if (command === 'profile') return await commandProfile(args[0], options);
    if (command === 'status') return await commandStatus(options);
    if (command === 'doctor') return await commandDoctor(options);
    if (command === 'sync') return await commandSync(options);
    if (command === 'uninstall') return await commandUninstall(options);
    if (command === 'resolve') return await commandResolve(options);
    if (command === 'config' && args[0] === 'edit') return await commandEdit(options);
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`tiersplice: ${error.message}\n`);
    return EXIT.error;
  }
}

if (process.argv[1]) {
  try {
    if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
  } catch {}
}
