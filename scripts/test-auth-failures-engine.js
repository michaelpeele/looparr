'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-auth-engine-'));
const CONFIG_PATH = path.join(DIR, 'config.json');
const PROJECTS_ROOT = path.join(DIR, 'projects');
const PROJECT_PATH = path.join(PROJECTS_ROOT, 'p1');
fs.mkdirSync(path.join(PROJECT_PATH, '.looparr'), { recursive: true });
fs.writeFileSync(path.join(PROJECT_PATH, 'plan.md'), '- [ ] task\n', 'utf8');

process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.LOOPARR_AUTH_FAILURES_STATE = path.join(DIR, 'auth-failures.json');
process.env.LOOPARR_ROTATION_STATE = path.join(DIR, 'rotation-state.json');
process.env.LOOPARR_ERROR_RECOVERY_STATE = path.join(DIR, 'error-recovery.json');
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  settings: {
    maxConcurrent: 1,
    mode: 'serial',
    cooloffSeconds: 0,
    runnerRotation: true,
    globalRunner: 'kilo'
  },
  projects: [
    { id: 'p1', name: 'p1', path: PROJECT_PATH, runner: 'kilo,opencode', runnerRotation: true, autoResumeOnStart: false }
  ]
}, null, 2));

const repo = path.resolve(__dirname, '..');
const runnersPath = require.resolve(path.join(repo, 'src/runners/index.js'));
const { registerRunner } = require(runnersPath);
registerRunner({ id: 'kilo', label: 'Kilo', isRateLimit: () => false, buildCommand: () => ({ command: 'true', args: [], options: {} }) });
registerRunner({ id: 'opencode', label: 'OpenCode', isRateLimit: () => false, buildCommand: () => ({ command: 'true', args: [], options: {} }) });

const engine = require(path.join(repo, 'src/engine.js'));

function resetAuth() {
  engine.authFailures.clear();
}

function makeProject() {
  return { id: 'p1', name: 'p1', path: PROJECT_PATH, runner: 'kilo,opencode', runnerRotation: true };
}

async function main() {
  try {
    const project = makeProject();
    const rt = engine.ensureRuntime(project);
    rt.stepOutput = 'HTTP 401 INVALID_TOKEN Your authentication token is invalid. Please sign in again.';
    rt.activeRunner = 'kilo';
    rt.currentTask = 'task';
    rt.stepTask = { index: 0, text: 'task' };

    // Failed close records while output present.
    engine.handleRecoverClose(project, rt, 1, { index: 0, text: 'task' }, { id: 'kilo', label: 'Kilo', isRateLimit: () => false });
    assert.equal(engine.authFailures.isBlocked('kilo'), true, 'failed close should record auth block');
    const rec = engine.authFailures.get('kilo');
    assert.equal(rec.runnerId, 'kilo');
    assert.match(rec.message, /invalid|token/i);

    // Transcript output must not record an auth block.
    resetAuth();
    rt.stepOutput = JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_test',
      input: { text: 'HTTP 401 INVALID_TOKEN. Please sign in again.' }
    });
    rt.activeRunner = 'kilo';
    rt.currentTask = 'task';
    rt.nextPhase = 'seed';
    rt.stepTask = { index: 0, text: 'task' };
    rt.status = 'recover';
    engine.handleRecoverClose(project, rt, 1, { index: 0, text: 'task' }, { id: 'kilo', label: 'Kilo', isRateLimit: () => false });
    assert.equal(engine.authFailures.isBlocked('kilo'), false, 'transcript close should not record auth block');

    // Success clears block.
    resetAuth();
    engine.authFailures.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN', hint: engine.authFailures.hintFor('kilo') });
    rt.stepOutput = '';
    rt.activeRunner = 'kilo';
    rt.currentTask = 'task';
    rt.nextPhase = 'seed';
    rt.stepTask = { index: 0, text: 'task' };
    rt.status = 'recover';
    engine.handleRecoverClose(project, rt, 0, { index: 0, text: 'task' }, { id: 'kilo', label: 'Kilo', isRateLimit: () => false });
    assert.equal(engine.authFailures.isBlocked('kilo'), false, 'successful recover close should clear block');

    // Manual Start clears block.
    engine.authFailures.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN', hint: engine.authFailures.hintFor('kilo') });
    engine.start('p1', { manual: true });
    assert.equal(engine.authFailures.isBlocked('kilo'), false, 'manual start should clear auth blocks');

    // Blocked runner not chosen by pickRunner when another is ready.
    resetAuth();
    engine.authFailures.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN', hint: engine.authFailures.hintFor('kilo') });
    const pick = engine.pickRunner(project, 'seed', ['kilo', 'opencode']);
    assert.equal(pick.id, 'opencode', 'pickRunner should skip auth-blocked runner');
    assert.notEqual(pick.authBlocked, true);

    // All blocked produces auth stop (no launched step).
    resetAuth();
    engine.authFailures.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN', hint: engine.authFailures.hintFor('kilo') });
    engine.authFailures.record('opencode', { runnerLabel: 'OpenCode', message: 'unauthorized', hint: engine.authFailures.hintFor('opencode') });
    const allPick = engine.pickRunner(project, 'seed', ['kilo', 'opencode']);
    assert.equal(allPick.authBlocked, true, 'all blocked should report authBlocked');

    // startStep path: all blocked should park with AUTH REQUIRED error.
    const rt2 = engine.ensureRuntime(project);
    rt2.active = true;
    rt2.status = 'idle';
    rt2.nextPhase = 'seed';
    rt2.currentTask = '';
    rt2.stepTask = null;
    rt2.error = '';
    rt2.child = null;
    rt2.starting = false;
    // call tick which will try to start step; easier to call internal flow through start + tick
    engine.start('p1', { manual: false });
    // ensure manual clear didn't happen; reblock
    resetAuth();
    engine.authFailures.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN', hint: engine.authFailures.hintFor('kilo') });
    engine.authFailures.record('opencode', { runnerLabel: 'OpenCode', message: 'unauthorized', hint: engine.authFailures.hintFor('opencode') });
    rt2.active = true;
    rt2.status = 'idle';
    rt2.error = '';
    rt2.nextPhase = 'seed';
    rt2.currentTask = '';
    rt2.stepTask = null;
    // Use exposed startStep? not exported; tick should pick it up. But tick is async-ish; easier to directly invoke via engine.tick? tick exists.
    engine.tick();
    await new Promise((r) => setTimeout(r, 200));
    const state = engine.getState();
    const proj = state.projects.find((p) => p.id === 'p1');
    assert.ok(proj, 'project exists in state');
    assert.equal(proj.status, 'error', 'all auth-blocked should park project');
    assert.match(proj.error || '', /AUTH REQUIRED/i, 'error should be auth error');
    assert.equal(rt2.child, null, 'no child should be launched when all blocked');

    console.log('auth-failures engine: record/clear/pick/all-blocked ok.');
  } finally {
    engine.shutdown();
    fs.rmSync(DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
