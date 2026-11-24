'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-selfheal-toggle-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const PROD_CONFIG_PATH = path.join(TEMP_DIR, 'prod-config.json');
const BASE_URL = 'http://127.0.0.1:4203';
const PROD_URL = 'http://127.0.0.1:4204';
const PROD_OVERRIDE_URL = 'http://127.0.0.1:4205';

process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function startServer(port, configPath, env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CONFIG_PATH: configPath, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function stopServer(handle) {
  if (!handle || !handle.child || handle.child.exitCode !== null) return;
  const exited = new Promise((resolve) => handle.child.once('exit', resolve));
  handle.child.kill('SIGTERM');
  const timedOut = await Promise.race([exited.then(() => false), delay(5000).then(() => true)]);
  if (timedOut) handle.child.kill('SIGKILL');
}

async function waitForServer(baseUrl) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/state`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
}

async function api(baseUrl, method, route, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON responses as text for diagnostics.
  }
  return { status: response.status, body: payload };
}

async function getState(baseUrl) {
  const response = await api(baseUrl, 'GET', '/api/state');
  assertEqual(response.status, 200, 'GET /api/state status');
  return response.body;
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ settings: { selfHealing: false }, projects: [] }, null, 2));
  fs.writeFileSync(PROD_CONFIG_PATH, JSON.stringify({ settings: { selfHealing: true }, projects: [] }, null, 2));

  const dev = startServer(4203, CONFIG_PATH, { NODE_ENV: 'development', LOOPARR_SELFHEAL: '1' });
  // Compose prod: production env with no signal — view-only.
  const prod = startServer(4204, PROD_CONFIG_PATH, { NODE_ENV: 'production' });
  // Host primary: production env with the explicit override — spawns healers.
  const prodOverride = startServer(4205, PROD_CONFIG_PATH, { NODE_ENV: 'production', LOOPARR_SELFHEAL: '1' });

  try {
    await waitForServer(BASE_URL);
    let state = await getState(BASE_URL);
    assertEqual(state.settings.selfHealing, false, 'fresh config defaults selfHealing off');
    assertEqual(state.selfHealingAvailable, false, 'pill stays hidden until the setting is enabled');

    const enabled = await api(BASE_URL, 'PATCH', '/api/settings', { selfHealing: true });
    assertEqual(enabled.status, 200, 'enable self-healing patch status');
    assertEqual(enabled.body.settings.selfHealing, true, 'enable patch reflects true');

    state = await getState(BASE_URL);
    assertEqual(state.settings.selfHealing, true, 'GET /api/state reflects persisted true');
    assertEqual(state.selfHealingAvailable, true, 'idle pill stays available once enabled');

    const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
    assertEqual(configStore.loadConfig().settings.selfHealing, true, 'enabled value survives reload');

    const rejected = await api(BASE_URL, 'PATCH', '/api/settings', { selfHealing: 'yes' });
    assertEqual(rejected.status, 400, 'non-boolean self-healing patch status');
    assert.ok(
      typeof rejected.body.error === 'string' && rejected.body.error.includes('selfHealing must be a boolean'),
      `400 error mentions selfHealing must be a boolean, got ${JSON.stringify(rejected.body)}`
    );

    const disabled = await api(BASE_URL, 'PATCH', '/api/settings', { selfHealing: false });
    assertEqual(disabled.status, 200, 'disable self-healing patch status');
    assertEqual(disabled.body.settings.selfHealing, false, 'disable patch reflects false');
    assertEqual(configStore.loadConfig().settings.selfHealing, false, 'disabled value survives reload');
    state = await getState(BASE_URL);
    assertEqual(state.selfHealingAvailable, false, 'pill hides again once the setting is off');

    await waitForServer(PROD_URL);
    const prodState = await getState(PROD_URL);
    assertEqual(prodState.settings.selfHealing, true, 'prod config keeps the setting');
    assertEqual(prodState.selfHealingAvailable, true, 'production shows an idle pill with the setting on');
    assertEqual(
      prodState.projects.length,
      0,
      'prod fixture has no projects, so no per-project selfHealer is synthesized'
    );

    await waitForServer(PROD_OVERRIDE_URL);
    const prodOverrideState = await getState(PROD_OVERRIDE_URL);
    assertEqual(prodOverrideState.settings.selfHealing, true, 'override server keeps the setting');
    assertEqual(
      prodOverrideState.selfHealingAvailable,
      true,
      'LOOPARR_SELFHEAL=1 overrides NODE_ENV=production'
    );

    console.log('selfheal toggle smoke tests passed');
  } catch (error) {
    throw new Error(`${error.message}\nDev server output:\n${dev.output()}\nProd server output:\n${prod.output()}\nProd-override server output:\n${prodOverride.output()}`);
  } finally {
    await Promise.all([stopServer(dev), stopServer(prod), stopServer(prodOverride)]);
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
