#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RESTART = path.join(ROOT, 'scripts', 'restart-looparr.js');

function writeExec(file, content) {
  fs.writeFileSync(file, content, 'utf8');
  fs.chmodSync(file, 0o755);
}

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-promote-systemd-'));
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

function runLaunch({ binDir, systemdScript, dockerScript, bashScript }) {
  fs.mkdirSync(binDir, { recursive: true });
  if (systemdScript !== null) {
    writeExec(path.join(binDir, 'systemd-run'), systemdScript);
  }
  writeExec(path.join(binDir, 'docker'), dockerScript || '#!/bin/sh\nexit 0\n');
  if (bashScript) {
    writeExec(path.join(binDir, 'bash'), bashScript);
  }
  // Provide essential tools without exposing a real systemd-run from host PATH.
  for (const cmd of ['sh', 'env', 'cat', 'grep', 'sed', 'awk', 'mktemp', 'rm', 'mkdir', 'dirname', 'basename', 'sleep', 'true', 'false']) {
    for (const dir of ['/usr/bin', '/bin']) {
      const src = path.join(dir, cmd);
      const dst = path.join(binDir, cmd);
      if (!fs.existsSync(dst) && fs.existsSync(src)) {
        try { fs.symlinkSync(src, dst); } catch { /* ignore */ }
      }
    }
  }
  if (!fs.existsSync(path.join(binDir, 'bash'))) {
    for (const src of ['/bin/bash', '/usr/bin/bash']) {
      if (fs.existsSync(src)) { fs.symlinkSync(src, path.join(binDir, 'bash')); break; }
    }
  }
  if (!fs.existsSync(path.join(binDir, 'node'))) {
    try { fs.symlinkSync(process.execPath, path.join(binDir, 'node')); } catch { /* ignore */ }
  }

  const probe = path.join(binDir, 'probe.log');
  const dockerLog = path.join(binDir, 'docker.log');
  const bashLog = path.join(binDir, 'bash.log');
  const env = {
    ...process.env,
    PATH: binDir,
    LOOPARR_RESTART_LOCK_HELD: '1',
    LOOPARR_PROMOTE_TEST_PROBE_LOG: probe,
    LOOPARR_PROMOTE_TEST_DOCKER_LOG: dockerLog,
    LOOPARR_PROMOTE_TEST_BASH_LOG: bashLog,
    DOCKER_HOST: 'unix:///var/run/docker.sock',
    DOCKER_CONTEXT: 'default',
    DOCKER_CONFIG: '/tmp/docker-config'
  };

  const script = `
    const m = require(${JSON.stringify(RESTART)});
    m.resetSystemdRunProbeCache();
    m.runDetachedDockerCommand();
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env,
    encoding: 'utf8'
  });
  return { result, probe, dockerLog, bashLog };
}

function assertOk(run, label) {
  assert.equal(run.result.status, 0, `${label}: expected exit 0, got ${run.result.status}\nstdout=${run.result.stdout}\nstderr=${run.result.stderr}`);
}

(function pathA() {
  const dir = makeTemp();
  try {
    const binDir = path.join(dir, 'bin');
    const argvLog = path.join(dir, 'systemd-run.argv');
    const script = `#!/bin/sh
printf '%s\n' "$@" >> ${JSON.stringify(argvLog)}
if [ "$1" = "--user" ] && [ "$2" = "--wait" ] && [ "$3" = "--collect" ] && echo "$4" | grep -q "looparr-promote-probe"; then
  exit 0
fi
exit 0
`;
    const dockerScript = `#!/bin/sh
printf '%s\n' "$@" >> "$LOOPARR_PROMOTE_TEST_DOCKER_LOG"
exit 0
`;
    const run = runLaunch({ binDir, systemdScript: script, dockerScript });
    assertOk(run, 'pathA');
    const argv = readLines(argvLog);
    const joined = argv.join(' ');
    assert.ok(argv.includes('--user'), 'pathA: --user missing');
    assert.ok(joined.includes('--unit=looparr-promote'), 'pathA: unit missing');
    assert.ok(argv.includes('--wait'), 'pathA: --wait missing');
    assert.ok(argv.includes('--collect'), 'pathA: --collect missing');
    assert.ok(joined.includes('WorkingDirectory='), 'pathA: WorkingDirectory missing');
    assert.ok(joined.includes('--setenv=PATH='), 'pathA: PATH env missing');
    assert.ok(joined.includes('--setenv=DOCKER_HOST=unix:///var/run/docker.sock'), 'pathA: DOCKER_HOST missing');
    assert.ok(joined.includes('--setenv=DOCKER_CONTEXT=default'), 'pathA: DOCKER_CONTEXT missing');
    assert.ok(joined.includes('--setenv=DOCKER_CONFIG=/tmp/docker-config'), 'pathA: DOCKER_CONFIG missing');
    const bashIdx = argv.indexOf('bash');
    assert.ok(bashIdx >= 0, 'pathA: bash missing');
    assert.equal(argv[bashIdx + 1], '-c', 'pathA: bash -c missing');
    const composeCommands = [];
    for (let i = 0; i < argv.length - 1; i += 1) {
      if (argv[i] === '-c') composeCommands.push(argv[i + 1] || '');
    }
    assert.ok(composeCommands.length >= 2, 'pathA: two compose phases missing');
    assert.ok(composeCommands.some((cmd) => cmd.includes('docker compose build looparr')), 'pathA: build phase missing');
    assert.ok(composeCommands.some((cmd) => cmd.includes('timeout --signal=TERM --kill-after=30s 300s docker compose up -d looparr')), 'pathA: up phase missing');
    assert.match(run.result.stdout + run.result.stderr, /promotion-execution-path|systemd-run/, 'pathA: execution path log missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function pathB() {
  const dir = makeTemp();
  try {
    const binDir = path.join(dir, 'bin');
    const bashScript = `#!/bin/sh
printf '%s\n' "$@" >> "$LOOPARR_PROMOTE_TEST_BASH_LOG"
# execute command arg for -c
if [ "$1" = "-c" ]; then
  eval "$2"
fi
exit 0
`;
    const dockerScript = `#!/bin/sh
printf '%s\n' "$@" >> "$LOOPARR_PROMOTE_TEST_DOCKER_LOG"
exit 0
`;
    const run = runLaunch({ binDir, systemdScript: null, dockerScript, bashScript });
    // remove systemd-run if somehow present? we didn't create it; PATH still has rest.
    assertOk(run, 'pathB');
    const bashLines = readLines(run.bashLog).join('\n');
    assert.match(bashLines, /trap '' HUP INT TERM QUIT/, 'pathB: signal trap missing');
    assert.match(bashLines, /docker compose build looparr 2>&1 \| tee/, 'pathB: build phase missing');
    assert.match(bashLines, /timeout --signal=TERM --kill-after=30s 300s docker compose up -d looparr 2>&1 \| tee/, 'pathB: up phase missing');
    assert.match(run.result.stdout + run.result.stderr, /detached-spawn/, 'pathB: fallback path log missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function pathC() {
  const dir = makeTemp();
  try {
    const binDir = path.join(dir, 'bin');
    const script = `#!/bin/sh
if echo "$*" | grep -q "looparr-promote-probe"; then
  exit 1
fi
printf '%s\n' "$@" > ${JSON.stringify(path.join(dir, 'should-not-run'))}
exit 0
`;
    const bashScript = `#!/bin/sh
printf '%s\n' "$@" >> "$LOOPARR_PROMOTE_TEST_BASH_LOG"
if [ "$1" = "-c" ]; then eval "$2"; fi
exit 0
`;
    const dockerScript = `#!/bin/sh
printf '%s\n' "$@" >> "$LOOPARR_PROMOTE_TEST_DOCKER_LOG"
exit 0
`;
    const run = runLaunch({ binDir, systemdScript: script, dockerScript, bashScript });
    assertOk(run, 'pathC');
    assert.ok(!fs.existsSync(path.join(dir, 'should-not-run')), 'pathC: systemd-run should not execute compose unit when probe fails');
    const bashLines = readLines(run.bashLog).join('\n');
    assert.match(bashLines, /trap '' HUP INT TERM QUIT/, 'pathC: fallback trap missing');
    assert.match(run.result.stdout + run.result.stderr, /detached-spawn/, 'pathC: fallback path log missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log('test-promote-systemd: ok');
