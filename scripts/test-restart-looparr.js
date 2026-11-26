#!/usr/bin/env node
'use strict';

// Focused tests for the idempotent, observable promotion flow in
// scripts/restart-looparr.js: promotion status artifact, pre-promote evidence
// check (skip-on-evidence / force), bounded compose phase with lock release,
// failure diagnostics, and the watchdog-aware recovery hook.

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RESTART_SCRIPT = path.join(ROOT, 'scripts', 'restart-looparr.js');
const LOCK_WRAPPER = path.join(ROOT, 'scripts', 'restart-lock.sh');
const restart = require(RESTART_SCRIPT);
const restartSource = fs.readFileSync(RESTART_SCRIPT, 'utf8');

const STATUS_FIELDS = [
  'runId', 'startedAt', 'finishedAt', 'phase', 'result', 'executor', 'unit',
  'invocationId', 'imageId', 'containerId', 'sourceHashSummary',
  'servedHashSummary', 'apiStateOk', 'watchdogOk', 'watchdogFix', 'skipReason',
  'error', 'logPath', 'recovery'
];

// ---------------------------------------------------------------------------
// Static assertions
// ---------------------------------------------------------------------------

(function staticAssertions() {
  assert.match(
    restartSource,
    /\.looparr['"],\s*'promotion-status\.json'|promotion-status\.json/,
    'status artifact path must be .looparr/promotion-status.json'
  );
  assert.match(
    restartSource,
    /promotion-latest\.log/,
    'log artifact path must be .looparr/logs/promotion-latest.log'
  );
  for (const field of STATUS_FIELDS) {
    assert.match(restartSource, new RegExp(`\\b${field}\\b`), `status field ${field} must exist`);
  }
  assert.match(restartSource, /mode: 0o600/, 'status write must use mode 0600');
  assert.match(
    restartSource,
    /renameSync\(tmp,\s*statusFile\)/,
    'status write must be atomic (temp file + rename)'
  );
  for (const gate of [
    'container-not-running-healthy',
    'api-state-invalid',
    'container-hash-mismatch',
    'served-hash-mismatch',
    'skipped-already-deployed'
  ]) {
    assert.ok(restartSource.includes(gate), `evidence gate ${gate} must exist`);
  }
  assert.match(restartSource, /process\.argv\.includes\('--force'\)/, '--force flag must be supported');
  assert.match(
    restartSource,
    /LOOPARR_FORCE_PROMOTION === '1'/,
    'LOOPARR_FORCE_PROMOTION env override must be supported'
  );
  assert.match(
    restartSource,
    /LOOPARR_COMPOSE_TIMEOUT_SECONDS \|\| '600'/,
    'build timeout must default to 600s'
  );
  assert.ok(
    restart.COMPOSE_TIMEOUT_SECONDS < restart.LOCK_TIMEOUT_SECONDS,
    `build timeout (${restart.COMPOSE_TIMEOUT_SECONDS}) must be shorter than lock timeout (${restart.LOCK_TIMEOUT_SECONDS})`
  );
  // Split build/up phases with an up-only deadline below the lock timeout.
  assert.match(
    restartSource,
    /const BUILD_COMMAND = 'docker compose build looparr'/,
    'build phase must be a distinct command'
  );
  assert.match(
    restartSource,
    /LOOPARR_UP_TIMEOUT_SECONDS \|\| '300'/,
    'up timeout must default to 300s'
  );
  assert.ok(
    restart.UP_TIMEOUT_SECONDS < restart.LOCK_TIMEOUT_SECONDS,
    `up timeout (${restart.UP_TIMEOUT_SECONDS}) must be shorter than lock timeout (${restart.LOCK_TIMEOUT_SECONDS})`
  );
  assert.match(
    restartSource,
    /timeout --signal=TERM --kill-after=\$\{UP_KILL_AFTER_SECONDS\}s \$\{deadlineSeconds\}s docker compose up -d looparr/,
    'up phase must be wrapped in timeout --signal=TERM --kill-after=30s <deadline>s'
  );
  // Per-invocation compose logs and tail capture.
  assert.match(restartSource, /compose-build-\$\{runId\}\.log/, 'build log path must be per-invocation');
  assert.match(restartSource, /compose-up-\$\{runId\}\.log/, 'up log path must be per-invocation');
  assert.match(restartSource, /2>&1 \| tee /, 'each compose phase must tee stdout+stderr to its log');
  assert.match(restartSource, /set -o pipefail;/, 'phase wrapper must preserve pipeline exit status');
  assert.doesNotMatch(
    restartSource,
    /PIPESTATUS/,
    'phase wrapper must not rely on PIPESTATUS under systemd-run'
  );
  assert.match(restartSource, /function readLogTail\(/, 'failed phase must capture a bounded log tail');
  assert.match(
    restartSource,
    /spawnSync\('systemd-run', buildSystemdRunArgs\(command\), \{[\s\S]*?timeout: timeoutMs/,
    'systemd-run phase execution must be bounded by the phase timeout'
  );
  assert.match(
    restartSource,
    /spawnSync\('bash', \['-c', detachedWrapper\(command\)\], \{[\s\S]*?timeout: timeoutMs/,
    'detached fallback phase execution must be bounded by the phase timeout'
  );
  assert.match(
    restartSource,
    /systemctl', \['--user', 'stop', `\$\{SYSTEMD_UNIT\}\.service`/,
    'phase timeout must stop the looparr-promote transient unit'
  );
  // Failure output must carry phase, status, container state, log path, journal.
  assert.match(restartSource, /reportError\('DOCKER_RESTART_FAILED'/, 'up failure must emit DOCKER_RESTART_FAILED');
  const failureReport = restartSource.slice(
    restartSource.indexOf("reportError('DOCKER_RESTART_FAILED'"),
    restartSource.indexOf('process.exitCode = 1;', restartSource.indexOf("reportError('DOCKER_RESTART_FAILED'"))
  );
  for (const needle of ['status:', 'phase,', 'containerState:', 'logPath:', 'journal:']) {
    assert.ok(failureReport.includes(needle), `failure output must include ${needle}`);
  }
  assert.match(restartSource, /logPath, logTail \}/, 'diagnostics must record logPath and logTail');
  for (const needle of [
    "execSync('docker compose ps looparr'",
    "'docker', ['inspect', 'looparr']",
    "'journalctl'",
    "'-u', 'docker.service'",
    "'--since', sinceIso",
    "'--no-pager', '-n', '200'"
  ]) {
    assert.ok(
      restartSource.includes(needle),
      `failure diagnostics must capture: ${needle}`
    );
  }
  assert.match(
    restartSource,
    /\[WATCHDOG_SCRIPT, 'fix'\]/,
    'recovery hook must invoke restart-watchdog.sh fix'
  );
  assert.match(
    restartSource,
    /\[WATCHDOG_SCRIPT, 'check'\]/,
    'watchdog check must be invoked read-only'
  );
  const checkBody = restartSource.slice(
    restartSource.indexOf('function runWatchdogCheck'),
    restartSource.indexOf('function runWatchdogFixRecovery')
  );
  assert.ok(!checkBody.includes("'fix'"), 'watchdog check must never mutate');
  assert.match(
    restartSource,
    /LOOPARR_RESTART_LOCK_HELD: '1'/,
    'watchdog fix recovery must reuse the already-held restart lock'
  );
  const closeoutBody = restartSource.slice(
    restartSource.indexOf('const details = inspectLooparrDetails()'),
    restartSource.indexOf("const executorUrl = process.env.LOOPARR_EXECUTOR_URL")
  );
  assert.match(
    closeoutBody,
    /await runWatchdogFixRecovery\('post-promotion'\)/,
    'failed post-promotion watchdog check must trigger an immediate fix pass'
  );
  assert.match(
    closeoutBody,
    /watchdogFix: fix\.attempts/,
    'post-promotion fix outcome must be recorded in promotion status'
  );
  assert.match(
    restartSource,
    /process\.once\('SIGINT'/,
    'signal path must write a terminal status'
  );
  assert.match(
    restartSource,
    /process\.once\('SIGTERM'/,
    'signal path must write a terminal status'
  );
  console.log('static assertions: ok');
})();

// ---------------------------------------------------------------------------
// Unit tests: pure helpers
// ---------------------------------------------------------------------------

function makeTemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `looparr-restart-${prefix}-`));
}

(function testComputeSourceManifest() {
  const dir = makeTemp('manifest');
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'b.js'), 'b\n');
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
    fs.writeFileSync(path.join(dir, 'public', 'index.html'), '<html></html>\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');

    const first = restart.computeSourceManifest(dir);
    const second = restart.computeSourceManifest(dir);
    assert.equal(first.fileCount, 4, 'manifest must count all collected files');
    assert.deepEqual(Object.keys(first.files), ['package.json', 'public/index.html', 'src/a.js', 'src/b.js'],
      'manifest paths must be sorted with forward slashes');
    assert.equal(first.combinedHash, second.combinedHash, 'manifest must be deterministic');
    assert.equal(first.files['src/a.js'], crypto.createHash('sha256').update('a\n').digest('hex'));

    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'changed\n');
    const third = restart.computeSourceManifest(dir);
    assert.notEqual(third.combinedHash, first.combinedHash, 'combined hash must change with content');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('computeSourceManifest: ok');
})();

(function testWritePromotionStatus() {
  const dir = makeTemp('status');
  try {
    const statusFile = path.join(dir, 'nested', 'promotion-status.json');
    const status = { runId: 'r1', result: 'running', phase: 'start' };
    restart.writePromotionStatus(status, statusFile);
    assert.ok(fs.existsSync(statusFile), 'status file must exist');
    const mode = fs.statSync(statusFile).mode & 0o777;
    assert.equal(mode, 0o600, 'status file must be mode 0600');
    assert.deepEqual(JSON.parse(fs.readFileSync(statusFile, 'utf8')), status);
    assert.equal(
      fs.readdirSync(path.dirname(statusFile)).filter((f) => f.includes('.tmp')).length,
      0,
      'no temp file may be left behind'
    );
    assert.equal(restart.writePromotionStatus(null, statusFile), null, 'null status is a no-op');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('writePromotionStatus: ok');
})();

(function testEvaluatePromotionEvidence() {
  const manifest = {
    fileCount: 2,
    combinedHash: 'x',
    files: {
      'src/a.js': 'hash-a',
      'public/app.js': 'hash-pub'
    }
  };
  const good = {
    manifest,
    container: { containerId: 'cid', imageId: 'img', state: 'running', health: 'healthy' },
    containerHashes: { 'src/a.js': 'hash-a', 'public/app.js': 'hash-pub' },
    containerHashReadOk: true,
    served: { ok: true, hashes: { '/app.js': { localRel: 'public/app.js', hash: 'hash-pub' } } },
    apiState: { projects: [], settings: {} }
  };
  assert.equal(restart.evaluatePromotionEvidence(good).ok, true, 'all gates pass');

  const notRunning = { ...good, container: { ...good.container, state: 'exited' } };
  assert.deepEqual(restart.evaluatePromotionEvidence(notRunning).failures, ['container-not-running-healthy']);

  const unhealthy = { ...good, container: { ...good.container, health: 'starting' } };
  assert.ok(restart.evaluatePromotionEvidence(unhealthy).failures.includes('container-not-running-healthy'));

  const badApi = { ...good, apiState: { projects: [] } };
  assert.ok(restart.evaluatePromotionEvidence(badApi).failures.includes('api-state-invalid'));

  const badContainerHash = { ...good, containerHashes: { 'src/a.js': 'other' } };
  assert.ok(
    restart.evaluatePromotionEvidence(badContainerHash).failures.includes('container-hash-mismatch:src/a.js')
  );

  const missingFile = { ...good, containerHashes: { 'public/app.js': 'hash-pub' } };
  assert.ok(
    restart.evaluatePromotionEvidence(missingFile).failures.includes('container-missing:src/a.js')
  );

  const unreadable = { ...good, containerHashReadOk: false };
  assert.ok(restart.evaluatePromotionEvidence(unreadable).failures.includes('container-hashes-unreadable'));

  const badServed = { ...good, served: { ok: true, hashes: { '/app.js': { localRel: 'public/app.js', hash: 'stale' } } } };
  assert.ok(restart.evaluatePromotionEvidence(badServed).failures.includes('served-hash-mismatch:/app.js'));

  const noServed = { ...good, served: { ok: false, hashes: {} } };
  assert.ok(restart.evaluatePromotionEvidence(noServed).failures.includes('served-assets-unavailable'));

  assert.deepEqual(restart.evaluatePromotionEvidence(null).failures, ['evidence-missing']);

  // Build-context-only files are never compared against the container.
  const withBuildFiles = {
    ...good,
    manifest: { ...manifest, files: { ...manifest.files, Dockerfile: 'df', 'docker-compose.yml': 'dc' } }
  };
  assert.equal(restart.evaluatePromotionEvidence(withBuildFiles).ok, true, 'build-context-only files are not container-comparable');
  console.log('evaluatePromotionEvidence: ok');
})();

(function testFailureDiagnostics() {
  const diagnostics = restart.collectFailureDiagnostics('compose', {
    startedAt: '2026-01-01T00:00:00Z',
    dockerPs: () => 'ps-output',
    inspect: () => 'inspect-output',
    journal: (since) => `journal-output:${since}`
  });
  assert.equal(diagnostics.phase, 'compose');
  assert.equal(diagnostics.composePs, 'ps-output');
  assert.equal(diagnostics.inspect, 'inspect-output');
  assert.equal(diagnostics.journal, 'journal-output:2026-01-01T00:00:00Z');
  console.log('collectFailureDiagnostics: ok');
})();

(function testServedHashSummary() {
  assert.equal(restart.servedHashSummary(null), null);
  assert.equal(restart.servedHashSummary({ served: { ok: false } }), null);
  const summary = restart.servedHashSummary({
    served: { ok: true, hashes: { '/a': { hash: 'h1' }, '/b': { hash: 'h2' } } }
  });
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.combinedHash, crypto.createHash('sha256').update('/a h1\n/b h2\n').digest('hex'));
  console.log('servedHashSummary: ok');
})();

// ---------------------------------------------------------------------------
// End-to-end with stubbed docker and a local API/asset server
// ---------------------------------------------------------------------------

const E2E_DIR = makeTemp('e2e');
const BIN_DIR = path.join(E2E_DIR, 'bin');
const FAKE_CONTAINER_ROOT = path.join(E2E_DIR, 'container-root');
const DOCKER_CALLS = path.join(E2E_DIR, 'docker-calls.log');
const DOCKER_START_CALLS = path.join(E2E_DIR, 'docker-start-calls.log');
const STATE_FILE = path.join(E2E_DIR, 'container-state');
const PS_FILE = path.join(E2E_DIR, 'docker-ps');
const STATUS_FILE = path.join(E2E_DIR, 'promotion-status.json');
const LOG_FILE = path.join(E2E_DIR, 'promotion-latest.log');
const ORIGINAL_PATH = process.env.PATH || '';

function writeDockerStub({ composeMode = 'ok' } = {}) {
  const stub = [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$DOCKER_CALLS"',
    'case "$1" in',
    '  inspect)',
    '    if printf \'%s\\n\' "$*" | grep -q "State.Health"; then',
    '      printf \'cid-e2e\\tsha256:e2e-image\\trunning\\thealthy\\n\'',
    '    else',
    '      cat "$DOCKER_STATE_FILE"',
    '    fi',
    '    ;;',
    '  exec)',
    '    script="$7"',
    '    cd "$LOOPARR_FAKE_CONTAINER_ROOT" && eval "${script#cd /app && }"',
    '    ;;',
  '  compose)',
  '    case "$2" in',
  '      ps) cat "$DOCKER_PS_FILE" ;;',
  '      start) printf \'%s\\n\' "$*" >> "$DOCKER_START_CALLS"; printf \'running\\n\' > "$DOCKER_STATE_FILE" ;;',
  '      build)',
  '        if [ "$LOOPARR_STUB_COMPOSE_MODE" = "build-fail" ]; then',
  '          exit 2',
  '        fi',
  '        ;;',
  '      up)',
  '        case "$LOOPARR_STUB_COMPOSE_MODE" in',
  '          hang) exec sleep 300 >/dev/null 2>&1 ;;',
  '          up-fail) exit 3 ;;',
  '        esac',
  '        ;;',
  '    esac',
  '    ;;',
    '  ps) printf \'cid-e2e\\n\' ;;',
    '  logs) echo "container log line" ;;',
    'esac',
    'exit 0'
  ].join('\n');
  const target = path.join(BIN_DIR, 'docker');
  fs.writeFileSync(target, `${stub}\n`, 'utf8');
  fs.chmodSync(target, 0o755);
  // Shadow systemd-run so the e2e uses the hermetic detached fallback: the
  // real transient unit would not inherit the stub's DOCKER_CALLS env.
  const systemdStub = path.join(BIN_DIR, 'systemd-run');
  fs.writeFileSync(systemdStub, '#!/bin/sh\nexit 1\n', 'utf8');
  fs.chmodSync(systemdStub, 0o755);
  process.env.LOOPARR_STUB_COMPOSE_MODE = composeMode;
}

function setupFakeContainerRoot() {
  fs.mkdirSync(FAKE_CONTAINER_ROOT, { recursive: true });
  for (const rel of ['src', 'public', 'scripts']) {
    const target = path.join(FAKE_CONTAINER_ROOT, rel);
    if (!fs.existsSync(target)) fs.symlinkSync(path.join(ROOT, rel), target, 'dir');
  }
  const pkg = path.join(FAKE_CONTAINER_ROOT, 'package.json');
  if (!fs.existsSync(pkg)) fs.symlinkSync(path.join(ROOT, 'package.json'), pkg, 'file');
}

// The stub server must be a separate process: the test parent blocks in
// spawnSync, so an in-process server could never answer the child's fetches.
function startStubServer() {
  const serverScript = path.join(E2E_DIR, 'stub-server.js');
  fs.writeFileSync(serverScript, `
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = ${JSON.stringify(ROOT)};
const server = http.createServer((req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ projects: [], settings: {} }));
    return;
  }
  const map = { '/': 'public/index.html', '/app.js': 'public/app.js', '/styles.css': 'public/styles.css', '/favicon.svg': 'public/favicon.svg' };
  const rel = map[req.url];
  if (!rel || !fs.existsSync(path.join(ROOT, rel))) { res.writeHead(404); res.end(); return; }
  res.writeHead(200);
  res.end(fs.readFileSync(path.join(ROOT, rel)));
});
server.listen(0, '127.0.0.1', () => console.log('port ' + server.address().port));
`);
  const child = spawn(process.execPath, [serverScript], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const m = out.match(/port (\d+)/);
      if (m) resolve({ child, port: Number(m[1]) });
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code) => reject(new Error(`stub server exited early (${code})`)));
  });
}

function e2eEnv(server, extra = {}) {
  return {
    ...process.env,
    PATH: `${BIN_DIR}${path.delimiter}${ORIGINAL_PATH}`,
    LOOPARR_RESTART_LOCK_HELD: '1',
    LOOPARR_BASE_URL: `http://127.0.0.1:${server.port}`,
    LOOPARR_LOCAL_PORT: String(server.port),
    LOOPARR_PROMOTION_STATUS_FILE: STATUS_FILE,
    LOOPARR_PROMOTION_LOG_FILE: LOG_FILE,
    LOOPARR_RESTART_CONTINUE_FILE: path.join(E2E_DIR, 'restart-continue.json'),
    LOOPARR_EXECUTOR_URL: 'http://127.0.0.1:1',
    DOCKER_CALLS,
    DOCKER_START_CALLS,
    DOCKER_STATE_FILE: STATE_FILE,
    DOCKER_PS_FILE: PS_FILE,
    LOOPARR_FAKE_CONTAINER_ROOT: FAKE_CONTAINER_ROOT,
    ...extra
  };
}

function readStatus() {
  return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
}

// Async runner with process-group cleanup: a hung compose stub must not pin
// the test parent's stdio pipes the way spawnSync would.
function runPromotion(args, env, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [LOCK_WRAPPER, process.execPath, RESTART_SCRIPT, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

async function runSkipOnEvidence(server) {
  fs.writeFileSync(DOCKER_CALLS, '', 'utf8');
  fs.writeFileSync(STATE_FILE, 'running\n', 'utf8');
  fs.writeFileSync(PS_FILE, 'NAME  SERVICE  STATUS\nlooparr  looparr  Up 2 minutes (healthy)\n', 'utf8');
  const result = await runPromotion([], e2eEnv(server));
  assert.equal(result.status, 0, `skip run must exit 0: ${result.stderr || result.stdout}`);
  const status = readStatus();
  assert.equal(status.result, 'skipped', 'status must record skipped');
  assert.equal(status.skipReason, 'skipped-already-deployed');
  assert.equal(status.apiStateOk, true);
  assert.equal(status.imageId, 'sha256:e2e-image');
  assert.equal(status.containerId, 'cid-e2e');
  assert.ok(status.sourceHashSummary && status.sourceHashSummary.fileCount > 0);
  assert.ok(status.servedHashSummary && status.servedHashSummary.fileCount === 4);
  assert.equal(status.logPath, LOG_FILE);
  assert.ok(fs.existsSync(LOG_FILE), 'promotion log must be written');
  assert.match(fs.readFileSync(LOG_FILE, 'utf8'), /Checking current Looparr instance/);
  const calls = fs.readFileSync(DOCKER_CALLS, 'utf8');
  assert.doesNotMatch(calls, /compose build/, 'skip path must not run compose build');
  assert.doesNotMatch(calls, /compose up/, 'skip path must not run compose up');
  console.log('skip-on-evidence: ok');
}

async function runForceRebuild(server) {
  fs.writeFileSync(DOCKER_CALLS, '', 'utf8');
  const result = await runPromotion(['--force'], e2eEnv(server));
  assert.equal(result.status, 0, `force run must exit 0: ${result.stderr || result.stdout}`);
  const calls = fs.readFileSync(DOCKER_CALLS, 'utf8');
  assert.match(calls, /compose build looparr/, 'force run must execute compose build');
  assert.match(calls, /compose up -d looparr/, 'force run must execute compose up');
  const status = readStatus();
  assert.equal(status.result, 'success', `force run status: ${JSON.stringify(status)}`);
  assert.equal(status.skipReason, null);
  assert.equal(status.imageId, 'sha256:e2e-image');
  assert.equal(status.containerId, 'cid-e2e');
  assert.equal(status.watchdogOk, true, 'watchdog check must pass at closeout');
  assert.equal(status.apiStateOk, true);
  assert.ok(Array.isArray(status.recovery) && status.recovery.length > 0, 'recovery attempts must be recorded');
  assert.ok(status.recovery.some((a) => a.attempt === 'recoverCreatedContainer' && a.phase === 'post-compose'));
  assert.ok(fs.existsSync(path.join(E2E_DIR, 'restart-continue.json')), 'restart continue marker must be written');
  console.log('force-rebuild: ok');
}

async function runForceEnvOverride(server) {
  fs.writeFileSync(DOCKER_CALLS, '', 'utf8');
  const result = await runPromotion([], e2eEnv(server, { LOOPARR_FORCE_PROMOTION: '1' }));
  assert.equal(result.status, 0, `env-force run must exit 0: ${result.stderr || result.stdout}`);
  assert.match(fs.readFileSync(DOCKER_CALLS, 'utf8'), /compose build looparr/, 'env override must force compose');
  console.log('force-env-override: ok');
}

async function runTimeoutLockRelease(server) {
  const statusFile = path.join(E2E_DIR, 'timeout-status.json');
  const logFile = path.join(E2E_DIR, 'timeout-promotion.log');
  const lockPath = path.join(E2E_DIR, 'timeout.lock');
  const lockLog = path.join(E2E_DIR, 'timeout-lock.log');
  fs.writeFileSync(STATE_FILE, 'running\n', 'utf8');
  fs.writeFileSync(PS_FILE, 'NAME  SERVICE  STATUS\nlooparr  looparr  Up 2 minutes (healthy)\n', 'utf8');
  fs.mkdirSync(path.join(E2E_DIR, 'empty-container'), { recursive: true });
  const env = e2eEnv(server, {
    LOOPARR_RESTART_LOCK_HELD: '',
    LOOPARR_PROMOTION_STATUS_FILE: statusFile,
    LOOPARR_PROMOTION_LOG_FILE: logFile,
    LOOPARR_RESTART_LOCK_PATH: lockPath,
    LOOPARR_PROMOTIONS_LOG: lockLog,
    LOOPARR_RESTART_LOCK_TIMEOUT: '60',
    LOOPARR_UP_TIMEOUT_SECONDS: '2',
    LOOPARR_STUB_COMPOSE_MODE: 'hang',
    // Break container-hash evidence so the run proceeds to the compose phase.
    LOOPARR_FAKE_CONTAINER_ROOT: path.join(E2E_DIR, 'empty-container')
  });
  const result = await runPromotion([], env, 120000);
  assert.equal(result.status, 1, `timed-out promotion must exit 1: ${result.stderr || result.stdout}`);
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(status.result, 'failed', 'timeout must produce failed status');
  assert.match(status.error, /timed out/, 'status error must mention the timeout');
  assert.ok(
    ['systemd-run', 'detached-spawn'].includes(status.executor),
    `executor must be recorded, got ${status.executor}`
  );
  assert.ok(status.recovery.some((a) => a.attempt === 'recoverCreatedContainer'), 'recovery must be attempted');
  assert.ok(status.diagnostics, 'failure diagnostics must be recorded');
  assert.ok('composePs' in status.diagnostics && 'inspect' in status.diagnostics && 'journal' in status.diagnostics);
  assert.ok('logPath' in status.diagnostics && 'logTail' in status.diagnostics, 'diagnostics must carry the up log path and tail');
  assert.match(status.diagnostics.logPath, /compose-up-/, 'failure diagnostics must reference the up log');
  assert.ok(fs.existsSync(logFile), 'timed-out promotion must leave a log file');
  // Failure output must name the up phase and container state.
  assert.match(result.stderr, /"phase":"up"/, 'failure output must carry phase up');
  assert.match(result.stderr, /"containerState"/, 'failure output must carry container state');
  assert.match(result.stderr, /"logPath"/, 'failure output must carry the compose log path');
  assert.match(result.stderr, /"journal"/, 'failure output must carry the bounded journal excerpt');

  // Lock release: a follow-up command must acquire the same lock quickly.
  const marker = path.join(E2E_DIR, 'lock-release-marker');
  const followUp = spawnSync('bash', [
    LOCK_WRAPPER,
    process.execPath,
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1')`
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      LOOPARR_RESTART_LOCK_PATH: lockPath,
      LOOPARR_PROMOTIONS_LOG: lockLog,
      LOOPARR_RESTART_LOCK_TIMEOUT: '5'
    },
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(followUp.status, 0, `lock must be released after timeout: ${followUp.stderr || followUp.stdout}`);
  assert.ok(fs.existsSync(marker), 'follow-up command must have run after lock release');
  console.log('timeout-lock-release: ok');
}

async function assertLockReleased(lockPath, lockLog) {
  const marker = path.join(E2E_DIR, `lock-release-${crypto.randomUUID()}`);
  const followUp = spawnSync('bash', [
    LOCK_WRAPPER,
    process.execPath,
    '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '1')`
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      LOOPARR_RESTART_LOCK_PATH: lockPath,
      LOOPARR_PROMOTIONS_LOG: lockLog,
      LOOPARR_RESTART_LOCK_TIMEOUT: '5'
    },
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(followUp.status, 0, `lock must be released: ${followUp.stderr || followUp.stdout}`);
  assert.ok(fs.existsSync(marker), 'follow-up command must have run after lock release');
}

// Up nonzero exit with a created container: the one-shot created recovery must
// start it exactly once, no watchdog fix should run, and the promotion must fail
// with phase/status/state/log/journal evidence and a released lock.
async function runUpNonzeroCreatedRecovery(server) {
  const statusFile = path.join(E2E_DIR, 'up-created-status.json');
  const logFile = path.join(E2E_DIR, 'up-created-promotion.log');
  const lockPath = path.join(E2E_DIR, 'up-created.lock');
  const lockLog = path.join(E2E_DIR, 'up-created-lock.log');
  fs.writeFileSync(STATE_FILE, 'created\n', 'utf8');
  fs.writeFileSync(PS_FILE, 'NAME  SERVICE  STATUS\nlooparr  looparr  Up 2 minutes (healthy)\n', 'utf8');
  fs.writeFileSync(DOCKER_START_CALLS, '', 'utf8');
  fs.mkdirSync(path.join(E2E_DIR, 'empty-container'), { recursive: true });
  const env = e2eEnv(server, {
    LOOPARR_RESTART_LOCK_HELD: '',
    LOOPARR_PROMOTION_STATUS_FILE: statusFile,
    LOOPARR_PROMOTION_LOG_FILE: logFile,
    LOOPARR_RESTART_LOCK_PATH: lockPath,
    LOOPARR_PROMOTIONS_LOG: lockLog,
    LOOPARR_RESTART_LOCK_TIMEOUT: '60',
    LOOPARR_STUB_COMPOSE_MODE: 'up-fail',
    LOOPARR_FAKE_CONTAINER_ROOT: path.join(E2E_DIR, 'empty-container')
  });
  const result = await runPromotion([], env, 120000);
  assert.equal(result.status, 1, `up-fail promotion must exit 1: ${result.stderr || result.stdout}`);
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(status.result, 'failed', 'up failure must produce failed status');
  assert.equal(status.phase, 'up', 'status phase must be up');
  assert.match(status.error, /exited 3/, 'status error must name the up exit code');
  const startCalls = fs.readFileSync(DOCKER_START_CALLS, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(startCalls, ['compose start looparr'], 'created recovery must start exactly once');
  assert.ok(
    status.recovery.some((a) => a.attempt === 'recoverCreatedContainer' && a.phase === 'up' && a.ok),
    'created recovery must succeed once'
  );
  assert.ok(
    !status.recovery.some((a) => a.attempt === 'watchdog-fix'),
    'watchdog fix must not run when created recovery restores the container'
  );
  assert.match(result.stderr, /"phase":"up"/, 'failure output must carry phase up');
  assert.match(result.stderr, /"status":3/, 'failure output must carry the up exit status');
  assert.match(result.stderr, /"containerState"/, 'failure output must carry container state');
  assert.match(result.stderr, /"logPath"/, 'failure output must carry the compose log path');
  assert.match(result.stderr, /"journal"/, 'failure output must carry the bounded journal excerpt');
  await assertLockReleased(lockPath, lockLog);
  console.log('up-nonzero-created-recovery: ok');
}

// Up nonzero exit with an unrecoverable container: created/exited/dead recovery
// cannot start it, so the bounded watchdog fix runs once, the promotion still
// fails with full evidence, and the lock is released.
async function runUpNonzeroRecoveryFailure(server) {
  const statusFile = path.join(E2E_DIR, 'up-fail-status.json');
  const logFile = path.join(E2E_DIR, 'up-fail-promotion.log');
  const lockPath = path.join(E2E_DIR, 'up-fail.lock');
  const lockLog = path.join(E2E_DIR, 'up-fail-lock.log');
  fs.writeFileSync(STATE_FILE, 'paused\n', 'utf8');
  fs.writeFileSync(PS_FILE, 'NAME  SERVICE  STATUS\nlooparr  looparr  Exited (0) 1 minute ago\n', 'utf8');
  fs.writeFileSync(DOCKER_START_CALLS, '', 'utf8');
  fs.mkdirSync(path.join(E2E_DIR, 'empty-container'), { recursive: true });
  const env = e2eEnv(server, {
    LOOPARR_RESTART_LOCK_HELD: '',
    LOOPARR_PROMOTION_STATUS_FILE: statusFile,
    LOOPARR_PROMOTION_LOG_FILE: logFile,
    LOOPARR_RESTART_LOCK_PATH: lockPath,
    LOOPARR_PROMOTIONS_LOG: lockLog,
    LOOPARR_RESTART_LOCK_TIMEOUT: '60',
    LOOPARR_STUB_COMPOSE_MODE: 'up-fail',
    LOOPARR_FAKE_CONTAINER_ROOT: path.join(E2E_DIR, 'empty-container')
  });
  const result = await runPromotion([], env, 120000);
  assert.equal(result.status, 1, `unrecoverable up-fail must exit 1: ${result.stderr || result.stdout}`);
  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(status.result, 'failed', 'unrecoverable up failure must produce failed status');
  assert.equal(status.phase, 'up', 'status phase must be up');
  assert.ok(
    status.recovery.some((a) => a.attempt === 'watchdog-fix'),
    'watchdog fix must run when created recovery cannot restore the container'
  );
  assert.ok(
    status.recovery.some((a) => a.attempt === 'recoverCreatedContainer' && a.phase === 'up' && !a.ok),
    'created recovery must be recorded as failed'
  );
  assert.match(result.stderr, /"phase":"up"/, 'failure output must carry phase up');
  assert.match(result.stderr, /"containerState"/, 'failure output must carry container state');
  assert.match(result.stderr, /"logPath"/, 'failure output must carry the compose log path');
  assert.match(result.stderr, /"journal"/, 'failure output must carry the bounded journal excerpt');
  await assertLockReleased(lockPath, lockLog);
  console.log('up-nonzero-recovery-failure: ok');
}

async function main() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  writeDockerStub();
  setupFakeContainerRoot();
  const server = await startStubServer();
  try {
    await runSkipOnEvidence(server);
    await runForceRebuild(server);
    await runForceEnvOverride(server);
    await runTimeoutLockRelease(server);
    await runUpNonzeroCreatedRecovery(server);
    await runUpNonzeroRecoveryFailure(server);
  } finally {
    server.child.kill();
    delete process.env.LOOPARR_STUB_COMPOSE_MODE;
    process.env.PATH = ORIGINAL_PATH;
    fs.rmSync(E2E_DIR, { recursive: true, force: true });
  }
  console.log('test-restart-looparr: ok');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
  process.env.PATH = ORIGINAL_PATH;
  fs.rmSync(E2E_DIR, { recursive: true, force: true });
});
