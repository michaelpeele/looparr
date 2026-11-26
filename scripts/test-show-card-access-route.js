'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-show-card-access-route-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4205';

process.env.PORT = '4205';
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

function assertBooleanRejected(body, label) {
  assertEqual(body.status, 400, `${label} status`);
  assert.ok(
    body.body && typeof body.body.error === 'string' && body.body.error.includes('showCardAccessRoute must be a boolean'),
    `${label}: 400 error mentions showCardAccessRoute must be a boolean, got ${JSON.stringify(body.body)}`
  );
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', globalRunner: 'opencode,kilo,vibe' },
    projects: []
  }, null, 2));

  const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
  assertEqual(configStore.DEFAULT_SETTINGS.showCardAccessRoute, false, 'DEFAULT_SETTINGS.showCardAccessRoute is false');

  const normalizedTruthy = configStore.normalizeSettings({ showCardAccessRoute: 'true' });
  assertEqual(normalizedTruthy.showCardAccessRoute, false, "normalizeSettings coerces 'true' string to false (strict boolean)");
  const normalizedOne = configStore.normalizeSettings({ showCardAccessRoute: 1 });
  assertEqual(normalizedOne.showCardAccessRoute, false, 'normalizeSettings coerces 1 to false (strict boolean)');
  const normalizedNull = configStore.normalizeSettings({ showCardAccessRoute: null });
  assertEqual(normalizedNull.showCardAccessRoute, false, 'normalizeSettings coerces null to false (strict boolean)');
  const normalizedTrue = configStore.normalizeSettings({ showCardAccessRoute: true });
  assertEqual(normalizedTrue.showCardAccessRoute, true, 'normalizeSettings keeps true boolean true');
  assertEqual(typeof normalizedTrue.showCardAccessRoute, 'boolean', 'normalizeSettings output is strictly boolean');

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
    assertEqual(state.settings.showCardAccessRoute, false, 'fresh config defaults showCardAccessRoute to false');

    const enabled = await api('PATCH', '/api/settings', { showCardAccessRoute: true });
    assertEqual(enabled.status, 200, 'enable patch status');
    assertEqual(enabled.body.settings.showCardAccessRoute, true, 'enable patch reflects true');

    state = await getState();
    assertEqual(state.settings.showCardAccessRoute, true, 'GET /api/state reflects persisted true');

    // Re-saving unrelated settings must not disturb showCardAccessRoute.
    const resave = await api('PATCH', '/api/settings', { maxConcurrent: 3 });
    assertEqual(resave.status, 200, 'unrelated re-save status');
    assertEqual(resave.body.settings.showCardAccessRoute, true, 'showCardAccessRoute survives unrelated re-save');
    state = await getState();
    assertEqual(state.settings.showCardAccessRoute, true, 'showCardAccessRoute persists after unrelated re-save');

    assertBooleanRejected(await api('PATCH', '/api/settings', { showCardAccessRoute: 'true' }), 'string "true" rejected');
    assertBooleanRejected(await api('PATCH', '/api/settings', { showCardAccessRoute: 1 }), 'number 1 rejected');
    assertBooleanRejected(await api('PATCH', '/api/settings', { showCardAccessRoute: null }), 'null rejected');

    state = await getState();
    assertEqual(state.settings.showCardAccessRoute, true, 'showCardAccessRoute still true after rejected patches');

    const reloaded = configStore.loadConfig();
    assertEqual(reloaded.settings.showCardAccessRoute, true, 'showCardAccessRoute survives config reload');

    console.log('show-card-access-route smoke tests passed');
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
