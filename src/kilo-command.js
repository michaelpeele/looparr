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
  // The prompt must come before --file: Kilo's --file is a greedy array option,
  // so `--file plan.md "prompt"` swallows the prompt as a second file path and
  // the CLI fails with `File not found: <prompt>`.
  args.push(prompt);
  for (const file of files) {
    if (!file) continue;
    args.push('--file', String(file));
  }
  return args;
}

module.exports = { buildKiloArgs };
