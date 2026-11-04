import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyManaged, hash, listOwned, readManifest, uninstallOwned } from '../src/filesystem.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tiersplice-fs-'));
  const agents = path.join(root, '.claude', 'agents');
  await mkdir(agents, { recursive: true });
  const manifest = path.join(root, '.tiersplice-manifest.json');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, agents, manifest };
}

test('malformed and traversal ownership manifest records are rejected', async (t) => {
  const fx = await fixture(t);
  await writeFile(fx.manifest, JSON.stringify({ schemaVersion: 1, files: { '../victim': { currentHash: '0'.repeat(64) } } }));
  await assert.rejects(readManifest(fx.manifest), /invalid ownership record/);
  await writeFile(fx.manifest, JSON.stringify({ schemaVersion: 1, files: { [path.join(fx.agents, 'tiersplice-worker.md')]: { currentHash: 'bad-hash' } } }));
  await assert.rejects(readManifest(fx.manifest), /invalid ownership record/);
});

test('uninstall preserves prefix-named files without a TierSplice ownership signature', async (t) => {
  const fx = await fixture(t);
  const target = path.join(fx.agents, 'tiersplice-not-owned.md');
  const contents = 'User-authored notes\n';
  await writeFile(target, contents);
  await writeFile(fx.manifest, JSON.stringify({ schemaVersion: 1, files: { [target]: { created: true, currentHash: hash(contents) } } }));
  const plan = await listOwned(fx.manifest, { allowedRoots: [fx.root, fx.agents], allowedConfig: path.join(fx.root, '.tiersplice.json') });
  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.conflicts, [target]);
  await uninstallOwned(fx.manifest, false, { allowedRoots: [fx.root, fx.agents], allowedConfig: path.join(fx.root, '.tiersplice.json') });
  assert.equal(await readFile(target, 'utf8'), contents);
});

test('sync does not trust a matching tampered manifest hash without a file ownership signature', async (t) => {
  const fx = await fixture(t);
  const target = path.join(fx.agents, 'tiersplice-worker.md');
  const userContent = 'User-owned content\n';
  await writeFile(target, userContent);
  await writeFile(fx.manifest, JSON.stringify({ schemaVersion: 1, files: { [target]: { created: true, kind: 'generated-output', currentHash: hash(userContent) } } }));
  const result = await applyManaged([{ path: target, content: '---\nname: tiersplice-worker\n---\nNew generated content\n' }], fx.manifest, { allowedRoots: [fx.root, fx.agents] });
  assert.equal(result.applied.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(await readFile(target, 'utf8'), userContent);
});

test('uninstall rejects manifest paths routed through a symlinked agent directory', async (t) => {
  const fx = await fixture(t);
  const outside = path.join(fx.root, 'outside');
  await mkdir(outside);
  const target = path.join(fx.root, '.codex', 'agents', 'tiersplice-worker.md');
  const outsideTarget = path.join(outside, 'tiersplice-worker.md');
  const contents = '---\nname: tiersplice-worker\n---\nOwned marker\n';
  await writeFile(outsideTarget, contents);
  const link = path.join(fx.root, '.codex', 'agents');
  await mkdir(path.dirname(link), { recursive: true });
  try { await symlink(outside, link, 'dir'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) return t.skip('symlinks are unavailable'); throw error; }
  await writeFile(fx.manifest, JSON.stringify({ schemaVersion: 1, files: { [target]: { created: true, kind: 'generated-output', currentHash: hash(contents) } } }));
  const plan = await listOwned(fx.manifest, { allowedRoots: [fx.root, link], allowedConfig: path.join(fx.root, '.tiersplice.json') });
  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.conflicts, [target]);
});

test('managed writes refuse a symlinked native agent parent before creating files', async (t) => {
  const fx = await fixture(t);
  const outside = path.join(fx.root, 'outside');
  await mkdir(outside);
  const codex = path.join(fx.root, '.codex');
  try { await symlink(outside, codex, 'dir'); } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) return t.skip('symlinks are unavailable'); throw error; }
  const agents = path.join(codex, 'agents');
  const result = await applyManaged([{ path: path.join(agents, 'tiersplice-worker.md'), content: '---\nname: tiersplice-worker\n---\n' }], fx.manifest, { dryRun: false, allowedRoots: [fx.root, agents] });
  assert.equal(result.applied.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(await import('node:fs/promises').then(({ readdir }) => readdir(outside)), []);
});

test('partial managed writes roll back files and the ownership manifest', async (t) => {
  const fx = await fixture(t);
  const first = path.join(fx.agents, 'tiersplice-first.md');
  const second = path.join(fx.agents, 'tiersplice-second.md');
  const initial = [first, second].map((target) => ({ path: target, content: `---\nname: ${path.basename(target, '.md')}\n---\nOriginal\n` }));
  await applyManaged(initial, fx.manifest, { allowedRoots: [fx.root, fx.agents] });
  const oldManifest = await readFile(fx.manifest, 'utf8');
  let writes = 0;
  await assert.rejects(applyManaged(initial.map((item) => ({ ...item, content: item.content.replace('Original', 'Updated') })), fx.manifest, {
    allowedRoots: [fx.root, fx.agents],
    beforeWrite: async () => { writes += 1; if (writes === 2) throw new Error('injected write failure'); }
  }), /prior files restored/);
  assert.equal(await readFile(first, 'utf8'), initial[0].content);
  assert.equal(await readFile(second, 'utf8'), initial[1].content);
  assert.equal(await readFile(fx.manifest, 'utf8'), oldManifest);
});
