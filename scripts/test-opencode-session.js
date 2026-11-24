'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeOpenCodeSessionId,
  isValidOpenCodeSessionId,
  extractSessionIdFromLine,
  createOpenCodeSessionCapture,
  opencodeSessionExists
} = require('../src/runners/opencode-session');

function testNormalize() {
  assert.strictEqual(normalizeOpenCodeSessionId('  ses_abc123  '), 'ses_abc123');
  assert.strictEqual(isValidOpenCodeSessionId('ses_abc123'), true);
  for (const bad of ['', 'phase2-probe-1', 'ses', 'ses;rm -rf /', 'ses_$HOME', 'ses_' + 'a'.repeat(200), 42, null]) {
    assert.strictEqual(normalizeOpenCodeSessionId(bad), '', `expected invalid: ${String(bad)}`);
    assert.strictEqual(isValidOpenCodeSessionId(bad), false, `expected invalid: ${String(bad)}`);
  }
}

function testExtract() {
  assert.strictEqual(extractSessionIdFromLine('{"type":"step_start","sessionID":"ses_line"}'), 'ses_line');
  assert.strictEqual(extractSessionIdFromLine('{"type":"error","sessionID":"bad"}'), '');
  assert.strictEqual(extractSessionIdFromLine('{"type":"step_start"}'), '');
  assert.strictEqual(extractSessionIdFromLine('not json'), '');
  assert.strictEqual(extractSessionIdFromLine(''), '');
}

function testCapture() {
  const capture = createOpenCodeSessionCapture();
  capture.push('{"type":"step_start","sessi');
  capture.push('onID":"ses_split"}\n{"type":"error","sessionID":"ses_other"}\n');
  assert.strictEqual(capture.finish(), 'ses_split');

  const noisy = createOpenCodeSessionCapture();
  noisy.push('not json\n');
  noisy.push('{"type":"step_start"}\n');
  noisy.push('{"sessionID":"ses_late"}');
  assert.strictEqual(noisy.finish(), 'ses_late');

  const absent = createOpenCodeSessionCapture();
  absent.push('{"type":"step_start"}\nnot json\n');
  assert.strictEqual(absent.finish(), '');
}

function testExists() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-session-test-'));
  const bin = path.join(root, 'fake-opencode');
  try {
    fs.writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "session" ] && [ "$2" = "list" ]; then\n  printf '[{"id":"ses_known","directory":"%s"}]\\n' "$PWD"\n  exit 0\nfi\nexit 1\n`, { mode: 0o755 });
    assert.strictEqual(opencodeSessionExists({ cwd: root, sessionId: 'ses_known', bin }), true);
    assert.strictEqual(opencodeSessionExists({ cwd: root, sessionId: 'ses_unknown', bin }), false);
    assert.strictEqual(opencodeSessionExists({ cwd: root, sessionId: 'bad', bin }), false);
    assert.strictEqual(opencodeSessionExists({ cwd: root, sessionId: 'ses_known', bin: path.join(root, 'missing-bin') }), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testNormalize();
testExtract();
testCapture();
testExists();
console.log('opencode session tests passed');
