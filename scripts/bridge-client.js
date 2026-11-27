'use strict';

const http = require('http');
const https = require('https');

const MAX_RUN_KEY_LENGTH = 128;
const RUN_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const CONNECT_RETRY_WINDOW_MS = readPositiveInt(process.env.LOOPARR_EXECUTOR_CONNECT_RETRY_MS, 10000);
const CONNECT_RETRY_DELAY_MS = readPositiveInt(process.env.LOOPARR_EXECUTOR_CONNECT_RETRY_DELAY_MS, 250);

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateRunKey(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_RUN_KEY_LENGTH || !RUN_KEY_PATTERN.test(value)) {
    throw new Error('runKey is missing or invalid');
  }
  return value;
}

function requestRun(executorUrl, token, payload) {
  const target = new URL(`${executorUrl.replace(/\/+$/, '')}/run`);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`unsupported executor URL protocol: ${target.protocol}`);
  }
  const transport = target.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${token}`
      }
    }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res);
      let errorBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (errorBody.length < 500) errorBody += chunk;
      });
      res.on('end', () => reject(new Error(`executor returned HTTP ${res.statusCode}: ${errorBody.slice(0, 500)}`)));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function requestRunWithConnectRetry(executorUrl, token, payload) {
  const deadline = Date.now() + CONNECT_RETRY_WINDOW_MS;
  for (;;) {
    try {
      return await requestRun(executorUrl, token, payload);
    } catch (error) {
      const retryable = error && error.code === 'ECONNREFUSED';
      if (!retryable || Date.now() >= deadline) {
        if (retryable) {
          throw new Error(`executor connection failed after ${CONNECT_RETRY_WINDOW_MS}ms: ${error.message}`);
        }
        throw error;
      }
      await wait(Math.min(CONNECT_RETRY_DELAY_MS, deadline - Date.now()));
    }
  }
}

function cancelExecutorRun(executorUrl, token, payload) {
  const target = new URL(`${executorUrl.replace(/\/+$/, '')}/cancel`);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
  const transport = target.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  return new Promise((resolve) => {
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${token}`
      },
      timeout: 3000
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } resolve(); });
    req.on('error', () => resolve());
    req.end(body);
  });
}

async function main() {
  const executorUrl = process.env.LOOPARR_EXECUTOR_URL;
  if (!executorUrl) throw new Error('LOOPARR_EXECUTOR_URL is not set');

  const token = process.env.LOOPARR_EXECUTOR_TOKEN || '';
  const payload = JSON.parse(process.env.LOOPARR_TASK_PAYLOAD || 'null');
  if (!payload || typeof payload !== 'object') {
    throw new Error('LOOPARR_TASK_PAYLOAD is missing or invalid');
  }

  const runKey = validateRunKey(payload.runKey);
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await cancelExecutorRun(executorUrl, token, {
        runKey,
        projectId: typeof payload.projectId === 'string' ? payload.projectId : '',
        cwd: typeof payload.cwd === 'string' ? payload.cwd : ''
      });
    } catch { /* ignore */ }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGTERM', () => { shutdown('SIGTERM'); });
  process.once('SIGINT', () => { shutdown('SIGINT'); });

  const response = await requestRunWithConnectRetry(executorUrl, token, { ...payload, runKey });
  response.setEncoding('utf8');

  let buffer = '';
  let sawExit = false;
  let exitCode = 1;

  const handleLine = (line) => {
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      process.stderr.write(`[bridge] invalid frame: ${line.slice(0, 500)}\n`);
      return;
    }
    if (frame.stream === 'out') {
      process.stdout.write(String(frame.text || ''));
    } else if (frame.stream === 'err') {
      process.stderr.write(String(frame.text || ''));
    } else if (Object.prototype.hasOwnProperty.call(frame, 'exit')) {
      sawExit = true;
      exitCode = Number.isInteger(frame.exit) ? frame.exit : 1;
    }
  };

  for await (const chunk of response) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);

  if (!sawExit) throw new Error('executor stream ended without an exit frame');
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`[bridge] ${error.message}\n`);
  process.exitCode = 1;
});
