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
// allow unclaimed custom/BYOK ids.
function runnerSupportsModel(runner, modelId) {
  if (!runner || !modelId) return false;
  if (isUnsupportedModel(modelId)) return false;
  const models = Array.isArray(runner.models) ? runner.models : [];
  if (models.includes(modelId)) return true;
  if (runner.id === 'kilo') return false;
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

registerRunner(require('./opencode'));
registerRunner(require('./kilo'));
registerRunner(require('./vibe'));

module.exports = {
  registerRunner,
  getRunner,
  listRunners,
  runnerSupportsModel,
  resolveRunnerModels
};
