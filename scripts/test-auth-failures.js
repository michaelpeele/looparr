'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-auth-failures-'));
process.env.LOOPARR_AUTH_FAILURES_STATE = path.join(DIR, 'auth-failures.json');

function fresh() {
  delete require.cache[require.resolve('../src/auth-failures')];
  return require('../src/auth-failures');
}

let store = fresh();

// Positive detection signatures.
for (const sig of store.SIGNATURES) {
  assert.equal(store.detect(`error: ${sig}`), true, `detect should match ${sig}`);
}
assert.equal(store.detect('HTTP 401 Unauthorized'), true, 'unauthorized should match');
assert.equal(store.detect('Your authentication token is invalid. Please sign in again.'), true, 'full kilo message should match');

// Negative: bare 401 in arbitrary/fetched HTML must not match.
assert.equal(store.detect('<html>401 Unauthorized page</html>'), false, 'bare 401 html should not match');
assert.equal(store.detect('Fetched page said Sign in to continue'), false, 'benign sign-in text should not match');
assert.equal(store.detect('status code 401 from remote API body'), false, 'bare 401 in tool output should not match');
assert.equal(store.detect(''), false, 'empty should not match');

const rec = store.record('kilo', {
  runnerLabel: 'Kilo',
  message: 'Your authentication token is invalid. Please sign in again.',
  hint: store.hintFor('kilo')
});
assert.equal(rec.runnerId, 'kilo');
assert.equal(rec.runnerLabel, 'Kilo');
assert.match(rec.at, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(rec.hint, 'Open CLI and /models, pick Kilo gateway and reauthenticate.');
assert.equal(store.isBlocked('kilo'), true);
assert.equal(store.isBlocked('unknown'), false);

const listed = store.list();
assert.equal(listed.length, 1);
assert.equal(listed[0].runnerId, 'kilo');

// Persistence across re-require.
store = fresh();
assert.equal(store.isBlocked('kilo'), true, 'block persists across reload');
assert.equal(store.get('kilo').message, 'Your authentication token is invalid. Please sign in again.');

// Sticky: no time expiry / simulated restart-cooloff has no effect.
store = fresh();
assert.equal(store.isBlocked('kilo'), true, 'block remains sticky after reload');

// Clear on success/manual Start equivalent.
assert.equal(store.clear('kilo'), true);
assert.equal(store.isBlocked('kilo'), false);
assert.equal(store.clear('kilo'), false, 'clearing absent runner returns false');
store.record('kilo', { runnerLabel: 'Kilo', message: 'INVALID_TOKEN' });
assert.equal(store.isBlocked('kilo'), true);
store.clear(); // clear all
assert.equal(store.isBlocked('kilo'), false);

// File mode 0600.
const stat = fs.statSync(process.env.LOOPARR_AUTH_FAILURES_STATE);
assert.equal(stat.mode & 0o777, 0o600, 'state file should be 0600');

fs.rmSync(DIR, { recursive: true, force: true });
console.log('auth-failures store: detection, persistence, sticky, clear, mode ok.');
