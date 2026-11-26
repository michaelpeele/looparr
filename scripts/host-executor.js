'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { ensureKiloProvider } = require('../src/opencode-provider');
const { buildKiloArgs } = require('../src/kilo-command');
const { buildVibeArgs } = require('../src/vibe-command');
const {
  normalizeOpenCodeSessionId,
  opencodeSessionExists,
  createOpenCodeSessionCapture
} = require('../src/runners/opencode-session');
const selfhealStatus = require('../src/selfheal-status');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROJECTS_ROOT = '/home/michaelpeele/ai-projects';
const DEFAULT_OPENCODE_BIN = '/home/michaelpeele/.opencode/bin/opencode';
const DEFAULT_OPENCODE_SERVER_PORT = 4096;
const OPENCODE_PORT_ATTEMPTS = 10;
const RUNNERS = new Set(['opencode', 'kilo', 'vibe']);
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_RUN_KEY_LENGTH = 128;
const RUN_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const CHILD_TERMINATE_TIMEOUT_MS = 3000;

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv(path.join(REPO_ROOT, '.env'));

function fail(message) {
  process.stderr.write(`[host-executor] ${message}\n`);
  process.exit(1);
}

const token = process.env.LOOPARR_EXECUTOR_TOKEN || '';
if (token.length < 16 || token.includes('REPLACE')) {
  fail('LOOPARR_EXECUTOR_TOKEN must be set to a random value of at least 16 characters');
}

const portRaw = process.env.LOOPARR_EXECUTOR_PORT;
const port = portRaw === undefined || portRaw === '' ? 4187 : Number(portRaw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  fail('LOOPARR_EXECUTOR_PORT must be an integer from 0 to 65535');
}

const opencodeServerPort = Number(process.env.LOOPARR_EXECUTOR_OPENCODE_PORT || DEFAULT_OPENCODE_SERVER_PORT);
if (!Number.isInteger(opencodeServerPort) || opencodeServerPort < 1 || opencodeServerPort > 65535) {
  fail('LOOPARR_EXECUTOR_OPENCODE_PORT must be an integer from 1 to 65535');
}
function serverUrl(port) {
  return `http://127.0.0.1:${port}/`;
}

function discoverBind() {
  const explicit = process.env.LOOPARR_EXECUTOR_BIND;
  if (explicit) return explicit.trim();
  try {
    const gateway = execFileSync(
      'docker',
      ['network', 'inspect', 'bridge', '-f', '{{(index .IPAM.Config 0).Gateway}}'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (gateway) return gateway;
  } catch {
    // Explicit LOOPARR_EXECUTOR_BIND is required when discovery fails.
  }
  fail('Cannot discover Docker bridge gateway; set LOOPARR_EXECUTOR_BIND');
}

const bind = discoverBind();
if (bind === '0.0.0.0' || bind === '::' || bind === '[::]') {
  fail('Refusing to bind host executor to all interfaces');
}

const opencodeBin = process.env.LOOPARR_EXECUTOR_OPENCODE_BIN
  || process.env.OPENCODE_BIN
  || DEFAULT_OPENCODE_BIN;
if (!fs.existsSync(opencodeBin)) fail(`OpenCode binary not found: ${opencodeBin}`);
const kiloBin = process.env.LOOPARR_EXECUTOR_KILO_BIN || 'kilo';
const vibeBin = process.env.LOOPARR_EXECUTOR_VIBE_BIN || 'vibe';

// The kilo lane only resolves when the OpenCode server started below can read a
// config that declares the provider, so keep it in place before anything spawns.
let providerStatus;
try {
  providerStatus = ensureKiloProvider({ root: REPO_ROOT });
  process.stdout.write(`[host-executor] kilo provider ${providerStatus.status}: ${providerStatus.path}\n`);
} catch (error) {
  providerStatus = { status: 'error', path: path.join(REPO_ROOT, 'opencode.json'), error: error.message };
  process.stderr.write(`[host-executor] kilo provider config error: ${error.message}\n`);
}

let projectsRoot;
try {
  projectsRoot = fs.realpathSync(process.env.LOOPARR_PROJECTS_ROOT || DEFAULT_PROJECTS_ROOT);
} catch {
  fail(`Projects root not found: ${process.env.LOOPARR_PROJECTS_ROOT || DEFAULT_PROJECTS_ROOT}`);
}

const activeRuns = new Map();
const replacingRuns = new Map();
let attachFlag = null;
let attachProbed = false;
let serverPromise = null;
let managedServer = null;

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRunner(value) {
  if (value === undefined || value === null || value === '') return 'opencode';
  if (typeof value !== 'string') throw new Error('runner must be a string');
  const runner = value.trim().toLowerCase();
  if (!RUNNERS.has(runner)) throw new Error(`unknown runner: ${value}`);
  return runner;
}

function normalizeModel(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('model must be a string');
  const model = value.trim();
  if (!model) return '';
  if (model.includes(',') || model.length > 200 || /\s/.test(model) || /[\u0000-\u001f\u007f]/.test(model) || model.startsWith('-')) {
    throw new Error('model is invalid');
  }
  return model;
}

function authorized(req) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function probeUrl(url) {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

function waitForServer(child, url) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const tick = async () => {
      if (await probeUrl(url)) return resolve();
      if (child && child.exitCode !== null) return reject(new Error('opencode serve exited before becoming ready'));
      if (Date.now() > deadline) return reject(new Error('opencode serve did not become ready in 15s'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function getAttachFlag() {
  if (attachProbed) return attachFlag;
  attachProbed = true;
  try {
    const help = execFileSync(opencodeBin, ['run', '--help'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    // Legacy builds take an explicit attach URL; modern builds connect to the
    // background service themselves, and their `--server` URL requires a server
    // password we do not have, so it exits 1. Prefer no attach flag there.
    attachFlag = /^\s+--attach\b/m.test(help) ? '--attach' : '';
  } catch {
    attachFlag = '--attach';
  }
  return attachFlag;
}

async function ensureServer() {
  if (serverPromise) {
    try {
      const cached = await serverPromise;
      if (await probeUrl(cached)) return cached;
      process.stderr.write('[opencode] cached server is unreachable; starting a new one\n');
    } catch { /* the cached start failed; retry below */ }
    serverPromise = null;
  }
  serverPromise = (async () => {
    let lastError = null;
    for (let offset = 0; offset < OPENCODE_PORT_ATTEMPTS; offset += 1) {
      const candidate = opencodeServerPort + offset;
      if (candidate > 65535) break;
      const url = serverUrl(candidate);
      // A server we did not start cannot be trusted to carry this repo's config,
      // so it is skipped rather than reused.
      if (await probeUrl(url)) {
        process.stdout.write(`[opencode] port ${candidate} is served by a process this executor does not own; trying the next port\n`);
        continue;
      }
      const child = spawn(opencodeBin, ['serve', '--port', String(candidate)], {
        cwd: REPO_ROOT,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (chunk) => {
        process.stdout.write(`[opencode] ${chunk.toString()}`);
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(`[opencode] ${chunk.toString()}`);
      });
      child.once('exit', (code, signal) => {
        if (managedServer === child) {
          managedServer = null;
          // Drop the cached URL with the process: otherwise the next run keeps
          // retrying this closed port (ECONNREFUSED) instead of starting a new
          // server.
          serverPromise = null;
        }
        process.stderr.write(`[opencode] serve exited (code=${code}, signal=${signal || 'none'}, port=${candidate})\n`);
      });
      try {
        await waitForServer(child, url);
      } catch (error) {
        lastError = error;
        process.stderr.write(`[opencode] server on port ${candidate} failed: ${error.message}\n`);
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
        continue;
      }
      managedServer = child;
      process.stdout.write(`[opencode] serving ${url} from ${REPO_ROOT}\n`);
      return url;
    }
    throw new Error(lastError ? lastError.message : `no free OpenCode port from ${opencodeServerPort} to ${opencodeServerPort + OPENCODE_PORT_ATTEMPTS - 1}`);
  })();
  try {
    return await serverPromise;
  } catch (error) {
    serverPromise = null;
    throw error;
  }
}

function frame(res, value) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`${JSON.stringify(value)}\n`);
}

function validateRun(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');
  if (typeof payload.runKey !== 'string' || !payload.runKey) throw new Error('runKey is required');
  if (payload.runKey.length > MAX_RUN_KEY_LENGTH || !RUN_KEY_PATTERN.test(payload.runKey)) {
    throw new Error('runKey is invalid');
  }
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) throw new Error('prompt is required');

  const cwd = fs.realpathSync(path.resolve(payload.cwd || ''));
  if (!isInside(projectsRoot, cwd)) throw new Error('cwd is outside the allowed projects root');

  const files = Array.isArray(payload.files) ? payload.files : [];
  const checkedFiles = files.map((file) => {
    if (typeof file !== 'string' || !file) throw new Error('files must be strings');
    const resolved = path.resolve(cwd, file);
    if (!isInside(cwd, resolved)) throw new Error('file is outside the project directory');
    const real = fs.realpathSync(resolved);
    if (!isInside(cwd, real)) throw new Error('file resolves outside the project directory');
    return real;
  });

  const model = normalizeModel(payload.model);
  const runner = normalizeRunner(payload.runner);
  const projectId = typeof payload.projectId === 'string' && payload.projectId.trim()
    ? payload.projectId.trim().slice(0, 128)
    : '';
  const sessionId = normalizeOpenCodeSessionId(payload.sessionId);
  const sessionInvalid = typeof payload.sessionId === 'string' && payload.sessionId.trim() !== '' && !sessionId;
  return { prompt: payload.prompt, cwd, files: checkedFiles, model, runner, runKey: payload.runKey, projectId, sessionId, sessionInvalid };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateEntry(entry) {
  const child = entry.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  child.kill('SIGTERM');
  const exited = await Promise.race([
    closed.then(() => true),
    wait(CHILD_TERMINATE_TIMEOUT_MS).then(() => false)
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await closed;
  }
}

async function replaceActiveRun(runKey, res) {
  for (;;) {
    const pending = replacingRuns.get(runKey);
    if (pending) {
      await pending.promise;
      continue;
    }

    let release = null;
    let released = false;
    const record = { promise: null, release: null };
    record.promise = new Promise((resolve) => {
      release = () => {
        if (released) return;
        released = true;
        if (replacingRuns.get(runKey) === record) replacingRuns.delete(runKey);
        resolve();
      };
    });
    record.release = release;
    replacingRuns.set(runKey, record);

    const previous = activeRuns.get(runKey);
    if (!previous) return release;
    try {
      frame(res, { stream: 'err', text: '[host-executor] previous run for this key is being replaced\n' });
      previous.finish(137);
      await terminateEntry(previous);
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }
}

async function handleRun(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  let payload;
  try {
    payload = validateRun(await readJson(req));
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  let command;
  let args;
  let sessionCapture = null;
  let sessionFrame = '';
  if (payload.runner === 'kilo') {
    command = kiloBin;
    try {
      args = buildKiloArgs({ prompt: payload.prompt, files: payload.files, model: payload.model });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  } else if (payload.runner === 'vibe') {
    command = vibeBin;
    try {
      args = buildVibeArgs({ prompt: payload.prompt, files: payload.files, model: payload.model });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  } else {
    let serverUrl;
    try {
      serverUrl = await ensureServer();
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
    const flag = getAttachFlag();
    args = ['run'];
    if (flag) args.push(flag, serverUrl);
    args.push('--auto', '--format', 'json');
    let resumeSessionId = '';
    if (payload.sessionInvalid) {
      sessionFrame = '[host-executor] session-invalid; starting fresh run\n';
    } else if (payload.sessionId) {
      if (opencodeSessionExists({ cwd: payload.cwd, sessionId: payload.sessionId, bin: opencodeBin })) {
        resumeSessionId = payload.sessionId;
        sessionFrame = `[host-executor] opencode run --session ${resumeSessionId} (resume)\n`;
      } else {
        sessionFrame = '[host-executor] session-missing; starting fresh run\n';
      }
    }
    if (resumeSessionId) args.push('--session', resumeSessionId);
    if (payload.model) args.push('--model', payload.model);
    for (const file of payload.files) args.push('--file', file);
    args.push(payload.prompt);
    command = opencodeBin;
    sessionCapture = createOpenCodeSessionCapture();
    payload.sessionId = resumeSessionId;
  }

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.flushHeaders?.();
  if (sessionFrame) frame(res, { stream: 'err', text: sessionFrame });

  const releaseReplacement = await replaceActiveRun(payload.runKey, res);

  let child;
  try {
    child = spawn(command, args, {
      cwd: payload.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    releaseReplacement();
    frame(res, { stream: 'err', text: `[host-executor] ${error.message}\n` });
    frame(res, { exit: 1 });
    if (!res.destroyed && !res.writableEnded) res.end();
    return;
  }

  let finished = false;
  const entry = {
    child,
    runKey: payload.runKey,
    runner: payload.runner,
    projectId: payload.projectId,
    cwd: payload.cwd,
    startedAt: new Date().toISOString(),
    opencodeSessionId: payload.sessionId || '',
    finish: null
  };
  entry.finish = (code) => {
    if (finished) return;
    finished = true;
    if (activeRuns.get(payload.runKey) === entry) activeRuns.delete(payload.runKey);
    if (res.destroyed || res.writableEnded) return;
    frame(res, { exit: code });
    res.end();
  };
  activeRuns.set(payload.runKey, entry);
  releaseReplacement();

  child.stdout.on('data', (chunk) => {
    if (sessionCapture) {
      sessionCapture.push(chunk);
      const captured = sessionCapture.sessionId;
      if (captured) entry.opencodeSessionId = captured;
    }
    frame(res, { stream: 'out', text: chunk.toString() });
  });
  child.stderr.on('data', (chunk) => frame(res, { stream: 'err', text: chunk.toString() }));
  child.on('error', (error) => {
    frame(res, { stream: 'err', text: `[host-executor] ${error.message}\n` });
    entry.finish(1);
  });
  child.on('close', (code, signal) => {
    if (sessionCapture) {
      const captured = sessionCapture.finish();
      if (captured) entry.opencodeSessionId = captured;
    }
    if (finished) return;
    if (signal && code === null) {
      frame(res, { stream: 'err', text: `[host-executor] ${payload.runner} run terminated by ${signal}\n` });
    }
    entry.finish(Number.isInteger(code) ? code : 1);
  });
  req.on('aborted', () => {
    if (!finished) child.kill('SIGTERM');
  });
  res.on('close', () => {
    if (!finished && !res.writableEnded) {
      entry.finish(137);
      terminateEntry(entry).catch(() => {});
    }
  });
}

async function handleCancel(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
  if (!payload || typeof payload !== 'object') {
    return sendJson(res, 400, { error: 'payload must be an object' });
  }

  const runKey = typeof payload.runKey === 'string' && payload.runKey ? payload.runKey : '';
  const keepRunKey = typeof payload.keepRunKey === 'string' && payload.keepRunKey ? payload.keepRunKey : '';
  const projectId = typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : '';
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? path.resolve(payload.cwd) : '';
  if (!runKey && !projectId && !cwd) {
    return sendJson(res, 400, { error: 'one of projectId, cwd, or runKey is required' });
  }

  const matches = [];
  for (const entry of activeRuns.values()) {
    if (keepRunKey && entry.runKey === keepRunKey) continue;
    const cwdMatch = Boolean(cwd && path.resolve(entry.cwd || '') === cwd);
    const matched = Boolean(
      (runKey && entry.runKey === runKey)
      || (projectId && entry.projectId === projectId)
      || cwdMatch
    );
    if (matched) matches.push(entry);
  }

  const cancelled = [];
  for (const entry of matches) {
    cancelled.push({ runKey: entry.runKey, projectId: entry.projectId || '' });
    entry.finish(137);
    await terminateEntry(entry);
  }
  return sendJson(res, 200, { ok: true, cancelled });
}

// Prod merge relay. Prod cannot run git or docker, so it asks the host executor
// (which shares the repo checkout and the Docker CLI) to merge a healed branch
// locally, then rebuild/recreate prod. The response is written before the
// detached restart is scheduled so the browser sees the 200 first.
async function handleSelfhealMerge(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
  if (!payload || typeof payload !== 'object') {
    return sendJson(res, 400, { error: 'payload must be an object' });
  }
  const projectId = typeof payload.projectId === 'string' ? payload.projectId : '';
  const branch = typeof payload.branch === 'string' ? payload.branch : '';
  if (!selfhealStatus.isValidProjectId(projectId)) {
    return sendJson(res, 400, { error: 'invalid projectId' });
  }

  // Operate only inside the fixed repo root; no caller-supplied paths.
  const check = selfhealStatus.validateMergeRequest(REPO_ROOT, projectId, { branch });
  if (!check.ok) return sendJson(res, check.status, { error: check.error });

  const repoRoot = REPO_ROOT;
  // Already-merged is idempotent-refused: nothing to do.
  const ancestor = spawnSyncGit(['merge-base', '--is-ancestor', branch, 'HEAD'], repoRoot);
  if (ancestor.status === 0) {
    const record = check.record;
    record.mergedAt = record.mergedAt || new Date().toISOString();
    selfhealStatus.writeStatus(repoRoot, record);
    return sendJson(res, 200, { ok: true, branch, mergeCommit: null, restart: 'already-merged' });
  }

  const merged = spawnSyncGit(
    ['merge', '--no-ff', '-m', `selfheal: merge ${branch}`, branch],
    repoRoot
  );
  if (merged.status !== 0) {
    // Conflict (or any merge failure): keep the branch, report 409.
    return sendJson(res, 409, { error: 'merge failed; branch kept for review', detail: String(merged.stderr || '').trim().slice(0, 300) });
  }
  const head = spawnSyncGit(['rev-parse', '--short', 'HEAD'], repoRoot);
  const mergeCommit = head.status === 0 ? String(head.stdout || '').trim() : '';

  // Mark the status file merged so prod hides the merge button after reconnect.
  const record = check.record;
  record.mergedAt = new Date().toISOString();
  record.exitCode = record.exitCode == null ? null : record.exitCode;
  selfhealStatus.writeStatus(repoRoot, record);

  // Send the response first; schedule the rebuild/restart detached after a short
  // delay so the prod container is not recreated mid-response.
  sendJson(res, 200, { ok: true, branch, mergeCommit, restart: 'scheduled' });

  scheduleRestart(repoRoot);
  process.stdout.write(`[host-executor] self-heal merge complete for ${projectId} on ${branch}; restart scheduled\n`);
}

function spawnSyncGit(args, cwd) {
  // Local helper to keep the merge logic readable; git only ever runs against
  // the fixed repo root.
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 60_000 });
}

function scheduleRestart(repoRoot) {
  // The rebuild recreates the prod container, so wait long enough for the 200 to
  // reach prod and the browser before tearing anything down. Restart execution is
  // delegated to restart-looparr.js, which runs compose outside the agent cgroup
  // when systemd-run --user is available.
  setTimeout(() => {
    try {
      const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'restart-looparr.js')], {
        cwd: repoRoot,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } catch (error) {
      process.stderr.write(`[host-executor] failed to schedule restart: ${error.message}\n`);
    }
  }, 5000).unref?.();
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      projectsRoot,
      opencodeBin,
      kiloProvider: providerStatus.status,
      kiloProviderPath: providerStatus.path,
      runnerBinaries: { opencode: opencodeBin, kilo: kiloBin, vibe: vibeBin }
    });
  }
  if (req.url === '/active' && req.method === 'GET') {
    if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
    const active = Array.from(activeRuns.values(), (entry) => ({
      runKey: entry.runKey,
      runner: entry.runner || 'opencode',
      projectId: entry.projectId || '',
      cwd: entry.cwd || '',
      startedAt: entry.startedAt,
      ...(entry.opencodeSessionId ? { opencodeSessionId: entry.opencodeSessionId } : {})
    }));
    return sendJson(res, 200, active);
  }
  if (req.url === '/run' && req.method === 'POST') {
    return handleRun(req, res);
  }
  if (req.url === '/cancel' && req.method === 'POST') {
    return handleCancel(req, res);
  }
  if (req.url === '/selfheal/merge' && req.method === 'POST') {
    return handleSelfhealMerge(req, res);
  }
  return sendJson(res, 404, { error: 'not found' });
});

server.listen(port, bind, () => {
  const address = server.address();
  const listeningPort = address && typeof address === 'object' ? address.port : port;
  process.stdout.write(`[host-executor] listening on http://${bind}:${listeningPort}\n`);
});

server.on('error', (error) => fail(`server error: ${error.message}`));

function shutdown() {
  for (const entry of activeRuns.values()) entry.child.kill('SIGTERM');
  if (managedServer) managedServer.kill('SIGTERM');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
