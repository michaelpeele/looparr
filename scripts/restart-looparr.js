'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const autoResume = require('../src/auto-resume');
const planLib = require('../src/plan');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_WRAPPER = path.join(__dirname, 'restart-lock.sh');
const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = (
  process.env.LOOPARR_BASE_URL ||
  `http://127.0.0.1:${process.env.LOOPARR_LOCAL_PORT || '4188'}`
).replace(/\/$/, '');

const DOCKER_COMMAND = 'docker compose build looparr && docker compose up -d looparr';
const RESTART_CONTINUE_FILE = (
  process.env.LOOPARR_RESTART_CONTINUE_FILE ||
  path.join(REPO_ROOT, '.looparr', 'restart-continue.json')
);
const RESTART_CONTINUE_MESSAGE = 'Restart complete continue.';

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

const SYSTEMD_UNIT = 'looparr-promote';
const SYSTEMD_PROBE_UNIT = 'looparr-promote-probe';
const DETACHED_WRAPPER = `trap '' HUP INT TERM QUIT\n${DOCKER_COMMAND}`;
let cachedSystemdRunAvailable;

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

function buildSystemdRunArgs() {
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
  args.push('--', 'bash', '-c', DOCKER_COMMAND);
  return args;
}

function logPromotionExecutionPath(executor) {
  reportEvent('promotion-execution-path', { executor });
  console.log(`[looparr] Promotion execution path: ${executor}`);
}

// Run the compose rebuild/recreate outside the requesting agent cgroup when a
// user systemd manager is available. The transient unit survives agent-session
// SIGKILL/cgroup cleanup between container creation and start. When systemd-run
// is unavailable, fall back to the detached signal-ignoring bash wrapper.
// The parent still waits on the child and runs the normal post-restart checks.
function runDetachedDockerCommand() {
  const executor = systemdRunAvailable() ? 'systemd-run' : 'detached-spawn';
  logPromotionExecutionPath(executor);

  const result = executor === 'systemd-run'
    ? spawnSync('systemd-run', buildSystemdRunArgs(), {
      cwd: REPO_ROOT,
      stdio: 'inherit'
    })
    : spawnSync('bash', ['-c', DETACHED_WRAPPER], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      detached: true
    });

  if (result.error) {
    const wrapped = new Error(`Docker command failed (${executor}): ${result.error.message}`);
    wrapped.status = result.status ?? null;
    throw wrapped;
  }
  if (result.status !== 0) {
    const wrapped = new Error(`Docker rebuild/recreate exited ${result.status ?? 'unknown'}.`);
    wrapped.status = result.status ?? null;
    throw wrapped;
  }
}

function isRunningHealthy(status) {
  const lines = String(status).split('\n').filter(Boolean);
  if (lines.length < 2) return false;
  const row = lines.slice(1).join('\n');
  return /(^|\s)(running|up)(\s|$)/i.test(row) && /healthy/i.test(row);
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

function recoverCreatedContainer(phase) {
  const containerState = inspectLooparrState();
  if (containerState === 'running') return true;
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
      return true;
    }
    sleep(2000);
  }
  showLooparrLogs(`container did not start after ${phase}`);
  return false;
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
    process.exitCode = 1;
    return;
  }

  console.log(`[looparr] Docker command: ${DOCKER_COMMAND}`);
  if (DRY_RUN) {
    console.log('[looparr] Dry run: Docker was not called.');
    return;
  }

  writeRestartContinueMarker();
  console.log('[looparr] Rebuilding and recreating looparr');
  try {
    runDetachedDockerCommand();
  } catch (error) {
    removeRestartContinueMarker();
    console.error(`[looparr] Docker command failed (${error.status ?? 'unknown'}).`);
    reportError('DOCKER_RESTART_FAILED', 'docker rebuild failed', {
      status: error.status ?? null
    });
    process.exitCode = 1;
    return;
  }

  if (!recoverCreatedContainer('post-compose')) {
    removeRestartContinueMarker();
    console.error('[looparr] Container recovery failed after rebuild.');
    reportError('CONTAINER_RECOVERY_FAILED', 'could not start looparr after compose', {
      phase: 'post-compose'
    });
    process.exitCode = 1;
    return;
  }

  let ready = await waitForRestart('post-restart');
  if (!ready && recoverCreatedContainer('post-restart')) {
    ready = await waitForRestart('post-restart recovery');
  }
  if (!ready) {
    console.error('[looparr] Restart check timed out. Check the container manually.');
    reportError('RESTART_TIMEOUT', 'restart check timed out', { phase: 'post-restart' });
    process.exitCode = 1;
    return;
  }
  console.log('[looparr] API and container health check passed.');

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
    process.exitCode = 1;
    return;
  }

  if (clearStaleIntents(staleAfterRestart)) {
    console.log('[looparr] Cleared stale resume intent after restart.');
    reportEvent('stale-intent-cleared', { count: staleAfterRestart.length, phase: 'post-restart' });
  }

  console.log('[looparr] Complete the served-asset and container-content checks from plan.md.');
}

if (require.main === module) {
  if (!runLockWrapper()) {
    main().catch((error) => {
      console.error(`[looparr] ${error.message}`);
      reportError('UNEXPECTED_ERROR', error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  DOCKER_COMMAND,
  SYSTEMD_UNIT,
  buildSystemdRunArgs,
  logPromotionExecutionPath,
  resetSystemdRunProbeCache,
  runDetachedDockerCommand,
  systemdRunAvailable
};
