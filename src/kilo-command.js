'use strict';

const { validateModelId } = require('./model-list');

// Shared by the Kilo runner (local mode) and the host executor (bridge mode) so
// both builds produce exactly the same invocation.
function buildKiloArgs({ prompt, files = [], model = '' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt is required');
  }
  if (model) validateModelId(model, 'Model');
  const args = ['run', '--auto', '--format', 'json'];
  if (model) args.push('--model', model);
  for (const file of files) {
    if (!file) continue;
    args.push('--file', String(file));
  }
  args.push(prompt);
  return args;
}

module.exports = { buildKiloArgs };
