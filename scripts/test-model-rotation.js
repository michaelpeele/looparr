'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-model-rotation-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4201';

const FIXED_MODEL = 'opencode/rotation-fixed';
const ROT_A = 'opencode/rotation-a';
const ROT_B = 'opencode/rotation-b';
const ROT_C = 'opencode/rotation-c';
const AN_A = 'opencode/rotation-analyze-a';
const AN_B = 'opencode/rotation-analyze-b';
const RL_MODEL = 'opencode/rotation-limited';
const RL_OK = 'opencode/rotation-ok';
const RL_THIRD = 'opencode/rotation-third';
const ERR_MODEL = 'opencode/error-model';
const ERR_OK = 'opencode/error-ok';
const PRE_MODEL = 'opencode/predispatch-model';
const PRE_OK = 'opencode/predispatch-ok';
const PRE_THIRD = 'opencode/predispatch-third';
const AUTH_MODEL = 'opencode/auth-model';

process.env.PORT = '4201';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.LOOPARR_EXECUTOR_TOKEN = 'test-token';

let server = null;
let executorServer = null;
let serverOutput = '';
const attempts = [];

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
    // Keep non-JSON responses as text for diagnostics.
  }
  return { status: response.status, body: payload };
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}; output: ${serverOutput}`);
}

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}; server output: ${serverOutput}`);
}

async function getState() {
  const response = await api('GET', '/api/state');
  assertEqual(response.status, 200, 'GET /api/state status');
  return response.body;
}

function findProject(state, id) {
  const project = state.projects.find((entry) => entry.id === id);
  assert.ok(project, `Project ${id} missing from state`);
  return project;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function startFakeExecutor() {
  executorServer = http.createServer(async (req, res) => {
    try {
      const payload = await readJsonBody(req);
      if (req.method === 'POST' && req.url === '/cancel') {
        return sendJson(res, 200, { ok: true, cancelled: [] });
      }
      if (req.method !== 'POST' || req.url !== '/run') {
        return sendJson(res, 404, { error: 'not found' });
      }

      attempts.push({
        model: payload.model || '',
        phase: payload.phase || '',
        task: payload.task?.text || '',
        at: Date.now()
      });

      const frames = [];
      if (payload.model === ERR_MODEL) {
        frames.push({ stream: 'err', text: 'Error: provider returned [400]: unsupported property reasoning_details\n' });
        frames.push({ exit: 1 });
      } else if (payload.model === PRE_MODEL) {
        frames.push({ stream: 'err', text: 'SessionError: Service temporarily unavailable: all targets were skipped by pre-dispatch filters\n' });
        frames.push({ exit: 1 });
      } else if (payload.model === AUTH_MODEL) {
        frames.push({ stream: 'err', text: 'Error: 401 invalid api key\n' });
        frames.push({ exit: 1 });
      } else if (payload.model === RL_MODEL) {
        frames.push({ stream: 'out', text: 'HTTP 429 rate limit exceeded\n' });
        frames.push({ exit: 1 });
      } else {
        if (payload.phase === 'seed' || payload.phase === 'analyze') {
          const loopDir = path.join(payload.cwd, '.looparr');
          fs.mkdirSync(loopDir, { recursive: true });
          fs.writeFileSync(path.join(loopDir, 'next_prompt.txt'), 'Implement the rotation task and run checks.\n');
        }
        frames.push({ stream: 'out', text: 'rotation success\n' });
        frames.push({ exit: 0 });
      }

      const body = frames.map((frame) => `${JSON.stringify(frame)}\n`).join('');
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'content-length': Buffer.byteLength(body) });
      return res.end(body);
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    executorServer.once('error', reject);
    executorServer.listen(0, '127.0.0.1', resolve);
  });
  process.env.LOOPARR_EXECUTOR_URL = `http://127.0.0.1:${executorServer.address().port}`;
}

function writePlan(dir, tasks) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = tasks.map((task) => `- [ ] ${task}`).join('\n');
  fs.writeFileSync(path.join(dir, 'plan.md'), `# Rotation plan\n\n${lines}\n`);
}

async function createProject(name, tasks, overrides = {}) {
  const dir = path.join(PROJECTS_ROOT, name);
  writePlan(dir, tasks);
  const created = await api('POST', '/api/projects', {
    name,
    path: dir,
    runner: 'opencode',
    model: FIXED_MODEL,
    seedModel: FIXED_MODEL,
    analyzeModel: FIXED_MODEL,
    implementModel: FIXED_MODEL,
    ...overrides
  });
  assertEqual(created.status, 201, `create project ${name}`);
  return created.body.project;
}

async function runProject(project, totalTasks) {
  attempts.length = 0;
  const started = await api('POST', `/api/projects/${encodeURIComponent(project.id)}/start`);
  assertEqual(started.status, 200, `start ${project.name}`);
  await waitFor(async () => {
    const state = await getState();
    const current = findProject(state, project.id);
    return current.progress?.completed === totalTasks ? current : null;
  }, `completion of ${project.name}`, 90000);
  return attempts.slice();
}

function modelsFor(run, phase) {
  return run.filter((attempt) => attempt.phase === phase).map((attempt) => attempt.model);
}

function readCooldowns() {
  const statePath = path.join(TEMP_DIR, 'rotation-state.json');
  if (!fs.existsSync(statePath)) return {};
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return saved && typeof saved.cooldowns === 'object' && saved.cooldowns ? saved.cooldowns : {};
}

async function testApiContract() {
  const badGlobal = await api('PATCH', '/api/settings', { modelRotation: 'yes' });
  assertEqual(badGlobal.status, 400, 'settings rejects non-boolean rotation');

  const badCreate = await api('POST', '/api/projects', {
    name: 'bad-rotation',
    path: PROJECTS_ROOT,
    runner: 'opencode',
    seedRotation: 'on'
  });
  assertEqual(badCreate.status, 400, 'project create rejects non-boolean rotation');

  await api('PATCH', '/api/settings', { modelRotation: true, implementRotation: true });
  const inherit = await createProject('rotation-inherit', ['inherit task']);
  let state = await getState();
  let project = findProject(state, inherit.id);
  assertEqual(project.modelRotation, null, 'unset project rotation inherits');
  assertEqual(project.effectiveRotations.model, true, 'global model rotation inherited');
  assertEqual(project.effectiveRotations.implement, true, 'global implement rotation inherited');

  const pinned = await api('PATCH', `/api/projects/${encodeURIComponent(inherit.id)}`, { modelRotation: false });
  assertEqual(pinned.status, 200, 'project rotation override accepted');
  state = await getState();
  project = findProject(state, inherit.id);
  assertEqual(project.effectiveRotations.model, false, 'project override wins over global');

  const cleared = await api('PATCH', `/api/projects/${encodeURIComponent(inherit.id)}`, { modelRotation: null });
  assertEqual(cleared.status, 200, 'null clears the project override');
  state = await getState();
  project = findProject(state, inherit.id);
  assertEqual(project.effectiveRotations.model, true, 'null inherits the global again');

  await api('PATCH', '/api/settings', { modelRotation: false, implementRotation: false });
}

async function testRotationOff() {
  const project = await createProject('rotation-off', ['off one', 'off two', 'off three'], {
    implementModel: `${ROT_A},${ROT_B},${ROT_C}`,
    implementRotation: false
  });
  const run = await runProject(project, 3);
  assert.deepEqual(modelsFor(run, 'implement'), [ROT_A, ROT_A, ROT_A], 'rotation off keeps the first model every step');
}

async function testRotationOn() {
  const project = await createProject('rotation-on', ['on one', 'on two', 'on three'], {
    implementModel: `${ROT_A},${ROT_B},${ROT_C}`,
    implementRotation: true
  });
  const run = await runProject(project, 3);
  assert.deepEqual(modelsFor(run, 'implement'), [ROT_A, ROT_B, ROT_C], 'rotation cycles implement models across tasks');

  const state = await getState();
  const logs = findProject(state, project.id).logs.map((entry) => entry.text);
  assert.ok(
    logs.includes(`Model: ${ROT_B} (rotation 2/3)`),
    `rotation position is logged; got: ${logs.filter((line) => line.startsWith('Model:')).join(' | ')}`
  );
}

async function testRotationPerField() {
  const project = await createProject('rotation-field', ['field one', 'field two'], {
    analyzeModel: `${AN_A},${AN_B}`,
    analyzeRotation: true,
    implementRotation: false
  });
  const run = await runProject(project, 2);
  assert.deepEqual(modelsFor(run, 'analyze'), [AN_A, AN_B], 'analyze rotation advances its own cursor');
  assert.deepEqual(modelsFor(run, 'implement'), [FIXED_MODEL, FIXED_MODEL], 'implement dropdown stays fixed');
}

async function testRotationAfterRateLimit() {
  const project = await createProject('rotation-limited', ['limit one', 'limit two'], {
    implementModel: `${RL_MODEL},${RL_OK},${RL_THIRD}`,
    implementRotation: true
  });
  const run = await runProject(project, 2);
  assert.deepEqual(
    modelsFor(run, 'implement'),
    [RL_MODEL, RL_OK, RL_THIRD],
    'rate-limit fallback advances inside the step, then rotation resumes past the served model'
  );
  const logText = findProject(await getState(), project.id).logs.map((entry) => entry.text);
  assert.ok(
    logText.some((text) => text === `Model failure on ${RL_MODEL}; retrying with ${RL_OK}. Backing off once before failover.`),
    'first 429 backs off once before failing over to the next model'
  );
  assert.ok(
    logText.some((text) => text.startsWith('Provider backoff engaged. Retrying in')),
    'backoff timer logs provider pause before the next attempt'
  );
  const limitedAt = run.find((attempt) => attempt.phase === 'implement' && attempt.model === RL_MODEL)?.at;
  const okAt = run.find((attempt) => attempt.phase === 'implement' && attempt.model === RL_OK)?.at;
  assert.ok(typeof limitedAt === 'number' && typeof okAt === 'number', 'fallback attempts carry timestamps');
  assert.ok(okAt - limitedAt >= 4000, 'next model starts after the configured backoff pause');
}

async function testProviderErrorFallback() {
  const project = await createProject('provider-error', ['error task'], {
    implementModel: `${ERR_MODEL},${ERR_OK}`,
    implementRotation: true
  });
  const run = await runProject(project, 1);
  assert.deepEqual(
    modelsFor(run, 'implement'),
    [ERR_MODEL, ERR_OK],
    'a provider 400 advances to the next model instead of stopping'
  );
  const logs = findProject(await getState(), project.id).logs.map((entry) => entry.text);
  assert.ok(
    logs.some((line) => line.startsWith('Model failure on')),
    `the model switch is logged; got: ${logs.filter((line) => line.startsWith('Model failure')).join(' | ') || 'no line'}`
  );
}

async function testPreDispatchFallback() {
  const project = await createProject('predispatch-fallback', ['predispatch task'], {
    implementModel: `${PRE_MODEL},${PRE_OK},${PRE_THIRD}`,
    implementRotation: true
  });
  const run = await runProject(project, 1);
  assert.deepEqual(
    modelsFor(run, 'implement'),
    [PRE_MODEL, PRE_OK],
    'pre-dispatch failure advances one model, then succeeds'
  );
  const state = await getState();
  const logs = findProject(state, project.id).logs.map((entry) => entry.text);
  assert.ok(
    logs.includes(`Model failure on ${PRE_MODEL}; retrying with ${PRE_OK}.`),
    `the model switch is logged; got: ${logs.filter((line) => line.startsWith('Model failure')).join(' | ') || 'no line'}`
  );
  assert.ok(
    !logs.some((line) => /cooling|Cooloff|All candidates rate limited/i.test(line)),
    `pre-dispatch failure does not use rate-limit semantics; got: ${logs.join(' | ')}`
  );
  assertEqual(
    readCooldowns()[PRE_MODEL],
    undefined,
    'pre-dispatch failure records no cooldown'
  );
}

async function testTerminalAuthError() {
  const project = await createProject('auth-error', ['auth task'], {
    implementModel: AUTH_MODEL,
    implementRotation: false
  });
  attempts.length = 0;
  const started = await api('POST', `/api/projects/${encodeURIComponent(project.id)}/start`);
  assertEqual(started.status, 200, 'start auth project');
  await waitFor(async () => {
    const state = await getState();
    return findProject(state, project.id).status === 'error' ? true : null;
  }, 'auth error stop', 20000);
  assert.deepEqual(
    modelsFor(attempts, 'implement'),
    [AUTH_MODEL],
    'auth failures are terminal and do not switch models'
  );
}

async function testRunnerListValidation() {
  const badRotation = await api('PATCH', '/api/settings', { runnerRotation: 'yes' });
  assertEqual(badRotation.status, 400, 'settings rejects non-boolean runner rotation');

  const badRunner = await api('POST', '/api/projects', {
    name: 'bad-runner',
    path: PROJECTS_ROOT,
    runner: 'opencode,nope'
  });
  assertEqual(badRunner.status, 400, 'runner lists reject unknown ids');
  assert.ok(String(badRunner.body?.error || '').includes('nope'), 'the rejected id is named');

  const accepted = await api('PATCH', '/api/settings', { globalRunner: 'opencode,kilo', runnerRotation: true });
  assertEqual(accepted.status, 200, 'a runner list is accepted');
  const state = await getState();
  assertEqual(state.settings.globalRunner, 'opencode,kilo', 'the runner list is stored joined');
  assertEqual(state.settings.runnerRotation, true, 'runner rotation is stored');
  await api('PATCH', '/api/settings', { globalRunner: 'opencode', runnerRotation: false });
}

async function testServedMarkup() {
  const htmlResponse = await fetch(`${BASE_URL}/index.html`);
  assertEqual(htmlResponse.status, 200, 'GET /index.html status');
  const html = await htmlResponse.text();
  const targets = [...html.matchAll(/data-rotate-for="([^"]+)"/g)].map((match) => match[1]);
  assertEqual(targets.length, 18, 'one rotation toggle per model and runner dropdown');
  for (const target of targets) {
    assert.ok(html.includes(`id="${target}"`), `rotation toggle ${target} maps to a real select`);
  }
  assert.ok(html.includes('id="icon-model-rotation"'), 'two-arrow rotation icon is served');
  assertEqual((html.match(/title="Model Rotation"/g) || []).length, 15, 'every model toggle carries the Model Rotation tooltip');
  assertEqual((html.match(/title="Runner Rotation"/g) || []).length, 3, 'every runner toggle carries the Runner Rotation tooltip');
  assertEqual((html.match(/aria-pressed="false"/g) || []).length >= 18, true, 'every toggle exposes aria-pressed');

  const appResponse = await fetch(`${BASE_URL}/app.js`);
  assertEqual(appResponse.status, 200, 'GET /app.js status');
  const app = await appResponse.text();
  assert.ok(app.includes('function applyRotationButtons'), 'app.js applies rotation button state');
  assert.ok(app.includes('function readRotationButtons'), 'app.js reads rotation button state');
  assert.ok(app.includes('readRotationButtons(GLOBAL_ROTATION_TARGETS)'), 'global save persists rotation flags');
  assert.ok(app.includes('readRotationButtons(DRAWER_ROTATION_TARGETS)'), 'drawer save persists rotation flags');

  const cssResponse = await fetch(`${BASE_URL}/styles.css`);
  assertEqual(cssResponse.status, 200, 'GET /styles.css status');
  const css = await cssResponse.text();
  assert.ok(css.includes('.model-rotate-button[aria-pressed="true"]'), 'enabled rotation state is styled');
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: {
      maxConcurrent: 1,
      mode: 'parallel',
      rateLimitPauseSeconds: 5,
      cooloffSeconds: 0,
      model: FIXED_MODEL
    },
    projects: []
  }, null, 2));

  await startFakeExecutor();
  server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitForServer();

    const state = await getState();
    assertEqual(state.settings.modelRotation, false, 'rotation defaults off');
    assertEqual(state.settings.seedRotation, false, 'seed rotation defaults off');
    assertEqual(state.settings.analyzeRotation, false, 'analyze rotation defaults off');
    assertEqual(state.settings.implementRotation, false, 'implement rotation defaults off');

    await testApiContract();
    await testRotationOff();
    await testRotationOn();
    await testRotationPerField();
    await testRotationAfterRateLimit();
    await testProviderErrorFallback();
    await testPreDispatchFallback();
    await testTerminalAuthError();
    await testRunnerListValidation();
    await testServedMarkup();

    console.log('model rotation smoke tests passed');
  } finally {
    if (server) server.kill('SIGTERM');
    if (executorServer) {
      await new Promise((resolve) => executorServer.close(resolve));
    }
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
