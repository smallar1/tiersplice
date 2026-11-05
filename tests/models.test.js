import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverModels, planModelRefresh, readCatalog, validateCatalog, writeCatalog } from '../src/models.js';
import { resolvePolicy } from '../src/config.js';

test('catalog validation normalizes supported metadata and rejects unsafe ids', () => {
  const catalog = validateCatalog({ models: [
    { id: 'gpt-6-sol', visibility: 'list', family: 'gpt-6-sol', upgrade: 'gpt-6-sol-2', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
    { id: '../secret', visibility: 'list' },
    { id: 'gpt-6-sol-2', visibility: 'list', family: 'gpt-6-sol', supportedReasoningEfforts: ['high'] }
  ] });
  assert.deepEqual(catalog.models.map((model) => model.id), ['gpt-6-sol', 'gpt-6-sol-2']);
  assert.deepEqual(catalog.models[0].efforts, ['high']);
  assert.throws(() => validateCatalog({}, { runtime: 'claude' }), /models array/);
});

test('refresh uses a native same-family recommendation with matching effort only', () => {
  const globalConfig = { schemaVersion: 1, profile: 'balanced', models: { codex: { heavy: { model: 'gpt-6-sol', effort: 'high', tracking: 'latest-compatible' } } } };
  const policy = resolvePolicy(globalConfig, null);
  const catalog = validateCatalog({ models: [
    { id: 'gpt-6-sol', visibility: 'list', family: 'gpt-6-sol', upgrade: 'gpt-6-sol-2', supportedReasoningEfforts: ['high'] },
    { id: 'gpt-6-sol-2', visibility: 'list', family: 'gpt-6-sol', supportedReasoningEfforts: ['high'] }
  ] });
  const plan = planModelRefresh(policy, catalog, { globalConfig });
  assert.deepEqual(plan.changes, [{ tier: 'heavy', from: 'gpt-6-sol', to: 'gpt-6-sol-2', effort: 'high', family: 'gpt-6-sol', confidence: 'native-recommended-upgrade', reason: 'same-family native recommendation supports the requested reasoning effort' }]);
});

test('effort-only user overrides do not pin a built-in Codex model', () => {
  const globalConfig = { schemaVersion: 1, profile: 'balanced', models: { codex: { heavy: { effort: 'high' } } } };
  const plan = resolvePolicy(globalConfig, null);
  const catalog = validateCatalog({ models: [
    { id: 'gpt-6-sol', visibility: 'list', family: 'gpt-6-sol', upgrade: 'gpt-6-sol-2', supportedReasoningEfforts: ['high'] },
    { id: 'gpt-6-sol-2', visibility: 'list', family: 'gpt-6-sol', supportedReasoningEfforts: ['high'] }
  ] });
  assert.deepEqual(planModelRefresh(plan, catalog, { globalConfig }).changes.map((item) => item.tier), ['heavy']);
});

test('refresh retains pinned, invisible, cross-family, and unsupported-effort assignments', () => {
  const globalConfig = { schemaVersion: 1, profile: 'balanced', models: { codex: { heavy: { model: 'gpt-6-sol', effort: 'high' } } } };
  const policy = resolvePolicy(globalConfig, null);
  const catalog = validateCatalog({ models: [
    { id: 'gpt-6-sol', visibility: 'list', family: 'sol', upgrade: 'gpt-6-astra', supportedReasoningEfforts: ['high'] },
    { id: 'gpt-6-astra', visibility: 'list', family: 'astra', supportedReasoningEfforts: ['low'] }
  ] });
  const result = planModelRefresh(policy, catalog, { globalConfig });
  assert.deepEqual(result.changes, []);
  assert.ok(result.skipped.some((item) => item.reason === 'explicit model override is pinned'));
  const withoutPin = planModelRefresh(resolvePolicy(null, null), catalog);
  assert.deepEqual(withoutPin.changes, []);
});

test('Codex discovery accepts an injected native catalog and Claude stays native-alias only', async () => {
  const codex = await discoverModels('codex', { adapter: async () => ({ data: [{ id: 'gpt-6-sol', model: 'gpt-6-sol', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] }), noCache: true });
  assert.equal(codex.available, true);
  assert.equal(codex.catalog.models[0].visibility, 'visible');
  const claude = await discoverModels('claude');
  assert.equal(claude.available, false);
  assert.match(claude.reason, /family aliases/);
});

test('catalog cache writes atomically under a lock and validates offline TTL', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tiersplice-cache-'));
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  const catalog = validateCatalog({ data: [{ id: 'gpt-6-sol', hidden: false, supportedReasoningEfforts: ['high'] }] }, { source: 'test adapter' });
  await Promise.all([writeCatalog(catalog), writeCatalog(catalog)]);
  const result = await readCatalog('codex');
  assert.equal(result.catalog.models[0].id, 'gpt-6-sol');
  assert.equal(result.stale, false);
  assert.equal((await readCatalog('codex', { maxAgeHours: 0 })).stale, true);
  assert.doesNotMatch(await readFile(path.join(root, 'tiersplice', 'codex-models.json'), 'utf8'), /token|credential/i);
});
