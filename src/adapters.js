import { access, readFile } from 'node:fs/promises';
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
  const names = { documentation: 'docs', exploration: 'explorer', implementation: 'implementer', architecture: 'architect', review: 'reviewer' };
  return Object.entries(names).map(([role, suffix]) => {
    const tier = policy.roles[role];
    const route = policy.routes.claude[tier];
    const descriptions = {
      docs: 'Handle documentation, explanations, and concise repository research.',
      explorer: 'Inspect code and report findings without modifying files.',
      implementer: 'Implement scoped changes and report files changed.',
      architect: 'Analyze system design and propose concrete implementation tradeoffs.',
      reviewer: 'Review changes for correctness, regressions, and security issues without editing.'
    };
    const tools = suffix === 'explorer' || suffix === 'reviewer' ? 'tools: Read, Grep, Glob\n' : '';
    return `---\nname: tiersplice-${suffix}\ndescription: ${descriptions[suffix]}\nmodel: ${route.model}\n${tools}---\n${descriptions[suffix]} This agent is assigned the ${tier} tier by TierSplice profile ${policy.profile}. Treat model selection as a configured preference; the host may override it.\n`;
  }).join('\n');
}

function tomlString(value) { return JSON.stringify(value); }

export function renderCodex(policy) {
  const names = { documentation: 'docs', exploration: 'explorer', implementation: 'implementer', architecture: 'architect', review: 'reviewer' };
  return Object.entries(names).map(([role, suffix]) => {
    const tier = policy.roles[role];
    const route = policy.routes.codex[tier];
    const instructions = `Work on the ${role} role at the ${tier} task tier. The TierSplice ${policy.profile} profile requests this model and reasoning effort; host settings and account availability may override or reject them.`;
    const effort = route.effort === 'max' ? '' : `model_reasoning_effort = ${tomlString(route.effort)}\n`;
    return { name: suffix, body: `name = ${tomlString(`tiersplice-${suffix}`)}\ndescription = ${tomlString(`TierSplice ${role} agent (${tier} tier).`)}\nmodel = ${tomlString(route.model)}\n${effort}developer_instructions = ${tomlString(instructions)}\n` };
  });
}

export async function detectGsd(projectRoot) {
  const configFile = path.join(projectRoot, '.planning', 'config.json');
  try {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    return { detected: true, configFile, config, supported: false, message: 'GSD project detected; compatibility schema/version is not verified, so TierSplice made no GSD changes.' };
  } catch (error) {
    if (error.code === 'ENOENT') return { detected: false, configFile, supported: false, message: 'GSD not detected in this project.' };
    return { detected: true, configFile, config: null, supported: false, message: `GSD config could not be read safely (${error.message}); no GSD changes were made.` };
  }
}

export function gsdShadowing(gsd, scope, localConfig) {
  if (!gsd.detected) return null;
  if (scope === 'global' && gsd.configFile && !localConfig) return 'This project has .planning/config.json; run tiersplice sync --local to apply project-specific policy when support is available.';
  if (gsd.config && Object.keys(gsd.config).some((key) => ['model_overrides', 'models', 'model_profile'].includes(key))) return 'Existing GSD model settings may take precedence over TierSplice routing.';
  return gsd.message;
}
