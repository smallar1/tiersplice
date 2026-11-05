import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmExecPath = process.env.npm_execpath;
const temp = await mkdtemp(path.join(os.tmpdir(), 'tiersplice-pack-smoke-'));
const tarballs = path.join(temp, 'tarballs');
const install = path.join(temp, 'consumer');
const env = { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') };

try {
  await mkdir(tarballs, { recursive: true });
  const invokeNpm = (args, options) => npmExecPath
    ? execFileSync(process.execPath, [npmExecPath, ...args], options)
    : execFileSync(npm, args, { ...options, shell: process.platform === 'win32' });
  const packOutput = invokeNpm(['pack', '--json', '--pack-destination', tarballs], { cwd: project, encoding: 'utf8', env });
  const jsonStart = packOutput.lastIndexOf('\n[');
  if (jsonStart < 0) throw new Error(`npm pack did not return its JSON manifest: ${packOutput}`);
  const packReport = JSON.parse(packOutput.slice(jsonStart + 1));
  const shipped = new Set(packReport[0].files.map(({ path: file }) => file));
  const expected = ['CHANGELOG.md', 'IMPLEMENTATION_STATUS.md', 'LICENSE', 'README.md', 'RELEASE_AUDIT_v0.2.1.md', 'docs/resolve.md', 'package.json', 'schemas/config.schema.json', 'schemas/resolve.schema.json', 'src/adapters.js', 'src/cli.js', 'src/config.js', 'src/filesystem.js'];
  if (shipped.size !== expected.length || expected.some((file) => !shipped.has(file))) throw new Error(`Unexpected package contents: ${[...shipped].sort().join(', ')}`);
  const tarballName = (await readdir(tarballs)).find((name) => name.endsWith('.tgz'));
  if (!tarballName) throw new Error('npm pack did not create a tarball.');
  const tarball = path.join(tarballs, tarballName);
  invokeNpm(['install', '--offline', '--prefix', install, '--ignore-scripts', tarball], { cwd: temp, stdio: 'inherit', env });
  const installedPackage = path.join(install, 'node_modules', 'tiersplice');
  const metadata = JSON.parse(await readFile(path.join(installedPackage, 'package.json'), 'utf8'));
  if (metadata.bin?.tiersplice !== './src/cli.js') throw new Error('Installed package bin does not target the shipped CLI entry point.');
  const cli = path.resolve(installedPackage, metadata.bin.tiersplice);
  const cliStat = await stat(cli);
  if (!cliStat.isFile()) throw new Error('Installed package CLI entry point is missing.');
  if (process.platform !== 'win32' && (cliStat.mode & 0o111) === 0) throw new Error('Installed package CLI entry point is not executable.');
  if (!(await readFile(cli, 'utf8')).startsWith('#!/usr/bin/env node')) throw new Error('Installed CLI entry point is missing its Node.js shebang.');
  const version = execFileSync(process.execPath, [cli, '--version'], { cwd: temp, encoding: 'utf8' }).trim();
  if (version !== metadata.version) throw new Error(`Packaged CLI returned unexpected version: ${version}`);
  const help = execFileSync(process.execPath, [cli, '--help'], { cwd: temp, encoding: 'utf8' });
  if (!help.includes('Usage:') || !help.includes('resolve')) throw new Error('Packaged CLI help is incomplete.');
  const resolved = execFileSync(process.execPath, [cli, 'resolve', '--runtime', 'claude', '--role', 'implementation', '--json'], { cwd: temp, encoding: 'utf8' });
  if (JSON.parse(resolved).assignment !== 'policy-only') throw new Error('Packaged CLI resolve did not return a policy-only decision.');
  const disposableProject = path.join(temp, 'project');
  await mkdir(path.join(disposableProject, '.git'), { recursive: true });
  execFileSync(process.execPath, [cli, 'init', '--local', '--yes', '--dry-run', '--cwd', disposableProject], { cwd: disposableProject, stdio: 'ignore', env: { ...env, HOME: temp, USERPROFILE: temp, XDG_CONFIG_HOME: path.join(temp, 'xdg') } });
  if ((await readdir(disposableProject)).length !== 1) throw new Error('Packaged local dry-run wrote files into the disposable project.');
  process.stdout.write(`Packaged CLI smoke test passed (${version}).\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
