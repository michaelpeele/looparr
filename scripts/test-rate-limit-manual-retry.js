#!/usr/bin/env node
'use strict';

// Regression test for the manual Retry no-op while rate limited: a manual
// start must clear the backoff immediately and run the next step, while a
// non-manual (auto-resume) start still honors the countdown. A second project's
// backoff must be left untouched.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-rate-limit-manual-retry-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const TASK = 'Fix rate-limited Retry no-op';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

// The fake runner fails once per project (a genuine 429, exit 1) by consuming a
// `.looparr/ratelimit-once` marker, then succeeds and writes the phase handoff.
function runnerScript() {
  return `
const fs = require('fs');
const path = require('path');
const phase = process.env.FAKE_PHASE || '';
const dir = path.join(process.cwd(), '.looparr');
fs.mkdirSync(dir, { recursive: true });
const marker = path.join(dir, 'ratelimit-once');
if (fs.existsSync(marker)) {
  fs.unlinkSync(marker);
  process.stdout.write('SessionError: [429]: Tokens per minute limit exceeded - too many tokens processed. (reset after 1m)\\n');
  process.exit(1);
}
if (phase === 'seed') fs.writeFileSync(path.join(dir, 'next_prompt.txt'), 'Analyze the current task and write an implementation prompt.');
else if (phase === 'analyze') fs.writeFileSync(path.join(dir, 'next_prompt.txt'), 'Implement the task in public/index.html and commit.');
process.stdout.write('ok\\n');
process.exit(0);
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

function seedProjectDir(name) {
  const projectDir = path.join(PROJECTS_ROOT, name);
  const handoffDir = path.join(projectDir, '.looparr');
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'plan.md'), `# Plan\n\n- [ ] ${TASK}\n`);
  fs.writeFileSync(path.join(handoffDir, 'ratelimit-once'), 'fail once\n');
  return projectDir;
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  process.env.CONFIG_PATH = CONFIG_PATH;
  process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
  process.env.HOSTNAME = 'test-host';

  let engine = null;
  try {
    const configStore = loadFresh('../src/config.js');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ settings: configStore.DEFAULT_SETTINGS }, null, 2));

    const runners = loadFresh('../src/runners/index.js');
    runners.registerRunner({
      id: 'opencode',
      label: 'Fake',
      description: 'Fake runner for rate-limit manual-retry test',
      ensureServer: async () => null,
      buildCommand: ({ cwd, ...payload }) => ({
        command: process.execPath,
        args: ['-e', runnerScript()],
        options: {
          cwd: cwd || process.cwd(),
          env: { ...process.env, FAKE_PHASE: payload.phase || '' },
          shell: false
        }
      }),
      isRateLimit: () => true
    });

    engine = loadFresh('../src/engine.js');

    const projectA = engine.addProject({
      name: 'Manual retry project',
      path: seedProjectDir('project-a'),
      runner: 'opencode'
    });
    const projectB = engine.addProject({
      name: 'Other project',
      path: seedProjectDir('project-b'),
      runner: 'opencode'
    });

    // Drive project B into rateLimited first so its backoff is established and
    // can be checked for independence after project A is retried.
    assert.strictEqual(engine.start(projectB.id), true);
    const bLimited = await waitFor(() => {
      const state = projectState(engine, projectB.id);
      return state && state.status === 'rateLimited' ? state : null;
    });
    const bResumeAt = bLimited.resumeAt;
    assert.ok(Number.isFinite(bResumeAt) && bResumeAt > Date.now(), 'project B backoff is in the future');

    // Drive project A into rateLimited with a future resumeAt.
    assert.strictEqual(engine.start(projectA.id), true);
    const aLimited = await waitFor(() => {
      const state = projectState(engine, projectA.id);
      return state && state.status === 'rateLimited' ? state : null;
    });
    const aResumeAt = aLimited.resumeAt;
    assert.ok(Number.isFinite(aResumeAt) && aResumeAt > Date.now(), 'project A backoff is in the future');

    // Non-manual start during the countdown is a no-op: returns true and leaves
    // the backoff untouched.
    assert.strictEqual(engine.start(projectA.id), true, 'non-manual start returns true');
    const aStillLimited = projectState(engine, projectA.id);
    assert.strictEqual(aStillLimited.status, 'rateLimited', 'non-manual start stays rate limited');
    assert.strictEqual(aStillLimited.resumeAt, aResumeAt, 'non-manual start keeps resumeAt');

    const logsBefore = aStillLimited.logs.length;

    // Manual start clears the backoff immediately and runs the next step.
    assert.strictEqual(engine.start(projectA.id, { manual: true }), true, 'manual start returns true');
    const aManual = projectState(engine, projectA.id);
    assert.strictEqual(aManual.resumeAt, null, 'manual start clears resumeAt');
    assert.notStrictEqual(aManual.status, 'rateLimited', 'manual start moves status off rateLimited');

    const aDone = await waitFor(() => {
      const state = projectState(engine, projectA.id);
      return state && state.status === 'done' ? state : null;
    });
    assert.ok(aDone.logs.length > logsBefore, 'manual retry produced new step logs');
    assert.ok(
      aDone.logs.filter((log) => String(log.text).startsWith('▶ SEED')).length >= 2,
      'seed step ran again after the manual retry'
    );

    // Project B's backoff is untouched by project A's manual retry.
    const bAfter = projectState(engine, projectB.id);
    assert.strictEqual(bAfter.status, 'rateLimited', 'project B still rate limited');
    assert.strictEqual(bAfter.resumeAt, bResumeAt, 'project B resumeAt unchanged');

    assert.strictEqual(engine.stop(projectA.id), true);
    assert.strictEqual(engine.stop(projectB.id), true);
    console.log('rate-limit manual retry tests passed');
  } finally {
    if (engine) {
      try {
        for (const project of engine.getState().projects) engine.stop(project.id);
      } catch { /* teardown best effort */ }
    }
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);