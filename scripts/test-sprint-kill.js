'use strict';

// Regression test for splitarr task 3 parked in error by exit 137 / SIGKILL.
// Sprint close handling must name an OOM/resource kill and suggest resuming,
// without mislabeling ordinary crashes or graceful SIGTERM as OOM.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const engine = require(`${REPO_ROOT}/src/engine`);

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

run('exit 137 is an actionable SIGKILL/OOM failure', () => {
  const result = engine.sprintExitFailure(137, null);
  assert.equal(result.killed, true);
  assert.equal(result.exitCode, 137);
  assert.match(result.message, /SIGKILL|OOM/i);
  assert.match(result.message, /resume|retry/i);
});

run('signal SIGKILL with null code is a kill', () => {
  const result = engine.sprintExitFailure(null, 'SIGKILL');
  assert.equal(result.killed, true);
  assert.equal(result.exitCode, 137);
  assert.match(result.message, /SIGKILL|OOM/i);
});

run('ordinary non-zero exit stays generic', () => {
  const result = engine.sprintExitFailure(1, null);
  assert.equal(result.killed, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /code 1/);
  assert.doesNotMatch(result.message, /SIGKILL|OOM/i);
});

run('graceful SIGTERM is not an OOM kill', () => {
  const result = engine.sprintExitFailure(143, 'SIGTERM');
  assert.equal(result.killed, false);
  assert.equal(result.exitCode, 143);
  assert.match(result.message, /code 143/);
  assert.match(result.message, /signal SIGTERM/);
  assert.doesNotMatch(result.message, /SIGKILL|OOM/i);
});

run('clean exit has no failure message', () => {
  const result = engine.sprintExitFailure(0, null);
  assert.equal(result.killed, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.message, '');
});

console.log(`\n${pass} test(s) passed`);
