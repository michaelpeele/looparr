'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { validateModelId } = require('../model-list');

const SERVER_PORT = 4096;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const PROBE_URL = `http://127.0.0.1:${SERVER_PORT}/`;
const EXECUTOR_URL = process.env.LOOPARR_EXECUTOR_URL
  ? String(process.env.LOOPARR_EXECUTOR_URL).replace(/\/+$/, '')
  : null;
const EXECUTOR_TOKEN = process.env.LOOPARR_EXECUTOR_TOKEN || '';
const BRIDGE_CLIENT = path.join(__dirname, '..', '..', 'scripts', 'bridge-client.js');

let attachFlag = null;
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

function getAttachFlag() {
  if (attachFlag) return attachFlag;
  try {
    const help = execFileSync('opencode', ['run', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    attachFlag = help.includes('--attach') ? '--attach' : '--server';
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

function buildCommand({ prompt, cwd, url = SERVER_URL, files = [], model = '', runKey, projectId, phase, task }) {
  if (model) validateModelId(model, 'Model');
  if (EXECUTOR_URL) {
    if (typeof runKey !== 'string' || !runKey.trim()) {
      throw new Error('runKey is required in bridge mode');
    }
    return {
      command: process.execPath,
      args: [BRIDGE_CLIENT],
      options: {
        cwd,
        env: {
          ...process.env,
          LOOPARR_EXECUTOR_URL: EXECUTOR_URL,
          LOOPARR_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
          LOOPARR_TASK_PAYLOAD: JSON.stringify({ prompt, cwd, files, url, model, runKey, projectId, phase, task })
        },
        shell: false
      }
    };
  }
  const args = ['run', getAttachFlag(), url, '--auto'];
  if (model) args.push('--model', model);
  for (const file of files) {
    if (file) args.push('--file', file);
  }
  args.push(String(prompt));
  return {
    command: 'opencode',
    args,
    options: { cwd, env: process.env, shell: false }
  };
}

const RATE_LIMIT_PATTERN = /\b(?:HTTP(?:\/[\d.]+)?|status|code)[\s:=]+429\b|\b429[\s:.+-]+(?:too\s+many\s+requests|rate[\s-]?limit|quota|usage\s+limit|throttl)|\b(?:too\s+many\s+requests|quota\s+(?:exceeded|reached)|usage\s+limit\s+(?:exceeded|reached)|rate[\s-]?limit\s+(?:exceeded|reached|error)|throttl(?:e|ed|ing)\s+(?:error|limit|request))\b/i;

function isRateLimit(text) {
  return RATE_LIMIT_PATTERN.test(String(text));
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
  ensureServer,
  buildCommand,
  isRateLimit,
  cancelStaleRuns,
  listActiveRuns,
  shutdown
};
