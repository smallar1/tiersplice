import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, resolvePolicy, validateConfig } from '../src/config.js';

test('profile tables define light, standard, and heavy routes for each runtime', () => {
  for (const profile of Object.values(PROFILES)) {
    for (const runtime of ['claude', 'codex']) {
      assert.deepEqual(Object.keys(profile[runtime]).sort(), ['heavy', 'light', 'standard']);
      for (const route of Object.values(profile[runtime])) {
        assert.equal(typeof route[0], 'string');
        assert.equal(typeof route[1], 'string');
      }
    }
  }
});

test('local profile and route overrides take precedence while inherited overrides remain', () => {
  const policy = resolvePolicy(
    { schemaVersion: 1, profile: 'balanced', models: { codex: { heavy: { model: 'custom-global' } } }, roles: { review: 'heavy' } },
    { schemaVersion: 1, profile: 'quality', models: { codex: { heavy: { effort: 'medium' } } } }
  );
  assert.equal(policy.profile, 'quality');
  assert.deepEqual(policy.routes.codex.heavy, { model: 'custom-global', effort: 'medium' });
  assert.equal(policy.roles.review, 'heavy');
  assert.equal(policy.routes.claude.heavy.model, 'opus');
});

test('config validation reports exact paths for invalid values', () => {
  const errors = validateConfig({ schemaVersion: 9, profile: 'fast', models: { codex: { heavy: { effort: 'extreme' } } } }, 'fixture.json');
  assert.ok(errors.includes('fixture.json.schemaVersion: expected 1'));
  assert.ok(errors.includes('fixture.json.profile: expected economy, balanced, or quality'));
  assert.ok(errors.includes('fixture.json.models.codex.heavy.effort: expected low, medium, high, xhigh, or max'));
});
