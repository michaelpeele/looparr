'use strict';

const { validateModelId } = require('./model-list');

// Historical keyless completion proof: PROGRESS.md:629 and plan.md:29.
const DEFAULT_KILO_MODEL = 'kilo/baidu/ernie-5.5-flash-preview:free';

function resolveKiloModel(model) {
  const selected = model || DEFAULT_KILO_MODEL;
  validateModelId(selected, 'Kilo model');
  return selected;
}

// Shared by the Kilo runner (local mode) and the host executor (bridge mode) so
// both builds produce exactly the same invocation. Kilo always gets an explicit
// free model; its gateway default requires paid sign-in.
function buildKiloArgs({ prompt, files = [], model = '' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt is required');
  }
  const resolvedModel = resolveKiloModel(model);
  const args = ['run', '--auto', '--format', 'json', '--model', resolvedModel];
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

module.exports = { buildKiloArgs, DEFAULT_KILO_MODEL, resolveKiloModel };
