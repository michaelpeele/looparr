#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-standby-plan-watch-guard-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const DEGRADE_EVENT = '"event":"plan-reconcile-degraded"';
const HANDOFF = 'Implement the active task and run the focused tests.';
const SETTLE_MS = 1200;

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(getValue, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = getValue();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('timed out waiting for plan watcher reconciliation');
}

function setStandby(enabled) {
  process.env.LOOPARR_SELFHEAL = '1';
  if (enabled) process.env.LOOPARR_SELFHEAL_STANDBY = '1';
  else delete process.env.LOOPARR_SELFHEAL_STANDBY;
}

function createFixtures(engine, autoResume, name, task) {
  const dir = path.join(PROJECTS_ROOT, name);
  const looparrDir = path.join(dir, '.looparr');
  const planPath = path.join(dir, 'plan.md');
  const handoffPath = path.join(looparrDir, 'next_prompt.txt');
  const handoffTaskPath = path.join(looparrDir, 'handoff_task.txt');
  fs.mkdirSync(looparrDir, { recursive: true });
  fs.writeFileSync(planPath, `# Plan\n\n- [ ] ${task}\n`);
  fs.writeFileSync(handoffPath, HANDOFF);
  fs.writeFileSync(handoffTaskPath, task);
  const project = engine.addProject({
    name,
    path: dir,
    runner: 'opencode',
    autoResumeOnStart: true
  });
  autoResume.writeIntent(project, {
    reason: 'checkpoint',
    nextPhase: 'implement',
    status: 'implement',
    currentTask: task
  });
  return { project, planPath, handoffPath, handoffTaskPath, task };
}

function touchPlan(fixture, marker) {
  fs.writeFileSync(
    fixture.planPath,
    `# Plan\n\n- [ ] ${fixture.task}\n\n<!-- ${marker} -->\n`
  );
}

function auditText(autoResume, project) {
  try {
    return fs.readFileSync(autoResume.logPath(project), 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  process.env.CONFIG_PATH = CONFIG_PATH;
  process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
  process.env.HOSTNAME = 'test-host';
  process.env.LOOPARR_ALLOW_RESUME_INTENT = '1';
  setStandby(false);

  let engine = null;
  try {
    const configStore = loadFresh('../src/config.js');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({
      settings: { ...configStore.DEFAULT_SETTINGS, selfHealing: true },
      projects: []
    }, null, 2));

    engine = loadFresh('../src/engine.js');
    const autoResume = loadFresh('../src/auto-resume.js');

    const activeTask = 'Guard standby handoff during plan watch';
    const active = createFixtures(engine, autoResume, 'active-project', activeTask);
    await sleep(SETTLE_MS);
    touchPlan(active, 'non-standby-edit');

    await waitFor(() => {
      const cleared = !fs.existsSync(active.handoffPath)
        && !fs.existsSync(active.handoffTaskPath)
        && !fs.existsSync(autoResume.statePath(active.project));
      return cleared && auditText(autoResume, active.project).includes(DEGRADE_EVENT) ? true : null;
    });
    assert.ok(
      auditText(autoResume, active.project).includes('"cause":"task-not-current"'),
      'non-standby reconcile must still degrade stale handoffs'
    );

    setStandby(true);
    const standbyTask = 'Preserve primary handoff from standby plan watch';
    const standby = createFixtures(engine, autoResume, 'standby-project', standbyTask);
    await sleep(SETTLE_MS);
    touchPlan(standby, 'standby-edit');
    await sleep(SETTLE_MS);

    assert.ok(fs.existsSync(standby.handoffPath), 'standby must not clear the primary handoff');
    assert.ok(fs.existsSync(standby.handoffTaskPath), 'standby must not clear handoff provenance');
    assert.ok(fs.existsSync(autoResume.statePath(standby.project)), 'standby must not clear the primary checkpoint intent');
    assert.ok(
      !auditText(autoResume, standby.project).includes(DEGRADE_EVENT),
      'standby plan watch must not log a degrade of the primary handoff'
    );
  } finally {
    if (engine) engine.shutdown();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
