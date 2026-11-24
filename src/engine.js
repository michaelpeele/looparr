'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const configStore = require('./config');
const autoResume = require('./auto-resume');
const logStore = require('./log-store');
const bus = require('./events');
const planLib = require('./plan');
const iconLib = require('./icon');
const { getRunner, listRunners, resolveRunnerModels } = require('./runners');
const { modelList, joinModelList } = require('./model-list');
const { normalizeOpenCodeSessionId, createOpenCodeSessionCapture } = require('./runners/opencode-session');

const config = configStore.loadConfig();
const runtime = new Map();
const watchers = new Map();
const LOG_LIMIT = 400;
const CHECKPOINT_INTERVAL_MS = 30_000;
// Opt-in sweep that re-checks errored projects for a late handoff.
const HANDOFF_RECOVERY_INTERVAL_MS = 15_000;
// Plan prompt-type waiting states: the loop is parked until a human acts
// (answer PUT advances planQuestions→planWrite; plan-confirm advances to analyze).
const WAITING_STATUSES = new Set(['waitingAnswer', 'waitingConfirm']);
const PROJECT_DOCS_DIR = '.project_documents';
const PLAN_DOC_BASENAME_RE = /^PLAN-[^/\\]+\.md$/;
let logSeq = 0;
let tickTimer = null;
let roundRobinCursor = 0;
let lastCheckpointAt = 0;
let lastHandoffRecoveryAt = 0;

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
      cooloffUntil: null,
      error: '',
      logs: [],
      child: null,
      starting: false,
      token: 0,
      modelIndex: 0,
      modelAttemptRunKey: '',
      modelFallbackPending: false,
      rateLimitBackoffKey: '',
      rotationCursor: {},
      rotationLists: {},
      stepTask: null,
      stepOutput: '',
      icon: null,
      iconVersion: null,
      activeRunner: '',
      activeModel: '',
      opencodeSessionId: '',
      resumeSessionId: ''
    };
    runtime.set(project.id, rt);
    applyRuntimeIcon(rt, iconLib.findIcon(project.path));
    // Hydration: restore the newest log file's entries so a restart keeps history.
    try {
      const entries = logStore.readRecent(project.id, LOG_LIMIT);
      if (entries.length) {
        rt.logs = entries;
        const maxSeq = Math.max(...entries.map((e) => e.seq), 0);
        if (maxSeq > logSeq) logSeq = maxSeq;
      }
    } catch { /* ignore hydration errors */ }
  }
  return rt;
}

function findProject(id) {
  return config.projects.find((project) => project.id === id) || null;
}

const rotationStore = require('./rotation-store');
const { classifyFailure } = require('./failure');

function effectiveRunnerList(project) {
  const raw = project.runner || config.settings.globalRunner || 'opencode';
  const ids = modelList(raw).filter((id) => getRunner(id));
  return ids.length ? ids : ['opencode'];
}

function effectiveRunnerRotation(project) {
  if (typeof project.runnerRotation === 'boolean') return project.runnerRotation;
  return config.settings.runnerRotation === true;
}

function modelsFor(project, phase, runner) {
  return resolveRunnerModels(runner, effectiveModelList(project, phase)).models;
}

// Runner rotation needs the same cooldown awareness as model rotation: a runner
// whose every model is cooling is not a candidate while another runner is ready.
// When all runners are cooling, report the earliest model readyAt.
function pickRunner(project, phase, list) {
  const start = rotationStore.getCursor(list);
  const now = Date.now();
  let earliest = Infinity;
  for (let offset = 0; offset < list.length; offset += 1) {
    const index = (start + offset) % list.length;
    const runner = getRunner(list[index]);
    if (!runner) continue;
    const models = modelsFor(project, phase, runner);
    if (!models.length) return { id: list[index], index, waitMs: 0 };
    let ready = false;
    let runnerEarliest = Infinity;
    for (const id of models) {
      const until = rotationStore.readyAt(id);
      if (!until) { ready = true; break; }
      if (until < runnerEarliest) runnerEarliest = until;
    }
    if (ready) return { id: list[index], index, waitMs: 0 };
    if (runnerEarliest < earliest) earliest = runnerEarliest;
    appendLog(
      project.id,
      'system',
      `Skipping ${runner.label}: models cooling (${models.join(', ')}) for another ${Math.ceil((runnerEarliest - now) / 1000)}s.`
    );
  }
  return { id: list[start], index: start, waitMs: earliest === Infinity ? 0 : earliest - now };
}

function effectiveModelList(project, phase = 'seed') {
  const field = configStore.modelFieldForPhase(phase);
  const selected = project[field] || project.model || config.settings[field] || config.settings.model || '';
  return modelList(selected);
}

function effectiveModel(project, phase = 'seed') {
  return effectiveModelList(project, phase)[0] || '';
}

function effectiveRotation(project, modelField = 'model') {
  return configStore.resolveRotation(project, config.settings, modelField);
}

function advanceRotationCursor(project, rt, phase, runner) {
  const field = configStore.modelFieldForPhase(phase);
  const models = runner ? modelsFor(project, phase, runner) : effectiveModelList(project, phase);
  if (configStore.resolveRotation(project, config.settings, field) && models.length > 1) {
    rotationStore.advance(models, Math.min(Math.max(rt.modelIndex, 0), models.length - 1));
  }
  const runnerList = effectiveRunnerList(project);
  if (runnerList.length > 1 && effectiveRunnerRotation(project)) {
    rotationStore.advance(runnerList, Math.max(rt.runnerIndex || 0, 0));
  }
}

function blockPolicyFor(project) {
  const normalized = configStore.normalizeProject(project);
  return {
    ...configStore.resolveBlockPolicy(normalized, config.settings),
    overrides: {
      blockThreshold: normalized.blockThreshold ?? null,
      cooloffSeconds: normalized.cooloffSeconds ?? null,
      temporaryLiftScope: normalized.temporaryLiftScope || '',
      permanentLift: normalized.permanentLift || ''
    }
  };
}

function cooloffMsFor(project) {
  return configStore.resolveCooloff(project, config.settings) * 1000;
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
    logStore.append(projectId, entry);
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
        runnerRotation: project.runnerRotation ?? null,
        effectiveRunnerRotation: effectiveRunnerRotation(project),
        effectiveRunners: joinModelList(effectiveRunnerList(project)),
        activeRunner: rt.activeRunner || '',
        activeModel: rt.activeModel || '',
        model: project.model || '',
        seedModel: project.seedModel || '',
        analyzeModel: project.analyzeModel || '',
        implementModel: project.implementModel || '',
        planModel: project.planModel || '',
        modelRotation: project.modelRotation ?? null,
        seedRotation: project.seedRotation ?? null,
        analyzeRotation: project.analyzeRotation ?? null,
        implementRotation: project.implementRotation ?? null,
        planRotation: project.planRotation ?? null,
        effectiveRotations: {
          model: effectiveRotation(project, 'model'),
          seed: effectiveRotation(project, 'seedModel'),
          analyze: effectiveRotation(project, 'analyzeModel'),
          implement: effectiveRotation(project, 'implementModel'),
          plan: effectiveRotation(project, 'planModel')
        },
        effectiveModel: effectiveModel(project),
        effectiveModels: {
          seed: effectiveModel(project, 'seed'),
          analyze: effectiveModel(project, 'analyze'),
          implement: effectiveModel(project, 'implement'),
          planQuestions: effectiveModel(project, 'planQuestions'),
          planWrite: effectiveModel(project, 'planWrite')
        },
        effectiveModelLists: {
          model: joinModelList(modelList(project.model || config.settings.model || '')),
          seed: joinModelList(effectiveModelList(project, 'seed')),
          analyze: joinModelList(effectiveModelList(project, 'analyze')),
          implement: joinModelList(effectiveModelList(project, 'implement')),
          plan: joinModelList(effectiveModelList(project, 'planQuestions'))
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
        cooloffUntil: rt.cooloffUntil || null,
        effectiveCooloffSeconds: configStore.resolveCooloff(project, config.settings),
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
    planModel: configStore.normalizedModel(input.planModel, ''),
    modelRotation: input.modelRotation,
    seedRotation: input.seedRotation,
    analyzeRotation: input.analyzeRotation,
    implementRotation: input.implementRotation,
    planRotation: input.planRotation,
    blockThreshold: input.blockThreshold ?? null,
    cooloffSeconds: input.cooloffSeconds ?? null,
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

function handoffTaskPath(project) {
  return path.join(project.path, '.looparr', 'handoff_task.txt');
}

// Provenance for the current .looparr/next_prompt.txt: which looparr task the
// handoff was validated for. Fresh sessions and restart checkpoints use it to
// refuse to run an implement/analyze handoff written for a different task.
function readHandoffTask(project) {
  try {
    const [taskText] = fs.readFileSync(handoffTaskPath(project), 'utf8').split(/\r?\n/);
    return (taskText || '').trim();
  } catch {
    return '';
  }
}

function stampHandoffTask(project, taskText) {
  try {
    fs.mkdirSync(path.join(project.path, '.looparr'), { recursive: true });
    const now = new Date();
    const stampedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(handoffTaskPath(project), `${taskText}\n${stampedAt}\n`);
    return true;
  } catch {
    return false;
  }
}

function clearHandoff(project) {
  try {
    fs.unlinkSync(handoffTaskPath(project));
  } catch { /* absent */ }
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

// Serializable projection of the runtime for crash/restart resume. The auto-
// resume layer redacts and bounds it; a live child is intentionally omitted so a
// crash mid-step re-runs cleanly via runKey + session id.
function snapshotRuntime(project, rt) {
  if (!rt) return undefined;
  const snapshot = {};
  if (rt.stepTask && Number.isInteger(Number(rt.stepTask.index)) && typeof rt.stepTask.text === 'string') {
    snapshot.stepTask = { index: Number(rt.stepTask.index), text: rt.stepTask.text };
  }
  if (typeof rt.stepOutput === 'string' && rt.stepOutput) snapshot.stepOutput = rt.stepOutput;
  if (Number.isInteger(rt.modelIndex) && rt.modelIndex >= 0) snapshot.modelIndex = rt.modelIndex;
  if (typeof rt.modelAttemptRunKey === 'string' && rt.modelAttemptRunKey) snapshot.modelAttemptRunKey = rt.modelAttemptRunKey;
  if (typeof rt.rateLimitBackoffKey === 'string' && rt.rateLimitBackoffKey) snapshot.rateLimitBackoffKey = rt.rateLimitBackoffKey;
  if (Number.isFinite(rt.cooloffUntil) && rt.cooloffUntil > 0) snapshot.cooloffUntil = rt.cooloffUntil;
  if (rt.rotationCursor && typeof rt.rotationCursor === 'object' && !Array.isArray(rt.rotationCursor)) {
    snapshot.rotationCursor = rt.rotationCursor;
  }
  if (typeof rt.resumeSessionId === 'string' && rt.resumeSessionId) snapshot.resumeSessionId = rt.resumeSessionId;
  if (rt.planPhaseSnapshot && typeof rt.planPhaseSnapshot === 'object' && !Array.isArray(rt.planPhaseSnapshot)) {
    snapshot.planPhaseSnapshot = rt.planPhaseSnapshot;
  }
  return Object.keys(snapshot).length ? snapshot : undefined;
}

function writeCheckpointIntent(project, rt) {
  if (project.autoResumeOnStart !== true) return false;
  if (!autoResume.shouldCaptureResumeIntent()) return false;
  if (!rt || !rt.currentTask) return false;
  if (rt.paused) return false;
  if (rt.status === 'done') return false;
  // Active steps checkpoint as before; an errored step (active=false) also
  // checkpoints so its phase survives a restart instead of dropping to seed.
  if (!rt.active && rt.status !== 'error') return false;
  const phase = autoResume.PHASES.has(rt.nextPhase) ? rt.nextPhase : 'seed';
  const runKey = runKeyFor(project, phase, rt.currentTask);
  const written = autoResume.writeIntent(project, {
    reason: 'checkpoint',
    nextPhase: phase,
    status: rt.status,
    currentTask: rt.currentTask,
    resumeAt: rt.resumeAt,
    runKey,
    pid: process.pid,
    hostname: process.env.HOSTNAME || '',
    snapshot: snapshotRuntime(project, rt)
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
  const wasChecked = Boolean(
    rt.currentTask && plan.tasks.some((task) => task.checked && task.text === rt.currentTask)
  );
  const hadHandoff = hasHandoff(project);
  const implementChildActive = Boolean(
    rt.active
    && rt.nextPhase === 'implement'
    && (rt.child || rt.starting)
    && (rt.status === 'implement' || (rt.paused && rt.status === 'paused'))
  );
  if (wasChecked && implementChildActive) {
    autoResume.appendAudit(project, 'plan-reconcile-preserved', {
      phase: rt.nextPhase,
      task: rt.currentTask || '',
      cause: 'task-checked-during-active-implement'
    });
    return;
  }
  if (wasChecked) {
    autoResume.appendAudit(project, 'plan-reconcile-degraded', {
      phase: rt.nextPhase,
      task: rt.currentTask || '',
      cause: 'task-explicitly-checked'
    });
    rt.currentTask = '';
    rt.stepTask = null;
    rt.nextPhase = 'seed';
    clearCheckpointIntent(project);
    clearHandoff(project);
    return;
  }
  if (rt.currentTask && hadHandoff) {
    autoResume.appendAudit(project, 'plan-reconcile-preserved', {
      phase: rt.nextPhase,
      task: rt.currentTask,
      cause: 'plan-task-text-changed-but-handoff-exists'
    });
    rt.nextPhase = autoResume.PHASES.has(rt.nextPhase) ? rt.nextPhase : 'seed';
    clearCheckpointIntent(project);
    return;
  }
  autoResume.appendAudit(project, 'plan-reconcile-degraded', {
    phase: rt.nextPhase,
    task: rt.currentTask || '',
    cause: hadHandoff ? 'task-not-current' : 'task-not-current-no-handoff'
  });
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

// Deterministic slug for the PLAN-<slug>.md doc the planWrite agent should
// author: alphanumeric and single hyphens only, no whitespace or path parts.
function planDocSlug(taskText) {
  const slug = String(taskText || '')
    .toLowerCase()
    .replace(/^\(plan\)\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'plan';
}

function planDocsDir(project) {
  return path.join(project.path, PROJECT_DOCS_DIR);
}

function listPlanDocs(project) {
  try {
    return fs.readdirSync(planDocsDir(project))
      .filter((name) => PLAN_DOC_BASENAME_RE.test(name))
      .sort();
  } catch {
    return [];
  }
}

// Snapshot taken when the planWrite step spawns: task texts of every checklist
// line in plan.md plus the existing PLAN-*.md files. planWrite's output is
// validated against this snapshot after the agent exits.
function snapshotPlanForPlanWrite(project, taskText) {
  const plan = planLib.readPlan(project.path);
  return {
    taskText,
    planOk: plan.ok,
    taskTexts: plan.ok ? plan.tasks.map((task) => task.text) : [],
    planDocs: listPlanDocs(project)
  };
}

// planWrite's output is only usable when the agent:
//   1. produced (or refreshed) a PLAN-*.md document,
//   2. appended at least one new unchecked "- [ ]" task to plan.md,
//   3. did not leave the original "(plan)" line unchecked (it must be
//      replaced, removed, or marked done).
function verifyPlanWriteOutput(project, rt, taskText) {
  const snapshot = rt.planPhaseSnapshot;
  if (!snapshot) throw new Error('planWrite step lost its plan snapshot; re-run planQuestions.');
  const expectedDoc = `PLAN-${planDocSlug(taskText)}.md`;
  const docs = listPlanDocs(project);
  const newDoc = docs.find((name) => !snapshot.planDocs.includes(name));
  const hasExpected = docs.includes(expectedDoc);
  if (!hasExpected && !newDoc) {
    throw new Error(
      `planWrite step did not create ${PROJECT_DOCS_DIR}/${expectedDoc} (expected doc slug: ${planDocSlug(taskText)}).`
    );
  }
  const plan = planLib.readPlan(project.path);
  if (!plan.ok) throw new Error(`plan.md disappeared after planWrite: ${plan.error}`);
  const known = new Set(snapshot.taskTexts);
  const newTasks = plan.tasks.filter((task) => task.text !== taskText && !known.has(task.text));
  const newUnchecked = newTasks.filter((task) => !task.checked);
  if (!newTasks.length || !newUnchecked.length) {
    throw new Error('planWrite step did not append new unchecked tasks to plan.md.');
  }
  const originalStillOpen = plan.tasks.some((task) => !task.checked && task.text === taskText);
  if (originalStillOpen) {
    throw new Error(
      'planWrite step left the original "(plan)" task unchecked; it must replace or remove that line in plan.md.'
    );
  }
  return true;
}

// Belt-and-braces for plan confirm: if the original "(plan)" line somehow
// survived, mark that exact line done so it can never come back as plan.next.
function ensureOriginalPlanLineDone(project, rt) {
  const snapshot = rt.planPhaseSnapshot;
  const originalText = snapshot && snapshot.taskText;
  if (!originalText) return;
  const plan = planLib.readPlan(project.path);
  if (!plan.ok) return;
  const openOriginal = plan.tasks.find((task) => !task.checked && task.text === originalText);
  if (!openOriginal) return;
  const result = planLib.setChecked(plan.content, openOriginal.index, true);
  if (result.ok) planLib.writePlan(project.path, result.content);
}

function shouldReseedOnStart(rt, hasHandoffFile) {
  return Boolean(
    rt &&
    rt.status === 'error' &&
    (rt.nextPhase === 'analyze' || rt.nextPhase === 'implement') &&
    !hasHandoffFile
  );
}

function readHandoffText(project) {
  try {
    return fs.readFileSync(answerPath(project), 'utf8').trim();
  } catch {
    return '';
  }
}

// Sweep predicate: only an errored, idle project in a resumable phase may be
// un-stuck, and only by a non-meta handoff stamped for the task it errored on.
// Presence alone is not enough: a handoff written for another task must never
// advance this one.
function handoffReadyForResume(project, rt) {
  if (!rt || rt.status !== 'error') return false;
  if (rt.active || rt.child || rt.starting) return false;
  if (rt.nextPhase !== 'analyze' && rt.nextPhase !== 'implement') return false;
  const handoff = readHandoffText(project);
  if (!handoff) return false;
  if (isMetaPromptHandoff(handoff).poisoned) return false;
  const plan = planLib.readPlan(project.path);
  const task = rt.currentTask || (plan.ok && plan.next ? plan.next.text : '');
  if (!task) return false;
  return readHandoffTask(project) === task;
}

// Flip an errored project back into the loop without calling start(), so the
// normal tick still enforces maxWorkers. Returns true when it acted.
function applyHandoffRecovery(project, rt) {
  if (!handoffReadyForResume(project, rt)) {
    // A handoff stamped for a different task can never be used by this project;
    // clear it so the errored state does not keep a wrong-task prompt around.
    const stamped = readHandoffTask(project);
    if (
      rt
      && rt.status === 'error'
      && (rt.nextPhase === 'analyze' || rt.nextPhase === 'implement')
      && rt.currentTask
      && stamped
      && stamped !== rt.currentTask
    ) {
      clearHandoff(project);
    }
    return false;
  }
  const phase = rt.nextPhase;
  const task = rt.currentTask || readHandoffTask(project);
  rt.error = '';
  rt.status = 'idle';
  rt.active = true;
  autoResume.appendAudit(project, 'handoff-recovered', { phase, task });
  appendLog(project.id, 'system', `↻ Handoff present; resuming ${phase}`);
  emitState();
  scheduleTick();
  return true;
}

// A run already active for this project means the user resumed the session
// outside Looparr; the sweep must never fight a continuing session.
function activeOpenCodeRunsFor(project) {
  const runner = getRunner('opencode');
  if (!runner || typeof runner.listActiveRuns !== 'function') return Promise.resolve([]);
  try {
    return Promise.resolve(runner.listActiveRuns({ projectId: project.id, cwd: project.path }))
      .then((runs) => (Array.isArray(runs) ? runs : []))
      .catch(() => []);
  } catch {
    return Promise.resolve([]);
  }
}

async function runHandoffRecoverySweep(options = {}) {
  if (options.force !== true && config.settings.handoffRecovery !== true) return [];
  const projects = Array.isArray(options.projects) ? options.projects : config.projects;
  const runtimeFor = typeof options.runtimeFor === 'function' ? options.runtimeFor : ensureRuntime;
  const listRuns = typeof options.listActiveRuns === 'function' ? options.listActiveRuns : activeOpenCodeRunsFor;
  const recovered = [];
  for (const project of projects) {
    const rt = runtimeFor(project);
    if (!rt || rt.status !== 'error') continue;
    if (rt.active || rt.child || rt.starting) continue;
    if (rt.nextPhase !== 'analyze' && rt.nextPhase !== 'implement') continue;
    // One throttled audit per project per interval keeps the wait observable
    // without log spam.
    const auditOnce = (event) => {
      const at = Date.now();
      if (rt.lastRecoveryAuditAt && at - rt.lastRecoveryAuditAt < HANDOFF_RECOVERY_INTERVAL_MS) return;
      rt.lastRecoveryAuditAt = at;
      autoResume.appendAudit(project, event, { phase: rt.nextPhase, task: rt.currentTask || '' });
    };
    let runs = [];
    try { runs = await listRuns(project); } catch { runs = []; }
    if (Array.isArray(runs) && runs.length) {
      auditOnce('handoff-recovery-session-active');
      continue;
    }
    if (applyHandoffRecovery(project, rt)) recovered.push(project.id);
    else auditOnce('handoff-recovery-waiting');
  }
  return recovered;
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

function isWaitingState(rt) {
  return Boolean(rt && WAITING_STATUSES.has(rt.status));
}

function isWaitingForAnswer(id) {
  const project = findProject(id);
  if (!project) return false;
  return ensureRuntime(project).status === 'waitingAnswer';
}

// After a successful answer PUT: while the engine parks in waitingAnswer for
// the plan flow, the saved answer becomes the planWrite handoff and the loop
// may resume. Any other state keeps the pre-plan write-only behavior.
function onAnswerSaved(id) {
  const project = findProject(id);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const rt = ensureRuntime(project);
  if (rt.status !== 'waitingAnswer') return { ok: true, advanced: false };
  if (rt.nextPhase !== 'planWrite') return { ok: true, advanced: false };
  const answer = getAnswer(id);
  if (!answer.ok) return { ok: false, status: 400, error: answer.error || 'Could not read answer' };
  if (!answer.content || !answer.content.trim()) {
    return { ok: false, status: 400, error: 'Answer cannot be empty while the plan questions wait for an answer' };
  }
  rt.status = 'idle';
  rt.error = '';
  appendLog(project.id, 'system', '✓ Answer saved; running plan write step.');
  emitState();
  scheduleTick();
  return { ok: true, advanced: true };
}

// Human confirmation after the planWrite step parks the project in
// waitingConfirm. Only this endpoint may advance the plan task to analyze.
function confirmPlan(id) {
  const project = findProject(id);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  const rt = ensureRuntime(project);
  if (rt.status !== 'waitingConfirm' || (rt.nextPhase || '') !== 'analyze') {
    return { ok: false, status: 409, error: 'Project is not waiting for plan confirmation' };
  }
  ensureOriginalPlanLineDone(project, rt);
  rt.planPhaseSnapshot = null;
  rt.status = 'idle';
  rt.error = '';
  appendLog(project.id, 'system', '✓ Plan confirmed; running analyze.');
  emitState();
  scheduleTick();
  return { ok: true };
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
  rt.cooloffUntil = null;
  rt.error = '';
  rt.currentTask = rt.currentTask || '';
  // Waiting states survive Start: only a real answer PUT (planWrite) or POST
  // plan-confirm (analyze) may advance a waiting plan project.
  if (!rt.child && !isWaitingState(rt)) rt.status = 'idle';
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
  rt.cooloffUntil = null;
  rt.status = 'idle';
  rt.currentTask = '';
  rt.error = '';
  rt.nextPhase = 'seed';
  rt.stepTask = null;
  rt.planPhaseSnapshot = null;
  rt.opencodeSessionId = '';
  rt.resumeSessionId = '';
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
    .replace(/{{handoff}}/g, () => String(values.handoff ?? ''))
    .replace(/{{planPath}}/g, () => String(values.planPath ?? ''));
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
const RESTART_CONTINUE_MESSAGE = 'Restart complete continue.';

function restartContinueFile() {
  return process.env.LOOPARR_RESTART_CONTINUE_FILE ||
    path.join(path.resolve(__dirname, '..'), '.looparr', 'restart-continue.json');
}

function consumeRestartContinueMessage() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(restartContinueFile(), 'utf8'));
  } catch {
    return '';
  }
  try { fs.unlinkSync(restartContinueFile()); } catch { /* no marker */ }
  const message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
  return message === RESTART_CONTINUE_MESSAGE ? message : '';
}

function promptPreamble(extra = '') {
  const parts = [];
  if (config.settings.promptCliToolsNote === true) parts.push(CLI_TOOLS_NOTE);
  if (extra) parts.push(extra);
  return parts.join('\n\n');
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

function rateLimitBackoffKey(project, rt, phase, runnerId, model) {
  const runKey = rt.modelAttemptRunKey || runKeyFor(project, phase, rt.currentTask || '');
  return `${runKey}|${runnerId}|${model}`;
}

// A 429 gets one cooldown before failover. The next candidate is selected before
// pausing so the resumed step starts on a different model, never the failed one.
function pauseForRateLimitFailover(project, rt, phase, pauseMs, message) {
  appendLog(project.id, 'system', `${message} Backing off once before failover.`);
  rt.status = 'rateLimited';
  rt.stepOutput = '';
  rt.resumeAt = Date.now() + pauseMs;
  rt.nextPhase = phase;
  rt.modelFallbackPending = true;
  rt.modelAttemptRunKey = runKeyFor(project, phase, rt.currentTask || '');
  emitState();
  rateLimitRetry(project, rt, pauseMs);
  return true;
}

// A blank model means "whatever the selected runner uses by default", so the
// log names that runner instead of always saying OpenCode.
function defaultModelLabel(runner) {
  return `${runner?.label || 'Runner'} default`;
}

function commitRetry(project, rt, runner, phase, message) {
  appendLog(project.id, 'system', message);
  rt.status = 'idle';
  rt.stepOutput = '';
  rt.resumeAt = null;
  rt.nextPhase = phase;
  rt.modelFallbackPending = true;
  rt.modelAttemptRunKey = runKeyFor(project, phase, rt.currentTask || '');
  emitState();
  scheduleTick();
  return true;
}

// A failed step first tries another candidate: the next model for this runner,
// then (when runner rotation is on) the next runner and its models. Auth,
// entitlement and billing failures are terminal, and every candidate is tried
// at most once per step so a broken list cannot loop.
function tryNextCandidate(project, rt, runner, phase, code) {
  // A zero exit is a completed step. Output text that merely mentions 429 or
  // provider-error wording (echoed prompts, commit bodies, reports) must never
  // be read as a live provider error on a successful run.
  if (code === 0) return false;
  if (!runner || !runner.isRateLimit) return false;
  const isRate = runner.isRateLimit(rt.stepOutput) === true;
  const verdict = classifyFailure(rt.stepOutput, { isRateLimit: (text) => runner.isRateLimit(text) });
  if (verdict !== 'advance') return false;
  const models = modelsFor(project, phase, runner);
  if (!rt.tried) rt.tried = new Set();
  const currentModel = models[rt.modelIndex] || '';
  rt.tried.add(`${runner.id}:${currentModel}`);
  const pauseMs = rateLimitPauseMs();
  const backoffKey = rateLimitBackoffKey(project, rt, phase, runner.id, currentModel);
  const shouldBackoff = isRate && rt.rateLimitBackoffKey !== backoffKey;
  if (isRate && currentModel) rotationStore.markCooling(currentModel, Date.now() + pauseMs);
  const failover = (message) => {
    if (shouldBackoff) {
      rt.rateLimitBackoffKey = backoffKey;
      return pauseForRateLimitFailover(project, rt, phase, pauseMs, message);
    }
    return commitRetry(project, rt, runner, phase, message);
  };
  const now = Date.now();
  for (let step = 1; step <= models.length; step += 1) {
    const index = (rt.modelIndex + step) % models.length;
    const id = models[index] || '';
    if (rt.tried.has(`${runner.id}:${id}`)) continue;
    if (isRate && rotationStore.readyAt(id) > now) {
      appendLog(
        project.id,
        'system',
        `Skipping ${runner.label} model ${id || 'default'}: cooling for another ${Math.ceil((rotationStore.readyAt(id) - now) / 1000)}s.`
      );
      continue;
    }
    rt.modelIndex = index;
    return failover(
      `Model failure on ${currentModel || defaultModelLabel(runner)}; retrying with ${id || defaultModelLabel(runner)}.`
    );
  }
  if (!effectiveRunnerRotation(project)) return false;
  for (const id of effectiveRunnerList(project)) {
    if (id === runner.id) continue;
    const nextRunner = getRunner(id);
    if (!nextRunner) continue;
    const nextModels = modelsFor(project, phase, nextRunner);
    const nextModel = nextModels.find((model) => !rt.tried.has(`${id}:${model}`));
    if (nextModel === undefined) continue;
    rt.modelIndex = Math.max(0, nextModels.indexOf(nextModel));
    rt.forcedRunnerId = id;
    return failover(`Runner failure on ${runner.label}; retrying with ${nextRunner.label}.`);
  }
  return false;
}

async function spawnRunnerAttempt(project, rt, runner, options) {
  const { prompt, url, files, model, runKey, phase, task, models, sessionId = '' } = options;
  const built = runner.buildCommand({
    prompt,
    cwd: project.path,
    url,
    files,
    model,
    runKey,
    projectId: project.id,
    phase,
    task,
    sessionId
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

  const sessionCapture = runner && runner.id === 'opencode' ? createOpenCodeSessionCapture() : null;
  let checkpointRewritten = false;
  const noteSessionId = (value) => {
    const normalized = normalizeOpenCodeSessionId(value);
    if (!normalized || normalized === rt.opencodeSessionId) return;
    rt.opencodeSessionId = normalized;
    if (!checkpointRewritten) {
      writeCheckpointIntent(project, rt);
      checkpointRewritten = true;
    }
  };

  if (child.stdout) child.stdout.on('data', (chunk) => {
    if (rt.token !== token) return;
    if (sessionCapture) {
      sessionCapture.push(chunk);
      noteSessionId(sessionCapture.sessionId);
    }
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
    if (tryNextCandidate(project, rt, runner, phase, code)) return;
    handleClose(project, rt, code, task, phase, runner);
  });
}

// Plan prompt-type close: park in waitingAnswer (after planQuestions) or
// waitingConfirm (after planWrite, once the produced plan passes validation).
// Never auto-spawns: a human advances these states.
function handlePlanPromptClose(project, rt, task, phase) {
  const promptFile = path.join(project.path, '.looparr', 'next_prompt.txt');
  const failStep = (message) => {
    rt.nextPhase = phase;
    rt.status = 'error';
    rt.active = false;
    rt.error = message;
    appendLog(project.id, 'system', `✖ ${message}`);
    emitState();
  };
  let handoff = '';
  try { handoff = fs.readFileSync(promptFile, 'utf8').trim(); } catch { /* missing */ }
  if (!handoff) return failStep(`${phase} step did not write .looparr/next_prompt.txt`);
  if (phase === 'planWrite') {
    const metaCheck = isMetaPromptHandoff(handoff);
    if (metaCheck.poisoned) {
      appendLog(project.id, 'system', '✖ Plan write produced meta-prompt handoff; retrying plan write.');
      return failStep(
        `Plan write handoff rejected (${metaCheck.reason}); meta-instruction handoffs cannot advance to Analyze. Re-run the plan write step.`
      );
    }
    try {
      verifyPlanWriteOutput(project, rt, task.text);
    } catch (error) {
      return failStep(error.message);
    }
  }
  stampHandoffTask(project, task.text);
  rt.nextPhase = phase === 'planQuestions' ? 'planWrite' : 'analyze';
  rt.status = phase === 'planQuestions' ? 'waitingAnswer' : 'waitingConfirm';
  rt.stepTask = null;
  rt.stepOutput = '';
  advanceRotationCursor(project, rt, phase, stateRunnerFor(project, rt));
  appendLog(
    project.id,
    'system',
    phase === 'planQuestions'
      ? '✓ Questions ready; waiting for the user\'s answer.'
      : '✓ Plan ready; waiting for user confirmation.'
  );
  emitState();
  scheduleTick();
}

// The runner that ran the closing step; rotation cursor bookkeeping needs it.
function stateRunnerFor(project, rt) {
  return getRunner(rt.activeRunner || '');
}

function handleClose(project, rt, code, task, phase, runner) {
  try {
    if (code !== 0 && runner && runner.isRateLimit && runner.isRateLimit(rt.stepOutput)) {
      const pauseMs = rateLimitPauseMs();
      const saturated = modelsFor(project, phase, runner)[rt.modelIndex] || '';
      if (saturated) rotationStore.markCooling(saturated, Date.now() + pauseMs);
      rt.status = 'rateLimited';
      rt.resumeAt = Date.now() + pauseMs;
      rt.nextPhase = phase;
      appendLog(project.id, 'system', `All candidates rate limited; next retry in ${Math.round(pauseMs / 1000)}s.`);
      rateLimitRetry(project, rt, pauseMs);
      emitState();
      return;
    }
    if (code !== 0) {
      rt.status = 'error';
      rt.active = false;
      rt.error = `${phase} step exited with code ${code}`;
      writeCheckpointIntent(project, rt);
      appendLog(project.id, 'system', `✖ ${rt.error}`);
      emitState();
      return;
    }

    if (phase === 'planQuestions' || phase === 'planWrite') {
      handlePlanPromptClose(project, rt, task, phase);
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
      stampHandoffTask(project, task.text);
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
      const cooloffMs = cooloffMsFor(project);
      if (cooloffMs > 0) {
        rt.cooloffUntil = Date.now() + cooloffMs;
        appendLog(project.id, 'system', `Cooloff ${cooloffMs / 1000}s.`);
      }
    }

    advanceRotationCursor(project, rt, phase, runner);
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
  // A waiting plan project must never spawn from the loop: only an answer PUT
  // or plan-confirm advance it.
  if (WAITING_STATUSES.has(rt.status)) return;
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
    let phase = rt.nextPhase || 'seed';
    // Plan prompt-type branch: when the engine is about to run the initial
    // seed step for a "(plan)" task, run the planQuestions phase instead. The
    // marker stays in the task text for the agent. Analyze/implement on later
    // tasks keep the normal flow untouched.
    if (phase === 'seed' && planLib.isPlanTask(task.text)) {
      phase = 'planQuestions';
      rt.nextPhase = 'planQuestions';
    }
    const runKey = runKeyFor(project, phase, task.text);
    const runnerList = effectiveRunnerList(project);
    const runnerRotating = runnerList.length > 1 && effectiveRunnerRotation(project);
    if (rt.forcedRunnerId) {
      runner = getRunner(rt.forcedRunnerId);
      rt.forcedRunnerId = '';
      rt.runnerIndex = Math.max(0, runnerList.indexOf(runner ? runner.id : ''));
    } else {
      const runnerPick = runnerRotating
        ? pickRunner(project, phase, runnerList)
        : { id: runnerList[0], index: 0, waitMs: 0 };
      if (runnerPick.waitMs > 0) {
        rt.status = 'rateLimited';
        rt.resumeAt = Date.now() + runnerPick.waitMs;
        rt.nextPhase = rt.nextPhase || 'seed';
        appendLog(project.id, 'system', `All runners cooling down; next ready in ${Math.ceil(runnerPick.waitMs / 1000)}s.`);
        emitState();
        return;
      }
      runner = getRunner(runnerPick.id);
      rt.runnerIndex = Math.max(0, runnerPick.index);
    }
    if (!runner) throw new Error(`Runner "${project.runner || config.settings.globalRunner}" is not registered`);

    const loopDir = path.join(project.path, '.looparr');
    fs.mkdirSync(loopDir, { recursive: true });
    const promptFile = path.join(loopDir, 'next_prompt.txt');
    let prompt;
    let files = [];
    if (phase === 'seed' || phase === 'planQuestions') {
      if (phase === 'seed') {
        prompt = renderPrompt('seedPromptTemplate', { task: task.text, planPath: plan.planPath });
        files = [];
        try { fs.unlinkSync(promptFile); } catch { /* no stale handoff */ }
        try { fs.unlinkSync(handoffTaskPath(project)); } catch { /* no stale handoff */ }
      } else {
        // planQuestions: fresh session, stale handoffs cleared, questions land
        // in .looparr/next_prompt.txt for the Question handoff UI.
        prompt = renderPrompt('planQuestionsPromptTemplate', { task: task.text, planPath: plan.planPath });
        files = [];
        try { fs.unlinkSync(promptFile); } catch { /* no stale handoff */ }
        try { fs.unlinkSync(handoffTaskPath(project)); } catch { /* no stale handoff */ }
      }
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
      if (phase === 'analyze') rt.planPhaseSnapshot = null;
      prompt = renderPrompt(
        phase === 'analyze'
          ? 'analyzePromptTemplate'
          : phase === 'planWrite'
            ? 'planWritePromptTemplate'
            : 'implementPromptTemplate',
        { task: task.text, handoff }
      );
      if (phase === 'planWrite') {
        // Fresh sessions only: never pass a stored OpenCode session into a
        // plan phase, and snapshot plan.md/PLAN docs for exit validation.
        rt.resumeSessionId = '';
        rt.opencodeSessionId = '';
        rt.planPhaseSnapshot = snapshotPlanForPlanWrite(project, task.text);
      }
    }

    let continuationMessage = '';
    if (rt.restartContinuePending) {
      if (phase !== 'seed') continuationMessage = consumeRestartContinueMessage();
      rt.restartContinuePending = false;
    }
    const preamble = promptPreamble(continuationMessage);
    // Future: append enabled promptSnippets here (see .project_documents/RESEARCH-prompt-snippets.md).
    if (preamble) prompt = `${preamble}\n\n${prompt}`;

    rt.status = phase;
    rt.currentTask = task.text;
    rt.stepTask = task;
    rt.stepOutput = '';
    rt.resumeAt = null;
    const resumeSessionId = runner.id === 'opencode' ? normalizeOpenCodeSessionId(rt.resumeSessionId) : '';
    rt.opencodeSessionId = resumeSessionId;
    writeCheckpointIntent(project, rt);
    appendLog(project.id, 'system', `▶ ${phase.toUpperCase()} — ${task.text}`);
    emitState();

    const url = runner.ensureServer ? await runner.ensureServer() : null;
    const modelField = configStore.modelFieldForPhase(phase);
    const configuredModels = effectiveModelList(project, phase);
    // Model ids are scoped per runner, so an inherited or stale id for another
    // provider can never reach this runner's CLI. When no configured id fits,
    // fall back to the runner's first free catalogue id instead of a blank id.
    const resolvedModels = resolveRunnerModels(runner, configuredModels, {
      onSkip: (droppedModels) => {
        appendLog(
          project.id,
          'system',
          `Skipped model ids not valid for ${runner.label}: ${droppedModels.join(', ')}`
        );
      },
      onFallback: (fallback) => {
        appendLog(
          project.id,
          'system',
          `No compatible configured model for ${runner.label}; using free default ${fallback}.`
        );
      }
    });
    const models = resolvedModels.models;
    const rotating = models.length > 1 && configStore.resolveRotation(project, config.settings, modelField);
    const isFallbackRetry = rt.modelFallbackPending === true && rt.modelAttemptRunKey === runKey;
    rt.modelFallbackPending = false;
    if (rt.modelAttemptRunKey !== runKey) {
      rt.modelAttemptRunKey = runKey;
      rt.modelIndex = 0;
      rt.tried = new Set();
      rt.rateLimitBackoffKey = '';
    }
    if (rotating && !isFallbackRetry) {
      const picked = rotationStore.pick(models);
      if (picked.waitMs > 0) {
        rt.status = 'rateLimited';
        rt.resumeAt = Date.now() + picked.waitMs;
        rt.nextPhase = phase;
        appendLog(project.id, 'system', `All models cooling down; next ready in ${Math.ceil(picked.waitMs / 1000)}s.`);
        emitState();
        return;
      }
      rt.modelIndex = Math.max(0, picked.index);
    } else if (rt.modelIndex >= models.length) {
      rt.modelIndex = 0;
    }
    const model = models[rt.modelIndex] || '';
    let positionNote = '';
    if (rotating) positionNote = ` (rotation ${rt.modelIndex + 1}/${models.length})`;
    else if (models.length > 1) positionNote = ` (fallback ${rt.modelIndex + 1}/${models.length})`;
    rt.activeRunner = runner.id;
    rt.activeModel = model;
    if (runnerRotating) {
      appendLog(project.id, 'system', `Runner: ${runner.label} (rotation ${rt.runnerIndex + 1}/${runnerList.length})`);
    } else if (runnerList.length > 1) {
      appendLog(project.id, 'system', `Runner: ${runner.label}`);
    }
    appendLog(project.id, 'system', `Model: ${model || defaultModelLabel(runner)}${positionNote}`);
    await spawnRunnerAttempt(project, rt, runner, {
      prompt,
      url,
      files,
      model,
      runKey,
      phase,
      task,
      sessionId: resumeSessionId,
      models
    });
    rt.resumeSessionId = '';
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
    // Waiting plan states are only advanced by an answer PUT or plan-confirm.
    if (WAITING_STATUSES.has(rt.status)) return false;
    return rt.active && !rt.paused && !rt.child && !rt.starting && !rt.resumeAt && rt.status !== 'done' && rt.status !== 'error' && (!rt.cooloffUntil || Date.now() >= rt.cooloffUntil);
  });
}

function tick() {
  logStore.prune(); // self-throttled to once per hour
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
    if (rt.cooloffUntil && rt.active && !rt.paused && Date.now() >= rt.cooloffUntil) {
      rt.cooloffUntil = null;
      emitState();
    }
  }
  const now = Date.now();
  if (now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
    lastCheckpointAt = now;
    for (const project of config.projects) writeCheckpointIntent(project, ensureRuntime(project));
  }
  if (now - lastHandoffRecoveryAt >= HANDOFF_RECOVERY_INTERVAL_MS) {
    lastHandoffRecoveryAt = now;
    // Async: the active-session probe hits the host executor. Errors stay local
    // to this sweep and never break the tick.
    runHandoffRecoverySweep().catch(() => {});
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
  const opencodeRunner = getRunner('opencode');
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
    const currentTask = rt.currentTask || '';
    const runKey = currentTask ? runKeyFor(project, phase, currentTask) : '';
    try {
      const cancelResult = opencodeRunner && typeof opencodeRunner.cancelStaleRuns === 'function'
        ? await opencodeRunner.cancelStaleRuns({ projectId: project.id, cwd: project.path, keepRunKey: null })
        : { ok: true, cancelled: [] };
      const cancelledCount = Array.isArray(cancelResult.cancelled) ? cancelResult.cancelled.length : 0;
      autoResume.appendAudit(project, 'executor-runs-cancelled', {
        phase,
        task: currentTask,
        reason: captureReason,
        cause: `count=${cancelledCount}`
      });
    } catch (error) {
      autoResume.appendAudit(project, 'executor-runs-cancelled', {
        phase,
        task: currentTask,
        reason: captureReason,
        cause: `error:${String(error && error.message || 'unknown').slice(0, 120)}`
      });
    }
    const written = autoResume.writeIntent(project, {
      reason: captureReason,
      nextPhase: phase,
      status: rt.status,
      currentTask,
      resumeAt: rt.resumeAt,
      runKey: runKey || undefined,
      opencodeSessionId: normalizeOpenCodeSessionId(rt.opencodeSessionId) || undefined,
      pid: process.pid,
      hostname: process.env.HOSTNAME || ''
    });
    if (!written.ok) {
      result.skipped.push({ id: project.id, reason: 'write-failed' });
      continue;
    }
    autoResume.appendAudit(project, 'about-to-resume', {
      phase,
      task: currentTask,
      reason: captureReason
    });
    await quiesceChild(rt);
    rt.child = null;
    rt.starting = false;
    rt.paused = true;
    emitState();
    autoResume.appendAudit(project, 'resume-child-quiesced', {
      phase,
      task: currentTask,
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

async function resumeOnStart() {
  cleanOrphanIntents();
  const opencodeRunner = getRunner('opencode');
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
    const sessionId = normalizeOpenCodeSessionId(intent.opencodeSessionId);
    let sessionUsable = Boolean(sessionId);
    let sessionCause = sessionId ? 'session-resumed' : '';
    if (intent.opencodeSessionId && !sessionId) {
      sessionUsable = false;
      sessionCause = 'session-invalid';
    }
    let phase = autoResume.PHASES.has(intent.nextPhase) ? intent.nextPhase : 'seed';
    // Waiting plan states are not PHASES phases: they ride the checkpointed
    // status field and are restored only after the intent validates.
    const waitingStatus = intent.status === 'waitingAnswer' || intent.status === 'waitingConfirm'
      ? intent.status
      : '';
    let taskText = '';
    try {
      const plan = planLib.readPlan(project.path);
      if (!plan.ok || !plan.next || !plan.next.text) {
        auditStaleIntent(project, intent);
        continue;
      }
      // waitingConfirm parks the project after the original "(plan)" line was
      // replaced or marked done, so plan.next is a generated task: the
      // checkpointed task text, not plan.next, owns the resume.
      taskText = waitingStatus === 'waitingConfirm' ? intent.currentTask : plan.next.text;
      if (!taskText) {
        auditStaleIntent(project, intent);
        continue;
      }
      // Plan prompt-type intents resolve before the seed/analyze/implement
      // checks: planQuestions needs no handoff, and planWrite without a usable
      // handoff or provenance degrades to a fresh planQuestions run.
      const isPlanPhaseIntent = intent.nextPhase === 'planQuestions' || intent.nextPhase === 'planWrite';
      const resumeHandoffPresent = (() => {
        try { return Boolean(fs.readFileSync(answerPath(project), 'utf8').trim()); } catch { return false; }
      })();
      if (isPlanPhaseIntent) {
        phase = intent.nextPhase;
        sessionUsable = false;
        sessionCause = 'plan-phase-fresh-session';
        if (intent.nextPhase === 'planWrite' && !resumeHandoffPresent) {
          phase = 'planQuestions';
          autoResume.appendAudit(project, 'resume-degraded', {
            phase, task: taskText, reason: intent.reason, cause: 'plan-handoff-missing'
          });
        } else if (resumeHandoffPresent && readHandoffTask(project) !== taskText) {
          clearHandoff(project);
          sessionCause = 'plan-handoff-stale';
          phase = 'planQuestions';
          autoResume.appendAudit(project, 'resume-degraded', {
            phase, task: taskText, reason: intent.reason, cause: 'handoff-provenance-mismatch'
          });
        }
      } else if (phase !== 'seed') {
        if (!resumeHandoffPresent) {
          phase = 'seed';
          sessionUsable = false;
          sessionCause = sessionId ? 'session-missing' : '';
          autoResume.appendAudit(project, 'resume-degraded', {
            phase, task: taskText, reason: intent.reason
          });
        }
      }
      // A restart checkpoint must never push a handoff written for another
      // task into analyze/implement: the run would execute a stale or wrong
      // implementation prompt. Old checkpoints and unknown provenance degrade
      // to a fresh seed, which also clears the stale handoff. Plan intents
      // handled their provenance above.
      if (!isPlanPhaseIntent && phase !== 'seed' && readHandoffTask(project) !== taskText) {
        phase = 'seed';
        sessionUsable = false;
        sessionCause = sessionId ? 'session-missing' : '';
        clearHandoff(project);
        autoResume.appendAudit(project, 'resume-degraded', {
          phase, task: taskText, reason: intent.reason, cause: 'handoff-provenance-mismatch'
        });
      }
      if (intent.currentTask !== taskText) {
        autoResume.appendAudit(project, 'resume-degraded', {
          phase, task: taskText, reason: intent.reason, cause: 'task-no-longer-next'
        });
        phase = 'seed';
        sessionUsable = false;
        sessionCause = sessionId ? 'session-missing' : '';
        clearHandoff(project);
      }
      try {
        if (opencodeRunner && typeof opencodeRunner.listActiveRuns === 'function') {
          const activeRuns = await opencodeRunner.listActiveRuns({ projectId: project.id, cwd: project.path });
          if (Array.isArray(activeRuns) && activeRuns.length > 0) {
            const cancelled = opencodeRunner.cancelStaleRuns
              ? await opencodeRunner.cancelStaleRuns({ projectId: project.id, cwd: project.path, keepRunKey: null })
              : { cancelled: [] };
            const cancelledKeys = Array.isArray(cancelled.cancelled) ? cancelled.cancelled.map((c) => c.runKey).filter(Boolean) : [];
            autoResume.appendAudit(project, 'resume-dedupe-cancel', {
              phase,
              task: taskText,
              reason: intent.reason,
              cause: `cancelled=${cancelledKeys.join(',') || '0'}`
            });
          }
        }
      } catch (error) {
        autoResume.appendAudit(project, 'resume-dedupe-cancel', {
          phase,
          task: taskText,
          reason: intent.reason,
          cause: `error:${String(error && error.message || 'unknown').slice(0, 120)}`
        });
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
      rt.restartContinuePending = phase !== 'seed';
      rt.opencodeSessionId = sessionUsable ? sessionId : '';
      rt.resumeSessionId = '';
      if (phase === 'planQuestions' || phase === 'planWrite') {
        // Plan phases always run a fresh runner session across restarts.
        rt.opencodeSessionId = '';
        rt.resumeSessionId = '';
        sessionUsable = false;
        if (sessionId) sessionCause = 'plan-phase-fresh-session';
      }
      // Restore the serializable snapshot only when the intent was not degraded
      // (phase still equals the intent's phase) and this is not a plan phase.
      // Provenance and TTL already validated above; the snapshot never overrides
      // those gates.
      const isPlanPhaseResume = phase === 'planQuestions' || phase === 'planWrite';
      const snap = intent.snapshot;
      if (snap && !isPlanPhaseResume && phase === intent.nextPhase) {
        if (snap.stepTask && Number.isInteger(snap.stepTask.index)) rt.stepTask = snap.stepTask;
        if (typeof snap.stepOutput === 'string') rt.stepOutput = snap.stepOutput;
        if (Number.isInteger(snap.modelIndex) && snap.modelIndex >= 0) rt.modelIndex = snap.modelIndex;
        if (typeof snap.modelAttemptRunKey === 'string') rt.modelAttemptRunKey = snap.modelAttemptRunKey;
        if (typeof snap.rateLimitBackoffKey === 'string') rt.rateLimitBackoffKey = snap.rateLimitBackoffKey;
        if (Number.isFinite(snap.cooloffUntil) && snap.cooloffUntil > 0) rt.cooloffUntil = snap.cooloffUntil;
        if (snap.rotationCursor && typeof snap.rotationCursor === 'object') rt.rotationCursor = snap.rotationCursor;
        if (typeof snap.resumeSessionId === 'string' && snap.resumeSessionId) rt.resumeSessionId = snap.resumeSessionId;
        if (snap.planPhaseSnapshot && typeof snap.planPhaseSnapshot === 'object') rt.planPhaseSnapshot = snap.planPhaseSnapshot;
      }
      appendLog(project.id, 'system', `↻ Auto-resume after restart (phase ${phase}).`);
      if (waitingStatus && (phase === 'planWrite' || phase === 'analyze')) {
        // Restore the human-gated state instead of spawning: an answer PUT
        // (planWrite) or POST plan-confirm (analyze) resumes the flow.
        rt.resumeAt = null;
        rt.status = waitingStatus;
        rt.opencodeSessionId = '';
        rt.resumeSessionId = '';
        emitState();
      } else if (intent.status === 'paused') {
        // A project paused before restart must not wake up running: honor the
        // user's pause across restarts.
        rt.paused = true;
        rt.resumeAt = null;
        rt.status = 'paused';
        rt.opencodeSessionId = '';
        rt.resumeSessionId = '';
        if (sessionId && sessionUsable) sessionCause = 'session-missing';
        emitState();
      } else if (intent.resumeAt && intent.resumeAt > Date.now()) {
        rt.resumeAt = intent.resumeAt;
        rt.status = 'rateLimited';
        rt.opencodeSessionId = '';
        rt.resumeSessionId = '';
        if (sessionId && sessionUsable) sessionCause = 'session-missing';
        emitState();
      } else {
        rt.resumeAt = null;
        rt.status = 'idle';
        rt.resumeSessionId = sessionUsable ? sessionId : '';
        rt.opencodeSessionId = sessionUsable ? sessionId : '';
        if (sessionId && !sessionUsable) sessionCause = 'session-missing';
        start(project.id);
      }
      autoResume.appendAudit(project, 'resume-on-start', {
        phase, task: taskText, reason: intent.reason,
        ...(sessionCause ? { cause: sessionCause } : {})
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
  logStore.prune();
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
  logStore.closeAll();
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
  isWaitingForAnswer,
  onAnswerSaved,
  confirmPlan,
  planDocSlug,
  WAITING_STATUSES,
  hasHandoff,
  shouldReseedOnStart,
  handoffReadyForResume,
  applyHandoffRecovery,
  runHandoffRecoverySweep,
  HANDOFF_RECOVERY_INTERVAL_MS,
  start,
  pause,
  stop,
  prepareShutdownResume,
  runKeyFor,
  resumeOnStart,
  writeCheckpointIntent,
  snapshotRuntime,
  promptPreamble,
  isMetaPromptHandoff,
  renderPrompt,
  iconVersionFor,
  refreshIcon
};
