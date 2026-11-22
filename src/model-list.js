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

module.exports = {
  MAX_MODEL_FIELD_LENGTH,
  validateModelId,
  normalizeModelList,
  parseModelList,
  modelList,
  joinModelList,
};
