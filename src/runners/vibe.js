'use strict';

const path = require('path');
const { buildVibeArgs } = require('../vibe-command');
const opencode = require('./opencode');

const EXECUTOR_URL = process.env.LOOPARR_EXECUTOR_URL
  ? String(process.env.LOOPARR_EXECUTOR_URL).replace(/\/+$/, '')
  : null;
const EXECUTOR_TOKEN = process.env.LOOPARR_EXECUTOR_TOKEN || '';
const BRIDGE_CLIENT = path.join(__dirname, '..', '..', 'scripts', 'bridge-client.js');
const VIBE_BIN = process.env.VIBE_BIN || 'vibe';

// `--model` takes a Vibe alias from the account's config, not a
// `provider/model` id, so this catalogue is only the free lane the signed-in
// account can run: `zai-glm-5-3-flash-vibe-free` and the alias Vibe publishes
// for it, `zai-glm-5-3-flash`. Both were verified at `--max-price 0` on
// 2026-11-23 (cost 0, outcome finished). Paid ids such as `mistral-large-4-0`,
// `zai-glm-5-3`, and `deepseek-v4-1-flash-1017` require a higher plan and are
// left out. A blank model still means "use the account's active model".
const MODELS = [
  'zai-glm-5-3-flash-vibe-free',
  'zai-glm-5-3-flash'
];

function buildCommand({ prompt, cwd, files = [], model = '', runKey, projectId, phase, task }) {
  const args = buildVibeArgs({ prompt, files, model });
  if (EXECUTOR_URL) {
    if (typeof runKey !== 'string' || !runKey.trim()) {
      throw new Error('runKey is required in bridge mode');
    }
    return {
      command: process.execPath,
      args: [BRIDGE_CLIENT],
      options: {
        cwd,
        env: {
          ...process.env,
          LOOPARR_EXECUTOR_URL: EXECUTOR_URL,
          LOOPARR_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
          LOOPARR_TASK_PAYLOAD: JSON.stringify({
            runner: 'vibe',
            prompt,
            cwd,
            files,
            model,
            runKey,
            projectId,
            phase,
            task
          })
        },
        shell: false
      }
    };
  }
  return {
    command: VIBE_BIN,
    args,
    options: { cwd, env: process.env, shell: false }
  };
}

module.exports = {
  id: 'vibe',
  label: 'Mistral Vibe',
  description: EXECUTOR_URL
    ? 'Host-side Mistral Vibe via HTTP bridge; fresh vibe run per step, capped at $0.'
    : 'Local Mistral Vibe; fresh vibe run per step, capped at $0.',
  models: MODELS,
  buildCommand,
  isRateLimit: opencode.isRateLimit,
  cancelStaleRuns: opencode.cancelStaleRuns,
  listActiveRuns: opencode.listActiveRuns
};
