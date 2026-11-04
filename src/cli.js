#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { detectGsd, detectRuntimes, gsdShadowing, renderClaude, renderCodex } from './adapters.js';
import { PROFILES, readConfig, resolvePolicy, validateConfig } from './config.js';
import { applyManaged, atomicWrite, hash, readManifest, resolvePaths, uninstallOwned } from './filesystem.js';

const VERSION = '0.1.0';
const EXIT = { ok: 0, warning: 1, error: 2 };

function parseArgs(argv) {
  const positionals = [];
  const options = { yes: false, json: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (arg === '--global') options.global = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--profile') options.profile = argv[++i];
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
    const entries = [
      ['docs', 'documentation'], ['explorer', 'exploration'], ['implementer', 'implementation'], ['architect', 'architecture'], ['reviewer', 'review']
    ];
    const rendered = renderClaude(policy).split('\n\n');
    entries.forEach(([name], i) => changes.push({ path: path.join(paths.claudeAgents, `tiersplice-${name}.md`), content: `${rendered[i]}\n` }));
  }
  if (runtimes.codex.status === 'detected') {
    for (const agent of renderCodex(policy)) changes.push({ path: path.join(paths.codexAgents, `tiersplice-${agent.name}.toml`), content: agent.body });
  }
  return changes;
}

function outputJson(value) { stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

function printRoutes(policy, runtimes) {
  for (const runtime of ['claude', 'codex']) {
    const detected = runtimes[runtime];
    stdout.write(`${runtime === 'claude' ? 'Claude Code' : 'Codex'}: ${detected.status}${detected.version ? ` (${detected.version})` : ''}${detected.status === 'detected' ? '; model access unverified' : ''}\n`);
    if (detected.status !== 'detected') continue;
    for (const [role, tier] of Object.entries(policy.roles)) {
      const route = policy.routes[runtime][tier];
      const enforcement = runtime === 'claude' || route.effort === 'max' ? 'native model pin; effort advisory' : 'native model/effort pin';
      stdout.write(`  ${role.padEnd(16)} ${tier.padEnd(8)} ${route.model.padEnd(18)} ${route.effort.padEnd(7)} ${enforcement}; access unverified\n`);
    }
  }
}

async function runtimeContext(scope, paths, policy) {
  const runtimes = await detectRuntimes(paths);
  const gsd = scope === 'local' ? await detectGsd(paths.root) : { detected: false, message: 'GSD detection is project-scoped; no project scan was performed.' };
  return { runtimes, gsd, shadowing: gsdShadowing(gsd, scope, null), changes: nativeChanges(paths, policy, runtimes) };
}

async function createInitialConfig(file, manifestPath, profile, dryRun) {
  const current = await readConfig(file);
  if (current.errors.length) throw new Error(current.errors.join('\n'));
  if (current.value) return { created: false, planned: false, exists: true, content: JSON.stringify(current.value, null, 2) + '\n' };
  const content = `${JSON.stringify({ schemaVersion: 1, profile }, null, 2)}\n`;
  const result = await applyManaged([{ path: file, content }], manifestPath, { dryRun });
  if (result.conflicts.length) throw new Error(result.conflicts.join('\n'));
  if (!dryRun) {
    const manifest = await readManifest(manifestPath);
    if (manifest.files[file]) {
      manifest.files[file].kind = 'config';
      await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return { created: !dryRun, planned: true, exists: false, content };
}

async function commandInit(options) {
  const { scope, profile } = await chooseScopeAndProfile(options);
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile "${profile}"; choose economy, balanced, or quality.`);
  const paths = await resolvePaths(scope, options.cwd);
  const initial = await createInitialConfig(paths.config, paths.manifest, profile, options.dryRun);
  let profileUpdated = false;
  if (initial.exists && initial.content) {
    const old = await readConfig(paths.config);
    if (old.value && old.value.profile !== profile) { await setProfileAtPath(paths, profile, options.dryRun); profileUpdated = true; }
  }
  const config = await readConfig(paths.config);
  const globalConfig = scope === 'global' ? (config.value ?? { schemaVersion: 1, profile }) : (await readConfig((await resolvePaths('global')).config)).value;
  const selectedConfig = options.dryRun && config.value ? { ...config.value, profile } : config.value ?? { schemaVersion: 1, profile };
  const policy = scope === 'global' ? resolvePolicy(selectedConfig, null) : resolvePolicy(globalConfig, selectedConfig);
  const { runtimes, gsd, changes } = await runtimeContext(scope, paths, policy);
  const applied = await applyManaged(changes, paths.manifest, { dryRun: options.dryRun, allowedRoots: [paths.root, homedir()] });
  const warnings = [...applied.conflicts];
  if (runtimes.claude.status !== 'detected' && runtimes.codex.status !== 'detected') warnings.push('No supported runtime detected; TierSplice policy was saved but native routing is not active.');
  if (gsd.detected) warnings.push(gsd.message);
  const configAction = initial.planned ? 'create' : profileUpdated ? 'update' : null;
  if (options.json) outputJson({ schemaVersion: 1, command: 'init', scope, profile: policy.profile, config: paths.config, dryRun: options.dryRun, runtimes, gsd: { detected: gsd.detected, status: gsd.supported ? 'supported' : gsd.detected ? 'unverified' : 'not detected', message: gsd.message }, changes: [...(configAction ? [{ path: paths.config, action: options.dryRun ? configAction : `${configAction}d` }] : []), ...applied.applied], warnings });
  else {
    stdout.write(`TierSplice ${VERSION}: ${options.dryRun ? 'planned' : 'configured'} ${scope} profile ${policy.profile}.\n`);
    for (const change of applied.applied) stdout.write(`  ${change.action}: ${change.path}\n`);
    if (initial.planned) stdout.write(`  ${options.dryRun ? 'create' : 'created'}: ${paths.config}\n`);
    else if (profileUpdated) stdout.write(`  ${options.dryRun ? 'update' : 'updated'}: ${paths.config}\n`);
    if (gsd.detected) stdout.write(`GSD: ${gsd.message}\n`);
    for (const warning of warnings) stdout.write(`Warning: ${warning}\n`);
    printRoutes(policy, runtimes);
  }
  return warnings.length ? EXIT.warning : EXIT.ok;
}

async function commandProfile(profile, options) {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`Unknown profile "${profile}"; choose economy, balanced, or quality.`);
  const scope = scopeOption(options);
  if (!scope) throw new Error('profile requires --global or --local.');
  const paths = await resolvePaths(scope, options.cwd);
  return await setProfileAtPath(paths, profile, options.dryRun, scope);
}

async function setProfileAtPath(paths, profile, dryRun, scope = null) {
  const current = await readConfig(paths.config);
  if (current.errors.length) throw new Error(current.errors.join('\n'));
  const value = { ...(current.value || {}), schemaVersion: 1, profile };
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const manifest = await readManifest(paths.manifest);
  const previous = manifest.files[paths.config];
  if (previous) {
    let raw;
    try { raw = await readFile(paths.config); } catch { raw = null; }
    if (raw && hash(raw) !== previous.currentHash) throw new Error(`${paths.config}: TierSplice-managed config was modified; refusing to overwrite it.`);
  }
  if (!dryRun) {
    await atomicWrite(paths.config, content);
    if (previous) { previous.currentHash = hash(content); manifest.files[paths.config] = previous; await atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`); }
    else if (!current.value) {
      manifest.files[paths.config] = { created: true, originalHash: null, currentHash: hash(content) };
      manifest.files[paths.config].kind = 'config';
      await atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
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
  const gsd = scope === 'local' ? await detectGsd(paths.root) : { detected: false, message: 'GSD detection is project-scoped; no project scan was performed.' };
  const manifest = await readManifest(paths.manifest);
  const files = [];
  for (const [file, record] of Object.entries(manifest.files)) {
    let status = 'missing';
    try { status = hash(await readFile(file)) === record.currentHash ? 'synchronized' : 'modified'; } catch {}
    files.push({ path: file, type: record.kind || (file === paths.config ? 'config' : 'native-agent'), status });
  }
  return { schemaVersion: 1, version: VERSION, scope, config: { global: globalPaths.config, local: localPaths.config, globalProfile: global.value?.profile ?? null, localProfile: local.value?.profile ?? null, effectiveProfile: policy.profile }, routes: policy.routes, roles: policy.roles, runtimes, gsd: { detected: gsd.detected, status: gsd.detected ? 'unverified' : 'not detected', message: gsd.message, shadowing: gsdShadowing(gsd, scope, local.value) }, managedFiles: files };
}

async function commandStatus(options) {
  const scope = scopeOption(options) || 'local';
  const status = await buildStatus(scope, options.cwd);
  if (options.json) outputJson(status);
  else {
    stdout.write(`TierSplice v${VERSION}\nProfile: ${status.config.effectiveProfile} (${status.config.localProfile ? 'local' : status.config.globalProfile ? 'global' : 'default'})\n`);
    printRoutes({ profile: status.config.effectiveProfile, roles: status.roles, routes: status.routes }, status.runtimes);
    stdout.write(`GSD: ${status.gsd.message}\n`);
    if (status.gsd.shadowing) stdout.write(`Action: ${status.gsd.shadowing}\n`);
    for (const file of status.managedFiles) stdout.write(`Managed file: ${file.status} ${file.path}\n`);
  }
  return EXIT.ok;
}

async function commandDoctor(options) {
  const scope = scopeOption(options) || 'local';
  const paths = await resolvePaths(scope, options.cwd);
  const status = await buildStatus(scope, options.cwd);
  const diagnostics = [];
  const config = await readConfig(paths.config);
  diagnostics.push(...config.errors.map((message) => ({ severity: 'error', code: 'CONFIG_INVALID', message })));
  if (!config.value && !config.errors.length) diagnostics.push({ severity: 'warning', code: 'CONFIG_MISSING', message: `No ${scope} TierSplice config at ${paths.config}; using inherited/default policy.` });
  for (const runtime of Object.values(status.runtimes)) {
    if (runtime.status !== 'detected') diagnostics.push({ severity: 'warning', code: 'RUNTIME_NOT_FOUND', message: `${runtime.id} was not detected.` });
    else diagnostics.push({ severity: 'warning', code: 'MODEL_ACCESS_UNVERIFIED', message: `${runtime.id} is detected; model access is unverified and no credentials were inspected.` });
  }
  if (status.runtimes.claude.status === 'detected') diagnostics.push({ severity: 'warning', code: 'CLAUDE_EFFORT_ADVISORY', message: 'Claude agent model pins are generated; reasoning effort is not pinned because support is not verified.' });
  if (status.runtimes.codex.status === 'detected' && Object.values(status.routes.codex).some((route) => route.effort === 'max')) diagnostics.push({ severity: 'warning', code: 'CODEX_EFFORT_OMITTED', message: 'Codex effort "max" is not emitted because host support has not been verified.' });
  for (const file of status.managedFiles) if (file.type !== 'config' && file.status !== 'synchronized') diagnostics.push({ severity: 'error', code: 'MANAGED_FILE_DRIFT', message: `${file.path} is ${file.status}; sync will refuse to overwrite it.` });
  if (status.gsd.detected) diagnostics.push({ severity: 'warning', code: 'GSD_UNVERIFIED', message: status.gsd.message });
  if (status.gsd.shadowing) diagnostics.push({ severity: 'warning', code: 'GSD_PRECEDENCE', message: status.gsd.shadowing });
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
  const config = await readConfig(paths.config);
  if (config.errors.length) throw new Error(config.errors.join('\n'));
  const inputs = await readPolicyInputs(paths, options.cwd);
  const policy = scope === 'global' ? resolvePolicy(inputs.global.value, null) : inputs.policy;
  const runtimes = await detectRuntimes(paths);
  const changes = nativeChanges(paths, policy, runtimes);
  const result = await applyManaged(changes, paths.manifest, { dryRun: options.dryRun, allowedRoots: [paths.root, homedir()] });
  const gsd = scope === 'local' ? await detectGsd(paths.root) : { detected: false };
  if (options.json) outputJson({ schemaVersion: 1, command: 'sync', scope, dryRun: options.dryRun, changes: result.applied, conflicts: result.conflicts, runtimes, gsd: { detected: gsd.detected, status: gsd.detected ? 'unverified' : 'not detected' } });
  else {
    stdout.write(`${options.dryRun ? 'Sync plan' : 'Sync'} (${scope})\n`);
    for (const item of result.applied) stdout.write(`  ${item.action}: ${item.path}\n`);
    for (const conflict of result.conflicts) stdout.write(`Conflict: ${conflict}\n`);
    if (gsd.detected) stdout.write('GSD detected; no GSD config was changed because compatibility is unverified.\n');
  }
  return result.conflicts.length || (runtimes.claude.status !== 'detected' && runtimes.codex.status !== 'detected') ? EXIT.warning : EXIT.ok;
}

async function commandUninstall(options) {
  const scope = scopeOption(options);
  if (!scope) throw new Error('uninstall requires --global or --local.');
  const paths = await resolvePaths(scope, options.cwd);
  const result = await uninstallOwned(paths.manifest, options.dryRun, { allowedRoots: [paths.root, homedir()], allowedConfig: paths.config });
  if (options.json) outputJson({ schemaVersion: 1, command: 'uninstall', scope, dryRun: options.dryRun, removed: result.removable, preservedConflicts: result.conflicts });
  else {
    stdout.write(`${options.dryRun ? 'Would remove' : 'Removed'} ${result.removable.length} unchanged TierSplice-managed file(s).\n`);
    for (const file of result.removable) stdout.write(`  ${file}\n`);
    for (const file of result.conflicts) stdout.write(`Preserved modified file: ${file}\n`);
  }
  return result.conflicts.length ? EXIT.warning : EXIT.ok;
}

async function commandEdit(options) {
  const scope = scopeOption(options) || 'local';
  const paths = await resolvePaths(scope, options.cwd);
  await createInitialConfig(paths.config, paths.manifest, 'balanced', false);
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) { stdout.write(`${paths.config}\n`); return EXIT.ok; }
  const [program, ...args] = editor.split(/\s+/);
  const child = spawn(program, [...args, paths.config], { stdio: 'inherit', windowsHide: true });
  return await new Promise((resolve) => child.on('exit', (code) => resolve(code === 0 ? EXIT.ok : EXIT.warning)));
}

function help() {
  stdout.write(`TierSplice v${VERSION} — model policy for coding agents\n\nUsage:\n  tiersplice init [--global|--local] [--profile economy|balanced|quality] [--yes] [--dry-run]\n  tiersplice profile <name> --global|--local [--dry-run]\n  tiersplice status [--global|--local] [--json]\n  tiersplice doctor [--global|--local] [--json]\n  tiersplice sync [--global|--local] [--dry-run] [--json]\n  tiersplice config edit [--global|--local]\n  tiersplice uninstall --global|--local [--dry-run] [--json]\n\nNode.js >=20.11. Runtime model availability is not probed.\n`);
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
