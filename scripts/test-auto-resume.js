'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-auto-resume-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const FIXTURE_PATH = path.join(TEMP_DIR, 'fake-runner.js');
const BIN_DIR = path.join(TEMP_DIR, 'bin');
const DOCKER_MARKER = path.join(TEMP_DIR, 'docker-was-called');
const PORT = '4200';
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.PORT = PORT;
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;

const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
const planLib = require(path.join(REPO_ROOT, 'src/plan.js'));
const autoResume = require(path.join(REPO_ROOT, 'src/auto-resume.js'));

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

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const dockerStub = path.join(BIN_DIR, 'docker');
  fs.writeFileSync(dockerStub, `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(DOCKER_MARKER)}\n`, 'utf8');
  fs.chmodSync(dockerStub, 0o755);
}

function serverEnv(gated) {
  const env = { ...process.env, HOSTNAME: gated ? 'looparr' : 'test-host' };
  if (gated) env.LOOPARR_ALLOW_RESUME_INTENT = '1';
  else delete env.LOOPARR_ALLOW_RESUME_INTENT;
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
    // Keep plain text for served-asset checks.
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
  throw new Error(`Server did not start: ${lastError && lastError.message}\n${child ? child.testOutput : ''}`);
}

async function spawnServer(gated) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: serverEnv(gated),
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

async function restartServer(current, gated) {
  await stopAllProjects();
  await killServer(current);
  return spawnServer(gated);
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function projectById(id) {
  const project = readConfig().projects.find((entry) => entry.id === id);
  assert.ok(project, `Config project ${id} missing`);
  return project;
}

function makeProjectDir(name, task) {
  const dir = path.join(PROJECTS_ROOT, name);
  fs.mkdirSync(path.join(dir, '.looparr'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'), `- [ ] ${task}\n`, 'utf8');
  return dir;
}

async function createProjectViaApi(name, autoResumeOnStart) {
  const task = `Task ${name}`;
  const projectPath = makeProjectDir(name, task);
  const response = await api('POST', '/api/projects', {
    name,
    path: projectPath,
    runner: 'opencode',
    autoResumeOnStart
  });
  assertEqual(response.status, 201, `create ${name}`);
  const id = response.body.project.id;
  assertEqual(response.body.project.autoResumeOnStart, autoResumeOnStart, `created ${name} flag`);
  return { id, path: projectPath, task };
}

function planTask(id) {
  const project = projectById(id);
  const plan = planLib.readPlan(project.path);
  assert.ok(plan.ok && plan.next, `Plan task for ${id}`);
  return plan.next.text;
}

function stateFile(id) {
  return autoResume.statePath(projectById(id));
}

function auditFile(id) {
  return autoResume.logPath(projectById(id));
}

function writeIntentFor(id, overrides = {}) {
  const project = projectById(id);
  const intent = {
    version: 1,
    projectId: id,
    capturedAt: new Date().toISOString(),
    reason: 'planned-restart',
    nextPhase: 'seed',
    status: 'idle',
    currentTask: planTask(id),
    resumeAt: null,
    pid: process.pid,
    hostname: 'looparr',
    ...overrides
  };
  fs.mkdirSync(path.join(project.path, '.looparr'), { recursive: true });
  fs.writeFileSync(autoResume.statePath(project), `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
}

function readAudit(id) {
  const file = auditFile(id);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function countAudit(id, event) {
  return readAudit(id).filter((entry) => entry.event === event).length;
}

async function startAndWait(id) {
  const response = await api('POST', `/api/projects/${encodeURIComponent(id)}/start`);
  assertEqual(response.status, 200, `start ${id}`);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await getState();
    if (findProject(state, id).active) return findProject(state, id);
    await delay(50);
  }
  throw new Error(`Project ${id} did not become active`);
}

async function prepare(reason = 'planned-restart') {
  const response = await api('POST', '/api/auto-resume/prepare', { reason });
  assertEqual(response.status, 200, 'prepare status');
  assertEqual(response.body.ok, true, 'prepare ok');
  return response.body;
}

function assertNoSecrets(text, label) {
  assert.ok(!/Bearer\s+(?!\[redacted\])/i.test(text), `${label}: Bearer value leaked`);
  assert.ok(!/test-token/i.test(text), `${label}: test token leaked`);
  assert.ok(!/Authorization\s*:/i.test(text), `${label}: Authorization leaked`);
  assert.ok(!/https?:\/\//i.test(text), `${label}: URL leaked`);
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12 },
    projects: []
  }, null, 2));

  // 1. Config normalization.
  assertEqual(configStore.normalizeProject({ id: 'missing' }).autoResumeOnStart, false, 'missing flag normalizes false');
  assertEqual(configStore.normalizeProject({ id: 'yes', autoResumeOnStart: true }).autoResumeOnStart, true, 'true stays true');
  assertEqual(configStore.normalizeProject({ id: 'no', autoResumeOnStart: false }).autoResumeOnStart, false, 'false stays false');
  for (const invalid of ['true', 1, null, {}, []]) {
    const normalized = configStore.normalizeProject({ id: 'bad', autoResumeOnStart: invalid });
    assertEqual(normalized.autoResumeOnStart, false, `invalid ${JSON.stringify(invalid)} normalizes false`);
  }

  let server = await spawnServer(false);

  // 2. API strict validation and state exposure.
  const flagProject = await createProjectViaApi('flag-project', true);
  let state = await getState();
  let project = findProject(state, flagProject.id);
  assertEqual(project.autoResumeOnStart, true, 'state flag true');
  assertEqual(typeof project.autoResumePending, 'boolean', 'state pending is boolean');

  const badCreate = await api('POST', '/api/projects', {
    name: 'bad-create',
    path: makeProjectDir('bad-create', 'Bad create'),
    runner: 'opencode',
    autoResumeOnStart: 'true'
  });
  assertEqual(badCreate.status, 400, 'non-boolean create rejected');

  const badPatch = await api('PATCH', `/api/projects/${flagProject.id}`, { autoResumeOnStart: 'true' });
  assertEqual(badPatch.status, 400, 'non-boolean patch rejected');

  const falsePatch = await api('PATCH', `/api/projects/${flagProject.id}`, { autoResumeOnStart: false });
  assertEqual(falsePatch.status, 200, 'false patch accepted');
  state = await getState();
  assertEqual(findProject(state, flagProject.id).autoResumeOnStart, false, 'state flag false');
  const truePatch = await api('PATCH', `/api/projects/${flagProject.id}`, { autoResumeOnStart: true });
  assertEqual(truePatch.status, 200, 'true patch accepted');

  // 3. Served UI smoke check.
  const html = await api('GET', '/');
  assert.ok(html.text.includes('drawer-auto-resume'), 'served HTML contains drawer-auto-resume');
  const appJs = await api('GET', '/app.js');
  assert.ok(appJs.text.includes('saveAutoResume'), 'served app.js contains saveAutoResume');
  const styles = await api('GET', '/styles.css');
  assert.ok(styles.text.includes('auto-resume'), 'served styles.css contains auto-resume');

  // 4. Gating without override.
  const gatingProject = await createProjectViaApi('gating-project', true);
  await startAndWait(gatingProject.id);
  const ungated = await prepare('planned-restart');
  assertEqual(ungated.gated, false, 'ungated result');
  assert.deepEqual(ungated.prepared, [], 'ungated prepared empty');
  assert.equal(fs.existsSync(stateFile(gatingProject.id)), false, 'ungated writes no pending file');
  const stopGating = await api('POST', `/api/projects/${gatingProject.id}/stop`);
  assertEqual(stopGating.status, 200, 'stop gating project');

  // 5. Capture with gating override.
  server = await restartServer(server, true);
  await startAndWait(flagProject.id);
  const captured = await prepare('planned-restart');
  assert.ok(captured.prepared.includes(flagProject.id), 'active opted-in project captured');
  const intentPath = stateFile(flagProject.id);
  assert.equal(fs.existsSync(intentPath), true, 'intent file exists');
  const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  assert.deepEqual(Object.keys(intent).sort(), [
    'capturedAt', 'currentTask', 'hostname', 'pid', 'projectId', 'reason', 'resumeAt', 'status', 'version', 'nextPhase'
  ].sort(), 'intent schema keys');
  assertEqual(intent.version, 1, 'intent version');
  assertEqual(intent.projectId, flagProject.id, 'intent project id');
  assert.ok(!Number.isNaN(Date.parse(intent.capturedAt)), 'intent capturedAt is ISO');
  assertEqual(intent.reason, 'planned-restart', 'intent reason');
  assert.ok(['seed', 'analyze', 'implement'].includes(intent.nextPhase), 'intent phase valid');
  assertEqual(typeof intent.status, 'string', 'intent status string');
  assertEqual(typeof intent.currentTask, 'string', 'intent task string');
  assertEqual(intent.resumeAt, null, 'intent resumeAt null');
  assert.ok(Number.isInteger(intent.pid), 'intent pid integer');
  assertEqual(intent.hostname, 'looparr', 'intent hostname looparr');
  const captureEntries = readAudit(flagProject.id);
  assert.ok(captureEntries.some((entry) => entry.event === 'about-to-resume'), 'about-to-resume audit present');
  for (const entry of captureEntries) {
    for (const key of Object.keys(entry)) {
      assert.ok(['ts', 'event', 'projectId', 'projectName', 'phase', 'task', 'reason', 'pid', 'hostname'].includes(key), `audit key ${key} whitelisted`);
    }
  }
  const captureLog = fs.readFileSync(auditFile(flagProject.id), 'utf8');
  assertNoSecrets(captureLog, 'capture audit');

  // 6. Stop cancels pending intent.
  const stopCaptured = await api('POST', `/api/projects/${flagProject.id}/stop`);
  assertEqual(stopCaptured.status, 200, 'stop captured project');
  assert.equal(fs.existsSync(intentPath), false, 'stop removed pending intent');
  assert.ok(countAudit(flagProject.id, 'resume-cancelled') >= 1, 'resume-cancelled audit present');

  // 7. Opt-out is not captured or resumed.
  const optOut = await createProjectViaApi('opt-out', false);
  await startAndWait(optOut.id);
  const optPrep = await prepare('planned-restart');
  assert.ok(optPrep.skipped.some((entry) => entry.id === optOut.id && entry.reason === 'opted-out'), 'opted-out skipped');
  assert.equal(fs.existsSync(stateFile(optOut.id)), false, 'opt-out not captured');
  const stopOptOut = await api('POST', `/api/projects/${optOut.id}/stop`);
  assertEqual(stopOptOut.status, 200, 'stop opt-out');
  writeIntentFor(optOut.id, { currentTask: optOut.task });
  server = await restartServer(server, true);
  state = await getState();
  assertEqual(findProject(state, optOut.id).active, false, 'opt-out not resumed');
  assert.equal(fs.existsSync(stateFile(optOut.id)), false, 'opt-out stale intent cleared');
  assert.ok(countAudit(optOut.id, 'stale-intent-ignored') >= 1, 'opt-out stale audit present');

  // 8. Seed phase startup resume.
  const seedProject = await createProjectViaApi('seed-resume', true);
  writeIntentFor(seedProject.id, { currentTask: seedProject.task });
  server = await restartServer(server, true);
  state = await getState();
  const resumedSeed = findProject(state, seedProject.id);
  assertEqual(resumedSeed.active, true, 'seed resume active');
  assert.ok(resumedSeed.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase seed).')), 'visible seed resume log');
  assert.ok(countAudit(seedProject.id, 'resume-on-start') >= 1, 'seed resume-on-start audit');
  assert.equal(fs.existsSync(stateFile(seedProject.id)), false, 'seed intent consumed');

  // 9. Analyze phase preservation with handoff.
  const analyzeProject = await createProjectViaApi('analyze-resume', true);
  fs.writeFileSync(path.join(analyzeProject.path, '.looparr', 'next_prompt.txt'), 'non-empty handoff', 'utf8');
  writeIntentFor(analyzeProject.id, { nextPhase: 'analyze', currentTask: analyzeProject.task, status: 'analyze' });
  server = await restartServer(server, true);
  state = await getState();
  const resumedAnalyze = findProject(state, analyzeProject.id);
  assertEqual(resumedAnalyze.active, true, 'analyze resume active');
  assert.ok(resumedAnalyze.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase analyze).')), 'visible analyze resume log');
  assert.ok(readAudit(analyzeProject.id).some((entry) => entry.event === 'resume-on-start' && entry.phase === 'analyze'), 'analyze audit phase');
  assert.equal(fs.existsSync(stateFile(analyzeProject.id)), false, 'analyze intent consumed');

  // 10. Degraded phase without handoff.
  const degradedProject = await createProjectViaApi('degraded-resume', true);
  try { fs.unlinkSync(path.join(degradedProject.path, '.looparr', 'next_prompt.txt')); } catch { /* absent */ }
  writeIntentFor(degradedProject.id, { nextPhase: 'analyze', currentTask: degradedProject.task, status: 'analyze' });
  server = await restartServer(server, true);
  state = await getState();
  const resumedDegraded = findProject(state, degradedProject.id);
  assertEqual(resumedDegraded.active, true, 'degraded resume active');
  assert.ok(resumedDegraded.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase seed).')), 'degraded log names seed');
  assert.ok(countAudit(degradedProject.id, 'resume-degraded') >= 1, 'resume-degraded audit present');
  assert.equal(fs.existsSync(stateFile(degradedProject.id)), false, 'degraded intent consumed');

  // 11. Stale intent and invalid version.
  const staleProject = await createProjectViaApi('stale-resume', true);
  const invalidProject = await createProjectViaApi('invalid-version', true);
  writeIntentFor(staleProject.id, {
    capturedAt: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
    currentTask: staleProject.task
  });
  writeIntentFor(invalidProject.id, { version: 2, currentTask: invalidProject.task });
  server = await restartServer(server, true);
  state = await getState();
  assertEqual(findProject(state, staleProject.id).active, false, 'stale project not resumed');
  assertEqual(findProject(state, invalidProject.id).active, false, 'invalid version not resumed');
  assert.equal(fs.existsSync(stateFile(staleProject.id)), false, 'stale intent cleared');
  assert.equal(fs.existsSync(stateFile(invalidProject.id)), false, 'invalid intent cleared');
  assert.ok(countAudit(staleProject.id, 'stale-intent-ignored') >= 1, 'stale audit present');
  assert.ok(countAudit(invalidProject.id, 'stale-intent-ignored') >= 1, 'invalid version audit present');

  // 12. Exactly-once consumption across sequential startups.
  const duplicateProject = await createProjectViaApi('duplicate-resume', true);
  writeIntentFor(duplicateProject.id, { currentTask: duplicateProject.task });
  server = await restartServer(server, true);
  assertEqual(findProject(await getState(), duplicateProject.id).active, true, 'first startup resumed');
  assertEqual(countAudit(duplicateProject.id, 'resume-on-start'), 1, 'one resume-on-start');
  server = await restartServer(server, true);
  assertEqual(findProject(await getState(), duplicateProject.id).active, false, 'second startup did not resume');
  assertEqual(countAudit(duplicateProject.id, 'resume-on-start'), 1, 'no duplicate resume-on-start');

  // 13. Rate-limited resumeAt restoration without start().
  const rateProject = await createProjectViaApi('rate-resume', true);
  const futureResumeAt = Date.now() + (10 * 60 * 1000);
  writeIntentFor(rateProject.id, {
    currentTask: rateProject.task,
    status: 'rateLimited',
    resumeAt: futureResumeAt
  });
  server = await restartServer(server, true);
  state = await getState();
  const resumedRate = findProject(state, rateProject.id);
  assertEqual(resumedRate.status, 'rateLimited', 'rate-limited status restored');
  assert.ok(resumedRate.resumeAt >= futureResumeAt, 'future resumeAt restored');
  assertEqual(resumedRate.active, true, 'rate-limited project stays active');
  assert.ok(!resumedRate.logs.some((entry) => String(entry.text).startsWith('▶ SEED')), 'start() did not clear resumeAt');

  // 14. Audit redaction and bounded rotation.
  const probe = { id: 'audit-probe', name: 'audit-probe', path: path.join(PROJECTS_ROOT, 'audit-probe') };
  fs.mkdirSync(path.join(probe.path, '.looparr'), { recursive: true });
  autoResume.appendAudit(probe, 'about-to-resume', {
    task: `Bearer test-token ${'x'.repeat(300)}`,
    phase: 'seed',
    reason: 'planned-restart'
  });
  const probeLog = fs.readFileSync(autoResume.logPath(probe), 'utf8');
  assertNoSecrets(probeLog, 'probe audit');
  const probeEntry = JSON.parse(probeLog.trim().split('\n')[0]);
  assert.ok(probeEntry.task.length <= 240, 'audit task truncated');
  const probeWrite = autoResume.writeIntent(probe, {
    reason: 'planned-restart',
    nextPhase: 'seed',
    status: 'idle',
    currentTask: 'Bearer test-token secret'
  });
  assertEqual(probeWrite.ok, true, 'probe intent written');
  assertNoSecrets(fs.readFileSync(autoResume.statePath(probe), 'utf8'), 'probe intent');

  const bigLine = `${JSON.stringify({
    ts: new Date().toISOString(),
    event: 'about-to-resume',
    projectId: probe.id,
    task: `MARKER${'x'.repeat(65500)}`
  })}\n`;
  fs.writeFileSync(autoResume.logPath(probe), bigLine, 'utf8');
  autoResume.appendAudit(probe, 'resume-on-start', { task: 'tail entry', phase: 'seed' });
  const rotatedSize = fs.statSync(autoResume.logPath(probe)).size;
  assert.ok(rotatedSize <= autoResume.LOG_MAX_BYTES, 'current audit log bounded');
  assert.equal(fs.existsSync(`${autoResume.logPath(probe)}.1`), true, 'audit rotated to .1');
  assert.ok(fs.readFileSync(`${autoResume.logPath(probe)}.1`, 'utf8').includes('MARKER'), 'existing audit lines preserved in .1');
  assert.ok(fs.readFileSync(autoResume.logPath(probe), 'utf8').includes('tail entry'), 'new audit line in fresh log');

  // 15. Restart helper dry run.
  const helperProject = await createProjectViaApi('helper-dry-run', true);
  await startAndWait(helperProject.id);
  const helperEnv = {
    ...process.env,
    LOOPARR_BASE_URL: BASE_URL,
    PATH: `${BIN_DIR}:${process.env.PATH || ''}`
  };
  delete helperEnv.LOOPARR_ALLOW_RESUME_INTENT;
  const helper = spawnSync(process.execPath, ['scripts/restart-looparr.js', '--dry-run'], {
    cwd: REPO_ROOT,
    env: helperEnv,
    encoding: 'utf8'
  });
  assertEqual(helper.status, 0, `restart helper dry-run status\n${helper.stdout}\n${helper.stderr}`);
  assert.ok(helper.stdout.includes('docker compose build looparr && docker compose up -d looparr'), 'helper prints Docker command');
  assert.ok(helper.stdout.includes('Dry run: Docker was not called.'), 'helper reports dry run');
  assert.ok(helper.stdout.includes(helperProject.id), 'helper prints prepared project id');
  assert.equal(fs.existsSync(DOCKER_MARKER), false, 'dry run did not call Docker');
  assertNoSecrets(`${helper.stdout}\n${helper.stderr}`, 'restart helper output');

  await stopAllProjects();
  await killServer(server);
  console.log('auto-resume smoke tests passed');
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
