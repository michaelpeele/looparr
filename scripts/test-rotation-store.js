'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const os = require('node:os');

// Temp dir, not the repo root: the container image runs as uid 1000 and /app is
// read-only for it, so the test has to run there too.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-rotation-'));
process.env.LOOPARR_ROTATION_STATE = path.join(DIR, 'state.json');

function freshStore() {
  delete require.cache[require.resolve('../src/rotation-store')];
  return require('../src/rotation-store');
}

const MODELS = ['model-a', 'model-b', 'model-c'];
let store = freshStore();

assert.equal(store.getCursor(MODELS), 0, 'a fresh cursor starts at 0');

store.setCursor(MODELS, 2);
assert.equal(store.getCursor(MODELS), 2, 'the cursor is readable after a set');

// Reloading the module is the closest analogue to an engine restart.
store = freshStore();
assert.equal(store.getCursor(MODELS), 2, 'the cursor survives a reload');
assert.equal(store.getCursor(['model-a', 'model-b', 'model-c']), 2, 'identical lists share one cursor');
assert.equal(store.getCursor(['model-b', 'model-c']), 0, 'a different list gets its own cursor');

store.markCooling('model-b', Date.now() + 60000);
let picked = store.pick(MODELS);
assert.equal(picked.id, 'model-c', 'a cooling model is skipped from the stored cursor');
assert.equal(picked.index, 2, 'the skipped index is reported');
assert.equal(picked.waitMs, 0, 'a ready candidate needs no wait');

store.markCooling('model-c', Date.now() + 30000);
store.markCooling('model-a', Date.now() + 60000);
picked = store.pick(MODELS);
assert.ok(picked.waitMs > 0, 'all-cooling returns the earliest wait instead of a throttled id');

store.markCooling('model-b', Date.now() - 1000);
store.markCooling('model-a', Date.now() - 1000);
store.markCooling('model-c', Date.now() - 1000);
picked = store.pick(MODELS);
assert.equal(picked.waitMs, 0, 'expired cooldowns are ignored');

store.setCursor(['x', 'y'], 1);
store.advance(['x', 'y'], 1);
assert.equal(store.getCursor(['x', 'y']), 0, 'advance wraps to the start');
store.advance(['only'], 0);
assert.equal(store.getCursor(['only']), 0, 'single-entry lists never move');

fs.rmSync(DIR, { recursive: true, force: true });
console.log('rotation store: cursors persist, cooling is skipped, expiry honoured.');
