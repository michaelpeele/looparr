'use strict';

const MAX_MODEL_FIELD_LENGTH = 200;

function validateModelId(value, label = 'Model') {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (!value) {
    throw new Error(`${label} contains an empty model id`);
  }
  if (value.includes(',')) {
    throw new Error(`${label} must be a single model id`);
  }
  if (/\s/.test(value)) {
    throw new Error(`${label} cannot contain whitespace`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} cannot contain control characters`);
  }
  if (value.startsWith('-')) {
    throw new Error(`${label} cannot start with '-'`);
  }
  if (value.length > MAX_MODEL_FIELD_LENGTH) {
    throw new Error(`${label} id must be ${MAX_MODEL_FIELD_LENGTH} characters or fewer`);
  }
  return value;
}

function normalizeModelList(value, fallback, label = 'Model') {
  if (value === undefined) return undefined;
  if (value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  const entries = [];
  const seen = new Set();
  for (const segment of value.split(',')) {
    const id = segment.replace(/^ +| +$/g, '');
    if (!id) {
      throw new Error(`${label} contains an empty model id`);
    }
    validateModelId(id, label);
    if (!seen.has(id)) {
      seen.add(id);
      entries.push(id);
    }
  }

  const normalized = entries.join(',');
  if (normalized.length > MAX_MODEL_FIELD_LENGTH) {
    throw new Error(`${label} list must be ${MAX_MODEL_FIELD_LENGTH} characters or fewer`);
  }
  return normalized;
}

function parseModelList(value, fallback, label = 'Model') {
  try {
    return { ok: true, value: normalizeModelList(value, fallback, label) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function modelList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function joinModelList(ids) {
  const seen = new Set();
  const unique = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique.join(',');
}

// These ids route through paid gateway lanes. Keep them out of defaults,
// catalogues, and stored settings; custom ids remain untouched.
// opencode/big-pickle is free on the user's OpenCode account and stays allowed.
const KNOWN_NON_FREE_MODEL_IDS = [
  'omniroute/auto',
  'omniroute/auto/coding',
  'omniroute/coding-safe'
];

function isKnownNonFreeModel(value) {
  return typeof value === 'string' && KNOWN_NON_FREE_MODEL_IDS.includes(value);
}

// Router ids resolve to a changing provider model, and the observed nvidia
// free model hit a 429 sign-up gate. Never use these as defaults or fallbacks.
const KNOWN_UNSTABLE_MODEL_IDS = [
  'kilo/kilo-auto/free',
  'kilo/openrouter/free',
  'kilo/nvidia/nemotron-3.5-super-vl:free'
];

function isKnownUnstableModel(value) {
  return typeof value === 'string' && KNOWN_UNSTABLE_MODEL_IDS.includes(value);
}

function isUnsupportedModel(value) {
  return isKnownNonFreeModel(value) || isKnownUnstableModel(value);
}

function replaceKnownNonFreeModels(value, replacement = '') {
  if (typeof value !== 'string') return value;
  const replacements = modelList(replacement);
  const result = [];
  for (const id of modelList(value)) {
    if (isKnownNonFreeModel(id)) result.push(...replacements);
    else result.push(id);
  }
  return joinModelList(result);
}

function replaceKnownUnstableModels(value, replacement = '') {
  if (typeof value !== 'string') return value;
  const replacements = modelList(replacement);
  const result = [];
  for (const id of modelList(value)) {
    if (isKnownUnstableModel(id)) result.push(...replacements);
    else result.push(id);
  }
  return joinModelList(result);
}

module.exports = {
  MAX_MODEL_FIELD_LENGTH,
  KNOWN_NON_FREE_MODEL_IDS,
  KNOWN_UNSTABLE_MODEL_IDS,
  validateModelId,
  normalizeModelList,
  parseModelList,
  modelList,
  joinModelList,
  isKnownNonFreeModel,
  isKnownUnstableModel,
  isUnsupportedModel,
  replaceKnownNonFreeModels,
  replaceKnownUnstableModels
};
