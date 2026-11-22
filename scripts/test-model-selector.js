'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-model-selector-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const FALLBACK_DIR = path.join(PROJECTS_ROOT, 'fallback');
const FALLBACK_PLAN = path.join(FALLBACK_DIR, 'plan.md');
const EXHAUSTED_DIR = path.join(PROJECTS_ROOT, 'exhausted');
const EXHAUSTED_PLAN = path.join(EXHAUSTED_DIR, 'plan.md');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4199';
const RATE_LIMIT_MODEL = 'opencode/rate-limited';
const FALLBACK_MODEL = 'opencode/fallback-ok';
const PLAN_TASK = 'fallback task';
const MODEL_SELECT_IDS = [
  'model',
  'seed-model',
  'analyze-model',
  'implement-model',
  'project-model',
  'project-seed-model',
  'project-analyze-model',
  'project-implement-model',
  'drawer-model-input',
  'drawer-seed-model',
  'drawer-analyze-model',
  'drawer-implement-model'
];

process.env.PORT = '4199';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.LOOPARR_EXECUTOR_TOKEN = 'test-token';

let server = null;
let executorServer = null;
const executorAttempts = [];

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertMatch(text, pattern, label) {
  assert.ok(pattern.test(text), `${label}: no match for ${pattern}`);
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
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
}

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue) return lastValue;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
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

function loadOpencode(executorUrl) {
  const modulePath = require.resolve(path.join(REPO_ROOT, 'src/runners/opencode.js'));
  delete require.cache[modulePath];
  if (executorUrl) process.env.LOOPARR_EXECUTOR_URL = executorUrl;
  else delete process.env.LOOPARR_EXECUTOR_URL;
  return require(modulePath);
}

function expectedRunKey(project, phase, taskText) {
  const material = [project.id, path.resolve(project.path), phase, taskText].join('\0');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
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

      executorAttempts.push({
        model: payload.model || '',
        phase: payload.phase || '',
        task: payload.task?.text || '',
        runKey: payload.runKey || '',
        cwd: payload.cwd || '',
        files: Array.isArray(payload.files) ? payload.files : []
      });

      const frames = [];
      if (payload.model === RATE_LIMIT_MODEL) {
        frames.push({ stream: 'out', text: 'HTTP 429 rate limit exceeded\n' });
        frames.push({ exit: 1 });
      } else {
        if (payload.phase === 'seed' || payload.phase === 'analyze') {
          const loopDir = path.join(payload.cwd, '.looparr');
          fs.mkdirSync(loopDir, { recursive: true });
          fs.writeFileSync(path.join(loopDir, 'next_prompt.txt'), 'Implement the fallback task and run checks.\n');
        }
        frames.push({ stream: 'out', text: 'fallback success\n' });
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

async function testRunnerForwarding() {
  const local = loadOpencode(null);
  const localCommand = local.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    model: 'opencode/big-pickle'
  });
  assertEqual(localCommand.command, 'opencode', 'local command');
  const modelFlags = localCommand.args.filter((arg) => arg === '--model');
  assertEqual(modelFlags.length, 1, 'local --model count');
  const localModel = localCommand.args[modelFlags.length ? localCommand.args.indexOf('--model') + 1 : -1];
  assertEqual(localModel, 'opencode/big-pickle', 'local model value');
  assert.ok(!String(localModel).includes(','), 'local --model carries a single id');

  const emptyCommand = local.buildCommand({ prompt: 'do work', cwd: DEMO_DIR, url: BASE_URL, model: '' });
  assert.ok(!emptyCommand.args.includes('--model'), 'empty model omits --model');

  const bridge = loadOpencode('http://127.0.0.1:4199');
  const bridgeCommand = bridge.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    files: ['one.txt'],
    model: 'opencode/tidepool-alpha-free',
    runKey: 'test-run-key'
  });
  const payload = JSON.parse(bridgeCommand.options.env.LOOPARR_TASK_PAYLOAD);
  assertEqual(payload.model, 'opencode/tidepool-alpha-free', 'bridge model value');
  assert.ok(!String(payload.model).includes(','), 'bridge payload carries a single id');
  assert.deepEqual(payload.files, ['one.txt'], 'bridge files');
  assertEqual(payload.runKey, 'test-run-key', 'bridge run key');

  const autoCommand = local.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    model: 'omniroute/auto/coding'
  });
  assert.ok(autoCommand.args.includes('--model'), 'auto/coding args include --model');
  assertEqual(autoCommand.args[autoCommand.args.indexOf('--model') + 1], 'omniroute/auto/coding', 'auto/coding model value reaches --model');

  assert.throws(() => local.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    model: 'opencode/one,opencode/two'
  }), /single model id/, 'local runner rejects comma model');
  assert.throws(() => bridge.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    model: 'opencode/one,opencode/two',
    runKey: 'test-run-key'
  }), /single model id/, 'bridge runner rejects comma model');
}

function testHostExecutorRejectsComma() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts/host-executor.js'), 'utf8');
  assertMatch(source, /model\.includes\(','\)/, 'host executor rejects comma payload model');
}

async function testServedModelOptions() {
  const htmlResponse = await fetch(`${BASE_URL}/index.html`);
  assertEqual(htmlResponse.status, 200, 'GET /index.html status');
  const html = await htmlResponse.text();
  for (const id of MODEL_SELECT_IDS) {
    const pattern = new RegExp(`<select[^>]*id="${id}"[^>]*>`);
    const match = html.match(pattern);
    assert.ok(match, `served index.html has #${id}`);
    assertMatch(match[0], /\bmultiple\b/, `#${id} is multiple`);
    assertMatch(match[0], /size="4"/, `#${id} uses size="4"`);
  }

  const response = await fetch(`${BASE_URL}/app.js`);
  assertEqual(response.status, 200, 'GET /app.js status');
  const text = await response.text();
  assert.ok(text.includes('omniroute/auto/coding'), 'served app.js includes omniroute/auto/coding');
  assert.ok(text.includes("'omniroute/auto'"), 'served app.js includes omniroute/auto entry');
  assert.ok(text.includes('selectedOptions'), 'served app.js reads selectedOptions');
  assert.ok(text.includes('function readModelSelect'), 'served app.js defines readModelSelect');
  assert.ok(text.includes('effectiveModelListsFor'), 'served app.js reads effectiveModelLists');
  const savePaths = [
    ['global default', 'model', 'dom.model'],
    ['global seed', 'seedModel', 'dom.seedModel'],
    ['global analyze', 'analyzeModel', 'dom.analyzeModel'],
    ['global implement', 'implementModel', 'dom.implementModel'],
    ['project setup default', 'model', 'dom.projectModel'],
    ['project setup seed', 'seedModel', 'dom.projectSeedModel'],
    ['project setup analyze', 'analyzeModel', 'dom.projectAnalyzeModel'],
    ['project setup implement', 'implementModel', 'dom.projectImplementModel'],
    ['drawer default', 'model', 'dom.drawerModelInput'],
    ['drawer seed', 'seedModel', 'dom.drawerSeedModel'],
    ['drawer analyze', 'analyzeModel', 'dom.drawerAnalyzeModel'],
    ['drawer implement', 'implementModel', 'dom.drawerImplementModel']
  ];
  for (const [label, field, target] of savePaths) {
    const pattern = new RegExp(`${field}:\\s*readModelSelect\\(${target.replace(/\./g, '\\.')}\\)`);
    assertMatch(text, pattern, `${label} save path uses readModelSelect`);
  }
}

async function testCommaModelRoundTrips(projectId) {
  const globalLists = {
    model: ' opencode/global-a , opencode/global-b , opencode/global-a ',
    seedModel: 'omniroute/auto,omniroute/auto/coding',
    analyzeModel: 'opencode/analyze-a,opencode/analyze-b',
    implementModel: 'opencode/implement-a,opencode/implement-b'
  };
  const expectedGlobal = {
    model: 'opencode/global-a,opencode/global-b',
    seedModel: 'omniroute/auto,omniroute/auto/coding',
    analyzeModel: 'opencode/analyze-a,opencode/analyze-b',
    implementModel: 'opencode/implement-a,opencode/implement-b'
  };
  const patched = await api('PATCH', '/api/settings', globalLists);
  assertEqual(patched.status, 200, 'global comma settings patch status');
  let state = await getState();
  for (const [field, expected] of Object.entries(expectedGlobal)) {
    assertEqual(state.settings[field], expected, `global ${field} comma round-trip`);
  }

  const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
  const reloadedGlobals = configStore.loadConfig();
  for (const [field, expected] of Object.entries(expectedGlobal)) {
    assertEqual(reloadedGlobals.settings[field], expected, `reloaded global ${field} comma round-trip`);
  }

  const projectLists = {
    model: ' opencode/project-a , opencode/project-b , opencode/project-a ',
    seedModel: 'omniroute/auto/coding,omniroute/auto',
    analyzeModel: 'opencode/project-analyze-a,opencode/project-analyze-b',
    implementModel: 'opencode/project-implement-a,opencode/project-implement-b'
  };
  const expectedProject = {
    model: 'opencode/project-a,opencode/project-b',
    seedModel: 'omniroute/auto/coding,omniroute/auto',
    analyzeModel: 'opencode/project-analyze-a,opencode/project-analyze-b',
    implementModel: 'opencode/project-implement-a,opencode/project-implement-b'
  };
  const projectPatch = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, projectLists);
  assertEqual(projectPatch.status, 200, 'project comma patch status');
  state = await getState();
  let project = findProject(state, projectId);
  for (const [field, expected] of Object.entries(expectedProject)) {
    assertEqual(project[field], expected, `project ${field} comma round-trip`);
  }
  if (project.effectiveModelLists) {
    assertEqual(project.effectiveModelLists.model, expectedProject.model, 'effective default model list');
    assertEqual(project.effectiveModelLists.seed, expectedProject.seedModel, 'effective seed model list');
    assertEqual(project.effectiveModelLists.analyze, expectedProject.analyzeModel, 'effective analyze model list');
    assertEqual(project.effectiveModelLists.implement, expectedProject.implementModel, 'effective implement model list');
  }

  const overlongWhole = `${'a'.repeat(90)},${'b'.repeat(90)},${'c'.repeat(30)}`;
  const invalidModels = [
    ['bad flag', 'opencode/ok,--bad'],
    ['embedded whitespace', 'opencode/ok,bad value'],
    ['trailing comma', 'opencode/ok,'],
    ['overlong single id', 'x'.repeat(201)],
    ['overlong whole field', overlongWhole]
  ];
  for (const [label, value] of invalidModels) {
    const badSettings = await api('PATCH', '/api/settings', { seedModel: value });
    assertEqual(badSettings.status, 400, `global invalid ${label} status`);
    const badProject = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, { implementModel: value });
    assertEqual(badProject.status, 400, `project invalid ${label} status`);
  }

  const clearGlobals = await api('PATCH', '/api/settings', {
    model: '',
    seedModel: '',
    analyzeModel: '',
    implementModel: ''
  });
  assertEqual(clearGlobals.status, 200, 'clear global model lists status');
  const clearProject = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
    model: '',
    seedModel: '',
    analyzeModel: '',
    implementModel: ''
  });
  assertEqual(clearProject.status, 200, 'clear project model lists status');
  state = await getState();
  project = findProject(state, projectId);
  for (const field of Object.keys(expectedGlobal)) {
    assertEqual(state.settings[field], '', `global ${field} cleared`);
    assertEqual(project[field], '', `project ${field} cleared`);
  }
}

async function testEngineFallback() {
  executorAttempts.length = 0;
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_PLAN, `# Fallback plan\n\n- [ ] ${PLAN_TASK}\n`);

  const created = await api('POST', '/api/projects', {
    name: 'fallback',
    path: FALLBACK_DIR,
    runner: 'opencode',
    model: `${RATE_LIMIT_MODEL},${FALLBACK_MODEL}`,
    seedModel: '',
    analyzeModel: '',
    implementModel: ''
  });
  assertEqual(created.status, 201, 'fallback project create status');
  const project = created.body.project;

  const started = await api('POST', `/api/projects/${encodeURIComponent(project.id)}/start`);
  assertEqual(started.status, 200, 'fallback project start status');
  await waitFor(async () => {
    const state = await getState();
    const current = findProject(state, project.id);
    return current.progress?.completed === 1 ? current : null;
  }, 'fallback plan completion', 90000);

  assertEqual(executorAttempts.length, 6, 'one buildCommand attempt per model per phase');
  const phases = ['seed', 'analyze', 'implement'];
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    const pair = executorAttempts.slice(index * 2, index * 2 + 2);
    assert.deepEqual(pair.map((attempt) => attempt.model), [RATE_LIMIT_MODEL, FALLBACK_MODEL], `${phase} model order`);
    assert.deepEqual(pair.map((attempt) => attempt.phase), [phase, phase], `${phase} stays in same phase`);
    assert.deepEqual(pair.map((attempt) => attempt.task), [PLAN_TASK, PLAN_TASK], `${phase} keeps same task`);
    const runKey = expectedRunKey(project, phase, PLAN_TASK);
    assert.deepEqual(pair.map((attempt) => attempt.runKey), [runKey, runKey], `${phase} keeps same runKey`);
  }

  const plan = fs.readFileSync(FALLBACK_PLAN, 'utf8');
  assertMatch(plan, /^- \[x\] fallback task$/m, 'fallback task marked complete');
  const state = await getState();
  const doneLines = findProject(state, project.id).logs.filter((entry) => entry.text === `✓ Done: ${PLAN_TASK}`);
  assertEqual(doneLines.length, 1, 'plan advance logged once');
  assert.ok(!fs.existsSync(path.join(FALLBACK_DIR, '.looparr', 'next_prompt.txt')), 'handoff cleared after implement');
}

async function testExhaustedFallback() {
  executorAttempts.length = 0;
  fs.mkdirSync(EXHAUSTED_DIR, { recursive: true });
  fs.writeFileSync(EXHAUSTED_PLAN, `# Exhausted plan\n\n- [ ] ${PLAN_TASK}\n`);

  const created = await api('POST', '/api/projects', {
    name: 'exhausted',
    path: EXHAUSTED_DIR,
    runner: 'opencode',
    model: RATE_LIMIT_MODEL,
    seedModel: '',
    analyzeModel: '',
    implementModel: ''
  });
  assertEqual(created.status, 201, 'exhausted project create status');
  const project = created.body.project;

  const started = await api('POST', `/api/projects/${encodeURIComponent(project.id)}/start`);
  assertEqual(started.status, 200, 'exhausted project start status');
  await waitFor(async () => {
    const state = await getState();
    const current = findProject(state, project.id);
    return current.status === 'rateLimited' && current.resumeAt ? current : null;
  }, 'exhausted rate-limited state', 30000);

  assertEqual(executorAttempts.length, 1, 'exhausted list tried only available model');
  assertEqual(executorAttempts[0].model, RATE_LIMIT_MODEL, 'exhausted attempt model');
  const plan = fs.readFileSync(EXHAUSTED_PLAN, 'utf8');
  assertMatch(plan, /^- \[ \] fallback task$/m, 'exhausted task stays unchecked');
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12 },
    projects: []
  }, null, 2));
  await startFakeExecutor();

  server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitForServer();

    let state = await getState();
    assertEqual(state.settings.maxConcurrent, 4, 'preserved maxConcurrent');
    assertEqual(state.settings.mode, 'serial', 'preserved mode');
    assertEqual(state.settings.rateLimitPauseSeconds, 12, 'preserved rateLimitPauseSeconds');
    assertEqual(state.settings.seedModel, 'opencode/big-pickle', 'fresh seed model default');
    assertEqual(state.settings.analyzeModel, 'opencode/big-pickle', 'fresh analyze model default');
    assertEqual(state.settings.implementModel, 'opencode/big-pickle', 'fresh implement model default');

    const settingsPatch = await api('PATCH', '/api/settings', {
      model: 'opencode/global-plain',
      seedModel: 'opencode/global-seed',
      analyzeModel: 'opencode/global-analyze',
      implementModel: 'opencode/global-implement'
    });
    assertEqual(settingsPatch.status, 200, 'settings patch status');
    state = await getState();
    assertEqual(state.settings.model, 'opencode/global-plain', 'settings plain model');
    assertEqual(state.settings.seedModel, 'opencode/global-seed', 'settings seed model');
    assertEqual(state.settings.analyzeModel, 'opencode/global-analyze', 'settings analyze model');
    assertEqual(state.settings.implementModel, 'opencode/global-implement', 'settings implement model');

    const created = await api('POST', '/api/projects', {
      name: 'demo',
      path: DEMO_DIR,
      runner: 'opencode',
      model: 'opencode/project-plain',
      seedModel: 'opencode/project-seed',
      analyzeModel: '',
      implementModel: 'opencode/project-implement'
    });
    assertEqual(created.status, 201, 'project create status');
    const projectId = created.body.project.id;
    assertEqual(created.body.project.seedModel, 'opencode/project-seed', 'created seed model');
    assertEqual(created.body.project.analyzeModel, '', 'created analyze model blank');

    state = await getState();
    let project = findProject(state, projectId);
    assertEqual(project.effectiveModels.seed, 'opencode/project-seed', 'project phase wins over global phase');
    assertEqual(project.effectiveModels.analyze, 'opencode/project-plain', 'project plain wins over global phase when phase blank');
    assertEqual(project.effectiveModels.implement, 'opencode/project-implement', 'project implement phase');

    const clearedProject = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
      model: '',
      implementModel: ''
    });
    assertEqual(clearedProject.status, 200, 'project patch status');
    state = await getState();
    project = findProject(state, projectId);
    assertEqual(project.model, '', 'project plain model cleared');
    assertEqual(project.effectiveModels.seed, 'opencode/project-seed', 'seed still from project phase');
    assertEqual(project.effectiveModels.analyze, 'opencode/global-analyze', 'global phase used when project values blank');
    assertEqual(project.effectiveModels.implement, 'opencode/global-implement', 'global phase overrides global plain');

    const clearSeed = await api('PATCH', '/api/settings', { seedModel: '' });
    assertEqual(clearSeed.status, 200, 'clear seed settings status');
    const clearProjectSeed = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, { seedModel: '' });
    assertEqual(clearProjectSeed.status, 200, 'clear project seed status');
    state = await getState();
    project = findProject(state, projectId);
    assertEqual(state.settings.seedModel, '', 'global seed model cleared');
    assertEqual(project.effectiveModels.seed, 'opencode/global-plain', 'global plain used when phase values blank');

    const clearPlain = await api('PATCH', '/api/settings', { model: '' });
    assertEqual(clearPlain.status, 200, 'clear plain settings status');
    state = await getState();
    project = findProject(state, projectId);
    assertEqual(project.effectiveModels.seed, '', 'empty model resolves to OpenCode default');

    const badSettings = await api('PATCH', '/api/settings', { seedModel: '--bad' });
    assertEqual(badSettings.status, 400, 'invalid settings model status');
    const badProject = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, { implementModel: 'bad value' });
    assertEqual(badProject.status, 400, 'invalid project model status');
    const badCreate = await api('POST', '/api/projects', {
      name: 'bad',
      path: DEMO_DIR,
      runner: 'opencode',
      analyzeModel: '--nope'
    });
    assertEqual(badCreate.status, 400, 'invalid project create model status');

    // omniroute models (auto and auto/coding) round-trip unchanged.
    const autoCodingSettings = await api('PATCH', '/api/settings', { model: 'omniroute/auto/coding' });
    assertEqual(autoCodingSettings.status, 200, 'omniroute/auto/coding settings patch status');
    state = await getState();
    assertEqual(state.settings.model, 'omniroute/auto/coding', 'settings model round-trips omniroute/auto/coding');
    const autoProject = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, { model: 'omniroute/auto' });
    assertEqual(autoProject.status, 200, 'omniroute/auto project patch status');
    state = await getState();
    project = findProject(state, projectId);
    assertEqual(project.model, 'omniroute/auto', 'project model round-trips omniroute/auto');

    await testCommaModelRoundTrips(projectId);
    await testEngineFallback();
    await testExhaustedFallback();

    const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
    const reloaded = configStore.loadConfig();
    assertEqual(reloaded.settings.seedModel, '', 'blank global phase survives reload');
    assertEqual(reloaded.settings.maxConcurrent, 4, 'settings survive reload');

    await testServedModelOptions();
    await testRunnerForwarding();
    testHostExecutorRejectsComma();
    console.log('model-selector smoke tests passed');
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${serverOutput}`);
  }
}

function finish(code) {
  if (server && !server.killed) server.kill('SIGTERM');
  if (executorServer) {
    executorServer.close();
    executorServer = null;
  }
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    finish(1);
  });
