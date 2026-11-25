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
const watchdogPath = path.join(ROOT, 'scripts', 'restart-watchdog.sh');

// 1. restart-looparr.js must not run the compose command inline in the caller's
//    process group.
assert.ok(
  !restartScript.includes('execSync(DOCKER_COMMAND'),
  'restart-looparr.js must not execSync the compose command inside the agent process group'
);
assert.ok(
  /spawnSync\(\s*'bash'/.test(restartScript),
  'restart-looparr.js must spawn the compose command through a bash wrapper'
);
assert.ok(
  restartScript.includes("detached: true"),
  'restart-looparr.js compose child must run detached (new process group) so a session kill cannot abort the recreate'
);

// 2. The bash wrapper must ignore HUP/INT/TERM/QUIT during the recreate so the
//    compose child survives a group-wide signal even if the detachment is not
//    honoured on some platform.
const wrapperMatch = restartScript.match(/const wrapper = `([^`]*)`;/);
assert.ok(wrapperMatch, 'restart-looparr.js must define the signal-ignore wrapper source');
assert.match(
  wrapperMatch[1],
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

// 3. The watchdog exists, is valid bash, and fixes the exactly-observed state.
const watchdogScript = fs.readFileSync(watchdogPath, 'utf8');
assert.match(watchdogScript, /restart-lock\.sh.*restart-watchdog\.sh/, 'watchdog fix mode must run under the restart lock');
assert.match(watchdogScript, /docker compose up -d looparr/, 'watchdog must re-converge the service with compose');
assert.match(watchdogScript, /filter label=com\.docker\.compose\.service=looparr/, 'watchdog must target only the looparr compose service');
assert.match(watchdogScript, /LOOPARR_LOCAL_PORT:-4188/, 'watchdog must health-check the local API port');
execFileSync('bash', ['-n', watchdogPath], { stdio: 'inherit' });

console.log('test-restart-watchdog: OK');
