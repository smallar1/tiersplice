import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';

const runVersion = (command) => {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim().split(/\r?\n/)[0].slice(0, 120) || 'version unavailable';
};

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function executableOnPath(command) {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  const accessMode = process.platform === 'win32' ? undefined : fsConstants.X_OK;
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try { await access(candidate, accessMode); return true; } catch {}
    }
  }
  return false;
}

export async function detectRuntimes(paths, { probeVersions = true } = {}) {
  const home = process.platform === 'win32' ? process.env.USERPROFILE || '' : process.env.HOME || '';
  const claudeHome = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(home, '.codex'));
  const claudeVersion = probeVersions ? runVersion('claude') : null;
  const codexVersion = probeVersions ? runVersion('codex') : null;
  const claude = claudeVersion || await exists(path.join(claudeHome, 'settings.json')) || await exists(paths.claudeAgents) || await executableOnPath('claude');
  const codex = codexVersion || await exists(path.join(codexHome, 'config.toml')) || await exists(paths.codexAgents) || await executableOnPath('codex');
  return {
    claude: { id: 'claude', status: claude ? 'detected' : 'not found', version: typeof claude === 'string' ? claude : claudeVersion, modelAccess: 'unverified' },
    codex: { id: 'codex', status: codex ? 'detected' : 'not found', version: typeof codex === 'string' ? codex : codexVersion, modelAccess: 'unverified' }
  };
}

export function renderClaude(policy) {
  const names = { documentation: 'docs', exploration: 'explorer', implementation: 'implementer', debugging: 'debugger', architecture: 'architect', review: 'reviewer' };
  return Object.entries(names).map(([role, suffix]) => {
    const tier = policy.roles[role];
    const route = policy.routes.claude[tier];
    const descriptions = {
      docs: 'Use proactively for scoped documentation edits or concise documentation research; do not implement code changes.',
      explorer: 'Use proactively to locate implementation and summarize patterns; read-only, do not modify files.',
      implementer: 'Use proactively for bounded feature implementation, ordinary bug fixes, and targeted tests; report changed files.',
      debugger: 'Use proactively for intermittent failures or complex errors; find the cause before a focused fix and report verification.',
      architect: 'Use proactively for difficult design choices and system tradeoffs; analyze first and do not edit unless asked.',
      reviewer: 'Use proactively when changed code needs correctness, regression, or security review; read-only, do not edit.'
    };
    const tools = suffix === 'explorer' || suffix === 'reviewer' ? 'tools: Read, Grep, Glob\n' : '';
    const safe = (value) => {
      if (/[\r\n\x00-\x1f\x7f]/.test(value)) throw new Error('Model and instruction values cannot contain control characters.');
      return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    };
    const content = `---\nname: tiersplice-${suffix}\ndescription: "${safe(descriptions[suffix])}"\nmodel: "${safe(route.model)}"\n${tools}---\n${descriptions[suffix]} Assigned the ${tier} tier by TierSplice profile ${policy.profile}; the host may override this preference.\n`;
    parseClaudeAgent(content);
    return { name: suffix, content };
  });
}

function tomlString(value) { return JSON.stringify(value); }

export function renderCodex(policy) {
  const names = { documentation: 'docs', exploration: 'explorer', implementation: 'implementer', debugging: 'debugger', architecture: 'architect', review: 'reviewer' };
  return Object.entries(names).map(([role, suffix]) => {
    const tier = policy.roles[role];
    const route = policy.routes.codex[tier];
    const instructions = `${({ documentation: 'Use proactively for scoped documentation edits; do not implement code changes.', exploration: 'Use proactively to locate code and summarize patterns; inspect only and report findings without editing.', implementation: 'Use proactively for bounded feature work, ordinary bug fixes, and targeted tests; report changed files.', debugging: 'Use proactively for failures and complex errors; identify the cause before a focused fix and report verification.', architecture: 'Use proactively for difficult design choices; analyze tradeoffs and do not edit unless asked.', review: 'Use proactively to review changed code for correctness, regressions, and security; report findings without editing.' })[role]} TierSplice ${policy.profile} requests ${tier}; host settings and account availability may override it.`;
    const effort = route.effort === 'max' ? '' : `model_reasoning_effort = ${tomlString(route.effort)}\n`;
    const description = `Use proactively for ${({ documentation: 'scoped documentation edits', exploration: 'bounded read-only code discovery', implementation: 'bounded feature implementation and ordinary fixes', debugging: 'test failures and complex errors', architecture: 'difficult design tradeoffs', review: 'read-only code review' })[role]} (${tier} tier).`;
    const body = `name = ${tomlString(`tiersplice-${suffix}`)}\ndescription = ${tomlString(description)}\nmodel = ${tomlString(route.model)}\n${effort}developer_instructions = ${tomlString(instructions)}\n`;
    parseCodexAgent(body);
    return { name: suffix, body };
  });
}

export function parseClaudeAgent(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error('Invalid Claude agent: missing YAML frontmatter delimiters.');
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-zA-Z][a-zA-Z0-9]*):(?:\s+(.+))?$/.exec(line);
    if (!field || Object.hasOwn(frontmatter, field[1])) throw new Error(`Invalid Claude agent frontmatter line: ${line}`);
    const value = field[2] ?? '';
    try { frontmatter[field[1]] = value.startsWith('"') ? JSON.parse(value) : value; }
    catch { throw new Error(`Invalid quoted YAML scalar for ${field[1]}.`); }
    if (typeof frontmatter[field[1]] !== 'string') throw new Error(`Invalid Claude agent value for ${field[1]}.`);
  }
  if (!frontmatter.name || !frontmatter.description || !frontmatter.model || !match[2].trim()) throw new Error('Claude agent is missing a required name, description, model, or prompt.');
  if (Object.keys(frontmatter).some((key) => !['name', 'description', 'model', 'tools'].includes(key))) throw new Error('Claude agent contains an unsupported frontmatter field.');
  return { frontmatter, prompt: match[2] };
}

export function parseCodexAgent(content) {
  const values = {};
  for (const line of content.trimEnd().split(/\r?\n/)) {
    const match = /^([a-z][a-z_]+) = ("(?:[^"\\]|\\.)*")$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw new Error(`Invalid Codex agent TOML line: ${line}`);
    try { values[match[1]] = JSON.parse(match[2]); }
    catch { throw new Error(`Invalid TOML basic string for ${match[1]}.`); }
  }
  if (!values.name || !values.description || !values.model || !values.developer_instructions) throw new Error('Codex agent is missing a required field.');
  if (Object.keys(values).some((key) => !['name', 'description', 'model', 'model_reasoning_effort', 'developer_instructions'].includes(key))) throw new Error('Codex agent contains an unsupported TOML field.');
  return values;
}
