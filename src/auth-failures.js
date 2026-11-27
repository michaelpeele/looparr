'use strict';

const fs = require('fs');
const path = require('path');

const STATE_PATH = process.env.LOOPARR_AUTH_FAILURES_STATE
  || path.join(path.dirname(process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json')), 'auth-failures.json');

let state = null;

const SIGNATURES = [
  'invalid_token',
  'your authentication token is invalid',
  'sign in again',
  'invalid api key',
  'unauthorized'
];

const HINTS = {
  kilo: 'Open CLI and /models, pick Kilo gateway and reauthenticate.'
};

function emptyState() {
  return { version: 1, failures: {} };
}

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const failures = raw && typeof raw.failures === 'object' && raw.failures ? { ...raw.failures } : {};
    state = { version: 1, failures };
  } catch {
    state = emptyState();
  }
  return state;
}

function save() {
  if (!state) return;
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch { /* best effort */ }
    fs.renameSync(temp, STATE_PATH);
  } catch {
    // Auth-failure state must never break a run.
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeFetchedHtml(text) {
  const value = String(text || '');
  return /<html[\s>]|<!doctype html|<body[\s>]/i.test(value);
}

function detect(text) {
  const raw = String(text || '');
  const haystack = raw.toLowerCase();
  if (!haystack) return false;
  const hasSignature = SIGNATURES.some((sig) => haystack.includes(sig));
  if (!hasSignature) return false;
  // Never match bare 401/generic unauthorized inside fetched HTML/tool page bodies.
  if (looksLikeFetchedHtml(raw)) {
    const hasStrong = haystack.includes('invalid_token')
      || haystack.includes('your authentication token is invalid')
      || haystack.includes('sign in again')
      || haystack.includes('invalid api key');
    if (!hasStrong) return false;
  }
  // Bare "401" alone is never a signature. Generic HTTP 401/unauthorized in
  // fetched HTML/tool bodies is noisy; accept unauthorized when it appears as an
  // auth failure signal, but not when it's just an HTTP status line in arbitrary content.
  if (!haystack.includes('invalid_token')
    && !haystack.includes('your authentication token is invalid')
    && !haystack.includes('sign in again')
    && !haystack.includes('invalid api key')) {
    if (haystack.includes('unauthorized')) {
      const hasBare401 = /\b401\b/.test(haystack);
      const hasAuthContext = /token|api key|credential|authenticat|sign in|login/.test(haystack);
      // "HTTP 401 Unauthorized" is a common auth failure shape; allow it.
      // Reject only bare 401 in fetched/html/no-auth-context noise.
      if (hasBare401 && !hasAuthContext && looksLikeFetchedHtml(raw)) return false;
      if (hasBare401 && !hasAuthContext && !/\bunauthorized\b/i.test(raw)) return false;
    }
  }
  return true;
}

function extractMessage(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = lines.find((line) => detect(line));
  const picked = match || lines.find((line) => /invalid|unauthorized|sign in|token/i.test(line)) || '';
  return normalizeText(picked).slice(0, 240);
}

function hintFor(runnerId) {
  const key = String(runnerId || '').toLowerCase();
  return HINTS[key] || 'Reauthenticate the runner CLI, then press Start.';
}

function record(runnerId, info = {}) {
  const id = String(runnerId || '').trim();
  if (!id) return null;
  const current = load();
  const entry = {
    runnerId: id,
    runnerLabel: String(info.runnerLabel || id).trim() || id,
    at: new Date().toISOString(),
    message: normalizeText(info.message).slice(0, 240),
    hint: String(info.hint || hintFor(id)).trim()
  };
  current.failures[id] = entry;
  save();
  return entry;
}

function get(runnerId) {
  const id = String(runnerId || '').trim();
  if (!id) return null;
  const current = load();
  const entry = current.failures[id];
  return entry && typeof entry === 'object' ? { ...entry } : null;
}

function list() {
  const current = load();
  return Object.values(current.failures)
    .filter((entry) => entry && typeof entry === 'object' && entry.runnerId)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => String(a.runnerId).localeCompare(String(b.runnerId)));
}

function isBlocked(runnerId) {
  return Boolean(get(runnerId));
}

function clear(runnerId) {
  const id = String(runnerId || '').trim();
  const current = load();
  if (!id) {
    state = emptyState();
    save();
    return true;
  }
  if (!current.failures[id]) return false;
  delete current.failures[id];
  save();
  return true;
}

function reset() {
  state = emptyState();
  save();
}

module.exports = {
  STATE_PATH,
  SIGNATURES,
  detect,
  extractMessage,
  hintFor,
  record,
  get,
  list,
  isBlocked,
  clear,
  reset,
  load,
  save
};
