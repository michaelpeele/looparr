#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-start-reseed-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const MARKER_PATH = path.join(TEMP_DIR, 'runner-count.txt');
const TASK = 'Recover after implement error';
const OLD_HANDOFF = 'Implement the task in src/engine.js and run npm test.';
const FRESH_HANDOFF = 'Implement the recovered task and run npm test.';
const RESEED_LOG = '↻ Reseed — missing .looparr/next_prompt.txt after error.';
const HANDOFF_ERROR = 'No .looparr/next_prompt.txt for implement step';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function runnerScript() {
  return `
const fs = require('fs');
const path = require('path');
const marker = ${JSON.stringify(MARKER_PATH)};
const handoffPath = path.join(process.cwd(), '.looparr', 'next_prompt.txt');
let count = 0;
try { count = Number(fs.readFileSync(marker, 'utf8')) || 0; } catch {}
count += 1;
try {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, String(count));
} catch {}
if (count === 1) process.exit(1);
if (count === 2) {
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, ${JSON.stringify(FRESH_HANDOFF)});
  process.exit(0);
}
setInterval(() => {}, 1000);
`;
}

function projectState(engine, projectId) {
  const state = engine.getState();
  return state && state.projects && state.projects.find((item) => item.id === projectId);
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

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
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
      description: 'Fake runner for reseed regression test',
      ensureServer: async () => null,
      buildCommand: ({ cwd }) => ({
        command: process.execPath,
        args: ['-e', runnerScript()],
        options: { cwd: cwd || process.cwd(), env: process.env, shell: false }
      }),
      isRateLimit: () => false
    });

    engine = loadFresh('../src/engine.js');
    const autoResume = loadFresh('../src/auto-resume.js');

    const reseedCases = [
      [{ status: 'error', nextPhase: 'implement' }, false, true],
      [{ status: 'error', nextPhase: 'analyze' }, false, true],
      [{ status: 'error', nextPhase: 'implement' }, true, false],
      [{ status: 'error', nextPhase: 'seed' }, false, false],
      [{ status: 'error', nextPhase: 'done' }, false, false],
      [{ status: 'idle', nextPhase: 'implement' }, false, false]
    ];
    for (const [runtime, hasHandoffFile, expected] of reseedCases) {
      assert.strictEqual(
        engine.shouldReseedOnStart(runtime, hasHandoffFile),
        expected,
        `wrong reseed decision for ${runtime.status}/${runtime.nextPhase}/${hasHandoffFile}`
      );
    }

    const projectDir = path.join(PROJECTS_ROOT, 'reseed-project');
    const handoffPath = path.join(projectDir, '.looparr', 'next_prompt.txt');
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'plan.md'), `# Plan\n\n- [ ] ${TASK}\n`);

    fs.writeFileSync(handoffPath, '  \n\t ');
    assert.strictEqual(engine.hasHandoff({ path: projectDir }), false);
    fs.writeFileSync(handoffPath, OLD_HANDOFF);
    assert.strictEqual(engine.hasHandoff({ path: projectDir }), true);
    fs.rmSync(handoffPath, { force: true });
    assert.strictEqual(engine.hasHandoff({ path: projectDir }), false);

    const project = engine.addProject({
      name: 'Reseed project',
      path: projectDir,
      runner: 'opencode',
      autoResumeOnStart: true
    });
    fs.writeFileSync(handoffPath, OLD_HANDOFF);
    autoResume.writeIntent(project, {
      reason: 'planned-restart',
      nextPhase: 'implement',
      status: 'error',
      error: 'implement step exited with code 1',
      currentTask: TASK
    });
    engine.resumeOnStart();

    const errorState = await waitFor(() => {
      const state = projectState(engine, project.id);
      return state && state.status === 'error' && state.nextPhase === 'implement' ? state : null;
    });
    assert.strictEqual(errorState.active, false);
    assert.ok(!errorState.logs.some((log) => log.text.includes(HANDOFF_ERROR)));

    fs.rmSync(handoffPath, { force: true });
    assert.strictEqual(engine.hasHandoff({ path: projectDir }), false);

    assert.strictEqual(engine.start(project.id), true);
    const afterStart = projectState(engine, project.id);
    assert.strictEqual(afterStart.nextPhase, 'seed');
    assert.strictEqual(afterStart.status, 'idle');

    const recovered = await waitFor(() => {
      const state = projectState(engine, project.id);
      if (!state) return null;
      const texts = state.logs.map((log) => log.text);
      const handoffError = texts.some((text) => text.includes(HANDOFF_ERROR));
      if (handoffError) throw new Error(`unexpected error: ${HANDOFF_ERROR}`);
      if (!texts.includes(RESEED_LOG)) return null;
      if (!texts.includes(`▶ SEED — ${TASK}`)) return null;
      if (!texts.includes(`▶ ANALYZE — ${TASK}`)) return null;
      return state;
    });

    const reseedIndex = recovered.logs.findIndex((log) => log.text === RESEED_LOG);
    const seedIndex = recovered.logs.findIndex((log) => log.text === `▶ SEED — ${TASK}`);
    assert.ok(reseedIndex >= 0 && seedIndex > reseedIndex, 'reseed log must precede SEED');
    assert.strictEqual(recovered.logs.find((log) => log.text === RESEED_LOG).stream, 'system');
    assert.strictEqual(fs.readFileSync(handoffPath, 'utf8'), FRESH_HANDOFF);

    const checkpoint = await waitFor(() => {
      const checked = autoResume.readIntent(project);
      return checked.ok && checked.intent.reason === 'checkpoint' ? checked.intent : null;
    });
    assert.strictEqual(checkpoint.currentTask, TASK);
    assert.ok(autoResume.PHASES.has(checkpoint.nextPhase), 'checkpoint phase must be valid');
    assert.strictEqual(engine.stop(project.id), true);
    assert.strictEqual(fs.existsSync(autoResume.statePath(project)), false);

    const externalTask = 'External plan edit clears stale handoff';
    const externalDir = path.join(PROJECTS_ROOT, 'external-plan-project');
    const externalPlan = path.join(externalDir, 'plan.md');
    const externalHandoff = path.join(externalDir, '.looparr', 'next_prompt.txt');
    fs.mkdirSync(path.dirname(externalPlan), { recursive: true });
    fs.writeFileSync(externalPlan, `# Plan\n\n- [ ] ${externalTask}\n`);
    const externalProject = engine.addProject({
      name: 'External plan project',
      path: externalDir,
      runner: 'opencode',
      autoResumeOnStart: true
    });
    assert.strictEqual(engine.start(externalProject.id), true);
    await waitFor(() => {
      const state = projectState(engine, externalProject.id);
      return state && state.currentTask === externalTask ? state : null;
    });
    fs.writeFileSync(externalHandoff, 'stale handoff after external edit', 'utf8');
    assert.strictEqual(engine.pause(externalProject.id), true);
    fs.writeFileSync(externalPlan, `# Plan\n\n- [x] ${externalTask}\n`);

    const reconciled = await waitFor(() => {
      const state = projectState(engine, externalProject.id);
      if (!state) return null;
      if (state.currentTask !== '' || state.nextTask !== '' || state.nextPhase !== 'seed') return null;
      if (fs.existsSync(externalHandoff) || fs.existsSync(autoResume.statePath(externalProject))) return null;
      return state;
    }, 10000);
    assert.strictEqual(reconciled.active, true);
    assert.strictEqual(reconciled.paused, true);

    console.log('test-start-reseed: ok');
  } finally {
    if (engine) await engine.shutdown();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
