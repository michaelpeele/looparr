'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const MASK = '********';
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const LINE_RE = /^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;
const MAX_VALUE_LENGTH = 8192;

const KNOWN_KEYS = [
  { key: 'TS_AUTHKEY', label: 'Tailscale auth key', description: 'Reusable Tailscale auth key for the sidecar.' },
  { key: 'TS_CERT_DOMAIN', label: 'Tailscale cert domain', description: 'Tailscale Serve HTTPS hostname.' },
  { key: 'TS_EXTRA_ARGS', label: 'Tailscale extra args', description: 'Extra arguments passed to Tailscale.' },
  { key: 'LOOPARR_LOCAL_PORT', label: 'Local HTTP port', description: 'Host port mapped to the Looparr app.' },
  { key: 'PUID', label: 'Container user ID', description: 'Host UID used by the container.' },
  { key: 'PGID', label: 'Container group ID', description: 'Host GID used by the container.' },
  { key: 'LOOPARR_PROJECTS_ROOT', label: 'Projects root', description: 'Host directory mounted for projects.' },
  { key: 'LOOPARR_EXECUTOR_URL', label: 'Executor URL', description: 'Host executor bridge URL.' },
  { key: 'LOOPARR_EXECUTOR_TOKEN', label: 'Executor token', description: 'Bearer token for the host executor bridge.' },
  { key: 'LOOPARR_EXECUTOR_BIND', label: 'Executor bind address', description: 'Optional host executor bind address.' },
  { key: 'LOOPARR_EXECUTOR_OPENCODE_BIN', label: 'OpenCode binary', description: 'Optional host executor OpenCode path.' },
  { key: 'OPENCODE_PASSWORD', label: 'OpenCode service password', description: 'Password used when attaching to an existing OpenCode service.' }
];

function envPath() {
  return process.env.ENV_PATH
    ? path.resolve(process.env.ENV_PATH)
    : path.join(__dirname, '..', '.env');
}

function metadata(key) {
  return KNOWN_KEYS.find((item) => item.key === key) || {
    key,
    label: key,
    description: 'Existing .env key. Values stay masked unless revealed.'
  };
}

function parseLine(line) {
  const match = LINE_RE.exec(line);
  if (!match) return null;
  let value = match[3].trim();
  if (value.length >= 2) {
    const quote = value[0];
    if (quote === '"' && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (quote === "'" && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
  }
  return { prefix: match[1], key: match[2], value };
}

function readEnv() {
  let content = '';
  try {
    content = fs.readFileSync(envPath(), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = content.split(/\r?\n/);
  const values = new Map();
  lines.forEach((line, index) => {
    const parsed = parseLine(line);
    if (parsed) values.set(parsed.key, { ...parsed, index });
  });
  return { lines, values, newline: content.includes('\r\n') ? '\r\n' : '\n' };
}

function formatValue(value) {
  return /^[A-Za-z0-9_./:@+=-]+$/.test(value) ? value : JSON.stringify(value);
}

function writeEnv(env) {
  const target = envPath();
  const temp = path.join(os.tmpdir(), `looparr-env-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, env.lines.join(env.newline), { mode: 0o600 });
    fs.copyFileSync(temp, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* no temp file */ }
    throw error;
  }
}

function list() {
  const env = readEnv();
  const keys = KNOWN_KEYS.map((item) => item.key);
  for (const key of env.values.keys()) {
    if (ENV_KEY_RE.test(key) && !keys.includes(key)) keys.push(key);
  }
  return keys.map((key) => {
    const found = env.values.get(key);
    const configured = Boolean(found && found.value !== '');
    return {
      ...metadata(key),
      configured,
      value: configured ? MASK : ''
    };
  });
}

function validateKey(key) {
  return typeof key === 'string' && ENV_KEY_RE.test(key);
}

function validateUpdates(updates) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    return { ok: false, error: 'updates must be an object' };
  }
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    if (!validateKey(key)) return { ok: false, error: `Invalid .env key: ${key}` };
    if (value !== null && typeof value !== 'string') {
      return { ok: false, error: `${key} must be a string` };
    }
    const next = value === null ? '' : value;
    if (/[\r\n]/.test(next)) return { ok: false, error: `${key} cannot contain line breaks` };
    if (next.length > MAX_VALUE_LENGTH) {
      return { ok: false, error: `${key} must be at most ${MAX_VALUE_LENGTH} characters` };
    }
  }
  return { ok: true, entries };
}

function reveal(key) {
  if (!validateKey(key)) return { ok: false, error: 'Invalid .env key' };
  const found = readEnv().values.get(key);
  if (!found || found.value === '') return { ok: false, error: `${key} is not set` };
  return { ok: true, value: found.value };
}

function update(updates) {
  const checked = validateUpdates(updates);
  if (!checked.ok) return checked;

  const env = readEnv();
  const changed = [];
  for (const [key, rawValue] of checked.entries) {
    const value = rawValue === null ? '' : rawValue;
    const found = env.values.get(key);
    if (found && found.value === value) continue;
    if (value === '') {
      if (found) {
        env.lines[found.index] = '';
        env.values.delete(key);
        changed.push(key);
      }
      continue;
    }
    const line = `${found ? found.prefix : ''}${key}=${formatValue(value)}`;
    if (found) {
      env.lines[found.index] = line;
    } else {
      const insertAt = env.lines.length && env.lines[env.lines.length - 1] === ''
        ? env.lines.length - 1
        : env.lines.length;
      env.lines.splice(insertAt, 0, line);
    }
    env.values.set(key, { key, value });
    changed.push(key);
  }

  if (changed.length) writeEnv(env);
  return { ok: true, updated: changed, entries: list() };
}

module.exports = { list, reveal, update, MASK };
