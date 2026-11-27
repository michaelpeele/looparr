#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const EXECUTOR = path.join(REPO_ROOT, 'scripts', 'host-executor.js');
const TOKEN = 'host-executor-auth-login-test-token';
const DEVICE_URL = 'https://app.kilo.ai/device-auth?code=TEST-CODE-123';
const DEVICE_CODE = 'LONGCODE-1234-5678-9012-3456-7890-ABCD';
const TOKEN_STRING = 'sk_live_ABCDEF0123456789abcdef';
const METHOD_LABEL = 'Kilo Gateway (Device Authorization)';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) return value;
    await wait(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function isAlive(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function fakeOpencodeSource() {
  return `#!/usr/bin/env node
'use strict';
const http = require('http');
const args = process.argv.slice(2);
if (args[0] === 'run' && args.includes('--help')) {
  process.stdout.write('opencode run\\n  --attach  attach to server\\n');
  process.exit(0);
}
if (args[0] === 'serve' && args[1] === '--port') {
  const port = Number(args[2]);
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  server.on('error', (error) => { process.stderr.write(error.message + '\\n'); process.exit(1); });
  server.listen(port, '127.0.0.1', () => process.stdout.write('fake serve ready\\n'));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  setInterval(() => {}, 1000);
} else {
  process.stderr.write('unexpected args: ' + args.join(' ') + '\\n');
  process.exit(1);
}
`;
}

// The fixture stands in for `kilo`. It records its argv and pid, prints a
// spinner/ANSI frame, the device URL, the long code, and a token-looking string,
// then idles until it is terminated.
function fakeKiloSource() {
  return `#!/usr/bin/env bash
set -u
mode="\${1:-none}"
printf '%s\\n' "$*" > "$LOOPARR_TEST_ROOT/kilo-\${mode}-argv.txt"
printf '%s\\n' "\$\$" > "$LOOPARR_TEST_ROOT/kilo-\${mode}.pid"
if [ "$mode" = "auth" ]; then
  printf '\\r\\033[32m\u280b Loading\\033[0m\\r'
  printf '\\033[36m\u25cf  Go to: ${DEVICE_URL}\\033[0m\\n'
  printf '\u25cf  Open ${DEVICE_URL} and enter code: ${DEVICE_CODE}\\n'
  printf 'debug token ${TOKEN_STRING}\\n'
fi
trap 'exit 0' TERM INT
i=0
while [ "$i" -lt 600 ]; do sleep 1; i=$((i + 1)); done
`;
}

let testRoot = null;
let executor = null;
let executorStdout = '';
let executorStderr = '';

function readPid(mode) {
  const file = path.join(testRoot, `kilo-${mode}.pid`);
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function readArgv(mode) {
  const file = path.join(testRoot, `kilo-${mode}-argv.txt`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim();
}

async function main() {
  fs.mkdirSync('/tmp/opencode', { recursive: true });
  testRoot = fs.mkdtempSync('/tmp/opencode/looparr-auth-login-test-');
  const projectRoot = path.join(testRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  const fakeOpencode = path.join(testRoot, 'fake-opencode');
  fs.writeFileSync(fakeOpencode, fakeOpencodeSource(), { mode: 0o755 });
  const fakeKilo = path.join(testRoot, 'fake-kilo');
  fs.writeFileSync(fakeKilo, fakeKiloSource(), { mode: 0o755 });

  const opencodePort = await freePort();
  executor = spawn(process.execPath, [EXECUTOR], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LOOPARR_EXECUTOR_TOKEN: TOKEN,
      LOOPARR_EXECUTOR_PORT: '0',
      LOOPARR_EXECUTOR_BIND: '127.0.0.1',
      LOOPARR_EXECUTOR_OPENCODE_BIN: fakeOpencode,
      LOOPARR_EXECUTOR_OPENCODE_PORT: String(opencodePort),
      LOOPARR_EXECUTOR_KILO_BIN: fakeKilo,
      LOOPARR_PROJECTS_ROOT: testRoot,
      LOOPARR_TEST_ROOT: testRoot
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  executor.stdout.on('data', (chunk) => { executorStdout += chunk.toString(); });
  executor.stderr.on('data', (chunk) => { executorStderr += chunk.toString(); });

  const port = await waitFor('executor port', () => {
    const match = executorStdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
    return match ? Number(match[1]) : null;
  });

  function request(method, urlPath, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = { authorization: `Bearer ${TOKEN}` };
      if (data !== null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(data);
      }
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, text }));
      });
      req.on('error', reject);
      if (data !== null) req.write(data);
      req.end();
    });
  }

  function status() {
    return request('GET', '/auth/kilo/status').then((res) => {
      assert.equal(res.status, 200);
      return JSON.parse(res.text);
    });
  }

  async function activeRuns() {
    const res = await request('GET', '/active');
    assert.equal(res.status, 200);
    return JSON.parse(res.text);
  }

  // 1. Fixture pty output -> url and code parsed on login and visible in status.
  const login = await request('POST', '/auth/kilo/login');
  assert.equal(login.status, 200);
  const loginBody = JSON.parse(login.text);
  assert.ok(loginBody.startedAt);
  assert.ok(['starting', 'waiting'].includes(loginBody.state));

  const firstPid = await waitFor('login child pid', () => readPid('auth'));
  assert.ok(pidAlive(firstPid));

  const waiting = await waitFor('device url', async () => {
    const s = await status();
    return s.url === DEVICE_URL ? s : null;
  });
  assert.equal(waiting.code, DEVICE_CODE);
  assert.ok(['starting', 'waiting'].includes(waiting.state));

  // 5. Login command includes the pty wrapper and the exact method label.
  const authArgv = readArgv('auth');
  assert.ok(authArgv && authArgv.includes(METHOD_LABEL), `argv missing method label: ${authArgv}`);
  const logText = waiting.log.join('\n');
  assert.ok(logText.includes('script'), 'log missing script wrapper');
  assert.ok(logText.includes('-qec'), 'log missing -qec');
  assert.ok(logText.includes(METHOD_LABEL), 'log missing method label');

  // 2. One session per runner: a second login while the first runs is 409.
  const second = await request('POST', '/auth/kilo/login');
  assert.equal(second.status, 409);
  const afterSecond = await status();
  assert.equal(afterSecond.url, DEVICE_URL, 'first session was disturbed by the 409 login');
  assert.ok(pidAlive(firstPid), 'first login child was killed by the 409 login');

  // 4. Log sanitization: ANSI/spinner frames and token-looking text are gone.
  assert.ok(waiting.log.length > 0, 'log is empty');
  assert.ok(waiting.log.length <= 100, `log exceeds cap: ${waiting.log.length}`);
  for (const line of waiting.log) {
    assert.ok(!line.includes('\u001b'), `ANSI escape survived: ${JSON.stringify(line)}`);
    assert.ok(!/^\s*[\u280b\u280d\u2819\u2839\u283c\u2834\u2832\u2837\u2836\u2827\u25d0\u25d3\u25d1\u25d2]/.test(line), `spinner frame survived: ${JSON.stringify(line)}`);
    assert.ok(!line.includes(TOKEN_STRING), `token material survived: ${JSON.stringify(line)}`);
  }

  // 3. Cancel terminates the child, moves to a terminal state, and frees the
  // runner for a fresh login (no stale 409).
  const cancel = await request('POST', '/auth/kilo/cancel');
  assert.equal(cancel.status, 200);
  const cancelBody = JSON.parse(cancel.text);
  assert.equal(cancelBody.ok, true);
  assert.equal(cancelBody.cancelled, true);
  await waitFor('login child exit', () => pidAlive(firstPid) ? null : true);
  const cancelled = await status();
  assert.ok(['failed', 'authorized'].includes(cancelled.state));
  assert.ok(cancelled.finishedAt);

  const relogin = await request('POST', '/auth/kilo/login');
  assert.equal(relogin.status, 200, 'stale session blocked re-login');
  const secondPid = await waitFor('second login child pid', () => {
    const pid = readPid('auth');
    return pid && pid !== firstPid ? pid : null;
  });
  assert.ok(pidAlive(secondPid));
  await request('POST', '/auth/kilo/cancel');
  await waitFor('second login child exit', () => pidAlive(secondPid) ? null : true);

  // Cancel on a nonexistent/terminal session is a no-op 200.
  const noopCancel = await request('POST', '/auth/kilo/cancel');
  assert.equal(noopCancel.status, 200);
  assert.equal(JSON.parse(noopCancel.text).cancelled, false);

  // 6. A login for a runner with an active /run step is refused with 409.
  let runReqRef = null;
  const runHead = await new Promise((resolve) => {
    const data = JSON.stringify({ runKey: 'run-guard', prompt: 'guard', cwd: projectRoot, files: [], model: '', runner: 'kilo', projectId: 'project-guard' });
    const req = http.request({ host: '127.0.0.1', port, path: '/run', method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      runReqRef = req;
      res.on('data', () => {});
      resolve(res.statusCode);
    });
    req.on('error', (e) => resolve(`err:${e.message}`));
    req.write(data);
    req.end();
  });
  assert.equal(runHead, 200, `run head status ${runHead}`);
  await waitFor('run-guard active', async () => {
    const active = await activeRuns();
    return active.some((entry) => entry.runKey === 'run-guard' && entry.runner === 'kilo') ? true : null;
  });
  const guarded = await request('POST', '/auth/kilo/login');
  assert.equal(guarded.status, 409, 'login was not refused during an active step');
  const runCancel = await request('POST', '/cancel', { runKey: 'run-guard' });
  assert.equal(runCancel.status, 200);
  if (runReqRef) runReqRef.destroy();
  await waitFor('run-guard cleared', async () => {
    const active = await activeRuns();
    return active.length === 0 ? true : null;
  });

  // Unknown runner -> 400 on every auth route.
  const unknown = await request('GET', '/auth/bogus/status');
  assert.equal(unknown.status, 400);

  process.stdout.write('host executor auth login test: ok\n');
}

main().catch((error) => {
  console.error(error);
  if (executorStderr) console.error(`executor stderr:\n${executorStderr}`);
  if (executorStdout) console.error(`executor stdout:\n${executorStdout}`);
  process.exitCode = 1;
}).finally(async () => {
  if (isAlive(executor)) {
    executor.kill('SIGTERM');
    await waitFor('executor shutdown', () => isAlive(executor) ? null : true, 5000).catch(() => {
      executor.kill('SIGKILL');
    });
  }
  if (testRoot) {
    for (const mode of ['auth', 'run']) {
      const pid = readPid(mode);
      if (pid) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});