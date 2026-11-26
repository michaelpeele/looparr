#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Regression guards for the 2026-11-23 15:48 UTC outage: a killed agent
// session process group tore down `docker compose` mid-recreate, leaving a
// created-but-never-started replacement looparr container and an offline UI.
// The restart must be signal-immune and detached, and a watchdog must be able
// to re-converge the service.

const ROOT = path.resolve(__dirname, '..');
const restartScript = fs.readFileSync(path.join(ROOT, 'scripts', 'restart-looparr.js'), 'utf8');
const lockScript = fs.readFileSync(path.join(ROOT, 'scripts', 'restart-lock.sh'), 'utf8');
const watchdogPath = path.join(ROOT, 'scripts', 'restart-watchdog.sh');

// 1. restart-looparr.js must prefer a user-systemd transient unit so the compose
//    chain runs outside the requesting agent cgroup, and must keep the detached
//    signal-ignore fallback for hosts without a user manager.
assert.ok(
  !restartScript.includes('execSync(DOCKER_COMMAND'),
  'restart-looparr.js must not execSync the compose command inside the agent process group'
);
assert.ok(
  restartScript.includes('systemd-run'),
  'restart-looparr.js must support systemd-run execution'
);
assert.match(restartScript, /--user/, 'systemd-run path must target the user manager');
assert.match(
  restartScript,
  /const SYSTEMD_UNIT\s*=\s*['"]looparr-promote['"];/,
  'systemd-run path must define looparr-promote unit'
);
assert.match(
  restartScript,
  /`--unit=\$\{SYSTEMD_UNIT\}`|--unit=looparr-promote/,
  'systemd-run path must use looparr-promote unit'
);
assert.match(restartScript, /--wait/, 'systemd-run path must wait for compose exit code');
assert.match(restartScript, /--collect/, 'systemd-run path must collect finished transient unit');
assert.match(restartScript, /-p/, 'systemd-run path must set WorkingDirectory property');
assert.match(restartScript, /WorkingDirectory=/, 'systemd-run path must forward WorkingDirectory');
assert.match(
  restartScript,
  /for \(const key of \['PATH', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'\]\)[\s\S]*?if \(value\) args\.push\(`--setenv=\$\{key\}=\$\{value\}`\)/,
  'systemd-run path must forward PATH when set'
);
assert.match(restartScript, /DOCKER_HOST/, 'systemd-run path must forward DOCKER_HOST when set');
assert.match(restartScript, /DOCKER_CONTEXT/, 'systemd-run path must forward DOCKER_CONTEXT when set');
assert.match(restartScript, /DOCKER_CONFIG/, 'systemd-run path must forward DOCKER_CONFIG when set');
assert.match(restartScript, /systemdRunAvailable|runSystemdProbe|cachedSystemdRunAvailable/, 'restart-looparr.js must probe/cache systemd availability');
assert.match(restartScript, /promotion-execution-path/, 'restart-looparr.js must report execution path');
assert.ok(
  /spawnSync\(\s*'bash'/.test(restartScript),
  'restart-looparr.js must keep bash fallback wrapper'
);
assert.ok(
  restartScript.includes("detached: true"),
  'restart-looparr.js fallback compose child must run detached (new process group)'
);

// 2. The bash wrapper must ignore HUP/INT/TERM/QUIT during the recreate so the
//    compose child survives a group-wide signal even if the detachment is not
//    honoured on some platform.
assert.match(
  restartScript,
  /DETACHED_WRAPPER\s*=\s*`trap '' HUP INT TERM QUIT\\n\$\{DOCKER_COMMAND\}`|const wrapper = `trap '' HUP INT TERM QUIT\\n\$\{DOCKER_COMMAND\}`;/,
  'restart-looparr.js must define the signal-ignore wrapper source'
);
assert.match(
  restartScript,
  /trap '' HUP INT TERM QUIT/,
  'wrapper must ignore HUP/INT/TERM/QUIT around the compose command'
);
// execSync must only be used for the read-only `docker compose ps` status call.
for (const match of restartScript.matchAll(/execSync\(([^,)]+)/g)) {
  assert.match(
    match[1],
    /^'docker compose ps looparr'$/,
    `execSync is only allowed for the compose ps call, found: ${match[1].trim()}`
  );
}

// 2b. Created/exited recovery must inspect, start once, and show logs.
assert.match(restartScript, /function inspectLooparrState\(/, 'restart helper must inspect container state');
assert.match(
  restartScript,
  /\['inspect', 'looparr', '--format', '\{\{\.State\.Status\}\}'\]/,
  'restart helper must read State.Status with docker inspect'
);
assert.match(restartScript, /function recoverCreatedContainer\(phase\)/, 'restart helper must recover created containers');
assert.match(restartScript, /\['created', 'exited', 'dead'\]/, 'restart helper must recover non-running states');
assert.match(
  restartScript,
  /\['compose', 'start', 'looparr'\]/,
  'restart helper must start the created container once'
);
assert.match(
  restartScript,
  /\['logs', '--tail', '60', 'looparr'\]/,
  'restart helper must show logs when recovery fails'
);
assert.match(restartScript, /await recoverCreatedContainer\('preflight'\)/, 'recovery must run before API preflight');
assert.match(restartScript, /recoverCreatedContainer\('post-compose'\)/, 'recovery must run after compose');
assert.match(restartScript, /CONTAINER_RECOVERY_FAILED/, 'failed recovery must be reported loudly');
assert.match(
  restartScript,
  /API not ready after container recovery/,
  'preflight must retry API readiness after starting a recovered container'
);

// 2c. Promotion lock must block with a bounded wait; only timeout is an error.
assert.doesNotMatch(lockScript, /flock\s+-n/, 'restart-lock.sh must not fail fast on contention');
assert.match(lockScript, /flock\s+-w\s+"\$LOCK_TIMEOUT"/, 'restart-lock.sh must block with flock -w');
assert.match(
  lockScript,
  /LOCK_TIMEOUT="\$\{LOOPARR_RESTART_LOCK_TIMEOUT:-900\}"/,
  'restart-lock.sh must bound lock waits with LOOPARR_RESTART_LOCK_TIMEOUT'
);
assert.match(lockScript, /lock-wait/, 'restart-lock.sh must log lock waits');
assert.match(lockScript, /lock-acquired/, 'restart-lock.sh must log lock acquisition');
assert.match(lockScript, /date -u \+%Y-%m-%dT%H:%M:%SZ/, 'lock logs must use UTC timestamps');
assert.match(lockScript, /PROMOTION_LOCK_HELD/, 'stuck lock must report PROMOTION_LOCK_HELD');
assert.match(lockScript, /exit 76/, 'lock timeout must use a distinct exit status');
assert.match(lockScript, /LOOPARR_RESTART_LOCK_HELD=1/, 'lock wrapper must mark held fd for child');
assert.match(lockScript, /on_signal INT 130/, 'lock wrapper must relay INT');
assert.match(lockScript, /on_signal TERM 143/, 'lock wrapper must relay TERM');
assert.match(lockScript, /mkdir "\$LOCK_DIR"/, 'lock wrapper must keep the mkdir fallback');

// 2d. Container health detection must not accept `unhealthy` as healthy.
assert.doesNotMatch(restartScript, /\/healthy\/i\.test\(row\)/, 'health gate must not use /healthy/i');
assert.match(
  restartScript,
  /HEALTHY_STATUS_PATTERN/,
  'health gate must match explicit healthy states'
);
assert.match(
  restartScript,
  /\(unhealthy\|starting\|unknown\)/,
  'health gate must reject unhealthy, starting, and unknown states'
);
assert.match(restartScript, /async function waitForContainerHealthy\(/, 'recovery must poll health');
assert.match(
  restartScript,
  /await sleep\(2000\)/,
  'recovery polls must await the delay'
);

// 3. The watchdog exists, is valid bash, and fixes the exactly-observed state.
const watchdogScript = fs.readFileSync(watchdogPath, 'utf8');
assert.match(watchdogScript, /restart-lock\.sh.*restart-watchdog\.sh/, 'watchdog fix mode must run under the restart lock');
assert.match(watchdogScript, /docker compose up -d looparr/, 'watchdog must re-converge the service with compose');
assert.match(watchdogScript, /filter label=com\.docker\.compose\.service=looparr/, 'watchdog must target only the looparr compose service');
assert.match(watchdogScript, /LOOPARR_LOCAL_PORT:-4188/, 'watchdog must health-check the local API port');
execFileSync('bash', ['-n', watchdogPath], { stdio: 'inherit' });

console.log('test-restart-watchdog: OK');
