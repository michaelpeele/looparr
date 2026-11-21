'use strict';

const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

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

function buildCommand({ prompt, cwd, url = SERVER_URL, files = [] }) {
  if (EXECUTOR_URL) {
    return {
      command: process.execPath,
      args: [BRIDGE_CLIENT],
      options: {
        cwd,
        env: {
          ...process.env,
          LOOPARR_EXECUTOR_URL: EXECUTOR_URL,
          LOOPARR_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
          LOOPARR_TASK_PAYLOAD: JSON.stringify({ prompt, cwd, files, url })
        },
        shell: false
      }
    };
  }
  const args = ['run', getAttachFlag(), url, '--auto'];
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

function isRateLimit(text) {
  return /\b429\b|rate[\s-]?limit|too many requests|quota exceeded|usage limit|throttl(?:e|ed|ing)/i.test(String(text));
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
  shutdown
};
