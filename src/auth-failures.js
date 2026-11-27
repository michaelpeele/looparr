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

// Runner transcripts echo prompts and logs as structured JSON. Auth words in
// those records are conversation data, not CLI auth failures. Records can be
// whole lines, embedded after a prefix, pretty-printed, or truncated.
const TRANSCRIPT_TYPES = new Set([
  'tool_use', 'tool_result', 'effect', 'message', 'step', 'result', 'user', 'assistant', 'reasoning'
]);
const TRANSCRIPT_KEYS = [
  'sessionID', 'sessionId', 'turnId', 'messageID', 'partID', 'inputEntryId', 'part'
];
const TRANSCRIPT_MARKER_RE = new RegExp(
  `"(?:${TRANSCRIPT_KEYS.join('|')})"\\s*:`
  + `|"type"\\s*:\\s*"(?:${[...TRANSCRIPT_TYPES].join('|')})"`
  + '|"role"\\s*:\\s*"(?:user|assistant)"',
  'i'
);
const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;

function emptyState() {
  return { version: 2, failures: {} };
}

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const stored = raw && typeof raw.failures === 'object' && raw.failures ? raw.failures : {};
    const failures = {};
    // Older builds stored transcript echoes as auth failures. Drop any sticky
    // block whose recorded evidence is no longer an auth failure.
    for (const [id, entry] of Object.entries(stored)) {
      if (!entry || typeof entry !== 'object') continue;
      if (!detect(String(entry.message || ''))) continue;
      failures[id] = entry;
    }
    state = { version: 2, failures };
    save();
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

function stripAnsi(value) {
  return String(value || '').replace(ANSI_RE, '');
}

function jsonSpanEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { depth += 1; continue; }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  // Truncated tail: drop it too when it is clearly a transcript record.
  return text.length;
}

function transcriptSpans(text) {
  const spans = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    const end = jsonSpanEnd(text, i);
    if (end <= i) continue;
    const raw = text.slice(i, end);
    if (TRANSCRIPT_MARKER_RE.test(raw)) {
      spans.push({ start: i, end });
      i = end - 1;
    }
  }
  return spans;
}

function authRelevantText(text) {
  const cleaned = stripAnsi(text);
  const spans = transcriptSpans(cleaned);
  if (!spans.length) return cleaned;
  let kept = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    kept += `${cleaned.slice(cursor, span.start)}\n`;
    cursor = span.end;
  }
  return kept + cleaned.slice(cursor);
}

function looksLikeFetchedHtml(text) {
  const value = String(text || '');
  return /<html[\s>]|<!doctype html|<body[\s>]/i.test(value);
}

function detect(text) {
  const raw = authRelevantText(text);
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
  const raw = authRelevantText(text);
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
