'use strict';

// Covers scripts/selfheal-account.js: the human-gated accounted command. Uses
// throwaway git repos under the OS temp dir; never touches the live
// .looparr/selfheal/status/ directory.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const selfhealStatus = require(path.join(REPO_ROOT, 'src', 'selfheal-status.js'));
const CLI = path.join(REPO_ROOT, 'scripts', 'selfheal-account.js');

const PROJECT_ID = 'd76e436a-8816-4342-9511-b4706e2320e4';
const APPLIED_BRANCH = 'looparr-selfheal-1795657600462-0';
const UNAPPLIED_BRANCH = 'looparr-selfheal-1-2';

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertOk(condition, label) {
  assert.ok(condition, label);
}

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-selfheal-accounted-'));
  const run = (args) => {
    const res = git(dir, args);
    if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    return res.stdout;
  };
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  run(['add', 'base.txt']);
  run(['commit', '-m', 'base']);

  // Applied branch: fix committed on a branch, then cherry-picked onto main.
  run(['checkout', '-b', APPLIED_BRANCH]);
  fs.writeFileSync(path.join(dir, 'fix.txt'), 'fix\n');
  run(['add', 'fix.txt']);
  run(['commit', '-m', 'fix']);
  run(['checkout', 'main']);
  run(['cherry-pick', APPLIED_BRANCH]);

  // Unapplied branch: a fix that is not in main.
  run(['checkout', '-b', UNAPPLIED_BRANCH]);
  fs.writeFileSync(path.join(dir, 'other.txt'), 'other\n');
  run(['add', 'other.txt']);
  run(['commit', '-m', 'other']);
  run(['checkout', 'main']);

  return dir;
}

function runCli(repo, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LOOPARR_REPO_ROOT: repo }
  });
}

function testRefusesWithoutConfirm() {
  const repo = makeRepo();
  try {
    const res = runCli(repo, ['--project', PROJECT_ID, '--branch', APPLIED_BRANCH]);
    assertOk(res.status !== 0, 'refuses without --confirm');
    assertOk(/Usage:/.test(res.stderr), 'prints usage without --confirm');
    assertEqual(selfhealStatus.readStatus(repo, PROJECT_ID), null, 'no record written without confirm');
    console.log('accounted refuses without --confirm ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testRefusesInvalidInputs() {
  const repo = makeRepo();
  try {
    let res = runCli(repo, ['--project', '../escape', '--branch', APPLIED_BRANCH, '--confirm']);
    assertOk(res.status !== 0, 'refuses invalid project id');

    res = runCli(repo, ['--project', PROJECT_ID, '--branch', 'main', '--confirm']);
    assertOk(res.status !== 0, 'refuses branch not matching BRANCH_RE');

    res = runCli(repo, ['--project', PROJECT_ID, '--branch', UNAPPLIED_BRANCH, '--confirm']);
    assertOk(res.status !== 0, 'refuses branch whose fix is not applied');

    assertEqual(selfhealStatus.readStatus(repo, PROJECT_ID), null, 'no record written on refusals');
    console.log('accounted refuses invalid inputs ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testWritesAccountedAtomically() {
  const repo = makeRepo();
  try {
    const res = runCli(repo, ['--project', PROJECT_ID, '--branch', APPLIED_BRANCH, '--confirm']);
    assertEqual(res.status, 0, `CLI succeeds: ${res.stderr}`);

    const file = selfhealStatus.statusFile(repo, PROJECT_ID);
    assertOk(file, 'status file path resolves');
    assertEqual(fs.statSync(file).mode & 0o777, 0o600, 'status file mode is 0600');

    const leftovers = fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp'));
    assertEqual(leftovers.length, 0, 'no temp files left behind');

    const read = selfhealStatus.readStatus(repo, PROJECT_ID);
    assertOk(read, 'accounted record reads back');
    assertEqual(read.state, 'accounted', 'state is accounted');
    assertEqual(read.branch, APPLIED_BRANCH, 'branch recorded');
    assertEqual(read.phase, 'accounted', 'phase is accounted');
    assertEqual(read.mergedAt, null, 'mergedAt stays null');
    assertEqual(selfhealStatus.isStickyStatus(read), true, 'record is sticky for the heartbeat');

    // Accounted must never satisfy the merge path.
    const merge = selfhealStatus.validateMergeRequest(repo, PROJECT_ID, { branch: APPLIED_BRANCH });
    assertEqual(merge.ok, false, 'accounted never mergeable');
    console.log('accounted writes atomically ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testPreservesRoundAndCycles() {
  const repo = makeRepo();
  try {
    const now = Date.now();
    selfhealStatus.writeStatus(repo, {
      version: selfhealStatus.VERSION,
      projectId: PROJECT_ID,
      projectName: 'Demo',
      state: 'healed',
      round: 5,
      cycles: 6,
      branch: APPLIED_BRANCH,
      phase: 'implement',
      errorAt: '',
      mergedAt: null,
      analysisFile: '',
      exitCode: 0,
      hostname: 'dev'
    }, now);

    const res = runCli(repo, ['--project', PROJECT_ID, '--confirm']);
    assertEqual(res.status, 0, `CLI succeeds using existing branch: ${res.stderr}`);

    const read = selfhealStatus.readStatus(repo, PROJECT_ID);
    assertEqual(read.state, 'accounted', 'state becomes accounted');
    assertEqual(read.round, 5, 'round preserved');
    assertEqual(read.cycles, 6, 'cycles preserved');
    assertEqual(read.projectName, 'Demo', 'projectName preserved');
    console.log('accounted preserves round/cycles ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testHeartbeatPreservationSeam() {
  // The engine re-stamps a fresh sticky (accounted) record instead of writing
  // idle when no round is active. Exercise the exposed decision seam.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-selfheal-sticky-'));
  try {
    const now = Date.now();
    selfhealStatus.writeStatus(repo, {
      version: selfhealStatus.VERSION,
      projectId: PROJECT_ID,
      projectName: 'Demo',
      state: 'accounted',
      round: 0,
      cycles: 0,
      branch: APPLIED_BRANCH,
      phase: 'accounted',
      errorAt: '',
      mergedAt: null,
      analysisFile: '',
      exitCode: null,
      hostname: 'dev'
    }, now);

    const existing = selfhealStatus.readStatus(repo, PROJECT_ID, now);
    assertEqual(selfhealStatus.isStickyStatus(existing, now), true, 'accounted is sticky');

    // Simulate the heartbeat: sticky -> re-stamp accounted (fresh), not idle.
    const restamped = selfhealStatus.writeStatus(repo, { ...existing, state: 'accounted' }, now + 1000);
    assertEqual(restamped, true, 're-stamp writes');
    const after = selfhealStatus.readStatus(repo, PROJECT_ID, now + 1000);
    assertEqual(after.state, 'accounted', 'accounted survives the heartbeat');

    // A non-sticky idle record is not preserved.
    assertEqual(selfhealStatus.isStickyStatus({ state: 'idle' }, now), false, 'idle is not sticky');
    console.log('accounted heartbeat preservation ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

testRefusesWithoutConfirm();
testRefusesInvalidInputs();
testWritesAccountedAtomically();
testPreservesRoundAndCycles();
testHeartbeatPreservationSeam();
console.log('selfheal accounted tests passed');