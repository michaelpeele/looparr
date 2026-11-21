'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PROJECTS_ROOT = '/home/michaelpeele/ai-projects';
const DEFAULT_OPENCODE_BIN = '/home/michaelpeele/.opencode/bin/opencode';
const SERVER_PORT = 4096;
const PROBE_URL = 'http://127.0.0.1:4096/';
const MAX_BODY_BYTES = 10 * 1024 * 1024;

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

const port = Number(process.env.LOOPARR_EXECUTOR_PORT || 4187);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail('LOOPARR_EXECUTOR_PORT must be an integer from 1 to 65535');
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

let projectsRoot;
try {
  projectsRoot = fs.realpathSync(process.env.LOOPARR_PROJECTS_ROOT || DEFAULT_PROJECTS_ROOT);
} catch {
  fail(`Projects root not found: ${process.env.LOOPARR_PROJECTS_ROOT || DEFAULT_PROJECTS_ROOT}`);
}

const activeChildren = new Set();
let attachFlag = null;
let serverPromise = null;
let managedServer = null;

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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

async function probeServer() {
  try {
    const response = await fetch(PROBE_URL, { method: 'GET', signal: AbortSignal.timeout(1000) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const tick = async () => {
      if (await probeServer()) return resolve();
      if (child && child.exitCode !== null) return reject(new Error('opencode serve exited before becoming ready'));
      if (Date.now() > deadline) return reject(new Error('opencode serve did not become ready in 15s'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

function getAttachFlag() {
  if (attachFlag) return attachFlag;
  try {
    const help = execFileSync(opencodeBin, ['run', '--help'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    attachFlag = help.includes('--attach') ? '--attach' : '--server';
  } catch {
    attachFlag = '--attach';
  }
  return attachFlag;
}

async function ensureServer() {
  if (await probeServer()) return PROBE_URL;
  if (serverPromise) return serverPromise;
  serverPromise = (async () => {
    managedServer = spawn(opencodeBin, ['serve', '--port', String(SERVER_PORT)], {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    managedServer.stdout.on('data', (chunk) => {
      process.stdout.write(`[opencode] ${chunk.toString()}`);
    });
    managedServer.stderr.on('data', (chunk) => {
      process.stderr.write(`[opencode] ${chunk.toString()}`);
    });
    managedServer.once('exit', (code, signal) => {
      managedServer = null;
      serverPromise = null;
      process.stderr.write(`[opencode] serve exited (code=${code}, signal=${signal || 'none'})\n`);
    });
    await waitForServer(managedServer);
    return PROBE_URL;
  })();
  try {
    return await serverPromise;
  } catch (error) {
    serverPromise = null;
    throw error;
  }
}

function frame(res, value) {
  res.write(`${JSON.stringify(value)}\n`);
}

function validateRun(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('payload must be an object');
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

  return { prompt: payload.prompt, cwd, files: checkedFiles };
}

async function handleRun(req, res) {
  if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' });
  let payload;
  try {
    payload = validateRun(await readJson(req));
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }

  let serverUrl;
  try {
    serverUrl = await ensureServer();
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }

  const flag = getAttachFlag();
  const args = ['run', flag, serverUrl, '--auto'];
  for (const file of payload.files) args.push('--file', file);
  args.push(payload.prompt);

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.flushHeaders?.();

  const child = spawn(opencodeBin, args, {
    cwd: payload.cwd,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  activeChildren.add(child);

  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    activeChildren.delete(child);
    frame(res, { exit: code });
    res.end();
  };

  child.stdout.on('data', (chunk) => frame(res, { stream: 'out', text: chunk.toString() }));
  child.stderr.on('data', (chunk) => frame(res, { stream: 'err', text: chunk.toString() }));
  child.on('error', (error) => {
    frame(res, { stream: 'err', text: `[host-executor] ${error.message}\n` });
    finish(1);
  });
  child.on('close', (code, signal) => {
    if (finished) return;
    if (signal && code === null) {
      frame(res, { stream: 'err', text: `[host-executor] opencode run terminated by ${signal}\n` });
    }
    finish(Number.isInteger(code) ? code : 1);
  });
  req.on('aborted', () => {
    if (!finished) child.kill('SIGTERM');
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, projectsRoot, opencodeBin });
  }
  if (req.url === '/run' && req.method === 'POST') {
    return handleRun(req, res);
  }
  return sendJson(res, 404, { error: 'not found' });
});

server.listen(port, bind, () => {
  process.stdout.write(`[host-executor] listening on http://${bind}:${port}\n`);
});

server.on('error', (error) => fail(`server error: ${error.message}`));

function shutdown() {
  for (const child of activeChildren) child.kill('SIGTERM');
  if (managedServer) managedServer.kill('SIGTERM');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
