'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SESSION_ID_PATTERN = /^ses[A-Za-z0-9._-]{1,127}$/;
const MAX_CAPTURE_BUFFER = 64 * 1024;
const SESSION_LIST_TIMEOUT_MS = 3000;

function normalizeOpenCodeSessionId(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  return SESSION_ID_PATTERN.test(candidate) ? candidate : '';
}

function isValidOpenCodeSessionId(value) {
  return normalizeOpenCodeSessionId(value) !== '';
}

function extractSessionIdFromLine(line) {
  if (typeof line !== 'string' || !line.trim()) return '';
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  return normalizeOpenCodeSessionId(parsed.sessionID);
}

function createOpenCodeSessionCapture() {
  let buffer = '';
  let sessionId = '';
  let finished = false;

  function consider(line) {
    if (sessionId) return;
    const found = extractSessionIdFromLine(line);
    if (found) sessionId = found;
  }

  function push(chunk) {
    if (finished) return;
    buffer += chunk == null ? '' : String(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      consider(line);
      index = buffer.indexOf('\n');
    }
    if (buffer.length > MAX_CAPTURE_BUFFER) buffer = buffer.slice(-MAX_CAPTURE_BUFFER);
  }

  function finish() {
    if (finished) return sessionId;
    if (buffer.trim()) consider(buffer);
    buffer = '';
    finished = true;
    return sessionId;
  }

  return {
    push,
    finish,
    get sessionId() {
      return sessionId;
    }
  };
}

function opencodeSessionExists({ cwd, sessionId, bin = 'opencode' } = {}) {
  const normalized = normalizeOpenCodeSessionId(sessionId);
  if (!normalized || !cwd) return false;
  let stdout;
  try {
    stdout = execFileSync(bin, ['session', 'list', '--format', 'json', '--standalone'], {
      cwd,
      encoding: 'utf8',
      timeout: SESSION_LIST_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    return false;
  }
  let rows;
  try {
    rows = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (!Array.isArray(rows)) return false;
  const resolvedCwd = path.resolve(cwd);
  return rows.some((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.id !== normalized) return false;
    if (typeof row.directory !== 'string' || !row.directory.trim()) return true;
    try {
      return path.resolve(row.directory) === resolvedCwd;
    } catch {
      return false;
    }
  });
}

module.exports = {
  SESSION_ID_PATTERN,
  normalizeOpenCodeSessionId,
  isValidOpenCodeSessionId,
  extractSessionIdFromLine,
  createOpenCodeSessionCapture,
  opencodeSessionExists
};
