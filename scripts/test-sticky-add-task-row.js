'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-sticky-add-task-row-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4202';

process.env.PORT = '4202';
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

function loadEngineFresh() {
  const enginePath = require.resolve(path.join(REPO_ROOT, 'src/engine.js'));
  delete require.cache[enginePath];
  return require(enginePath);
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  // Fresh config without stickyAddTaskRow: the default must be false.
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial' },
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
    assertEqual(state.settings.stickyAddTaskRow, false, 'fresh config defaults stickyAddTaskRow to false');

    const enabled = await api('PATCH', '/api/settings', { stickyAddTaskRow: true });
    assertEqual(enabled.status, 200, 'enable sticky patch status');
    assertEqual(enabled.body.settings.stickyAddTaskRow, true, 'enable sticky patch reflects true');

    state = await getState();
    assertEqual(state.settings.stickyAddTaskRow, true, 'GET /api/state reflects persisted sticky true');

    const rejected = await api('PATCH', '/api/settings', { stickyAddTaskRow: 'yes' });
    assertEqual(rejected.status, 400, 'non-boolean sticky patch status');
    assert.ok(
      typeof rejected.body.error === 'string' && rejected.body.error.includes('stickyAddTaskRow must be a boolean'),
      `400 error mentions stickyAddTaskRow must be a boolean, got ${JSON.stringify(rejected.body)}`
    );

    const disabled = await api('PATCH', '/api/settings', { stickyAddTaskRow: false });
    assertEqual(disabled.status, 200, 'disable sticky patch status');
    assertEqual(disabled.body.settings.stickyAddTaskRow, false, 'disable sticky patch reflects false');

    state = await getState();
    assertEqual(state.settings.stickyAddTaskRow, false, 'GET /api/state reflects persisted sticky false');

    const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
    const reloaded = configStore.loadConfig();
    assertEqual(reloaded.settings.stickyAddTaskRow, false, 'disabled sticky value survives reload');

    const promptEnabled = await api('PATCH', '/api/settings', { promptCliToolsNote: true });
    assertEqual(promptEnabled.status, 200, 'enable prompt note patch status');
    state = await getState();
    assertEqual(state.settings.promptCliToolsNote, true, 'GET /api/state reflects prompt note true');
    let engine = loadEngineFresh();
    assert.ok(engine.promptPreamble().length > 0, 'prompt note remains enabled in generated prompts');

    const promptDisabled = await api('PATCH', '/api/settings', { promptCliToolsNote: false });
    assertEqual(promptDisabled.status, 200, 'disable prompt note patch status');
    state = await getState();
    assertEqual(state.settings.promptCliToolsNote, false, 'GET /api/state reflects prompt note false');
    engine = loadEngineFresh();
    assertEqual(engine.promptPreamble(), '', 'prompt note can still be disabled');

    console.log('sticky-add-task-row smoke tests passed');
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
