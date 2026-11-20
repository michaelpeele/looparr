'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

const configStore = require('./config');
const bus = require('./events');
const planLib = require('./plan');
const iconLib = require('./icon');
const { getRunner, listRunners } = require('./runners');

const config = configStore.loadConfig();
const runtime = new Map();
const watchers = new Map();
const LOG_LIMIT = 400;
let logSeq = 0;
let tickTimer = null;
let roundRobinCursor = 0;

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      stepTask: null,
      stepOutput: '',
      icon: null
    };
    runtime.set(project.id, rt);
    rt.icon = iconLib.findIcon(project.path);
  }
  return rt;
}

function findProject(id) {
  return config.projects.find((project) => project.id === id) || null;
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
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        runner: project.runner || config.settings.globalRunner,
        status,
        active: rt.active,
        paused: rt.paused,
        pauseRequested: rt.pauseAfterStep,
        currentTask: rt.currentTask || '',
        nextTask: plan.next ? plan.next.text : '',
        progress: plan.stats,
        icon: rt.icon ? rt.icon.relativePath : null,
        resumeAt: rt.resumeAt,
        error: rt.error || (plan.ok ? '' : `plan.md: ${plan.error}`),
        logs: rt.logs.slice(-200)
      };
    })
  };
}

function watchProject(project) {
  if (watchers.has(project.id)) return;
  const ignored = (candidate) => /(^|\/)(\.git|node_modules|\.looparr)($|\/)/.test(String(candidate));
  const watcher = chokidar.watch(project.path, { ignored, ignoreInitial: true, depth: 4 });
  watcher.on('all', (event, filePath) => {
    const relative = path.relative(project.path, filePath).split(path.sep).join('/');
    if (relative === 'plan.md') {
      emitState();
      return;
    }
    const rt = ensureRuntime(project);
    const found = iconLib.findIcon(project.path);
    const before = rt.icon ? rt.icon.relativePath : null;
    const after = found ? found.relativePath : null;
    if (before !== after) {
      rt.icon = found;
      appendLog(project.id, 'system', `Icon detected: ${after}`);
      emitState();
    }
  });
  watchers.set(project.id, watcher);
}

function save() {
  configStore.saveConfig(config);
}

function addProject(input) {
  const project = {
    id: newId(),
    name: input.name,
    path: input.path,
    runner: input.runner || config.settings.globalRunner
  };
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

function getPlan(id) {
  const project = findProject(id);
  if (!project) return null;
  return planLib.readPlan(project.path);
}

function writePlan(id, content) {
  const project = findProject(id);
  if (!project) return false;
  planLib.writePlan(project.path, content);
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
  emitState();
  scheduleTick();
  return true;
}

function seedPrompt(taskText) {
  return [
    'Looparr SEED step. Fresh session. Work only inside the current project directory.',
    'Read @plan.md (attached; also available as plan.md on disk).',
    `First unchecked task: "${taskText}"`,
    '',
    'Write a concise analysis prompt for the next AI agent.',
    'The prompt must restate the task, name the likely files, list risks, and ask for a detailed implementation prompt.',
    'Write ONLY that prompt to .looparr/next_prompt.txt (create .looparr/ if needed).',
    'Do not edit plan.md. Do not implement code.'
  ].join('\n');
}

function analyzePrompt(taskText, handoff) {
  return [
    'Looparr ANALYZE step. Fresh session. Work only inside the current project directory.',
    `Task: "${taskText}"`,
    'Execute this analysis prompt:',
    '---',
    handoff,
    '---',
    '',
    'Produce a detailed implementation prompt for the next fresh agent.',
    'Include exact files to change, concrete steps, tests, and acceptance criteria.',
    'Write ONLY the implementation prompt to .looparr/next_prompt.txt (overwrite it).',
    'Do not edit plan.md. Do not implement code.'
  ].join('\n');
}

function implementPrompt(taskText, handoff) {
  return [
    'Looparr IMPLEMENT step. Fresh session. Work only inside the current project directory.',
    `Task: "${taskText}"`,
    'Execute this implementation prompt:',
    '---',
    handoff,
    '---',
    '',
    'After implementation, change the "- [ ]" marker for this task to "- [x]" in plan.md.',
    'Do not touch .looparr/next_prompt.txt.'
  ].join('\n');
}

function shortCommand(command, args) {
  const preview = args.map((arg) => (arg.length > 90 ? `${arg.slice(0, 90)}…` : arg));
  return `$ ${command} ${preview.join(' ')}`;
}

function rateLimitRetry(project, rt, pauseMs) {
  appendLog(project.id, 'system', `Rate limit detected. Retrying in ${Math.round(pauseMs / 1000)}s.`);
  setTimeout(() => {
    if (runtime.get(project.id) !== rt || !rt.resumeAt) return;
    if (Date.now() < rt.resumeAt) return;
    rt.resumeAt = null;
    if (rt.active && !rt.paused) rt.status = 'idle';
    emitState();
    scheduleTick();
  }, pauseMs + 200);
}

function handleClose(project, rt, code, task, phase, runner) {
  try {
    const pauseSeconds = Math.max(5, Math.min(600, Number(config.settings.rateLimitPauseSeconds) || 60));
    const pauseMs = pauseSeconds * 1000;
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
      rt.nextPhase = phase === 'seed' ? 'analyze' : 'implement';
    } else {
      const current = planLib.readPlan(project.path);
      if (!current.ok) throw new Error(`plan.md disappeared: ${current.error}`);
      const updated = planLib.markTask(current.content, task.text, true);
      if (updated.ok && updated.changed) planLib.writePlan(project.path, updated.content);
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
      appendLog(project.id, 'system', 'All tasks complete.');
      emitState();
      return;
    }
    const phase = rt.nextPhase || 'seed';
    runner = getRunner(project.runner) || getRunner(config.settings.globalRunner) || getRunner('opencode');
    if (!runner) throw new Error(`Runner "${project.runner || config.settings.globalRunner}" is not registered`);

    const loopDir = path.join(project.path, '.looparr');
    fs.mkdirSync(loopDir, { recursive: true });
    const promptFile = path.join(loopDir, 'next_prompt.txt');
    let prompt;
    let files = [];
    if (phase === 'seed') {
      prompt = seedPrompt(task.text);
      files = [plan.planPath];
      try { fs.unlinkSync(promptFile); } catch { /* no stale handoff */ }
    } else {
      let handoff = '';
      try { handoff = fs.readFileSync(promptFile, 'utf8').trim(); } catch { /* missing */ }
      if (!handoff) throw new Error(`No .looparr/next_prompt.txt for ${phase} step`);
      prompt = phase === 'analyze' ? analyzePrompt(task.text, handoff) : implementPrompt(task.text, handoff);
    }

    rt.status = phase;
    rt.currentTask = task.text;
    rt.stepTask = task;
    rt.stepOutput = '';
    rt.resumeAt = null;
    appendLog(project.id, 'system', `▶ ${phase.toUpperCase()} — ${task.text}`);
    emitState();

    const url = runner.ensureServer ? await runner.ensureServer() : null;
    const built = runner.buildCommand({ prompt, cwd: project.path, url, files });
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
      handleClose(project, rt, code, task, phase, runner);
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

function init() {
  for (const project of config.projects) {
    ensureRuntime(project);
    watchProject(project);
  }
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
  getPlan,
  writePlan,
  setTaskChecked,
  getIcon,
  start,
  pause,
  stop
};
