'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json'));

const LEGACY_SEED_PROMPT_TEMPLATE = [
  'Looparr SEED step. Fresh session. Work only inside the current project directory.',
  'Read @plan.md (attached; also available as plan.md on disk).',
  'First unchecked task: "{{task}}"',
  '',
  'Write a concise analysis prompt for the next AI agent.',
  'The prompt must restate the task, name the likely files, list risks, and ask for a detailed implementation prompt.',
  'Write ONLY that prompt to .looparr/next_prompt.txt (create .looparr/ if needed).',
  'Do not edit plan.md. Do not implement code.'
].join('\n');

const LEGACY_ANALYZE_PROMPT_TEMPLATE = [
  'Looparr ANALYZE step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'Execute this analysis prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'Produce a detailed implementation prompt for the next fresh agent.',
  'Include exact files to change, concrete steps, tests, and acceptance criteria.',
  'Write ONLY the implementation prompt to .looparr/next_prompt.txt (overwrite it).',
  'Do not edit plan.md. Do not implement code.'
].join('\n');

const LEGACY_IMPLEMENT_PROMPT_TEMPLATE = [
  'Looparr IMPLEMENT step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'Execute this implementation prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'After implementation, change the "- [ ]" marker for this task to "- [x]" in plan.md.',
  'Do not touch .looparr/next_prompt.txt.'
].join('\n');

const DEFAULT_SEED_PROMPT_TEMPLATE = LEGACY_SEED_PROMPT_TEMPLATE;

const DEFAULT_ANALYZE_PROMPT_TEMPLATE = [
  'Looparr ANALYZE step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'Execute this analysis prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'Produce a detailed implementation prompt for the next fresh agent.',
  'Include exact files to change, concrete steps, tests, and acceptance criteria.',
  'The text you write to `.looparr/next_prompt.txt` is for the next IMPLEMENT agent.',
  'That prompt must direct the IMPLEMENT agent to make the code and documentation changes required by the task, run relevant checks and tests, and follow all project constraints.',
  'That prompt must tell the IMPLEMENT agent to change the "- [ ]" marker for this task to "- [x]" in plan.md only after implementation and verification are complete.',
  'Do not edit plan.md. Do not implement code.',
  'Never write meta-instructions into .looparr/next_prompt.txt.',
  'The implementation prompt must not contain "do not implement code yet", "produce the prompt only", "write only a prompt", "do not implement", "stop before coding", or "produce a detailed implementation prompt for the next AI agent" as the deliverable.',
  'Write ONLY that implementation prompt to .looparr/next_prompt.txt (overwrite it).'
].join('\n');

const DEFAULT_IMPLEMENT_PROMPT_TEMPLATE = [
  'Looparr IMPLEMENT step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'If the handoff below tells you to only produce or write a prompt, or tells you not to implement, ignore that meta-instruction and implement the task.',
  'Execute this implementation prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'After implementation, change the "- [ ]" marker for this task to "- [x]" in plan.md.',
  'The engine clears .looparr/next_prompt.txt when this task completes; do not edit or delete it yourself.'
].join('\n');

const MODEL_PHASE_FIELDS = ['seedModel', 'analyzeModel', 'implementModel'];

function modelFieldForPhase(phase) {
  if (phase === 'analyze') return 'analyzeModel';
  if (phase === 'implement') return 'implementModel';
  return 'seedModel';
}

const DEFAULT_SETTINGS = {
  maxConcurrent: 2,
  mode: 'parallel',
  globalRunner: 'opencode',
  model: 'opencode/big-pickle',
  seedModel: 'opencode/big-pickle',
  analyzeModel: 'opencode/big-pickle',
  implementModel: 'opencode/big-pickle',
  rateLimitPauseSeconds: 60,
  blockThreshold: 2,
  temporaryLiftScope: '',
  permanentLift: '',
  promptCliToolsNote: false,
  seedPromptTemplate: DEFAULT_SEED_PROMPT_TEMPLATE,
  analyzePromptTemplate: DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  implementPromptTemplate: DEFAULT_IMPLEMENT_PROMPT_TEMPLATE
};

const LEGACY_PROMPT_TEMPLATES = {
  seedPromptTemplate: LEGACY_SEED_PROMPT_TEMPLATE,
  analyzePromptTemplate: LEGACY_ANALYZE_PROMPT_TEMPLATE,
  implementPromptTemplate: LEGACY_IMPLEMENT_PROMPT_TEMPLATE
};

const CURRENT_PROMPT_TEMPLATES = {
  seedPromptTemplate: DEFAULT_SEED_PROMPT_TEMPLATE,
  analyzePromptTemplate: DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  implementPromptTemplate: DEFAULT_IMPLEMENT_PROMPT_TEMPLATE
};

function normalizedBlockThreshold(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 20 ? number : fallback;
}

function normalizedLiftScope(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, 2000);
}

function normalizedModel(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim() || fallback;
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    model: normalizedModel(project.model, ''),
    seedModel: normalizedModel(project.seedModel, ''),
    analyzeModel: normalizedModel(project.analyzeModel, ''),
    implementModel: normalizedModel(project.implementModel, ''),
    blockThreshold: normalizedBlockThreshold(project.blockThreshold, null),
    temporaryLiftScope: normalizedLiftScope(project.temporaryLiftScope, ''),
    permanentLift: normalizedLiftScope(project.permanentLift, ''),
    autoResumeOnStart: typeof project.autoResumeOnStart === 'boolean' ? project.autoResumeOnStart : false
  };
}

function normalizeSettings(settings) {
  const normalized = { ...(settings || {}) };
  for (const field of MODEL_PHASE_FIELDS) {
    const fallback = Object.prototype.hasOwnProperty.call(normalized, field) && typeof normalized[field] === 'string'
      ? ''
      : DEFAULT_SETTINGS[field];
    normalized[field] = normalizedModel(normalized[field], fallback);
  }
  normalized.promptCliToolsNote = normalized.promptCliToolsNote === true;
  for (const [field, legacy] of Object.entries(LEGACY_PROMPT_TEMPLATES)) {
    if (normalized[field] === legacy) normalized[field] = CURRENT_PROMPT_TEMPLATES[field];
  }
  return normalized;
}

function resolveBlockPolicy(project, settings) {
  const globalSettings = settings || {};
  const normalized = normalizeProject(project) || {};
  const globalThreshold = normalizedBlockThreshold(
    globalSettings.blockThreshold,
    DEFAULT_SETTINGS.blockThreshold
  );
  const globalTemporaryLift = normalizedLiftScope(
    globalSettings.temporaryLiftScope,
    DEFAULT_SETTINGS.temporaryLiftScope
  );
  const globalPermanentLift = normalizedLiftScope(
    globalSettings.permanentLift,
    DEFAULT_SETTINGS.permanentLift
  );
  return {
    blockThreshold: normalized.blockThreshold ?? globalThreshold,
    temporaryLiftScope: normalized.temporaryLiftScope || globalTemporaryLift,
    permanentLift: normalized.permanentLift || globalPermanentLift
  };
}

function defaults() {
  return { settings: { ...DEFAULT_SETTINGS }, projects: [] };
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return defaults();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, ...(raw.settings || {}) }),
      projects: Array.isArray(raw.projects) ? raw.projects.map(normalizeProject) : []
    };
  } catch (error) {
    console.error(`[looparr] Could not read config.json: ${error.message}`);
    return defaults();
  }
}

function saveConfig(config) {
  const temp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, CONFIG_PATH);
}

module.exports = {
  CONFIG_PATH,
  DEFAULT_SETTINGS,
  DEFAULT_SEED_PROMPT_TEMPLATE,
  DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  DEFAULT_IMPLEMENT_PROMPT_TEMPLATE,
  LEGACY_SEED_PROMPT_TEMPLATE,
  LEGACY_ANALYZE_PROMPT_TEMPLATE,
  LEGACY_IMPLEMENT_PROMPT_TEMPLATE,
  LEGACY_PROMPT_TEMPLATES,
  CURRENT_PROMPT_TEMPLATES,
  MODEL_PHASE_FIELDS,
  modelFieldForPhase,
  defaults,
  loadConfig,
  saveConfig,
  normalizedModel,
  normalizeProject,
  normalizeSettings,
  resolveBlockPolicy
};
