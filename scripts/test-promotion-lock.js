'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const LOCK_WRAPPER = path.join(REPO_ROOT, 'scripts/restart-lock.sh');
const RESTART_SCRIPT = path.join(REPO_ROOT, 'scripts/restart-looparr.js');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-promotion-lock-test');
const BIN_DIR = path.join(TEMP_DIR, 'bin');
const DOCKER_CALLS = path.join(TEMP_DIR, 'docker-calls.log');
const COMPOSE_START_CALLS = path.join(TEMP_DIR, 'compose-start-calls.log');
const STATE_FILE = path.join(TEMP_DIR, 'container-state');
const PS_FILE = path.join(TEMP_DIR, 'docker-ps');
const PROMOTIONS_LOG = path.join(TEMP_DIR, 'promotions.log');
const CONTINUE_FILE = path.join(TEMP_DIR, 'restart-continue.json');
const ORIGINAL_PATH = process.env.PATH || '';
const HEALTHY_PS = 'NAME      SERVICE   STATUS\nlooparr   looparr   Up 2 minutes (healthy)\n';

function writeStub(name, body) {
  const target = path.join(BIN_DIR, name);
  fs.writeFileSync(target, `#!/bin/sh\n${body}\nexit 0\n`, 'utf8');
  fs.chmodSync(target, 0o755);
}

function setupStubs() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(BIN_DIR, { recursive: true });
  writeStub('docker', [
    'printf \'%s\\n\' "$*" >> "$DOCKER_CALLS"',
    'if [ "$1" = "compose" ] && [ "$2" = "start" ] && [ "$3" = "looparr" ]; then',
    '  printf \'%s\\n\' "$*" >> "$COMPOSE_START_CALLS"',
    '  printf \'running\\n\' > "$DOCKER_STATE_FILE"',
    'fi',
    'case "$1" in',
    '  compose)',
    '    case "$2" in',
    '      ps) cat "$DOCKER_PS_FILE" ;;',
    '    esac',
    '    ;;',
    '  inspect) cat "$DOCKER_STATE_FILE" ;;',
    '  logs) i=1; while [ "$i" -le 60 ]; do printf \'log-line-%s\\n\' "$i"; i=$((i + 1)); done ;;',
    'esac'
  ].join('\n'));
  process.env.PATH = `${BIN_DIR}${path.delimiter}${ORIGINAL_PATH}`;
  process.env.DOCKER_CALLS = DOCKER_CALLS;
  process.env.COMPOSE_START_CALLS = COMPOSE_START_CALLS;
  process.env.DOCKER_STATE_FILE = STATE_FILE;
  process.env.DOCKER_PS_FILE = PS_FILE;
  process.env.LOOPARR_PROMOTIONS_LOG = PROMOTIONS_LOG;
  process.env.LOOPARR_RESTART_CONTINUE_FILE = CONTINUE_FILE;
  process.env.LOOPARR_CONTAINER_START_TIMEOUT_SECONDS = '1';
}

function setContainerState(state, ps = HEALTHY_PS) {
  fs.writeFileSync(STATE_FILE, `${state}\n`, 'utf8');
  fs.writeFileSync(PS_FILE, ps, 'utf8');
  fs.writeFileSync(DOCKER_CALLS, '', 'utf8');
  fs.writeFileSync(COMPOSE_START_CALLS, '', 'utf8');
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

async function waitForFile(file, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${file}`);
}

function lockEnv(lockPath, logPath, timeout = '20') {
  return {
    LOOPARR_RESTART_LOCK_PATH: lockPath,
    LOOPARR_PROMOTIONS_LOG: logPath,
    LOOPARR_RESTART_LOCK_TIMEOUT: timeout,
    LOOPARR_RESTART_LOCK_HELD: ''
  };
}

async function assertSerialLock() {
  const lock = path.join(TEMP_DIR, 'serial.lock');
  const log = path.join(TEMP_DIR, 'serial-promotions.log');
  const started = path.join(TEMP_DIR, 'first-started');
  const release = path.join(TEMP_DIR, 'first-release');
  const secondRan = path.join(TEMP_DIR, 'second-ran');
  const holderScript = 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"1");const t=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(t);process.exit(0);}},20);';
  const markerScript = 'require("node:fs").writeFileSync(process.argv[1],"1")';
  const first = runCommand('bash', [LOCK_WRAPPER, process.execPath, '-e', holderScript, started, release], lockEnv(lock, log));
  await waitForFile(started);
  const second = runCommand('bash', [LOCK_WRAPPER, process.execPath, '-e', markerScript, secondRan], lockEnv(lock, log));
  await delay(300);
  assert.equal(fs.existsSync(secondRan), false, 'second promotion must wait while lock is held');
  fs.writeFileSync(release, '1');
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, 0, `first promotion failed: ${firstResult.stderr}`);
  assert.equal(secondResult.status, 0, `second promotion failed: ${secondResult.stderr}`);
  assert.match(secondResult.stderr, /lock-wait/);
  assert.match(secondResult.stderr, /lock-acquired/);
  assert.doesNotMatch(secondResult.stderr, /PROMOTION_LOCK_HELD/);
  assert.equal(fs.existsSync(secondRan), true, 'second promotion must run after release');
}

async function assertLockTimeout() {
  const lock = path.join(TEMP_DIR, 'timeout.lock');
  const log = path.join(TEMP_DIR, 'timeout-promotions.log');
  const ready = path.join(TEMP_DIR, 'holder-ready');
  const release = path.join(TEMP_DIR, 'holder-release');
  const marker = path.join(TEMP_DIR, 'timed-out-child-ran');
  const holder = runCommand('bash', [
    '-c',
    'exec 9>>"$1"; flock 9; printf 1 > "$2"; while [ ! -f "$3" ]; do sleep 0.05; done',
    '_',
    lock,
    ready,
    release
  ]);
  await waitForFile(ready);
  const result = runCommand('bash', [
    LOCK_WRAPPER,
    process.execPath,
    '-e',
    'require("node:fs").writeFileSync(process.argv[1],"1")',
    marker
  ], lockEnv(lock, log, '1'));
  const timedOut = await result;
  fs.writeFileSync(release, '1');
  await holder;
  assert.equal(timedOut.status, 76, `timeout status must be 76, got ${timedOut.status}`);
  assert.match(timedOut.stderr, /"code":"PROMOTION_LOCK_HELD"/);
  assert.match(timedOut.stderr, /"timeoutSeconds":1/);
  assert.equal(fs.existsSync(marker), false, 'timed-out promotion must not run child');
  assert.match(readText(log), /PROMOTION_LOCK_HELD/);
  assert.match(readText(log), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
}

function assertHealthGate(restart) {
  assert.equal(restart.isRunningHealthy('NAME      SERVICE   STATUS\nlooparr   looparr   Up 2 minutes (healthy)'), true);
  assert.equal(restart.isRunningHealthy('NAME      SERVICE   STATUS\nlooparr   looparr   Up 2 minutes (health: healthy)'), true);
  for (const state of ['(unhealthy)', '(starting)', '(unknown)', '(health: starting)']) {
    assert.equal(
      restart.isRunningHealthy(`NAME      SERVICE   STATUS\nlooparr   looparr   Up 2 minutes ${state}`),
      false,
      `${state} must not pass health gate`
    );
  }
}

async function assertRecoveryStates(restart) {
  for (const state of ['created', 'exited', 'dead']) {
    setContainerState(state);
    const recovered = await restart.recoverCreatedContainer('test');
    assert.equal(recovered, true, `${state} must recover`);
    assert.deepEqual(readLines(COMPOSE_START_CALLS), ['compose start looparr'], `${state} must start exactly once`);
    assert.match(readLines(DOCKER_CALLS).join('\n'), /compose ps looparr/, `${state} must poll health`);
  }
}

async function assertFreshPreflight() {
  let stateRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/state') {
      res.writeHead(404);
      res.end();
      return;
    }
    stateRequests += 1;
    const respond = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ projects: [], settings: {} }));
    };
    if (stateRequests === 1) setTimeout(respond, 500);
    else respond();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {
      ...lockEnv(path.join(TEMP_DIR, 'preflight.lock'), path.join(TEMP_DIR, 'preflight-promotions.log')),
      LOOPARR_BASE_URL: `http://127.0.0.1:${server.address().port}`
    };
    const first = runCommand(process.execPath, [path.join(REPO_ROOT, 'scripts/restart-looparr.js'), '--dry-run'], env);
    const second = runCommand(process.execPath, [path.join(REPO_ROOT, 'scripts/restart-looparr.js'), '--dry-run'], env);
    const results = await Promise.all([first, second]);
    for (const result of results) {
      assert.equal(result.status, 0, `dry-run failed: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, /Checking current Looparr instance/);
      assert.doesNotMatch(result.stderr, /PROMOTION_LOCK_HELD/);
    }
    assert.ok(stateRequests >= 2, `each waiter must run its own preflight, got ${stateRequests} state requests`);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
  }
}

function assertWording() {
  const helperSequence = /npm run restart:looparr -- --dry-run[\s\S]*?npm run restart:looparr/;
  const rawComposeForbidden = /docker compose build[\s\S]*?docker compose up/;
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  const promotionSection = readme.slice(readme.indexOf('For a planned app rebuild'), readme.indexOf('### Future Funnel'));
  assert.match(promotionSection, helperSequence);
  assert.match(promotionSection, /must not run `docker compose build`\/`docker compose up` directly/);
  assert.match(promotionSection, rawComposeForbidden);

  const configSource = fs.readFileSync(path.join(REPO_ROOT, 'src/config.js'), 'utf8');
  const analyzeLine = configSource.split('\n').find((line) => line.includes('const ANALYZE_PROMOTION_LINE'));
  assert.ok(analyzeLine, 'ANALYZE_PROMOTION_LINE must exist');
  assert.match(analyzeLine, helperSequence);
  assert.match(analyzeLine, /must not use raw `docker compose build` or `docker compose up`/);
  const config = require(path.join(REPO_ROOT, 'src/config.js'));
  assert.match(config.DEFAULT_IMPLEMENT_PROMPT_TEMPLATE, helperSequence);
  assert.match(config.DEFAULT_IMPLEMENT_PROMPT_TEMPLATE, /do not run raw `docker compose build` or `docker compose up`/);

  const engine = fs.readFileSync(path.join(REPO_ROOT, 'src/engine.js'), 'utf8');
  const ruleLines = engine.slice(engine.indexOf('const PROMOTION_RULE_LINES'), engine.indexOf('function promotionRuleBlock'));
  assert.match(ruleLines, helperSequence);
  assert.match(ruleLines, /Do not run `docker compose build` or `docker compose up`/);
  assert.equal((ruleLines.match(/npm run restart:looparr -- --dry-run/g) || []).length, 1);
  assert.match(engine, /function injectPromotionRule\(prompt, projectPath\) \{[\s\S]*?promotionRuleBlock\(\)[\s\S]*?promotionRuleBlock\(repeatTitle\)/);
}

async function main() {
  setupStubs();
  setContainerState('running');
  await assertSerialLock();
  await assertLockTimeout();
  await assertFreshPreflight();
  const restart = require(path.join(REPO_ROOT, 'scripts/restart-looparr.js'));
  assertHealthGate(restart);
  await assertRecoveryStates(restart);
  assertWording();
  console.log('test-promotion-lock: ok');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(() => {
  process.env.PATH = ORIGINAL_PATH;
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});
