'use strict';

// Covers the managed host-side standby self-healer:
// - env composition (dev signal, standby gate, distinct hostname/port/config);
// - start idempotency, status, stop;
// - refusal to reuse the prod hostname;
// - prod's no-spawn guarantee;
// - the standby never adopting a primary's resume intent;
// - the idle status-file handoff prod reads.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'selfheal-daemon.sh');
const SERVER = path.join(REPO_ROOT, 'server.js');
const selfhealStatus = require(path.join(REPO_ROOT, 'src', 'selfheal-status.js'));

const TEMP_DIR = path.join(REPO_ROOT, '.tmp-selfheal-daemon-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const PROJECT_ID = 'daemon-handoff-project';
const PROJECT_DIR = path.join(PROJECTS_ROOT, PROJECT_ID);
const ARMED_CONFIG = path.join(TEMP_DIR, 'config.json');
const DAEMON_CONFIG = path.join(TEMP_DIR, 'standby', 'config.json');
const PID_FILE = path.join(TEMP_DIR, 'selfheal-daemon.pid');
const LOG_FILE = path.join(TEMP_DIR, 'selfheal-daemon.log');
const ENV_FILE = path.join(TEMP_DIR, 'entry-env.json');
const ENTRY = path.join(TEMP_DIR, 'fake-entry.js');
const FAKE_PORT = '4411';
const PROD_PORT = 4412;
const REAL_PORT = '4413';
const STATUS_FILE = path.join(REPO_ROOT, '.looparr', 'selfheal', 'status', `${PROJECT_ID}.json`);
const INTENT_FILE = path.join(PROJECT_DIR, '.looparr', 'auto-resume-state.json');
const AUDIT_FILE = path.join(PROJECT_DIR, '.looparr', 'auto-resume.log');

const FAKE_ENTRY = `'use strict';
const fs = require('node:fs');
const http = require('node:http');
fs.writeFileSync(process.env.DAEMON_ENV_FILE, JSON.stringify({
  NODE_ENV: process.env.NODE_ENV,
  LOOPARR_SELFHEAL: process.env.LOOPARR_SELFHEAL,
  LOOPARR_SELFHEAL_STANDBY: process.env.LOOPARR_SELFHEAL_STANDBY,
  HOSTNAME: process.env.HOSTNAME,
  HOST: process.env.HOST,
  PORT: process.env.PORT,
  CONFIG_PATH: process.env.CONFIG_PATH,
  LOOPARR_PROJECTS_ROOT: process.env.LOOPARR_PROJECTS_ROOT,
  cwd: process.cwd()
}, null, 2));
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ settings: { selfHealing: true }, selfHealingAvailable: true }));
}).listen(Number(process.env.PORT), process.env.HOST);
`;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(String(text).includes(fragment), `${label}: missing ${JSON.stringify(fragment)} in ${JSON.stringify(text)}`);
}

function baseEnv(extra = {}) {
  return {
    ...process.env,
    LOOPARR_SELFHEAL_PORT: FAKE_PORT,
    LOOPARR_SELFHEAL_BIND: '127.0.0.1',
    LOOPARR_SELFHEAL_HOSTNAME: 'looparr-heal-host',
    LOOPARR_SELFHEAL_CONFIG: DAEMON_CONFIG,
    LOOPARR_SELFHEAL_ARMED_CONFIG: ARMED_CONFIG,
    LOOPARR_SELFHEAL_PID: PID_FILE,
    LOOPARR_SELFHEAL_LOG: LOG_FILE,
    LOOPARR_SELFHEAL_ENTRY: ENTRY,
    LOOPARR_PROJECTS_ROOT: PROJECTS_ROOT,
    DAEMON_ENV_FILE: ENV_FILE,
    ...extra
  };
}

function run(args, extra = {}) {
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: baseEnv(extra),
    encoding: 'utf8',
    timeout: 90_000
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`
  };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForState(port, label) {
  let lastError = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/state`);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label}: /api/state never answered (${lastError && lastError.message})`);
}

async function waitForStatusFile() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = selfhealStatus.readStatus(REPO_ROOT, PROJECT_ID);
    if (record) return record;
    await delay(100);
  }
  return null;
}

function testStartStatusStop() {
  const first = run(['start']);
  assertEqual(first.status, 0, `start exits 0\n${first.output}`);

  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
  assertEqual(env.NODE_ENV, 'development', 'standby uses the documented dev recipe');
  assertEqual(env.LOOPARR_SELFHEAL, '1', 'standby carries the explicit self-heal signal');
  assertEqual(env.LOOPARR_SELFHEAL_STANDBY, '1', 'standby is marked as a standby');
  assertEqual(env.HOSTNAME, 'looparr-heal-host', 'standby hostname is distinct');
  assert.notEqual(env.HOSTNAME, 'looparr', 'standby never reuses the prod hostname');
  assertEqual(env.HOST, '127.0.0.1', 'standby binds to loopback');
  assertEqual(env.PORT, FAKE_PORT, 'standby uses its own port');
  for (const prodPort of ['3000', '4188', '4199']) {
    assert.notEqual(env.PORT, prodPort, `standby port differs from prod/preview ${prodPort}`);
  }
  assertEqual(env.CONFIG_PATH, DAEMON_CONFIG, 'standby uses its own config path');
  assert.notEqual(env.CONFIG_PATH, ARMED_CONFIG, 'standby never writes the arming config');
  assertEqual(env.cwd, REPO_ROOT, 'standby runs from the checkout');
  assertEqual(env.LOOPARR_PROJECTS_ROOT, PROJECTS_ROOT, 'projects root passes through');

  const copied = JSON.parse(fs.readFileSync(DAEMON_CONFIG, 'utf8'));
  assertEqual(copied.settings.selfHealing, true, 'arming setting is copied into the standby config');

  assert.ok(fs.existsSync(PID_FILE), 'start writes the pid file');
  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  assert.ok(Number.isInteger(pid) && pidAlive(pid), 'pid file points at a live process');

  const again = run(['start']);
  assertEqual(again.status, 0, `second start exits 0\n${again.output}`);
  assertIncludes(again.output, 'already running', 'second start is idempotent');
  assertEqual(Number(fs.readFileSync(PID_FILE, 'utf8').trim()), pid, 'idempotent start keeps the same pid');

  const status = run(['status']);
  assertEqual(status.status, 0, `status exits 0 while running\n${status.output}`);
  assertIncludes(status.output, 'state=running', 'status reports running');
  assertIncludes(status.output, `pid=${pid}`, 'status reports the pid');
  assertIncludes(status.output, `port=${FAKE_PORT}`, 'status reports the port');
  assertIncludes(status.output, 'hostname=looparr-heal-host', 'status reports the hostname');
  assertIncludes(status.output, 'armed=on', 'status reports the arming setting');
  assertIncludes(status.output, 'daemon_armed=on', 'status reports the standby config');
  assertIncludes(status.output, 'git=ok', 'status verifies host git');
  assertIncludes(status.output, 'docker=ok', 'status verifies host docker');

  const stop = run(['stop']);
  assertEqual(stop.status, 0, `stop exits 0\n${stop.output}`);
  assertEqual(fs.existsSync(PID_FILE), false, 'stop removes the pid file');
  assertEqual(pidAlive(pid), false, 'stop terminates the process');

  const stopAgain = run(['stop']);
  assertEqual(stopAgain.status, 0, 'stop is idempotent');
  assertIncludes(stopAgain.output, 'not running', 'second stop reports not running');

  const statusDown = run(['status']);
  assertEqual(statusDown.status, 3, 'status exits 3 while stopped');
  assertIncludes(statusDown.output, 'state=stopped', 'status reports stopped');
}

function testHostnameGuard() {
  const refused = run(['start'], { LOOPARR_SELFHEAL_HOSTNAME: 'looparr' });
  assert.notEqual(refused.status, 0, 'start refuses the prod hostname');
  assertIncludes(refused.output, 'must differ from the prod hostname', 'refusal explains the hostname rule');
  assertEqual(fs.existsSync(PID_FILE), false, 'refused start leaves no pid file');
}

async function testProdNoSpawn() {
  const compose = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
  assert.ok(!/LOOPARR_SELFHEAL\s*:/.test(compose), 'prod compose never carries the self-heal signal');
  assertIncludes(compose, 'HOSTNAME: looparr', 'prod compose keeps its own hostname');

  const engineSource = fs.readFileSync(path.join(REPO_ROOT, 'src', 'engine.js'), 'utf8');
  assertIncludes(engineSource, "process.env.LOOPARR_SELFHEAL_STANDBY === '1'", 'engine has the standby gate');
  assertIncludes(engineSource, 'resume-skipped-standby-daemon', 'standby refusal is audited');

  const probe = spawnSync(process.execPath, ['-e', `
    process.env.NODE_ENV = 'production';
    process.env.HOSTNAME = 'looparr';
    process.env.CONFIG_PATH = process.argv[1];
    delete process.env.LOOPARR_SELFHEAL;
    delete process.env.LOOPARR_SELFHEAL_STANDBY;
    const engine = require(process.argv[2]);
    process.stdout.write(String(engine.selfHealingEnabled()));
  `, ARMED_CONFIG, path.join(REPO_ROOT, 'src', 'engine.js')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: 'looparr', CONFIG_PATH: ARMED_CONFIG }
  });
  assertEqual(probe.stdout.trim(), 'false', 'prod engine refuses to spawn without the signal');

  fs.rmSync(STATUS_FILE, { force: true });
  const child = spawn(process.execPath, [SERVER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: 'looparr',
      HOST: '127.0.0.1',
      PORT: String(PROD_PORT),
      CONFIG_PATH: ARMED_CONFIG,
      LOOPARR_PROJECTS_ROOT: PROJECTS_ROOT,
      LOOPARR_SELFHEAL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try {
    const state = await waitForState(PROD_PORT, 'prod viewer');
    assertEqual(state.selfHealingAvailable, true, 'prod shows the idle pill with the setting on');
    assertEqual(state.projects[0].selfHealer.state, 'idle', 'prod pill starts idle');
    await delay(1500);
    assertEqual(fs.existsSync(STATUS_FILE), false, 'prod never writes a healer status file');
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timedOut = await Promise.race([exited.then(() => false), delay(5000).then(() => true)]);
    if (timedOut) child.kill('SIGKILL');
    if (child.exitCode === null) throw new Error(`prod viewer did not stop\n${output}`);
  }
}

function writeStaleForeignIntent() {
  fs.mkdirSync(path.dirname(INTENT_FILE), { recursive: true });
  fs.writeFileSync(INTENT_FILE, `${JSON.stringify({
    version: 1,
    projectId: PROJECT_ID,
    capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    reason: 'checkpoint',
    nextPhase: 'analyze',
    status: 'error',
    currentTask: 'Daemon handoff task',
    resumeAt: null,
    pid: 424242,
    hostname: 'looparr'
  }, null, 2)}\n`, { mode: 0o600 });
}

async function testStatusHandoff() {
  writeStaleForeignIntent();
  const before = fs.readFileSync(INTENT_FILE, 'utf8');

  const started = run(['start'], {
    LOOPARR_SELFHEAL_ENTRY: SERVER,
    LOOPARR_SELFHEAL_PORT: REAL_PORT
  });
  assertEqual(started.status, 0, `real standby start exits 0\n${started.output}`);

  try {
    const state = await waitForState(Number(REAL_PORT), 'standby engine');
    assertEqual(state.settings.selfHealing, true, 'standby engine reads the arming setting');
    assertEqual(state.selfHealingAvailable, true, 'standby engine is healing-capable');
    const project = state.projects.find((entry) => entry.id === PROJECT_ID);
    assert.ok(project, 'standby engine sees the configured project');
    assertEqual(project.active, false, 'standby never adopts the primary task');
    assertEqual(project.selfHealer.state, 'idle', 'standby pill is idle before a round');

    const record = await waitForStatusFile();
    assert.ok(record, 'standby writes the shared status file');
    assertEqual(record.state, 'idle', 'status handoff starts idle');
    assertEqual(record.hostname, 'looparr-heal-host', 'status file names the standby host');
    assertEqual(record.projectId, PROJECT_ID, 'status file names the project');
    const view = selfhealStatus.toSelfHealer(record);
    assertEqual(view.state, 'idle', 'prod maps the status file to the pill');
    assertEqual(view.mergedAt, null, 'idle handoff carries no merge');

    assertEqual(fs.existsSync(INTENT_FILE), true, 'primary intent file survives the standby boot');
    assertEqual(fs.readFileSync(INTENT_FILE, 'utf8'), before, 'primary intent is left untouched');

    let audited = false;
    for (let attempt = 0; attempt < 100 && !audited; attempt += 1) {
      const log = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8') : '';
      audited = log.includes('resume-skipped-standby-daemon');
      if (!audited) await delay(100);
    }
    assert.ok(audited, 'standby audits the intent it refused to adopt');
  } finally {
    const stopped = run(['stop'], {
      LOOPARR_SELFHEAL_ENTRY: SERVER,
      LOOPARR_SELFHEAL_PORT: REAL_PORT
    });
    assertEqual(stopped.status, 0, `standby stop exits 0\n${stopped.output}`);
  }
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.rmSync(STATUS_FILE, { force: true });
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, 'plan.md'), '# Daemon handoff\n\n- [ ] Daemon handoff task\n');
  fs.writeFileSync(ENTRY, FAKE_ENTRY);
  fs.writeFileSync(ARMED_CONFIG, `${JSON.stringify({
    settings: { selfHealing: true },
    projects: [{ id: PROJECT_ID, name: 'Daemon Handoff', path: PROJECT_DIR }]
  }, null, 2)}\n`);

  testStartStatusStop();
  testHostnameGuard();
  await testProdNoSpawn();
  await testStatusHandoff();
  console.log('selfheal daemon tests passed');
}

main()
  .then(() => {
    fs.rmSync(STATUS_FILE, { force: true });
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    spawnSync('bash', [SCRIPT, 'stop'], { cwd: REPO_ROOT, env: baseEnv(), encoding: 'utf8', timeout: 30_000 });
    fs.rmSync(STATUS_FILE, { force: true });
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    process.exit(1);
  });
