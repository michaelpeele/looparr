'use strict';

const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const autoResume = require('../src/auto-resume');
const planLib = require('../src/plan');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_WRAPPER = path.join(__dirname, 'restart-lock.sh');
const WATCHDOG_SCRIPT = path.join(__dirname, 'restart-watchdog.sh');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE =
  process.argv.includes('--force') ||
  process.env.LOOPARR_FORCE_PROMOTION === '1';
const BASE_URL = (
  process.env.LOOPARR_BASE_URL ||
  `http://127.0.0.1:${process.env.LOOPARR_LOCAL_PORT || '4188'}`
).replace(/\/$/, '');

// Compose runs as two distinct phases inside the same restart lock and
// looparr-promote unit: a build phase bounded by COMPOSE_TIMEOUT_SECONDS, then
// an up phase bounded by the shorter UP_TIMEOUT_SECONDS deadline. Splitting the
// phases lets a hung `docker compose up -d looparr` fail fast (well under the
// 900s lock window) instead of holding the lock for the full build timeout.
const BUILD_COMMAND = 'docker compose build looparr';
const UP_KILL_AFTER_SECONDS = 30;
const UP_TIMEOUT_SECONDS = Number(
  process.env.LOOPARR_UP_TIMEOUT_SECONDS || '300'
);
// Per-invocation compose logs live under .looparr/logs so a failed phase leaves
// a durable, bounded tail on disk even when the transient unit's journal is
// empty (the observed 2026-11-26 incident).
const COMPOSE_LOG_DIR =
  process.env.LOOPARR_COMPOSE_LOG_DIR ||
  path.join(REPO_ROOT, '.looparr', 'logs');
const RESTART_CONTINUE_FILE = (
  process.env.LOOPARR_RESTART_CONTINUE_FILE ||
  path.join(REPO_ROOT, '.looparr', 'restart-continue.json')
);
const RESTART_CONTINUE_MESSAGE = 'Restart complete continue.';
const CONTAINER_START_TIMEOUT_SECONDS = Number(
  process.env.LOOPARR_CONTAINER_START_TIMEOUT_SECONDS || '60'
);
const HEALTHY_STATUS_PATTERN = /(?:\((?:health:\s*)?healthy\)|(?:\s|^)healthy(?:\s|$))/i;

// Build deadline must stay below the restart-lock timeout (default 900) so a
// hung build phase times out, releases the lock, and leaves a terminal status.
const COMPOSE_TIMEOUT_SECONDS = Number(
  process.env.LOOPARR_COMPOSE_TIMEOUT_SECONDS || '600'
);
const LOCK_TIMEOUT_SECONDS = Number(
  process.env.LOOPARR_RESTART_LOCK_TIMEOUT || '900'
);

// The up-only deadline wraps just `docker compose up -d looparr` in
// `timeout --signal=TERM --kill-after=30s <deadline>s`. It must stay below
// LOCK_TIMEOUT_SECONDS so a hung recreate cannot hold the lock for the full
// window. The outer spawnSync cap for the up phase is the deadline plus the
// kill-after grace and a small margin, so the inner `timeout` always fires
// first and the outer cap is only a backstop.
function upCommand(deadlineSeconds = UP_TIMEOUT_SECONDS) {
  return `timeout --signal=TERM --kill-after=${UP_KILL_AFTER_SECONDS}s ${deadlineSeconds}s docker compose up -d looparr`;
}
function upPhaseTimeoutSeconds() {
  return Math.max(1, UP_TIMEOUT_SECONDS) + UP_KILL_AFTER_SECONDS + 30;
}

const PROMOTION_STATUS_FILE =
  process.env.LOOPARR_PROMOTION_STATUS_FILE ||
  path.join(REPO_ROOT, '.looparr', 'promotion-status.json');
const PROMOTION_LOG_FILE =
  process.env.LOOPARR_PROMOTION_LOG_FILE ||
  path.join(REPO_ROOT, '.looparr', 'logs', 'promotion-latest.log');

const SOURCE_MANIFEST_DIRS = ['src', 'public', 'scripts'];
const SOURCE_MANIFEST_FILES = [
  'package.json',
  'docker-compose.yml',
  'Dockerfile',
  '.dockerignore'
];
// Files the Docker build copies into /app; everything else in the manifest is
// build-context-only and cannot be compared against the container filesystem.
const CONTAINER_COMPARABLE_PATTERN = /^(?:src|public|scripts)\//;
const SERVED_ASSETS = [
  ['/', 'public/index.html'],
  ['/app.js', 'public/app.js'],
  ['/styles.css', 'public/styles.css'],
  ['/favicon.svg', 'public/favicon.svg']
];
const DIAGNOSTICS_MAX_CHARS = 16000;

function reportEvent(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function reportError(code, message, details = {}) {
  console.error(JSON.stringify({ event: 'error', code, message, ...details }));
}

function runLockWrapper() {
  if (process.env.LOOPARR_RESTART_LOCK_HELD === '1') return false;
  const wrapped = spawnSync(
    'bash',
    [LOCK_WRAPPER, process.execPath, __filename, ...process.argv.slice(2)],
    { cwd: REPO_ROOT, stdio: 'inherit' }
  );
  if (wrapped.error) {
    console.error(`[looparr] Lock wrapper failed: ${wrapped.error.message}`);
    reportError('LOCK_WRAPPER_FAILED', wrapped.error.message);
    process.exit(1);
  }
  process.exit(wrapped.status ?? 1);
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getState() {
  const res = await fetch(`${BASE_URL}/api/state`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/state failed (${res.status})`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Promotion status artifact
// ---------------------------------------------------------------------------

let promotionStatus = null;

function defaultPromotionStatus(runId, startedAt) {
  return {
    runId,
    startedAt,
    finishedAt: null,
    phase: 'start',
    result: 'running',
    executor: null,
    unit: null,
    invocationId: null,
    imageId: null,
    containerId: null,
    sourceHashSummary: null,
    servedHashSummary: null,
    apiStateOk: null,
    watchdogOk: null,
    skipReason: null,
    error: null,
    logPath: PROMOTION_LOG_FILE,
    upStartedAt: null,
    recovery: [],
    diagnostics: null
  };
}

function writePromotionStatus(status = promotionStatus, statusFile = PROMOTION_STATUS_FILE) {
  if (!status) return null;
  const dir = path.dirname(statusFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.promotion-status.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, statusFile);
  return status;
}

function updatePromotionStatus(patch, statusFile = PROMOTION_STATUS_FILE) {
  if (!promotionStatus) return;
  Object.assign(promotionStatus, patch);
  writePromotionStatus(promotionStatus, statusFile);
}

function teeConsoleToLog(logFile = PROMOTION_LOG_FILE) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const tee = (original) => (...args) => {
    try {
      const line = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      fs.appendFileSync(logFile, `${line}\n`);
    } catch { /* logging must never break the run */ }
    original(...args);
  };
  console.log = tee(console.log);
  console.error = tee(console.error);
}

function startPromotionRun(statusFile = PROMOTION_STATUS_FILE, logFile = PROMOTION_LOG_FILE) {
  promotionStatus = defaultPromotionStatus(crypto.randomUUID(), new Date().toISOString());
  teeConsoleToLog(logFile);
  writePromotionStatus(promotionStatus, statusFile);

  const writeSignalStatus = (signal, code) => {
    updatePromotionStatus(
      {
        result: 'failed',
        error: `terminated by signal ${signal}`,
        finishedAt: new Date().toISOString()
      },
      statusFile
    );
    process.exit(code);
  };
  process.once('SIGINT', () => writeSignalStatus('SIGINT', 130));
  process.once('SIGTERM', () => writeSignalStatus('SIGTERM', 143));
  return promotionStatus;
}

function finishPromotionRun(statusFile = PROMOTION_STATUS_FILE) {
  if (!promotionStatus || promotionStatus.result !== 'running') return;
  updatePromotionStatus(
    {
      result: process.exitCode ? 'failed' : 'success',
      finishedAt: new Date().toISOString()
    },
    statusFile
  );
}

// ---------------------------------------------------------------------------
// Source manifest and evidence check
// ---------------------------------------------------------------------------

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function collectManifestFiles(repoRoot) {
  const entries = [];
  const walk = (dir) => {
    let files = [];
    try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of files) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) entries.push(abs);
    }
  };
  for (const rel of SOURCE_MANIFEST_DIRS) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const rel of SOURCE_MANIFEST_FILES) {
    const abs = path.join(repoRoot, rel);
    if (fs.existsSync(abs)) entries.push(abs);
  }
  return entries;
}

function computeSourceManifest(repoRoot = REPO_ROOT) {
  const absFiles = collectManifestFiles(repoRoot);
  const relFiles = absFiles
    .map((abs) => ({
      rel: path.relative(repoRoot, abs).split(path.sep).join('/'),
      abs
    }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const files = {};
  const combined = crypto.createHash('sha256');
  for (const { rel, abs } of relFiles) {
    const hash = sha256Buffer(fs.readFileSync(abs));
    files[rel] = hash;
    combined.update(`${rel} ${hash}\n`);
  }
  return { fileCount: relFiles.length, combinedHash: combined.digest('hex'), files };
}

function isContainerComparablePath(rel) {
  return CONTAINER_COMPARABLE_PATTERN.test(rel) || rel === 'package.json';
}

// Root-owned scripts in the container need `-u 0` to be readable; one exec
// hashes every manifest path so the evidence check stays bounded.
function readContainerHashes(relPaths) {
  const paths = (relPaths || []).filter((rel) => isContainerComparablePath(rel));
  if (paths.length === 0) return { ok: true, hashes: {} };
  const script = `cd /app && sha256sum ${paths.map((p) => `'${p}'`).join(' ')} 2>/dev/null`;
  const result = spawnSync(
    'docker',
    ['exec', '-u', '0', 'looparr', 'sh', '-c', script],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }
  );
  if (result.error) {
    return { ok: false, hashes: {}, error: result.error.message };
  }
  const hashes = {};
  for (const line of String(result.stdout || '').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) hashes[m[2]] = m[1];
  }
  // sha256sum exits nonzero when any listed file is missing but still hashes
  // the rest; only an empty result means the container filesystem is unreadable.
  if (result.status !== 0 && Object.keys(hashes).length === 0) {
    return { ok: false, hashes: {}, error: `exit ${result.status}` };
  }
  return { ok: true, hashes };
}

async function readServedHashes(baseUrl = BASE_URL, fetchImpl = fetch, repoRoot = REPO_ROOT) {
  const hashes = {};
  for (const [urlPath, localRel] of SERVED_ASSETS) {
    const localFile = path.join(repoRoot, localRel);
    if (!fs.existsSync(localFile)) continue;
    try {
      const res = await fetchImpl(`${baseUrl}${urlPath}`);
      if (!res.ok) return { ok: false, hashes, failedPath: urlPath };
      hashes[urlPath] = { localRel, hash: sha256Buffer(Buffer.from(await res.arrayBuffer())) };
    } catch (error) {
      return { ok: false, hashes, failedPath: urlPath, error: error.message };
    }
  }
  return { ok: true, hashes };
}

function inspectLooparrDetails() {
  const result = spawnSync(
    'docker',
    ['inspect', 'looparr', '--format', '{{.Id}}\t{{.Image}}\t{{.State.Status}}\t{{.State.Health.Status}}'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }
  );
  if (result.error || result.status !== 0) return null;
  const [containerId, imageId, state, health] = String(result.stdout || '').trim().split('\t');
  if (!containerId || !state) return null;
  return { containerId, imageId: imageId || null, state, health: health || null };
}

function evaluatePromotionEvidence(evidence) {
  const failures = [];
  if (!evidence) return { ok: false, failures: ['evidence-missing'] };
  const container = evidence.container;
  if (!container || container.state !== 'running' || container.health !== 'healthy') {
    failures.push('container-not-running-healthy');
  }
  const apiState = evidence.apiState;
  if (
    !apiState ||
    typeof apiState !== 'object' ||
    !('projects' in apiState) ||
    !('settings' in apiState)
  ) {
    failures.push('api-state-invalid');
  }
  if (!evidence.containerHashReadOk) {
    failures.push('container-hashes-unreadable');
  } else {
    for (const [rel, hash] of Object.entries(evidence.manifest?.files || {})) {
      if (!isContainerComparablePath(rel)) continue;
      const containerHash = evidence.containerHashes?.[rel];
      if (containerHash === undefined) failures.push(`container-missing:${rel}`);
      else if (containerHash !== hash) failures.push(`container-hash-mismatch:${rel}`);
    }
  }
  const served = evidence.served;
  if (!served || !served.ok) failures.push('served-assets-unavailable');
  else {
    for (const [urlPath, info] of Object.entries(served.hashes || {})) {
      const localHash = evidence.manifest?.files?.[info.localRel];
      if (!localHash || localHash !== info.hash) failures.push(`served-hash-mismatch:${urlPath}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

async function gatherPromotionEvidence(manifest, deps = {}) {
  const getStateFn = deps.getState || getState;
  const fetchImpl = deps.fetchImpl || fetch;
  const baseUrl = deps.baseUrl || BASE_URL;
  const container = deps.inspect ? deps.inspect() : inspectLooparrDetails();
  let apiState = null;
  try { apiState = await getStateFn(); } catch { apiState = null; }
  const containerHashes = deps.readContainerHashes
    ? deps.readContainerHashes(Object.keys(manifest.files))
    : readContainerHashes(Object.keys(manifest.files));
  const served = await readServedHashes(baseUrl, fetchImpl, deps.repoRoot || REPO_ROOT);
  return {
    manifest,
    container,
    containerHashes: containerHashes.hashes,
    containerHashReadOk: containerHashes.ok,
    served,
    apiState
  };
}

function servedHashSummary(evidence) {
  if (!evidence?.served?.ok) return null;
  const entries = Object.entries(evidence.served.hashes || {});
  if (entries.length === 0) return null;
  const combined = crypto.createHash('sha256');
  for (const [urlPath, info] of entries) combined.update(`${urlPath} ${info.hash}\n`);
  return { fileCount: entries.length, combinedHash: combined.digest('hex') };
}

// ---------------------------------------------------------------------------
// Compose execution (bounded), diagnostics, recovery
// ---------------------------------------------------------------------------

const SYSTEMD_UNIT = 'looparr-promote';
const SYSTEMD_PROBE_UNIT = 'looparr-promote-probe';
let cachedSystemdRunAvailable;

// The detached fallback ignores HUP/INT/TERM/QUIT around a single phase command
// so the compose child survives a group-wide signal even if detachment is not
// honoured on some platform. Each phase gets its own wrapper instance.
function detachedWrapper(command) {
  return `trap '' HUP INT TERM QUIT\n${command}`;
}

// Wrap a phase's compose command so its stdout+stderr are captured to a
// per-invocation log under .looparr/logs and the phase exit code is preserved
// through the pipe. `timeout` (used only for the up phase) returns 124/137 when
// its deadline fires, which the parent treats as an up timeout.
function buildPhaseCommand(innerCommand, logPath) {
  return 'set -o pipefail; ' + innerCommand + ' 2>&1 | tee ' + JSON.stringify(logPath);
}

function systemdRunPath() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'systemd-run');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* ignore */ }
  }
  return '';
}

function runSystemdProbe() {
  const systemdRun = systemdRunPath();
  if (!systemdRun) return false;
  const probe = spawnSync(
    systemdRun,
    ['--user', '--wait', '--collect', `--unit=${SYSTEMD_PROBE_UNIT}`, '--', 'true'],
    { cwd: REPO_ROOT, stdio: 'ignore' }
  );
  return !probe.error && probe.status === 0;
}

function systemdRunAvailable() {
  if (cachedSystemdRunAvailable === undefined) {
    cachedSystemdRunAvailable = runSystemdProbe();
  }
  return cachedSystemdRunAvailable;
}

function resetSystemdRunProbeCache() {
  cachedSystemdRunAvailable = undefined;
}

function buildSystemdRunArgs(command) {
  const args = [
    '--user',
    `--unit=${SYSTEMD_UNIT}`,
    '--wait',
    '--collect',
    '-p',
    `WorkingDirectory=${REPO_ROOT}`
  ];
  for (const key of ['PATH', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
    const value = process.env[key];
    if (value) args.push(`--setenv=${key}=${value}`);
  }
  args.push('--', 'bash', '-c', command);
  return args;
}

function logPromotionExecutionPath(executor) {
  reportEvent('promotion-execution-path', { executor });
  console.log(`[looparr] Promotion execution path: ${executor}`);
}

function stopPromoteUnit() {
  // Best effort: the transient unit must not keep composing after a timeout.
  spawnSync('systemctl', ['--user', 'stop', `${SYSTEMD_UNIT}.service`], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
}

function killDetachedComposeChildren() {
  // The detached wrapper ignores TERM and may be SIGKILLed by the timeout;
  // make sure no orphaned compose process keeps rebuilding looparr.
  spawnSync('pkill', ['-KILL', '-f', 'docker compose (build|up)( -d)? looparr'], {
    cwd: REPO_ROOT,
    stdio: 'ignore'
  });
}

// Run one compose phase (build or up) outside the requesting agent cgroup when
// a user systemd manager is available. The transient unit survives agent-session
// SIGKILL/cgroup cleanup between container creation and start. When systemd-run
// is unavailable, fall back to the detached signal-ignoring bash wrapper. The
// parent still waits on the child and runs the normal post-restart checks.
// Returns a structured result; never throws. The caller decides recovery.
function runComposePhase({ executor, phase, innerCommand, timeoutSeconds, logPath }) {
  const command = buildPhaseCommand(innerCommand, logPath);
  const timeoutMs = Math.max(1, timeoutSeconds) * 1000;
  console.log(`[looparr] compose ${phase}: deadline ${timeoutSeconds}s, log ${logPath}`);
  const result = executor === 'systemd-run'
    ? spawnSync('systemd-run', buildSystemdRunArgs(command), {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    })
    : spawnSync('bash', ['-c', detachedWrapper(command)], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      detached: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    });

  const spawnTimedOut = result.error?.code === 'ETIMEDOUT'
    || (!result.error && result.status === null && result.signal === 'SIGKILL');
  const exitStatus = result.error ? null : result.status ?? null;
  // `timeout` exits 124 (TERM) or 137 (KILL) when the up deadline fires.
  const innerTimedOut = exitStatus === 124 || exitStatus === 137;
  const timedOut = spawnTimedOut || innerTimedOut;
  if (timedOut) {
    if (executor === 'systemd-run') stopPromoteUnit();
    else killDetachedComposeChildren();
  }
  return {
    ok: !result.error && result.status === 0,
    timedOut,
    status: exitStatus,
    executor,
    phase,
    logPath,
    command,
    error: result.error ? result.error.message : null
  };
}

function phaseError(result) {
  const base = result.timedOut
    ? `Docker ${result.phase} timed out after ${result.status === 124 || result.status === 137 ? UP_TIMEOUT_SECONDS : COMPOSE_TIMEOUT_SECONDS}s (executor: ${result.executor}).`
    : `Docker ${result.phase} exited ${result.status ?? 'unknown'} (executor: ${result.executor}).`;
  const wrapped = new Error(result.error ? `${base} ${result.error}` : base);
  wrapped.phase = result.phase;
  wrapped.status = result.status;
  wrapped.timedOut = result.timedOut;
  wrapped.executor = result.executor;
  wrapped.startedAt = result.startedAt;
  wrapped.logPath = result.logPath;
  wrapped.command = result.command;
  return wrapped;
}

// Run the compose rebuild (build phase) then recreate (up phase) as two
// distinct, separately-bounded phases inside the same restart lock and
// looparr-promote unit. Throws a phase-tagged error on the first failed phase
// so the caller can run phase-specific recovery without losing the source phase.
function runDetachedDockerCommand(options = {}) {
  const executor = systemdRunAvailable() ? 'systemd-run' : 'detached-spawn';
  logPromotionExecutionPath(executor);
  updatePromotionStatus({
    executor,
    unit: executor === 'systemd-run' ? SYSTEMD_UNIT : null
  });

  const runId = options.runId || promotionStatus?.runId || 'run';
  const logsDir = options.logsDir || COMPOSE_LOG_DIR;
  fs.mkdirSync(logsDir, { recursive: true });
  const buildLog = path.join(logsDir, `compose-build-${runId}.log`);
  const upLog = path.join(logsDir, `compose-up-${runId}.log`);

  const build = runComposePhase({
    executor,
    phase: 'build',
    innerCommand: BUILD_COMMAND,
    timeoutSeconds: COMPOSE_TIMEOUT_SECONDS,
    logPath: buildLog
  });
  if (!build.ok) throw phaseError(build);

  const upStartedAt = new Date().toISOString();
  updatePromotionStatus({ upStartedAt });
  const up = runComposePhase({
    executor,
    phase: 'up',
    innerCommand: upCommand(),
    timeoutSeconds: upPhaseTimeoutSeconds(),
    logPath: upLog
  });
  if (!up.ok) {
    up.startedAt = upStartedAt;
    throw phaseError(up);
  }
  return { build, up };
}

function dockerStatus() {
  try {
    return execSync('docker compose ps looparr', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return '';
  }
}

function runDockerInspectFull() {
  const result = spawnSync('docker', ['inspect', 'looparr'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15000
  });
  const out = String(result.stdout || '');
  return out.slice(0, DIAGNOSTICS_MAX_CHARS) || `exit ${result.status ?? 'unknown'}`;
}

function runDockerJournal(sinceIso) {
  const result = spawnSync(
    'journalctl',
    ['-u', 'docker.service', '--since', sinceIso, '--no-pager', '-n', '200'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }
  );
  const out = String(result.stdout || '');
  return out.slice(0, DIAGNOSTICS_MAX_CHARS) || `exit ${result.status ?? 'unknown'}`;
}

// Bounded tail of a per-invocation compose log. The log lives on disk so it
// survives even when the transient unit's journal is empty.
function readLogTail(logPath, maxLines = 40) {
  if (!logPath) return '';
  try {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter((line) => line.length > 0);
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

// Bounded failure evidence for the promotion log/status: compose ps, container
// inspect, the docker daemon journal since the phase started, and the failed
// phase's compose log tail (with its path).
function collectFailureDiagnostics(phase, options = {}) {
  const startedAt = options.startedAt || promotionStatus?.startedAt || new Date().toISOString();
  const composePs = options.dockerPs ? options.dockerPs() : dockerStatus();
  const inspect = options.inspect ? options.inspect() : runDockerInspectFull();
  const journal = options.journal ? options.journal(startedAt) : runDockerJournal(startedAt);
  const logPath = options.logPath || null;
  const logTail = options.logTail !== undefined ? options.logTail : readLogTail(logPath);
  const diagnostics = { phase, composePs, inspect, journal, logPath, logTail };
  console.error(`[looparr] Failure diagnostics (phase: ${phase}):`);
  console.error(`[looparr] docker compose ps looparr:\n${composePs || '(unavailable)'}`);
  console.error(`[looparr] docker inspect looparr (bounded):\n${inspect}`);
  if (logPath) {
    console.error(`[looparr] compose ${phase} log (${logPath}):\n${logTail || '(empty)'}`);
  }
  console.error(`[looparr] journalctl -u docker.service excerpt (bounded):\n${journal}`);
  return diagnostics;
}

function isRunningHealthy(status) {
  const lines = String(status).split('\n').filter(Boolean);
  if (lines.length < 2) return false;
  const row = lines.slice(1).join('\n');
  return /(^|\s)(running|up)(\s|$)/i.test(row)
    && HEALTHY_STATUS_PATTERN.test(row)
    && !/\b(unhealthy|starting|unknown)\b/i.test(row);
}

async function waitForContainerHealthy(phase) {
  const attempts = Math.max(1, Math.ceil(CONTAINER_START_TIMEOUT_SECONDS * 1000 / 2000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isRunningHealthy(dockerStatus())) return true;
    await sleep(2000);
  }
  return false;
}

async function waitForRestart(label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let apiOk = false;
    try {
      await getState();
      apiOk = true;
    } catch { /* retry */ }
    const status = dockerStatus();
    if (apiOk && isRunningHealthy(status)) return true;
    if (attempt === 0 || attempt % 10 === 0) {
      console.log(`[looparr] ${label}: waiting for API and container health...`);
    }
    await sleep(2000);
  }
  return false;
}

function inspectLooparrState() {
  const result = spawnSync(
    'docker',
    ['inspect', 'looparr', '--format', '{{.State.Status}}'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  if (result.error || result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function showLooparrLogs(reason) {
  console.error(`[looparr] ${reason}; last container logs:`);
  const result = spawnSync('docker', ['logs', '--tail', '60', 'looparr'], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });
  if (result.error) console.error(`[looparr] docker logs failed: ${result.error.message}`);
}

async function recoverCreatedContainer(phase) {
  const containerState = inspectLooparrState();
  if (containerState === 'running') {
    if (await waitForContainerHealthy(phase)) return true;
    showLooparrLogs(`container not healthy after ${phase}`);
    return false;
  }
  if (!['created', 'exited', 'dead'].includes(containerState)) return false;

  console.log(`[looparr] ${phase}: looparr container is ${containerState}; attempting one start.`);
  const start = spawnSync('docker', ['compose', 'start', 'looparr'], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  });
  if (start.error || start.status !== 0) {
    showLooparrLogs(`container start failed (${start.status ?? 'unknown'})`);
    return false;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (inspectLooparrState() === 'running') {
      console.log(`[looparr] ${phase}: container started.`);
      if (await waitForContainerHealthy(phase)) return true;
      showLooparrLogs(`container not healthy after ${phase}`);
      return false;
    }
    await sleep(2000);
  }
  showLooparrLogs(`container did not start after ${phase}`);
  return false;
}

function runWatchdogCheck() {
  // Read-only check: exit 0 when a looparr container is running. Never mutates
  // and never takes the restart lock.
  const result = spawnSync('bash', [WATCHDOG_SCRIPT, 'check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000
  });
  const ok = !result.error && result.status === 0;
  if (!ok) {
    console.error(`[looparr] Watchdog check reported down (exit ${result.status ?? 'unknown'}).`);
  } else {
    console.log('[looparr] Watchdog check: looparr container is running.');
  }
  return { ok, status: result.status ?? null };
}

// One-shot recovery: existing created/exited/dead recovery first; if the
// container is still not healthy, one pass of the watchdog fix. The restart
// lock is already held here, and the watchdog honours LOOPARR_RESTART_LOCK_HELD.
async function runWatchdogFixRecovery(phase) {
  console.log(`[looparr] ${phase}: running one-shot watchdog recovery.`);
  const fix = spawnSync('bash', [WATCHDOG_SCRIPT, 'fix'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    timeout: 300000,
    env: { ...process.env, LOOPARR_RESTART_LOCK_HELD: '1' }
  });
  const fixOk = !fix.error && fix.status === 0;
  const attempts = [{
    attempt: 'watchdog-fix',
    phase,
    ok: fixOk,
    status: fix.error ? null : fix.status ?? 0,
    error: fix.error ? fix.error.message : null
  }];
  let healthy = false;
  let apiStateOk = false;
  if (fixOk) {
    healthy = await recoverCreatedContainer(`${phase}-watchdog`);
    attempts.push({ attempt: 'recoverCreatedContainer', phase: `${phase}-watchdog`, ok: healthy });
    try {
      await getState();
      apiStateOk = true;
    } catch { apiStateOk = false; }
  }
  return { healthy, apiStateOk, attempts };
}

async function runPostComposeRecovery(phase) {
  const attempts = [];
  const healthy = await recoverCreatedContainer(phase);
  attempts.push({ attempt: 'recoverCreatedContainer', phase, ok: healthy });
  let apiStateOk = false;
  try {
    await getState();
    apiStateOk = true;
  } catch { apiStateOk = false; }
  if (!healthy || !apiStateOk) {
    const fix = await runWatchdogFixRecovery(phase);
    attempts.push(...fix.attempts);
    return { healthy: fix.healthy, apiStateOk: fix.apiStateOk, attempts };
  }
  return { healthy, apiStateOk, attempts };
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

function writeRestartContinueMarker() {
  fs.mkdirSync(path.dirname(RESTART_CONTINUE_FILE), { recursive: true });
  fs.writeFileSync(
    RESTART_CONTINUE_FILE,
    `${JSON.stringify({ message: RESTART_CONTINUE_MESSAGE, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
}

function removeRestartContinueMarker() {
  try { fs.unlinkSync(RESTART_CONTINUE_FILE); } catch { /* no marker */ }
}

function planNextTask(project) {
  const plan = planLib.readPlan(project.path);
  return plan.ok && plan.next ? plan.next.text : null;
}

function collectStaleIntents(projects) {
  const stale = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project.autoResumePending || !project.id || !project.path) continue;
    const checked = autoResume.readIntent({ id: project.id, path: project.path });
    if (!checked.ok) continue;
    const nextTask = planNextTask(project);
    if (nextTask && checked.intent.currentTask !== nextTask) {
      stale.push({ project, intent: checked.intent, nextTask });
    }
  }
  return stale;
}

function clearStaleIntents(stale) {
  if (stale.length === 0) return false;
  for (const item of stale) {
    console.log(`[looparr] Stale resume intent for ${item.project.id}; clearing it.`);
    autoResume.clearIntent(item.project);
  }
  return true;
}

async function main() {
  console.log('[looparr] Checking current Looparr instance');
  await recoverCreatedContainer('preflight');

  let state;
  let preflightError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      state = await getState();
      preflightError = null;
      break;
    } catch (error) {
      preflightError = error;
      if (attempt < 29) await sleep(2000);
    }
  }
  if (preflightError || !state) {
    const message = preflightError?.message || 'API not ready after container recovery';
    console.error(`[looparr] Preflight failed: ${message}`);
    console.error('[looparr] No rebuild started. Start Looparr and retry.');
    reportError('PREFLIGHT_FAILED', message);
    updatePromotionStatus({
      phase: 'preflight',
      result: 'failed',
      error: message,
      finishedAt: new Date().toISOString()
    });
    process.exitCode = 1;
    return;
  }

  try {
    const state = await getState();
    if (clearStaleIntents(collectStaleIntents(state.projects))) {
      console.log('[looparr] Cleared stale intents before restart.');
    }
  } catch (error) {
    console.error(`[looparr] Stale intent check failed: ${error.message}`);
    console.error('[looparr] No rebuild started.');
    reportError('STALE_INTENT_CHECK_FAILED', error.message);
    updatePromotionStatus({
      phase: 'stale-intent-check',
      result: 'failed',
      error: error.message,
      finishedAt: new Date().toISOString()
    });
    process.exitCode = 1;
    return;
  }

  // Pre-promote evidence check: skip the rebuild when the running container
  // already serves the current source. Never fails the dry-run path.
  updatePromotionStatus({ phase: 'evidence-check' });
  const manifest = computeSourceManifest();
  let evidence = null;
  let evidenceError = null;
  try {
    evidence = await gatherPromotionEvidence(manifest);
  } catch (error) {
    evidenceError = error;
  }
  const verdict = evaluatePromotionEvidence(evidence);
  updatePromotionStatus({
    phase: 'evidence-check',
    sourceHashSummary: { fileCount: manifest.fileCount, combinedHash: manifest.combinedHash },
    servedHashSummary: servedHashSummary(evidence),
    apiStateOk: Boolean(evidence?.apiState),
    imageId: evidence?.container?.imageId ?? null,
    containerId: evidence?.container?.containerId ?? null
  });
  if (evidenceError) {
    console.error(`[looparr] Evidence check failed: ${evidenceError.message}`);
    reportEvent('promotion-evidence', { ok: false, error: evidenceError.message });
  } else {
    reportEvent('promotion-evidence', { ok: verdict.ok, failures: verdict.failures });
    console.log(
      verdict.ok
        ? '[looparr] Evidence check: current source is already deployed and healthy.'
        : `[looparr] Evidence check: rebuild needed (${verdict.failures.slice(0, 5).join(', ')}).`
    );
  }

  if (!DRY_RUN && verdict.ok && !FORCE) {
    console.log('[looparr] Skipping rebuild: current source already deployed (use --force to rebuild).');
    updatePromotionStatus({
      phase: 'skip-evidence',
      result: 'skipped',
      skipReason: 'skipped-already-deployed',
      finishedAt: new Date().toISOString()
    });
    return;
  }

  console.log(`[looparr] Docker build: ${BUILD_COMMAND}`);
  console.log(`[looparr] Docker up: ${upCommand()}`);
  if (DRY_RUN) {
    console.log('[looparr] Dry run: Docker was not called.');
    updatePromotionStatus({
      phase: 'dry-run',
      finishedAt: new Date().toISOString()
    });
    return;
  }

  writeRestartContinueMarker();
  console.log('[looparr] Rebuilding and recreating looparr');
  updatePromotionStatus({ phase: 'compose' });
  try {
    runDetachedDockerCommand({ runId: promotionStatus.runId });
  } catch (error) {
    removeRestartContinueMarker();
    const timedOut = Boolean(error.timedOut);
    const phase = error.phase || 'compose';
    const recoveryPhase = phase === 'up' ? 'up' : 'post-compose';
    console.error(`[looparr] Docker ${phase} failed (${error.status ?? 'unknown'}): ${error.message}`);
    if (timedOut && error.executor !== 'detached-spawn') stopPromoteUnit();
    const diagnostics = collectFailureDiagnostics(phase, {
      startedAt: error.startedAt,
      logPath: error.logPath
    });
    const recovery = await runPostComposeRecovery(recoveryPhase);
    updatePromotionStatus({
      phase,
      result: 'failed',
      error: error.message,
      diagnostics,
      recovery: recovery.attempts,
      finishedAt: new Date().toISOString()
    });
    reportError('DOCKER_RESTART_FAILED', `docker ${phase} failed`, {
      status: error.status ?? null,
      phase,
      timedOut,
      containerState: inspectLooparrState(),
      logPath: error.logPath,
      journal: diagnostics.journal
    });
    process.exitCode = 1;
    return;
  }

  const postComposeAttempts = [];
  const postComposeHealthy = await recoverCreatedContainer('post-compose');
  postComposeAttempts.push({
    attempt: 'recoverCreatedContainer',
    phase: 'post-compose',
    ok: postComposeHealthy
  });
  let postComposeApiOk = false;
  try {
    await getState();
    postComposeApiOk = true;
  } catch { postComposeApiOk = false; }
  let recovered = { healthy: postComposeHealthy, apiStateOk: postComposeApiOk };
  if (!postComposeHealthy || !postComposeApiOk) {
    recovered = await runWatchdogFixRecovery('post-compose');
    postComposeAttempts.push(...recovered.attempts);
  }
  updatePromotionStatus({ recovery: postComposeAttempts });
  if (!recovered.healthy || !recovered.apiStateOk) {
    removeRestartContinueMarker();
    collectFailureDiagnostics('post-compose');
    console.error('[looparr] Container recovery failed after rebuild.');
    reportError('CONTAINER_RECOVERY_FAILED', 'could not start looparr after compose', {
      phase: 'post-compose'
    });
    updatePromotionStatus({
      phase: 'post-compose',
      result: 'failed',
      error: 'container recovery failed after compose',
      finishedAt: new Date().toISOString()
    });
    process.exitCode = 1;
    return;
  }

  let ready = await waitForRestart('post-restart');
  if (!ready && (await recoverCreatedContainer('post-restart'))) {
    ready = await waitForRestart('post-restart recovery');
  }
  if (!ready) {
    const fix = await runWatchdogFixRecovery('post-restart');
    updatePromotionStatus({ recovery: fix.attempts });
    if (fix.healthy && fix.apiStateOk) {
      ready = await waitForRestart('post-restart watchdog');
    }
  }
  if (!ready) {
    removeRestartContinueMarker();
    const diagnostics = collectFailureDiagnostics('post-restart');
    console.error('[looparr] Restart check timed out. Check the container manually.');
    reportError('RESTART_TIMEOUT', 'restart check timed out', { phase: 'post-restart' });
    updatePromotionStatus({
      phase: 'post-restart',
      result: 'failed',
      error: 'restart check timed out',
      diagnostics,
      finishedAt: new Date().toISOString()
    });
    process.exitCode = 1;
    return;
  }
  console.log('[looparr] API and container health check passed.');

  const details = inspectLooparrDetails();
  if (details) {
    updatePromotionStatus({ imageId: details.imageId, containerId: details.containerId });
  }

  let watchdog = runWatchdogCheck();
  if (!watchdog.ok) {
    console.log('[looparr] Watchdog check reports looparr down; running immediate fix pass.');
    const fix = await runWatchdogFixRecovery('post-promotion');
    watchdog = runWatchdogCheck();
    updatePromotionStatus({ watchdogFix: fix.attempts, watchdogOk: watchdog.ok });
  } else {
    updatePromotionStatus({ watchdogOk: watchdog.ok });
  }

  try {
    const executorUrl = process.env.LOOPARR_EXECUTOR_URL || 'http://127.0.0.1:4187';
    const envPath = path.join(REPO_ROOT, '.env');
    let token = '';
    if (fs.existsSync(envPath)) {
      const envText = fs.readFileSync(envPath, 'utf8');
      const m = envText.match(/^LOOPARR_EXECUTOR_TOKEN\s*=\s*(.+)$/m);
      if (m) token = m[1].trim().replace(/^['"]|['"]$/g, '');
    }
    if (token) {
      const activeRes = await fetch(`${executorUrl}/active`, { headers: { authorization: `Bearer ${token}` } });
      if (activeRes.ok) {
        const activeList = await activeRes.json();
        const looparrRuns = (Array.isArray(activeList) ? activeList : []).filter((a) => a && typeof a.cwd === 'string' && a.cwd.includes('looparr'));
        if (looparrRuns.length > 1) {
          console.error(`[looparr] ERROR: ${looparrRuns.length} active runs for looparr after restart`);
          process.exitCode = 1;
        } else {
          console.log(`[looparr] Active runs for looparr project/cwd: ${looparrRuns.length}`);
        }
      } else {
        console.error(`[looparr] Active check failed: HTTP ${activeRes.status}`);
      }
    } else {
      console.log('[looparr] Active-run postcheck skipped (no LOOPARR_EXECUTOR_TOKEN in .env)');
    }
  } catch (e) {
    console.error(`[looparr] Active-run postcheck failed: ${e.message}`);
  }

  let staleAfterRestart = [];
  try {
    const state = await getState();
    staleAfterRestart = collectStaleIntents(state.projects);
  } catch (error) {
    console.error(`[looparr] Post-restart intent check failed: ${error.message}`);
    reportError('POST_RESTART_INTENT_CHECK_FAILED', error.message);
    updatePromotionStatus({
      phase: 'post-restart-intent-check',
      result: 'failed',
      error: error.message,
      finishedAt: new Date().toISOString()
    });
    process.exitCode = 1;
    return;
  }

  if (clearStaleIntents(staleAfterRestart)) {
    console.log('[looparr] Cleared stale resume intent after restart.');
    reportEvent('stale-intent-cleared', { count: staleAfterRestart.length, phase: 'post-restart' });
  }

  updatePromotionStatus({ phase: 'done', finishedAt: new Date().toISOString() });
}

if (require.main === module) {
  if (!runLockWrapper()) {
    startPromotionRun();
    main()
      .then(() => finishPromotionRun())
      .catch((error) => {
        console.error(`[looparr] ${error.message}`);
        reportError('UNEXPECTED_ERROR', error.message);
        updatePromotionStatus({
          result: 'failed',
          error: error.message,
          finishedAt: new Date().toISOString()
        });
        process.exitCode = 1;
      });
  }
}

module.exports = {
  BUILD_COMMAND,
  COMPOSE_LOG_DIR,
  COMPOSE_TIMEOUT_SECONDS,
  CONTAINER_START_TIMEOUT_SECONDS,
  LOCK_TIMEOUT_SECONDS,
  PROMOTION_LOG_FILE,
  PROMOTION_STATUS_FILE,
  SERVED_ASSETS,
  SYSTEMD_UNIT,
  UP_TIMEOUT_SECONDS,
  buildPhaseCommand,
  buildSystemdRunArgs,
  collectFailureDiagnostics,
  computeSourceManifest,
  evaluatePromotionEvidence,
  finishPromotionRun,
  gatherPromotionEvidence,
  inspectLooparrDetails,
  isRunningHealthy,
  logPromotionExecutionPath,
  readContainerHashes,
  readLogTail,
  readServedHashes,
  recoverCreatedContainer,
  resetSystemdRunProbeCache,
  runComposePhase,
  runDetachedDockerCommand,
  runWatchdogCheck,
  servedHashSummary,
  startPromotionRun,
  systemdRunAvailable,
  updatePromotionStatus,
  upCommand,
  upPhaseTimeoutSeconds,
  writePromotionStatus
};
