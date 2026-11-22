'use strict';

const http = require('http');
const https = require('https');

const MAX_RUN_KEY_LENGTH = 128;
const RUN_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

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

async function main() {
  const executorUrl = process.env.LOOPARR_EXECUTOR_URL;
  if (!executorUrl) throw new Error('LOOPARR_EXECUTOR_URL is not set');

  const token = process.env.LOOPARR_EXECUTOR_TOKEN || '';
  const payload = JSON.parse(process.env.LOOPARR_TASK_PAYLOAD || 'null');
  if (!payload || typeof payload !== 'object') {
    throw new Error('LOOPARR_TASK_PAYLOAD is missing or invalid');
  }

  const runKey = validateRunKey(payload.runKey);
  const response = await requestRun(executorUrl, token, { ...payload, runKey });
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
