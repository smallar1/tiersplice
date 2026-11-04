import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const hash = (content) => createHash('sha256').update(content).digest('hex');

export function getPaths(scope, cwd = process.cwd()) {
  const home = homedir();
  if (scope === 'global') {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const base = process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'tiersplice') : path.join(configHome, 'tiersplice');
    return { root: base, config: path.join(base, 'config.json'), manifest: path.join(base, 'manifest.json'), claudeAgents: path.join(home, '.claude', 'agents'), codexAgents: path.join(home, '.codex', 'agents') };
  }
  const root = path.resolve(cwd);
  return { root, config: path.join(root, '.tiersplice.json'), manifest: path.join(root, '.tiersplice-manifest.json'), claudeAgents: path.join(root, '.claude', 'agents'), codexAgents: path.join(root, '.codex', 'agents') };
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
  }
  return paths;
}

export async function readManifest(file) {
  try {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    if (!manifest || manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw new Error('invalid manifest structure');
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, files: {} };
    throw new Error(`Cannot read TierSplice ownership manifest ${file}: ${error.message}`);
  }
}

export async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try { if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${file}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${file}.tiersplice-${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  try { await rename(temp, file); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function applyManaged(changes, manifestPath, { dryRun = false, allowedRoots = [path.dirname(manifestPath)] } = {}) {
  const manifest = await readManifest(manifestPath);
  const planned = [];
  const conflicts = [];
  for (const change of changes) {
    const target = path.resolve(change.path);
    const base = allowedRoots.map((root) => path.resolve(root)).find((root) => target === root || target.startsWith(`${root}${path.sep}`));
    if (!base) { conflicts.push(`${target}: target is outside the selected TierSplice scope`); continue; }
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
      await atomicWrite(item.change.path, item.change.content);
      changed.push(item);
      manifest.files[item.change.path] = { created: !item.old && !item.previous, originalHash: item.previous?.originalHash ?? (item.old ? hash(item.old) : null), currentHash: hash(item.change.content) };
    }
    if (changed.length) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    for (const item of changed.reverse()) {
      if (item.old) await atomicWrite(item.change.path, item.old).catch(() => {});
      else await rm(item.change.path, { force: true }).catch(() => {});
    }
    if (oldManifest) await atomicWrite(manifestPath, oldManifest).catch(() => {});
    else await rm(manifestPath, { force: true }).catch(() => {});
    throw new Error(`TierSplice write failed; prior files were restored where possible: ${error.message}`);
  }
  return { applied: planned.map(({ change, action }) => ({ path: change.path, action })), conflicts, manifest };
}

export async function listOwned(manifestPath, { allowedRoots = [path.dirname(manifestPath)], allowedConfig = null } = {}) {
  const manifest = await readManifest(manifestPath);
  const removable = [];
  const conflicts = [];
  for (const [file, record] of Object.entries(manifest.files)) {
    const target = path.resolve(file);
    const allowed = allowedRoots.some((root) => {
      const base = path.resolve(root);
      return target === base || target.startsWith(`${base}${path.sep}`);
    });
    if (!allowed || (target !== allowedConfig && !path.basename(target).startsWith('tiersplice-'))) { conflicts.push(file); continue; }
    try { if ((await lstat(target)).isSymbolicLink()) { conflicts.push(file); continue; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let current;
    try { current = await readFile(file); } catch (error) { if (error.code === 'ENOENT') { removable.push(file); continue; } throw error; }
    (hash(current) === record.currentHash ? removable : conflicts).push(file);
  }
  return { manifest, removable, conflicts };
}

export async function uninstallOwned(manifestPath, dryRun = false, options = {}) {
  const { manifest, removable, conflicts } = await listOwned(manifestPath, options);
  if (!dryRun) {
    for (const file of removable) await rm(file, { force: true });
    for (const file of removable) delete manifest.files[file];
    if (Object.keys(manifest.files).length) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    else await rm(manifestPath, { force: true });
  }
  return { removable, conflicts };
}
