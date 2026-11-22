'use strict';

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = (
  process.env.LOOPARR_BASE_URL ||
  `http://127.0.0.1:${process.env.LOOPARR_LOCAL_PORT || '4188'}`
).replace(/\/$/, '');

const DOCKER_COMMAND = 'docker compose build looparr && docker compose up -d looparr';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getState() {
  const res = await fetch(`${BASE_URL}/api/state`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/state failed (${res.status})`);
  return res.json();
}

async function prepare() {
  const res = await fetch(`${BASE_URL}/api/auto-resume/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ reason: 'planned-restart' })
  });
  if (!res.ok) throw new Error(`POST /api/auto-resume/prepare failed (${res.status})`);
  return res.json();
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

async function main() {
  console.log('[looparr] Checking current Looparr instance');
  try {
    await getState();
  } catch (error) {
    console.error(`[looparr] Preflight failed: ${error.message}`);
    console.error('[looparr] No rebuild started. Start Looparr and retry.');
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await prepare();
  } catch (error) {
    console.error(`[looparr] Resume preparation failed: ${error.message}`);
    console.error('[looparr] No rebuild started.');
    process.exitCode = 1;
    return;
  }

  if (result.gated === false) {
    console.error('[looparr] Resume intent capture is gated off for this instance.');
    console.error('[looparr] Run against the looparr container with HOSTNAME=looparr.');
    console.error('[looparr] No rebuild started.');
    process.exitCode = 1;
    return;
  }

  const prepared = Array.isArray(result.prepared) ? result.prepared : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  console.log(`[looparr] Prepared intent for: ${prepared.join(', ') || '(none)'}`);
  console.log(`[looparr] Skipped: ${skipped.map((item) => item.id).join(', ') || '(none)'}`);

  console.log(`[looparr] Docker command: ${DOCKER_COMMAND}`);
  if (DRY_RUN) {
    console.log('[looparr] Dry run: Docker was not called.');
    return;
  }

  console.log('[looparr] Rebuilding and recreating looparr');
  try {
    execSync(DOCKER_COMMAND, { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch (error) {
    console.error(`[looparr] Docker command failed (${error.status ?? 'unknown'}).`);
    process.exitCode = 1;
    return;
  }

  const ready = await waitForRestart('post-restart');
  if (!ready) {
    console.error('[looparr] Restart check timed out. Check the container manually.');
    process.exitCode = 1;
    return;
  }
  console.log('[looparr] API and container health check passed.');
  console.log('[looparr] Complete the served-asset and container-content checks from plan.md.');
}

main().catch((error) => {
  console.error(`[looparr] ${error.message}`);
  process.exitCode = 1;
});
