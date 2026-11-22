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
const TOKEN = 'host-executor-run-key-test-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, check, timeout = 10000) {
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
const fs = require('fs');
const http = require('http');
const path = require('path');
const args = process.argv.slice(2);

if (args[0] === 'run' && args.includes('--help')) {
  process.stdout.write('opencode run\\n  --attach  attach to server\\n');
  process.exit(0);
}

if (args[0] === 'serve' && args[1] === '--port') {
  const port = Number(args[2]);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  server.on('error', (error) => {
    process.stderr.write(error.message + '\\n');
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write('fake serve ready\\n');
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
  setInterval(() => {}, 1000);
} else if (args[0] === 'run') {
  const prompt = args[args.length - 1];
  fs.writeFileSync(path.join(process.env.LOOPARR_TEST_ROOT, prompt + '.pid'), String(process.pid));
  process.stdout.write('fake run started\\n');
  setInterval(() => {}, 1000);
} else {
  process.stderr.write('unexpected args: ' + args.join(' ') + '\\n');
  process.exit(1);
}
`;
}

let testRoot = null;
let executor = null;
let executorStdout = '';
let executorStderr = '';

async function main() {
  fs.mkdirSync('/tmp/opencode', { recursive: true });
  testRoot = fs.mkdtempSync('/tmp/opencode/looparr-run-key-test-');
  const projectRoot = path.join(testRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  const fakeBin = path.join(testRoot, 'fake-opencode');
  fs.writeFileSync(fakeBin, fakeOpencodeSource(), { mode: 0o755 });

  const opencodePort = await freePort();
  executor = spawn(process.execPath, [EXECUTOR], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LOOPARR_EXECUTOR_TOKEN: TOKEN,
      LOOPARR_EXECUTOR_PORT: '0',
      LOOPARR_EXECUTOR_BIND: '127.0.0.1',
      LOOPARR_EXECUTOR_OPENCODE_BIN: fakeBin,
      LOOPARR_EXECUTOR_OPENCODE_PORT: String(opencodePort),
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

  function readPid(prompt) {
    const file = path.join(testRoot, `${prompt}.pid`);
    if (!fs.existsSync(file)) return null;
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  function request(method, urlPath, body, onLine) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = { authorization: `Bearer ${TOKEN}` };
      if (data !== null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(data);
      }
      const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
        let text = '';
        let pending = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
          pending += chunk;
          let index = pending.indexOf('\n');
          while (index !== -1) {
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (line) {
              const value = JSON.parse(line);
              if (onLine) onLine(value);
            }
            index = pending.indexOf('\n');
          }
        });
        res.on('end', () => {
          const lines = text
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
          resolve({ status: res.statusCode, text, lines });
        });
      });
      req.on('error', reject);
      if (data !== null) req.write(data);
      req.end();
    });
  }

  function postRun(runKey, prompt, onLine, projectId = '') {
    return request('POST', '/run', {
      runKey,
      prompt,
      cwd: projectRoot,
      files: [],
      model: '',
      projectId
    }, onLine);
  }

  async function activeRuns() {
    const response = await request('GET', '/active');
    assert.equal(response.status, 200);
    return JSON.parse(response.text);
  }

  const firstFrames = [];
  const firstPromise = postRun('key-a', 'first', (line) => firstFrames.push(line), 'project-a');
  const firstPid = await waitFor('first child pid', () => readPid('first'));

  await waitFor('first active run', async () => {
    const active = await activeRuns();
    return active.length === 1 && active[0].runKey === 'key-a' ? true : null;
  });

  const secondFrames = [];
  const secondPromise = postRun('key-a', 'second', (line) => secondFrames.push(line), 'project-a');
  secondPromise.catch(() => {});
  await waitFor('replacement frame', () => secondFrames.some((line) => line.stream === 'err'
    && line.text.includes('previous run for this key is being replaced')) ? true : null);

  const first = await firstPromise;
  assert.ok(first.lines.some((line) => line.exit === 137));

  await waitFor('first child exit', () => pidAlive(firstPid) ? null : true);
  const secondPid = await waitFor('second child pid', () => readPid('second'));
  assert.ok(pidAlive(secondPid));

  const oneActive = await activeRuns();
  assert.equal(oneActive.length, 1);
  assert.equal(oneActive[0].runKey, 'key-a');
  assert.equal(oneActive[0].projectId, 'project-a');
  assert.equal(oneActive[0].cwd, projectRoot);
  assert.equal(typeof oneActive[0].startedAt, 'string');

  const thirdPromise = postRun('key-b', 'third', undefined, 'project-b');
  thirdPromise.catch(() => {});
  const thirdPid = await waitFor('third child pid', () => readPid('third'));
  assert.ok(pidAlive(thirdPid));

  const twoActive = await activeRuns();
  assert.equal(twoActive.length, 2);
  assert.deepEqual(twoActive.map((entry) => entry.runKey).sort(), ['key-a', 'key-b']);
  assert.deepEqual(twoActive.map((entry) => entry.projectId).sort(), ['project-a', 'project-b']);

  const cancelResponse = await request('POST', '/cancel', { projectId: 'project-a' });
  assert.equal(cancelResponse.status, 200);
  const cancelResult = JSON.parse(cancelResponse.text);
  assert.equal(cancelResult.ok, true);
  assert.deepEqual(cancelResult.cancelled.map((entry) => entry.runKey), ['key-a']);
  assert.deepEqual(cancelResult.cancelled.map((entry) => entry.projectId), ['project-a']);
  const second = await secondPromise;
  assert.ok(second.lines.some((line) => line.exit === 137));
  await waitFor('cancelled child exit', () => pidAlive(secondPid) ? null : true);

  const afterCancel = await activeRuns();
  assert.equal(afterCancel.length, 1);
  assert.equal(afterCancel[0].runKey, 'key-b');
  assert.equal(afterCancel[0].projectId, 'project-b');
  assert.ok(pidAlive(thirdPid));
  thirdPromise.catch(() => {});

  process.stdout.write('host executor run key test: ok\n');
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
  for (const prompt of ['first', 'second', 'third']) {
    if (!testRoot) continue;
    const file = path.join(testRoot, `${prompt}.pid`);
    if (!fs.existsSync(file)) continue;
    const pid = Number(fs.readFileSync(file, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true });
});
