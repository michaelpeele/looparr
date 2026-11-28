'use strict';

const fs = require('fs');
const path = require('path');

// Persisted rotation state: one cursor per candidate list (keyed by its content,
// so projects that inherit the global list share the global rotation), plus a
// cooldown map so a throttled model or runner is skipped until it is ready.
const STATE_PATH = process.env.LOOPARR_ROTATION_STATE
  || path.join(path.dirname(process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json')), 'rotation-state.json');

let state = null;

function emptyState() {
  return { version: 1, cursors: {}, cooldowns: {} };
}

function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    state = {
      version: 1,
      cursors: raw && typeof raw.cursors === 'object' && raw.cursors ? { ...raw.cursors } : {},
      cooldowns: raw && typeof raw.cooldowns === 'object' && raw.cooldowns ? { ...raw.cooldowns } : {}
    };
  } catch {
    state = emptyState();
  }
  prune();
  return state;
}

function prune() {
  const now = Date.now();
  for (const [id, until] of Object.entries(state.cooldowns)) {
    if (!(Number(until) > now)) delete state.cooldowns[id];
  }
}

function save() {
  if (!state) return;
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, 'utf8');
    fs.renameSync(temp, STATE_PATH);
  } catch {
    // Rotation state must never break a run.
  }
}

function cursorKey(list) {
  return list.join('\u0000');
}

function getCursor(list) {
  const current = load();
  const value = Number(current.cursors[cursorKey(list)]);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function setCursor(list, index) {
  if (!Array.isArray(list) || !list.length) return;
  const current = load();
  const normalized = ((Number(index) || 0) % list.length + list.length) % list.length;
  current.cursors[cursorKey(list)] = normalized;
  save();
}

function advance(list, servedIndex) {
  if (!Array.isArray(list) || list.length < 2) return;
  setCursor(list, (Number(servedIndex) || 0) + 1);
}

function markCooling(id, untilMs) {
  if (!id) return;
  const current = load();
  current.cooldowns[id] = Number(untilMs) || Date.now();
  save();
}

function readyAt(id) {
  const current = load();
  const until = Number(current.cooldowns[id] || 0);
  return until > Date.now() ? until : 0;
}

function isReady(id) {
  return readyAt(id) === 0;
}

// Walk the list from the stored cursor and return the first entry whose
// cooldown has expired. When everything is cooling, report the earliest
// readyAt instead of handing back a throttled candidate.
function pick(list, { skipCooling = true } = {}) {
  if (!Array.isArray(list) || !list.length) return { id: '', index: -1, waitMs: 0 };
  const start = getCursor(list);
  const now = Date.now();
  let earliest = Infinity;
  for (let offset = 0; offset < list.length; offset += 1) {
    const index = (start + offset) % list.length;
    const id = list[index];
    const ready = skipCooling ? readyAt(id) : 0;
    if (!ready) return { id, index, waitMs: 0 };
    if (ready < earliest) earliest = ready;
  }
  return { id: list[start], index: start, waitMs: earliest === Infinity ? 0 : earliest - now };
}

// Read-only view of the active cooldowns for the dashboard: model/subject id to
// the epoch ms it becomes usable again. Expired entries are pruned first.
function snapshot() {
  const current = load();
  prune();
  const now = Date.now();
  const cooling = {};
  for (const [id, until] of Object.entries(current.cooldowns)) {
    const value = Number(until);
    if (value > now) cooling[id] = value;
  }
  return { cooling };
}

function reset() {
  state = emptyState();
  save();
}

module.exports = {
  STATE_PATH,
  load,
  save,
  cursorKey,
  getCursor,
  setCursor,
  advance,
  markCooling,
  readyAt,
  isReady,
  pick,
  snapshot,
  reset
};
