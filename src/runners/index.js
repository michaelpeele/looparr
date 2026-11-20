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
  return [...registry.values()].map(({ id, label, description }) => ({ id, label, description }));
}

registerRunner(require('./opencode'));

module.exports = { registerRunner, getRunner, listRunners };
