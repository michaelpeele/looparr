'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-settings-badge-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4206';

process.env.PORT = '4206';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

let server = null;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function assertExcludes(text, fragment, label) {
  assert.ok(!text.includes(fragment), `${label}: unexpectedly contains ${JSON.stringify(fragment)}`);
}

async function fetchAsset(route, label) {
  const response = await fetch(`${BASE_URL}${route}`);
  assertEqual(response.status, 200, `${label} status`);
  return response.text();
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

function checkStaticAssets() {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(REPO_ROOT, 'public/styles.css'), 'utf8');

  assertIncludes(html, 'id="settings-badge"', 'index.html has the settings badge element');
  assertIncludes(html, 'class="settings-badge"', 'index.html badge uses the settings-badge class');
  assertIncludes(html, 'aria-hidden="true"', 'index.html badge is aria-hidden');
  assertExcludes(html, 'id="host-setup"', 'index.html no longer has the Setup host item');
  assertExcludes(html, '>Setup</span>', 'index.html no longer has a Setup host label');
  assertIncludes(html, 'id="host-runner"', 'index.html keeps the Configured runner item');
  assertExcludes(html, '>Access</span>', 'index.html no longer has the Access item');
  assertExcludes(html, 'Tailnet Serve', 'index.html no longer has the Tailnet Serve detail');
  assert.ok(
    /\.host-strip\s*\{[^}]*grid-template-columns:\s*1fr/s.test(css),
    'styles.css lets the configured runner card span the page'
  );

  assertIncludes(app, "settingsBadge: $('settings-badge')", 'app.js binds the settings badge');
  assertExcludes(app, "$('host-setup')", 'app.js no longer binds host-setup');
  assertIncludes(app, 'projects.filter(isPlanSetup).length', 'app.js counts setup projects with isPlanSetup');
  assertIncludes(app, 'dom.settingsBadge.hidden = setupCount === 0', 'app.js hides the badge at zero');
  assertIncludes(app, 'dom.settingsBadge.textContent = String(setupCount)', 'app.js sets the badge count text');
  assertIncludes(app, 'dom.settingsGear.setAttribute(', 'app.js sets an accessible count label on the gear');
  assertIncludes(app, "'aria-label'", 'app.js accessible label targets aria-label');
  assertIncludes(app, 'Settings, ${setupCount}', 'app.js accessible label includes the count');

  assertIncludes(css, '.settings-badge {', 'styles.css has a .settings-badge rule');
  assertIncludes(css, '.settings-badge[hidden]', 'styles.css keeps [hidden] fully hiding the badge');
  assert.ok(
    /\.side-link\.side-icon-link\s*\{[^}]*position:\s*relative/.test(css),
    'styles.css positions .side-icon-link relative so the badge anchors to the gear'
  );
  assert.ok(
    /\.settings-badge\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/s.test(css),
    'styles.css absolutely positions the badge with pointer-events none'
  );
}

async function main() {
  checkStaticAssets();

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 2, mode: 'parallel' },
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

    const [html, app, css] = await Promise.all([
      fetchAsset('/index.html', 'GET /index.html'),
      fetchAsset('/app.js', 'GET /app.js'),
      fetchAsset('/styles.css', 'GET /styles.css')
    ]);

    assertIncludes(html, 'id="settings-badge"', 'served index.html has the settings badge element');
    assertExcludes(html, 'id="host-setup"', 'served index.html no longer has the Setup host item');
    assertIncludes(html, 'id="host-runner"', 'served index.html keeps the Configured runner item');
    assertIncludes(app, "settingsBadge: $('settings-badge')", 'served app.js binds the settings badge');
    assertExcludes(app, "$('host-setup')", 'served app.js no longer binds host-setup');
    assertIncludes(css, '.settings-badge {', 'served styles.css has the .settings-badge rule');

    console.log('settings-badge tests passed');
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
