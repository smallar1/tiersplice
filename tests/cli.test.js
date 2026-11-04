import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod, access, symlink } from 'node:fs/promises';
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
    for (const [name, version] of [['claude', 'Claude Code 2.0.0'], ['codex', 'codex 0.50.0']]) {
      const executable = path.join(bin, name);
      await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
      await chmod(executable, 0o755);
    }
  }
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(root, 'xdg'),
    PATH: runtimes ? bin : '',
    EDITOR: '',
    VISUAL: ''
  };
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', project], { cwd: project, env, encoding: 'utf8' });
  t.after(async () => rm(root, { recursive: true, force: true }));
  return { root, home, project, bin, env, run };
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
  assert.equal(result.stdout.trim(), '0.1.0');
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

  const status = fx.run('status', '--local', '--json');
  assert.equal(status.status, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.schemaVersion, 1);
  assert.equal(statusJson.config.effectiveProfile, 'balanced');
  assert.equal(statusJson.runtimes.codex.status, 'detected');

  const profile = fx.run('profile', 'quality', '--local');
  assert.equal(profile.status, 0, profile.stderr);
  assert.equal(JSON.parse(await readFile(path.join(fx.project, '.tiersplice.json'), 'utf8')).profile, 'quality');
  const doctor = fx.run('doctor', '--local', '--json');
  assert.equal(doctor.status, 1);
  assert.equal(JSON.parse(doctor.stdout).status, 'warning');
  assert.ok(JSON.parse(doctor.stdout).diagnostics.some((item) => item.code === 'MODEL_ACCESS_UNVERIFIED'));
});

test('dry-run is read-only and uninstall preserves modified managed files', async (t) => {
  const fx = await fixture(t, true);
  const dryRun = fx.run('init', '--local', '--profile', 'economy', '--yes', '--dry-run');
  assert.equal(dryRun.status, 0, dryRun.stderr);
  await assert.rejects(access(path.join(fx.project, '.tiersplice.json')));

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
  assert.equal(uninstall.status, 1);
  assert.equal(await readFile(editedAgent, 'utf8'), 'user edit\n');
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

test('GSD detection is project-scoped and leaves existing GSD configuration unchanged', async (t) => {
  const fx = await fixture(t, true);
  const gsdConfig = path.join(fx.project, '.planning', 'config.json');
  const gsdContents = '{\n  "model_profile": "user-managed",\n  "custom": true\n}\n';
  await mkdir(path.dirname(gsdConfig), { recursive: true });
  await writeFile(gsdConfig, gsdContents);

  const init = fx.run('init', '--local', '--profile', 'balanced', '--yes');
  assert.equal(init.status, 1);
  assert.match(init.stdout, /GSD project detected/);
  const sync = fx.run('sync', '--local');
  assert.equal(sync.status, 0);
  assert.equal(await readFile(gsdConfig, 'utf8'), gsdContents);
  const status = JSON.parse(fx.run('status', '--local', '--json').stdout);
  assert.equal(status.gsd.status, 'unverified');
  assert.match(status.gsd.shadowing, /Existing GSD model settings/);
});

test('local profile changes do not modify global TierSplice configuration', async (t) => {
  const fx = await fixture(t, true);
  const globalInit = fx.run('init', '--global', '--profile', 'balanced', '--yes');
  assert.equal(globalInit.status, 0, globalInit.stderr);
  const globalConfig = path.join(fx.root, 'xdg', 'tiersplice', 'config.json');
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
