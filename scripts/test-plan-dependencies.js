'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-plan-dependencies-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const FIXTURE_PATH = path.join(TEMP_DIR, 'fake-runner.js');
const PORT = '4203';
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    // Keep plain text for non-JSON responses.
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

async function createProject(name, plan) {
  const projectDir = path.join(PROJECTS_ROOT, name);
  fs.mkdirSync(path.join(projectDir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'plan.md'), `${plan}\n`, 'utf8');
  const created = await api('POST', '/api/projects', {
    name,
    path: projectDir,
    runner: 'opencode'
  });
  assertEqual(created.status, 201, `create ${name} project`);
  return created.body.project.id;
}

async function startAndWaitForError(id, expected, label) {
  const started = await api('POST', `/api/projects/${encodeURIComponent(id)}/start`);
  assertEqual(started.status, 200, `${label} start request`);
  return waitForProject(
    id,
    (project) => project.status === 'error' && project.error === expected && project.active === false,
    `${label} clean start error`
  );
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 2, mode: 'serial' },
    projects: []
  }, null, 2));

  await spawnServer();

  const satisfiedId = await createProject('satisfied', [
    '- [x] Build',
    '- [ ] Deploy (depends: 1)'
  ].join('\n'));
  const satisfied = await getProject(satisfiedId);
  assertEqual(satisfied.nextTask, 'Deploy', 'satisfied nextTask strips dependency suffix');
  assertEqual(satisfied.nextTaskIndex, 1, 'state exposes nextTaskIndex');
  assertEqual(satisfied.dependencyStatus.ok, true, 'satisfied dependency status ok');
  assertEqual(satisfied.dependencyStatus.next.dependencies[0], 1, 'state exposes 1-based dependency');
  assertEqual(satisfied.dependencyError, '', 'satisfied dependency error empty');
  assertEqual(satisfied.dependencyWarning, '', 'satisfied dependency warning empty');

  const satisfiedStart = await api('POST', `/api/projects/${encodeURIComponent(satisfiedId)}/start`);
  assertEqual(satisfiedStart.status, 200, 'start satisfied project');
  const satisfiedActive = await waitForProject(
    satisfiedId,
    (project) => project.active && project.currentTask === 'Deploy',
    'satisfied project active'
  );
  assertEqual(satisfiedActive.currentTask, 'Deploy', 'satisfied dependency runs clean task');
  await api('POST', `/api/projects/${encodeURIComponent(satisfiedId)}/stop`);

  const oldId = await createProject('old-plan', '- [ ] Build\n- [ ] Test');
  const old = await getProject(oldId);
  assertEqual(old.dependencyError, '', 'old plan dependency error empty');
  assertEqual(old.dependencyWarning, '', 'old plan dependency warning empty');
  const oldStart = await api('POST', `/api/projects/${encodeURIComponent(oldId)}/start`);
  assertEqual(oldStart.status, 200, 'start old plan');
  await waitForProject(oldId, (project) => project.active && project.currentTask === 'Build', 'old plan active');
  await api('POST', `/api/projects/${encodeURIComponent(oldId)}/stop`);

  const pendingId = await createProject('pending', '- [ ] Deploy (depends: 2)\n- [ ] Build');
  const pending = await getProject(pendingId);
  assertEqual(pending.nextTask, 'Deploy', 'pending nextTask strips dependency suffix');
  assertEqual(pending.dependencyWarning, 'waiting on dependency #2', 'pending dependency warning');
  await startAndWaitForError(
    pendingId,
    'Cannot start task 1: waiting on dependency #2',
    'pending dependency'
  );

  const missingId = await createProject('missing', '- [ ] alpha\n- [ ] beta (depends: 9)');
  const missing = await getProject(missingId);
  assert.match(missing.dependencyError, /depends on missing task #9/, 'missing dependency error in state');
  await startAndWaitForError(
    missingId,
    'Cannot start plan: Checklist item 2 depends on missing task #9',
    'missing dependency'
  );

  const cycleId = await createProject('cycle', '- [ ] a (depends: 2)\n- [ ] b (depends: 1)');
  const cycle = await getProject(cycleId);
  assert.match(cycle.dependencyError, /dependency cycle detected: 1 -> 2 -> 1/, 'cycle error in state');
  await startAndWaitForError(
    cycleId,
    'Cannot start plan: dependency cycle detected: 1 -> 2 -> 1',
    'dependency cycle'
  );

  const afterErrors = await api('GET', '/api/state');
  assertEqual(afterErrors.status, 200, 'server healthy after dependency errors');

  await killServer(servers[0]);
  console.log('plan dependencies smoke tests passed');
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
