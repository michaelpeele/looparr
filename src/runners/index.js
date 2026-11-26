'use strict';

const { modelList, isUnsupportedModel } = require('../model-list');

const registry = new Map();

function registerRunner(runner) {
  if (!runner || !runner.id) throw new Error('Runner requires an id');
  registry.set(runner.id, runner);
}

function getRunner(id) {
  return registry.get(String(id || '').toLowerCase()) || null;
}

function listRunners() {
  return [...registry.values()].map(({ id, label, description, models }) => ({
    id,
    label,
    description,
    models: Array.isArray(models) ? [...models] : []
  }));
}

// A model id may only reach a runner that can resolve it. Paid, router, and
// observed-failing ids are refused. Kilo is catalogue-only. Other runners still
// allow unclaimed custom/BYOK ids — but an id namespaced with a registered
// runner id (`opencode/…`, `kilo/…`, `vibe/…`) belongs to that runner alone,
// even when no catalogue lists it, so a stale or inherited id can never reach
// a foreign CLI.
function runnerSupportsModel(runner, modelId) {
  if (!runner || !modelId) return false;
  if (isUnsupportedModel(modelId)) return false;
  const models = Array.isArray(runner.models) ? runner.models : [];
  if (models.includes(modelId)) return true;
  if (runner.id === 'kilo') return false;
  const slash = modelId.indexOf('/');
  if (slash > 0) {
    const prefix = modelId.slice(0, slash);
    if (registry.has(prefix) && prefix !== runner.id) return false;
  }
  for (const other of registry.values()) {
    if (other.id === runner.id) continue;
    const otherModels = Array.isArray(other.models) ? other.models : [];
    if (otherModels.includes(modelId)) return false;
  }
  return true;
}

function resolveRunnerModels(runner, configured, options = {}) {
  const configuredIds = Array.isArray(configured) ? configured : modelList(configured);
  const models = configuredIds.filter((id) => runnerSupportsModel(runner, id));
  const dropped = configuredIds.filter((id) => !runnerSupportsModel(runner, id));
  if (dropped.length && typeof options.onSkip === 'function') options.onSkip(dropped);

  let fallback = '';
  let usedFallback = false;
  if (!models.length) {
    const catalogue = Array.isArray(runner?.models) ? runner.models : [];
    fallback = catalogue.find((id) => runnerSupportsModel(runner, id)) || catalogue[0] || '';
    if (fallback) {
      models.push(fallback);
      usedFallback = true;
      if (typeof options.onFallback === 'function') options.onFallback(fallback);
    }
  }
  return { models, dropped, fallback, usedFallback };
}

// Paseo provider per Looparr runner id (PLAN-02). Unlisted ids map to
// themselves so future runners work without touching this table.
const PASEO_PROVIDERS = {
  opencode: 'opencode',
  vibe: 'mistral-vibe',
  kilo: 'kilo'
};

function paseoProviderForRunner(runnerId) {
  const id = String(runnerId || '').trim().toLowerCase();
  return PASEO_PROVIDERS[id] || id;
}

registerRunner(require('./opencode'));
registerRunner(require('./kilo'));
registerRunner(require('./vibe'));

module.exports = {
  registerRunner,
  getRunner,
  listRunners,
  runnerSupportsModel,
  resolveRunnerModels,
  paseoProviderForRunner
};
