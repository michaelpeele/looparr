'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-awaiting-slot-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const FIXTURE_PATH = path.join(TEMP_DIR, 'fake-runner.js');
const PORT = '4219';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const AWAITING_TEXT = 'Awaiting worker slot…';
const PRESS_START_TEXT = 'Idle. Press Start to run the checklist.';

process.env.PORT = PORT;
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

const servers = [];

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function createFixture() {
  const runnersPath = require.resolve(path.join(REPO_ROOT, 'src/runners/index.js'));
  const source = `'use strict';\n`
    + `const { registerRunner } = require(${JSON.stringify(runnersPath)});\n`
    + `registerRunner({\n`
    + `  id: 'opencode',\n`
    + `  label: 'persistent runner',\n`
    + `  description: 'keeps test projects active without invoking a real agent',\n`
    + `  ensureServer: async () => null,\n`
    + `  buildCommand: () => ({ command: ${JSON.stringify(process.execPath)}, args: ['-e', 'setInterval(() => {}, 1000);'] }),\n`
    + `  isRateLimit: () => false\n`
    + `});\n`
    + `registerRunner({\n`
    + `  id: 'limitrunner',\n`
    + `  label: 'rate limited runner',\n`
    + `  description: 'exits immediately with a rate limit marker',\n`
    + `  ensureServer: async () => null,\n`
    + `  buildCommand: () => ({ command: ${JSON.stringify(process.execPath)}, args: ['-e', 'console.error(\\'PROVIDER RATE LIMIT reached\\'); process.exit(1);'] }),\n`
    + `  isRateLimit: (text) => /PROVIDER RATE LIMIT/.test(text || '')\n`
    + `});\n`;
  fs.writeFileSync(FIXTURE_PATH, source, 'utf8');
}

function serverEnv() {
  const env = { ...process.env };
  const preload = `--require=${FIXTURE_PATH}`;
  env.NODE_OPTIONS = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ${preload}` : preload;
  return env;
}

async function api(method, route, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${route}`, options);
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep plain text for served-asset checks.
  }
  return { status: response.status, body: payload };
}

async function waitForServer(child) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Server exited early: ${child.testOutput || ''}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}\n${child ? child.testOutput : ''}`);
}

async function spawnServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: serverEnv(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.testOutput = '';
  child.stdout.on('data', (chunk) => { child.testOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.testOutput += chunk.toString(); });
  servers.push(child);
  await waitForServer(child);
  return child;
}

async function killServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    delay(3000).then(() => false)
  ]);
  if (!exited) child.kill('SIGKILL');
}

async function getProject(id) {
  const response = await api('GET', '/api/state');
  assertEqual(response.status, 200, 'GET /api/state status');
  const project = response.body.projects.find((entry) => entry.id === id);
  assert.ok(project, `Project ${id} missing from state`);
  return project;
}

async function waitForProject(id, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const project = await getProject(id);
    if (predicate(project)) return project;
    await delay(50);
  }
  throw new Error(`Project ${id} did not reach ${label}`);
}

// taskFallback and statusInfo are client-side helpers inside app.js's IIFE;
// extract and evaluate them so the wording assertions run against the real code.
function loadClientHelpers() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'app.js'), 'utf8');
  const statusMatch = source.match(/const STATUS = \{[\s\S]*?\n  \};/);
  const fallbackMatch = source.match(/function taskFallback\(project\) \{[\s\S]*?\n  \}/);
  const statusInfoMatch = source.match(/function statusInfo\(project\) \{[\s\S]*?\n  \}/);
  assert.ok(statusMatch, 'STATUS map found in app.js');
  assert.ok(fallbackMatch, 'taskFallback found in app.js');
  assert.ok(statusInfoMatch, 'statusInfo found in app.js');
  const taskFallback = new Function('isPlanSetup', `${fallbackMatch[0]}\nreturn taskFallback;`)(() => false);
  const statusInfo = new Function('isPlanSetup', `${statusMatch[0]}\n${statusInfoMatch[0]}\nreturn statusInfo;`)(() => false);
  return { taskFallback, statusInfo };
}

async function createProject(name, runner) {
  const projectDir = path.join(PROJECTS_ROOT, name);
  fs.mkdirSync(path.join(projectDir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'plan.md'), '- [ ] Task one\n- [ ] Task two\n', 'utf8');
  const created = await api('POST', '/api/projects', {
    name,
    path: projectDir,
    runner: runner || 'opencode'
  });
  assertEqual(created.status, 201, `create ${name} project`);
  return created.body.project.id;
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 1, mode: 'serial' },
    projects: []
  }, null, 2));

  const { taskFallback, statusInfo } = loadClientHelpers();
  const server = await spawnServer();

  const holderId = await createProject('holder');
  const queuedId = await createProject('queued');
  const freshId = await createProject('fresh');
  const pausedId = await createProject('paused');

  // Holder takes the only worker slot and keeps it.
  const started = await api('POST', `/api/projects/${encodeURIComponent(holderId)}/start`);
  assertEqual(started.status, 200, 'start holder project');
  await waitForProject(holderId, (project) => project.active && project.awaitingSlot === false, 'holder holding slot');

  // Queued: started while the pool is full -> awaitingSlot, not Press Start.
  const queuedStart = await api('POST', `/api/projects/${encodeURIComponent(queuedId)}/start`);
  assertEqual(queuedStart.status, 200, 'start queued project');
  const queued = await waitForProject(
    queuedId,
    (project) => project.active && project.awaitingSlot === true,
    'awaiting worker slot'
  );
  assertEqual(queued.paused, false, 'queued not paused');
  assertEqual(taskFallback(queued), AWAITING_TEXT, 'queued task fallback wording');
  assertEqual(statusInfo(queued).label, 'Awaiting Slot', 'queued status badge label');

  // Fresh: never started -> awaitingSlot stays false and Press Start remains.
  const fresh = await getProject(freshId);
  assertEqual(fresh.active, false, 'fresh project inactive');
  assertEqual(fresh.awaitingSlot, false, 'fresh project not awaiting slot');
  assertEqual(taskFallback(fresh), PRESS_START_TEXT, 'fresh task fallback wording');

  // Paused: started while the pool is full, then paused -> paused wording wins.
  const pausedStart = await api('POST', `/api/projects/${encodeURIComponent(pausedId)}/start`);
  assertEqual(pausedStart.status, 200, 'start paused project');
  const pausedPause = await api('POST', `/api/projects/${encodeURIComponent(pausedId)}/pause`);
  assertEqual(pausedPause.status, 200, 'pause paused project');
  const paused = await waitForProject(pausedId, (project) => project.paused, 'paused state');
  assertEqual(paused.awaitingSlot, false, 'paused project not awaiting slot');
  assertEqual(taskFallback(paused), 'Paused. Press Start to continue.', 'paused task fallback wording');
  assertEqual(statusInfo(paused).label, 'Paused', 'paused status badge label');

  // Free the slot, then drive a project into rateLimited via the fixture runner.
  // Stop the queued project first: it is still active and eligible, so it would
  // otherwise steal the freed slot and the rate-limit child would never spawn.
  const queuedStop = await api('POST', `/api/projects/${encodeURIComponent(queuedId)}/stop`);
  assertEqual(queuedStop.status, 200, 'stop queued project');
  await waitForProject(queuedId, (project) => !project.active, 'queued stopped');
  const holderStop = await api('POST', `/api/projects/${encodeURIComponent(holderId)}/stop`);
  assertEqual(holderStop.status, 200, 'stop holder project');
  await waitForProject(holderId, (project) => !project.active, 'holder stopped');

  const limitId = await createProject('limited', 'limitrunner');
  const limitStart = await api('POST', `/api/projects/${encodeURIComponent(limitId)}/start`);
  assertEqual(limitStart.status, 200, 'start rate limited project');
  const limited = await waitForProject(
    limitId,
    (project) => project.status === 'rateLimited',
    'rateLimited state'
  );
  assertEqual(limited.awaitingSlot, false, 'rateLimited project not awaiting slot');
  assertEqual(
    taskFallback(limited),
    'Rate limit backoff active. Auto-retry pending; press Retry to start immediately.',
    'rateLimited task fallback wording'
  );
  assertEqual(statusInfo(limited).label, 'Rate Limited', 'rateLimited status badge label');

  await killServer(server);
  console.log('awaiting-slot tests passed');
}

function finish(code) {
  for (const child of servers) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    const output = servers.map((child) => child.testOutput).filter(Boolean).join('\n');
    console.error(error && error.stack ? error.stack : error);
    if (output) console.error(`Server output:\n${output}`);
    finish(1);
  });
