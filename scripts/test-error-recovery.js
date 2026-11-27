'use strict';

// Focused suite for the opt-in error-recovery feature: a non-looparr project
// whose step ends in error queues exactly one 'recover' session per unique
// error fingerprint; terminal errors park for the user instead of looping.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-error-recovery-'));
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const RECOVERY_STATE = path.join(TEMP_DIR, 'error-recovery-state.json');

process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_ERROR_RECOVERY_STATE = RECOVERY_STATE;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

for (const dir of [PROJECTS_ROOT, path.join(PROJECTS_ROOT, 'a'), path.join(PROJECTS_ROOT, 'b')]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({
  settings: { errorRecovery: true, mode: 'roundrobin', maxConcurrent: 2 },
  projects: [
    { id: 'pa', name: 'Project A', path: path.join(PROJECTS_ROOT, 'a') },
    { id: 'pb', name: 'Project B', path: path.join(PROJECTS_ROOT, 'b'), errorRecovery: false },
    { id: 'ploop', name: 'Looparr', path: REPO_ROOT }
  ]
}, null, 2)}\n`, 'utf8');

const planLib = require(path.join(REPO_ROOT, 'src/plan.js'));
const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
const engine = require(path.join(REPO_ROOT, 'src/engine.js'));

let passed = 0;
function ok(label, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
}

function loadProjects() {
  return configStore.loadConfig().projects;
}

function project(id) {
  const found = loadProjects().find((entry) => entry.id === id);
  assert.ok(found, `project ${id} present in config`);
  return found;
}

function freshRuntime(overrides = {}) {
  return {
    status: 'idle',
    active: false,
    currentTask: 'Task one',
    stepOutput: '',
    nextPhase: 'seed',
    pendingRecovery: null,
    recoveryContext: null,
    error: '',
    child: null,
    token: 0,
    sprintRuns: [],
    sprintValidation: null,
    ...overrides
  };
}

/* ---------- plan.js: [recover] token ---------- */

ok('parseTaskTokens parses and strips [recover]', () => {
  const parsed = planLib.parseTaskTokens('Task one [recover]');
  assert.equal(parsed.text, 'Task one');
  assert.equal(parsed.recover, true);
});

ok('parseTaskTokens combines sprint/merge/deploy/recover tokens', () => {
  const parsed = planLib.parseTaskTokens('Task [sprint:be] [merge-previous] [deploy-main] [recover]');
  assert.equal(parsed.text, 'Task');
  assert.equal(parsed.sprint, 'be');
  assert.equal(parsed.mergePrevious, true);
  assert.equal(parsed.deployMain, true);
  assert.equal(parsed.recover, true);
});

ok('unknown bracket tokens still pass through untouched', () => {
  const parsed = planLib.parseTaskTokens('Task [foo]');
  assert.equal(parsed.text, 'Task [foo]');
  assert.equal(parsed.recover, false);
});

ok('parseTasks exposes recover and strips it from text', () => {
  const tasks = planLib.parseTasks('- [ ] Task one [recover]\n- [ ] Task two');
  assert.equal(tasks[0].text, 'Task one');
  assert.equal(tasks[0].recover, true);
  assert.equal(tasks[1].recover, false);
});

ok('taskFlags and joinTaskTokens round-trip recover', () => {
  assert.equal(planLib.taskFlags('Task [recover]').recover, true);
  assert.equal(planLib.taskFlags({ text: 'Task', recover: true }).recover, true);
  assert.equal(planLib.taskFlags('Task').recover, false);
  assert.ok(planLib.joinTaskTokens({ text: 'Task', recover: true }).includes('[recover]'));
  assert.ok(!planLib.joinTaskTokens({ text: 'Task' }).includes('[recover]'));
});

ok('editTask adds, preserves, and drops the recover token', () => {
  const base = '- [ ] Task one';
  const added = planLib.editTask(base, 0, 'Task one [recover]');
  assert.equal(added.ok, true);
  assert.ok(added.content.includes('[recover]'));
  assert.equal(planLib.parseTasks(added.content)[0].recover, true);
  const preserved = planLib.editTask(added.content, 0, 'Task one changed');
  assert.equal(preserved.ok, true);
  assert.equal(planLib.parseTasks(preserved.content)[0].recover, true, 'plain edit keeps recover');
  const dropped = planLib.editTask(preserved.content, 0, 'Task one changed');
  assert.equal(dropped.ok, true);
  assert.equal(planLib.parseTasks(dropped.content)[0].recover, false, 'explicit same-text edit drops recover');
});

/* ---------- config.js: opt-in gate ---------- */

ok('errorRecovery defaults off and normalizes strictly', () => {
  assert.equal(configStore.DEFAULT_SETTINGS.errorRecovery, false);
  assert.equal(configStore.normalizeSettings({}).errorRecovery, false);
  assert.equal(configStore.normalizeSettings({ errorRecovery: 'yes' }).errorRecovery, false);
  assert.equal(configStore.normalizeSettings({ errorRecovery: true }).errorRecovery, true);
});

ok('per-project override wins over the global default', () => {
  assert.equal(configStore.resolveErrorRecovery({}, {}), false);
  assert.equal(configStore.resolveErrorRecovery({}, { errorRecovery: true }), true);
  assert.equal(configStore.resolveErrorRecovery({ errorRecovery: false }, { errorRecovery: true }), false);
  assert.equal(configStore.resolveErrorRecovery({ errorRecovery: true }, { errorRecovery: false }), true);
});

/* ---------- engine: looparr guard, queue, dedupe ---------- */

ok('the Looparr repository is excluded from recovery', () => {
  assert.equal(engine.usesLooparrPromotion(REPO_ROOT), true);
  assert.equal(engine.usesLooparrPromotion(path.join(PROJECTS_ROOT, 'a')), false);
  const loopProject = project('ploop');
  const rt = freshRuntime();
  assert.equal(engine.queueErrorRecovery(loopProject, rt, 'implement', 'boom'), false);
  assert.equal(rt.pendingRecovery, null, 'looparr project never queues recovery');
  assert.notEqual(rt.nextPhase, engine.RECOVER_PHASE);
});

ok('a non-looparr error queues exactly one recovery session', () => {
  const pa = project('pa');
  const rt = freshRuntime();
  assert.equal(engine.queueErrorRecovery(pa, rt, 'implement', 'boom failure'), true);
  assert.equal(rt.status, 'idle');
  assert.equal(rt.active, true);
  assert.equal(rt.nextPhase, engine.RECOVER_PHASE);
  assert.equal(rt.pendingRecovery.phase, 'implement');
  assert.equal(rt.pendingRecovery.task, 'Task one');
  assert.equal(rt.pendingRecovery.fingerprint, engine.errorFingerprint('boom failure'));
});

ok('a second identical error does not re-enqueue', () => {
  const pa = project('pa');
  const rt = freshRuntime();
  assert.equal(engine.queueErrorRecovery(pa, rt, 'implement', 'boom failure'), false);
  assert.equal(rt.pendingRecovery, null);
});

ok('a different error fingerprint queues its own recovery', () => {
  const pa = project('pa');
  const rt = freshRuntime();
  assert.equal(engine.queueErrorRecovery(pa, rt, 'analyze', 'a different failure'), true);
  assert.equal(rt.pendingRecovery.phase, 'analyze');
});

ok('fingerprint store persists across a simulated reload', () => {
  const pa = project('pa');
  const fingerprint = engine.errorFingerprint('boom failure');
  assert.equal(engine.recoveryAttempted(pa.id, fingerprint), true);
  engine.reloadErrorRecoveryState();
  assert.equal(engine.recoveryAttempted(pa.id, fingerprint), true, 'attempt survives reload');
  assert.ok(fs.existsSync(RECOVERY_STATE), 'state file written');
});

ok('fingerprint normalizes whitespace', () => {
  assert.equal(engine.errorFingerprint('a  b\n c'), engine.errorFingerprint('a b c'));
  assert.equal(engine.errorFingerprint('x').length, 32);
});

ok('per-project opt-out keeps the prior error parking (no queue)', () => {
  const pb = project('pb');
  const rt = freshRuntime();
  assert.equal(engine.queueErrorRecovery(pb, rt, 'implement', 'boom failure'), false);
  assert.equal(rt.pendingRecovery, null);
});

/* ---------- engine: recovery close routing ---------- */

ok('terminal error parks for the user instead of looping', () => {
  const pa = project('pa');
  const rt = freshRuntime({
    status: 'recover',
    stepOutput: 'Error: 401 unauthorized',
    recoveryContext: { phase: 'implement', task: 'Task one', error: '401 unauthorized' }
  });
  engine.handleRecoverClose(pa, rt, 1, { text: 'Task one' }, null);
  assert.equal(rt.status, 'error');
  assert.equal(rt.nextPhase, 'implement');
  assert.equal(rt.recoveryContext, null);
});

ok('terminal error with a question handoff parks in waitingAnswer', () => {
  const pa = project('pa');
  fs.mkdirSync(path.join(pa.path, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(pa.path, '.looparr', 'next_prompt.txt'), 'Which approach do you want?\n', 'utf8');
  const rt = freshRuntime({
    status: 'recover',
    stepOutput: 'Error: billing: subscription required',
    recoveryContext: { phase: 'analyze', task: 'Task one', error: 'billing' }
  });
  engine.handleRecoverClose(pa, rt, 1, { text: 'Task one' }, null);
  assert.equal(rt.status, 'waitingAnswer');
  assert.equal(rt.nextPhase, 'analyze');
  assert.ok(fs.existsSync(path.join(pa.path, '.looparr', 'handoff_task.txt')), 'provenance stamped');
});

ok('retryable error takes the fix path and restores the failed phase', () => {
  const pa = project('pa');
  const runner = { isRateLimit: (text) => /429/.test(String(text)) };
  const rt = freshRuntime({
    status: 'recover',
    stepOutput: 'SessionError: [429]: too many requests',
    recoveryContext: { phase: 'implement', task: 'Task one', error: '429' }
  });
  engine.handleRecoverClose(pa, rt, 1, { text: 'Task one' }, runner);
  assert.equal(rt.status, 'idle');
  assert.equal(rt.nextPhase, 'implement');
  assert.equal(rt.error, '');
});

ok('clear recovery run resumes the failed phase and drops stale handoffs', () => {
  const pa = project('pa');
  fs.mkdirSync(path.join(pa.path, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(pa.path, '.looparr', 'next_prompt.txt'), 'leftover recovery text\n', 'utf8');
  const rt = freshRuntime({
    status: 'recover',
    stepOutput: 'fixed the root cause',
    recoveryContext: { phase: 'seed', task: 'Task one', error: 'boom' }
  });
  engine.handleRecoverClose(pa, rt, 0, { text: 'Task one' }, null);
  assert.equal(rt.status, 'idle');
  assert.equal(rt.nextPhase, 'seed');
  assert.equal(fs.existsSync(path.join(pa.path, '.looparr', 'next_prompt.txt')), false, 'stale handoff cleared');
});

/* ---------- round-robin order is unchanged ---------- */

ok('round-robin eligible order is unchanged by a queued recovery', () => {
  const pa = project('pa');
  const pb = project('pb');
  const rtA = engine.ensureRuntime(pa);
  rtA.active = true;
  rtA.status = 'idle';
  rtA.pendingRecovery = { fingerprint: 'fp', phase: 'implement', task: 'Task one' };
  const rtB = engine.ensureRuntime(pb);
  rtB.active = true;
  rtB.status = 'idle';
  const eligible = engine.eligibleProjects().map((entry) => entry.id);
  assert.deepEqual(eligible, ['pa', 'pb'], 'config order preserved; recovery adds no reordering');
});

/* ---------- cleanup ---------- */

engine.shutdown();
fs.rmSync(TEMP_DIR, { recursive: true, force: true });
console.log(`error recovery: ${passed} tests passed.`);