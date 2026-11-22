'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-up-next-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const FIXTURE_PATH = path.join(TEMP_DIR, 'fake-runner.js');
const PORT = '4202';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TASKS = ['Task zero', 'Task one', 'Task two', 'Task three'];

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
    + `  label: 'test runner',\n`
    + `  description: 'keeps test projects active without invoking a real agent',\n`
    + `  ensureServer: async () => null,\n`
    + `  buildCommand: () => ({ command: ${JSON.stringify(process.execPath)}, args: ['-e', 'setInterval(() => {}, 1000);'] }),\n`
    + `  isRateLimit: () => false\n`
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const project = await getProject(id);
    if (predicate(project)) return project;
    await delay(50);
  }
  throw new Error(`Project ${id} did not reach ${label}`);
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 2, mode: 'serial' },
    projects: []
  }, null, 2));

  const server = await spawnServer();
  const projectDir = path.join(PROJECTS_ROOT, 'up-next');
  fs.mkdirSync(path.join(projectDir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'plan.md'), `${TASKS.map((task) => `- [ ] ${task}`).join('\n')}\n`, 'utf8');
  const created = await api('POST', '/api/projects', {
    name: 'up-next',
    path: projectDir,
    runner: 'opencode'
  });
  assertEqual(created.status, 201, 'create up-next project');
  const id = created.body.project.id;

  const idle = await getProject(id);
  assertEqual(idle.active, false, 'idle project inactive');
  assertEqual(idle.currentTask, '', 'idle currentTask empty');
  assertEqual(idle.nextTask, TASKS[0], 'idle nextTask is first unchecked');

  const started = await api('POST', `/api/projects/${encodeURIComponent(id)}/start`);
  assertEqual(started.status, 200, 'start up-next project');
  const active = await waitForProject(
    id,
    (project) => project.active && project.currentTask === TASKS[0],
    'active task zero'
  );
  assertEqual(active.currentTask, TASKS[0], 'engine still runs first unchecked task');
  assertEqual(active.nextTask, TASKS[1], 'active nextTask is lookahead');

  const stopped = await api('POST', `/api/projects/${encodeURIComponent(id)}/stop`);
  assertEqual(stopped.status, 200, 'stop up-next project');
  const settled = await waitForProject(id, (project) => !project.active, 'idle after stop');
  assertEqual(settled.currentTask, '', 'idle currentTask empty after stop');
  assertEqual(settled.nextTask, TASKS[0], 'idle fallback after stop');

  await killServer(server);
  console.log('up-next smoke tests passed');
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
