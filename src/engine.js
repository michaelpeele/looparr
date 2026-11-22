'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const configStore = require('./config');
const autoResume = require('./auto-resume');
const bus = require('./events');
const planLib = require('./plan');
const iconLib = require('./icon');
const { getRunner, listRunners } = require('./runners');
const { modelList, joinModelList } = require('./model-list');

const config = configStore.loadConfig();
const runtime = new Map();
const watchers = new Map();
const LOG_LIMIT = 400;
const CHECKPOINT_INTERVAL_MS = 30_000;
let logSeq = 0;
let tickTimer = null;
let roundRobinCursor = 0;
let lastCheckpointAt = 0;

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function iconVersionFor(icon) {
  if (!icon || !icon.absolutePath) return null;
  try {
    const bytes = fs.readFileSync(icon.absolutePath);
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  } catch {
    try {
      const stat = fs.statSync(icon.absolutePath);
      return `mtime-${stat.mtimeMs}-${stat.size}`;
    } catch {
      return null;
    }
  }
}

function applyRuntimeIcon(rt, found) {
  rt.icon = found ? { ...found, version: iconVersionFor(found) } : null;
  rt.iconVersion = rt.icon ? rt.icon.version : null;
}

function ensureRuntime(project) {
  let rt = runtime.get(project.id);
  if (!rt) {
    rt = {
      id: project.id,
      status: 'idle',
      active: false,
      paused: false,
      pauseAfterStep: false,
      currentTask: '',
      nextPhase: 'seed',
      resumeAt: null,
      error: '',
      logs: [],
      child: null,
      starting: false,
      token: 0,
      modelIndex: 0,
      modelAttemptRunKey: '',
      stepTask: null,
      stepOutput: '',
      icon: null,
      iconVersion: null
    };
    runtime.set(project.id, rt);
    applyRuntimeIcon(rt, iconLib.findIcon(project.path));
  }
  return rt;
}

function findProject(id) {
  return config.projects.find((project) => project.id === id) || null;
}

function effectiveModelList(project, phase = 'seed') {
  const field = configStore.modelFieldForPhase(phase);
  const selected = project[field] || project.model || config.settings[field] || config.settings.model || '';
  return modelList(selected);
}

function effectiveModel(project, phase = 'seed') {
  return effectiveModelList(project, phase)[0] || '';
}

function blockPolicyFor(project) {
  const normalized = configStore.normalizeProject(project);
  return {
    ...configStore.resolveBlockPolicy(normalized, config.settings),
    overrides: {
      blockThreshold: normalized.blockThreshold ?? null,
      temporaryLiftScope: normalized.temporaryLiftScope || '',
      permanentLift: normalized.permanentLift || ''
    }
  };
}

function appendLog(projectId, stream, text) {
  const rt = runtime.get(projectId);
  if (!rt) return;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = { seq: ++logSeq, ts: Date.now(), stream, text: line };
    rt.logs.push(entry);
    if (rt.logs.length > LOG_LIMIT) rt.logs.splice(0, rt.logs.length - LOG_LIMIT);
    bus.emit('log', { projectId, ...entry });
  }
}

function emitState() {
  bus.emit('state', getState());
}

function getState() {
  return {
    settings: { ...config.settings },
    runners: listRunners(),
    projects: config.projects.map((project) => {
      const rt = ensureRuntime(project);
      const plan = planLib.readPlan(project.path);
      const status = plan.ok ? rt.status : 'error';
      let currentIndex = -1;
      if (rt.stepTask && typeof rt.stepTask.index === 'number') {
        const active = plan.tasks.find((task) => task.index === rt.stepTask.index);
        if (active && !active.checked) currentIndex = rt.stepTask.index;
      } else if (rt.currentTask) {
        const active = plan.tasks.find((task) => task.text === rt.currentTask && !task.checked);
        if (active) currentIndex = active.index;
      }
      const next = currentIndex >= 0
        ? planLib.nextUncheckedAfter(plan.tasks, currentIndex)
        : plan.next;
      const nextTask = next ? next.text : '';
      const dependencyStatus = plan.dependencyStatus || {
        ok: true, error: '', issues: [], cycles: [], tasks: []
      };
      const dependencyViews = dependencyStatus.tasks || [];
      const currentDependency = currentIndex >= 0 ? (dependencyViews[currentIndex] || null) : null;
      const nextDependency = next ? (dependencyViews[next.index] || null) : null;
      const dependencyWarning = currentDependency?.reason || nextDependency?.reason || '';
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        runner: project.runner || config.settings.globalRunner,
        model: project.model || '',
        seedModel: project.seedModel || '',
        analyzeModel: project.analyzeModel || '',
        implementModel: project.implementModel || '',
        effectiveModel: effectiveModel(project),
        effectiveModels: {
          seed: effectiveModel(project, 'seed'),
          analyze: effectiveModel(project, 'analyze'),
          implement: effectiveModel(project, 'implement')
        },
        effectiveModelLists: {
          model: joinModelList(modelList(project.model || config.settings.model || '')),
          seed: joinModelList(effectiveModelList(project, 'seed')),
          analyze: joinModelList(effectiveModelList(project, 'analyze')),
          implement: joinModelList(effectiveModelList(project, 'implement'))
        },
        blockPolicy: blockPolicyFor(project),
        status,
        nextPhase: rt.nextPhase || 'seed',
        active: rt.active,
        paused: rt.paused,
        pauseRequested: rt.pauseAfterStep,
        currentTask: rt.currentTask || '',
        nextTask,
        nextTaskIndex: next ? next.index : -1,
        dependencyStatus: {
          ok: dependencyStatus.ok !== false,
          error: dependencyStatus.error || '',
          current: currentDependency,
          next: nextDependency
        },
        dependencyError: dependencyStatus.error || '',
        dependencyWarning,
        progress: plan.stats,
        icon: rt.icon ? rt.icon.relativePath : null,
        iconVersion: rt.iconVersion || null,
        resumeAt: rt.resumeAt,
        autoResumeOnStart: project.autoResumeOnStart === true,
        autoResumePending: fs.existsSync(autoResume.statePath(project)),
        error: rt.error || (plan.ok ? '' : `plan.md: ${plan.error}`),
        logs: rt.logs.slice(-200)
      };
    })
  };
}

function watchProject(project) {
  if (watchers.has(project.id)) return;
  const ignored = (candidate) => /(^|\/)(\.git|node_modules|\.looparr|looparr-tailscale-data)($|\/)/.test(String(candidate));
  const watcher = chokidar.watch(project.path, {
    ignored,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    depth: 4
  });
  watcher.on('error', (error) => {
    appendLog(project.id, 'system', `Watch error: ${error.message}`);
  });
  watcher.on('all', (event, filePath) => {
    const relative = path.relative(project.path, filePath).split(path.sep).join('/');
    if (relative === 'plan.md') {
      reconcileExternalPlan(project);
      emitState();
      return;
    }
    refreshIcon(project.id);
  });
  watchers.set(project.id, watcher);
}

function refreshIcon(id) {
  const project = findProject(id);
  if (!project) return false;
  const rt = ensureRuntime(project);
  const beforePath = rt.icon ? rt.icon.relativePath : null;
  const beforeVersion = rt.iconVersion || null;
  applyRuntimeIcon(rt, iconLib.findIcon(project.path));
  const afterPath = rt.icon ? rt.icon.relativePath : null;
  const afterVersion = rt.iconVersion || null;
  if (beforePath !== afterPath) {
    appendLog(id, 'system', `Icon detected: ${afterPath}`);
    emitState();
    return true;
  }
  if (beforeVersion !== afterVersion) {
    appendLog(id, 'system', `Icon updated: ${afterPath}`);
    emitState();
    return true;
  }
  return false;
}

function save() {
  configStore.saveConfig(config);
}

function addProject(input) {
  const project = configStore.normalizeProject({
    id: newId(),
    name: input.name,
    path: input.path,
    runner: input.runner || config.settings.globalRunner,
    model: configStore.normalizedModel(input.model, ''),
    seedModel: configStore.normalizedModel(input.seedModel, ''),
    analyzeModel: configStore.normalizedModel(input.analyzeModel, ''),
    implementModel: configStore.normalizedModel(input.implementModel, ''),
    blockThreshold: input.blockThreshold ?? null,
    temporaryLiftScope: input.temporaryLiftScope || '',
    permanentLift: input.permanentLift || '',
    autoResumeOnStart: input.autoResumeOnStart
  });
  config.projects.push(project);
  save();
  ensureRuntime(project);
  watchProject(project);
  emitState();
  return project;
}

function removeProject(id) {
  const project = findProject(id);
  if (!project) return false;
  stop(id);
  const watcher = watchers.get(id);
  if (watcher) { watcher.close(); watchers.delete(id); }
  config.projects = config.projects.filter((candidate) => candidate.id !== id);
  runtime.delete(id);
  save();
  emitState();
  return true;
}

function updateSettings(patch) {
  config.settings = { ...config.settings, ...patch };
  save();
  emitState();
  return config.settings;
}

function updateProject(id, patch) {
  const index = config.projects.findIndex((project) => project.id === id);
  if (index < 0) return null;
  const project = configStore.normalizeProject({ ...config.projects[index], ...patch });
  config.projects[index] = project;
  save();
  emitState();
  return project;
}

function getPlan(id) {
  const project = findProject(id);
  if (!project) return null;
  return planLib.readPlan(project.path);
}

function normalizedPlanChangeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').trim() : '';
}

function normalizePlanChange(change) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const index = Number(change.index);
  if (!Number.isInteger(index) || index < 0) return null;
  if (typeof change.oldText !== 'string') return null;
  const oldText = normalizedPlanChangeText(change.oldText);
  if (change.type === 'edit') {
    if (typeof change.newText !== 'string') return null;
    const newText = normalizedPlanChangeText(change.newText);
    if (!newText) return null;
    return { type: 'edit', index, oldText, newText };
  }
  if (change.type === 'remove') return { type: 'remove', index, oldText };
  return null;
}

function reconcilePlanChange(project, change) {
  const valid = normalizePlanChange(change);
  if (!valid) return;
  const rt = ensureRuntime(project);
  const plan = planLib.readPlan(project.path);
  if (!plan.ok) return;
  if (valid.type === 'edit') {
    const task = plan.tasks[valid.index];
    if (!task) return;
    if (rt.stepTask && Number(rt.stepTask.index) === valid.index) rt.stepTask.text = valid.newText;
    if (valid.oldText && (rt.currentTask === valid.oldText || normalizedPlanChangeText(rt.currentTask) === valid.oldText)) rt.currentTask = task.text;
    return;
  }
  if (rt.stepTask && Number(rt.stepTask.index) === valid.index) {
    rt.stepTask = null;
    rt.currentTask = '';
    rt.nextPhase = 'seed';
  } else if (rt.stepTask && Number(rt.stepTask.index) > valid.index) {
    rt.stepTask.index -= 1;
  }
  if (!rt.currentTask || !plan.tasks.some((task) => task.text === rt.currentTask)) {
    rt.currentTask = '';
    if (!rt.stepTask) rt.nextPhase = 'seed';
  }
}

function writePlan(id, content, change) {
  const project = findProject(id);
  if (!project) return false;
  let planChange = null;
  try { planChange = normalizePlanChange(change); } catch { /* ignore malformed change */ }
  planLib.writePlan(project.path, content);
  try { reconcilePlanChange(project, planChange); } catch { /* ignore reconciliation failures */ }
  emitState();
  return true;
}

function setTaskChecked(id, index, checked) {
  const project = findProject(id);
  if (!project) return { ok: false, error: 'Project not found' };
  const current = planLib.readPlan(project.path);
  if (!current.ok) return { ok: false, error: current.error };
  const result = planLib.setChecked(current.content, Number(index), Boolean(checked));
  if (!result.ok) return result;
  planLib.writePlan(project.path, result.content);
  emitState();
  return { ok: true };
}

function getIcon(id) {
  const project = findProject(id);
  if (!project) return null;
  return ensureRuntime(project).icon;
}

function answerPath(project) {
  return path.join(project.path, '.looparr', 'next_prompt.txt');
}

function clearHandoff(project) {
  try {
    fs.unlinkSync(answerPath(project));
    return true;
  } catch (error) {
    return error && error.code === 'ENOENT';
  }
}

function clearCheckpointIntent(project) {
  const checked = autoResume.readIntent(project);
  if (!checked.ok || checked.intent.reason !== 'checkpoint') return false;
  return autoResume.clearIntent(project);
}

function writeCheckpointIntent(project, rt) {
  if (project.autoResumeOnStart !== true) return false;
  if (!autoResume.shouldCaptureResumeIntent()) return false;
  if (!rt || !rt.active || rt.paused || !rt.currentTask) return false;
  if (rt.status === 'done' || rt.status === 'error') return false;
  if (autoResume.hasIntent(project)) return false;
  const written = autoResume.writeIntent(project, {
    reason: 'checkpoint',
    nextPhase: autoResume.PHASES.has(rt.nextPhase) ? rt.nextPhase : 'seed',
    status: rt.status,
    currentTask: rt.currentTask,
    resumeAt: rt.resumeAt,
    pid: process.pid,
    hostname: process.env.HOSTNAME || ''
  });
  return written.ok;
}

function reconcileExternalPlan(project) {
  const rt = ensureRuntime(project);
  const plan = planLib.readPlan(project.path);
  if (!plan.ok) return;
  const stillCurrent = Boolean(
    rt.currentTask && plan.tasks.some((task) => !task.checked && task.text === rt.currentTask)
  );
  if (stillCurrent) return;
  rt.currentTask = '';
  rt.stepTask = null;
  rt.nextPhase = 'seed';
  clearCheckpointIntent(project);
  clearHandoff(project);
}

function hasHandoff(project) {
  try {
    return Boolean(fs.readFileSync(answerPath(project), 'utf8').trim());
  } catch {
    return false;
  }
}

function shouldReseedOnStart(rt, hasHandoffFile) {
  return Boolean(
    rt &&
    rt.status === 'error' &&
    (rt.nextPhase === 'analyze' || rt.nextPhase === 'implement') &&
    !hasHandoffFile
  );
}

function getAnswer(id) {
  const project = findProject(id);
  if (!project) return null;
  const file = answerPath(project);
  if (!iconLib.isInside(project.path, file)) return { ok: false, error: 'Invalid answer path' };
  try {
    const content = fs.readFileSync(file, 'utf8');
    return { ok: true, exists: true, content };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, exists: false, content: '' };
    return { ok: false, error: error.message };
  }
}

function writeAnswer(id, content) {
  const project = findProject(id);
  if (!project) return { ok: false, error: 'Project not found' };
  if (typeof content !== 'string') return { ok: false, error: 'content must be a string' };
  if (content.length > 200000) return { ok: false, error: 'content is too long' };
  const file = answerPath(project);
  if (!iconLib.isInside(project.path, file)) return { ok: false, error: 'Invalid answer path' };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
    return { ok: true, exists: true, content };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function maxWorkers() {
  const value = Number(config.settings.maxConcurrent);
  if (!Number.isFinite(value) || value <= 0) return Infinity;
  return Math.max(1, Math.floor(value));
}

function start(id) {
  const project = findProject(id);
  if (!project) return false;
  const rt = ensureRuntime(project);
  if (rt.status === 'rateLimited' && rt.resumeAt && Date.now() < rt.resumeAt) return true;
  if (rt.status === 'done') {
    const plan = planLib.readPlan(project.path);
    if (plan.ok && !plan.next) return true;
    rt.nextPhase = 'seed';
  }
  if (shouldReseedOnStart(rt, hasHandoff(project))) {
    rt.nextPhase = 'seed';
    appendLog(project.id, 'system', '↻ Reseed — missing .looparr/next_prompt.txt after error.');
  }
  rt.active = true;
  rt.paused = false;
  rt.pauseAfterStep = false;
  rt.resumeAt = null;
  rt.error = '';
  rt.currentTask = rt.currentTask || '';
  if (!rt.child) rt.status = 'idle';
  emitState();
  scheduleTick();
  return true;
}

function pause(id) {
  const project = findProject(id);
  if (!project) return false;
  const rt = ensureRuntime(project);
  rt.paused = true;
  rt.pauseAfterStep = Boolean(rt.child);
  rt.status = 'paused';
  emitState();
  return true;
}

function stop(id) {
  const project = findProject(id);
  if (!project) return false;
  const rt = ensureRuntime(project);
  const stoppedTask = rt.currentTask || '';
  rt.token += 1;
  if (rt.child) {
    try { rt.child.kill('SIGTERM'); } catch { /* already gone */ }
    rt.child = null;
  }
  rt.active = false;
  rt.paused = false;
  rt.pauseAfterStep = false;
  rt.resumeAt = null;
  rt.status = 'idle';
  rt.currentTask = '';
  rt.error = '';
  rt.nextPhase = 'seed';
  rt.stepTask = null;
  if (fs.existsSync(autoResume.statePath(project))) {
    autoResume.clearIntent(project);
    autoResume.appendAudit(project, 'resume-cancelled', {
      task: stoppedTask,
      reason: 'planned-restart'
    });
  }
  emitState();
  scheduleTick();
  return true;
}

function renderPrompt(settingKey, values) {
  const configured = config.settings[settingKey];
  const template = typeof configured === 'string' && configured.trim()
    ? configured
    : configStore.DEFAULT_SETTINGS[settingKey];
  return template
    .replace(/{{task}}/g, () => String(values.task ?? ''))
    .replace(/{{handoff}}/g, () => String(values.handoff ?? ''));
}

const META_HANDOFF_PATTERNS = [
  { reason: 'do not implement code yet', pattern: /\bdo\s+not\s+implement\s+code\s+yet\b/i },
  { reason: 'do not implement code', pattern: /\bdo\s+not\s+implement\s+(?:any\s+)?code\b/i },
  { reason: 'do not implement', pattern: /\bdo\s+not\s+implement\b/i },
  { reason: 'stop before coding', pattern: /\bstop\s+before\s+coding\b/i },
  { reason: 'produce the prompt only', pattern: /\bproduce\s+(?:the\s+)?prompt\s+only\b/i },
  { reason: 'write only prompt', pattern: /\bwrite\s+only\s+(?:a|the)\s+(?:implementation\s+)?prompt\b/i },
  { reason: 'write a detailed implementation prompt', pattern: /\b(?:write|produce|create|generate)\s+(?:a\s+)?detailed\s+implementation\s+prompt\b/i },
  { reason: 'implementation prompt for next agent', pattern: /\b(?:write|produce|create|generate)\s+(?:a\s+)?(?:detailed\s+)?implementation\s+prompt\s+for\s+the\s+next\s+(?:fresh\s+)?(?:ai\s+)?agent\b/i }
];

function isMetaPromptHandoff(text) {
  const content = String(text ?? '');
  for (const entry of META_HANDOFF_PATTERNS) {
    if (entry.pattern.test(content)) return { poisoned: true, reason: entry.reason };
  }
  return { poisoned: false };
}

const CLI_TOOLS_NOTE = 'Note: required CLI tools may be installed during this task. If a needed command is missing, install it (prefer the project\'s documented package manager) before continuing.';

function promptPreamble() {
  return config.settings.promptCliToolsNote === true ? CLI_TOOLS_NOTE : '';
}

function shortCommand(command, args) {
  const preview = args.map((arg) => (arg.length > 90 ? `${arg.slice(0, 90)}…` : arg));
  return `$ ${command} ${preview.join(' ')}`;
}

function rateLimitPauseMs() {
  const pauseSeconds = Math.max(5, Math.min(600, Number(config.settings.rateLimitPauseSeconds) || 60));
  return pauseSeconds * 1000;
}

function rateLimitRetry(project, rt, pauseMs) {
  appendLog(project.id, 'system', `Provider backoff engaged. Retrying in ${Math.round(pauseMs / 1000)}s.`);
  setTimeout(() => {
    if (runtime.get(project.id) !== rt || !rt.resumeAt) return;
    if (Date.now() < rt.resumeAt) return;
    rt.resumeAt = null;
    if (rt.active && !rt.paused) rt.status = 'idle';
    emitState();
    scheduleTick();
  }, pauseMs + 200);
}

function scheduleModelFallback(project, rt, runner, phase, models) {
  if (!runner || !runner.isRateLimit || !runner.isRateLimit(rt.stepOutput)) return false;
  if (rt.modelIndex + 1 >= models.length) return false;
  const currentModel = models[rt.modelIndex] || 'OpenCode default';
  const nextModel = models[rt.modelIndex + 1] || 'OpenCode default';
  const pauseMs = rateLimitPauseMs();
  appendLog(project.id, 'system', `Rate limited on ${currentModel}; retrying with ${nextModel}.`);
  rt.modelIndex += 1;
  rt.status = 'rateLimited';
  rt.resumeAt = Date.now() + pauseMs;
  rt.nextPhase = phase;
  rt.stepOutput = '';
  rateLimitRetry(project, rt, pauseMs);
  emitState();
  return true;
}

async function spawnRunnerAttempt(project, rt, runner, options) {
  const { prompt, url, files, model, runKey, phase, task, models } = options;
  const built = runner.buildCommand({
    prompt,
    cwd: project.path,
    url,
    files,
    model,
    runKey,
    projectId: project.id,
    phase,
    task
  });
  try {
    await runner.cancelStaleRuns?.({ projectId: project.id, cwd: project.path, keepRunKey: runKey });
  } catch (error) {
    appendLog(project.id, 'system', `Stale run cancellation failed: ${error.message}`);
  }
  const child = spawn(built.command, built.args, built.options);
  rt.child = child;
  rt.token += 1;
  const token = rt.token;
  appendLog(project.id, 'system', shortCommand(built.command, built.args));

  if (child.stdout) child.stdout.on('data', (chunk) => {
    if (rt.token !== token) return;
    rt.stepOutput += String(chunk);
    appendLog(project.id, 'out', chunk);
  });
  if (child.stderr) child.stderr.on('data', (chunk) => {
    if (rt.token !== token) return;
    rt.stepOutput += String(chunk);
    appendLog(project.id, 'err', chunk);
  });
  child.on('error', (error) => {
    if (rt.token !== token) return;
    rt.child = null;
    rt.status = 'error';
    rt.active = false;
    rt.error = error.message;
    appendLog(project.id, 'system', `✖ ${error.message}`);
    emitState();
    scheduleTick();
  });
  child.on('close', (code) => {
    if (rt.token !== token) return;
    rt.child = null;
    if (scheduleModelFallback(project, rt, runner, phase, models)) return;
    handleClose(project, rt, code, task, phase, runner);
  });
}

function handleClose(project, rt, code, task, phase, runner) {
  try {
    const pauseMs = rateLimitPauseMs();
    if (runner && runner.isRateLimit && runner.isRateLimit(rt.stepOutput)) {
      rt.status = 'rateLimited';
      rt.resumeAt = Date.now() + pauseMs;
      rt.nextPhase = phase;
      rateLimitRetry(project, rt, pauseMs);
      emitState();
      return;
    }
    if (code !== 0) {
      rt.status = 'error';
      rt.active = false;
      rt.error = `${phase} step exited with code ${code}`;
      appendLog(project.id, 'system', `✖ ${rt.error}`);
      emitState();
      return;
    }

    const promptFile = path.join(project.path, '.looparr', 'next_prompt.txt');
    if (phase === 'seed' || phase === 'analyze') {
      let handoff = '';
      try { handoff = fs.readFileSync(promptFile, 'utf8').trim(); } catch { /* missing */ }
      if (!handoff) throw new Error(`${phase} step did not write .looparr/next_prompt.txt`);
      const metaCheck = isMetaPromptHandoff(handoff);
      if (phase === 'analyze' && metaCheck.poisoned) {
        rt.nextPhase = 'analyze';
        rt.status = 'error';
        rt.active = false;
        rt.error = `Analyze handoff rejected (${metaCheck.reason}); meta-instruction handoffs cannot advance to Implement. Re-run Analyze with a real implementation prompt.`;
        appendLog(project.id, 'system', '✖ Analyze produced meta-prompt handoff; retrying analyze.');
        emitState();
        return;
      }
      rt.nextPhase = phase === 'seed' ? 'analyze' : 'implement';
    } else {
      const current = planLib.readPlan(project.path);
      if (!current.ok) throw new Error(`plan.md disappeared: ${current.error}`);
      const updated = planLib.markTask(current.content, task.text, true);
      if (updated.ok && updated.changed) planLib.writePlan(project.path, updated.content);
      clearCheckpointIntent(project);
      clearHandoff(project);
      appendLog(project.id, 'system', `✓ Done: ${task.text}`);
      rt.nextPhase = 'seed';
    }

    if (rt.paused) {
      rt.status = 'paused';
      rt.pauseAfterStep = false;
    } else {
      rt.status = 'idle';
    }
    rt.currentTask = '';
    rt.stepTask = null;
    emitState();
    scheduleTick();
  } catch (error) {
    rt.status = 'error';
    rt.active = false;
    rt.error = error.message;
    appendLog(project.id, 'system', `✖ ${error.message}`);
    emitState();
  }
}

async function startStep(project) {
  const rt = ensureRuntime(project);
  if (rt.child || rt.starting || !rt.active || rt.paused) return;
  rt.starting = true;
  let runner;
  try {
    const plan = planLib.readPlan(project.path);
    if (!plan.ok) throw new Error(`Cannot read plan.md: ${plan.error}`);
    const task = plan.next;
    if (!task) {
      rt.status = 'done';
      rt.active = false;
      rt.currentTask = '';
      clearCheckpointIntent(project);
      appendLog(project.id, 'system', 'All tasks complete.');
      emitState();
      return;
    }
    const dependencyStatus = plan.dependencyStatus;
    if (dependencyStatus && !dependencyStatus.ok) {
      throw new Error(`Cannot start plan: ${dependencyStatus.error}`);
    }
    const taskDependency = dependencyStatus?.tasks?.[task.index];
    if (taskDependency?.blocked) {
      throw new Error(`Cannot start task ${task.index + 1}: ${taskDependency.reason}`);
    }
    const phase = rt.nextPhase || 'seed';
    const runKey = runKeyFor(project, phase, task.text);
    runner = getRunner(project.runner) || getRunner(config.settings.globalRunner) || getRunner('opencode');
    if (!runner) throw new Error(`Runner "${project.runner || config.settings.globalRunner}" is not registered`);

    const loopDir = path.join(project.path, '.looparr');
    fs.mkdirSync(loopDir, { recursive: true });
    const promptFile = path.join(loopDir, 'next_prompt.txt');
    let prompt;
    let files = [];
    if (phase === 'seed') {
      prompt = renderPrompt('seedPromptTemplate', { task: task.text });
      files = [plan.planPath];
      try { fs.unlinkSync(promptFile); } catch { /* no stale handoff */ }
    } else {
      let handoff = '';
      try { handoff = fs.readFileSync(promptFile, 'utf8').trim(); } catch { /* missing */ }
      if (!handoff) throw new Error(`No .looparr/next_prompt.txt for ${phase} step`);
      if (phase === 'implement') {
        const metaCheck = isMetaPromptHandoff(handoff);
        if (metaCheck.poisoned) {
          rt.nextPhase = 'analyze';
          rt.status = 'error';
          rt.active = false;
          rt.error = `Stale meta-prompt handoff rejected before Implement (${metaCheck.reason}); re-run Analyze with a real implementation prompt.`;
          appendLog(project.id, 'system', '✖ Stale meta-prompt handoff; retrying analyze.');
          emitState();
          return;
        }
      }
      prompt = renderPrompt(
        phase === 'analyze' ? 'analyzePromptTemplate' : 'implementPromptTemplate',
        { task: task.text, handoff }
      );
    }

    const preamble = promptPreamble();
    // Future: append enabled promptSnippets here (see .project_documents/RESEARCH-prompt-snippets.md).
    if (preamble) prompt = `${preamble}\n\n${prompt}`;

    rt.status = phase;
    rt.currentTask = task.text;
    rt.stepTask = task;
    rt.stepOutput = '';
    rt.resumeAt = null;
    writeCheckpointIntent(project, rt);
    appendLog(project.id, 'system', `▶ ${phase.toUpperCase()} — ${task.text}`);
    emitState();

    const url = runner.ensureServer ? await runner.ensureServer() : null;
    const models = effectiveModelList(project, phase);
    if (rt.modelAttemptRunKey !== runKey) {
      rt.modelAttemptRunKey = runKey;
      rt.modelIndex = 0;
    } else if (rt.modelIndex >= models.length) {
      rt.modelIndex = 0;
    }
    const model = models[rt.modelIndex] || '';
    const fallbackNote = models.length > 1 ? ` (fallback ${rt.modelIndex + 1}/${models.length})` : '';
    appendLog(project.id, 'system', `Model: ${model || 'OpenCode default'}${fallbackNote}`);
    await spawnRunnerAttempt(project, rt, runner, {
      prompt,
      url,
      files,
      model,
      runKey,
      phase,
      task,
      models
    });
  } catch (error) {
    rt.status = 'error';
    rt.active = false;
    rt.error = error.message;
    appendLog(project.id, 'system', `✖ ${error.message}`);
    emitState();
  } finally {
    rt.starting = false;
    scheduleTick();
  }
}

function scheduleTick() {
  if (scheduleTick.pending) return;
  scheduleTick.pending = true;
  setImmediate(() => {
    scheduleTick.pending = false;
    tick();
  });
}

function eligibleProjects() {
  return config.projects.filter((project) => {
    const rt = ensureRuntime(project);
    return rt.active && !rt.paused && !rt.child && !rt.starting && !rt.resumeAt && rt.status !== 'done' && rt.status !== 'error';
  });
}

function tick() {
  const limit = maxWorkers();
  let running = 0;
  for (const project of config.projects) {
    const rt = ensureRuntime(project);
    if (rt.child) running += 1;
    if (rt.resumeAt && rt.active && !rt.paused && Date.now() >= rt.resumeAt) {
      rt.resumeAt = null;
      if (rt.status === 'rateLimited') rt.status = 'idle';
      emitState();
    }
  }
  const now = Date.now();
  if (now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
    lastCheckpointAt = now;
    for (const project of config.projects) writeCheckpointIntent(project, ensureRuntime(project));
  }
  if (running >= limit) return;
  const eligible = eligibleProjects();
  if (!eligible.length) return;

  if (config.settings.mode === 'roundrobin') {
    while (running < limit && eligible.length) {
      const index = roundRobinCursor % eligible.length;
      const project = eligible[index];
      roundRobinCursor = (index + 1) % eligible.length;
      startStep(project);
      running += 1;
    }
    return;
  }

  for (const project of eligible) {
    if (running >= limit) break;
    startStep(project);
    running += 1;
  }
}

function auditStaleIntent(project, intent) {
  autoResume.appendAudit(project, 'stale-intent-ignored', {
    phase: intent && autoResume.PHASES.has(intent.nextPhase) ? intent.nextPhase : undefined,
    task: intent && intent.currentTask ? intent.currentTask : '',
    reason: intent && autoResume.REASONS.has(intent.reason) ? intent.reason : undefined
  });
}

function runKeyFor(project, phase, taskText) {
  const id = String(project?.id ?? '');
  const projectPath = path.resolve(String(project?.path ?? ''));
  const material = [id, projectPath, String(phase ?? ''), String(taskText ?? '')].join('\0');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
}

function quiesceChild(rt) {
  const child = rt.child;
  rt.token += 1;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
      finish();
    }, 3000);
    child.once('close', finish);
    child.once('error', finish);
    try { child.kill('SIGTERM'); } catch { finish(); }
  });
}

async function prepareShutdownResume(reason) {
  const captureReason = autoResume.REASONS.has(reason) ? reason : 'planned-restart';
  const result = { gated: autoResume.shouldCaptureResumeIntent(), prepared: [], skipped: [] };
  if (!result.gated) {
    for (const project of config.projects) result.skipped.push({ id: project.id, reason: 'gated' });
    return result;
  }
  for (const project of config.projects) {
    if (project.autoResumeOnStart !== true) {
      result.skipped.push({ id: project.id, reason: 'opted-out' });
      continue;
    }
    const rt = ensureRuntime(project);
    if (!rt.active) {
      result.skipped.push({ id: project.id, reason: 'inactive' });
      continue;
    }
    if (rt.paused) {
      result.skipped.push({ id: project.id, reason: 'paused' });
      continue;
    }
    if (rt.status === 'done' || rt.status === 'error') {
      result.skipped.push({ id: project.id, reason: rt.status === 'done' ? 'completed' : 'failed' });
      continue;
    }
    if (autoResume.hasIntent(project, captureReason)) {
      result.skipped.push({ id: project.id, reason: 'already-pending' });
      continue;
    }
    const phase = autoResume.PHASES.has(rt.nextPhase) ? rt.nextPhase : 'seed';
    const written = autoResume.writeIntent(project, {
      reason: captureReason,
      nextPhase: phase,
      status: rt.status,
      currentTask: rt.currentTask || '',
      resumeAt: rt.resumeAt,
      pid: process.pid,
      hostname: process.env.HOSTNAME || ''
    });
    if (!written.ok) {
      result.skipped.push({ id: project.id, reason: 'write-failed' });
      continue;
    }
    autoResume.appendAudit(project, 'about-to-resume', {
      phase,
      task: rt.currentTask || '',
      reason: captureReason
    });
    await quiesceChild(rt);
    rt.child = null;
    rt.starting = false;
    rt.paused = true;
    emitState();
    autoResume.appendAudit(project, 'resume-child-quiesced', {
      phase,
      task: rt.currentTask || '',
      reason: captureReason
    });
    result.prepared.push(project.id);
  }
  return result;
}

function cleanOrphanIntents() {
  const root = process.env.LOOPARR_PROJECTS_ROOT;
  if (!root || !fs.existsSync(root)) return;
  const known = new Set(config.projects.map((project) => path.resolve(project.path)));
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectPath = path.join(root, entry.name);
    if (known.has(path.resolve(projectPath))) continue;
    if (!fs.existsSync(path.join(projectPath, '.looparr', autoResume.STATE_NAME))) continue;
    const pseudo = { id: entry.name, name: '', path: projectPath };
    const checked = autoResume.consumeIntent(pseudo);
    const intent = checked.ok ? checked.intent : null;
    if (intent) pseudo.id = intent.projectId;
    auditStaleIntent(pseudo, intent);
  }
}

function resumeOnStart() {
  cleanOrphanIntents();
  for (const project of config.projects) {
    const checked = autoResume.consumeIntent(project);
    if (!checked.ok && checked.reason === 'missing') continue;
    const intent = checked.ok ? checked.intent : null;
    if (!checked.ok || !intent) {
      if (checked.reason === 'unlink-failed') {
        autoResume.appendAudit(project, 'resume-failed', { reason: 'planned-restart' });
      } else {
        auditStaleIntent(project, intent);
      }
      continue;
    }
    if (project.autoResumeOnStart !== true) {
      auditStaleIntent(project, intent);
      continue;
    }
    let phase = autoResume.PHASES.has(intent.nextPhase) ? intent.nextPhase : 'seed';
    let taskText = '';
    try {
      const plan = planLib.readPlan(project.path);
      if (!plan.ok || !plan.next || !plan.next.text) {
        auditStaleIntent(project, intent);
        continue;
      }
      taskText = plan.next.text;
      if (phase !== 'seed') {
        let handoff = '';
        try { handoff = fs.readFileSync(answerPath(project), 'utf8').trim(); } catch { /* absent */ }
        if (!handoff) {
          phase = 'seed';
          autoResume.appendAudit(project, 'resume-degraded', {
            phase, task: taskText, reason: intent.reason
          });
        }
      }
      if (intent.currentTask !== taskText) {
        autoResume.appendAudit(project, 'resume-degraded', {
          phase, task: taskText, reason: intent.reason, cause: 'task-no-longer-next'
        });
        phase = 'seed';
        clearHandoff(project);
      }
      const rt = ensureRuntime(project);
      rt.active = true;
      rt.paused = false;
      rt.pauseAfterStep = false;
      rt.child = null;
      rt.starting = false;
      rt.token = 0;
      rt.stepTask = null;
      rt.stepOutput = '';
      rt.error = '';
      rt.currentTask = taskText;
      rt.nextPhase = phase;
      appendLog(project.id, 'system', `↻ Auto-resume after restart (phase ${phase}).`);
      if (intent.resumeAt && intent.resumeAt > Date.now()) {
        rt.resumeAt = intent.resumeAt;
        rt.status = 'rateLimited';
        emitState();
      } else {
        rt.resumeAt = null;
        rt.status = 'idle';
        start(project.id);
      }
      autoResume.appendAudit(project, 'resume-on-start', {
        phase, task: taskText, reason: intent.reason
      });
    } catch {
      autoResume.appendAudit(project, 'resume-failed', {
        phase, task: taskText, reason: intent.reason
      });
    }
  }
}

function init() {
  for (const project of config.projects) {
    ensureRuntime(project);
    watchProject(project);
  }
  resumeOnStart();
  tickTimer = setInterval(tick, 1000);
}

function shutdown() {
  if (tickTimer) clearInterval(tickTimer);
  for (const project of config.projects) {
    const rt = runtime.get(project.id);
    if (rt && rt.child) {
      try { rt.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }
  for (const watcher of watchers.values()) watcher.close();
  watchers.clear();
  const runner = getRunner('opencode');
  if (runner && runner.shutdown) runner.shutdown();
}

module.exports = {
  init,
  shutdown,
  getState,
  addProject,
  removeProject,
  updateSettings,
  updateProject,
  getPlan,
  writePlan,
  setTaskChecked,
  getIcon,
  getAnswer,
  writeAnswer,
  hasHandoff,
  shouldReseedOnStart,
  start,
  pause,
  stop,
  prepareShutdownResume,
  runKeyFor,
  resumeOnStart,
  promptPreamble,
  isMetaPromptHandoff,
  iconVersionFor,
  refreshIcon
};
