'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeOpenCodeSessionId } = require('./runners/opencode-session');

const STATE_NAME = 'auto-resume-state.json';
const LOG_NAME = 'auto-resume.log';
const LOG_MAX_BYTES = 64 * 1024;
const TASK_MAX_CHARS = 240;
const STATE_TASK_MAX_CHARS = 2000;
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const PHASES = new Set(['seed', 'analyze', 'implement', 'planQuestions', 'planWrite']);
const REASONS = new Set(['planned-restart', 'container-shutdown', 'checkpoint']);

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
    cause: redactText(fields.cause ?? '', 120) || undefined,
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

const SNAPSHOT_MAX_STEP_OUTPUT = 4000;
const SNAPSHOT_MAX_ROTATION_ENTRIES = 50;
const SNAPSHOT_MAX_PLAN_KEYS = 20;
const SNAPSHOT_MAX_PLAN_STRING = 500;
const SNAPSHOT_MAX_HEALER_STRING = 200;
const SNAPSHOT_HEALER_KEYS = ['state', 'round', 'cycles', 'branch', 'worktree', 'phase', 'errorAt', 'mergedAt'];
const SNAPSHOT_KEY_MAX = 64;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Serializable projection of the runtime for crash/restart resume. Only JSON
// primitives survive; strings are redacted and bounded, objects are capped. A
// live child process is intentionally not represented (it is re-run via runKey).
function sanitizeSnapshot(input) {
  if (!isPlainObject(input)) return undefined;
  const out = {};
  if (isPlainObject(input.stepTask) && Number.isInteger(Number(input.stepTask.index))) {
    out.stepTask = {
      index: Number(input.stepTask.index),
      text: redactText(input.stepTask.text ?? '', STATE_TASK_MAX_CHARS)
    };
  }
  if (typeof input.stepOutput === 'string' && input.stepOutput) {
    out.stepOutput = redactText(input.stepOutput, SNAPSHOT_MAX_STEP_OUTPUT);
  }
  if (Number.isInteger(input.modelIndex) && input.modelIndex >= 0) out.modelIndex = input.modelIndex;
  if (typeof input.modelAttemptRunKey === 'string' && input.modelAttemptRunKey.trim()) {
    out.modelAttemptRunKey = input.modelAttemptRunKey.trim().slice(0, 128);
  }
  if (typeof input.rateLimitBackoffKey === 'string' && input.rateLimitBackoffKey.trim()) {
    out.rateLimitBackoffKey = input.rateLimitBackoffKey.trim().slice(0, 128);
  }
  if (Number.isFinite(input.cooloffUntil) && input.cooloffUntil > 0) out.cooloffUntil = input.cooloffUntil;
  if (isPlainObject(input.rotationCursor)) {
    const cursor = {};
    let count = 0;
    for (const [key, value] of Object.entries(input.rotationCursor)) {
      if (count >= SNAPSHOT_MAX_ROTATION_ENTRIES) break;
      if (typeof key !== 'string' || !key || key.length > SNAPSHOT_KEY_MAX) continue;
      if (!Number.isFinite(value)) continue;
      cursor[key] = value;
      count += 1;
    }
    if (count) out.rotationCursor = cursor;
  }
  const resumeSessionId = normalizeOpenCodeSessionId(input.resumeSessionId);
  if (resumeSessionId) out.resumeSessionId = resumeSessionId;
  if (isPlainObject(input.healer)) {
    const healer = {};
    for (const key of SNAPSHOT_HEALER_KEYS) {
      const value = input.healer[key];
      if (typeof value === 'string') healer[key] = redactText(value, SNAPSHOT_MAX_HEALER_STRING);
      else if (typeof value === 'number' && Number.isFinite(value)) healer[key] = value;
    }
    if (Object.keys(healer).length) out.healer = healer;
  }
  if (isPlainObject(input.planPhaseSnapshot)) {
    const plan = {};
    let count = 0;
    for (const [key, value] of Object.entries(input.planPhaseSnapshot)) {
      if (count >= SNAPSHOT_MAX_PLAN_KEYS) break;
      const type = typeof value;
      if (type === 'string') plan[key] = redactText(value, SNAPSHOT_MAX_PLAN_STRING);
      else if (type === 'number' && Number.isFinite(value)) plan[key] = value;
      else if (type === 'boolean' || value === null) plan[key] = value;
      count += 1;
    }
    if (Object.keys(plan).length) out.planPhaseSnapshot = plan;
  }
  return Object.keys(out).length ? out : undefined;
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
  if (typeof fields.runKey === 'string' && fields.runKey.trim()) {
    intent.runKey = fields.runKey.trim().slice(0, 128);
  }
  const sessionId = normalizeOpenCodeSessionId(fields.opencodeSessionId);
  if (sessionId) intent.opencodeSessionId = sessionId;
  const snapshot = sanitizeSnapshot(fields.snapshot);
  if (snapshot) intent.snapshot = snapshot;
  try {
    fs.mkdirSync(looparrDir(project), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(intent, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    appendAudit(project, 'intent-written', {
      reason: intent.reason,
      phase: intent.nextPhase,
      task: intent.currentTask
    });
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
    const intent = {
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
    };
    if (typeof data.runKey === 'string' && data.runKey.trim()) intent.runKey = data.runKey.trim().slice(0, 128);
  const sessionId = normalizeOpenCodeSessionId(data.opencodeSessionId);
  if (sessionId) intent.opencodeSessionId = sessionId;
    const snapshot = sanitizeSnapshot(data.snapshot);
    if (snapshot) intent.snapshot = snapshot;
    return { ok: true, intent };
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
  const file = statePath(project);
  const consuming = `${file}.consuming-${process.pid}-${Date.now()}`;
  try {
    if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
    fs.renameSync(file, consuming);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'unlink-failed' };
  }
  try {
    const data = JSON.parse(fs.readFileSync(consuming, 'utf8'));
    try { fs.unlinkSync(consuming); } catch { /* ignore */ }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid' };
    if (data.version !== 1) return { ok: false, reason: 'invalid-version' };
    if (data.projectId !== project.id) return { ok: false, reason: 'wrong-project' };
    if (!REASONS.has(data.reason)) return { ok: false, reason: 'invalid-reason' };
    if (!PHASES.has(data.nextPhase)) return { ok: false, reason: 'invalid-phase' };
    const capturedAt = Date.parse(data.capturedAt);
    if (!Number.isFinite(capturedAt)) return { ok: false, reason: 'invalid-captured-at' };
    const age = Date.now() - capturedAt;
    if (age > INTENT_TTL_MS || age < -60 * 1000) return { ok: false, reason: 'stale' };
    const intent = {
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
    };
    if (typeof data.runKey === 'string' && data.runKey.trim()) intent.runKey = data.runKey.trim().slice(0, 128);
  const sessionId = normalizeOpenCodeSessionId(data.opencodeSessionId);
  if (sessionId) intent.opencodeSessionId = sessionId;
    const snapshot = sanitizeSnapshot(data.snapshot);
    if (snapshot) intent.snapshot = snapshot;
    return { ok: true, intent };
  } catch (error) {
    try { fs.unlinkSync(consuming); } catch { /* ignore */ }
    return { ok: false, reason: 'invalid' };
  }
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
  sanitizeSnapshot,
  writeIntent,
  readIntent,
  hasIntent,
  clearIntent,
  consumeIntent
};
