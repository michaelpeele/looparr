'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'opencode.json';
const KILO_PROVIDER_ID = 'kilo';
const KILO_PROVIDER_NAME = 'Kilo Gateway (free)';
const KILO_PROVIDER_PACKAGE = 'aisdk:@ai-sdk/openai-compatible';
const KILO_BASE_URL = 'https://api.kilo.ai/api/gateway';

// Free lane only. Paid gateway ids resolve too but are intentionally absent so a
// rotation can never spend credits by accident.
const KILO_MODELS = Object.freeze({
  'kilo-auto/free': 'Kilo Auto Free (router)',
  'openrouter/free': 'OpenRouter Free (router)',
  'reflection/beam-free': 'Reflection Beam Free',
  'recursive/flint-v1.0:free': 'Flint 1.0 (free)',
  'nvidia/nemotron-3.5-super-vl:free': 'Nemotron 3.5 Super VL (free)',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'Nemotron 3 Ultra (free)',
  'nvidia/nemotron-3.5-lightning:free': 'Nemotron 3.5 Lightning (free)',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': 'Nemotron 3 Nano Omni (free)',
  'baidu/ernie-5.5-flash-preview:free': 'ERNIE 5.5 Flash Preview (free)',
  'inclusionai/ling-3.2-flash:free': 'Ling 3.2 Flash (free)',
  'particle-ai/particle-1:free': 'Particle-1 (free)',
  'liquid/lfm-3-1.7b:free': 'LFM 3 1.7B (free)'
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readConfig(file) {
  if (!fs.existsSync(file)) return { config: {}, existed: false };
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return { config: {}, existed: true };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${error.message}); fix or delete it so the kilo provider can be added`);
  }
  if (!isPlainObject(parsed)) throw new Error(`${file} must contain a JSON object`);
  return { config: parsed, existed: true };
}

// Fills in only what is missing so a hand-edited provider is never overwritten.
function withKiloProvider(config) {
  const next = clone(config);
  if (!isPlainObject(next.providers)) next.providers = {};
  if (!isPlainObject(next.providers[KILO_PROVIDER_ID])) next.providers[KILO_PROVIDER_ID] = {};
  const provider = next.providers[KILO_PROVIDER_ID];
  if (provider.name === undefined) provider.name = KILO_PROVIDER_NAME;
  if (provider.package === undefined) provider.package = KILO_PROVIDER_PACKAGE;
  if (!isPlainObject(provider.settings)) provider.settings = {};
  if (provider.settings.baseURL === undefined) provider.settings.baseURL = KILO_BASE_URL;
  if (!isPlainObject(provider.models)) provider.models = {};
  for (const [id, name] of Object.entries(KILO_MODELS)) {
    if (!isPlainObject(provider.models[id])) provider.models[id] = { name };
  }
  return next;
}

function ensureKiloProvider({ root = path.resolve(__dirname, '..') } = {}) {
  const file = path.join(root, CONFIG_FILENAME);
  const { config, existed } = readConfig(file);
  const next = withKiloProvider(config);
  const changed = JSON.stringify(next) !== JSON.stringify(config);
  if (changed) {
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, file);
  }
  return { status: changed ? (existed ? 'updated' : 'created') : 'unchanged', path: file };
}

module.exports = {
  CONFIG_FILENAME,
  KILO_PROVIDER_ID,
  KILO_PROVIDER_NAME,
  KILO_PROVIDER_PACKAGE,
  KILO_BASE_URL,
  KILO_MODELS,
  ensureKiloProvider
};
