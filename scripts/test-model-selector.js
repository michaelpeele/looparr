'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-model-selector-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4199';

process.env.PORT = '4199';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

let server = null;

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
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
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

async function testRunnerForwarding() {
  const local = loadOpencode(null);
  const localCommand = local.buildCommand({
    prompt: 'do work',
    cwd: DEMO_DIR,
    url: BASE_URL,
    model: 'opencode/big-pickle'
  });
  assertEqual(localCommand.command, 'opencode', 'local command');
  assert.ok(localCommand.args.includes('--model'), 'local args include --model');
  assertEqual(localCommand.args[localCommand.args.indexOf('--model') + 1], 'opencode/big-pickle', 'local model value');

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
}

async function testServedModelOptions() {
  const response = await fetch(`${BASE_URL}/app.js`);
  assertEqual(response.status, 200, 'GET /app.js status');
  const text = await response.text();
  assert.ok(text.includes('omniroute/auto/coding'), 'served app.js includes omniroute/auto/coding');
  assert.ok(text.includes("'omniroute/auto'"), 'served app.js includes omniroute/auto entry');
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12 },
    projects: []
  }, null, 2));

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

    const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
    const reloaded = configStore.loadConfig();
    assertEqual(reloaded.settings.seedModel, '', 'blank global phase survives reload');
    assertEqual(reloaded.settings.maxConcurrent, 4, 'settings survive reload');

    await testServedModelOptions();
    await testRunnerForwarding();
    console.log('model-selector smoke tests passed');
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${serverOutput}`);
  }
}

function finish(code) {
  if (server && !server.killed) server.kill('SIGTERM');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    finish(1);
  });
