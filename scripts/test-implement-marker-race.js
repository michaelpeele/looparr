#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-implement-marker-race-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const TASK = 'Fix early plan marker race';
const NEXT_TASK = 'Start the next task after completion';
const ANALYZE_HANDOFF = 'Analyze the task and write a safe implementation handoff.';
const IMPLEMENT_HANDOFF = 'Implement the task in src/engine.js and run npm test.';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function runnerScript(phase, readyPath, releasePath) {
  const handoff = phase === 'seed' ? ANALYZE_HANDOFF : IMPLEMENT_HANDOFF;
  return `
const fs = require('fs');
const path = require('path');
const phase = ${JSON.stringify(phase)};
const readyPath = ${JSON.stringify(readyPath)};
const releasePath = ${JSON.stringify(releasePath)};
if (phase === 'implement') {
  fs.mkdirSync(path.dirname(readyPath), { recursive: true });
  fs.writeFileSync(readyPath, 'ready');
  const deadline = Date.now() + 60000;
  const timer = setInterval(() => {
    if (fs.existsSync(releasePath) || Date.now() > deadline) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 50);
} else {
  const handoffPath = path.join(process.cwd(), '.looparr', 'next_prompt.txt');
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, ${JSON.stringify(handoff)});
  process.exit(0);
}
`;
}

function readyPathFor(key) {
  return path.join(TEMP_DIR, `${key}-implement-ready`);
}

function releasePathFor(key) {
  return path.join(TEMP_DIR, `${key}-implement-release`);
}

function projectState(engine, projectId) {
  const state = engine.getState();
  return state.projects.find((project) => project.id === projectId);
}

async function waitFor(getValue, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = getValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for expected state');
}

function createProject(engine, key, tasks) {
  const projectDir = path.join(PROJECTS_ROOT, key);
  const planPath = path.join(projectDir, 'plan.md');
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, `# Plan\n\n${tasks.map((task) => `- [ ] ${task}`).join('\n')}\n`);
  fs.rmSync(readyPathFor(key), { force: true });
  fs.rmSync(releasePathFor(key), { force: true });
  const project = engine.addProject({
    name: key,
    path: projectDir,
    runner: 'opencode',
    autoResumeOnStart: true
  });
  return { project, planPath, handoffPath: path.join(projectDir, '.looparr', 'next_prompt.txt') };
}

function markChecked(planPath, task) {
  const content = fs.readFileSync(planPath, 'utf8');
  const updated = content
    .split('\n')
    .map((line) => (line === `- [ ] ${task}` ? `- [x] ${task}` : line))
    .join('\n');
  assert.notStrictEqual(updated, content, `unchecked task not found: ${task}`);
  fs.writeFileSync(planPath, updated);
}

function hasPlanTask(planPath, task, checked) {
  return fs.readFileSync(planPath, 'utf8').includes(`- [${checked ? 'x' : ' '}] ${task}`);
}

function hasAudit(autoResume, project, event, cause) {
  let text = '';
  try {
    text = fs.readFileSync(autoResume.logPath(project), 'utf8');
  } catch {
    return false;
  }
  return text.split('\n').filter(Boolean).some((line) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    return entry.event === event && (!cause || entry.cause === cause);
  });
}

function hasCheckpoint(autoResume, project) {
  const result = autoResume.readIntent(project);
  return Boolean(result.ok && result.intent.reason === 'checkpoint');
}

function hasLog(state, text) {
  return state.logs.some((log) => log.text === text);
}

async function waitForImplement(engine, autoResume, project, key, task) {
  const readyPath = readyPathFor(key);
  return waitFor(() => {
    const state = projectState(engine, project.id);
    if (!state || state.status !== 'implement' || state.currentTask !== task) return null;
    if (!fs.existsSync(readyPath)) return null;
    return state;
  });
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  process.env.CONFIG_PATH = CONFIG_PATH;
  process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
  process.env.HOSTNAME = 'test-host';
  process.env.LOOPARR_ALLOW_RESUME_INTENT = '1';

  let engine = null;
  try {
    const configStore = loadFresh('../src/config.js');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ settings: configStore.DEFAULT_SETTINGS }, null, 2));

    const runners = loadFresh('../src/runners/index.js');
    runners.registerRunner({
      id: 'opencode',
      label: 'Fake',
      description: 'Fake runner for implement marker race regression test',
      ensureServer: async () => null,
      buildCommand: ({ cwd, phase }) => {
        const key = path.basename(path.resolve(cwd || process.cwd()));
        return {
          command: process.execPath,
          args: ['-e', runnerScript(phase, readyPathFor(key), releasePathFor(key))],
          options: { cwd: path.resolve(cwd || process.cwd()), env: process.env, shell: false }
        };
      },
      isRateLimit: () => false
    });

    engine = loadFresh('../src/engine.js');
    const autoResume = loadFresh('../src/auto-resume.js');

    const activeKey = 'active-implement-project';
    const active = createProject(engine, activeKey, [TASK]);
    assert.strictEqual(engine.start(active.project.id), true);
    await waitForImplement(engine, autoResume, active.project, activeKey, TASK);
    markChecked(active.planPath, TASK);

    await waitFor(() => (
      hasAudit(autoResume, active.project, 'plan-reconcile-preserved', 'task-checked-during-active-implement')
        ? true
        : null
    ));
    const preserved = projectState(engine, active.project.id);
    assert.strictEqual(preserved.status, 'implement');
    assert.strictEqual(preserved.currentTask, TASK);
    assert.strictEqual(preserved.nextPhase, 'implement');
    assert.ok(fs.existsSync(active.handoffPath), 'handoff must survive early marker');
    assert.ok(hasCheckpoint(autoResume, active.project), 'checkpoint must survive early marker');
    assert.strictEqual(
      hasAudit(autoResume, active.project, 'plan-reconcile-degraded', 'task-explicitly-checked'),
      false
    );

    fs.writeFileSync(releasePathFor(activeKey), 'release');
    const closed = await waitFor(() => {
      const state = projectState(engine, active.project.id);
      if (!state || state.currentTask !== '' || state.nextPhase !== 'seed' || state.status !== 'done') return null;
      if (!hasLog(state, `✓ Done: ${TASK}`)) return null;
      if (fs.existsSync(active.handoffPath) || hasCheckpoint(autoResume, active.project)) return null;
      return state;
    });
    assert.ok(hasPlanTask(active.planPath, TASK, true));
    assert.strictEqual(engine.stop(active.project.id), true);

    const pausedKey = 'paused-implement-project';
    const paused = createProject(engine, pausedKey, [TASK, NEXT_TASK]);
    assert.strictEqual(engine.start(paused.project.id), true);
    await waitForImplement(engine, autoResume, paused.project, pausedKey, TASK);
    assert.strictEqual(engine.pause(paused.project.id), true);
    markChecked(paused.planPath, TASK);

    await waitFor(() => (
      hasAudit(autoResume, paused.project, 'plan-reconcile-preserved', 'task-checked-during-active-implement')
        ? true
        : null
    ));
    const pausedPreserved = projectState(engine, paused.project.id);
    assert.strictEqual(pausedPreserved.status, 'paused');
    assert.strictEqual(pausedPreserved.currentTask, TASK);
    assert.strictEqual(pausedPreserved.nextPhase, 'implement');
    assert.ok(fs.existsSync(paused.handoffPath), 'handoff must survive paused early marker');
    assert.ok(hasCheckpoint(autoResume, paused.project), 'checkpoint must survive paused early marker');

    fs.writeFileSync(releasePathFor(pausedKey), 'release');
    const pausedClosed = await waitFor(() => {
      const state = projectState(engine, paused.project.id);
      if (!state || state.currentTask !== '' || state.nextTask !== NEXT_TASK) return null;
      if (state.nextPhase !== 'seed' || !hasLog(state, `✓ Done: ${TASK}`)) return null;
      if (fs.existsSync(paused.handoffPath) || hasCheckpoint(autoResume, paused.project)) return null;
      return state;
    });
    assert.strictEqual(pausedClosed.status, 'paused');
    assert.ok(hasPlanTask(paused.planPath, TASK, true));
    assert.ok(hasPlanTask(paused.planPath, NEXT_TASK, false));
    assert.strictEqual(engine.stop(paused.project.id), true);

    const manualKey = 'manual-plan-project';
    const manual = createProject(engine, manualKey, [TASK]);
    assert.strictEqual(engine.start(manual.project.id), true);
    await waitFor(() => {
      const state = projectState(engine, manual.project.id);
      return state && state.currentTask === TASK ? state : null;
    });
    fs.mkdirSync(path.dirname(manual.handoffPath), { recursive: true });
    fs.writeFileSync(manual.handoffPath, 'stale handoff after external edit');
    assert.strictEqual(engine.pause(manual.project.id), true);
    markChecked(manual.planPath, TASK);

    const manualClosed = await waitFor(() => {
      const state = projectState(engine, manual.project.id);
      if (!state || state.currentTask !== '' || state.nextTask !== '' || state.nextPhase !== 'seed') return null;
      if (fs.existsSync(manual.handoffPath) || hasCheckpoint(autoResume, manual.project)) return null;
      return state;
    });
    assert.strictEqual(manualClosed.active, true);
    assert.strictEqual(manualClosed.paused, true);
    assert.strictEqual(
      hasAudit(autoResume, manual.project, 'plan-reconcile-degraded', 'task-explicitly-checked'),
      true
    );
    assert.strictEqual(engine.stop(manual.project.id), true);

    console.log('test-implement-marker-race: ok');
  } finally {
    if (engine) await engine.shutdown();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
