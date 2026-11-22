'use strict';

const fs = require('fs');
const path = require('path');

const STATE_NAME = 'auto-resume-state.json';
const LOG_NAME = 'auto-resume.log';
const LOG_MAX_BYTES = 64 * 1024;
const TASK_MAX_CHARS = 240;
const STATE_TASK_MAX_CHARS = 2000;
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const PHASES = new Set(['seed', 'analyze', 'implement']);
const REASONS = new Set(['planned-restart', 'container-shutdown']);

function shouldCaptureResumeIntent() {
  return process.env.HOSTNAME === 'looparr' || process.env.LOOPARR_ALLOW_RESUME_INTENT === '1';
}

function looparrDir(project) {
  return path.join(project.path, '.looparr');
}

function statePath(project) {
  return path.join(looparrDir(project), STATE_NAME);
}

function logPath(project) {
  return path.join(looparrDir(project), LOG_NAME);
}

function redactText(value, maxChars) {
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  text = text.replace(/Authorization\s*:\s*[^\s,;]+/gi, 'Authorization: [redacted]');
  text = text.replace(/https?:\/\/[^\s'"<>]+/gi, '[url]');
  text = text.replace(/\b(token|secret|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]');
  return text.trim().slice(0, maxChars);
}

function auditEntry(project, event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event: String(event),
    projectId: String(fields.projectId ?? project.id ?? ''),
    projectName: redactText(fields.projectName ?? project.name ?? '', 120),
    phase: PHASES.has(fields.phase) ? fields.phase : undefined,
    task: redactText(fields.task ?? '', TASK_MAX_CHARS) || undefined,
    reason: REASONS.has(fields.reason) ? fields.reason : undefined,
    pid: Number.isInteger(fields.pid) ? fields.pid : process.pid,
    hostname: redactText(fields.hostname ?? process.env.HOSTNAME ?? '', 60) || undefined
  };
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  return entry;
}

function appendAudit(project, event, fields = {}) {
  const file = logPath(project);
  const line = JSON.stringify(auditEntry(project, event, fields));
  try {
    fs.mkdirSync(looparrDir(project), { recursive: true });
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* absent */ }
    if (size + Buffer.byteLength(`${line}\n`, 'utf8') > LOG_MAX_BYTES) {
      try {
        fs.renameSync(file, `${file}.1`);
      } catch (error) {
        if (error.code !== 'ENOENT') return false;
      }
    }
    fs.appendFileSync(file, `${line}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function writeIntent(project, fields) {
  const file = statePath(project);
  const capturedAtMs = Date.now();
  const intent = {
    version: 1,
    projectId: String(project.id),
    capturedAt: new Date(capturedAtMs).toISOString(),
    reason: REASONS.has(fields.reason) ? fields.reason : 'planned-restart',
    nextPhase: PHASES.has(fields.nextPhase) ? fields.nextPhase : 'seed',
    status: redactText(fields.status ?? '', 80),
    currentTask: redactText(fields.currentTask ?? '', STATE_TASK_MAX_CHARS),
    resumeAt: Number.isFinite(fields.resumeAt) && fields.resumeAt > capturedAtMs ? Number(fields.resumeAt) : null,
    pid: Number.isInteger(fields.pid) ? fields.pid : process.pid,
    hostname: redactText(fields.hostname ?? process.env.HOSTNAME ?? '', 60)
  };
  try {
    fs.mkdirSync(looparrDir(project), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(intent, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    return { ok: true, intent };
  } catch (error) {
    return { ok: false, error };
  }
}

function readIntent(project) {
  const file = statePath(project);
  try {
    if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid' };
    if (data.version !== 1) return { ok: false, reason: 'invalid-version' };
    if (data.projectId !== project.id) return { ok: false, reason: 'wrong-project' };
    if (!REASONS.has(data.reason)) return { ok: false, reason: 'invalid-reason' };
    if (!PHASES.has(data.nextPhase)) return { ok: false, reason: 'invalid-phase' };
    const capturedAt = Date.parse(data.capturedAt);
    if (!Number.isFinite(capturedAt)) return { ok: false, reason: 'invalid-captured-at' };
    const age = Date.now() - capturedAt;
    if (age > INTENT_TTL_MS || age < -60 * 1000) return { ok: false, reason: 'stale' };
    return {
      ok: true,
      intent: {
        version: 1,
        projectId: data.projectId,
        capturedAt: data.capturedAt,
        reason: data.reason,
        nextPhase: data.nextPhase,
        status: typeof data.status === 'string' ? data.status : '',
        currentTask: typeof data.currentTask === 'string' ? data.currentTask : '',
        resumeAt: Number.isFinite(data.resumeAt) && data.resumeAt > Date.now() ? Number(data.resumeAt) : null,
        pid: Number.isInteger(data.pid) ? data.pid : process.pid,
        hostname: typeof data.hostname === 'string' ? data.hostname : ''
      }
    };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

function hasIntent(project, reason) {
  const checked = readIntent(project);
  return checked.ok && (!reason || checked.intent.reason === reason);
}

function clearIntent(project) {
  try {
    if (!fs.existsSync(statePath(project))) return true;
    fs.unlinkSync(statePath(project));
    return true;
  } catch {
    return false;
  }
}

function consumeIntent(project) {
  const checked = readIntent(project);
  try {
    if (fs.existsSync(statePath(project))) fs.unlinkSync(statePath(project));
  } catch {
    return { ok: false, reason: 'unlink-failed' };
  }
  return checked;
}

module.exports = {
  STATE_NAME,
  LOG_NAME,
  LOG_MAX_BYTES,
  INTENT_TTL_MS,
  PHASES,
  REASONS,
  shouldCaptureResumeIntent,
  statePath,
  logPath,
  redactText,
  appendAudit,
  writeIntent,
  readIntent,
  hasIntent,
  clearIntent,
  consumeIntent
};
