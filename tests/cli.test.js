import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile, chmod, access, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function fixture(t, runtimes = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tiersplice-cli-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project space');
  const bin = path.join(root, 'bin');
  await mkdir(path.join(project, '.git'), { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  if (runtimes) {
    if (process.platform === 'win32') {
      await mkdir(path.join(home, '.claude'), { recursive: true });
      await mkdir(path.join(home, '.codex'), { recursive: true });
      await writeFile(path.join(home, '.claude', 'settings.json'), '{}');
      await writeFile(path.join(home, '.codex', 'config.toml'), '');
    } else {
      for (const [name, version] of [['claude', 'Claude Code 2.0.0'], ['codex', 'codex 0.50.0']]) {
        const executable = path.join(bin, name);
        await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
        await chmod(executable, 0o755);
      }
    }
  }
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(root, 'appdata'),
    XDG_CONFIG_HOME: path.join(root, 'xdg'),
    PATH: runtimes && process.platform !== 'win32' ? bin : '',
    EDITOR: '',
    VISUAL: ''
  };
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', project], { cwd: project, env, encoding: 'utf8' });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { root, home, project, bin, env, run };
}

function globalConfigPath(fx) {
  const configHome = process.platform === 'win32' ? fx.env.APPDATA : fx.env.XDG_CONFIG_HOME;
  return path.join(configHome, 'tiersplice', 'config.json');
}

test('non-interactive init requires explicit scope and confirmation', async (t) => {
  const fx = await fixture(t);
  const result = fx.run('init');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires --global or --local/);
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));
});

test('CLI runs when invoked through an npm-style symlink', async (t) => {
  const fx = await fixture(t);
  const link = path.join(fx.bin, 'tiersplice');
  await symlink(cli, link);
  const result = spawnSync(process.execPath, [link, '--version'], { env: fx.env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
});

test('local init, status JSON, profile change, and doctor report truthful runtime state', async (t) => {
  const fx = await fixture(t, true);
  const init = fx.run('init', '--local', '--profile', 'balanced', '--yes');
  assert.equal(init.status, 0, init.stderr);
  const config = JSON.parse(await readFile(path.join(fx.project, '.tiersplice.json'), 'utf8'));
  assert.equal(config.profile, 'balanced');
  const agents = path.join(fx.project, '.codex', 'agents');
  assert.match(await readFile(path.join(agents, 'tiersplice-implementer.toml'), 'utf8'), /model_reasoning_effort = "high"/);
  assert.match(await readFile(path.join(fx.project, '.claude', 'agents', 'tiersplice-explorer.md'), 'utf8'), /tools: Read, Grep, Glob/);
  const claudePolicy = await readFile(path.join(fx.project, 'CLAUDE.md'), 'utf8');
  assert.match(claudePolicy, /tiersplice:auto-delegation:start v1/);
  assert.match(claudePolicy, /proactively delegate/);
  const codexPolicy = await readFile(path.join(fx.project, 'AGENTS.md'), 'utf8');
  assert.match(codexPolicy, /tiersplice:auto-delegation:start v1/);

  const status = fx.run('status', '--local', '--json');
  assert.equal(status.status, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.schemaVersion, 1);
  assert.equal(statusJson.config.effectiveProfile, 'balanced');
  assert.equal(statusJson.runtimes.codex.status, 'detected');
  assert.equal(statusJson.autoDelegation.observed, 'unverified');
  assert.equal(statusJson.autoDelegation.installed, true);

  const profile = fx.run('profile', 'quality', '--local');
  assert.equal(profile.status, 0, profile.stderr);
  assert.equal(JSON.parse(await readFile(path.join(fx.project, '.tiersplice.json'), 'utf8')).profile, 'quality');
  const doctor = fx.run('doctor', '--local', '--json');
  assert.equal(doctor.status, 1);
  assert.equal(JSON.parse(doctor.stdout).status, 'warning');
  assert.ok(JSON.parse(doctor.stdout).diagnostics.some((item) => item.code === 'MODEL_ACCESS_UNVERIFIED'));
  assert.ok(JSON.parse(doctor.stdout).diagnostics.every((item) => typeof item.remediation === 'string' && item.remediation.length > 0));
});

test('dry-run is read-only and uninstall preserves modified managed files', async (t) => {
  const fx = await fixture(t, true);
  const dryRun = fx.run('init', '--local', '--profile', 'economy', '--yes', '--dry-run');
  assert.equal(dryRun.status, 0, dryRun.stderr);
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));
  await assert.rejects(access(path.join(fx.project, '.tiersplice-manifest.json')));
  await assert.rejects(access(path.join(fx.project, '.claude')));
  await assert.rejects(access(path.join(fx.project, '.codex')));

  const init = fx.run('init', '--local', '--profile', 'balanced', '--yes');
  assert.equal(init.status, 0, init.stderr);
  const editedAgent = path.join(fx.project, '.claude', 'agents', 'tiersplice-implementer.md');
  await writeFile(editedAgent, 'user edit\n');

  const sync = fx.run('sync', '--local');
  assert.equal(sync.status, 1);
  assert.match(sync.stdout, /Conflict:/);
  assert.equal(await readFile(editedAgent, 'utf8'), 'user edit\n');

  const preview = fx.run('uninstall', '--local', '--dry-run', '--json');
  assert.equal(preview.status, 1);
  const previewJson = JSON.parse(preview.stdout);
  assert.ok(previewJson.preservedConflicts.includes(editedAgent));
  await access(path.join(fx.project, '.tiersplice.json'));

  const uninstall = fx.run('uninstall', '--local');
  assert.equal(uninstall.status, 1, uninstall.stderr || uninstall.stdout);
  assert.equal(await readFile(editedAgent, 'utf8'), 'user edit\n');
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));
});

test('init preflights unmanaged agent conflicts before writing configuration', async (t) => {
  const fx = await fixture(t, true);
  const agents = path.join(fx.project, '.claude', 'agents');
  await mkdir(agents, { recursive: true });
  const collision = path.join(agents, 'tiersplice-debugger.md');
  await writeFile(collision, 'User-owned debugger definition\n');
  const result = fx.run('init', '--local', '--profile', 'balanced', '--yes');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Conflict:/);
  assert.equal(await readFile(collision, 'utf8'), 'User-owned debugger definition\n');
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));
});

test('unsupported or malformed configuration is reported rather than repaired silently', async (t) => {
  const fx = await fixture(t);
  await writeFile(path.join(fx.project, '.tiersplice.json'), '{bad json');
  const result = fx.run('doctor', '--local', '--json');
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'error');
  assert.ok(report.diagnostics.some((item) => item.code === 'CONFIG_INVALID'));
});

test('corrupt inherited global config blocks local policy mutations and is reported with its path', async (t) => {
  const fx = await fixture(t);
  const globalConfig = globalConfigPath(fx);
  await mkdir(path.dirname(globalConfig), { recursive: true });
  await writeFile(globalConfig, '{bad json');
  const localPath = path.join(fx.project, '.tiersplice.json');
  await writeFile(localPath, JSON.stringify({ schemaVersion: 1, profile: 'balanced' }));
  const profile = fx.run('profile', 'economy', '--local');
  assert.equal(profile.status, 2);
  assert.match(profile.stderr, new RegExp(globalConfig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const sync = fx.run('sync', '--local');
  assert.equal(sync.status, 2);
  const doctor = fx.run('doctor', '--local', '--json');
  assert.equal(doctor.status, 2);
  assert.ok(JSON.parse(doctor.stdout).diagnostics.some((item) => item.code === 'CONFIG_INVALID' && item.message.includes(globalConfig)));
  assert.equal(JSON.parse(await readFile(localPath, 'utf8')).profile, 'balanced');
});

test('init supports automatic delegation opt-out while retaining generated native agents', async (t) => {
  const fx = await fixture(t, true);
  const result = fx.run('init', '--local', '--profile', 'balanced', '--yes', '--no-auto-delegation');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(await readFile(path.join(fx.project, '.tiersplice.json'), 'utf8'));
  assert.equal(config.delegation.automatic, false);
  await access(path.join(fx.project, '.claude', 'agents', 'tiersplice-implementer.md'));
  await assert.rejects(access(path.join(fx.project, 'CLAUDE.md')));
  const doctor = JSON.parse(fx.run('doctor', '--local', '--json').stdout);
  assert.ok(doctor.diagnostics.some((item) => item.code === 'AUTO_DELEGATION_DISABLED'));
});

test('uninstall removes a managed instruction block after its supported file is moved', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--profile', 'balanced', '--yes').status, 0);
  const oldFile = path.join(fx.project, 'CLAUDE.md');
  const movedFile = path.join(fx.project, '.claude', 'CLAUDE.md');
  await mkdir(path.dirname(movedFile), { recursive: true });
  await rename(oldFile, movedFile);
  const uninstall = fx.run('uninstall', '--local');
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  await assert.rejects(access(movedFile));
});

test('status and doctor detect duplicate managed instruction markers', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--profile', 'balanced', '--yes').status, 0);
  const file = path.join(fx.project, 'CLAUDE.md');
  const content = await readFile(file, 'utf8');
  await writeFile(file, `${content}\n${content.slice(content.indexOf('<!-- tiersplice:auto-delegation:start v1 -->') )}`);
  const status = JSON.parse(fx.run('status', '--local', '--json').stdout);
  assert.equal(status.managedFiles.find((item) => item.type === 'instruction-block').status, 'instruction-block-conflict');
  const doctor = JSON.parse(fx.run('doctor', '--local', '--json').stdout);
  assert.ok(doctor.diagnostics.some((item) => item.code === 'MANAGED_FILE_DRIFT'));
});

test('framework files remain untouched and are not probed', async (t) => {
  const fx = await fixture(t, true);
  const frameworkConfig = path.join(fx.project, '.custom-workflow', 'settings.json');
  const frameworkContents = '{\n  "model_profile": "user-managed",\n  "custom": true\n}\n';
  await mkdir(path.dirname(frameworkConfig), { recursive: true });
  await writeFile(frameworkConfig, frameworkContents);

  const init = fx.run('init', '--local', '--profile', 'balanced', '--yes');
  assert.equal(init.status, 0);
  const sync = fx.run('sync', '--local');
  assert.equal(sync.status, 0);
  assert.equal(await readFile(frameworkConfig, 'utf8'), frameworkContents);
  const status = JSON.parse(fx.run('status', '--local', '--json').stdout);
  assert.equal(Object.hasOwn(status, 'framework'), false);
});

test('resolve returns a read-only policy decision without a native runtime', async (t) => {
  const fx = await fixture(t);
  const result = fx.run('resolve', '--runtime', 'claude', '--role', 'debugging', '--json');
  assert.equal(result.status, 0, result.stderr);
  const resolved = JSON.parse(result.stdout);
  assert.equal(resolved.tier, 'standard');
  assert.equal(resolved.assignment, 'policy-only');
  assert.equal(resolved.modelAvailability, 'unverified');
  const schema = JSON.parse(await readFile(new URL('../schemas/resolve.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(resolved).sort(), [...schema.required].sort());
  assert.deepEqual(Object.keys(resolved.sources).sort(), [...schema.properties.sources.required].sort());
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));
});

test('manual config edits survive profile changes and sync', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--profile', 'balanced', '--yes').status, 0);
  const configPath = path.join(fx.project, '.tiersplice.json');
  const edited = { schemaVersion: 1, profile: 'balanced', roles: { debugging: 'heavy' }, models: { codex: { heavy: { model: 'custom-model', effort: 'xhigh' } } } };
  await writeFile(configPath, `${JSON.stringify(edited, null, 2)}\n`);
  assert.equal(fx.run('doctor', '--local').status, 1);
  assert.equal(fx.run('profile', 'economy', '--local').status, 0);
  assert.equal(fx.run('sync', '--local').status, 0);
  const after = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(after.profile, 'economy');
  assert.deepEqual(after.roles, edited.roles);
  assert.deepEqual(after.models, edited.models);
  const uninstall = fx.run('uninstall', '--local');
  assert.equal(uninstall.status, 1);
  assert.match(uninstall.stdout, /Preserved modified file/);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).profile, 'economy');
});

test('upgrade dry run is read only, then upgrades managed setup metadata idempotently', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--profile', 'quality', '--yes').status, 0);
  const configPath = path.join(fx.project, '.tiersplice.json');
  const manifestPath = path.join(fx.project, '.tiersplice-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.setupVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const tracked = [configPath, manifestPath, ...Object.keys(manifest.files)];
  const before = new Map(await Promise.all(tracked.map(async (file) => [file, await readFile(file)])));
  const preview = fx.run('upgrade', '--local', '--dry-run', '--json');
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const report = JSON.parse(preview.stdout);
  assert.equal(report.sourceVersion.version, '0.3.0-beta.0');
  assert.ok(report.plannedChanges.some((change) => change.action === 'record-setup-version'));
  for (const [file, contents] of before) assert.deepEqual(await readFile(file), contents);
  assert.equal(fx.run('upgrade', '--local', '--json').status, 0);
  const upgraded = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(upgraded.setupVersion, '0.4.0-beta.0');
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).profile, 'quality');
  const second = fx.run('upgrade', '--local', '--json');
  assert.equal(second.status, 0);
  assert.deepEqual(JSON.parse(second.stdout).plannedChanges, []);
});

test('upgrade dry run detects runtimes from config files without executable probes', async (t) => {
  const fx = await fixture(t);
  const init = fx.run('init', '--local', '--yes');
  assert.equal(init.status, 1); // No runtimes exist until the fixture markers are created.
  await mkdir(path.join(fx.home, '.claude'), { recursive: true });
  await mkdir(path.join(fx.home, '.codex'), { recursive: true });
  await writeFile(path.join(fx.home, '.claude', 'settings.json'), '{}\n');
  await writeFile(path.join(fx.home, '.codex', 'config.toml'), '\n');

  const manifestPath = path.join(fx.project, '.tiersplice-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.setupVersion = '0.3.0-beta.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const upgrade = fx.run('upgrade', '--local', '--dry-run', '--json');
  assert.equal(upgrade.status, 0, upgrade.stderr || upgrade.stdout);
  assert.deepEqual(JSON.parse(upgrade.stdout).requiredManualActions, []);
});

test('upgrade missing installation gives a safe init instruction', async (t) => {
  const fx = await fixture(t);
  const result = fx.run('upgrade', '--global', '--json');
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).requiredManualActions[0], /tiersplice init --global/);
  await assert.rejects(access(globalConfigPath(fx)));
});

test('upgrade refuses future setups and modified managed assets without changing them', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--yes').status, 0);
  const manifestPath = path.join(fx.project, '.tiersplice-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.setupVersion = '99.0.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const futureState = await readFile(manifestPath);
  const future = fx.run('upgrade', '--local', '--json');
  assert.equal(future.status, 2);
  assert.match(future.stderr, /newer than this CLI/);
  assert.deepEqual(await readFile(manifestPath), futureState);
  manifest.setupVersion = '0.3.0-beta.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const agent = path.join(fx.project, '.codex', 'agents', 'tiersplice-implementer.toml');
  const modifiedAgent = `${await readFile(agent, 'utf8')}# user change\n`;
  await writeFile(agent, modifiedAgent);
  const beforeManifest = await readFile(manifestPath);
  const conflict = fx.run('upgrade', '--local', '--json');
  assert.equal(conflict.status, 1);
  assert.match(JSON.parse(conflict.stdout).conflicts.join('\n'), /tiersplice-implementer\.toml/);
  assert.equal(await readFile(agent, 'utf8'), modifiedAgent);
  assert.deepEqual(await readFile(manifestPath), beforeManifest);
});

test('global upgrade does not read or modify a project-local configuration', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--global', '--yes').status, 0);
  const manifestPath = path.join(path.dirname(globalConfigPath(fx)), 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.setupVersion = '0.3.0-beta.0';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const localConfig = path.join(fx.project, '.tiersplice.json');
  const localContent = '{ invalid local config';
  await writeFile(localConfig, localContent);
  const result = fx.run('upgrade', '--global', '--dry-run', '--json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await readFile(localConfig, 'utf8'), localContent);
  assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).setupVersion, '0.3.0-beta.0');
});

test('upgrade refuses ownership manifest paths outside the selected scope', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--yes').status, 0);
  const manifestPath = path.join(fx.project, '.tiersplice-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.setupVersion = '0.3.0-beta.0';
  manifest.files[path.join(fx.root, 'outside-owned-file.md')] = { created: true, originalHash: null, currentHash: 'a'.repeat(64), kind: 'generated-output' };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const before = await readFile(manifestPath);
  const result = fx.run('upgrade', '--local', '--json');
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).conflicts.join('\n'), /outside-owned-file\.md.*outside the selected local/);
  assert.deepEqual(await readFile(manifestPath), before);
});

test('upgrade recognizes legacy config-only and managed-agent-only layouts', async (t) => {
  const oldConfig = await fixture(t);
  assert.equal(oldConfig.run('init', '--local', '--yes').status, 1); // Policy is saved, but no native runtime is detected.
  const oldConfigManifestPath = path.join(oldConfig.project, '.tiersplice-manifest.json');
  const oldConfigManifest = JSON.parse(await readFile(oldConfigManifestPath, 'utf8'));
  delete oldConfigManifest.setupVersion;
  await writeFile(oldConfigManifestPath, `${JSON.stringify(oldConfigManifest, null, 2)}\n`);
  const v01 = oldConfig.run('upgrade', '--local', '--dry-run', '--json');
  assert.equal(v01.status, 1); // No native runtime is installed in this fixture.
  assert.equal(JSON.parse(v01.stdout).sourceVersion.version, '0.1.0');

  const oldAgents = await fixture(t, true);
  assert.equal(oldAgents.run('init', '--local', '--yes').status, 0);
  const oldAgentManifestPath = path.join(oldAgents.project, '.tiersplice-manifest.json');
  const oldAgentManifest = JSON.parse(await readFile(oldAgentManifestPath, 'utf8'));
  delete oldAgentManifest.setupVersion;
  for (const [file, record] of Object.entries(oldAgentManifest.files)) {
    if (record.kind === 'instruction-block') { delete oldAgentManifest.files[file]; await writeFile(file, ''); }
  }
  await writeFile(oldAgentManifestPath, `${JSON.stringify(oldAgentManifest, null, 2)}\n`);
  const v02 = oldAgents.run('upgrade', '--local', '--dry-run', '--json');
  assert.equal(v02.status, 0, v02.stderr || v02.stdout);
  assert.equal(JSON.parse(v02.stdout).sourceVersion.version, '0.2.0');
  assert.match(JSON.parse(v02.stdout).sourceVersion.evidence, /0\.2\.x layout/);
});

test('offline model refresh plans from validated cache and applies only compatible recommended updates', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--profile', 'balanced', '--yes').status, 0);
  const configPath = path.join(fx.project, '.tiersplice.json');
  const before = await readFile(configPath);
  const cacheHome = path.join(fx.root, 'cache');
  const cacheDir = path.join(cacheHome, 'tiersplice');
  await mkdir(cacheDir, { recursive: true });
  const model = (id, upgrade = null, efforts = ['low', 'medium', 'high']) => ({ id, name: id, family: id.startsWith('gpt-6-luna') ? 'gpt-6-luna' : 'gpt-6-sol', visibility: 'visible', efforts, recommendedUpgrade: upgrade });
  await writeFile(path.join(cacheDir, 'codex-models.json'), `${JSON.stringify({ schemaVersion: 1, runtime: 'codex', source: 'fixture', fetchedAt: new Date().toISOString(), validation: 'validated', models: [
    model('gpt-6-luna', 'gpt-6-luna-2'), model('gpt-6-luna-2'), model('gpt-6-sol', 'gpt-6-sol-2'), model('gpt-6-sol-2')
  ] }, null, 2)}\n`);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', fx.project], { cwd: fx.project, env: { ...fx.env, XDG_CACHE_HOME: cacheHome }, encoding: 'utf8' });
  const preview = run('models', 'refresh', '--local', '--offline', '--dry-run', '--json');
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.equal(JSON.parse(preview.stdout).changes.length, 3);
  assert.deepEqual(await readFile(configPath), before);
  const refresh = run('models', 'refresh', '--local', '--offline', '--json');
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.models.codex.light.model, 'gpt-6-luna-2');
  assert.equal(config.models.codex.light.tracking, 'latest-compatible');
  const uninstall = run('uninstall', '--local');
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  await assert.rejects(access(configPath));
});

test('model refresh keeps manually edited config marked user-owned for uninstall', async (t) => {
  const fx = await fixture(t, true);
  assert.equal(fx.run('init', '--local', '--yes').status, 0);
  const configPath = path.join(fx.project, '.tiersplice.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.roles = { review: 'heavy' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const cacheHome = path.join(fx.root, 'cache');
  const cacheDir = path.join(cacheHome, 'tiersplice');
  await mkdir(cacheDir, { recursive: true });
  const catalogModel = (id, upgrade = null, family = 'gpt-6-luna') => ({ id, name: id, family, visibility: 'visible', efforts: ['low', 'medium', 'high', 'xhigh'], recommendedUpgrade: upgrade });
  await writeFile(path.join(cacheDir, 'codex-models.json'), `${JSON.stringify({ schemaVersion: 1, runtime: 'codex', source: 'fixture', fetchedAt: new Date().toISOString(), validation: 'validated', models: [
    catalogModel('gpt-6-luna', 'gpt-6-luna-2'), catalogModel('gpt-6-luna-2'), catalogModel('gpt-6-sol', 'gpt-6-sol-2', 'gpt-6-sol'), catalogModel('gpt-6-sol-2', null, 'gpt-6-sol')
  ] }, null, 2)}\n`);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', fx.project], { cwd: fx.project, env: { ...fx.env, XDG_CACHE_HOME: cacheHome }, encoding: 'utf8' });
  const refresh = run('models', 'refresh', '--local', '--offline', '--json');
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
  const manifestPath = path.join(fx.project, '.tiersplice-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.files[configPath].userModified, true);
  const uninstall = run('uninstall', '--local');
  assert.equal(uninstall.status, 1);
  assert.match(uninstall.stdout, /Preserved modified file/);
  assert.ok(await readFile(configPath));
});

test('local profile changes do not modify global TierSplice configuration', async (t) => {
  const fx = await fixture(t, true);
  const globalInit = fx.run('init', '--global', '--profile', 'balanced', '--yes');
  assert.equal(globalInit.status, 0, globalInit.stderr);
  const globalConfig = globalConfigPath(fx);
  const localInit = fx.run('init', '--local', '--profile', 'quality', '--yes');
  assert.equal(localInit.status, 0, localInit.stderr);
  const localProfile = fx.run('profile', 'economy', '--local');
  assert.equal(localProfile.status, 0, localProfile.stderr);

  assert.equal(JSON.parse(await readFile(globalConfig, 'utf8')).profile, 'balanced');
  assert.equal(JSON.parse(await readFile(path.join(fx.project, '.tiersplice.json'), 'utf8')).profile, 'economy');
  const status = JSON.parse(fx.run('status', '--local', '--json').stdout);
  assert.equal(status.config.globalProfile, 'balanced');
  assert.equal(status.config.localProfile, 'economy');
  assert.equal(status.routes.codex.heavy.model, 'gpt-6-sol');
});
