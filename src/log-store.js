'use strict';

// Log files with size rotation: persist the UI log buffer as NDJSON so a
// container restart keeps history. One directory per project, one file per
// 10 MiB segment, timestamped file names, 7-day age-out by mtime.

const fs = require('fs');
const path = require('path');
const configStore = require('./config');

const LOG_DIR = process.env.LOOPARR_LOG_DIR
  || path.join(path.dirname(configStore.CONFIG_PATH), 'logs');     // data/logs in prod
const LOG_MAX_BYTES = Number(process.env.LOOPARR_LOG_MAX_BYTES) || 10 * 1024 * 1024; // 10 MiB
const LOG_RETENTION_MS = (Number(process.env.LOOPARR_LOG_RETENTION_DAYS) || 7) * 86_400_000;

const projects = new Map(); // projectId -> { path, bytes }
let pruneTimestamp = 0;

function sanitizeProjectId(projectId) {
  return String(projectId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function logDir() {
  return LOG_DIR;
}

function projectDir(projectId) {
  return path.join(LOG_DIR, sanitizeProjectId(projectId));
}

function timestampFilename(at = Date.now()) {
  const now = new Date(at);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const sss = String(now.getMilliseconds()).padStart(3, '0');
  return `${yyyy}-${mm}-${dd}T${hh}-${mi}-${ss}-${sss}`;
}

function fileFor(projectId, at = Date.now()) {
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const base = timestampFilename(at);
  let candidate = path.join(dir, `${base}.log`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(dir, `${base}-${suffix}.log`);
  }
  return candidate;
}

function statBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function listLogFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.log'))
    .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function getRecord(projectId) {
  let rec = projects.get(projectId);
  if (rec) return rec;

  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const files = fs.existsSync(dir) ? listLogFiles(dir) : [];

  if (files.length === 0) {
    const newPath = fileFor(projectId);
    rec = { path: newPath, bytes: 0 };
    projects.set(projectId, rec);
    return rec;
  }

  // First use after a restart: stat the newest file; if it is at or over the
  // cap, start a new one, otherwise keep appending to it.
  const newest = files[0];
  const bytes = statBytes(newest.path);
  if (bytes >= LOG_MAX_BYTES) {
    const newPath = fileFor(projectId);
    rec = { path: newPath, bytes: 0 };
  } else {
    rec = { path: newest.path, bytes };
  }
  projects.set(projectId, rec);
  return rec;
}

function openNewFile(projectId) {
  const newPath = fileFor(projectId);
  const rec = { path: newPath, bytes: 0 };
  projects.set(projectId, rec);
  return rec;
}

function append(projectId, entry) {
  try {
    const rec = getRecord(projectId);
    const line = JSON.stringify(entry) + '\n';
    const size = Buffer.byteLength(line, 'utf8');

    if (rec.bytes + size > LOG_MAX_BYTES) {
      const newRec = openNewFile(projectId);
      fs.appendFileSync(newRec.path, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
      newRec.bytes = size;
    } else {
      fs.appendFileSync(rec.path, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
      rec.bytes += size;
    }
  } catch (err) {
    if (!append.errorLogged) append.errorLogged = new Set();
    if (!append.errorLogged.has(projectId)) {
      append.errorLogged.add(projectId);
      console.error(`[looparr] log write failed for project ${projectId}: ${err.message}`);
    }
  }
}

function readRecent(projectId, limit) {
  const dir = projectDir(projectId);
  if (!fs.existsSync(dir)) return [];

  const files = listLogFiles(dir);
  if (files.length === 0) return [];

  const newest = files[0];
  let content;
  try {
    content = fs.readFileSync(newest.path, 'utf8');
  } catch {
    return [];
  }

  const lines = content.trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed
        && typeof parsed.seq === 'number'
        && typeof parsed.ts === 'number'
        && parsed.stream
        && typeof parsed.text === 'string') {
        entries.push(parsed);
      }
    } catch {
      // skip corrupt or partial trailing lines
    }
  }
  return entries.slice(-limit);
}

function prune() {
  const now = Date.now();
  if (pruneTimestamp !== 0 && now - pruneTimestamp < 3_600_000) return;
  pruneTimestamp = now;

  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const projectDirs = fs.readdirSync(LOG_DIR);
    for (const projDir of projectDirs) {
      const fullProjDir = path.join(LOG_DIR, projDir);
      if (!fs.statSync(fullProjDir).isDirectory()) continue;

      // Never delete the currently open file, whichever project owns it.
      let activePath = null;
      for (const [projectId, rec] of projects) {
        if (sanitizeProjectId(projectId) === projDir) {
          activePath = rec?.path;
          break;
        }
      }

      const files = listLogFiles(fullProjDir);
      for (const file of files) {
        if (file.path === activePath) continue;
        if (now - file.mtime > LOG_RETENTION_MS) {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
      }

      const remaining = fs.readdirSync(fullProjDir).filter(f => f.endsWith('.log'));
      if (remaining.length === 0) {
        try { fs.rmdirSync(fullProjDir); } catch { /* ignore */ }
      }
    }
  } catch {
    // prune must never throw
  }
}

function closeAll() {
  projects.clear();
}

module.exports = {
  logDir,
  fileFor,
  append,
  readRecent,
  prune,
  closeAll,
  LOG_MAX_BYTES,
  LOG_RETENTION_MS
};
