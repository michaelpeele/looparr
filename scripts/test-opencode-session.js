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

function testPaseoMetadataFlow() {
  const { buildPaseoMetadata } = require('../src/runners/opencode');
  const meta = buildPaseoMetadata({ model: 'opencode/big-pickle', sessionId: '  ses_abc123  ' });
  assert.strictEqual(meta.provider, 'opencode');
  assert.strictEqual(meta.model, 'opencode/big-pickle');
  assert.strictEqual(meta.sessionId, 'ses_abc123', 'normalized session id flows into Paseo metadata');
  const foreign = buildPaseoMetadata({ model: 'kilo/foo', sessionId: 'bad' });
  assert.strictEqual(foreign.model, '', 'foreign namespace falls back to the Paseo default model');
  assert.strictEqual(foreign.sessionId, '', 'invalid session id dropped');
}

function testSnapshotRoundTrip() {
  const engine = require('../src/engine');
  const autoResume = require('../src/auto-resume');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-paseo-snap-'));
  const project = { id: 'paseo-snap', name: 'Paseo Snap', path: root, autoResumeOnStart: true };
  const saved = process.env.LOOPARR_ALLOW_RESUME_INTENT;
  process.env.LOOPARR_ALLOW_RESUME_INTENT = '1';
  try {
    const rt = {
      active: false,
      status: 'error',
      currentTask: 'Implement the paseo snapshot',
      nextPhase: 'implement',
      opencodeSessionId: 'ses_opencode123',
      paseoAgentId: 'agent-paseo-123',
      stepTask: { index: 1, text: 'Implement the paseo snapshot' }
    };
    assert.strictEqual(engine.writeCheckpointIntent(project, rt), true, 'checkpoint writes');
    const checked = autoResume.readIntent(project);
    assert.ok(checked.ok, 'intent readable');
    assert.strictEqual(checked.intent.opencodeSessionId, 'ses_opencode123', 'opencode session id persisted');
    assert.ok(checked.intent.snapshot, 'snapshot persisted');
    assert.strictEqual(checked.intent.snapshot.paseoAgentId, 'agent-paseo-123',
      'paseo agent id round-trips through the snapshot');
    const legacy = autoResume.sanitizeSnapshot({ stepTask: { index: 2, text: 'x' } });
    assert.ok(legacy, 'legacy snapshot without agent id readable');
    assert.ok(!('paseoAgentId' in legacy), 'missing paseoAgentId stays backward compatible');
  } finally {
    if (saved === undefined) delete process.env.LOOPARR_ALLOW_RESUME_INTENT;
    else process.env.LOOPARR_ALLOW_RESUME_INTENT = saved;
    autoResume.clearIntent(project);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testNormalize();
testExtract();
testCapture();
testExists();
testPaseoMetadataFlow();
testSnapshotRoundTrip();
console.log('opencode session tests passed');
