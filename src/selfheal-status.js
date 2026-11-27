'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

// Host-healer status relay: the dev engine writes one small JSON file per
// project under <repoRoot>/.looparr/selfheal/status/<projectId>.json. Prod (and
// any other instance that shares the .looparr volume) reads the freshest file to
// show the live self-heal state. Prod never writes or spawns; it only reads and,
// on request, forwards a merge to the host executor.
//
// The file is untrusted input from prod's perspective: schema, TTL, path
// containment, project id shape, and branch pattern are all validated before use.
const TTL_MS = 30 * 60 * 1000;
const VERSION = 1;
const BRANCH_RE = /^looparr-selfheal-[0-9]+-[0-9]+$/;
// Project ids are UUIDs in practice; accept only a conservative, path-safe shape
// so a status filename can never escape the status directory.
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VALID_STATES = new Set(['idle', 'debugging', 'healing', 'healed', 'error', 'accounted']);
// Durable states the dev heartbeat re-stamps instead of overwriting with idle.
// 'accounted' marks a reviewed fix already applied to the current branch; it is
// never mergeable and must survive heartbeats so prod keeps showing the pill.
const STICKY_STATES = new Set(['accounted']);

function statusRoot(repoRoot) {
  return path.join(repoRoot, '.looparr', 'selfheal', 'status');
}

function isValidProjectId(id) {
  return typeof id === 'string' && PROJECT_ID_RE.test(id);
}

// Resolve the status file path for a project, guaranteeing containment inside
// the status directory even for an unexpected id shape.
function statusFile(repoRoot, projectId) {
  if (!isValidProjectId(projectId)) return null;
  const root = statusRoot(repoRoot);
  const file = path.resolve(root, `${projectId}.json`);
  const relative = path.relative(path.resolve(root), file);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return file;
}

function isFresh(record, now) {
  if (!record || typeof record !== 'object') return false;
  const updatedAt = Date.parse(record.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  const expiresAt = Date.parse(record.expiresAt);
  const effectiveExpiry = Number.isFinite(expiresAt) ? expiresAt : updatedAt + TTL_MS;
  return now <= effectiveExpiry && now - updatedAt <= TTL_MS;
}

// True when a record is a fresh durable ("sticky") state the heartbeat should
// re-stamp rather than overwrite with idle. Used for the accounted state.
function isStickyStatus(record, now = Date.now()) {
  return !!record && STICKY_STATES.has(record.state) && isFresh(record, now);
}

// Normalize/validate a parsed status document. Returns null for anything stale,
// malformed, or out of schema so callers can ignore it.
function normalizeRecord(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.version !== VERSION) return null;
  if (typeof raw.projectId !== 'string' || !isValidProjectId(raw.projectId)) return null;
  if (!VALID_STATES.has(raw.state)) return null;
  // Idle has no branch; engaged states carry one. Only require a string here;
  // the branch pattern is enforced at merge time (validateMergeRequest).
  if (typeof raw.branch !== 'string') return null;
  if (!isFresh(raw, now)) return null;
  return {
    version: VERSION,
    projectId: raw.projectId,
    projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
    state: raw.state,
    round: Number.isInteger(raw.round) ? raw.round : 0,
    cycles: Number.isInteger(raw.cycles) ? raw.cycles : 0,
    branch: raw.branch,
    phase: typeof raw.phase === 'string' ? raw.phase : '',
    errorAt: typeof raw.errorAt === 'string' ? raw.errorAt : '',
    mergedAt: typeof raw.mergedAt === 'string' && raw.mergedAt ? raw.mergedAt : null,
    // Mergeability is a host-side git fact; records without the flag (old
    // writers) default to true so still-valid healed rounds keep their button.
    mergeable: raw.mergeable !== false,
    analysisFile: typeof raw.analysisFile === 'string' ? raw.analysisFile : '',
    exitCode: Number.isInteger(raw.exitCode) ? raw.exitCode : null,
    hostname: typeof raw.hostname === 'string' ? raw.hostname : '',
    updatedAt: raw.updatedAt,
    expiresAt: raw.expiresAt
  };
}

// Read and validate a single project's status. Returns the normalized record or
// null when absent, stale, or malformed.
function readStatus(repoRoot, projectId, now = Date.now()) {
  const file = statusFile(repoRoot, projectId);
  if (!file) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = normalizeRecord(parsed, now);
  if (record && record.projectId !== projectId) return null;
  return record;
}

function listStatus(repoRoot, now = Date.now()) {
  const root = statusRoot(repoRoot);
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const projectId = name.slice(0, -'.json'.length);
    if (!isValidProjectId(projectId)) continue;
    const record = readStatus(repoRoot, projectId, now);
    if (record) out.push(record);
  }
  return out;
}

// Map a status record to the per-project selfHealer shape already consumed by
// the UI (state/branch/cycles/etc). Idle is preserved so prod can show a live
// idle pill; the engine's dev path keeps rt.healer authoritative.
function toSelfHealer(record) {
  if (!record) return null;
  return {
    state: record.state,
    round: record.round || 0,
    cycles: record.cycles || 0,
    branch: record.branch || '',
    phase: record.phase || '',
    errorAt: record.errorAt || '',
    mergedAt: record.mergedAt || null,
    mergeable: record.mergeable !== false
  };
}

// Host-side git-aware mergeability probe: a branch is mergeable only when it
// matches the healer branch pattern, still exists as a local ref, and is not
// already contained in HEAD (i.e. already merged or empty versus main). Read
// only — this never mutates the repo and never pushes.
function isMergeableBranch(repoRoot, branch) {
  if (typeof repoRoot !== 'string' || !repoRoot) return false;
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) return false;
  const dir = path.resolve(repoRoot);
  const run = (args) =>
    spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (run(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status !== 0) return false;
  // Exit 0 means already an ancestor of HEAD: nothing left to merge.
  return run(['merge-base', '--is-ancestor', branch, 'HEAD']).status !== 0;
}

// Rewrite fresh healed + unmerged records whose branch is no longer mergeable
// (branch deleted, or already contained in main) to idle, so prod stops
// offering a Merge button for a stale round. Preserves projectId and
// projectName. Host-side only: it spawns git, so the prod/viewer container
// must never call it. Sticky accounted records and other states are untouched.
// Returns the reconciled project ids for tests.
function reconcileStaleHealedStatuses(repoRoot, now = Date.now()) {
  const reconciled = [];
  for (const record of listStatus(repoRoot, now)) {
    if (record.state !== 'healed' || record.mergedAt) continue;
    if (isMergeableBranch(repoRoot, record.branch)) continue;
    const wrote = writeStatus(
      repoRoot,
      {
        version: VERSION,
        projectId: record.projectId,
        projectName: record.projectName,
        state: 'idle',
        round: 0,
        cycles: 0,
        branch: '',
        phase: '',
        errorAt: '',
        mergedAt: null,
        analysisFile: '',
        exitCode: null,
        hostname: record.hostname || ''
      },
      now
    );
    if (wrote) reconciled.push(record.projectId);
  }
  return reconciled;
}

// Validate a merge request against a fresh status file. Returns a discriminated
// result so the relay refusals are unit-testable without Docker or git.
//   { ok: true, record }                 — safe to attempt the merge
//   { ok: false, status, error }         — refuse with this HTTP status
function validateMergeRequest(repoRoot, projectId, body, now = Date.now()) {
  if (!isValidProjectId(projectId)) return { ok: false, status: 400, error: 'Invalid project id' };
  const record = readStatus(repoRoot, projectId, now);
  if (!record) return { ok: false, status: 409, error: 'No fresh self-heal status for this project' };
  if (record.state !== 'healed') {
    return { ok: false, status: 409, error: 'Self-heal branch is not in healed state' };
  }
  if (record.mergedAt) {
    return { ok: false, status: 409, error: 'Self-heal branch was already merged' };
  }
  // Plain data check (no git here): a record already reconciled as stale is
  // refused so the relay cannot forward a dead merge to the host executor.
  if (record.mergeable === false) {
    return { ok: false, status: 409, error: 'Self-heal branch is stale or already merged' };
  }
  const branch = body && typeof body.branch === 'string' ? body.branch : '';
  if (!BRANCH_RE.test(branch)) return { ok: false, status: 400, error: 'Branch name is invalid' };
  if (branch !== record.branch) return { ok: false, status: 409, error: 'Branch does not match the healed branch' };
  return { ok: true, record };
}

// Write a status file atomically (temp + rename), 0600. Errors are swallowed by
// callers that treat the status as best-effort; this returns a boolean.
function writeStatus(repoRoot, record, now = Date.now()) {
  const file = statusFile(repoRoot, record && record.projectId);
  if (!file) return false;
  const payload = normalizeRecord(
    { ...record, updatedAt: new Date(now).toISOString(), expiresAt: new Date(now + TTL_MS).toISOString() },
    now
  );
  if (!payload) return false;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  TTL_MS,
  VERSION,
  BRANCH_RE,
  statusRoot,
  statusFile,
  isValidProjectId,
  normalizeRecord,
  isFresh,
  isStickyStatus,
  readStatus,
  listStatus,
  toSelfHealer,
  isMergeableBranch,
  reconcileStaleHealedStatuses,
  validateMergeRequest,
  writeStatus
};