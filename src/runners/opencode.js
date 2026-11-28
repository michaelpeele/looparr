'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { validateModelId } = require('../model-list');
const { normalizeOpenCodeSessionId, opencodeSessionExists } = require('./opencode-session');
const { loadDotEnv } = require('../env-file');

// A local `opencode serve` (including the shared `--service` listener on
// 4096) can require a password. The dev engine does not load the whole .env
// (that would flip unrelated flags such as LOOPARR_EXECUTOR_URL), so pull in
// only the attach password before any child inherits process.env.
loadDotEnv(path.join(__dirname, '..', '..', '.env'), { keys: ['OPENCODE_PASSWORD'] });

const SERVER_PORT = 4096;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const PROBE_URL = `http://127.0.0.1:${SERVER_PORT}/`;
const EXECUTOR_URL = process.env.LOOPARR_EXECUTOR_URL
  ? String(process.env.LOOPARR_EXECUTOR_URL).replace(/\/+$/, '')
  : null;
const EXECUTOR_TOKEN = process.env.LOOPARR_EXECUTOR_TOKEN || '';
const BRIDGE_CLIENT = path.join(__dirname, '..', '..', 'scripts', 'bridge-client.js');

// Ids OpenCode can resolve. Keep in step with the equivalent default settings
// and `public/app.js`; the Kilo Gateway ids belong to the Kilo CLI runner.
const MODELS = [
  // The account's free draft model despite the missing `-free` suffix; the
  // settings default and `src/config.js` both rely on it resolving here.
  'opencode/big-pickle',
  'opencode/tidepool-alpha-free',
  'opencode/hy4-flash-free',
  'opencode/iceman-free',
  'opencode/longcat-2.5-free',
  'opencode/flint-40b-free',
  'opencode/deepseek-v4.1-flash-free',
  'opencode/nemotron-3.5-super-vl-free',
  'opencode/beam-free',
  'opencode/mimo-v2.6-flash-free',
  'opencode/nemotron-3.5-lightning-free',
  // The Kilo Gateway lane runs through OpenCode: repo-root `opencode.json`
  // declares the keyless `kilo` provider, so explicit free ids resolve here as
  // well as in the Kilo CLI runner. Router and rate-limited ids are refused.
  'kilo/baidu/ernie-5.5-flash-preview:free',
  'kilo/reflection/beam-free',
  'kilo/recursive/flint-v1.0:free',
  'kilo/nvidia/nemotron-3-ultra-550b-a55b:free',
  'kilo/nvidia/nemotron-3.5-lightning:free',
  'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'kilo/inclusionai/ling-3.2-flash:free',
  'kilo/particle-ai/particle-1:free',
  'kilo/liquid/lfm-3-1.7b:free'
];

let attachFlag = null;
let attachProbed = false;
let serverPromise = null;
let managedServer = null;

function probe() {
  return new Promise((resolve) => {
    const request = http.get(PROBE_URL, (response) => {
      response.resume();
      resolve(true);
    });
    request.setTimeout(700, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = async () => {
      if (await probe()) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 300);
    };
    check();
  });
}

// Legacy builds take an explicit attach URL; modern builds connect to the
// background service themselves, and their `--server` URL requires a server
// password we do not have, so it exits 1. Prefer no attach flag there.
function probeAttachFlag(help) {
  return /^\s+--attach\b/m.test(help) ? '--attach' : '';
}

let helpProvider = null;
function setHelpProviderForTests(provider) {
  helpProvider = provider;
  attachProbed = false;
  attachFlag = null;
}

function getAttachFlag() {
  if (attachProbed) return attachFlag;
  attachProbed = true;
  try {
    const help = helpProvider
      ? helpProvider()
      : execFileSync('opencode', ['run', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    attachFlag = probeAttachFlag(help);
  } catch {
    // Older OpenCode builds use --attach; newer builds use --server.
    attachFlag = '--attach';
  }
  return attachFlag;
}

async function ensureServer() {
  if (EXECUTOR_URL) return null;
  if (await probe()) return SERVER_URL;
  if (!serverPromise) {
    serverPromise = (async () => {
      if (await probe()) return SERVER_URL;
      managedServer = spawn('opencode', ['serve', '--port', String(SERVER_PORT)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env
      });
      for (const stream of [managedServer.stdout, managedServer.stderr]) {
        if (!stream) continue;
        stream.on('data', (chunk) => {
          const text = String(chunk).trim();
          if (text) console.log(`[opencode serve] ${text}`);
        });
      }
      managedServer.on('error', (error) => console.error(`[opencode serve] ${error.message}`));
      managedServer.on('exit', () => { managedServer = null; });
      const ready = await waitForServer(15000);
      if (!ready) {
        try { managedServer && managedServer.kill('SIGTERM'); } catch { /* ignore */ }
        managedServer = null;
        throw new Error(`opencode serve did not become ready on ${SERVER_URL}`);
      }
      return SERVER_URL;
    })().finally(() => { serverPromise = null; });
  }
  return serverPromise;
}

// Paseo's built-in OpenCode provider needs the model in `provider/model` form.
// Looparr model ids may be bare (`big-pickle`), already OpenCode-namespaced
// (`opencode/big-pickle`), or carry a foreign Looparr namespace (`kilo/...`).
// Only the first two name a real OpenCode model; a foreign namespace falls back
// to the Paseo default model (empty model id). Never emit `opencode/kilo/...`.
function sanitizePaseoModelId(model, provider = 'opencode') {
  const raw = String(model == null ? '' : model).trim();
  if (!raw) return '';
  const slash = raw.indexOf('/');
  if (slash <= 0) return raw;
  const namespace = raw.slice(0, slash);
  if (namespace === provider) return raw.slice(slash + 1).trim();
  return '';
}

// Structured Paseo metadata for the OpenCode runner: the built-in provider, the
// sanitized `provider/model` id (empty means the Paseo default model), and the
// normalized OpenCode session id used for import/send resume.
function buildPaseoMetadata({ model = '', sessionId = '' } = {}) {
  const id = sanitizePaseoModelId(model, 'opencode');
  return {
    provider: 'opencode',
    model: id ? `opencode/${id}` : '',
    sessionId: normalizeOpenCodeSessionId(sessionId)
  };
}

function buildCommand({ prompt, cwd, url = SERVER_URL, files = [], model = '', runKey, projectId, phase, task, sessionId = '' }) {
  if (model) validateModelId(model, 'Model');
  const normalizedSessionId = normalizeOpenCodeSessionId(sessionId);
  if (sessionId && !normalizedSessionId) {
    throw new Error('invalid opencode sessionId');
  }
  const paseo = buildPaseoMetadata({ model, sessionId: normalizedSessionId });
  if (EXECUTOR_URL) {
    if (typeof runKey !== 'string' || !runKey.trim()) {
      throw new Error('runKey is required in bridge mode');
    }
    const payload = { runner: 'opencode', prompt, cwd, files, url, model, runKey, projectId, phase, task };
    if (normalizedSessionId) payload.sessionId = normalizedSessionId;
    return {
      command: process.execPath,
      args: [BRIDGE_CLIENT],
      options: {
        cwd,
        env: {
          ...process.env,
          LOOPARR_EXECUTOR_URL: EXECUTOR_URL,
          LOOPARR_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
          LOOPARR_TASK_PAYLOAD: JSON.stringify(payload)
        },
        shell: false
      },
      paseo
    };
  }
  const args = ['run'];
  const attachFlag = getAttachFlag();
  if (attachFlag) args.push(attachFlag, url);
  args.push('--auto', '--format', 'json');
  if (model) args.push('--model', model);
  for (const file of files) {
    if (file) args.push('--file', file);
  }
  if (normalizedSessionId && opencodeSessionExists({ cwd, sessionId: normalizedSessionId })) {
    args.push('--session', normalizedSessionId);
  }
  args.push(String(prompt));
  return {
    command: 'opencode',
    args,
    options: { cwd, env: process.env, shell: false },
    paseo
  };
}

const RATE_LIMIT_PATTERN = /\b(?:HTTP(?:\/[\d.]+)?|status|code)["']?[\s:=]+429\b|\b429[\s\]:.+-]+(?:too\s+many\s+requests|rate[\s-]?limit|quota|usage\s+limit|tokens\s+per\s+minute|throttl)|\b(?:too\s+many\s+requests|quota\s+(?:exceeded|reached)|usage\s+limit\s+(?:exceeded|reached)|rate[\s-]?limit\s+(?:exceeded|reached|error)|tokens\s+per\s+minute\s+limit\s+(?:exceeded|reached)|throttl(?:e|ed|ing)\s+(?:error|limit|request)|budget\s+(?:exhausted|exceeded)|max[\s-]?price\s+(?:exceeded|reached)|spend(?:ing)?\s+limit\s+(?:exceeded|reached))\b/i;

// Git metadata is not runner output: an agent that commits (or diffs) inside a
// step prints commit messages and hunks to stderr, and those can quote 429
// wording -- for example the commit that widens this very pattern. Diff lines
// and commit bodies must never be read as provider errors.
const RATE_LIMIT_TAIL_LINES = 200;
const GIT_BLOCK_START_RE = /^(?:commit\s+[0-9a-f]{7,40}\b|Author:\s|Date:\s|diff --git\s|index\s+[0-9a-f]{4,}\.\.[0-9a-f]{4,}\b|new file mode\s|deleted file mode\s|similarity index\s|rename\s+(?:from|to)\s)/;
const GIT_BLOCK_BODY_RE = /^(?:@@\s|[ +\-])/;

function rateLimitSignalText(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim());
  const kept = [];
  let inGitBlock = false;
  for (const line of lines.slice(-RATE_LIMIT_TAIL_LINES)) {
    // Unified-diff content (`+`/`-`/context) is never a runner error line.
    if (/^[+\-] /.test(line)) continue;
    if (GIT_BLOCK_START_RE.test(line)) {
      inGitBlock = true;
      continue;
    }
    if (inGitBlock) {
      // Commit bodies are indented four spaces; hunks start with +, - or a space.
      if (GIT_BLOCK_BODY_RE.test(line)) continue;
      inGitBlock = false;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function isRateLimit(text) {
  return RATE_LIMIT_PATTERN.test(rateLimitSignalText(text));
}

function requestExecutor(pathname, payload) {
  const target = new URL(`${EXECUTOR_URL}${pathname}`);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`unsupported executor URL protocol: ${target.protocol}`);
  }
  const transport = target.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${EXECUTOR_TOKEN}`
      }
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (text.length < 1000) text += chunk;
      });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!text.trim()) return resolve({ ok: true });
          try {
            return resolve(JSON.parse(text));
          } catch {
            return resolve({ ok: true });
          }
        }
        reject(new Error(`executor returned HTTP ${response.statusCode}: ${text.slice(0, 500)}`));
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function requestExecutorGet(pathname) {
  const target = new URL(`${EXECUTOR_URL}${pathname}`);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`unsupported executor URL protocol: ${target.protocol}`);
  }
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        authorization: `Bearer ${EXECUTOR_TOKEN}`
      }
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (text.length < 1000) text += chunk;
      });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (!text.trim()) return resolve([]);
          try {
            return resolve(JSON.parse(text));
          } catch {
            return resolve([]);
          }
        }
        reject(new Error(`executor returned HTTP ${response.statusCode}: ${text.slice(0, 500)}`));
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function listActiveRuns({ projectId, cwd } = {}) {
  if (!EXECUTOR_URL) return [];
  try {
    const active = await requestExecutorGet('/active');
    if (!Array.isArray(active)) return [];
    const cwdNorm = cwd ? path.resolve(String(cwd)) : '';
    return active.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const pidMatch = projectId ? entry.projectId === projectId : true;
      const cwdMatch = cwdNorm ? path.resolve(String(entry.cwd || '')) === cwdNorm : true;
      return pidMatch && cwdMatch;
    });
  } catch (error) {
    console.error(`[opencode] listActiveRuns failed: ${error.message}`);
    return [];
  }
}

async function cancelStaleRuns({ projectId, cwd, keepRunKey } = {}) {
  if (!EXECUTOR_URL) return { ok: true, cancelled: [] };
  if (!projectId && !cwd) return { ok: true, cancelled: [] };
  return requestExecutor('/cancel', { projectId, cwd, keepRunKey });
}

function shutdown() {
  if (managedServer && !managedServer.killed) {
    try { managedServer.kill('SIGTERM'); } catch { /* ignore */ }
    managedServer = null;
  }
}

module.exports = {
  id: 'opencode',
  label: 'OpenCode',
  description: EXECUTOR_URL
    ? 'Host-side opencode executor via HTTP bridge; fresh opencode run per step.'
    : 'Shared opencode serve on port 4096; fresh opencode run per step.',
  models: MODELS,
  rateLimitSignalText,
  probeAttachFlag,
  setHelpProviderForTests,
  ensureServer,
  buildCommand,
  sanitizePaseoModelId,
  buildPaseoMetadata,
  isRateLimit,
  cancelStaleRuns,
  listActiveRuns,
  shutdown
};
