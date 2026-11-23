'use strict';

const { validateModelId } = require('./model-list');

// Vibe has no attachment flag: `--prompt-file` replaces the prompt rather than
// attaching a file. Seed files are therefore named in the prompt and read by the
// agent from the working directory.
const CONTEXT_HEADER = 'Project files for this step (read them from the working directory):';
// Vibe prints one JSON object per line in streaming mode, which keeps the logs
// structured like the Kilo runner. A limit of 0 stops the run before any call
// that would cost money, so only free-plan usage completes.
const MAX_PRICE_USD = '0';

// Shared by the Vibe runner (local mode) and the host executor (bridge mode) so
// both builds produce exactly the same invocation.
function buildVibeArgs({ prompt, files = [], model = '' }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('prompt is required');
  }
  if (model) validateModelId(model, 'Model');

  const paths = files.filter((file) => typeof file === 'string' && file);
  let text = prompt;
  if (paths.length) {
    text += `\n\n${CONTEXT_HEADER}\n${paths.map((file) => `- ${file}`).join('\n')}`;
  }

  const args = [
    '--prompt', text,
    '--auto-approve',
    '--output', 'streaming',
    '--max-price', MAX_PRICE_USD
  ];
  if (model) args.push('--model', model);
  return args;
}

module.exports = { buildVibeArgs, CONTEXT_HEADER, MAX_PRICE_USD };
