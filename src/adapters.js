import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const runVersion = (command) => {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim().split(/\r?\n/)[0].slice(0, 120) || 'version unavailable';
};

async function exists(file) { try { await access(file); return true; } catch { return false; } }

export async function detectRuntimes(paths) {
  const home = paths.root === paths.config ? paths.root : undefined;
  const claudeHome = process.platform === 'win32' ? path.join(process.env.USERPROFILE || '', '.claude') : path.join(process.env.HOME || '', '.claude');
  const codexHome = process.platform === 'win32' ? path.join(process.env.USERPROFILE || '', '.codex') : path.join(process.env.HOME || '', '.codex');
  const claudeVersion = runVersion('claude');
  const codexVersion = runVersion('codex');
  const claude = claudeVersion || await exists(path.join(claudeHome, 'settings.json')) || await exists(paths.claudeAgents);
  const codex = codexVersion || await exists(path.join(codexHome, 'config.toml')) || await exists(paths.codexAgents);
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
      docs: 'Handle documentation, explanations, and concise repository research.',
      explorer: 'Inspect code and report findings without modifying files.',
      implementer: 'Implement scoped changes and report files changed.',
      debugger: 'Investigate a scoped bug, identify its cause, apply a focused fix, and report evidence.',
      architect: 'Analyze system design and propose concrete implementation tradeoffs.',
      reviewer: 'Review changes for correctness, regressions, and security issues without editing.'
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
    const instructions = `${({ documentation: 'Update documentation and explain relevant changes.', exploration: 'Inspect the repository and report findings without editing.', implementation: 'Apply scoped code changes and report files changed.', debugging: 'Investigate and fix a scoped bug, then report evidence.', architecture: 'Analyze system design and concrete tradeoffs.', review: 'Inspect correctness and regressions without editing.' })[role]} TierSplice ${policy.profile} requests ${tier}; host settings and account availability may override it.`;
    const effort = route.effort === 'max' ? '' : `model_reasoning_effort = ${tomlString(route.effort)}\n`;
    const body = `name = ${tomlString(`tiersplice-${suffix}`)}\ndescription = ${tomlString(`TierSplice ${role} agent (${tier} tier).`)}\nmodel = ${tomlString(route.model)}\n${effort}developer_instructions = ${tomlString(instructions)}\n`;
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
