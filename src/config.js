'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULT_KILO_MODEL } = require('./kilo-command');
const {
  normalizeModelList,
  replaceKnownNonFreeModels,
  replaceKnownUnstableModels
} = require('./model-list');

const DEFAULT_OPENCODE_MODEL = 'opencode/big-pickle';
const DEFAULT_VIBE_MODEL = 'zai-glm-5-3-flash-vibe-free';
const DEFAULT_MODEL_IDS = [DEFAULT_OPENCODE_MODEL, DEFAULT_KILO_MODEL, DEFAULT_VIBE_MODEL].join(',');
const DEFAULT_PLAN_MODEL_IDS = [DEFAULT_OPENCODE_MODEL, DEFAULT_KILO_MODEL].join(',');

const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json'));

const HANDOFF_DRAFT_PATH = '.looparr/next_prompt.handoff.tmp';
const HANDOFF_VALIDATOR_PATH = JSON.stringify('scripts/validate-handoff.js');
const HANDOFF_VALIDATION_STEPS = [
  `Draft the handoff to ${HANDOFF_DRAFT_PATH} (create .looparr/ if needed).`,
  `Run node ${HANDOFF_VALIDATOR_PATH} ${HANDOFF_DRAFT_PATH}.`,
  'If validation fails, correct only the reported phrasing in the draft and rerun until it passes.',
  'Move the clean draft to .looparr/next_prompt.txt (overwrite it).'
];

const LEGACY_STORED_SEED_PROMPT_TEMPLATE = [
  'Looparr SEED step. Fresh session. Work only inside the current project directory.',
  'Read @plan.md (attached; also available as plan.md on disk).',
  'First unchecked task: "{{task}}"',
  '',
  'Write a concise analysis prompt for the next AI agent.',
  'The prompt must restate the task, name the likely files, list risks, and ask for a detailed implementation prompt.',
  'Write ONLY that prompt to .looparr/next_prompt.txt (create .looparr/ if needed).',
  'Do not edit plan.md. Do not implement code.'
].join('\n');

const LEGACY_STORED_ANALYZE_PROMPT_TEMPLATE = [
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

const LEGACY_DEFAULT_ANALYZE_PROMPT_TEMPLATE = [
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
  'Write ONLY that implementation prompt to .looparr/next_prompt.txt (overwrite it).',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
].join('\n');

const LEGACY_PLAN_WRITE_PROMPT_TEMPLATE = [
  'Looparr PLAN WRITE step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'The clarifying questions and the user\'s answers follow:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'Produce a fully mapped-out plan for this task from the questions and answers above:',
  '1. Write the mapped plan document to .project_documents/PLAN-<slug>.md (slug derived from the task text:',
  '   lowercase letters, digits and hyphens only). It must contain the design, a file map, ordered steps, tests,',
  '   acceptance criteria, and risks.',
  '2. In plan.md, replace the original "(plan)" task line with concrete generated checklist tasks (one "- [ ]" line each)',
  '   that implement this plan. The original "(plan)" line must not remain unchecked: replace it, remove it, or mark it done.',
  '3. Overwrite .looparr/next_prompt.txt with ONLY the concise analysis prompt for the next phase:',
  '   restate the task, name the likely files, list risks, and direct the next fresh agent to produce a detailed implementation prompt.',
  '',
  'The analysis prompt in .looparr/next_prompt.txt must not contain meta-instructions such as',
  '"do not implement code yet", "produce the prompt only", "write only a prompt", "do not implement", or "stop before coding".',
  'Do not implement code.',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
].join('\\n');

const LEGACY_SEED_PROMPT_TEMPLATE = [
  'Looparr SEED step. Fresh session. Work only inside the current project directory.',
  'Read the plan file at {{planPath}} if you need full plan context; the first unchecked task is already provided below.',
  'First unchecked task: "{{task}}"',
  '',
  'Write a concise analysis prompt for the next AI agent.',
  'The prompt must restate the task, name the likely files, list risks, and ask for a detailed implementation prompt.',
  'Write ONLY that prompt to .looparr/next_prompt.txt (create .looparr/ if needed).',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.',
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
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.',
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

const DEFAULT_SEED_PROMPT_TEMPLATE = [
  'Looparr SEED step. Fresh session. Work only inside the current project directory.',
  'Read the plan file at {{planPath}} if you need full plan context; the first unchecked task is already provided below.',
  'First unchecked task: "{{task}}"',
  '',
  'Draft a concise analysis prompt for the next AI agent.',
  'Make the draft restate the task, name the likely files, list risks, and include verification steps and commit scope.',
  ...HANDOFF_VALIDATION_STEPS,
  'Do not edit plan.md. Do not implement code.',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
].join('\n');

const ANALYZE_PROMPT_BASE_LINES = [
  'Looparr ANALYZE step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'Execute this analysis prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'Draft an implementation prompt for the next fresh agent.',
  'Include exact files to change, concrete steps, tests, acceptance criteria, verification steps, and commit scope.',
  'The text you write to `.looparr/next_prompt.txt` is for the next IMPLEMENT agent.',
  'That prompt must direct the IMPLEMENT agent to make the code and documentation changes required by the task, run relevant checks and tests, and follow all project constraints.',
  'That prompt must tell the IMPLEMENT agent to change the "- [ ]" marker for this task to "- [x]" in plan.md only after implementation and verification are complete.'
];
const ANALYZE_PROMOTION_LINE = 'If this task changes the Looparr repository itself (it contains scripts/restart-looparr.js and scripts/promote.sh), the handoff must direct the IMPLEMENT agent to promote with `npm run restart:looparr -- --dry-run` then `npm run restart:looparr`, and must not use raw `docker compose build` or `docker compose up`: raw compose is killed with the agent cgroup between container create and start and leaves production down.';
const ANALYZE_PROMPT_TAIL_LINES = [
  'Never write meta-instructions into .looparr/next_prompt.txt.',
  'The validator rejects meta-instructions such as "do not implement code yet".',
  'Draft the implementation prompt before writing any handoff file.',
  ...HANDOFF_VALIDATION_STEPS,
  'Do not edit plan.md. Do not implement code.',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
];
const PREVIOUS_ANALYZE_PROMPT_TEMPLATE = [
  ...ANALYZE_PROMPT_BASE_LINES,
  ...ANALYZE_PROMPT_TAIL_LINES
].join('\n');
const DEFAULT_ANALYZE_PROMPT_TEMPLATE = [
  ...ANALYZE_PROMPT_BASE_LINES,
  ANALYZE_PROMOTION_LINE,
  ...ANALYZE_PROMPT_TAIL_LINES
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
  'When this task requires a Looparr production rebuild, promote with `npm run restart:looparr -- --dry-run` then `npm run restart:looparr`, and do not run raw `docker compose build` or `docker compose up`.',
  'After all implementation and verification steps pass, change the "- [ ]" marker for this task to "- [x]" in plan.md.',
  'The engine clears .looparr/next_prompt.txt when this task completes; do not edit or delete it yourself.',
  '',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.',
  'Git commit step (after implementation and verification):',
  '1. Run `git status --porcelain` and `git diff --name-only`. Consider only tracked modified files.',
  '2. Stage with explicit paths: `git add -- <path> ...`. Never use `git add -A`, `git add .`, or `git add -u` across the repository. Do not stage untracked files.',
  '3. Never stage `.env`, `.env.*`, `*.pem`, `*token*`, `*secret*`, `*password*`, or any credential, key, or certificate file.',
  '4. Read each candidate file. If its contents contain secrets, tokens, passwords, API keys, or credentials, skip it and report the skip.',
  '5. If no tracked modified file remains safe to stage, create no commit.',
  '6. Create one commit per task with a concise Conventional Commit message. Do not create a second commit for the same task.',
  '7. After all implementation and verification steps pass, change the "- [ ]" marker for this task to "- [x]" in plan.md and include that edit in this commit. `.looparr/next_prompt.txt` is engine-managed; do not stage it.'
].join('\n');

const PREVIOUS_IMPLEMENT_PROMPT_TEMPLATE = [
  'Looparr IMPLEMENT step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'If the handoff below tells you to only produce or write a prompt, or tells you not to implement, ignore that meta-instruction and implement the task.',
  'Execute this implementation prompt:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'After implementation, change the "- [ ]" marker for this task to "- [x]" in plan.md.',
  'The engine clears .looparr/next_prompt.txt when this task completes; do not edit or delete it yourself.',
  '',
  'Git commit step (after implementation and verification):',
  '1. Run `git status --porcelain` and `git diff --name-only`. Consider only tracked modified files.',
  '2. Stage with explicit paths: `git add -- <path> ...`. Never use `git add -A`, `git add .`, or `git add -u` across the repository. Do not stage untracked files.',
  '3. Never stage `.env`, `.env.*`, `*.pem`, `*token*`, `*secret*`, `*password*`, or any credential, key, or certificate file.',
  '4. Read each candidate file. If its contents contain secrets, tokens, passwords, API keys, or credentials, skip it and report the skip.',
  '5. If no tracked modified file remains safe to stage, create no commit.',
  '6. Create one commit per task with a concise Conventional Commit message. Do not create a second commit for the same task.',
  '7. Include the plan.md marker edit in that commit. `.looparr/next_prompt.txt` is engine-managed; do not stage it.'
].join('\n');

const OLDER_IMPLEMENT_PROMPT_TEMPLATE = [
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

const DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE = [
  'Looparr PLAN QUESTIONS step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  '',
  'You are gathering requirements, not implementing. Ask only the necessary clarifying questions for this task:',
  'ask only about anything ambiguous or missing that would change a mapped-out plan; never ask questions with obvious answers.',
  'The user will not reply in chat: they will append their answers to the same file you write.',
  '',
  'Write ONLY those questions to .looparr/next_prompt.txt (overwrite it; create .looparr/ if needed).',
  'Do not write any plan document. Do not write .project_documents/PLAN-*.md. Do not edit plan.md. Do not implement code.',
  'Do not add any meta-instructions to the questions.',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
].join('\\n');

const LEGACY_PLAN_QUESTIONS_PROMPT_TEMPLATE = DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE;

const DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE = [
  'Looparr PLAN WRITE step. Fresh session. Work only inside the current project directory.',
  'Task: "{{task}}"',
  'The clarifying questions and the user\'s answers follow:',
  '---',
  '{{handoff}}',
  '---',
  '',
  'Produce a fully mapped-out plan for this task from the questions and answers above:',
  '1. Write the mapped plan document to .project_documents/PLAN-<slug>.md (slug derived from the task text:',
  '   lowercase letters, digits and hyphens only). It must contain the design, a file map, ordered steps, tests,',
  '   acceptance criteria, and risks.',
  '2. In plan.md, replace the original "(plan)" task line with concrete generated checklist tasks (one "- [ ]" line each)',
  '   that implement this plan. The original "(plan)" line must not remain unchecked: replace it, remove it, or mark it done.',
  '3. Make the handoff a concise analysis prompt for the next phase: restate the task, name the likely files,',
  '   list risks, verification steps, and commit scope.',
  '4. Validate the analysis prompt before it reaches .looparr/next_prompt.txt:',
  ...HANDOFF_VALIDATION_STEPS,
  'Do not implement code.',
  'Keep output compact to protect the context budget: never echo file contents, logs, plan text, or diffs; report decisions and results only.'
].join('\\n');

const MODEL_PHASE_FIELDS = ['seedModel', 'analyzeModel', 'implementModel', 'planModel'];
const MODEL_SETTINGS_FIELDS = ['model', ...MODEL_PHASE_FIELDS];
const MODEL_FIELD_LABELS = {
  model: 'Model',
  seedModel: 'Seed model',
  analyzeModel: 'Analyze model',
  implementModel: 'Implement model',
  planModel: 'Plan model'
};

function modelFieldForPhase(phase) {
  if (phase === 'analyze') return 'analyzeModel';
  if (phase === 'implement') return 'implementModel';
  if (phase === 'planQuestions' || phase === 'planWrite') return 'planModel';
  return 'seedModel';
}

const MODEL_ROTATION_FIELDS = ['modelRotation', 'seedRotation', 'analyzeRotation', 'implementRotation', 'planRotation'];
const ROTATION_FIELD_BY_MODEL_FIELD = {
  model: 'modelRotation',
  seedModel: 'seedRotation',
  analyzeModel: 'analyzeRotation',
  implementModel: 'implementRotation',
  planModel: 'planRotation'
};

function rotationFieldForModelField(field) {
  return ROTATION_FIELD_BY_MODEL_FIELD[field] || 'modelRotation';
}

// Shared with server.js: the editable prompt-template settings, their labels,
// and the placeholders each one must keep. New entries need a DEFAULT_SETTINGS
// template and a textarea in public/index.html.
const PROMPT_TEMPLATE_FIELDS = [
  { field: 'seedPromptTemplate', label: 'Seed prompt template', placeholders: ['{{task}}'] },
  { field: 'analyzePromptTemplate', label: 'Analyze prompt template', placeholders: ['{{task}}', '{{handoff}}'] },
  { field: 'implementPromptTemplate', label: 'Implement prompt template', placeholders: ['{{task}}', '{{handoff}}'] },
  { field: 'planQuestionsPromptTemplate', label: 'Plan questions prompt template', placeholders: ['{{task}}'] },
  { field: 'planWritePromptTemplate', label: 'Plan write prompt template', placeholders: ['{{task}}', '{{handoff}}'] }
];

const DEFAULT_SETTINGS = {
  maxConcurrent: 2,
  mode: 'parallel',
  globalRunner: 'opencode',
  runnerRotation: false,
  model: DEFAULT_MODEL_IDS,
  seedModel: DEFAULT_MODEL_IDS,
  analyzeModel: DEFAULT_MODEL_IDS,
  implementModel: DEFAULT_MODEL_IDS,
  planModel: DEFAULT_PLAN_MODEL_IDS,
  modelRotation: false,
  seedRotation: false,
  analyzeRotation: false,
  implementRotation: false,
  planRotation: false,
  rateLimitPauseSeconds: 60,
  blockThreshold: 2,
  cooloffSeconds: 0,
  temporaryLiftScope: '',
  permanentLift: '',
  promptCliToolsNote: false,
  stickyAddTaskRow: false,
  paseoTransport: false,
  handoffRecovery: false,
  selfHealing: false,
  seedPromptTemplate: DEFAULT_SEED_PROMPT_TEMPLATE,
  analyzePromptTemplate: DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  implementPromptTemplate: DEFAULT_IMPLEMENT_PROMPT_TEMPLATE,
  planQuestionsPromptTemplate: DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE,
  planWritePromptTemplate: DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE
};

const LEGACY_PROMPT_TEMPLATES = {
  seedPromptTemplate: [
    LEGACY_SEED_PROMPT_TEMPLATE,
    LEGACY_STORED_SEED_PROMPT_TEMPLATE
  ],
  analyzePromptTemplate: [
    LEGACY_ANALYZE_PROMPT_TEMPLATE,
    LEGACY_DEFAULT_ANALYZE_PROMPT_TEMPLATE,
    LEGACY_STORED_ANALYZE_PROMPT_TEMPLATE,
    PREVIOUS_ANALYZE_PROMPT_TEMPLATE
  ],
  implementPromptTemplate: [
    LEGACY_IMPLEMENT_PROMPT_TEMPLATE
  ]
};

const LEGACY_PLAN_PROMPT_TEMPLATES = {
  planQuestionsPromptTemplate: [
    LEGACY_PLAN_QUESTIONS_PROMPT_TEMPLATE
  ],
  planWritePromptTemplate: [
    LEGACY_PLAN_WRITE_PROMPT_TEMPLATE
  ]
};

const CURRENT_PROMPT_TEMPLATES = {
  seedPromptTemplate: DEFAULT_SEED_PROMPT_TEMPLATE,
  analyzePromptTemplate: DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  implementPromptTemplate: DEFAULT_IMPLEMENT_PROMPT_TEMPLATE,
  planQuestionsPromptTemplate: DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE,
  planWritePromptTemplate: DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE
};

function normalizedBlockThreshold(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 20 ? number : fallback;
}

function normalizedCooloff(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(0, Math.min(3600, number));
}

function normalizedLiftScope(value, fallback) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, 2000);
}

function normalizedRotation(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizedModel(value, fallback, label = 'Model') {
  if (value === undefined || value === null || typeof value !== 'string') return fallback;
  try {
    return normalizeModelList(value, fallback, label);
  } catch {
    return fallback;
  }
}

function normalizedFreeModel(value, fallback, label = 'Model') {
  const withoutPaid = replaceKnownNonFreeModels(value, '');
  const withoutUnstable = replaceKnownUnstableModels(withoutPaid, DEFAULT_KILO_MODEL);
  return normalizedModel(withoutUnstable, fallback, label);
}

function normalizedRunner(value, fallback) {
  if (value === undefined || value === null) return fallback;
  try {
    return normalizeModelList(String(value), fallback, 'Runner');
  } catch {
    return fallback;
  }
}

// Sprint/phase config (R7): per-project only, no global defaults. sprintMode
// selects the scheduling flavor; the other four fields are direct inputs to
// the sprint scheduler and the end-of-sprint validation round.
const SPRINT_MODES = ['off', 'serial', 'parallel'];
const SPRINT_LIST_LIMIT = 50;

function normalizedSprintMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SPRINT_MODES.includes(mode) ? mode : 'off';
}

function normalizedSprintList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const sprints = [];
  for (const entry of value.slice(0, SPRINT_LIST_LIMIT)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : '';
    if (!name) continue;
    let id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim().slice(0, 80) : '';
    if (!id) id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || name.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    sprints.push({ id, name });
  }
  return sprints;
}

function normalizedSprintTestCommand(value) {
  if (typeof value !== 'string') return 'npm test';
  const command = value.trim();
  return command || 'npm test';
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object') return project;
  return {
    ...project,
    sprintMode: normalizedSprintMode(project.sprintMode),
    sprintsParallel: project.sprintsParallel === true,
    sprints: normalizedSprintList(project.sprints),
    sprintTestCommand: normalizedSprintTestCommand(project.sprintTestCommand),
    sprintDeployMain: project.sprintDeployMain === true,
    runner: normalizedRunner(project.runner, ''),
    runnerRotation: normalizedRotation(project.runnerRotation),
    model: normalizedFreeModel(project.model, '', MODEL_FIELD_LABELS.model),
    seedModel: normalizedFreeModel(project.seedModel, '', MODEL_FIELD_LABELS.seedModel),
    analyzeModel: normalizedFreeModel(project.analyzeModel, '', MODEL_FIELD_LABELS.analyzeModel),
    implementModel: normalizedFreeModel(project.implementModel, '', MODEL_FIELD_LABELS.implementModel),
    planModel: normalizedFreeModel(project.planModel, '', MODEL_FIELD_LABELS.planModel),
    modelRotation: normalizedRotation(project.modelRotation),
    seedRotation: normalizedRotation(project.seedRotation),
    analyzeRotation: normalizedRotation(project.analyzeRotation),
    implementRotation: normalizedRotation(project.implementRotation),
    planRotation: normalizedRotation(project.planRotation),
    blockThreshold: normalizedBlockThreshold(project.blockThreshold, null),
    cooloffSeconds: normalizedCooloff(project.cooloffSeconds, null),
    temporaryLiftScope: normalizedLiftScope(project.temporaryLiftScope, ''),
    permanentLift: normalizedLiftScope(project.permanentLift, ''),
    autoResumeOnStart: typeof project.autoResumeOnStart === 'boolean' ? project.autoResumeOnStart : false
  };
}

// Deployed configs can carry an absolute validator path from an earlier
// default. Compare legacy templates with the path normalized so those saved
// defaults still upgrade; the stored value itself is never rewritten.
function matchesLegacyTemplate(legacyValues, value) {
  if (typeof value !== 'string') return false;
  const normalizePath = (text) => text.replace(/"[^"\n]*validate-handoff\.js"/g, HANDOFF_VALIDATOR_PATH);
  const target = normalizePath(value);
  return legacyValues.some((legacy) => normalizePath(legacy) === target);
}

function normalizeSettings(settings) {
  const normalized = { ...(settings || {}) };
  for (const field of MODEL_SETTINGS_FIELDS) {
    const fallback = Object.prototype.hasOwnProperty.call(normalized, field) && typeof normalized[field] === 'string'
      ? ''
      : DEFAULT_SETTINGS[field];
    normalized[field] = normalizedFreeModel(normalized[field], fallback, MODEL_FIELD_LABELS[field]);
  }
  normalized.promptCliToolsNote = normalized.promptCliToolsNote === true;
  normalized.stickyAddTaskRow = normalized.stickyAddTaskRow === true;
  normalized.paseoTransport = normalized.paseoTransport === true;
  normalized.handoffRecovery = normalized.handoffRecovery === true;
  normalized.selfHealing = normalized.selfHealing === true;
  normalized.runnerRotation = normalized.runnerRotation === true;
  normalized.globalRunner = normalizedRunner(normalized.globalRunner, DEFAULT_SETTINGS.globalRunner);
  for (const field of MODEL_ROTATION_FIELDS) {
    normalized[field] = normalized[field] === true;
  }
  normalized.cooloffSeconds = normalizedCooloff(normalized.cooloffSeconds, DEFAULT_SETTINGS.cooloffSeconds);
  for (const [field, legacyValues] of Object.entries(LEGACY_PROMPT_TEMPLATES)) {
    if (matchesLegacyTemplate(legacyValues, normalized[field])) normalized[field] = CURRENT_PROMPT_TEMPLATES[field];
  }
  for (const [field, legacyValues] of Object.entries(LEGACY_PLAN_PROMPT_TEMPLATES)) {
    if (legacyValues.includes(normalized[field])) normalized[field] = CURRENT_PROMPT_TEMPLATES[field];
  }
  if (
    normalized.implementPromptTemplate === PREVIOUS_IMPLEMENT_PROMPT_TEMPLATE
    || normalized.implementPromptTemplate === OLDER_IMPLEMENT_PROMPT_TEMPLATE
  ) {
    normalized.implementPromptTemplate = DEFAULT_IMPLEMENT_PROMPT_TEMPLATE;
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

function resolveCooloff(project, settings) {
  const globalSettings = settings || {};
  const normalized = normalizeProject(project) || {};
  const globalCooloff = normalizedCooloff(globalSettings.cooloffSeconds, DEFAULT_SETTINGS.cooloffSeconds);
  return normalized.cooloffSeconds ?? globalCooloff ?? DEFAULT_SETTINGS.cooloffSeconds;
}

function resolveRotation(project, settings, modelField = 'model') {
  const field = rotationFieldForModelField(modelField);
  const normalized = normalizeProject(project) || {};
  if (typeof normalized[field] === 'boolean') return normalized[field];
  const globalSettings = settings || {};
  return globalSettings[field] === true;
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
  SPRINT_MODES,
  DEFAULT_SEED_PROMPT_TEMPLATE,
  DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  PREVIOUS_ANALYZE_PROMPT_TEMPLATE,
  DEFAULT_IMPLEMENT_PROMPT_TEMPLATE,
  PREVIOUS_IMPLEMENT_PROMPT_TEMPLATE,
  OLDER_IMPLEMENT_PROMPT_TEMPLATE,
  LEGACY_SEED_PROMPT_TEMPLATE,
  LEGACY_ANALYZE_PROMPT_TEMPLATE,
  LEGACY_IMPLEMENT_PROMPT_TEMPLATE,
  LEGACY_STORED_SEED_PROMPT_TEMPLATE,
  LEGACY_STORED_ANALYZE_PROMPT_TEMPLATE,
  LEGACY_DEFAULT_ANALYZE_PROMPT_TEMPLATE,
  LEGACY_PLAN_QUESTIONS_PROMPT_TEMPLATE,
  LEGACY_PLAN_WRITE_PROMPT_TEMPLATE,
  LEGACY_PROMPT_TEMPLATES,
  LEGACY_PLAN_PROMPT_TEMPLATES,
  CURRENT_PROMPT_TEMPLATES,
  PROMPT_TEMPLATE_FIELDS,
  DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE,
  DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE,
  MODEL_PHASE_FIELDS,
  MODEL_ROTATION_FIELDS,
  modelFieldForPhase,
  rotationFieldForModelField,
  resolveRotation,
  defaults,
  loadConfig,
  saveConfig,
  normalizedModel,
  normalizeProject,
  normalizeSettings,
  normalizedSprintMode,
  normalizedSprintList,
  normalizedSprintTestCommand,
  resolveBlockPolicy,
  resolveCooloff
};
