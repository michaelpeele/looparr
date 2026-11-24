'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const selfhealStatus = require(path.join(REPO_ROOT, 'src/selfheal-status.js'));

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
  const port = 4197;
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

testRoundTripAndTtl();
testIdleStatus();
testPathContainment();
testMalformedIgnored();
testProdMapping();
testMergeValidation();
testNoPushGuard();
testExecutorRelay().then(() => {
  console.log('selfheal status tests passed');
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});