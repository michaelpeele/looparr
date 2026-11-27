#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLIENT = path.join(__dirname, 'bridge-client.js');
const TOKEN = 'bridge-connect-retry-test-token';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function startFakeExecutor(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ stream: 'out', text: 'bridge retry ok' })}\n`);
      res.end(`${JSON.stringify({ exit: 0 })}\n`);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function runBridge(port, retryWindowMs) {
  return spawn(process.execPath, [CLIENT], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      LOOPARR_EXECUTOR_URL: `http://127.0.0.1:${port}`,
      LOOPARR_EXECUTOR_TOKEN: TOKEN,
      LOOPARR_TASK_PAYLOAD: JSON.stringify({
        runKey: 'bridge-connect-retry-test',
        projectId: 'test-project',
        cwd: process.cwd()
      }),
      LOOPARR_EXECUTOR_CONNECT_RETRY_MS: String(retryWindowMs),
      LOOPARR_EXECUTOR_CONNECT_RETRY_DELAY_MS: '20'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function main() {
  const port = await freePort();
  const retryChild = runBridge(port, 2000);
  await wait(150);
  const server = await startFakeExecutor(port);
  const retryResult = await waitForExit(retryChild);
  await closeServer(server);
  assert.equal(retryResult.code, 0, retryResult.stderr);
  assert.match(retryResult.stdout, /bridge retry ok/);

  const deadPort = await freePort();
  const deadChild = runBridge(deadPort, 200);
  const deadResult = await waitForExit(deadChild);
  assert.equal(deadResult.code, 1);
  assert.match(deadResult.stderr, /executor connection failed after 200ms/);
  assert.match(deadResult.stderr, /ECONNREFUSED/);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
