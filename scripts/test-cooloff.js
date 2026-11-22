'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-cooloff-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const FIXTURE_PATH = path.join(TEMP_DIR, 'fake-runner.js');
const PORT = '4201';
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.PORT = PORT;
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
const planLib = require(path.join(REPO_ROOT, 'src/plan.js'));

const servers = [];

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Fake runner whose child COMPLETES INSTANTLY.
// seed/analyze: write a non-meta handoff then exit 0.
// implement: just exit 0 (engine marks the task done).
function createFixture() {
  const runnersPath = require.resolve(path.join(REPO_ROOT, 'src/runners/index.js'));
  const childScript = [
    'const fs = require("fs");',
    'const path = require("path");',
    'const phase = process.env.COOLOFF_TEST_PHASE || "implement";',
    'const task = process.env.COOLOFF_TEST_TASK || "task";',
    'if (phase === "seed" || phase === "analyze") {',
    '  const dir = path.join(".looparr");',
    '  fs.mkdirSync(dir, { recursive: true });',
    '  fs.writeFileSync(path.join(dir, "next_prompt.txt"), "Implement the task: " + task, "utf8");',
    '}',
    'process.exit(0);'
  ].join('\n');
  const source = `'use strict';\n`
    + `const path = require('node:path');\n`
    + `const { registerRunner } = require(${JSON.stringify(runnersPath)});\n`
    + `registerRunner({\n`
    + `  id: 'opencode',\n`
    + `  label: 'cooloff test runner',\n`
    + `  description: 'completes each step instantly so cooloff timing can be observed',\n`
    + `  ensureServer: async () => null,\n`
    + `  buildCommand: ({ cwd, phase, task }) => ({\n`
    + `    command: ${JSON.stringify(process.execPath)},\n`
    + `    args: ['-e', ${JSON.stringify(childScript)}],\n`
    + `    options: { cwd, env: { ...process.env, COOLOFF_TEST_PHASE: String(phase || ''), COOLOFF_TEST_TASK: String(task || '') } }\n`
    + `  }),\n`
    + `  isRateLimit: () => false\n`
    + `});\n`;
  fs.writeFileSync(FIXTURE_PATH, source, 'utf8');
}

function serverEnv() {
  const env = { ...process.env, HOSTNAME: 'test-host' };
  delete env.LOOPARR_ALLOW_RESUME_INTENT;
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
    // Keep plain text.
  }
  return { status: response.status, body: payload, text };
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
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
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

async function stopAllProjects() {
  const state = await getState();
  for (const project of state.projects) {
    if (project.active) {
      const response = await api('POST', `/api/projects/${encodeURIComponent(project.id)}/stop`);
      assertEqual(response.status, 200, `stop ${project.id}`);
    }
  }
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function projectById(id) {
  const project = readConfig().projects.find((entry) => entry.id === id);
  assert.ok(project, `Config project ${id} missing`);
  return project;
}

function makeTwoTaskDir(name) {
  const dir = path.join(PROJECTS_ROOT, name);
  fs.mkdirSync(path.join(dir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'), `- [ ] ${name} task one\n- [ ] ${name} task two\n`, 'utf8');
  return dir;
}

async function createTwoTaskProject(name) {
  const projectPath = makeTwoTaskDir(name);
  const response = await api('POST', '/api/projects', {
    name,
    path: projectPath,
    runner: 'opencode',
    autoResumeOnStart: false
  });
  assertEqual(response.status, 201, `create ${name}`);
  return { id: response.body.project.id, path: projectPath };
}

function seedLogs(projectState) {
  return (projectState.logs || []).filter((entry) => String(entry.text).includes('▶ SEED'));
}

// Wait until the project's second seed step has begun (two ▶ SEED logs), returning the wall-clock time it started.
async function waitSecondSeed(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const project = findProject(await getState(), id);
    if (seedLogs(project).length >= 2) return { project, startedAt: Date.now() };
    if (Date.now() >= deadline) return { project: findProject(await getState(), id), startedAt: null };
    await delay(50);
  }
}

// Wait until the first task's implement is done (✓ Done log present), returning time.
async function waitFirstDone(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const project = findProject(await getState(), id);
    if ((project.logs || []).some((entry) => String(entry.text).includes('✓ Done'))) return { project, doneAt: Date.now() };
    if (Date.now() >= deadline) throw new Error(`First task did not complete for ${id}`);
    await delay(50);
  }
}

function hasCooloffLog(project, seconds) {
  const marker = `Cooloff ${seconds}s.`;
  return (project.logs || []).some((entry) => String(entry.text).includes(marker));
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12, cooloffSeconds: 0 },
    projects: []
  }, null, 2));

  require(path.join(REPO_ROOT, 'src/engine.js'));

  let server = await spawnServer();

  // 1. Config coercion: normalizeProject / normalizeSettings / resolveCooloff.
  assertEqual(configStore.normalizeProject({ id: 'x', cooloffSeconds: null }).cooloffSeconds, null, 'project null stays null');
  assertEqual(configStore.normalizeProject({ id: 'x', cooloffSeconds: 30 }).cooloffSeconds, 30, 'project valid stays');
  assertEqual(configStore.normalizeProject({ id: 'x', cooloffSeconds: 99999 }).cooloffSeconds, 3600, 'project over-range clamps to 3600');
  assertEqual(configStore.normalizeProject({ id: 'x', cooloffSeconds: -5 }).cooloffSeconds, 0, 'project under-range clamps to 0');
  assertEqual(configStore.normalizeProject({ id: 'x', cooloffSeconds: 'abc' }).cooloffSeconds, null, 'project invalid -> null');
  assertEqual(configStore.normalizeProject({ id: 'x' }).cooloffSeconds, null, 'project missing -> null');
  assertEqual(configStore.normalizeSettings({}).cooloffSeconds, 0, 'settings missing -> default 0');
  assertEqual(configStore.normalizeSettings({ cooloffSeconds: 15 }).cooloffSeconds, 15, 'settings valid stays');
  assertEqual(configStore.normalizeSettings({ cooloffSeconds: 'abc' }).cooloffSeconds, 0, 'settings invalid -> default 0');
  assertEqual(configStore.normalizeSettings({ cooloffSeconds: 99999 }).cooloffSeconds, 3600, 'settings over clamp -> 3600');
  assertEqual(configStore.normalizeSettings({ cooloffSeconds: -5 }).cooloffSeconds, 0, 'settings under clamp -> 0');
  assertEqual(configStore.resolveCooloff({ cooloffSeconds: null }, { cooloffSeconds: 8 }), 8, 'inherit global');
  assertEqual(configStore.resolveCooloff({ cooloffSeconds: 5 }, { cooloffSeconds: 8 }), 5, 'project wins');
  assertEqual(configStore.resolveCooloff({ cooloffSeconds: 0 }, { cooloffSeconds: 8 }), 0, 'project 0 beats global');
  assertEqual(configStore.resolveCooloff({ cooloffSeconds: null }, {}), 0, 'no global -> default 0');
  assertEqual(configStore.resolveCooloff({ cooloffSeconds: 99999 }, { cooloffSeconds: 8 }), 3600, 'over-range project clamps to 3600');

  // 2. Default 0: two tasks, no 'Cooloff' log, second seed is prompt.
  const def0 = await createTwoTaskProject('def0');
  const startDef0 = await api('POST', `/api/projects/${encodeURIComponent(def0.id)}/start`);
  assertEqual(startDef0.status, 200, 'start def0');
  const def0First = await waitFirstDone(def0.id, 15000);
  const def0Second = await waitSecondSeed(def0.id, 15000);
  assert.ok(def0Second.project, 'def0 second seed began');
  assert.ok(!hasCooloffLog(def0Second.project, 0), 'def0 no cooloff log (0)');
  assert.ok(
    def0Second.startedAt - def0First.doneAt < 1500,
    `def0 second seed prompt (gap ${def0Second.startedAt - def0First.doneAt}ms)`
  );
  const def0State = findProject(await getState(), def0.id);
  assertEqual(def0State.effectiveCooloffSeconds, 0, 'def0 effective cooloff 0');
  assert.equal(def0State.cooloffUntil, null, 'def0 no cooloffUntil');
  await stopAllProjects();

  // 3. Global > 0: delay applies, 'Cooloff 2s.' logged.
  const g2 = await createTwoTaskProject('global2');
  const patchGlobal2 = await api('PATCH', '/api/settings', { cooloffSeconds: 2 });
  assertEqual(patchGlobal2.status, 200, 'set global cooloff 2');
  assertEqual(patchGlobal2.body.settings.cooloffSeconds, 2, 'global cooloff 2 persisted');
  const startG2 = await api('POST', `/api/projects/${encodeURIComponent(g2.id)}/start`);
  assertEqual(startG2.status, 200, 'start global2');
  const g2First = await waitFirstDone(g2.id, 15000);
  const g2Mid = findProject(await getState(), g2.id);
  await delay(300);
  const g2MidState = findProject(await getState(), g2.id);
  assert.ok(seedLogs(g2MidState).length < 2, 'global2 second seed has not started mid-cooloff');
  const g2Second = await waitSecondSeed(g2.id, 15000);
  assert.ok(g2Second.startedAt, 'global2 second seed began');
  assert.ok(hasCooloffLog(g2Second.project, 2), 'global2 cooloff log present');
  assert.ok(
    g2Second.startedAt - g2First.doneAt >= 1500,
    `global2 second seed delayed (gap ${g2Second.startedAt - g2First.doneAt}ms)`
  );
  const g2State = findProject(await getState(), g2.id);
  assertEqual(g2State.effectiveCooloffSeconds, 2, 'global2 effective cooloff 2');
  await stopAllProjects();

  // 4. Per-project override beats global 0.
  const oA = await createTwoTaskProject('overrideA');
  const patchA = await api('PATCH', `/api/projects/${encodeURIComponent(oA.id)}`, { cooloffSeconds: 2 });
  assertEqual(patchA.status, 200, 'overrideA set 2');
  assertEqual(patchA.body.project.cooloffSeconds, 2, 'overrideA stored 2');
  const effA = findProject(await getState(), oA.id);
  assertEqual(effA.effectiveCooloffSeconds, 2, 'overrideA effective 2 (global 0)');
  const startA = await api('POST', `/api/projects/${encodeURIComponent(oA.id)}/start`);
  assertEqual(startA.status, 200, 'start overrideA');
  const aFirst = await waitFirstDone(oA.id, 15000);
  const aSecond = await waitSecondSeed(oA.id, 15000);
  assert.ok(aSecond.startedAt, 'overrideA second seed began');
  assert.ok(hasCooloffLog(aSecond.project, 2), 'overrideA cooloff log present');
  assert.ok(aSecond.startedAt - aFirst.doneAt >= 1500, `overrideA delayed (gap ${aSecond.startedAt - aFirst.doneAt}ms)`);
  await stopAllProjects();

  // 5. Per-project 0 beats global > 0: no delay.
  const oB = await createTwoTaskProject('overrideB');
  const patchB = await api('PATCH', `/api/projects/${encodeURIComponent(oB.id)}`, { cooloffSeconds: 0 });
  assertEqual(patchB.status, 200, 'overrideB set 0');
  assertEqual(patchB.body.project.cooloffSeconds, 0, 'overrideB stored 0');
  const effB = findProject(await getState(), oB.id);
  assertEqual(effB.effectiveCooloffSeconds, 0, 'overrideB effective 0 (global 2)');
  const startB = await api('POST', `/api/projects/${encodeURIComponent(oB.id)}/start`);
  assertEqual(startB.status, 200, 'start overrideB');
  const bFirst = await waitFirstDone(oB.id, 15000);
  const bSecond = await waitSecondSeed(oB.id, 15000);
  assert.ok(bSecond.startedAt, 'overrideB second seed began');
  assert.ok(!hasCooloffLog(bSecond.project, 2), 'overrideB no 2s cooloff log');
  assert.ok(bSecond.startedAt - bFirst.doneAt < 1500, `overrideB prompt (gap ${bSecond.startedAt - bFirst.doneAt}ms)`);
  await stopAllProjects();

  // 6. Explicit Start during cooloff skips the wait.
  const bypass = await createTwoTaskProject('bypass');
  const startBy = await api('POST', `/api/projects/${encodeURIComponent(bypass.id)}/start`);
  assertEqual(startBy.status, 200, 'start bypass');
  const byFirst = await waitFirstDone(bypass.id, 15000);
  // Cooloff is 2s (global). Re-Start immediately to bypass the remaining wait.
  await api('POST', `/api/projects/${encodeURIComponent(bypass.id)}/start`);
  const bySecond = await waitSecondSeed(bypass.id, 15000);
  assert.ok(bySecond.startedAt, 'bypass second seed began');
  assert.ok(
    bySecond.startedAt - byFirst.doneAt < 1500,
    `bypass explicit start skipped wait (gap ${bySecond.startedAt - byFirst.doneAt}ms)`
  );
  await stopAllProjects();

  // 7. PATCH /api/settings clamps cooloffSeconds to 0..3600.
  const clampHigh = await api('PATCH', '/api/settings', { cooloffSeconds: 99999 });
  assertEqual(clampHigh.status, 200, 'clamp high ok');
  assertEqual(clampHigh.body.settings.cooloffSeconds, 3600, 'clamped to 3600');
  const clampLow = await api('PATCH', '/api/settings', { cooloffSeconds: -5 });
  assertEqual(clampLow.status, 200, 'clamp low ok');
  assertEqual(clampLow.body.settings.cooloffSeconds, 0, 'clamped to 0');

  // 8. PATCH /api/projects/:id accepts null and clamps otherwise.
  const p1 = await createTwoTaskProject('patchp');
  const pNull = await api('PATCH', `/api/projects/${encodeURIComponent(p1.id)}`, { cooloffSeconds: null });
  assertEqual(pNull.status, 200, 'project null ok');
  assertEqual(pNull.body.project.cooloffSeconds, null, 'project null stored');
  const pEmpty = await api('PATCH', `/api/projects/${encodeURIComponent(p1.id)}`, { cooloffSeconds: '' });
  assertEqual(pEmpty.status, 200, 'project empty -> inherit');
  assertEqual(pEmpty.body.project.cooloffSeconds, null, 'project empty stored null');
  const pValid = await api('PATCH', `/api/projects/${encodeURIComponent(p1.id)}`, { cooloffSeconds: 45 });
  assertEqual(pValid.body.project.cooloffSeconds, 45, 'project 45 stored');
  const pInvalid = await api('PATCH', `/api/projects/${encodeURIComponent(p1.id)}`, { cooloffSeconds: 'abc' });
  assertEqual(pInvalid.status, 400, 'project invalid rejected');

  // 9. POST /api/projects accepts cooloffSeconds.
  const postDir = makeTwoTaskDir('postc');
  const postRes = await api('POST', '/api/projects', {
    name: 'postc',
    path: postDir,
    runner: 'opencode',
    autoResumeOnStart: false,
    cooloffSeconds: 12
  });
  assertEqual(postRes.status, 201, 'post with cooloff');
  assertEqual(postRes.body.project.cooloffSeconds, 12, 'post cooloff stored');

  // 10. Served UI smoke: cooloff fields present in HTML and app.js.
  const html = await api('GET', '/');
  assert.ok(html.text.includes('cooloff-seconds'), 'served HTML contains cooloff-seconds');
  assert.ok(html.text.includes('project-cooloff-seconds'), 'served HTML contains project-cooloff-seconds');
  assert.ok(html.text.includes('drawer-cooloff-seconds'), 'served HTML contains drawer-cooloff-seconds');
  const appJs = await api('GET', '/app.js');
  assert.ok(appJs.text.includes('cooloffSeconds'), 'served app.js contains cooloffSeconds');

  // 11. /api/state exposes settings.cooloffSeconds and per-project effectiveCooloffSeconds.
  const finalState = await getState();
  assert.equal(typeof finalState.settings.cooloffSeconds, 'number', 'settings.cooloffSeconds present');
  for (const project of finalState.projects) {
    assert.equal(typeof project.effectiveCooloffSeconds, 'number', 'per-project effectiveCooloffSeconds present');
    assert.ok('cooloffUntil' in project, 'per-project cooloffUntil present');
  }

  await stopAllProjects();
  await killServer(server);
  console.log('cooloff smoke tests passed');
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
