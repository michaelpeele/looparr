'use strict';

// Regression test for splitarr task 3 parked in error by exit 137 / SIGKILL.
// Sprint close handling must name an OOM/resource kill and suggest resuming,
// without mislabeling ordinary crashes or graceful SIGTERM as OOM. Transient
// kills must auto-requeue with bounded backoff instead of parking, and terminal
// auth/billing/permission text must still park.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
// Isolate config + logs before the engine (and its config/log-store deps) load.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-sprint-kill-'));
process.env.CONFIG_PATH = path.join(TMP_ROOT, 'config.json');
process.env.LOOPARR_LOG_DIR = path.join(TMP_ROOT, 'logs');
process.env.HOSTNAME = 'test-host';

const engine = require(`${REPO_ROOT}/src/engine`);
const autoResume = require(`${REPO_ROOT}/src/auto-resume`);

let pass = 0;
function run(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

let projectSeq = 0;
function makeRuntime() {
  projectSeq += 1;
  const id = `sprint-kill-${projectSeq}`;
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `${id}-`));
  fs.mkdirSync(path.join(dir, '.looparr'), { recursive: true });
  const project = { id, name: id, path: dir, autoResumeOnStart: false };
  const rt = engine.ensureRuntime(project);
  return { project, rt };
}

function makeEntry(taskText) {
  return {
    runKey: `run-key-${taskText}`,
    taskIndex: 0,
    taskText,
    sprint: 's1',
    mergePrevious: false,
    deployMain: false,
    prompt: 'implement it',
    branch: 'looparr/task/s1/slug',
    worktree: path.join(TMP_ROOT, 'worktree-kept'),
    status: 'running',
    child: null,
    exitCode: null,
    output: ''
  };
}

run('exit 137 is an actionable SIGKILL/OOM failure', () => {
  const result = engine.sprintExitFailure(137, null);
  assert.equal(result.killed, true);
  assert.equal(result.transient, true);
  assert.equal(result.exitCode, 137);
  assert.match(result.message, /SIGKILL|OOM/i);
  assert.match(result.message, /resume|retry/i);
});

run('signal SIGKILL with null code is a kill', () => {
  const result = engine.sprintExitFailure(null, 'SIGKILL');
  assert.equal(result.killed, true);
  assert.equal(result.transient, true);
  assert.equal(result.exitCode, 137);
  assert.match(result.message, /SIGKILL|OOM/i);
});

run('ordinary non-zero exit stays generic', () => {
  const result = engine.sprintExitFailure(1, null);
  assert.equal(result.killed, false);
  assert.equal(result.transient, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /code 1/);
  assert.doesNotMatch(result.message, /SIGKILL|OOM/i);
});

run('graceful SIGTERM is not an OOM kill', () => {
  const result = engine.sprintExitFailure(143, 'SIGTERM');
  assert.equal(result.killed, false);
  assert.equal(result.transient, false);
  assert.equal(result.exitCode, 143);
  assert.match(result.message, /code 143/);
  assert.match(result.message, /signal SIGTERM/);
  assert.doesNotMatch(result.message, /SIGKILL|OOM/i);
});

run('clean exit has no failure message', () => {
  const result = engine.sprintExitFailure(0, null);
  assert.equal(result.killed, false);
  assert.equal(result.transient, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.message, '');
});

run('transient kill below the limit requeues with cooldown', () => {
  const { project, rt } = makeRuntime();
  const entry = makeEntry('task A');
  const failure = engine.sprintExitFailure(137, null);
  const before = Date.now();
  engine.sprintRunFailed(project, rt, entry, failure.message, 'some output', failure);
  assert.equal(rt.transientKillRetryCount, 1, 'counter increments');
  assert.notEqual(rt.status, 'error', 'never parks in error below the bound');
  assert.equal(rt.status, 'idle', 'status is non-error idle');
  assert.equal(rt.active, true, 'stays active');
  assert.ok(
    rt.resumeAt >= before + autoResume.TRANSIENT_KILL_COOLDOWN_MS - 1000
      && rt.resumeAt <= Date.now() + autoResume.TRANSIENT_KILL_COOLDOWN_MS + 1000,
    'cooldown set ~TRANSIENT_KILL_COOLDOWN_MS ahead'
  );
  assert.equal(rt.error, '', 'error cleared');
  assert.equal(entry.branch, 'looparr/task/s1/slug', 'branch preserved for review');
  assert.ok(entry.worktree, 'worktree preserved for review');
  assert.equal(rt.sprintPending.length, 1, 'task requeued for a fresh branch');
  assert.equal(rt.sprintPending[0].taskText, 'task A', 'requeued the failed task');
});

run('repeated transient kills park at the limit', () => {
  const { project, rt } = makeRuntime();
  const failure = engine.sprintExitFailure(137, null);
  for (let i = 0; i < autoResume.TRANSIENT_KILL_RETRY_LIMIT; i += 1) {
    const entry = makeEntry(`task ${i}`);
    engine.sprintRunFailed(project, rt, entry, failure.message, '', failure);
    assert.notEqual(rt.status, 'error', `attempt ${i + 1} stays non-error`);
    assert.equal(rt.active, true, `attempt ${i + 1} stays active`);
  }
  assert.equal(rt.transientKillRetryCount, autoResume.TRANSIENT_KILL_RETRY_LIMIT, 'counter at the bound');
  // The attempt after the bound parks.
  const finalEntry = makeEntry('task final');
  engine.sprintRunFailed(project, rt, finalEntry, failure.message, '', failure);
  assert.equal(rt.status, 'error', 'parks in error after the bound');
  assert.equal(rt.active, false, 'inactive after the bound');
  assert.equal(rt.transientKillRetryCount, autoResume.TRANSIENT_KILL_RETRY_LIMIT, 'counter stays at the bound');
});

run('terminal text in a kill parks instead of requeueing', () => {
  const { project, rt } = makeRuntime();
  const entry = makeEntry('task T');
  const failure = {
    killed: true,
    transient: true,
    exitCode: 137,
    message: 'Sprint implement killed by SIGKILL (exit 137) but 401 unauthorized invalid api key'
  };
  engine.sprintRunFailed(project, rt, entry, failure.message, '', failure);
  assert.equal(rt.status, 'error', 'terminal text parks');
  assert.equal(rt.active, false, 'terminal text is inactive');
  assert.equal(rt.transientKillRetryCount, 0, 'no requeue for terminal text');
  assert.equal(rt.sprintPending.length, 0, 'terminal text is not requeued');
});

run('non-transient failures still park (no requeue)', () => {
  const { project, rt } = makeRuntime();
  const entry = makeEntry('task N');
  const failure = engine.sprintExitFailure(1, null);
  engine.sprintRunFailed(project, rt, entry, failure.message, '', failure);
  assert.equal(rt.status, 'error', 'ordinary failure parks');
  assert.equal(rt.active, false, 'ordinary failure is inactive');
  assert.equal(rt.transientKillRetryCount, 0, 'ordinary failure does not touch the counter');
  assert.equal(rt.sprintPending.length, 0, 'ordinary failure is not requeued');
});

console.log(`\n${pass} test(s) passed`);