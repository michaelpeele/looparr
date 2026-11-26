#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Static guards for the watchdog timer mapped plan
// (.project_documents/PLAN-watchdog-timer.md): the systemd user timer units
// exist and reference the watchdog script, the timer is a 30-second Persistent
// schedule, and restart-watchdog.sh owns timer mode with a quiet exit-75
// `busy:` branch and an every-5th-cycle read-only `review:` check.

const ROOT = path.resolve(__dirname, '..');
const timerPath = path.join(ROOT, 'systemd', 'looparr-watchdog.timer');
const servicePath = path.join(ROOT, 'systemd', 'looparr-watchdog.service');
const scriptPath = path.join(ROOT, 'scripts', 'restart-watchdog.sh');
const installerPath = path.join(ROOT, 'scripts', 'install-watchdog-timer.sh');

assert.ok(fs.existsSync(timerPath), 'systemd/looparr-watchdog.timer must exist');
assert.ok(fs.existsSync(servicePath), 'systemd/looparr-watchdog.service must exist');

const timerUnit = fs.readFileSync(timerPath, 'utf8');
const serviceUnit = fs.readFileSync(servicePath, 'utf8');

// Both unit files exist and reference restart-watchdog.sh.
assert.match(timerUnit, /restart-watchdog\.sh/, 'timer unit must reference restart-watchdog.sh');
assert.match(serviceUnit, /restart-watchdog\.sh/, 'service unit must reference restart-watchdog.sh');

// Timer: 30-second cadence, 1-minute boot delay, and Persistent=true.
assert.match(timerUnit, /OnUnitActiveSec=30s/, 'timer must use a 30-second OnUnitActiveSec cadence');
assert.match(timerUnit, /OnBootSec=1min/, 'timer must use a 1-minute OnBootSec delay');
assert.match(timerUnit, /Persistent=true/, 'timer must set Persistent=true');
assert.match(timerUnit, /Unit=looparr-watchdog\.service/, 'timer must target looparr-watchdog.service');

// Service: oneshot calling timer mode, repo placeholder, exit-75 tolerated.
assert.match(serviceUnit, /Type=oneshot/, 'service must be Type=oneshot');
assert.match(serviceUnit, /restart-watchdog\.sh timer/, 'service must invoke restart-watchdog.sh timer');
assert.match(serviceUnit, /__LOOPARR_REPO__/, 'service must carry the __LOOPARR_REPO__ placeholder');
assert.match(serviceUnit, /SuccessExitStatus=0 75/, 'service must tolerate exit 0 and 75');

// restart-watchdog.sh: timer mode, exit-75 log-only branch, every-5th review.
const script = fs.readFileSync(scriptPath, 'utf8');
assert.match(script, /fix\|check\|timer/, 'script case statement must accept timer mode');
assert.match(script, /run_timer_mode/, 'script must define the timer-mode function');
assert.match(script, /busy: restarting\/promotion lock held; skipping this cycle/, 'timer mode must log the busy line on a held lock');
assert.match(script, /-eq 75/, 'timer mode must special-case exit 75 from the restart lock');
assert.match(script, /restart-lock\.sh/, 'timer mode must run the fix pass under restart-lock.sh');
assert.match(script, /count % 5 == 0/, 'timer mode must run the review check every 5th cycle');
assert.match(script, /review: looparr service is up/, 'timer mode must log the review pass line');
assert.match(script, /FAILED: review check reports the service down/, 'timer mode must log FAILED when the review check fails');
assert.match(script, /watchdog-cycle-count/, 'timer mode must keep a cycle counter file');

// Installer exists, is executable, and wires the units + linger.
assert.ok(fs.existsSync(installerPath), 'scripts/install-watchdog-timer.sh must exist');
const installer = fs.readFileSync(installerPath, 'utf8');
assert.match(installer, /daemon-reload/, 'installer must run daemon-reload');
assert.match(installer, /enable --now/, 'installer must enable the timer now');
assert.match(installer, /enable-linger/, 'installer must enable linger');
assert.match(installer, /--uninstall/, 'installer must support --uninstall');

// Both shell scripts must be syntactically valid bash.
execFileSync('bash', ['-n', scriptPath], { stdio: 'inherit' });
execFileSync('bash', ['-n', installerPath], { stdio: 'inherit' });

console.log('test-watchdog-timer: OK');