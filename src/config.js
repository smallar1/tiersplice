export const PROFILES = {
  economy: {
    claude: { light: ['haiku', 'low'], standard: ['sonnet', 'medium'], heavy: ['sonnet', 'high'] },
    codex: { light: ['gpt-6-luna', 'low'], standard: ['gpt-6-luna', 'medium'], heavy: ['gpt-6-sol', 'high'] }
  },
  balanced: {
    claude: { light: ['haiku', 'medium'], standard: ['sonnet', 'medium'], heavy: ['opus', 'high'] },
    codex: { light: ['gpt-6-luna', 'medium'], standard: ['gpt-6-luna', 'high'], heavy: ['gpt-6-sol', 'high'] }
  },
  quality: {
    claude: { light: ['sonnet', 'medium'], standard: ['sonnet', 'high'], heavy: ['opus', 'high'] },
    codex: { light: ['gpt-6-luna', 'medium'], standard: ['gpt-6-sol', 'high'], heavy: ['gpt-6-sol', 'xhigh'] }
  }
};

export const DEFAULT_ROLES = {
  documentation: 'light', exploration: 'light', implementation: 'standard',
  debugging: 'standard', architecture: 'heavy', review: 'standard'
};

export function validateConfig(value, file = 'config') {
  const errors = [];
  const known = new Set(['schemaVersion', 'profile', 'models', 'roles', 'escalation', 'delegation', 'modelUpdates']);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${file}: expected a JSON object`];
  for (const key of Object.keys(value)) if (!known.has(key)) errors.push(`${file}.${key}: unknown property`);
  if (value.schemaVersion !== 1) errors.push(`${file}.schemaVersion: expected 1`);
  if (!Object.hasOwn(PROFILES, value.profile)) errors.push(`${file}.profile: expected economy, balanced, or quality`);
  if (value.models !== undefined) {
    if (!value.models || typeof value.models !== 'object' || Array.isArray(value.models)) errors.push(`${file}.models: expected an object`);
    else {
      for (const [runtime, tiers] of Object.entries(value.models)) {
        if (!['claude', 'codex'].includes(runtime)) { errors.push(`${file}.models.${runtime}: expected claude or codex`); continue; }
        if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) { errors.push(`${file}.models.${runtime}: expected an object`); continue; }
        for (const [tier, route] of Object.entries(tiers)) {
          if (!['light', 'standard', 'heavy'].includes(tier)) { errors.push(`${file}.models.${runtime}.${tier}: unknown tier`); continue; }
          if (!route || typeof route !== 'object' || Array.isArray(route)) { errors.push(`${file}.models.${runtime}.${tier}: expected an object`); continue; }
          for (const key of Object.keys(route)) if (!['model', 'effort', 'tracking', 'family'].includes(key)) errors.push(`${file}.models.${runtime}.${tier}.${key}: unknown property`);
          if (route.model !== undefined && (typeof route.model !== 'string' || !route.model.trim() || /[\x00-\x1f\x7f]/.test(route.model))) errors.push(`${file}.models.${runtime}.${tier}.model: expected a non-empty string without control characters`);
          if (route.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(route.effort)) errors.push(`${file}.models.${runtime}.${tier}.effort: expected low, medium, high, xhigh, or max`);
          if (route.tracking !== undefined && !['native-alias', 'latest-compatible', 'pinned'].includes(route.tracking)) errors.push(`${file}.models.${runtime}.${tier}.tracking: expected native-alias, latest-compatible, or pinned`);
          if (route.family !== undefined && (typeof route.family !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(route.family))) errors.push(`${file}.models.${runtime}.${tier}.family: expected a short model family identifier`);
          if (route.tracking === 'pinned' && !route.model) errors.push(`${file}.models.${runtime}.${tier}: a pinned assignment requires a concrete model`);
        }
      }
    }
  }
  if (value.roles !== undefined) {
    if (!value.roles || typeof value.roles !== 'object' || Array.isArray(value.roles)) errors.push(`${file}.roles: expected an object`);
    else for (const [role, tier] of Object.entries(value.roles)) if (!/^[a-z][a-z0-9_-]*$/.test(role) || !['light', 'standard', 'heavy'].includes(tier)) errors.push(`${file}.roles.${role}: expected a valid role name and light, standard, or heavy tier`);
  }
  if (value.escalation !== undefined) {
    const e = value.escalation;
    if (!e || typeof e !== 'object' || Array.isArray(e)) errors.push(`${file}.escalation: expected an object`);
    else {
      for (const key of Object.keys(e)) if (!['enabled', 'maxRetries'].includes(key)) errors.push(`${file}.escalation.${key}: unknown property`);
      if (e.enabled !== undefined && typeof e.enabled !== 'boolean') errors.push(`${file}.escalation.enabled: expected a boolean`);
      if (e.maxRetries !== undefined && e.maxRetries !== 1) errors.push(`${file}.escalation.maxRetries: only the advisory ceiling 1 is supported`);
    }
  }
  if (value.delegation !== undefined) {
    const delegation = value.delegation;
    if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) errors.push(`${file}.delegation: expected an object`);
    else {
      for (const key of Object.keys(delegation)) if (key !== 'automatic') errors.push(`${file}.delegation.${key}: unknown property`);
      if (delegation.automatic !== undefined && typeof delegation.automatic !== 'boolean') errors.push(`${file}.delegation.automatic: expected a boolean`);
    }
  }
  if (value.modelUpdates !== undefined) {
    const updates = value.modelUpdates;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) errors.push(`${file}.modelUpdates: expected an object`);
    else {
      for (const key of Object.keys(updates)) if (!['enabled', 'checkIntervalHours', 'startupRefresh'].includes(key)) errors.push(`${file}.modelUpdates.${key}: unknown property`);
      if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') errors.push(`${file}.modelUpdates.enabled: expected a boolean`);
      if (updates.startupRefresh !== undefined && typeof updates.startupRefresh !== 'boolean') errors.push(`${file}.modelUpdates.startupRefresh: expected a boolean`);
      if (updates.checkIntervalHours !== undefined && (!Number.isFinite(updates.checkIntervalHours) || updates.checkIntervalHours < 0 || updates.checkIntervalHours > 8760)) errors.push(`${file}.modelUpdates.checkIntervalHours: expected a number between 0 and 8760`);
    }
  }
  return errors;
}

export function resolvePolicy(globalConfig, localConfig) {
  const profile = localConfig?.profile ?? globalConfig?.profile ?? 'balanced';
  const effective = Object.fromEntries(Object.entries(PROFILES[profile]).map(([runtime, tiers]) => [runtime, Object.fromEntries(Object.entries(tiers).map(([tier, [model, effort]]) => [tier, { model, effort }]))]));
  const roles = { ...DEFAULT_ROLES, ...(globalConfig?.roles ?? {}), ...(localConfig?.roles ?? {}) };
  for (const source of [globalConfig, localConfig]) {
    for (const [runtime, tiers] of Object.entries(source?.models ?? {})) {
      for (const [tier, route] of Object.entries(tiers)) effective[runtime][tier] = { ...effective[runtime][tier], ...route };
    }
  }
  return { profile, roles, routes: effective };
}

export async function readConfig(file) {
  const { readFile } = await import('node:fs/promises');
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { value: null, errors: [] }; throw error; }
  let value;
  try { value = JSON.parse(raw); } catch (error) { return { value: null, errors: [`${file}: invalid JSON (${error.message})`] }; }
  const errors = validateConfig(value, file);
  return { value: errors.length ? null : value, errors };
}
