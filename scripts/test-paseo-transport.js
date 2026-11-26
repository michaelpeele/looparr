'use strict';

// Focused tests for the Paseo run adapter (PLAN-02/03): run flags and model
// namespace handling, default-model fallback, unknown-model retry, import/send
// resume, labels, workspace reuse, attach/wait usage, stop on cancel, robust
// JSON parsing, every status mapping, and the stale-run cleanup. Uses a fake
// `paseo` binary prepended to PATH.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paseoTransport = require('../src/paseo-transport');
const runners = require('../src/runners');

const WORKSPACE_CWD = '/tmp/looparr-paseo-project';
const AGENT_ID = 'agent-12345678';

function writeFakePaseo(binDir) {
  const scriptPath = path.join(binDir, 'paseo');
  fs.writeFileSync(scriptPath, `#!/usr/bin/env node
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(process.env.PASEO_FAKE_STATE, 'utf8'));
const args = process.argv.slice(2);
// Append-only call journal: concurrent fake subprocesses must not clobber
// each other's records via read-modify-write on a shared state file.
fs.appendFileSync(process.env.PASEO_FAKE_CALLS, JSON.stringify(args) + '\\n');
const command = args[0];
const sub = command === 'agent' ? args[1] : args[1];
function je(value) { process.stdout.write(JSON.stringify(value)); }
if (command === 'workspace' && sub === 'ls') {
  je([{ workspaceId: 'wks_fixed', cwd: '${WORKSPACE_CWD}' }]);
} else if (command === 'run') {
  if (state.runNoise) process.stdout.write('paseo: starting agent on daemon\\n');
  const hasModel = args.includes('--model');
  if (state.runErrorUnknownModel && hasModel) {
    je({ error: { code: 'AGENT_CREATE_FAILED', message: 'Unknown model: not available' } });
  } else {
    const out = { agentId: '${AGENT_ID}' };
    if (state.runSessionId) out.sessionId = state.runSessionId;
    je(out);
  }
} else if (command === 'import') {
  const out = { agentId: '${AGENT_ID}', status: 'created', provider: 'opencode' };
  if (state.importSessionId) out.sessionId = state.importSessionId;
  je(out);
} else if (command === 'send') {
  je({ agentId: args[1], status: 'sent' });
} else if (command === 'attach') {
  process.stdout.write('stream line one\\n');
  process.stdout.write('stream line two\\n');
} else if (command === 'agent' && sub === 'wait') {
  if (state.waitHang) {
    // Simulate a still-running agent: hold until a stop creates the release
    // marker, so the test can exercise cancel against a live wait.
    const { execFileSync } = require('child_process');
    for (let waited = 0; waited < 600; waited += 1) {
      if (fs.existsSync(process.env.PASEO_FAKE_RELEASE)) break;
      execFileSync('sleep', ['0.05']);
    }
  }
  je({ agentId: '${AGENT_ID}', status: state.waitStatus || 'idle', message: state.waitMessage || 'done' });
} else if (command === 'agent' && sub === 'stop') {
  je({ ok: true });
  try { fs.writeFileSync(process.env.PASEO_FAKE_RELEASE, 'x'); } catch { /* test helper only */ }
} else if (command === 'agent' && sub === 'ls') {
  je(state.agents || []);
}
`);
  fs.chmodSync(scriptPath, 0o755);
}

function fakeStatePath(tmp) {
  return path.join(tmp, 'fake-state.json');
}

function callsPath(tmp) {
  return path.join(tmp, 'calls.ndjson');
}

function resetCalls(tmp) {
  fs.writeFileSync(callsPath(tmp), '');
}

function readCalls(tmp) {
  return fs.readFileSync(callsPath(tmp), 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function callText(call) {
  return Array.isArray(call) ? call.join(' ') : String(call);
}

const findCall = (calls, prefix) => calls.find((call) => callText(call) === prefix);
const findCallWhere = (calls, prefix) => calls.find((call) => callText(call).startsWith(prefix));

function withFakePaseo(tmp, state, fn) {
  process.env.PASEO_FAKE_STATE = fakeStatePath(tmp);
  process.env.PASEO_FAKE_CALLS = callsPath(tmp);
  resetCalls(tmp);
  fs.writeFileSync(fakeStatePath(tmp), JSON.stringify(state));
  const oldPath = process.env.PATH;
  process.env.PATH = `${tmp}:${oldPath}`;
  return Promise.resolve(fn()).finally(() => {
    process.env.PATH = oldPath;
    delete process.env.PASEO_FAKE_STATE;
    delete process.env.PASEO_FAKE_CALLS;
  });
}

function runSpawnRun(tmp, overrides = {}, stateOverrides = {}) {
  const logs = [];
  const state = { runNoise: false, waitStatus: 'idle', ...stateOverrides };
  fs.writeFileSync(fakeStatePath(tmp), JSON.stringify(state));
  const handle = paseoTransport.spawnRun({
    cwd: WORKSPACE_CWD,
    prompt: 'do the looparr task',
    model: 'opencode/big-pickle',
    runKey: 'run-key-1',
    projectId: 'proj-1',
    phase: 'implement',
    task: 'the task text',
    title: 'Looparr title',
    runnerId: 'opencode',
    onLog: (stream, chunk) => logs.push([stream, String(chunk)]),
    ...overrides
  });
  return {
    handle,
    logs,
    done: new Promise((resolve) => handle.once('close', resolve))
  };
}

function runResume(tmp, overrides = {}, stateOverrides = {}) {
  const logs = [];
  const state = { waitStatus: 'idle', ...stateOverrides };
  fs.writeFileSync(fakeStatePath(tmp), JSON.stringify(state));
  const handle = paseoTransport.resumeRun({
    cwd: WORKSPACE_CWD,
    prompt: 'do the resume task',
    sessionId: 'ses_abc123',
    runKey: 'run-key-1',
    projectId: 'proj-1',
    runnerId: 'opencode',
    onLog: (stream, chunk) => logs.push([stream, String(chunk)]),
    ...overrides
  });
  return {
    handle,
    logs,
    done: new Promise((resolve) => handle.once('close', resolve))
  };
}

function runArgsFrom(calls) {
  const call = calls.find((entry) => Array.isArray(entry) && entry[0] === 'run');
  return call || [];
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paseo-transport-test-'));
  fs.mkdirSync(WORKSPACE_CWD, { recursive: true });
  const previousExecutorUrl = process.env.LOOPARR_EXECUTOR_URL;
  delete process.env.LOOPARR_EXECUTOR_URL;
  delete process.env.PASEO_WORKSPACE_ID;
  try {
    // Provider mapping helper.
    assert.equal(runners.paseoProviderForRunner('opencode'), 'opencode', 'opencode maps to opencode');
    assert.equal(runners.paseoProviderForRunner('vibe'), 'mistral-vibe', 'vibe maps to mistral-vibe');
    assert.equal(runners.paseoProviderForRunner('kilo'), 'kilo', 'kilo maps to kilo');
    assert.equal(runners.paseoProviderForRunner('other'), 'other', 'default maps to the runner id');

    // Setting detection.
    assert.equal(paseoTransport.isEnabled({ paseoTransport: false }), false, 'disabled when setting off');
    assert.equal(paseoTransport.isEnabled({}), false, 'disabled when setting missing');
    assert.equal(paseoTransport.isEnabled({ paseoTransport: true }), true, 'enabled when setting true');
    process.env.LOOPARR_EXECUTOR_URL = 'http://127.0.0.1:4187';
    assert.equal(paseoTransport.isEnabled({ paseoTransport: true }), false,
      'disabled under host-executor even when setting on');
    if (previousExecutorUrl === undefined) delete process.env.LOOPARR_EXECUTOR_URL;
    else process.env.LOOPARR_EXECUTOR_URL = previousExecutorUrl;

    // JSON parsing tolerates surrounding noise.
    assert.deepEqual(
      paseoTransport.extractJsonObject('banner line\n{"agentId":"a-1","status":"idle"}\ntrailing\n'),
      { agentId: 'a-1', status: 'idle' },
      'JSON object found among noise lines'
    );
    assert.deepEqual(paseoTransport.extractJsonObject('{"a":{"b":1}}'), { a: { b: 1 } }, 'nested braces');
    assert.equal(paseoTransport.extractJsonObject('no json here'), null, 'no JSON returns null');

    // Status mappings.
    assert.deepEqual(paseoTransport.mapPaseoStatus('idle'), { code: 0, kind: 'completed' }, 'idle maps to 0');
    assert.deepEqual(paseoTransport.mapPaseoStatus('error'), { code: 1, kind: 'failed' }, 'error maps to 1');
    assert.deepEqual(paseoTransport.mapPaseoStatus('permission'), { code: 1, kind: 'permission' },
      'permission maps to 1');
    assert.deepEqual(paseoTransport.mapPaseoStatus('timeout'), { code: 124, kind: 'timed out' },
      'timeout maps to 124');

    // Full run: exact flag order, namespaced model, labels, workspace, prompt
    // last, attach/wait, streaming, idle close.
    writeFakePaseo(tmp);
    for (const state of [
      { runNoise: false, waitStatus: 'idle' },
      { runNoise: true, waitStatus: 'idle' }
    ]) {
      fs.writeFileSync(fakeStatePath(tmp), JSON.stringify(state));
      let closeCode;
      await withFakePaseo(tmp, state, async () => {
        const { handle, logs, done } = runSpawnRun(tmp);
        closeCode = await done;
        if (state.runNoise) {
          assert.ok(handle.paseoAgentId === AGENT_ID, 'agentId recorded from noisy JSON');
        }
        const calls = readCalls(tmp);
        const runArgs = runArgsFrom(calls);
        assert.ok(runArgs.length > 0, 'a run call was made');
        assert.deepEqual(runArgs, [
          'run', '--no-wait', '--json',
          '--provider', 'opencode',
          '--model', 'opencode/big-pickle',
          '--cwd', WORKSPACE_CWD,
          '--title', 'Looparr title',
          '--label', 'looparr=true',
          '--label', 'runner=opencode',
          '--label', 'runKey=run-key-1',
          '--label', 'projectId=proj-1',
          '--workspace', 'wks_fixed',
          'do the looparr task'
        ], 'run flag order is exact and the prompt is last');
        assert.ok(findCall(calls, `attach ${AGENT_ID}`), 'attach called for the agent');
        assert.ok(findCallWhere(calls, `agent wait ${AGENT_ID} `), 'wait called for the agent');
        assert.equal(closeCode, 0, `idle finishes with exit 0 (got ${closeCode})`);
        const texts = logs.map(([stream, text]) => `${stream}:${text}`).join('|');
        assert.ok(texts.includes('out:stream line one'), 'attach output streams into onLog');
      });
    }

    // Model namespace handling: bare and opencode-namespaced ids pass through;
    // a foreign Looparr namespace falls back to the Paseo default model.
    writeFakePaseo(tmp);
    for (const [model, expectedModel] of [
      ['big-pickle', 'opencode/big-pickle'],
      ['opencode/big-pickle', 'opencode/big-pickle'],
      ['kilo/baidu/ernie-5.5-flash-preview:free', null],
      ['', null]
    ]) {
      await withFakePaseo(tmp, { waitStatus: 'idle' }, async () => {
        const { done } = runSpawnRun(tmp, { model });
        await done;
        const runArgs = runArgsFrom(readCalls(tmp));
        const modelIndex = runArgs.indexOf('--model');
        if (expectedModel) {
          assert.ok(modelIndex >= 0, `model ${model} emits --model`);
          assert.equal(runArgs[modelIndex + 1], expectedModel, `model ${model} sanitized`);
        } else {
          assert.equal(modelIndex, -1, `model ${model} omits --model (default)`);
        }
        assert.ok(!runArgs.some((arg) => arg.startsWith('opencode/kilo/')),
          'never emits a double namespace opencode/kilo/...');
      });
    }

    // Unknown-model retry: first run with --model is rejected, second without
    // the suffix succeeds and the agent is recorded.
    writeFakePaseo(tmp);
    await withFakePaseo(tmp, { waitStatus: 'idle', runErrorUnknownModel: true }, async () => {
      const { handle, logs, done } = runSpawnRun(tmp, { model: 'opencode/big-pickle' }, { runErrorUnknownModel: true });
      const code = await done;
      assert.equal(code, 0, 'unknown-model retry finishes with exit 0');
      assert.equal(handle.paseoAgentId, AGENT_ID, 'agent recorded after retry');
      const runs = readCalls(tmp).filter((call) => Array.isArray(call) && call[0] === 'run');
      assert.equal(runs.length, 2, 'two run calls: rejected then default');
      assert.ok(runs[0].includes('--model'), 'first run requested the model');
      assert.ok(!runs[1].includes('--model'), 'retry omitted the model');
      const system = logs.filter(([stream]) => stream === 'system').map(([, text]) => text).join('|');
      assert.ok(/retrying with the default model/.test(system), 'retry is logged');
    });

    // JSON provider session id is parsed and emitted.
    writeFakePaseo(tmp);
    await withFakePaseo(tmp, { waitStatus: 'idle', runSessionId: 'ses_fromrun' }, async () => {
      const seen = [];
      const { handle, done } = runSpawnRun(tmp, {}, { runSessionId: 'ses_fromrun' });
      handle.on('sessionId', (id) => seen.push(id));
      await done;
      assert.equal(handle.paseoSessionId, 'ses_fromrun', 'provider session id recorded from run JSON');
      assert.deepEqual(seen, ['ses_fromrun'], 'sessionId event emitted');
    });

    // Import then send resume: exact flag order, prompt last, streaming, close.
    writeFakePaseo(tmp);
    await withFakePaseo(tmp, { waitStatus: 'idle' }, async () => {
      const { handle, logs, done } = runResume(tmp);
      const code = await done;
      assert.equal(code, 0, 'resume finishes with exit 0');
      assert.equal(handle.paseoAgentId, AGENT_ID, 'resume records the imported agent id');
      const calls = readCalls(tmp);
      const importCall = calls.find((call) => Array.isArray(call) && call[0] === 'import');
      assert.ok(importCall, 'an import call was made');
      assert.deepEqual(importCall, [
        'import', 'ses_abc123',
        '--provider', 'opencode',
        '--cwd', WORKSPACE_CWD,
        '--label', 'looparr=true',
        '--label', 'runner=opencode',
        '--label', 'runKey=run-key-1',
        '--label', 'projectId=proj-1',
        '--json'
      ], 'import flag order is exact');
      const sendCall = calls.find((call) => Array.isArray(call) && call[0] === 'send');
      assert.ok(sendCall, 'a send call was made');
      assert.deepEqual(sendCall, ['send', AGENT_ID, 'do the resume task', '--no-wait', '--json'],
        'send flag order is exact and the prompt is last');
      assert.ok(findCall(calls, `attach ${AGENT_ID}`), 'attach called for the imported agent');
      assert.ok(findCallWhere(calls, `agent wait ${AGENT_ID} `), 'wait called for the imported agent');
      const texts = logs.map(([stream, text]) => `${stream}:${text}`).join('|');
      assert.ok(texts.includes('out:stream line one'), 'attach output streams into onLog during resume');
    });

    // Workspace reuse across two starts: the workspace id never changes.
    fs.writeFileSync(fakeStatePath(tmp), JSON.stringify({ waitStatus: 'idle' }));
    await withFakePaseo(tmp, {}, async () => {
      const first = runSpawnRun(tmp);
      await first.done;
      const second = runSpawnRun(tmp);
      await second.done;
      const workspaceFlags = readCalls(tmp)
        .filter((call) => Array.isArray(call) && call[0] === 'run')
        .map((call) => call[call.indexOf('--workspace') + 1]);
      assert.equal(workspaceFlags.length, 2, 'two run calls observed');
      assert.equal(workspaceFlags[0], 'wks_fixed', 'first start reuses the stable workspace');
      assert.equal(workspaceFlags[1], 'wks_fixed', 'second start reuses the same workspace');
    });

    // Status mappings end to end: exit codes and log notes.
    writeFakePaseo(tmp);
    for (const [status, expectedCode, expectNote] of [
      ['error', 1, false],
      ['permission', 1, true],
      ['timeout', 124, true]
    ]) {
      const state = { waitStatus: status, waitMessage: `status ${status}` };
      await withFakePaseo(tmp, state, async () => {
        const { logs, done } = runSpawnRun(tmp, {}, state);
        const code = await done;
        assert.equal(code, expectedCode, `${status} exits ${expectedCode}`);
        const system = logs.filter(([stream]) => stream === 'system').map(([, text]) => text).join('|');
        if (expectNote) {
          assert.ok(system.includes(`status ${status}`), `${status} appends a note to the log`);
        } else {
          assert.ok(system.length > 0, `${status} logs a failure line`);
        }
      });
    }

    // Stop on cancel: the fake wait hangs until `agent stop` releases it.
    writeFakePaseo(tmp);
    await withFakePaseo(tmp, {}, async () => {
      const state = { waitStatus: 'idle', waitHang: true };
      process.env.PASEO_FAKE_RELEASE = path.join(tmp, 'release.marker');
      try {
        const { handle, done } = runSpawnRun(tmp, {}, state);
        await new Promise((resolve) => {
          if (handle.paseoAgentId) return resolve();
          handle.once('agentId', resolve);
        });
        handle.kill('SIGTERM');
        const code = await done;
        assert.equal(code, null, 'cancel closes with a null code');
        assert.ok(findCall(readCalls(tmp), `agent stop ${AGENT_ID}`),
          'cancel runs paseo agent stop for the recorded agent id');
      } finally {
        delete process.env.PASEO_FAKE_RELEASE;
      }
    });

    // Stale cleanup: leftover looparr agents for the project are stopped.
    const agents = [
      { id: 'stale-1', labels: { looparr: 'true', projectId: 'proj-1', runKey: 'old-key' } },
      { id: 'stale-2', labels: { looparr: 'true', projectId: 'proj-1', runKey: 'run-key-1' } },
      { id: 'foreign', labels: { projectId: 'proj-2', runKey: 'old-key' } }
    ];
    await withFakePaseo(tmp, { agents }, async () => {
      const result = await paseoTransport.cleanStaleRuns({ projectId: 'proj-1', keepRunKey: 'run-key-1' });
      assert.ok(result.ok, 'cleanup resolves ok');
      const stops = readCalls(tmp)
        .filter((call) => Array.isArray(call) && callText(call).startsWith('agent stop '))
        .map((call) => call[2]);
      assert.deepEqual(stops.sort(), ['stale-1'], 'stale agent stopped, current run and foreign project untouched');
      const stopped = await paseoTransport.stopAgent('manual-id');
      assert.ok(stopped.ok, 'stopAgent resolves ok');
      assert.ok(findCall(readCalls(tmp), 'agent stop manual-id'), 'stopAgent calls paseo agent stop');
    });

    console.log('ALL TESTS PASSED');
  } finally {
    if (previousExecutorUrl === undefined) delete process.env.LOOPARR_EXECUTOR_URL;
    else process.env.LOOPARR_EXECUTOR_URL = previousExecutorUrl;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});