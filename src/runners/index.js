'use strict';

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

// A model id may only reach a runner that can resolve it. An id claimed by
// another runner's catalogue is refused (`opencode/*` on the Kilo CLI, anything
// on Vibe), while ids no runner claims stay allowed so custom providers and
// BYOK ids keep working.
function runnerSupportsModel(runner, modelId) {
  if (!runner || !modelId) return false;
  const models = Array.isArray(runner.models) ? runner.models : [];
  if (models.includes(modelId)) return true;
  for (const other of registry.values()) {
    if (other.id === runner.id) continue;
    const otherModels = Array.isArray(other.models) ? other.models : [];
    if (otherModels.includes(modelId)) return false;
  }
  return true;
}

registerRunner(require('./opencode'));
registerRunner(require('./kilo'));
registerRunner(require('./vibe'));

module.exports = { registerRunner, getRunner, listRunners, runnerSupportsModel };
