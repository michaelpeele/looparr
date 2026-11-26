'use strict';

// Focused tests for the Paseo run adapter (PLAN-02): run flags, labels,
// workspace reuse, attach/wait usage, stop on cancel, robust JSON parsing,
// every status mapping, and the stale-run cleanup. Uses a fake `paseo`
// binary prepended to PATH.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const paseoTransport = require('../src/paseo-transport');
const runners = require('../src/runners');

const WORKSPACE_CWD = '/tmp/looparr-paseo-project';
const AGENT_ID = 'agent-12345678';

function writeFakePaseo(binDir, state) {
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
  je({ agentId: '${AGENT_ID}' });
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
    model: 'scope/model-id',
    runKey: 'run-key-1',
    projectId: 'proj-1',
    phase: 'implement',
    task: 'the task text',
    title: 'Looparr title',
    runnerId: 'opencode',
    onLog: (stream, chunk) => logs.push([stream, String(chunk)])
  });
  return {
    handle,
    logs,
    done: new Promise((resolve) => handle.once('close', resolve))
  };
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

    // Full run: flags, labels, workspace argument, attach/wait, streaming, idle close.
    writeFakePaseo(tmp, {});
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
        const runCall = findCallWhere(calls, 'run ') || [];
        assert.ok(runCall.length > 0, 'a run call was made');
        const runArgs = runCall;
        for (const flag of ['run', '--no-wait', '--json']) {
          assert.ok(runArgs.includes(flag), `run carries ${flag}`);
        }
        for (const pair of [
          ['--provider', 'opencode/scope/model-id'],
          ['--cwd', WORKSPACE_CWD],
          ['--title', 'Looparr title'],
          ['--workspace', 'wks_fixed']
        ]) {
          assert.equal(runArgs[runArgs.indexOf(pair[0]) + 1], pair[1], `run carries ${pair[0]} ${pair[1]}`);
        }
        for (const label of ['looparr=true', 'runner=opencode', 'runKey=run-key-1', 'projectId=proj-1']) {
          assert.ok(runArgs.includes(label), `run carries label ${label}`);
        }
        assert.ok(runArgs[runArgs.length - 1] === 'do the looparr task', 'run passes the prompt verbatim');
        assert.ok(findCall(calls, `attach ${AGENT_ID}`), 'attach called for the agent');
        assert.ok(findCallWhere(calls, `agent wait ${AGENT_ID} `), 'wait called for the agent');
        assert.equal(closeCode, 0, `idle finishes with exit 0 (got ${closeCode})`);
        const texts = logs.map(([stream, text]) => `${stream}:${text}`).join('|');
        assert.ok(texts.includes('out:stream line one'), 'attach output streams into onLog');
      });
    }

    // Workspace reuse across two starts: the workspace id never changes.
    fs.writeFileSync(fakeStatePath(tmp), JSON.stringify({ waitStatus: 'idle' }));
    await withFakePaseo(tmp, {}, async () => {
      const first = runSpawnRun(tmp);
      await first.done;
      const second = runSpawnRun(tmp);
      await second.done;
      const workspaceFlags = readCalls(tmp)
        .filter((call) => callText(call).startsWith('run '))
        .map((call) => {
          const args = Array.isArray(call) ? call : String(call).split(' ');
          return args[args.indexOf('--workspace') + 1];
        });
      assert.equal(workspaceFlags.length, 2, 'two run calls observed');
      assert.equal(workspaceFlags[0], 'wks_fixed', 'first start reuses the stable workspace');
      assert.equal(workspaceFlags[1], 'wks_fixed', 'second start reuses the same workspace');
    });

    // Status mappings end to end: exit codes and log notes.
    writeFakePaseo(tmp, {});
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
    writeFakePaseo(tmp, {});
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
        .filter((call) => callText(call).startsWith('agent stop '))
        .map((call) => (Array.isArray(call) ? call : String(call).split(' '))[2]);
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
