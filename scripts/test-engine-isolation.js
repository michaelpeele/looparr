'use strict';

// Regression coverage: one errored project must never hold another project
// back. With maxConcurrent = 1 an errored project (even one still carrying
// stale child/sprint handles) must contribute 0 worker slots so a healthy
// project still starts in the same tick.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-engine-isolation-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');

process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

const runnersPath = require.resolve(path.join(REPO_ROOT, 'src/runners/index.js'));
const { registerRunner } = require(runnersPath);

// A runner whose child stays alive so a started project keeps a live rt.child.
registerRunner({
  id: 'opencode',
  label: 'isolation test runner',
  description: 'spawns a long-lived child so a started slot is observable',
  ensureServer: async () => null,
  buildCommand: ({ cwd }) => ({
    command: process.execPath,
    args: ['-e', 'setInterval(function(){}, 1e9)'],
    options: { cwd, env: { ...process.env } }
  }),
  isRateLimit: () => false
});

let engine = null;

function makeProjectDir(name) {
  const dir = path.join(PROJECTS_ROOT, name);
  fs.mkdirSync(path.join(dir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'), `- [ ] ${name} task one\n`, 'utf8');
  return dir;
}

function resetRuntime(rt) {
  if (rt.child) {
    try { rt.child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  for (const run of rt.sprintRuns) {
    if (run.child) {
      try { run.child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }
  rt.child = null;
  rt.sprintRuns = [];
  rt.sprintValidation = null;
  rt.starting = false;
  rt.active = false;
  rt.status = 'idle';
  rt.resumeAt = null;
  rt.cooloffUntil = null;
  rt.token += 1;
}

function staleChild() {
  return { exitCode: null, signalCode: null, kill() {} };
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

  const dirA = makeProjectDir('project-a');
  const dirB = makeProjectDir('project-b');

  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 1, mode: 'serial', cooloffSeconds: 0 },
    projects: [
      { id: 'a', name: 'project-a', path: dirA, runner: 'opencode', autoResumeOnStart: false },
      { id: 'b', name: 'project-b', path: dirB, runner: 'opencode', autoResumeOnStart: false }
    ]
  }, null, 2));

  // Engine reads config at require time, so load it only after the temp config
  // file exists.
  engine = require(path.join(REPO_ROOT, 'src/engine.js'));

  const projectA = { id: 'a' };
  const projectB = { id: 'b' };
  const rtA = engine.ensureRuntime(projectA);
  const rtB = engine.ensureRuntime(projectB);

  try {
    // Scenario 1: A errored with stale child + sprint handles. Those stale
    // handles must not consume the single slot; B must still start.
    resetRuntime(rtA);
    rtA.status = 'error';
    rtA.active = false;
    rtA.child = staleChild();
    rtA.sprintRuns = [{ child: staleChild() }];
    resetRuntime(rtB);
    rtB.active = true;
    rtB.status = 'idle';

    engine.tick();

    assert.ok(rtB.starting || rtB.child, 'scenario1: B started despite A error + stale handles');
    assert.equal(rtA.child, null, 'scenario1: A stale child handle released by tick');
    assert.ok(rtA.sprintRuns.every((run) => !run.child), 'scenario1: A stale sprint handles released by tick');

    await delay(200);
    resetRuntime(rtA);
    resetRuntime(rtB);
    await delay(50);

    // Scenario 2 (baseline): A errored with no stale handles. B still starts.
    resetRuntime(rtA);
    rtA.status = 'error';
    rtA.active = false;
    resetRuntime(rtB);
    rtB.active = true;
    rtB.status = 'idle';

    engine.tick();

    assert.ok(rtB.starting || rtB.child, 'scenario2: B started with baseline errored A');
    assert.equal(engine.maxWorkers(), 1, 'maxWorkers honours maxConcurrent = 1');

    await delay(200);
    console.log('engine isolation tests passed');
  } finally {
    engine.shutdown();
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });