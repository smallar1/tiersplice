import { spawn } from 'node:child_process';
import { mkdir, open, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { atomicWrite, assertNoSymlinkPath } from './filesystem.js';

const MAX_CATALOG_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 4000;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function cacheRoot() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'tiersplice');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'tiersplice', 'cache');
  return path.join(homedir(), '.cache', 'tiersplice');
}

export function validateCatalog(input, { runtime = 'codex', source = 'native' } = {}) {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_CATALOG_BYTES) throw new Error('model catalog exceeds the 1 MiB safety limit');
  const rows = Array.isArray(input) ? input : input?.models ?? input?.data;
  if (!Array.isArray(rows)) throw new Error('native model catalog has no models array');
  const models = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const id = row.id ?? row.model;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const effortSource = row.supportedReasoningEfforts ?? row.reasoningEfforts ?? row.efforts ?? [];
    const efforts = Array.isArray(effortSource) ? effortSource.map((item) => typeof item === 'string' ? item : item?.reasoningEffort).filter((item) => EFFORTS.has(item)) : [];
    const family = typeof row.family === 'string' && SAFE_ID.test(row.family) ? row.family : null;
    const upgrade = row.upgrade ?? row.recommendedUpgrade;
    const recommendedUpgrade = typeof upgrade === 'string' && SAFE_ID.test(upgrade) ? upgrade : null;
    models.push({
      id,
      name: (typeof row.displayName === 'string' ? row.displayName : typeof row.name === 'string' ? row.name : id).replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160) || id,
      family,
      visibility: row.hidden === true || row.visibility === 'hidden' ? 'hidden' : row.hidden === false || row.visibility === 'list' || row.visibility === 'visible' || row.isVisible === true ? 'visible' : 'unknown',
      efforts: [...new Set(efforts)],
      recommendedUpgrade
    });
  }
  return { schemaVersion: 1, runtime, source, fetchedAt: new Date().toISOString(), validation: 'validated', models };
}

function requestCodexCatalog({ timeout = REQUEST_TIMEOUT_MS, command = 'codex' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: process.env });
    let buffer = '';
    let totalBytes = 0;
    let timer;
    let nextId = 0;
    const pending = new Map();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(value);
    };
    const send = (method, params) => new Promise((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) { pending.delete(id); rejectRequest(error); }
      });
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', async (chunk) => {
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > MAX_CATALOG_BYTES) { finish(new Error('Codex app-server output exceeded the 1 MiB safety limit')); return; }
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { finish(new Error('Codex app-server returned invalid JSON')); return; }
        const waiting = pending.get(message.id);
        if (!waiting) continue;
        pending.delete(message.id);
        if (message.error) waiting.reject(new Error(typeof message.error.message === 'string' ? message.error.message.slice(0, 300) : 'Codex app-server request failed'));
        else waiting.resolve(message.result);
      }
    });
    child.once('error', (error) => finish(new Error(`Codex app-server is unavailable: ${error.message}`)));
    child.once('exit', (code) => { if (!settled) finish(new Error(`Codex app-server exited before discovery completed (code ${code ?? 'unknown'})`)); });
    timer = setTimeout(() => finish(new Error('Codex model discovery timed out')), timeout);
    (async () => {
      try {
        await send('initialize', { clientInfo: { name: 'tiersplice', title: 'TierSplice', version: '0.4' }, capabilities: {} });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
        const data = [];
        let cursor = null;
        for (let page = 0; page < 10; page += 1) {
          const catalog = await send('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
          if (!catalog || !Array.isArray(catalog.data)) throw new Error('Codex model/list returned an unsupported response shape');
          data.push(...catalog.data);
          if (!catalog.nextCursor) { finish(null, { data }); return; }
          cursor = catalog.nextCursor;
        }
        finish(new Error('Codex model/list catalog exceeded the 1,000 model limit'));
      } catch (error) { finish(error); }
    })();
  });
}

export async function discoverModels(runtime, options = {}) {
  if (runtime === 'claude') return { available: false, reason: 'Claude Code exposes no supported read-only model catalog; built-in family aliases are resolved by Claude Code.', catalog: null };
  if (runtime !== 'codex') return { available: false, reason: `Unsupported model runtime: ${runtime}`, catalog: null };
  try {
    const native = options.adapter ? await options.adapter() : await requestCodexCatalog(options);
    const catalog = validateCatalog(native, { runtime: 'codex', source: 'codex app-server model/list' });
    if (!catalog.models.length) return { available: false, reason: 'Codex model/list returned no valid models.', catalog: null };
    if (!options.noCache) await writeCatalog(catalog);
    return { available: true, reason: null, catalog };
  } catch (error) {
    return { available: false, reason: error.message, catalog: null };
  }
}

export async function readCatalog(runtime, { offline = false, now = Date.now(), maxAgeHours = 24 } = {}) {
  const file = path.join(cacheRoot(), `${runtime}-models.json`);
  try {
    await assertNoSymlinkPath(path.dirname(file), cacheRoot());
    const stat = await import('node:fs/promises').then(({ lstat }) => lstat(file));
    if (stat.isSymbolicLink() || stat.size > MAX_CATALOG_BYTES) throw new Error('cached catalog is unsafe or oversized');
    const parsed = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(file, 'utf8')));
    if (parsed.schemaVersion !== 1 || parsed.runtime !== runtime || parsed.validation !== 'validated' || !Array.isArray(parsed.models) || !Number.isFinite(Date.parse(parsed.fetchedAt)) || typeof parsed.source !== 'string' || parsed.source.length > 160 || /[\x00-\x1f\x7f]/.test(parsed.source)) throw new Error('cached catalog metadata is invalid');
    const validated = validateCatalog(parsed, { runtime, source: parsed.source });
    validated.fetchedAt = parsed.fetchedAt;
    const ageHours = Math.max(0, (now - Date.parse(parsed.fetchedAt)) / 3_600_000);
    return { catalog: validated, ageHours, stale: maxAgeHours === 0 || ageHours > maxAgeHours, source: 'cache' };
  } catch (error) {
    if (error.code === 'ENOENT') return { catalog: null, ageHours: null, stale: true, source: offline ? 'offline-missing' : 'missing' };
    return { catalog: null, ageHours: null, stale: true, source: 'invalid-cache', error: error.message };
  }
}

export async function writeCatalog(catalog) {
  const file = path.join(cacheRoot(), `${catalog.runtime}-models.json`);
  const lock = path.join(cacheRoot(), '.catalog.lock');
  await assertNoSymlinkPath(cacheRoot(), path.dirname(cacheRoot()));
  await mkdir(cacheRoot(), { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(cacheRoot(), path.dirname(cacheRoot()));
  let handle;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { handle = await open(lock, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 9) throw new Error('Another model catalog refresh holds the cache lock; retry shortly.');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await atomicWrite(file, `${JSON.stringify(catalog, null, 2)}\n`, { boundary: cacheRoot() });
  } finally {
    await handle?.close();
    await rm(lock, { force: true });
  }
  return file;
}

const KNOWN_FAMILIES = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'];
function familyOf(model) { return KNOWN_FAMILIES.find((family) => model === family || model.startsWith(`${family}-`)) ?? null; }

export function planModelRefresh(policy, catalog, { globalConfig = null, localConfig = null, updatesEnabled = true } = {}) {
  const changes = [];
  const skipped = [];
  if (!updatesEnabled) return { changes, skipped: [{ reason: 'model updates are disabled by configuration' }] };
  const visible = new Map(catalog.models.filter((item) => item.visibility === 'visible').map((item) => [item.id, item]));
  const effectiveOverrides = Object.fromEntries(['light', 'standard', 'heavy'].map((tier) => [tier, localConfig?.models?.codex?.[tier] ?? globalConfig?.models?.codex?.[tier] ?? null]));
  for (const tier of ['light', 'standard', 'heavy']) {
    const override = effectiveOverrides[tier];
    const route = policy.routes.codex[tier];
    const pinned = Boolean(override && (override.tracking === 'pinned' || (override.model && !override.tracking)));
    if (pinned) { skipped.push({ tier, model: route.model, reason: 'explicit model override is pinned' }); continue; }
    const current = visible.get(route.model);
    if (!current) { skipped.push({ tier, model: route.model, reason: 'current model is not visible in the native catalog' }); continue; }
    if (!current.recommendedUpgrade) { skipped.push({ tier, model: route.model, reason: 'native catalog advertises no recommended upgrade' }); continue; }
    const candidate = visible.get(current.recommendedUpgrade);
    if (!candidate) { skipped.push({ tier, model: route.model, reason: 'recommended model is not visible' }); continue; }
    const currentFamily = current.family ?? familyOf(current.id);
    const nextFamily = candidate.family ?? familyOf(candidate.id);
    if (!currentFamily || currentFamily !== nextFamily) { skipped.push({ tier, model: route.model, reason: 'recommended model family is ambiguous or changed' }); continue; }
    if (!candidate.efforts.includes(route.effort)) { skipped.push({ tier, model: route.model, reason: `recommended model does not verify support for requested ${route.effort} effort` }); continue; }
    if (candidate.id === route.model) continue;
    changes.push({ tier, from: route.model, to: candidate.id, effort: route.effort, family: currentFamily, confidence: 'native-recommended-upgrade', reason: 'same-family native recommendation supports the requested reasoning effort' });
  }
  return { changes, skipped };
}
