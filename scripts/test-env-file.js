'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadDotEnv } = require('../src/env-file');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-env-'));
const envFile = path.join(tmp, '.env');

function reset() {
  delete process.env.LOOPARR_TEST_ONLY;
  delete process.env.LOOPARR_TEST_EXISTING;
  delete process.env.LOOPARR_TEST_QUOTED;
  delete process.env.LOOPARR_TEST_EXPORTED;
}

try {
  reset();

  // Missing file is a no-op.
  loadDotEnv(path.join(tmp, 'does-not-exist.env'));
  assert.strictEqual(process.env.LOOPARR_TEST_ONLY, undefined, 'missing file loads nothing');

  fs.writeFileSync(envFile, [
    '# comment line',
    '',
    'LOOPARR_TEST_ONLY=from-file',
    'LOOPARR_TEST_EXISTING=from-file',
    'LOOPARR_TEST_QUOTED="quoted value"',
    'not a valid line',
    'export LOOPARR_TEST_EXPORTED=exported'
  ].join('\n'));

  process.env.LOOPARR_TEST_EXISTING = 'from-process';
  loadDotEnv(envFile);

  assert.strictEqual(process.env.LOOPARR_TEST_ONLY, 'from-file', 'loads a plain key');
  assert.strictEqual(process.env.LOOPARR_TEST_EXISTING, 'from-process', 'existing process.env wins');
  assert.strictEqual(process.env.LOOPARR_TEST_QUOTED, 'quoted value', 'strips surrounding quotes');
  assert.strictEqual(process.env.LOOPARR_TEST_EXPORTED, 'exported', 'loads an exported key');

  // Key filter loads only the requested keys.
  reset();
  loadDotEnv(envFile, { keys: ['LOOPARR_TEST_ONLY'] });
  assert.strictEqual(process.env.LOOPARR_TEST_ONLY, 'from-file', 'filtered load includes the requested key');
  assert.strictEqual(process.env.LOOPARR_TEST_QUOTED, undefined, 'filtered load skips other keys');
  assert.strictEqual(process.env.LOOPARR_TEST_EXPORTED, undefined, 'filtered load skips exported keys');

  console.log('test-env-file: ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  reset();
}