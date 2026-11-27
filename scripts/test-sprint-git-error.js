'use strict';

// Regression test for the silent spawnSync failure that parked splitarr task 4
// in the analyze phase: a missing git binary returns { error: ENOENT } from
// spawnSync instead of throwing, so git() must surface it as ok:false with a
// non-empty spawnErrorDetail stderr.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const sprint = require(`${REPO_ROOT}/src/sprint`);

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

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertOk(condition, label) {
  assert.ok(condition, label);
}

run('spawnErrorDetail names args and error code', () => {
  const detail = sprint.spawnErrorDetail(
    ['worktree', 'add', '-b', 'looparr/x', '/tmp/w', 'main'],
    Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
  );
  assertOk(typeof detail === 'string' && detail.length > 0, 'detail is a non-empty string');
  assertOk(detail.includes('ENOENT'), `detail includes the error code: ${detail}`);
  assertOk(detail.includes('worktree add'), `detail includes the failed args: ${detail}`);
});

run('git() surfaces a spawn failure as ok:false with spawnErrorDetail stderr', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-git-spawn-'));
  try {
    const previousPath = process.env.PATH;
    process.env.PATH = '/looparr-no-git-on-path';
    let result;
    try {
      result = sprint.git(tempDir, ['status']);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
    if (result.ok && result.stderr === '') {
      throw new Error('git still spawned with a sanitized PATH; this test cannot simulate the missing-binary case');
    }
    assertOk(result.ok === false, 'ok is false');
    assertEqual(result.status, -1, 'status');
    assertEqual(result.stdout, '', 'stdout');
    assertOk(result.stderr && result.stderr.length > 0, 'stderr is non-empty');
    assertOk(result.stderr.includes('failed to spawn'), `stderr names the spawn failure: ${result.stderr}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

console.log(`\n${pass} test(s) passed`);
