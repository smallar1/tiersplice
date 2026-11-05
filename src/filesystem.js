import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const hash = (content) => createHash('sha256').update(content).digest('hex');

function hasAgentOwnershipSignature(file, content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  return path.basename(file).endsWith('.md')
    ? /(?:^|\n)name:\s*["']?tiersplice-[a-z0-9_-]+/m.test(text)
    : /(?:^|\n)name\s*=\s*["']tiersplice-[a-z0-9_-]+["']/m.test(text);
}

export function getPaths(scope, cwd = process.cwd()) {
  const home = homedir();
  if (scope === 'global') {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const base = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'tiersplice') : path.join(configHome, 'tiersplice');
    const claudeHome = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
    const codexHome = path.resolve(process.env.CODEX_HOME || path.join(home, '.codex'));
    return { root: base, config: path.join(base, 'config.json'), manifest: path.join(base, 'manifest.json'), claudeAgents: path.join(claudeHome, 'agents'), codexAgents: path.join(codexHome, 'agents'), claudeInstructions: path.join(claudeHome, 'CLAUDE.md'), codexInstructions: path.join(codexHome, 'AGENTS.md') };
  }
  const root = path.resolve(cwd);
  return { root, config: path.join(root, '.tiersplice.json'), manifest: path.join(root, '.tiersplice-manifest.json'), claudeAgents: path.join(root, '.claude', 'agents'), codexAgents: path.join(root, '.codex', 'agents'), claudeInstructions: path.join(root, 'CLAUDE.md'), codexInstructions: path.join(root, 'AGENTS.md') };
}

export async function projectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    try { await access(path.join(current, '.git')); return current; } catch {}
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

export async function resolvePaths(scope, cwd = process.cwd()) {
  const paths = getPaths(scope, cwd);
  if (scope === 'local') paths.root = await projectRoot(cwd);
  if (scope === 'local') {
    paths.config = path.join(paths.root, '.tiersplice.json');
    paths.manifest = path.join(paths.root, '.tiersplice-manifest.json');
    paths.claudeAgents = path.join(paths.root, '.claude', 'agents');
    paths.codexAgents = path.join(paths.root, '.codex', 'agents');
    const claudeRoot = path.join(paths.root, '.claude');
    const codexRoot = path.join(paths.root, '.codex');
    try { await access(paths.claudeInstructions); } catch { try { await access(path.join(claudeRoot, 'CLAUDE.md')); paths.claudeInstructions = path.join(claudeRoot, 'CLAUDE.md'); } catch {} }
    try { await access(paths.codexInstructions); } catch { try { await access(path.join(codexRoot, 'AGENTS.md')); paths.codexInstructions = path.join(codexRoot, 'AGENTS.md'); } catch {} }
  }
  return paths;
}

export async function readManifest(file) {
  try {
    await assertNoSymlinkPath(path.dirname(file), path.dirname(file));
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing symlink ownership manifest: ${file}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    if (!manifest || manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('invalid manifest structure');
    for (const [target, record] of Object.entries(manifest.files)) {
      if (!path.isAbsolute(target) || target !== path.resolve(target) || !record || typeof record !== 'object' || !/^[a-f0-9]{64}$/.test(record.currentHash || '')) throw new Error(`invalid ownership record for ${target}`);
      if (record.kind !== undefined && !['config', 'source-config', 'generated-output', 'native-agent', 'instruction-block'].includes(record.kind)) throw new Error(`invalid ownership kind for ${target}`);
      if (record.created !== undefined && typeof record.created !== 'boolean') throw new Error(`invalid creation flag for ${target}`);
      if (record.userModified !== undefined && typeof record.userModified !== 'boolean') throw new Error(`invalid user modification flag for ${target}`);
      if (record.originalHash !== undefined && record.originalHash !== null && !/^[a-f0-9]{64}$/.test(record.originalHash)) throw new Error(`invalid original hash for ${target}`);
      if (record.insertedSeparator !== undefined && typeof record.insertedSeparator !== 'string') throw new Error(`invalid instruction separator for ${target}`);
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, files: {} };
    throw new Error(`Cannot read TierSplice ownership manifest ${file}: ${error.message}`);
  }
}

const POLICY_START = '<!-- tiersplice:auto-delegation:start v1 -->';
const POLICY_END = '<!-- tiersplice:auto-delegation:end v1 -->';

function policyBlock(text) {
  if (/<!--\s*tiersplice:auto-delegation:(?!start v1 -->|end v1 -->)/.test(text)) throw new Error('unrecognized or malformed TierSplice delegation marker');
  const starts = [...text.matchAll(/<!-- tiersplice:auto-delegation:start v1 -->/g)];
  const ends = [...text.matchAll(/<!-- tiersplice:auto-delegation:end v1 -->/g)];
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) throw new Error('missing, duplicate, nested, or mismatched TierSplice delegation markers');
  const end = ends[0].index + POLICY_END.length;
  return { content: text.slice(starts[0].index, end), start: starts[0].index, end };
}

export function inspectInstructionBlock(text) {
  return policyBlock(text)?.content ?? null;
}

export const instructionMarkers = { start: POLICY_START, end: POLICY_END };

export async function applyInstructionBlocks(changes, manifestPath, { dryRun = false, allowedRoots = [path.dirname(manifestPath)], allowedInstructionFiles = [] } = {}) {
  const manifest = await readManifest(manifestPath);
  const prepared = [];
  const conflicts = [];
  for (const change of changes) {
    const target = path.resolve(change.path);
    const priorLocation = Object.entries(manifest.files).find(([file, record]) => record.kind === 'instruction-block' && path.basename(file) === path.basename(target) && path.resolve(file) !== target);
    if (change.kind === 'instruction-block' && priorLocation) {
      conflicts.push(`${target}: TierSplice routing guidance is already owned at ${priorLocation[0]}; resolve the moved instruction file before syncing`);
      continue;
    }
    const root = allowedRoots.map((item) => path.resolve(item)).find((item) => target.startsWith(`${item}${path.sep}`));
    const instructionAllowed = allowedInstructionFiles.length
      ? allowedInstructionFiles.some((file) => path.resolve(file) === target)
      : path.dirname(target) === path.resolve(path.dirname(manifestPath));
    if (!root || !instructionAllowed || !['CLAUDE.md', 'AGENTS.md'].includes(path.basename(target)) || !['instruction-block', 'instruction-remove'].includes(change.kind)) {
      conflicts.push(`${target}: instruction target is outside the allowlist`); continue;
    }
    try {
      await assertNoSymlinkPath(path.dirname(target), root);
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error('refusing symlink instruction file'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const old = await readFile(target, 'utf8').catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      const found = old === null ? null : policyBlock(old);
      let previousFile = target;
      let previous = manifest.files[target];
      if (change.kind === 'instruction-block') {
        if (found && (!previous || previous.kind !== 'instruction-block' || hash(found.content) !== previous.currentHash)) throw new Error('existing delegation block is not an unchanged TierSplice-managed block');
        if (!found && previous?.kind === 'instruction-block') throw new Error('managed delegation block was removed or modified');
        const newline = old?.includes('\r\n') ? '\r\n' : '\n';
        const block = `${POLICY_START}${newline}${change.content.trim().replace(/\r?\n/g, newline)}${newline}${POLICY_END}`;
        const insertedSeparator = found ? previous?.insertedSeparator ?? '' : old && !old.endsWith('\n') ? newline : '';
        const next = found ? `${old.slice(0, found.start)}${block}${old.slice(found.end)}` : `${old ?? ''}${insertedSeparator}${block}`;
        prepared.push({ target, old, next, block, previous, insertedSeparator });
      } else {
        if (!found) {
          if (previous?.kind === 'instruction-block' && old !== null) throw new Error('managed delegation block is missing or malformed');
          if (previous?.kind === 'instruction-block') prepared.push({ target, old: null, next: null, remove: true, previous, previousFile });
          continue;
        }
        if (!previous && old !== null) {
          const moved = Object.entries(manifest.files).find(([file, record]) => file !== target && path.basename(file) === path.basename(target) && record.kind === 'instruction-block' && hash(found.content) === record.currentHash);
          if (moved) [previousFile, previous] = moved;
        }
        if (!previous || previous.kind !== 'instruction-block' || hash(found.content) !== previous.currentHash) throw new Error('delegation block was modified; preserving user instructions');
        let next = `${old.slice(0, found.start)}${old.slice(found.end)}`;
        const separator = previous.insertedSeparator || '';
        if (separator && old.slice(0, found.start).endsWith(separator)) next = `${next.slice(0, next.length - separator.length)}`;
        prepared.push({ target, old, next: previous.created && next === '' ? null : next, remove: true, previous, previousFile });
      }
    } catch (error) { conflicts.push(`${target}: ${error.message}`); }
  }
  if (conflicts.length) return { applied: [], conflicts, manifest };
  if (dryRun) return { applied: prepared.map((item) => ({ path: item.target, action: item.remove ? 'remove-block' : item.old === null ? 'create-block' : 'update-block' })), conflicts, manifest };
  const oldManifest = await readFile(manifestPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  const changed = [];
  try {
    for (const item of prepared) {
      if (item.remove && item.next === null) await rm(item.target, { force: true });
      else if (item.next !== undefined) await atomicWrite(item.target, item.next, { boundary: allowedRoots.map((root) => path.resolve(root)).find((root) => item.target.startsWith(`${root}${path.sep}`)) });
      changed.push(item);
      if (item.remove) { delete manifest.files[item.target]; if (item.previousFile && item.previousFile !== item.target) delete manifest.files[item.previousFile]; }
      else manifest.files[item.target] = { created: item.previous?.created ?? item.old === null, originalHash: item.previous?.originalHash ?? (item.old === null ? null : hash(item.old)), currentHash: hash(item.block), kind: 'instruction-block', insertedSeparator: item.insertedSeparator ?? item.previous?.insertedSeparator ?? '' };
    }
    if (changed.length) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: path.dirname(manifestPath) });
  } catch (error) {
    const rollbackErrors = [];
    for (const item of changed.reverse()) {
      if (item.old === null) await rm(item.target, { force: true }).catch((failure) => rollbackErrors.push(failure.message));
      else await atomicWrite(item.target, item.old, { boundary: allowedRoots.map((root) => path.resolve(root)).find((root) => item.target.startsWith(`${root}${path.sep}`)) }).catch((failure) => rollbackErrors.push(failure.message));
    }
    if (oldManifest) await atomicWrite(manifestPath, oldManifest, { boundary: path.dirname(manifestPath) }).catch((failure) => rollbackErrors.push(failure.message));
    else await rm(manifestPath, { force: true }).catch((failure) => rollbackErrors.push(failure.message));
    throw new Error(`Instruction update failed; ${rollbackErrors.length ? `rollback incomplete (${rollbackErrors.join('; ')})` : 'prior files restored'}: ${error.message}`);
  }
  return { applied: prepared.map((item) => ({ path: item.target, action: item.remove ? 'remove-block' : item.old === null ? 'create-block' : 'update-block' })), conflicts, manifest };
}

export async function assertNoSymlinkPath(file, boundary = path.parse(path.resolve(file)).root) {
  const absolute = path.resolve(file);
  const base = path.resolve(boundary);
  const relative = path.relative(base, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Path escapes its safety boundary (${base}): ${absolute}`);
  let cursor = base;
  try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symlink path component: ${cursor}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symlink path component: ${cursor}`);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
}

export async function atomicWrite(file, content, { boundary = path.parse(path.resolve(file)).root } = {}) {
  await assertNoSymlinkPath(path.dirname(file), boundary);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(path.dirname(file), boundary);
  let mode = 0o600;
  try { mode = (await stat(file)).mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${file}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${file}.tiersplice-${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode, flag: 'wx' });
  try {
    await chmod(temp, mode);
    await assertNoSymlinkPath(path.dirname(file), boundary);
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${file}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temp, file);
  } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function applyManaged(changes, manifestPath, { dryRun = false, allowedRoots = [path.dirname(manifestPath)], beforeWrite = async () => {} } = {}) {
  const manifest = await readManifest(manifestPath);
  const planned = [];
  const conflicts = [];
  const scopeRoot = path.dirname(path.resolve(manifestPath));
  const expectedConfig = path.join(scopeRoot, path.basename(manifestPath) === 'manifest.json' ? 'config.json' : '.tiersplice.json');
  const agentRoots = allowedRoots.map((root) => path.resolve(root)).filter((root) => root !== scopeRoot);
  for (const change of changes) {
    const target = path.resolve(change.path);
    const base = [...allowedRoots].map((root) => path.resolve(root)).sort((a, b) => b.length - a.length).find((root) => target === root || target.startsWith(`${root}${path.sep}`));
    if (!base) { conflicts.push(`${target}: target is outside the selected TierSplice scope`); continue; }
    const basename = path.basename(target);
    const isConfig = target === expectedConfig;
    const isAgent = agentRoots.includes(path.dirname(target)) && /^tiersplice-[a-z0-9_-]+\.(md|toml)$/.test(basename);
    if (!isConfig && !isAgent) {
      conflicts.push(`${target}: target is not an allowlisted TierSplice config or native agent filename`);
      continue;
    }
    const boundary = safetyBoundary(base, scopeRoot);
    try { await assertNoSymlinkPath(path.dirname(target), boundary); }
    catch (error) { conflicts.push(`${target}: ${error.message}`); continue; }
    let cursor = base;
    try {
      const baseStat = await lstat(cursor);
      if (baseStat.isSymbolicLink()) { conflicts.push(`${target}: refusing a symlink scope directory`); continue; }
      for (const part of path.relative(base, path.dirname(target)).split(path.sep).filter(Boolean)) {
        cursor = path.join(cursor, part);
        try { if ((await lstat(cursor)).isSymbolicLink()) { conflicts.push(`${target}: refusing a symlink path component`); break; } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (conflicts.some((item) => item.startsWith(`${target}:`))) continue;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try { if ((await lstat(target)).isSymbolicLink()) { conflicts.push(`${target}: refusing a symlink target`); continue; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let old;
    try { old = await readFile(change.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const previous = manifest.files[change.path];
    if (old && previous && hash(old) === previous.currentHash && path.basename(change.path).startsWith('tiersplice-') && !hasAgentOwnershipSignature(change.path, old)) {
      conflicts.push(`${change.path}: manifest hash matches but the file has no TierSplice ownership signature`);
      continue;
    }
    if (old && (!previous || hash(old) !== previous.currentHash)) {
      if (hash(old) !== hash(change.content)) conflicts.push(`${change.path}: existing file is not an unchanged TierSplice-managed file`);
      continue;
    }
    if (old && hash(old) === hash(change.content)) { planned.push({ change, old, action: 'unchanged', previous }); continue; }
    planned.push({ change, old, action: old ? 'update' : 'create', previous });
  }
  if (conflicts.length) return { applied: [], conflicts, manifest };
  if (dryRun) return { applied: planned.map(({ change, action }) => ({ path: change.path, action })), conflicts, manifest };
  const changed = [];
  const oldManifest = await readFile(manifestPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  try {
    for (const item of planned) {
      if (item.action === 'unchanged') continue;
      await beforeWrite(item.change.path);
      await atomicWrite(item.change.path, item.change.content, { boundary: safetyBoundary(baseFor(item.change.path, allowedRoots), scopeRoot) });
      changed.push(item);
      manifest.files[item.change.path] = { created: !item.old && !item.previous, originalHash: item.previous?.originalHash ?? (item.old ? hash(item.old) : null), currentHash: hash(item.change.content), kind: item.change.kind ?? item.previous?.kind ?? (path.basename(item.change.path).startsWith('tiersplice-') ? 'generated-output' : 'source-config') };
    }
    if (changed.length) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: scopeRoot });
  } catch (error) {
    const rollbackErrors = [];
    for (const item of changed.reverse()) {
      if (item.old) await atomicWrite(item.change.path, item.old, { boundary: safetyBoundary(baseFor(item.change.path, allowedRoots), scopeRoot) }).catch((failure) => rollbackErrors.push(`${item.change.path}: ${failure.message}`));
      else await rm(item.change.path, { force: true }).catch((failure) => rollbackErrors.push(`${item.change.path}: ${failure.message}`));
    }
    if (oldManifest) await atomicWrite(manifestPath, oldManifest, { boundary: scopeRoot }).catch((failure) => rollbackErrors.push(`${manifestPath}: ${failure.message}`));
    else await rm(manifestPath, { force: true }).catch((failure) => rollbackErrors.push(`${manifestPath}: ${failure.message}`));
    throw new Error(`TierSplice write failed; ${rollbackErrors.length ? `rollback incomplete (${rollbackErrors.join('; ')})` : 'prior files restored'}: ${error.message}`);
  }
  return { applied: planned.map(({ change, action }) => ({ path: change.path, action })), conflicts, manifest };
}

function baseFor(target, roots) {
  return roots.map((root) => path.resolve(root)).filter((root) => target === root || target.startsWith(`${root}${path.sep}`)).sort((a, b) => b.length - a.length)[0] || path.dirname(target);
}

function safetyBoundary(root, scopeRoot) {
  if (root === scopeRoot) return scopeRoot;
  if (path.basename(root) === 'agents' && ['.claude', '.codex'].includes(path.basename(path.dirname(root)))) return path.dirname(path.dirname(root));
  return root;
}

export async function listOwned(manifestPath, { allowedRoots = [path.dirname(manifestPath)], allowedConfig = null } = {}) {
  const manifest = await readManifest(manifestPath);
  const removable = [];
  const conflicts = [];
  const scopeRoot = path.dirname(path.resolve(manifestPath));
  const agentRoots = allowedRoots.map((root) => path.resolve(root)).filter((root) => root !== scopeRoot);
  for (const [file, record] of Object.entries(manifest.files)) {
    if (record.kind === 'instruction-block') continue;
    const target = path.resolve(file);
    const allowed = allowedRoots.some((root) => {
      const base = path.resolve(root);
      return target === base || target.startsWith(`${base}${path.sep}`);
    });
    const basename = path.basename(target);
    if (!allowed || (target !== allowedConfig && !/^tiersplice-[a-z0-9_-]+\.(md|toml)$/.test(basename))) { conflicts.push(file); continue; }
    if (target !== allowedConfig && !agentRoots.includes(path.dirname(target))) { conflicts.push(file); continue; }
    if (target !== allowedConfig && !['generated-output', 'native-agent', undefined].includes(record.kind)) { conflicts.push(file); continue; }
    try { await assertNoSymlinkPath(path.dirname(target), safetyBoundary(baseFor(target, allowedRoots), scopeRoot)); } catch { conflicts.push(file); continue; }
    try { if ((await lstat(target)).isSymbolicLink()) { conflicts.push(file); continue; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let current;
    try { current = await readFile(file); } catch (error) { if (error.code === 'ENOENT') { removable.push(file); continue; } throw error; }
    const ownedSignature = hasAgentOwnershipSignature(target, current);
    const verifiedConfig = target === allowedConfig && record.created === true && record.userModified !== true && ['config', 'source-config', undefined].includes(record.kind);
    (hash(current) === record.currentHash && (ownedSignature || verifiedConfig) ? removable : conflicts).push(file);
  }
  return { manifest, removable, conflicts };
}

export async function uninstallOwned(manifestPath, dryRun = false, options = {}) {
  const { manifest, removable, conflicts } = await listOwned(manifestPath, options);
  const scopeRoot = path.dirname(path.resolve(manifestPath));
  if (!dryRun) {
    const backups = new Map();
    const oldManifest = await readFile(manifestPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    try {
      for (const file of removable) {
        await assertNoSymlinkPath(path.dirname(file), safetyBoundary(baseFor(file, options.allowedRoots || [path.dirname(manifestPath)]), scopeRoot));
        backups.set(file, await readFile(file).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error)));
      }
      for (const file of removable) await rm(file, { force: true });
      for (const file of removable) delete manifest.files[file];
      if (Object.keys(manifest.files).length) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { boundary: path.dirname(manifestPath) });
      else await rm(manifestPath, { force: true });
    } catch (error) {
      const rollbackErrors = [];
      for (const [file, content] of backups) {
        if (content) await atomicWrite(file, content, { boundary: safetyBoundary(baseFor(file, options.allowedRoots || [path.dirname(manifestPath)]), scopeRoot) }).catch((failure) => rollbackErrors.push(`${file}: ${failure.message}`));
      }
      if (oldManifest) await atomicWrite(manifestPath, oldManifest, { boundary: path.dirname(manifestPath) }).catch((failure) => rollbackErrors.push(`${manifestPath}: ${failure.message}`));
      throw new Error(`Uninstall failed; ${rollbackErrors.length ? `rollback incomplete (${rollbackErrors.join('; ')})` : 'prior files restored'}: ${error.message}`);
    }
  }
  return { removable, conflicts };
}
