#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-plan-archive-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const PLAN_PATH = path.join(DEMO_DIR, 'plan.md');
const BASE_URL = 'http://127.0.0.1:4202';

process.env.PORT = '4202';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

let server = null;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function api(method, route, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${route}`, options);
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: response.status, body: payload };
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  server.stderr.on('data', (chunk) => { stderr += String(chunk); });
  server.on('exit', (code) => {
    if (code !== 0 && !process.exitCode) {
      console.error(stderr);
    }
  });
  await waitForServer();
}

async function stopServer() {
  if (!server) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  server = null;
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ projects: [{ id: 'demo', name: 'Demo', path: DEMO_DIR }] }, null, 2));
  const original = '# Plan\n\n- [ ] Task one\n- [x] Task two\n';
  fs.writeFileSync(PLAN_PATH, original, 'utf8');

  await startServer();

  const first = await api('POST', '/api/projects/demo/plan/archive');
  assertEqual(first.status, 200, 'archive status');
  assertEqual(first.body.ok, true, 'archive ok');
  assert.match(String(first.body.archivePath), /^\.project_documents\/PLAN-\d{8}-\d{6}(?:-\d+)?\.md$/, 'archive path format');
  assertEqual(first.body.cleared, true, 'archive cleared');
  const archivePath = path.join(DEMO_DIR, first.body.archivePath);
  assertEqual(fs.existsSync(archivePath), true, 'archive file exists');
  assertEqual(fs.readFileSync(archivePath, 'utf8'), original, 'archive content identical');
  assertEqual(fs.readFileSync(PLAN_PATH, 'utf8'), '', 'plan cleared');

  const missing = await api('POST', '/api/projects/demo/plan/archive');
  assertEqual(missing.status, 400, 'empty/missing archive status');
  assertEqual(missing.body.ok, false, 'empty/missing archive ok');
  assertEqual(fs.readdirSync(path.join(DEMO_DIR, '.project_documents')).length, 1, 'no new archive on missing plan');

  const content = '# Plan\n\n- [ ] Collision task\n';
  fs.writeFileSync(PLAN_PATH, content, 'utf8');
  const second = await api('POST', '/api/projects/demo/plan/archive');
  assertEqual(second.status, 200, 'second archive status');
  fs.writeFileSync(PLAN_PATH, content, 'utf8');
  const third = await api('POST', '/api/projects/demo/plan/archive');
  assertEqual(third.status, 200, 'third archive status');
  assert.notEqual(second.body.archiveName, third.body.archiveName, 'collision-safe names');
  const names = fs.readdirSync(path.join(DEMO_DIR, '.project_documents')).sort();
  assert.ok(names.includes(second.body.archiveName), 'second archive present');
  assert.ok(names.includes(third.body.archiveName), 'third archive present');
  assertEqual(fs.readFileSync(path.join(DEMO_DIR, '.project_documents', second.body.archiveName), 'utf8'), content, 'second archive content');
  assertEqual(fs.readFileSync(path.join(DEMO_DIR, '.project_documents', third.body.archiveName), 'utf8'), content, 'third archive content');

  console.log('test-plan-archive: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await stopServer().catch(() => {});
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});
