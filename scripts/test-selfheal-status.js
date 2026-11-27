'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const selfhealStatus = require(path.join(REPO_ROOT, 'src/selfheal-status.js'));
const engine = require(path.join(REPO_ROOT, 'src/engine.js'));
const { spawnSync } = require('node:child_process');

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertOk(condition, label) {
  assert.ok(condition, label);
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-selfheal-status-'));
  return dir;
}

function sampleRecord(projectId, overrides) {
  return {
    version: selfhealStatus.VERSION,
    projectId,
    projectName: 'Demo',
    state: 'healed',
    round: 1,
    cycles: 2,
    branch: 'looparr-selfheal-1700000000000-1',
    phase: 'implement',
    errorAt: '2026-11-24T00:00:00.000Z',
    mergedAt: null,
    analysisFile: '',
    exitCode: 0,
    hostname: 'devbox',
    ...overrides
  };
}

function testRoundTripAndTtl() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    const record = sampleRecord('project-1');
    const wrote = selfhealStatus.writeStatus(repo, record, now);
    assertEqual(wrote, true, 'writeStatus returns true');

    const file = selfhealStatus.statusFile(repo, 'project-1');
    assertOk(file, 'status file path resolves');
    const stat = fs.statSync(file);
    assertEqual(stat.mode & 0o777, 0o600, 'status file mode is 0600');

    const read = selfhealStatus.readStatus(repo, 'project-1', now);
    assertOk(read, 'fresh status reads back');
    assertEqual(read.state, 'healed', 'state round-trips');
    assertEqual(read.branch, record.branch, 'branch round-trips');
    assertEqual(read.cycles, 2, 'cycles round-trips');

    // Stale after TTL.
    const stale = selfhealStatus.readStatus(repo, 'project-1', now + selfhealStatus.TTL_MS + 1);
    assertEqual(stale, null, 'stale status is ignored');

    // Fresh within window but past expiresAt is also stale.
    const expired = selfhealStatus.readStatus(repo, 'project-1', now + selfhealStatus.TTL_MS * 2);
    assertEqual(expired, null, 'past expiresAt is ignored');

    console.log('selfheal status round-trip/TTL ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testIdleStatus() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    // Idle has no branch; it must round-trip so prod can show a live idle pill.
    const wrote = selfhealStatus.writeStatus(repo, {
      version: selfhealStatus.VERSION,
      projectId: 'project-1',
      projectName: 'Demo',
      state: 'idle',
      round: 0,
      cycles: 0,
      branch: '',
      phase: '',
      errorAt: '',
      mergedAt: null,
      analysisFile: '',
      exitCode: null,
      hostname: 'dev'
    }, now);
    assertEqual(wrote, true, 'idle status writes');

    const read = selfhealStatus.readStatus(repo, 'project-1', now);
    assertOk(read, 'idle status reads back');
    assertEqual(read.state, 'idle', 'idle state round-trips');
    assertEqual(read.branch, '', 'idle has an empty branch');

    const healer = selfhealStatus.toSelfHealer(read);
    assertEqual(healer.state, 'idle', 'prod maps idle selfHealer');
    assertEqual(healer.mergedAt, null, 'idle selfHealer has no mergedAt');

    // Idle cannot be merged (not healed).
    const res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch: '' }, now);
    assertEqual(res.ok, false, 'idle cannot be merged');
    assertEqual(res.status, 409, 'idle merge is 409');

    console.log('selfheal idle status ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testPathContainment() {
  // Valid id yields an inside path; hostile ids are rejected.
  assertEqual(selfhealStatus.isValidProjectId('project-1'), true, 'simple id accepted');
  assertEqual(selfhealStatus.isValidProjectId('../escape'), false, 'parent traversal rejected');
  assertEqual(selfhealStatus.isValidProjectId('a/b'), false, 'slash rejected');
  assertEqual(selfhealStatus.isValidProjectId(''), false, 'empty rejected');
  assertEqual(selfhealStatus.isValidProjectId(null), false, 'null rejected');

  const repo = makeTempRepo();
  try {
    assertEqual(selfhealStatus.statusFile(repo, '../escape'), null, 'hostile id has no file path');
    assertEqual(selfhealStatus.statusFile(repo, 'a/b'), null, 'slash id has no file path');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
  console.log('selfheal status containment ok');
}

function testMalformedIgnored() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    const file = selfhealStatus.statusFile(repo, 'project-1');
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // Bad JSON.
    fs.writeFileSync(file, '{not json', 'utf8');
    assertEqual(selfhealStatus.readStatus(repo, 'project-1', now), null, 'malformed json ignored');

    // Unknown state.
    const bad = sampleRecord('project-1', { state: 'bogus', updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString() });
    fs.writeFileSync(file, JSON.stringify(bad), 'utf8');
    assertEqual(selfhealStatus.readStatus(repo, 'project-1', now), null, 'unknown state ignored');

    // Wrong version.
    const oldVersion = sampleRecord('project-1', { version: 999, updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString() });
    fs.writeFileSync(file, JSON.stringify(oldVersion), 'utf8');
    assertEqual(selfhealStatus.readStatus(repo, 'project-1', now), null, 'wrong version ignored');

    console.log('selfheal status malformed ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testProdMapping() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', {
      state: 'healing', cycles: 1, mergedAt: null
    }), now);

    const healer = selfhealStatus.toSelfHealer(selfhealStatus.readStatus(repo, 'project-1', now));
    assertOk(healer, 'prod mapping returns a selfHealer');
    assertEqual(healer.state, 'healing', 'prod sees healing state');
    assertEqual(healer.cycles, 1, 'prod sees cycle count');
    assertEqual(healer.branch, 'looparr-selfheal-1700000000000-1', 'prod sees branch');

    // List sees the one project.
    const list = selfhealStatus.listStatus(repo, now);
    assertEqual(list.length, 1, 'listStatus finds one fresh file');
    assertEqual(list[0].projectId, 'project-1', 'listStatus project id');

    console.log('selfheal prod mapping ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeValidation() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    const branch = 'looparr-selfheal-1700000000000-1';
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', { state: 'healed', branch, mergedAt: null }), now);

    // Missing branch in body.
    let res = selfhealStatus.validateMergeRequest(repo, 'project-1', {}, now);
    assertEqual(res.ok, false, 'missing branch refused');
    assertEqual(res.status, 400, 'missing branch is 400');

    // Branch not matching healed branch.
    res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch: 'looparr-selfheal-1-2' }, now);
    assertEqual(res.ok, false, 'mismatched branch refused');
    assertEqual(res.status, 409, 'mismatched branch is 409');

    // Bad branch pattern.
    res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch: 'main' }, now);
    assertEqual(res.ok, false, 'bad branch pattern refused');
    assertEqual(res.status, 400, 'bad branch pattern is 400');

    // Not healed.
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', { state: 'debugging', branch, mergedAt: null }), now);
    res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch }, now);
    assertEqual(res.ok, false, 'non-healed state refused');
    assertEqual(res.status, 409, 'non-healed is 409');

    // Already merged.
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', { state: 'healed', branch, mergedAt: '2026-11-24T01:00:00.000Z' }), now);
    res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch }, now);
    assertEqual(res.ok, false, 'already-merged refused');
    assertEqual(res.status, 409, 'already-merged is 409');

    // No status file at all.
    res = selfhealStatus.validateMergeRequest(repo, 'missing', { branch }, now);
    assertEqual(res.ok, false, 'missing status refused');
    assertEqual(res.status, 409, 'missing status is 409');

    // Valid request succeeds.
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', { state: 'healed', branch, mergedAt: null }), now);
    res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch }, now);
    assertEqual(res.ok, true, 'valid healed request accepted');

    console.log('selfheal merge validation ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testAccountedStatus() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    const branch = 'looparr-selfheal-1795657600462-0';
    const wrote = selfhealStatus.writeStatus(repo, sampleRecord('project-1', {
      state: 'accounted', branch, phase: 'accounted', mergedAt: null, round: 3, cycles: 4
    }), now);
    assertEqual(wrote, true, 'accounted status writes');

    const read = selfhealStatus.readStatus(repo, 'project-1', now);
    assertOk(read, 'fresh accounted record reads back');
    assertEqual(read.state, 'accounted', 'accounted state round-trips');
    assertEqual(read.branch, branch, 'accounted branch round-trips');
    assertEqual(read.mergedAt, null, 'accounted keeps mergedAt null');

    // Accounted is durable/sticky for the heartbeat, but never mergeable.
    assertEqual(selfhealStatus.isStickyStatus(read, now), true, 'fresh accounted is sticky');
    assertEqual(selfhealStatus.isStickyStatus(read, now + selfhealStatus.TTL_MS + 1), false, 'stale accounted is not sticky');
    assertEqual(selfhealStatus.isStickyStatus(sampleRecord('project-1', { state: 'healed' }), now), false, 'healed is not sticky');

    const res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch }, now);
    assertEqual(res.ok, false, 'fresh accounted refused by merge path');
    assertEqual(res.status, 409, 'accounted merge is 409');

    // Prod mapping round-trips accounted and keeps the branch hidden (not healed).
    const healer = selfhealStatus.toSelfHealer(read);
    assertEqual(healer.state, 'accounted', 'prod maps accounted selfHealer');
    assertEqual(healer.branch, branch, 'prod sees accounted branch');
    assertEqual(healer.mergedAt, null, 'accounted selfHealer has no mergedAt');

    // Stale accounted is hidden (readStatus null).
    assertEqual(selfhealStatus.readStatus(repo, 'project-1', now + selfhealStatus.TTL_MS * 2), null, 'stale accounted is hidden');

    // A merged accounted record is still not mergeable.
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', {
      state: 'accounted', branch, mergedAt: '2026-11-26T01:00:00.000Z'
    }), now);
    const mergedRes = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch }, now);
    assertEqual(mergedRes.ok, false, 'merged accounted refused');
    assertEqual(mergedRes.status, 409, 'merged accounted is 409');

    console.log('selfheal accounted status ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// --- Git-aware mergeability + stale-status reconciliation (throwaway repos) ---

function testIsMergeableBranchGuards() {
  const repo = makeGitRepo();
  try {
    // Malformed names are rejected before any git spawn.
    assertEqual(selfhealStatus.isMergeableBranch(repo, 'main'), false, 'non-healer branch rejected');
    assertEqual(selfhealStatus.isMergeableBranch(repo, ''), false, 'empty branch rejected');
    assertEqual(selfhealStatus.isMergeableBranch(repo, null), false, 'null branch rejected');
    assertEqual(selfhealStatus.isMergeableBranch(repo, '../../etc'), false, 'traversal branch rejected');
    assertEqual(selfhealStatus.isMergeableBranch('', 'looparr-selfheal-1-0'), false, 'empty repoRoot rejected');
    assertEqual(selfhealStatus.isMergeableBranch(null, 'looparr-selfheal-1-0'), false, 'null repoRoot rejected');

    // Missing local branch is not mergeable (repo exists, branch does not).
    assertEqual(selfhealStatus.isMergeableBranch(repo, 'looparr-selfheal-1700000000000-9'), false, 'missing local branch rejected');

    console.log('selfheal isMergeableBranch guards ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testReconcileStaleHealedStatuses() {
  const repo = makeGitRepo();
  try {
    const now = Date.now();
    // A real unmerged branch stays healed.
    const realBranch = 'looparr-selfheal-1700000000000-1';
    gitIn(repo, ['checkout', '-b', realBranch]);
    fs.writeFileSync(path.join(repo, 'fix.txt'), 'fix\n');
    gitIn(repo, ['add', 'fix.txt']);
    gitIn(repo, ['commit', '-m', 'fix']);
    gitIn(repo, ['checkout', 'main']);
    selfhealStatus.writeStatus(repo, sampleRecord('project-real', { branch: realBranch }), now);

    // An already-ancestor branch (points at main's HEAD) reconciles to idle.
    const ancestorBranch = 'looparr-selfheal-1700000000000-2';
    gitIn(repo, ['branch', ancestorBranch, 'main']);
    selfhealStatus.writeStatus(repo, sampleRecord('project-ancestor', { branch: ancestorBranch }), now);

    // A branch that does not exist locally reconciles to idle.
    selfhealStatus.writeStatus(repo, sampleRecord('project-missing', { branch: 'looparr-selfheal-1700000000000-3' }), now);

    // A fresh accounted record survives untouched.
    selfhealStatus.writeStatus(repo, sampleRecord('project-accounted', {
      state: 'accounted', branch: ancestorBranch, phase: 'accounted'
    }), now);

    const reconciled = selfhealStatus.reconcileStaleHealedStatuses(repo, now);
    assert.deepEqual(reconciled.sort(), ['project-ancestor', 'project-missing'], 'exactly the stale healed records reconcile');

    const real = selfhealStatus.readStatus(repo, 'project-real', now);
    assertEqual(real.state, 'healed', 'real unmerged branch stays healed');
    assertEqual(real.branch, realBranch, 'real branch preserved');

    for (const id of ['project-ancestor', 'project-missing']) {
      const record = selfhealStatus.readStatus(repo, id, now);
      assertEqual(record.state, 'idle', `${id} reconciled to idle`);
      assertEqual(record.branch, '', `${id} branch cleared`);
      assertEqual(record.mergedAt, null, `${id} mergedAt stays null`);
    }

    const accounted = selfhealStatus.readStatus(repo, 'project-accounted', now);
    assertEqual(accounted.state, 'accounted', 'fresh accounted survives reconciliation');
    assertEqual(accounted.branch, ancestorBranch, 'accounted branch preserved');

    // Reconciling again is a no-op.
    assert.deepEqual(selfhealStatus.reconcileStaleHealedStatuses(repo, now), [], 'second reconcile is a no-op');

    console.log('selfheal reconcile stale healed ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeableFlagMapping() {
  const repo = makeTempRepo();
  try {
    const now = Date.now();
    // Flag explicitly false survives the round-trip and reaches prod.
    selfhealStatus.writeStatus(repo, sampleRecord('project-1', { mergeable: false }), now);
    let healer = selfhealStatus.toSelfHealer(selfhealStatus.readStatus(repo, 'project-1', now));
    assertEqual(healer.mergeable, false, 'mergeable:false reaches toSelfHealer');

    // Missing flag (old writers) defaults to true so valid records keep working.
    selfhealStatus.writeStatus(repo, sampleRecord('project-2', { mergeable: undefined }), now);
    healer = selfhealStatus.toSelfHealer(selfhealStatus.readStatus(repo, 'project-2', now));
    assertEqual(healer.mergeable, true, 'missing mergeable defaults true');

    // Merge validation refuses a stale record without touching git.
    let res = selfhealStatus.validateMergeRequest(repo, 'project-1', { branch: 'looparr-selfheal-1700000000000-1' }, now);
    assertEqual(res.ok, false, 'mergeable:false record refused');
    assertEqual(res.status, 409, 'mergeable:false refusal is 409');

    res = selfhealStatus.validateMergeRequest(repo, 'project-2', { branch: 'looparr-selfheal-1700000000000-1' }, now);
    assertEqual(res.ok, true, 'default-mergeable record still accepted');

    console.log('selfheal mergeable flag mapping ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testNoPushGuard() {
  const executor = fs.readFileSync(path.join(REPO_ROOT, 'scripts/host-executor.js'), 'utf8');
  const engine = fs.readFileSync(path.join(REPO_ROOT, 'src/engine.js'), 'utf8');
  const server = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');

  // The merge relay must not introduce a git push anywhere.
  assertOk(!/git['"]\s*,\s*['"]push/.test(executor), 'executor has no git push');
  assertOk(!/git['"]\s*,\s*['"]push/.test(engine), 'engine has no git push');
  assertOk(!/git['"]\s*,\s*['"]push/.test(server), 'server has no git push');
  assertOk(!/['"]push['"]/.test(executor), 'executor has no push literal');
  console.log('selfheal no-push guard ok');
}

// Spawn the host executor against 127.0.0.1 and assert the relay refuses bad
// tokens, bad bodies, and missing status without ever touching git/docker.
async function testExecutorRelay() {
  const { spawn } = require('node:child_process');
  const { setTimeout: delay } = require('node:timers/promises');
  const token = 'testtoken-0123456789abcdef';
  const port = 5497;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['scripts/host-executor.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LOOPARR_EXECUTOR_BIND: '127.0.0.1',
      LOOPARR_EXECUTOR_PORT: String(port),
      LOOPARR_EXECUTOR_TOKEN: token,
      // Keep the probe offline; the relay path under test never reaches a runner.
      LOOPARR_EXECUTOR_OPENCODE_BIN: process.execPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c.toString(); });
  child.stderr.on('data', (c) => { output += c.toString(); });
  const post = (body, headers) => fetch(`${baseUrl}/selfheal/merge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  try {
    let up = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const res = await fetch(`${baseUrl}/health`);
        if (res.ok) { await res.text(); up = true; break; }
      } catch { /* not up yet */ }
      await delay(100);
    }
    assertOk(up, `executor started\n${output}`);

    // 401 without a token.
    let res = await post({ projectId: 'p', branch: 'b' }, { authorization: 'Bearer wrong' });
    assertEqual(res.status, 401, 'bad token is 401');

    // 400 invalid projectId.
    res = await post({ projectId: '../escape', branch: 'b' }, { authorization: `Bearer ${token}` });
    assertEqual(res.status, 400, 'invalid projectId is 400');

    // 409 no status file for a valid but unknown id.
    res = await post({ projectId: 'nonexistentproj', branch: 'looparr-selfheal-1-2' }, { authorization: `Bearer ${token}` });
    assertEqual(res.status, 409, 'missing status is 409');

    console.log('selfheal executor relay ok');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise((r) => child.once('exit', r)), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

// --- Engine-level merge mechanics (throwaway git repos) ---

function gitIn(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-selfheal-merge-'));
  const run = (args) => {
    const res = gitIn(dir, args);
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
  return dir;
}

function headCommit(dir) {
  return gitIn(dir, ['rev-parse', 'HEAD']).stdout.trim();
}

function commitCount(dir) {
  return Number(gitIn(dir, ['rev-list', '--count', 'HEAD']).stdout.trim());
}

function testMergeBranchExports() {
  assertEqual(typeof engine.mergeBranchIntoRepo, 'function', 'mergeBranchIntoRepo is exported');
  assertEqual(typeof engine.mergeHealerBranch, 'function', 'mergeHealerBranch is exported');
  console.log('selfheal merge exports ok');
}

function testMergeAlreadyAncestorIdempotent() {
  const repo = makeGitRepo();
  try {
    // Branch pointing at the same commit as main: already an ancestor.
    const branch = 'looparr-selfheal-1700000000000-0';
    gitIn(repo, ['branch', branch]);
    const before = headCommit(repo);
    const countBefore = commitCount(repo);

    const res = engine.mergeBranchIntoRepo(repo, branch);
    assertEqual(res.ok, true, 'already-ancestor merge ok');
    assertEqual(res.alreadyMerged, true, 'already-ancestor flagged idempotent');
    assertEqual(headCommit(repo), before, 'HEAD unchanged (no empty merge commit)');
    assertEqual(commitCount(repo), countBefore, 'commit count unchanged');

    const again = engine.mergeBranchIntoRepo(repo, branch);
    assertEqual(again.alreadyMerged, true, 'repeat merge stays idempotent');
    assertEqual(headCommit(repo), before, 'HEAD still unchanged after repeat');
    console.log('selfheal merge already-ancestor idempotent ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeRealBranchAdvancesHead() {
  const repo = makeGitRepo();
  try {
    const branch = 'looparr-selfheal-1700000000000-1';
    gitIn(repo, ['checkout', '-b', branch]);
    fs.writeFileSync(path.join(repo, 'fix.txt'), 'fix\n');
    gitIn(repo, ['add', 'fix.txt']);
    gitIn(repo, ['commit', '-m', 'fix']);
    gitIn(repo, ['checkout', 'main']);

    const before = headCommit(repo);
    const res = engine.mergeBranchIntoRepo(repo, branch);
    assertEqual(res.ok, true, 'real merge ok');
    assertEqual(res.alreadyMerged, false, 'real merge not flagged idempotent');
    assertOk(headCommit(repo) !== before, 'HEAD advanced by the merge');
    assertOk(fs.existsSync(path.join(repo, 'fix.txt')), 'merged file present');
    assertEqual(gitIn(repo, ['remote']).stdout.trim(), '', 'repo has no remote to push to');
    console.log('selfheal merge real merge ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeConflictKeepsBranch() {
  const repo = makeGitRepo();
  try {
    const branch = 'looparr-selfheal-1700000000000-2';
    gitIn(repo, ['checkout', '-b', branch]);
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'branch\n');
    gitIn(repo, ['add', 'conflict.txt']);
    gitIn(repo, ['commit', '-m', 'branch change']);
    gitIn(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'conflict.txt'), 'main\n');
    gitIn(repo, ['add', 'conflict.txt']);
    gitIn(repo, ['commit', '-m', 'main change']);

    const before = headCommit(repo);
    const res = engine.mergeBranchIntoRepo(repo, branch);
    assertEqual(res.ok, false, 'conflict is not ok');
    assertEqual(res.alreadyMerged, false, 'conflict is not idempotent');
    assertOk(res.error && res.error.length > 0, 'conflict surfaces an error string');
    assertEqual(headCommit(repo), before, 'HEAD unchanged after conflict');
    assertOk(gitIn(repo, ['branch', '--list', branch]).stdout.includes(branch), 'conflicted branch kept');
    console.log('selfheal merge conflict keeps branch ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

testRoundTripAndTtl();
testIdleStatus();
testPathContainment();
testMalformedIgnored();
testProdMapping();
testMergeValidation();
testAccountedStatus();
// Git-aware helpers run against throwaway repos, never the live checkout.
testIsMergeableBranchGuards();
testReconcileStaleHealedStatuses();
testMergeableFlagMapping();
testNoPushGuard();
// Engine-level merge mechanics against throwaway git repos (never the live
// checkout): already-ancestor idempotence, a real merge, and a conflict.
testMergeBranchExports();
testMergeAlreadyAncestorIdempotent();
testMergeRealBranchAdvancesHead();
testMergeConflictKeepsBranch();
testExecutorRelay().then(() => {
  console.log('selfheal status tests passed');
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});