'use strict';

const path = require('path');
const { buildKiloArgs, resolveKiloModel } = require('../kilo-command');
const opencode = require('./opencode');

const EXECUTOR_URL = process.env.LOOPARR_EXECUTOR_URL
  ? String(process.env.LOOPARR_EXECUTOR_URL).replace(/\/+$/, '')
  : null;
const EXECUTOR_TOKEN = process.env.LOOPARR_EXECUTOR_TOKEN || '';
const BRIDGE_CLIENT = path.join(__dirname, '..', '..', 'scripts', 'bridge-client.js');
const KILO_BIN = process.env.KILO_BIN || 'kilo';

// Keyless Kilo Gateway free catalogue. Keep in step with the `kilo/*` ids in
// `public/app.js`; these are the only model ids this runner accepts. Router ids
// and the observed-rate-limited nvidia model are rejected by the runner index.
const MODELS = [
  'kilo/baidu/ernie-5.5-flash-preview:free',
  'kilo/reflection/beam-free',
  'kilo/recursive/flint-v1.0:free',
  'kilo/nvidia/nemotron-3-ultra-550b-a55b:free',
  'kilo/nvidia/nemotron-3.5-lightning:free',
  'kilo/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'kilo/inclusionai/ling-3.2-flash:free',
  'kilo/particle-ai/particle-1:free',
  'kilo/liquid/lfm-3-1.7b:free'
];

function buildCommand({ prompt, cwd, files = [], model = '', runKey, projectId, phase, task }) {
  const resolvedModel = resolveKiloModel(model);
  const args = buildKiloArgs({ prompt, files, model: resolvedModel });
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
            runner: 'kilo',
            prompt,
            cwd,
            files,
            model: resolvedModel,
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
    command: KILO_BIN,
    args,
    options: { cwd, env: process.env, shell: false }
  };
}

module.exports = {
  id: 'kilo',
  label: 'Kilo CLI',
  description: EXECUTOR_URL
    ? 'Host-side Kilo CLI via HTTP bridge; fresh kilo run per step.'
    : 'Local Kilo CLI; fresh kilo run per step.',
  models: MODELS,
  buildCommand,
  isRateLimit: opencode.isRateLimit,
  cancelStaleRuns: opencode.cancelStaleRuns,
  listActiveRuns: opencode.listActiveRuns
};
