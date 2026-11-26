'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const configStore = require(path.join(REPO_ROOT, 'src', 'config'));

const BASE_PORT = Number(process.env.TEST_PORT || 4211);
let BASE_URL = `http://127.0.0.1:${BASE_PORT}`;
const TEMP_DIR = fs.mkdtempSync(path.join(REPO_ROOT, '.tmp-repo-links-ui-'));
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');

let server = null;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(
    typeof text === 'string' && text.includes(fragment),
    `${label}: missing ${JSON.stringify(fragment)}`
  );
}

function mkdirp(directory) {
  fs.mkdirSync(directory, { recursive: true });
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

async function fetchAsset(route, label) {
  const response = await fetch(`${BASE_URL}${route}`);
  assertEqual(response.status, 200, `${label} status`);
  return response.text();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server && server.exitCode !== null) {
      throw new Error(`Server exited early (${server.exitCode})`);
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
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing function: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart >= 0, `Missing function body: ${signature}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced function body: ${signature}`);
}

function testNormalizeProject() {
  const accept = configStore.normalizeProject({
    id: 'demo',
    name: 'Demo',
    path: DEMO_DIR,
    githubRepoUrl: 'https://github.com/o/r',
    dockerRepoUrl: 'http://registry.example.com/team/app'
  });
  assertEqual(accept.githubRepoUrl, 'https://github.com/o/r', 'normalizeProject keeps https github url');
  assertEqual(
    accept.dockerRepoUrl,
    'http://registry.example.com/team/app',
    'normalizeProject keeps http docker url'
  );

  const ghcr = configStore.normalizeProject({
    id: 'demo',
    name: 'Demo',
    path: DEMO_DIR,
    dockerRepoUrl: 'https://ghcr.io/o/app'
  });
  assertEqual(
    ghcr.dockerRepoUrl,
    'https://github.com/users/o/packages/container/package/app',
    'normalizeProject maps ghcr docker url to github package page'
  );

  const missing = configStore.normalizeProject({ id: 'demo', name: 'Demo', path: DEMO_DIR });
  assertEqual(missing.githubRepoUrl, '', 'normalizeProject blanks missing github url');
  assertEqual(missing.dockerRepoUrl, '', 'normalizeProject blanks missing docker url');

  const nonHttp = configStore.normalizeProject({
    id: 'demo',
    name: 'Demo',
    path: DEMO_DIR,
    githubRepoUrl: 'ftp://github.com/o/r',
    dockerRepoUrl: 'relative/path'
  });
  assertEqual(nonHttp.githubRepoUrl, '', 'normalizeProject rejects non-http github url');
  assertEqual(nonHttp.dockerRepoUrl, '', 'normalizeProject rejects relative docker url');

  const script = configStore.normalizeProject({
    id: 'demo',
    name: 'Demo',
    path: DEMO_DIR,
    githubRepoUrl: 'javascript:alert(1)',
    dockerRepoUrl: 'data:text/html,<script>alert(1)</script>'
  });
  assertEqual(script.githubRepoUrl, '', 'normalizeProject rejects javascript github url');
  assertEqual(script.dockerRepoUrl, '', 'normalizeProject rejects data docker url');
}

function testServedAssets(indexHtml, appSource, cssSource) {
  assertIncludes(indexHtml, 'id="icon-github"', 'index sprite github icon');
  assertIncludes(indexHtml, 'id="icon-docker"', 'index sprite docker icon');

  // Drawer anchors.
  assertIncludes(indexHtml, 'data-repo-link="github"', 'index drawer github anchor');
  assertIncludes(indexHtml, 'data-repo-link="docker"', 'index drawer docker anchor');
  const drawerRow = indexHtml.slice(
    indexHtml.indexOf('id="drawer-terminal-button"'),
    indexHtml.indexOf('id="drawer-terminal-button"') + 800
  );
  assertIncludes(drawerRow, 'target="_blank"', 'drawer anchor target blank');
  assertIncludes(drawerRow, 'rel="noopener noreferrer"', 'drawer anchor rel noopener');
  assertIncludes(drawerRow, 'hidden', 'drawer anchor hidden default');

  // Card anchors (createCard template).
  assertIncludes(appSource, 'data-repo-link="github"', 'app card github anchor');
  assertIncludes(appSource, 'data-repo-link="docker"', 'app card docker anchor');
  assertIncludes(appSource, "rel=\"noopener noreferrer\"", 'app card anchor rel noopener');

  // Shared render helper and stopPropagation wiring.
  assertIncludes(appSource, 'function renderRepoLinks(rowElement, project)', 'app renderRepoLinks helper');
  assertIncludes(appSource, 'function normalizedRepoLink(value)', 'app normalizedRepoLink helper');
  assertIncludes(
    appSource,
    "link.addEventListener('click', (event) => {\n        event.stopPropagation();",
    'app card repo anchor stops propagation'
  );
  assertIncludes(appSource, 'renderRepoLinks(card.querySelector(\'.card-model-row\'), project)', 'app card update renders repo links');
  assertIncludes(
    appSource,
    "const drawerRow = dom.drawerTerminalButton?.closest('.card-model-row');\n    renderRepoLinks(drawerRow, project);",
    'app drawer renders repo links'
  );

  // CSS hit area + icon sizing.
  assertIncludes(cssSource, '.repo-link {', 'css repo-link rule');
  assertIncludes(cssSource, '.repo-icon {', 'css repo-icon rule');
}

async function testPatchRoute() {
  const created = await api('POST', '/api/projects', {
    name: 'Repo Demo',
    path: DEMO_DIR
  });
  assertEqual(created.status, 201, 'create project status');
  const id = created.body && created.body.project && created.body.project.id;
  assert.ok(id, 'created project id present');

  const valid = await api('PATCH', `/api/projects/${id}`, {
    githubRepoUrl: 'https://github.com/o/r',
    dockerRepoUrl: 'https://ghcr.io/o/app'
  });
  assertEqual(valid.status, 200, 'patch valid status');
  assertEqual(valid.body.project.githubRepoUrl, 'https://github.com/o/r', 'patch persists github url');
  assertEqual(valid.body.project.dockerRepoUrl, 'https://github.com/users/o/packages/container/package/app', 'patch persists docker url');

  const reloaded = await api('GET', '/api/state');
  assertEqual(reloaded.status, 200, 'state reload status');
  const persisted = (reloaded.body.projects || []).find((project) => project.id === id);
  assert.ok(persisted, 'patched project survives reload');
  assertEqual(persisted.githubRepoUrl, 'https://github.com/o/r', 'github url survives reload');
  assertEqual(persisted.dockerRepoUrl, 'https://github.com/users/o/packages/container/package/app', 'docker url survives reload');

  const rejected = await api('PATCH', `/api/projects/${id}`, {
    githubRepoUrl: 'javascript:alert(1)'
  });
  assertEqual(rejected.status, 400, 'patch rejects javascript url');

  const rejectedData = await api('PATCH', `/api/projects/${id}`, {
    dockerRepoUrl: 'data:text/html,<script>alert(1)</script>'
  });
  assertEqual(rejectedData.status, 400, 'patch rejects data url');

  const cleared = await api('PATCH', `/api/projects/${id}`, {
    githubRepoUrl: '',
    dockerRepoUrl: ''
  });
  assertEqual(cleared.status, 200, 'patch clear status');
  assertEqual(cleared.body.project.githubRepoUrl, '', 'patch clears github url');
  assertEqual(cleared.body.project.dockerRepoUrl, '', 'patch clears docker url');
}

async function main() {
  mkdirp(DEMO_DIR);
  fs.writeFileSync(path.join(DEMO_DIR, 'plan.md'), '# Demo\n\n- [ ] task\n');
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ settings: configStore.DEFAULT_SETTINGS, projects: [] })
  );

  testNormalizeProject();

  const port = await freePort();
  BASE_URL = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.CONFIG_PATH = CONFIG_PATH;
  process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

  server = spawn(process.execPath, [path.join(REPO_ROOT, 'server.js')], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer();
    const indexHtml = await fetchAsset('/', 'index');
    const appSource = await fetchAsset('/app.js', 'app');
    const cssSource = await fetchAsset('/styles.css', 'css');
    testServedAssets(indexHtml, appSource, cssSource);
    await testPatchRoute();
    console.log('repo link UI tests passed');
  } catch (error) {
    if (stderr) process.stderr.write(`server stderr:\n${stderr}\n`);
    throw error;
  } finally {
    if (server && server.exitCode === null) server.kill('SIGKILL');
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});