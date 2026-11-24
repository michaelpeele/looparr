'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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
const RESTART_CONTINUE_TEST_FILE = path.join(TEMP_DIR, 'restart-continue.json');
const PORT = '4200';
const BASE_URL = `http://127.0.0.1:${PORT}`;

process.env.PORT = PORT;
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
process.env.HOSTNAME = 'test-host';
delete process.env.LOOPARR_ALLOW_RESUME_INTENT;
process.env.LOOPARR_RESTART_CONTINUE_FILE = RESTART_CONTINUE_TEST_FILE;

const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
const planLib = require(path.join(REPO_ROOT, 'src/plan.js'));
const autoResume = require(path.join(REPO_ROOT, 'src/auto-resume.js'));

const servers = [];

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function createFixture() {
  const runnersPath = require.resolve(path.join(REPO_ROOT, 'src/runners/index.js'));
  const childScript = 'require("fs").writeFileSync(".looparr/fake-child.pid", String(process.pid)); setInterval(() => {}, 1000);';
  const source = `'use strict';\n`
    + `const { registerRunner } = require(${JSON.stringify(runnersPath)});\n`
    + `registerRunner({\n`
    + `  id: 'opencode',\n`
    + `  label: 'test runner',\n`
    + `  description: 'keeps test projects active without invoking a real agent',\n`
    + `  ensureServer: async () => null,\n`
    + `  buildCommand: ({ cwd, prompt }) => {\n`
    + `    require("fs").appendFileSync(require("path").join(cwd, ".looparr", "fake-prompts.log"), JSON.stringify({ at: new Date().toISOString(), prompt }) + "\\n");\n`
    + `    return { command: ${JSON.stringify(process.execPath)}, args: ['-e', ${JSON.stringify(childScript)}], options: { cwd } };\n`
    + `  },\n`
    + `  isRateLimit: () => false\n`
    + `});\n`;
  fs.writeFileSync(FIXTURE_PATH, source, 'utf8');

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const dockerStub = path.join(BIN_DIR, 'docker');
  fs.writeFileSync(dockerStub, `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(DOCKER_MARKER)}\n`, 'utf8');
  fs.chmodSync(dockerStub, 0o755);
}

function writeDockerStub(body) {
  const dockerStub = path.join(BIN_DIR, 'docker');
  fs.writeFileSync(dockerStub, `#!/bin/sh\n${body}\nexit 0\n`, 'utf8');
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
    if (child && child.testOutput.includes('EADDRINUSE')) {
      throw new Error(`Server port in use: ${child.testOutput}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) {
        await delay(300);
        if (child && child.testOutput.includes('EADDRINUSE')) {
          throw new Error(`Server port in use: ${child.testOutput}`);
        }
        if (child && (child.exitCode !== null || child.signalCode !== null)) {
          throw new Error(`Server exited after responding: ${child.testOutput || ''}`);
        }
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}\n${child ? child.testOutput : ''}`);
}

async function spawnServer(gated) {
  let lastError;
  for (let spawnAttempt = 0; spawnAttempt < 3; spawnAttempt += 1) {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: REPO_ROOT,
      env: serverEnv(gated),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.testOutput = '';
    child.stdout.on('data', (chunk) => { child.testOutput += chunk.toString(); });
    child.stderr.on('data', (chunk) => { child.testOutput += chunk.toString(); });
    servers.push(child);
    try {
      await waitForServer(child);
      return child;
    } catch (error) {
      lastError = error;
      await killServer(child);
      if (!String(error && error.message).includes('EADDRINUSE') && !String(error && error.message).includes('port in use')) {
        throw error;
      }
      await delay(250);
    }
  }
  throw lastError;
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

function assertPlannedIntentConsumed(id, label) {
  const file = stateFile(id);
  if (!fs.existsSync(file)) return;
  const checked = autoResume.readIntent(projectById(id));
  assert.ok(
    checked.ok && checked.intent.reason === 'checkpoint',
    `${label}: planned intent not consumed; found ${checked.ok ? checked.intent.reason : checked.reason}`
  );
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

async function waitForChildPid(project) {
  const file = path.join(project.path, '.looparr', 'fake-child.pid');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (fs.existsSync(file)) {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await delay(50);
  }
  const looparrDir = path.join(project.path, '.looparr');
  const entries = fs.existsSync(looparrDir) ? fs.readdirSync(looparrDir) : [];
  const prompts = readPrompts(project);
  const state = await getState().catch(() => null);
  const projectState = state ? state.projects.find((entry) => entry.id === project.id) : null;
  throw new Error(
    `Fake child pid missing for ${project.id}`
    + `\n.looparr entries: ${entries.join(', ')}`
    + `\nprompts: ${prompts.length}`
    + `\nproject: ${projectState ? JSON.stringify({ active: projectState.active, status: projectState.status, paused: projectState.paused, currentTask: projectState.currentTask }) : 'missing'}`
  );
}

async function waitForPidGone(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(50);
  }
  throw new Error(`Fake child ${pid} still alive`);
}

function promptLogPath(project) {
  return path.join(project.path, '.looparr', 'fake-prompts.log');
}

function readPrompts(project) {
  const file = promptLogPath(project);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).prompt);
}

async function waitForPrompts(project, count) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const prompts = readPrompts(project);
    if (prompts.length >= count) return prompts;
    await delay(50);
  }
  throw new Error(`Prompt log for ${project.id} never reached ${count} entries`);
}

function writeRestartContinueMarkerForTest(message = 'Restart complete continue.') {
  fs.mkdirSync(path.dirname(RESTART_CONTINUE_TEST_FILE), { recursive: true });
  fs.writeFileSync(
    RESTART_CONTINUE_TEST_FILE,
    `${JSON.stringify({ message, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
}

async function startApiWriteSpy(target) {
  const writes = [];
  const upstream = String(target).replace(/\/$/, '');
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      writes.push({ method: req.method, url: req.url });
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('blocked');
      return;
    }
    try {
      const response = await fetch(`${upstream}${req.url}`, {
        method: 'GET',
        headers: { Accept: req.headers.accept || 'application/json' }
      });
      const body = await response.text();
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') || 'application/json'
      });
      res.end(body);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    writes,
    close: async () => {
      if (!server.listening) return;
      await new Promise((resolve) => {
        server.close(resolve);
        if (server.closeAllConnections) server.closeAllConnections();
      });
    }
  };
}

function countSeedLogs(projectState) {
  return (projectState.logs || []).filter((entry) => String(entry.text).includes('▶ SEED')).length;
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

function testIntentSessionFields() {
  const projectPath = path.join(TEMP_DIR, 'session-field-project');
  fs.mkdirSync(path.join(projectPath, '.looparr'), { recursive: true });
  const project = { id: 'session-field-test', name: 'Session Field Test', path: projectPath };
  const baseFields = {
    reason: 'checkpoint',
    nextPhase: 'seed',
    status: 'seed',
    currentTask: 'session field task',
    resumeAt: null,
    runKey: 'session-field-run-key',
    pid: process.pid,
    hostname: 'test-host'
  };
  const rawSessionId = 'ses_valid123';

  autoResume.clearIntent(project);
  const written = autoResume.writeIntent(project, { ...baseFields, opencodeSessionId: rawSessionId });
  assert.equal(written.ok, true, 'valid session id intent writes');
  assert.equal(written.intent.opencodeSessionId, rawSessionId, 'valid session id stored in intent');
  assert.equal(autoResume.readIntent(project).intent.opencodeSessionId, rawSessionId, 'read preserves session id');
  assert.equal(autoResume.consumeIntent(project).intent.opencodeSessionId, rawSessionId, 'consume preserves session id');

  autoResume.writeIntent(project, { ...baseFields, opencodeSessionId: 'not-a-session; rm -rf /' });
  assert.ok(!('opencodeSessionId' in autoResume.readIntent(project).intent), 'invalid session id omitted');

  const statePath = autoResume.statePath(project);
  const oldIntent = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  delete oldIntent.opencodeSessionId;
  fs.writeFileSync(statePath, JSON.stringify(oldIntent), { mode: 0o600 });
  assert.ok(!('opencodeSessionId' in autoResume.readIntent(project).intent), 'old intent without session id stays valid');
  autoResume.clearIntent(project);

  const audit = fs.readFileSync(autoResume.logPath(project), 'utf8');
  assert.ok(!audit.includes(rawSessionId), 'audit log contains no raw session id');
}

function testSnapshotFields(engine) {
  const projectPath = path.join(TEMP_DIR, 'snapshot-project');
  fs.mkdirSync(path.join(projectPath, '.looparr'), { recursive: true });
  const project = { id: 'snapshot-test', name: 'Snapshot Test', path: projectPath, autoResumeOnStart: true };
  autoResume.clearIntent(project);

  const savedEnv = process.env.LOOPARR_ALLOW_RESUME_INTENT;
  process.env.LOOPARR_ALLOW_RESUME_INTENT = '1';
  try {
    const rt = {
      active: false,
      status: 'error',
      currentTask: 'Implement the snapshot',
      nextPhase: 'implement',
      error: 'implement step exited with code 1',
      modelIndex: 2,
      modelAttemptRunKey: 'attempt-key',
      rateLimitBackoffKey: 'backoff-key',
      rotationCursor: { 'model-a': 1, 'model-b': 2 },
      resumeSessionId: 'ses_snapshot123',
      stepTask: { index: 3, text: 'Implement the snapshot' },
      stepOutput: 'boom https://secret.example/path token=abcd1234',
      planPhaseSnapshot: { taskText: 'Implement the snapshot', foo: 'bar' }
    };
    const written = engine.writeCheckpointIntent(project, rt);
    assert.equal(written, true, 'error checkpoint writes');

    const checked = autoResume.readIntent(project);
    assert.ok(checked.ok, 'error intent readable');
    assert.equal(checked.intent.status, 'error', 'error status persisted');
    assert.equal(checked.intent.nextPhase, 'implement', 'phase persisted');
    assert.ok(checked.intent.snapshot, 'snapshot persisted');
    assert.equal(checked.intent.snapshot.modelIndex, 2, 'snapshot modelIndex');
    assert.equal(checked.intent.snapshot.resumeSessionId, 'ses_snapshot123', 'snapshot resumeSessionId');
    assert.equal(checked.intent.snapshot.stepTask.index, 3, 'snapshot stepTask index');
    assert.deepEqual(checked.intent.snapshot.rotationCursor, { 'model-a': 1, 'model-b': 2 }, 'snapshot rotationCursor');
    assert.ok(!checked.intent.snapshot.stepOutput.includes('abcd1234'), 'snapshot stepOutput redacts token');
    assert.ok(!/https?:\/\//.test(checked.intent.snapshot.stepOutput), 'snapshot stepOutput redacts url');

    const raw = fs.readFileSync(autoResume.statePath(project), 'utf8');
    assertNoSecrets(raw, 'snapshot file');

    const data = JSON.parse(raw);
    delete data.snapshot;
    fs.writeFileSync(autoResume.statePath(project), JSON.stringify(data), { mode: 0o600 });
    const legacy = autoResume.readIntent(project);
    assert.ok(legacy.ok, 'legacy intent without snapshot readable');
    assert.ok(!('snapshot' in legacy.intent), 'legacy intent omits snapshot');

    const data2 = JSON.parse(raw);
    data2.snapshot = ['not', 'an', 'object'];
    fs.writeFileSync(autoResume.statePath(project), JSON.stringify(data2), { mode: 0o600 });
    assert.ok(!('snapshot' in autoResume.readIntent(project).intent), 'array snapshot ignored');
  } finally {
    if (savedEnv === undefined) delete process.env.LOOPARR_ALLOW_RESUME_INTENT;
    else process.env.LOOPARR_ALLOW_RESUME_INTENT = savedEnv;
    autoResume.clearIntent(project);
  }
}

async function testHandoffRecovery(engine) {
  const root = path.join(TEMP_DIR, 'handoff-recovery');
  const makeRecoveryProject = (id, task) => {
    const projectPath = path.join(root, id);
    fs.mkdirSync(path.join(projectPath, '.looparr'), { recursive: true });
    planLib.writePlan(projectPath, `# Plan\n\n- [ ] ${task}\n`);
    return { id, name: id, path: projectPath };
  };
  const handoffPath = (project) => path.join(project.path, '.looparr', 'next_prompt.txt');
  const provenancePath = (project) => path.join(project.path, '.looparr', 'handoff_task.txt');
  const writeHandoff = (project, text, stampedTask) => {
    fs.writeFileSync(handoffPath(project), text, 'utf8');
    if (stampedTask === null) {
      try { fs.unlinkSync(provenancePath(project)); } catch { /* absent */ }
    } else {
      fs.writeFileSync(provenancePath(project), `${stampedTask}\n2026-11-24\n`, 'utf8');
    }
  };
  const baseRt = (overrides = {}) => ({
    status: 'error',
    active: false,
    paused: false,
    child: null,
    starting: false,
    nextPhase: 'implement',
    currentTask: 'Task alpha',
    error: 'implement step exited with code 1',
    ...overrides
  });
  const auditEvents = (project) => {
    const file = autoResume.logPath(project);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line).event);
  };

  // error + valid, provenance-matched handoff -> recovers without start().
  const recoverProject = makeRecoveryProject('recover', 'Task alpha');
  writeHandoff(recoverProject, 'Implement task alpha now.', 'Task alpha');
  const recoverRt = baseRt();
  assertEqual(engine.handoffReadyForResume(recoverProject, recoverRt), true, 'valid handoff is ready');
  const recovered = await engine.runHandoffRecoverySweep({
    force: true,
    projects: [recoverProject],
    runtimeFor: () => recoverRt,
    listActiveRuns: async () => []
  });
  assert.deepEqual(recovered, ['recover'], 'sweep reports the recovered project');
  assertEqual(recoverRt.status, 'idle', 'recovered status idle');
  assertEqual(recoverRt.active, true, 'recovered project active');
  assertEqual(recoverRt.error, '', 'recovered error cleared');
  assertEqual(recoverRt.nextPhase, 'implement', 'recovered phase preserved');
  assert.equal(fs.existsSync(handoffPath(recoverProject)), true, 'recovered handoff kept');
  assert.ok(auditEvents(recoverProject).includes('handoff-recovered'), 'handoff-recovered audit');

  // Meta-prompt handoff -> stays error, handoff untouched.
  const metaProject = makeRecoveryProject('meta', 'Task beta');
  writeHandoff(metaProject, 'Do not implement code yet; write only prompt.', 'Task beta');
  const metaRt = baseRt({ currentTask: 'Task beta' });
  assertEqual(engine.handoffReadyForResume(metaProject, metaRt), false, 'meta handoff not ready');
  assertEqual(engine.applyHandoffRecovery(metaProject, metaRt), false, 'meta handoff does not recover');
  assertEqual(metaRt.status, 'error', 'meta handoff stays error');
  assert.equal(fs.existsSync(handoffPath(metaProject)), true, 'meta handoff kept');
  assert.ok(!auditEvents(metaProject).includes('handoff-recovered'), 'meta handoff recovers nothing');

  // Provenance mismatch -> stays error and the wrong-task handoff is cleared.
  const mismatchProject = makeRecoveryProject('mismatch', 'Task gamma');
  writeHandoff(mismatchProject, 'Implement the old task instead.', 'Old task');
  const mismatchRt = baseRt({ currentTask: 'Task gamma' });
  assertEqual(engine.handoffReadyForResume(mismatchProject, mismatchRt), false, 'mismatch not ready');
  assertEqual(engine.applyHandoffRecovery(mismatchProject, mismatchRt), false, 'mismatch does not recover');
  assertEqual(mismatchRt.status, 'error', 'mismatch stays error');
  assert.equal(fs.existsSync(handoffPath(mismatchProject)), false, 'mismatched handoff cleared');
  assert.equal(fs.existsSync(provenancePath(mismatchProject)), false, 'mismatched provenance cleared');

  // No provenance stamp (human-written handoff) is a wait, not a delete.
  const unstampedProject = makeRecoveryProject('unstamped', 'Task delta');
  writeHandoff(unstampedProject, 'Implement task delta now.', null);
  const unstampedRt = baseRt({ currentTask: 'Task delta' });
  assertEqual(engine.handoffReadyForResume(unstampedProject, unstampedRt), false, 'unstamped handoff not ready');
  assertEqual(engine.applyHandoffRecovery(unstampedProject, unstampedRt), false, 'unstamped does not recover');
  assert.equal(fs.existsSync(handoffPath(unstampedProject)), true, 'human handoff is not deleted');

  // A live project is never double-started and waiting states are untouched.
  const busyProject = makeRecoveryProject('busy', 'Task epsilon');
  writeHandoff(busyProject, 'Implement task epsilon now.', 'Task epsilon');
  const busyRt = baseRt({ currentTask: 'Task epsilon', active: true });
  assertEqual(engine.handoffReadyForResume(busyProject, busyRt), false, 'active project not ready');
  assertEqual(engine.applyHandoffRecovery(busyProject, busyRt), false, 'active project not recovered');
  assertEqual(busyRt.active, true, 'active project stays active');
  const waitingRt = baseRt({ currentTask: 'Task epsilon', status: 'waitingConfirm', nextPhase: 'analyze' });
  assertEqual(engine.handoffReadyForResume(busyProject, waitingRt), false, 'waiting state not ready');
  assertEqual(engine.applyHandoffRecovery(busyProject, waitingRt), false, 'waiting state not recovered');
  assertEqual(waitingRt.status, 'waitingConfirm', 'waiting status untouched');

  // Status not error -> no action, even with a ready handoff.
  const idleRt = baseRt({ currentTask: 'Task epsilon', status: 'idle' });
  assertEqual(engine.handoffReadyForResume(busyProject, idleRt), false, 'non-error project not ready');
  const beforeIdle = auditEvents(busyProject).length;
  await engine.runHandoffRecoverySweep({
    force: true,
    projects: [busyProject],
    runtimeFor: () => idleRt,
    listActiveRuns: async () => []
  });
  assertEqual(idleRt.status, 'idle', 'non-error status unchanged');
  assertEqual(auditEvents(busyProject).length, beforeIdle, 'non-error project writes no audit');

  // An OpenCode run already active for the project means a resumed session:
  // skip with handoff-recovery-session-active and no state change.
  const sessionProject = makeRecoveryProject('session-active', 'Task zeta');
  writeHandoff(sessionProject, 'Implement task zeta now.', 'Task zeta');
  const sessionRt = baseRt({ currentTask: 'Task zeta' });
  const sessionSkipped = await engine.runHandoffRecoverySweep({
    force: true,
    projects: [sessionProject],
    runtimeFor: () => sessionRt,
    listActiveRuns: async () => [{ runKey: 'active-run' }]
  });
  assert.deepEqual(sessionSkipped, [], 'active session recovers nothing');
  assertEqual(sessionRt.status, 'error', 'active session keeps error status');
  assertEqual(sessionRt.active, false, 'active session does not flip active');
  assert.ok(auditEvents(sessionProject).includes('handoff-recovery-session-active'), 'session-active audit');
  assert.ok(!auditEvents(sessionProject).includes('handoff-recovered'), 'no recovery audit for active session');

  // Waiting audit is throttled to one per interval per project.
  const waitProject = makeRecoveryProject('waiting-audit', 'Task eta');
  const waitRt = baseRt({ currentTask: 'Task eta' });
  for (let i = 0; i < 3; i += 1) {
    await engine.runHandoffRecoverySweep({
      force: true,
      projects: [waitProject],
      runtimeFor: () => waitRt,
      listActiveRuns: async () => []
    });
  }
  assertEqual(
    auditEvents(waitProject).filter((event) => event === 'handoff-recovery-waiting').length,
    1,
    'waiting audit throttled to one per interval'
  );
  assertEqual(waitRt.status, 'error', 'waiting project stays error');

  // Global gate: off by default, so the sweep is inert without force.
  const gatedProject = makeRecoveryProject('gated', 'Task theta');
  writeHandoff(gatedProject, 'Implement task theta now.', 'Task theta');
  const gatedRt = baseRt({ currentTask: 'Task theta' });
  const gated = await engine.runHandoffRecoverySweep({
    projects: [gatedProject],
    runtimeFor: () => gatedRt,
    listActiveRuns: async () => []
  });
  assert.deepEqual(gated, [], 'sweep inert while handoffRecovery is off');
  assertEqual(gatedRt.status, 'error', 'gated project stays error');
}

async function main() {
  testIntentSessionFields();
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  createFixture();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12 },
    projects: []
  }, null, 2));

  const engine = require(path.join(REPO_ROOT, 'src/engine.js'));
  testSnapshotFields(engine);
  await testHandoffRecovery(engine);
  const keyProject = { id: 'run-key-project', path: path.join(PROJECTS_ROOT, 'run-key-project') };
  const keyTask = 'Task with spaces';
  const expectedRunKey = crypto.createHash('sha256')
    .update([keyProject.id, path.resolve(keyProject.path), 'seed', keyTask].join('\0'), 'utf8')
    .digest('hex')
    .slice(0, 32);
  const runKey = engine.runKeyFor(keyProject, 'seed', keyTask);
  assert.match(runKey, /^[0-9a-f]{32}$/, 'run key shape');
  assertEqual(runKey, expectedRunKey, 'run key digest');
  assertEqual(engine.runKeyFor({ ...keyProject }, 'seed', keyTask), runKey, 'run key deterministic');
  assert.notEqual(engine.runKeyFor(keyProject, 'analyze', keyTask), runKey, 'run key phase changes');
  assert.notEqual(engine.runKeyFor(keyProject, 'seed', 'Other task'), runKey, 'run key task changes');
  assert.notEqual(engine.runKeyFor({ ...keyProject, path: path.join(PROJECTS_ROOT, 'run-key-other') }, 'seed', keyTask), runKey, 'run key path changes');
  assert.notEqual(engine.runKeyFor({ ...keyProject, id: 'other-id' }, 'seed', keyTask), runKey, 'run key id changes');

  // 1. Config normalization.
  assertEqual(configStore.normalizeSettings({}).handoffRecovery, false, 'handoffRecovery defaults false');
  assertEqual(configStore.normalizeSettings({ handoffRecovery: true }).handoffRecovery, true, 'handoffRecovery true stays true');
  assertEqual(configStore.normalizeSettings({ handoffRecovery: 'true' }).handoffRecovery, false, 'non-boolean handoffRecovery normalizes false');
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

  // 2b. Handoff recovery setting: strict boolean, persisted, exposed in state.
  const recoveryEnabled = await api('PATCH', '/api/settings', { handoffRecovery: true });
  assertEqual(recoveryEnabled.status, 200, 'handoffRecovery enable accepted');
  assertEqual(recoveryEnabled.body.settings.handoffRecovery, true, 'handoffRecovery enabled');
  assertEqual((await getState()).settings.handoffRecovery, true, 'state exposes handoffRecovery true');
  const recoveryInvalid = await api('PATCH', '/api/settings', { handoffRecovery: 'yes' });
  assertEqual(recoveryInvalid.status, 400, 'non-boolean handoffRecovery rejected');
  const recoveryDisabled = await api('PATCH', '/api/settings', { handoffRecovery: false });
  assertEqual(recoveryDisabled.status, 200, 'handoffRecovery disable accepted');
  assertEqual((await getState()).settings.handoffRecovery, false, 'state exposes handoffRecovery false');

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
  fs.rmSync(path.join(flagProject.path, '.looparr', 'fake-child.pid'), { force: true });
  await startAndWait(flagProject.id);
  const childPid = await waitForChildPid(flagProject);
  const seedLogsBefore = countSeedLogs(findProject(await getState(), flagProject.id));
  const captured = await prepare('planned-restart');
  await waitForPidGone(childPid);
  assert.ok(captured.prepared.includes(flagProject.id), 'active opted-in project captured');
  const intentPath = stateFile(flagProject.id);
  assert.equal(fs.existsSync(intentPath), true, 'intent file exists');
  const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  assert.deepEqual(Object.keys(intent).sort(), [
    'capturedAt', 'currentTask', 'hostname', 'pid', 'projectId', 'reason', 'resumeAt', 'runKey', 'status', 'version', 'nextPhase'
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
      assert.ok(['ts', 'event', 'projectId', 'projectName', 'phase', 'task', 'reason', 'cause', 'pid', 'hostname'].includes(key), `audit key ${key} whitelisted`);
    }
  }
  const captureLog = fs.readFileSync(auditFile(flagProject.id), 'utf8');
  assertNoSecrets(captureLog, 'capture audit');
  const pausedState = findProject(await getState(), flagProject.id);
  assertEqual(pausedState.paused, true, 'prepared project paused');
  assertEqual(pausedState.active, true, 'prepared project stays active');
  assert.equal(fs.existsSync(intentPath), true, 'intent survives quiesce');
  assert.ok(captureEntries.some((entry) => entry.event === 'resume-child-quiesced'), 'resume-child-quiesced audit present');
  await delay(1200);
  const afterQuiesceState = findProject(await getState(), flagProject.id);
  assertEqual(countSeedLogs(afterQuiesceState), seedLogsBefore, 'no new step after quiesce');

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
  assertPlannedIntentConsumed(seedProject.id, 'seed intent consumed');

  // 9. Analyze phase preservation with handoff.
  const analyzeProject = await createProjectViaApi('analyze-resume', true);
  fs.writeFileSync(path.join(analyzeProject.path, '.looparr', 'next_prompt.txt'), 'non-empty handoff', 'utf8');
  fs.writeFileSync(path.join(analyzeProject.path, '.looparr', 'handoff_task.txt'), analyzeProject.task, 'utf8');
  writeIntentFor(analyzeProject.id, { nextPhase: 'analyze', currentTask: analyzeProject.task, status: 'analyze' });
  server = await restartServer(server, true);
  state = await getState();
  const resumedAnalyze = findProject(state, analyzeProject.id);
  assertEqual(resumedAnalyze.active, true, 'analyze resume active');
  assert.ok(resumedAnalyze.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase analyze).')), 'visible analyze resume log');
  assert.ok(readAudit(analyzeProject.id).some((entry) => entry.event === 'resume-on-start' && entry.phase === 'analyze'), 'analyze audit phase');
  assertPlannedIntentConsumed(analyzeProject.id, 'analyze intent consumed');

  // 9b. Restart-continue marker is injected once, then consumed for good.
  const markerProject = await createProjectViaApi('restart-continue-resume', true);
  fs.writeFileSync(path.join(markerProject.path, '.looparr', 'next_prompt.txt'), 'non-empty handoff', 'utf8');
  fs.writeFileSync(path.join(markerProject.path, '.looparr', 'handoff_task.txt'), markerProject.task, 'utf8');
  fs.rmSync(RESTART_CONTINUE_TEST_FILE, { force: true });
  writeRestartContinueMarkerForTest();
  writeIntentFor(markerProject.id, {
    nextPhase: 'analyze',
    currentTask: markerProject.task,
    status: 'analyze',
    reason: 'container-shutdown'
  });
  const markerPromptsBefore = readPrompts(markerProject);
  server = await restartServer(server, true);

  const markerPid = await waitForChildPid(projectById(markerProject.id));
  const markerPrompts = await waitForPrompts(markerProject, markerPromptsBefore.length + 1);
  const markerNewPrompts = markerPrompts.slice(markerPromptsBefore.length);
  assertEqual(markerNewPrompts.length, 1, 'one new prompt after marker resume');
  assert.ok(
    markerNewPrompts.some((prompt) => prompt.includes('Restart complete continue.')),
    'marker message injected into analyze prompt'
  );
  assert.equal(fs.existsSync(RESTART_CONTINUE_TEST_FILE), false, 'restart marker consumed');
  assertEqual(findProject(await getState(), markerProject.id).active, true, 'marker resume active');
  assertEqual(countAudit(markerProject.id, 'resume-on-start'), 1, 'one marker resume-on-start');
  assertEqual(
    fs.readFileSync(path.join(markerProject.path, '.looparr', 'fake-child.pid'), 'utf8').trim().split(/\s+/).length,
    1,
    'one fake child pid after marker resume'
  );

  await stopAllProjects();
  await waitForPidGone(markerPid);
  fs.rmSync(path.join(markerProject.path, '.looparr', 'fake-child.pid'), { force: true });
  await killServer(server);
  fs.rmSync(RESTART_CONTINUE_TEST_FILE, { force: true });
  fs.writeFileSync(path.join(markerProject.path, '.looparr', 'next_prompt.txt'), 'non-empty handoff', 'utf8');
  fs.writeFileSync(path.join(markerProject.path, '.looparr', 'handoff_task.txt'), markerProject.task, 'utf8');
  writeIntentFor(markerProject.id, {
    nextPhase: 'analyze',
    currentTask: markerProject.task,
    status: 'analyze',
    reason: 'container-shutdown'
  });
  const noMarkerPromptsBefore = readPrompts(markerProject);
  server = await spawnServer(true);

  const noMarkerPid = await waitForChildPid(projectById(markerProject.id));
  const noMarkerPrompts = await waitForPrompts(markerProject, noMarkerPromptsBefore.length + 1);
  const noMarkerNewPrompts = noMarkerPrompts.slice(noMarkerPromptsBefore.length);
  assertEqual(noMarkerNewPrompts.length, 1, 'one new prompt without marker');
  assert.ok(
    !noMarkerNewPrompts.some((prompt) => prompt.includes('Restart complete continue.')),
    'no marker message without restart marker'
  );
  assert.notEqual(noMarkerPid, markerPid, 'second restart spawned a fresh child');
  assert.equal(fs.existsSync(RESTART_CONTINUE_TEST_FILE), false, 'no marker created for second resume');
  assertEqual(findProject(await getState(), markerProject.id).active, true, 'no-marker resume active');
  assertEqual(countAudit(markerProject.id, 'resume-on-start'), 2, 'one resume-on-start per restart');
  assertEqual(
    fs.readFileSync(path.join(markerProject.path, '.looparr', 'fake-child.pid'), 'utf8').trim().split(/\s+/).length,
    1,
    'one fake child pid without marker'
  );

  await stopAllProjects();
  await waitForPidGone(noMarkerPid);

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
  assertPlannedIntentConsumed(degradedProject.id, 'degraded intent consumed');

  // 11. Empty or stale intent task resumes from current plan as seed.
  const emptyTaskProject = await createProjectViaApi('empty-task-resume', true);
  const staleTaskProject = await createProjectViaApi('stale-task-resume', true);
  const emptyHandoff = path.join(emptyTaskProject.path, '.looparr', 'next_prompt.txt');
  const staleHandoff = path.join(staleTaskProject.path, '.looparr', 'next_prompt.txt');
  fs.writeFileSync(emptyHandoff, 'stale handoff', 'utf8');
  fs.writeFileSync(staleHandoff, 'stale handoff', 'utf8');
  writeIntentFor(emptyTaskProject.id, { currentTask: '' });
  writeIntentFor(staleTaskProject.id, {
    nextPhase: 'analyze',
    status: 'analyze',
    currentTask: 'Old completed task'
  });
  server = await restartServer(server, true);
  state = await getState();
  for (const project of [emptyTaskProject, staleTaskProject]) {
    const resumed = findProject(state, project.id);
    assertEqual(resumed.active, true, `${project.id} resumes with empty or stale task`);
    assertEqual(resumed.currentTask, project.task, `${project.id} current task from plan`);
    assertEqual(resumed.nextPhase, 'seed', `${project.id} resumes as seed`);
    assert.ok(resumed.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase seed).')), `${project.id} seed resume log`);
    assert.ok(readAudit(project.id).some((entry) => entry.event === 'resume-degraded' && entry.cause === 'task-no-longer-next'), `${project.id} degraded audit`);
    assertEqual(countAudit(project.id, 'stale-intent-ignored'), 0, `${project.id} not skipped as stale`);
    assertPlannedIntentConsumed(project.id, `${project.id} intent consumed`);
  }
  assert.equal(fs.existsSync(emptyHandoff), false, 'empty-task stale handoff cleared');
  assert.equal(fs.existsSync(staleHandoff), false, 'stale-task stale handoff cleared');

  // 12. Stale intent and invalid version.
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

  // 13b. Handoff provenance mismatch degrades to seed and clears the handoff:
  // a restart checkpoint must never push a handoff written for another task
  // into analyze/implement.
  const mismatchProject = await createProjectViaApi('provenance-mismatch', true);
  const mismatchHandoff = path.join(mismatchProject.path, '.looparr', 'next_prompt.txt');
  fs.writeFileSync(mismatchHandoff, 'Implement the OLD task, not the current one.', 'utf8');
  fs.writeFileSync(path.join(mismatchProject.path, '.looparr', 'handoff_task.txt'), 'Old completed task', 'utf8');
  writeIntentFor(mismatchProject.id, { nextPhase: 'implement', currentTask: mismatchProject.task, status: 'implement' });
  server = await restartServer(server, true);
  state = await getState();
  const resumedMismatch = findProject(state, mismatchProject.id);
  assertEqual(resumedMismatch.active, true, 'mismatch resume active');
  assert.equal(fs.existsSync(mismatchHandoff), false, 'mismatched stale handoff cleared');
  assert.equal(fs.existsSync(path.join(mismatchProject.path, '.looparr', 'handoff_task.txt')), false, 'mismatched provenance cleared');
  assert.ok(resumedMismatch.logs.some((entry) => String(entry.text).includes('Auto-resume after restart (phase seed).')), 'mismatch degrades to seed');
  assert.ok(readAudit(mismatchProject.id).some((entry) => entry.event === 'resume-degraded' && entry.cause === 'handoff-provenance-mismatch'), 'provenance audit present');
  assertPlannedIntentConsumed(mismatchProject.id, 'mismatch intent consumed');

  // 13c. A paused intent stays paused across restart; no step starts.
  const pausedProject = await createProjectViaApi('paused-resume', true);
  writeIntentFor(pausedProject.id, { currentTask: pausedProject.task, status: 'paused' });
  server = await restartServer(server, true);
  state = await getState();
  const resumedPaused = findProject(state, pausedProject.id);
  assertEqual(resumedPaused.paused, true, 'paused intent stays paused');
  assertEqual(resumedPaused.active, true, 'paused resume keeps project active');
  assertEqual(resumedPaused.status, 'paused', 'paused status restored');
  await delay(300);
  assert.ok(!findProject(await getState(), pausedProject.id).logs.some((entry) => String(entry.text).startsWith('▶ SEED')), 'paused project starts no step');

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
  const helperStateBefore = findProject(await getState(), helperProject.id);
  fs.rmSync(RESTART_CONTINUE_TEST_FILE, { force: true });
  const writeSpy = await startApiWriteSpy(BASE_URL);
  const helperEnv = {
    ...process.env,
    LOOPARR_BASE_URL: BASE_URL,
    LOOPARR_RESTART_CONTINUE_FILE: RESTART_CONTINUE_TEST_FILE,
    LOOPARR_RESTART_LOCK_PATH: path.join(TEMP_DIR, 'restart.lock'),
    LOOPARR_PROMOTIONS_LOG: path.join(TEMP_DIR, 'promotions.log'),
    PATH: `${BIN_DIR}:${process.env.PATH || ''}`
  };
  delete helperEnv.LOOPARR_ALLOW_RESUME_INTENT;
  const originalHelperBaseUrl = helperEnv.LOOPARR_BASE_URL;
  helperEnv.LOOPARR_BASE_URL = writeSpy.url;
  try {
    const helperChild = spawn(process.execPath, ['scripts/restart-looparr.js', '--dry-run'], {
      cwd: REPO_ROOT,
      env: helperEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let helperStdout = '';
    let helperStderr = '';
    helperChild.stdout.on('data', (chunk) => { helperStdout += chunk.toString(); });
    helperChild.stderr.on('data', (chunk) => { helperStderr += chunk.toString(); });
    const [helperStatus] = await once(helperChild, 'exit');
    const helper = { status: helperStatus, stdout: helperStdout, stderr: helperStderr };
    assertEqual(helper.status, 0, `restart helper dry-run status\n${helper.stdout}\n${helper.stderr}`);
    assert.ok(helper.stdout.includes('docker compose build looparr && docker compose up -d looparr'), 'helper prints Docker command');
    assert.ok(helper.stdout.includes('Dry run: Docker was not called.'), 'helper reports dry run');
    assertEqual(writeSpy.writes.length, 0, 'dry run made no write requests');
    assert.equal(fs.existsSync(RESTART_CONTINUE_TEST_FILE), false, 'dry run wrote no restart marker');
    assert.equal(fs.existsSync(DOCKER_MARKER), false, 'dry run did not call Docker');
    const helperStateAfter = findProject(await getState(), helperProject.id);
    assertEqual(helperStateAfter.active, true, 'helper project stays active after dry run');
    for (const key of ['paused', 'status', 'currentTask', 'nextPhase', 'autoResumePending']) {
      assertEqual(helperStateAfter[key], helperStateBefore[key], `dry run preserved ${key}`);
    }
    assertNoSecrets(`${helper.stdout}\n${helper.stderr}`, 'restart helper output');
  } finally {
    await writeSpy.close();
    helperEnv.LOOPARR_BASE_URL = originalHelperBaseUrl;
  }

  // 16. Restart helper clears stale planned intent before restarting.
  const helperStaleProject = await createProjectViaApi('helper-stale-intent', true);
  await startAndWait(helperStaleProject.id);
  await prepare();
  const followUpTask = `${helperStaleProject.task} follow-up`;
  planLib.writePlan(
    helperStaleProject.path,
    `# Plan\n\n- [x] ${helperStaleProject.task}\n- [ ] ${followUpTask}\n`
  );
  assertEqual(planTask(helperStaleProject.id), followUpTask, 'stale helper plan advanced');
  assert.equal(
    autoResume.readIntent(projectById(helperStaleProject.id)).intent.currentTask,
    helperStaleProject.task,
    'stale helper intent still points at old task'
  );

  const staleHelper = spawnSync(process.execPath, ['scripts/restart-looparr.js', '--dry-run'], {
    cwd: REPO_ROOT,
    env: helperEnv,
    encoding: 'utf8'
  });
  assertEqual(staleHelper.status, 0, `stale helper status\n${staleHelper.stdout}\n${staleHelper.stderr}`);
  assert.ok(
    staleHelper.stdout.includes(`Stale resume intent for ${helperStaleProject.id}; clearing it.`),
    'helper reports stale intent clearing'
  );
  assert.ok(
    staleHelper.stdout.includes('Cleared stale intents before restart.'),
    'helper clears stale intent before restart'
  );
  assert.equal(fs.existsSync(stateFile(helperStaleProject.id)), false, 'stale intent removed');
  assert.equal(
    readAudit(helperStaleProject.id).some(
      (entry) => entry.event === 'resume-degraded' && entry.cause === 'task-no-longer-next'
    ),
    false,
    'stale helper did not leave task-no-longer-next degradation'
  );
  assert.equal(fs.existsSync(DOCKER_MARKER), false, 'stale helper dry run did not call Docker');
  assertNoSecrets(`${staleHelper.stdout}\n${staleHelper.stderr}`, 'stale restart helper output');

  // 17. Promotion lock rejects contention, then releases on exit, failure, and signal.
  const lockPath = path.join(TEMP_DIR, 'contention.lock');
  const lockLog = path.join(TEMP_DIR, 'contention-promotions.log');
  const lockEnv = {
    ...helperEnv,
    LOOPARR_RESTART_LOCK_PATH: lockPath,
    LOOPARR_PROMOTIONS_LOG: lockLog
  };
  const lockHolder = spawn('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'sleep 5'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  servers.push(lockHolder);
  await delay(500);
  const contended = spawnSync('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'echo contention-ran'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(contended.status, 75, `lock contention status\n${contended.stdout}\n${contended.stderr}`);
  assert.ok(contended.stderr.includes('lock-rejected'), 'contention reports lock rejection');
  assert.ok(contended.stderr.includes('PROMOTION_LOCK_HELD'), 'contention reports structured lock error');
  assert.ok(fs.existsSync(lockLog) && fs.readFileSync(lockLog, 'utf8').includes('PROMOTION_LOCK_HELD'), 'lock rejection logged');
  assertNoSecrets(`${contended.stdout}\n${contended.stderr}`, 'lock contention output');
  const [lockHolderCode] = await once(lockHolder, 'exit');
  assertEqual(lockHolderCode, 0, 'lock holder exit code');
  const retryAfterRelease = spawnSync('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'echo retry-ok'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(retryAfterRelease.status, 0, `retry after release\n${retryAfterRelease.stderr}`);
  assert.ok(retryAfterRelease.stdout.includes('retry-ok'), 'retry ran after lock release');

  const failedChild = spawnSync('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'exit 3'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(failedChild.status, 3, 'failed child status propagated');
  const retryAfterFailure = spawnSync('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'echo after-fail'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(retryAfterFailure.status, 0, `retry after failed child\n${retryAfterFailure.stderr}`);
  assert.ok(retryAfterFailure.stdout.includes('after-fail'), 'lock released after failed child');

  const signalHolder = spawn('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'sleep 10'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  servers.push(signalHolder);
  await delay(500);
  signalHolder.kill('SIGTERM');
  const [signalHolderCode] = await once(signalHolder, 'exit');
  assertEqual(signalHolderCode, 143, 'signal holder exit code');
  const retryAfterSignal = spawnSync('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'echo after-signal'], {
    cwd: REPO_ROOT,
    env: lockEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(retryAfterSignal.status, 0, `retry after signal\n${retryAfterSignal.stderr}`);
  assert.ok(retryAfterSignal.stdout.includes('after-signal'), 'lock released after signal');

  // 18. Restart helper reports Docker failure and succeeds on retry.
  const retryProject = await createProjectViaApi('helper-retry', true);
  await startAndWait(retryProject.id);
  await prepare();
  fs.rmSync(DOCKER_MARKER, { force: true });
  const healthyPs = '  "compose ps looparr") printf \'NAME SERVICE STATUS\\nlooparr looparr Up (healthy)\\n\' ;;';
  writeDockerStub([
    `printf '%s\\n' "$*" >> ${JSON.stringify(DOCKER_MARKER)}`,
    `if [ -f ${JSON.stringify(RESTART_CONTINUE_TEST_FILE)} ]; then printf 'restart-continue:%s\\n' "$(cat ${JSON.stringify(RESTART_CONTINUE_TEST_FILE)})" >> ${JSON.stringify(DOCKER_MARKER)}; fi`,
    'case "$*" in',
    '  "compose build looparr") exit 1 ;;',
    healthyPs,
    'esac'
  ].join('\n'));
  const failedRestart = spawnSync(process.execPath, ['scripts/restart-looparr.js'], {
    cwd: REPO_ROOT,
    env: helperEnv,
    encoding: 'utf8',
    timeout: 15000
  });
  assertEqual(failedRestart.status, 1, `failed restart status\n${failedRestart.stdout}\n${failedRestart.stderr}`);
  assert.ok(failedRestart.stderr.includes('Docker command failed (1).'), 'restart reports Docker failure');
  assert.ok(failedRestart.stderr.includes('DOCKER_RESTART_FAILED'), 'restart reports structured Docker error');
  const failedDockerMarker = fs.readFileSync(DOCKER_MARKER, 'utf8');
  assert.ok(
    failedDockerMarker.includes('restart-continue:') && failedDockerMarker.includes('Restart complete continue.'),
    'restart marker present at Docker time'
  );
  assert.equal(fs.existsSync(RESTART_CONTINUE_TEST_FILE), false, 'failed restart removed marker');
  assertNoSecrets(`${failedRestart.stdout}\n${failedRestart.stderr}`, 'failed restart output');

  fs.rmSync(DOCKER_MARKER, { force: true });
  writeDockerStub([
    `printf '%s\\n' "$*" >> ${JSON.stringify(DOCKER_MARKER)}`,
    'case "$*" in',
    healthyPs,
    'esac'
  ].join('\n'));
  const retriedRestart = spawnSync(process.execPath, ['scripts/restart-looparr.js'], {
    cwd: REPO_ROOT,
    env: helperEnv,
    encoding: 'utf8',
    timeout: 15000
  });
  assertEqual(retriedRestart.status, 0, `retried restart status\n${retriedRestart.stdout}\n${retriedRestart.stderr}`);
  const retryMarker = fs.readFileSync(DOCKER_MARKER, 'utf8');
  assert.ok(retryMarker.includes('compose build looparr'), 'retry rebuilt image');
  assert.ok(retryMarker.includes('compose up -d looparr'), 'retry recreated container');
  assertNoSecrets(`${retriedRestart.stdout}\n${retriedRestart.stderr}`, 'retried restart output');
  fs.rmSync(RESTART_CONTINUE_TEST_FILE, { force: true });

  // 19. Stale intent found after restart is cleared without another restart.
  const postRestartProject = await createProjectViaApi('helper-post-restart', true);
  await startAndWait(postRestartProject.id);
  await prepare();
  const followUpPlan = `# Plan\n\n- [x] ${postRestartProject.task}\n- [ ] ${postRestartProject.task} after restart\n`;
  const followUpPlanPath = path.join(TEMP_DIR, 'post-restart-plan.md');
  fs.writeFileSync(followUpPlanPath, followUpPlan, 'utf8');
  writeDockerStub([
    `printf '%s\\n' "$*" >> ${JSON.stringify(DOCKER_MARKER)}`,
    'case "$*" in',
    `  "compose up -d looparr") cp ${JSON.stringify(followUpPlanPath)} ${JSON.stringify(path.join(postRestartProject.path, 'plan.md'))} ;;`,
    healthyPs,
    'esac'
  ].join('\n'));
  fs.rmSync(DOCKER_MARKER, { force: true });
  const postRestartHelper = spawnSync(process.execPath, ['scripts/restart-looparr.js'], {
    cwd: REPO_ROOT,
    env: helperEnv,
    encoding: 'utf8',
    timeout: 15000
  });
  assertEqual(postRestartHelper.status, 0, `post-restart helper status\n${postRestartHelper.stdout}\n${postRestartHelper.stderr}`);
  assert.ok(
    postRestartHelper.stdout.includes(`Stale resume intent for ${postRestartProject.id}; clearing it.`),
    'post-restart stale intent reported'
  );
  assert.ok(postRestartHelper.stdout.includes('Cleared stale resume intent after restart.'), 'post-restart stale intent cleared');
  assert.equal(fs.existsSync(stateFile(postRestartProject.id)), false, 'post-restart stale intent removed');
  assert.equal(
    fs.readFileSync(DOCKER_MARKER, 'utf8').includes('compose restart'),
    false,
    'no extra clean restart after clearing stale intent'
  );
  assertNoSecrets(`${postRestartHelper.stdout}\n${postRestartHelper.stderr}`, 'post-restart helper output');

  writeDockerStub(`printf '%s\\n' "$*" > ${JSON.stringify(DOCKER_MARKER)}`);

  // 20. Promotion fails fast when another promotion or restart holds the lock.
  const promoEnv = {
    ...helperEnv,
    LOOPARR_RESTART_LOCK_PATH: path.join(TEMP_DIR, 'promotion.lock'),
    LOOPARR_PROMOTIONS_LOG: path.join(TEMP_DIR, 'promotion-promotions.log')
  };
  const promoHolder = spawn('bash', ['scripts/restart-lock.sh', 'bash', '-c', 'sleep 5'], {
    cwd: REPO_ROOT,
    env: promoEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  servers.push(promoHolder);
  await delay(500);
  const rejectedPromotion = spawnSync('bash', ['scripts/promote.sh', '--sandbox-only'], {
    cwd: REPO_ROOT,
    env: promoEnv,
    encoding: 'utf8',
    timeout: 5000
  });
  assertEqual(rejectedPromotion.status, 75, `promotion lock rejection status\n${rejectedPromotion.stdout}\n${rejectedPromotion.stderr}`);
  assert.ok(rejectedPromotion.stderr.includes('lock-rejected'), 'promotion reports lock rejection');
  assert.ok(rejectedPromotion.stderr.includes('PROMOTION_LOCK_HELD'), 'promotion reports structured lock error');
  assert.ok(
    fs.readFileSync(promoEnv.LOOPARR_PROMOTIONS_LOG, 'utf8').includes('PROMOTION_LOCK_HELD'),
    'promotion lock rejection logged'
  );
  assertNoSecrets(`${rejectedPromotion.stdout}\n${rejectedPromotion.stderr}`, 'promotion lock output');
  const [promoHolderCode] = await once(promoHolder, 'exit');
  assertEqual(promoHolderCode, 0, 'promotion lock holder exits cleanly');

  // 21. Hard recreation resumes from checkpoint intent without graceful shutdown.
  const hardProject = await createProjectViaApi('hard-recreation', true);
  await startAndWait(hardProject.id);
  const hardPid = await waitForChildPid(projectById(hardProject.id));
  let checkpointIntent = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const checked = autoResume.readIntent(projectById(hardProject.id));
    if (checked.ok && checked.intent.reason === 'checkpoint') {
      checkpointIntent = checked.intent;
      break;
    }
    await delay(50);
  }
  assert.ok(checkpointIntent, 'checkpoint intent written for active project');
  assert.equal(checkpointIntent.currentTask, hardProject.task, 'checkpoint task matches active task');

  server.kill('SIGKILL');
  await once(server, 'exit');
  try {
    process.kill(hardPid, 'SIGTERM');
  } catch {
    /* child already gone */
  }
  await waitForPidGone(hardPid);
  server = await spawnServer(true);

  let hardResumeState = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await getState();
    const projectState = findProject(state, hardProject.id);
    if (projectState.active && projectState.currentTask === hardProject.task) {
      hardResumeState = projectState;
      break;
    }
    await delay(50);
  }
  assert.ok(hardResumeState, 'hard recreation resumed active project');
  assert.equal(hardResumeState.nextPhase, 'seed', 'hard recreation resumed as seed');
  assert.ok(
    hardResumeState.logs.some((entry) => entry.text.includes('Auto-resume after restart')),
    'hard recreation logged auto-resume'
  );
  assert.equal(countAudit(hardProject.id, 'resume-on-start'), 1, 'hard recreation audited resume-on-start');

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
