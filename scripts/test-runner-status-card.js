'use strict';

// The configured-runner card lists every configured model under Active or Rate
// limited, and marks a runner itself rate limited when all of its configured
// models are cooling. The browser can only do that when /api/state carries the
// rotation cooldowns, so both sides are asserted here.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(REPO_ROOT, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(REPO_ROOT, 'public', 'styles.css'), 'utf8');
const ENGINE = fs.readFileSync(path.join(REPO_ROOT, 'src', 'engine.js'), 'utf8');

assert.ok(HTML.includes('id="host-runner-status"'), 'home page has the runner status container');
assert.ok(HTML.includes('id="host-runner"'), 'configured runner name is kept');
assert.ok(!HTML.includes('>Access</span>'), 'Access card is gone');
assert.ok(
  /\.host-strip\s*\{[^}]*grid-template-columns:\s*1fr/s.test(CSS),
  'runner card spans the page'
);
assert.ok(/\.runner-status\s*\{[^}]*grid-template-columns:\s*repeat\(2/s.test(CSS), 'two status sections side by side');

assert.ok(APP.includes("hostRunnerStatus: $('host-runner-status')"), 'app.js binds the status container');
assert.ok(APP.includes('function renderRunnerStatus(state)'), 'app.js renders the status sections');
assert.ok(APP.includes('<h3 class="runner-status-title">Active</h3>'), 'Active section label');
assert.ok(APP.includes('<h3 class="runner-status-title">Rate limited</h3>'), 'Rate limited section label');
assert.ok(APP.includes('state.rotation && state.rotation.cooling'), 'model state comes from rotation cooldowns');
assert.ok(APP.includes('rate limited`'), 'a fully limited runner is labelled rate limited');
assert.ok(APP.includes("' runner-limited'"), 'runner-level limit gets its own class');
assert.ok(CSS.includes('.runner-model.runner-limited'), 'styles.css emphasises a rate-limited runner');

assert.ok(ENGINE.includes('rotation: rotationStore.snapshot()'), 'engine exposes cooldowns in /api/state');

// Rotation store snapshot: only future cooldowns, pruned on read.
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-rotation-card-'));
process.env.LOOPARR_ROTATION_STATE = path.join(TMP_ROOT, 'rotation-state.json');
const rotationStore = require(path.join(REPO_ROOT, 'src', 'rotation-store.js'));
rotationStore.reset();
rotationStore.markCooling('model-cooling', Date.now() + 60_000);
rotationStore.markCooling('model-expired', Date.now() - 60_000);
const snapshot = rotationStore.snapshot();
assert.ok(snapshot.cooling['model-cooling'] > Date.now(), 'future cooldown exposed');
assert.equal(snapshot.cooling['model-expired'], undefined, 'expired cooldown pruned from the snapshot');
assert.deepEqual(Object.keys(snapshot.cooling), ['model-cooling'], 'snapshot carries only active cooldowns');

fs.rmSync(TMP_ROOT, { recursive: true, force: true });
console.log('runner status card: sections, runner-level limit, and cooldown snapshot verified.');
