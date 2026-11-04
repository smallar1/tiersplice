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
  invokeNpm(['pack', '--pack-destination', tarballs], { cwd: project, stdio: 'inherit', env });
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
  if (version !== '0.2.0') throw new Error(`Packaged CLI returned unexpected version: ${version}`);
  process.stdout.write(`Packaged CLI smoke test passed (${version}).\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
