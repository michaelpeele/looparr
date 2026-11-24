#!/usr/bin/env node
'use strict';

// Regression test: the seed phase must pass only the plan file path in the
// prompt text ({{planPath}}), never the plan as a --file attachment. Seed
// payloads must carry files: [] for every runner.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
// Temp path that does not exist: engine/config must load pure defaults.
process.env.CONFIG_PATH = path.join(REPO_ROOT, '.tmp-seed-path-only-test', 'config.json');
process.env.LOOPARR_EXECUTOR_URL = 'http://127.0.0.1:4187';
process.env.LOOPARR_EXECUTOR_TOKEN = 'test-executor-token';

const engine = require('../src/engine');
const configStore = require('../src/config');
const runners = require('../src/runners');
const kilo = require('../src/runners/kilo');
const vibe = require('../src/runners/vibe');
const { buildKiloArgs } = require('../src/kilo-command');
const { buildVibeArgs, CONTEXT_HEADER } = require('../src/vibe-command');

const PLAN_PATH = '/abs/plan.md';
const TASK = 'First unchecked task';

function testRenderPrompt() {
  const seed = engine.renderPrompt('seedPromptTemplate', { task: TASK, planPath: PLAN_PATH });
  assert.ok(seed.includes(PLAN_PATH), 'seed prompt includes the plan path');
  assert.ok(!seed.includes('{{planPath}}'), 'seed prompt has no unresolved {{planPath}}');
  assert.ok(!seed.includes('attached'), 'seed prompt has no "attached" wording');
  assert.ok(seed.includes(TASK), 'seed prompt includes the task text');

  // Unset planPath must not leave an unresolved placeholder behind.
  const noPlanPath = engine.renderPrompt('seedPromptTemplate', { task: TASK });
  assert.ok(!noPlanPath.includes('{{planPath}}'), 'missing planPath still resolves');

  // The default seed template declares the seed placeholders.
  assert.ok(configStore.DEFAULT_SEED_PROMPT_TEMPLATE.includes('{{planPath}}'), 'default seed template declares {{planPath}}');
  assert.ok(configStore.DEFAULT_SEED_PROMPT_TEMPLATE.includes('{{task}}'), 'default seed template declares {{task}}');
}

function testSeedPayloads() {
  const prompt = engine.renderPrompt('seedPromptTemplate', { task: TASK, planPath: PLAN_PATH });
  const common = {
    prompt,
    cwd: '/project',
    files: [],
    runKey: 'seed-run-1',
    projectId: 'p1',
    phase: 'seed',
    task: TASK
  };

  const cases = [
    ['kilo', kilo],
    ['vibe', vibe],
    ['opencode', runners.getRunner('opencode')]
  ];
  for (const [runnerId, runner] of cases) {
    const built = runner.buildCommand({ ...common, model: '' });
    const payloadEnv = built.options.env.LOOPARR_TASK_PAYLOAD;
    assert.ok(payloadEnv, `${runnerId} bridge payload is emitted`);
    const payload = JSON.parse(payloadEnv);
    assert.deepEqual(payload.files, [], `${runnerId} seed payload files deep-equals []`);
    assert.ok(payload.prompt.includes(PLAN_PATH), `${runnerId} seed payload prompt contains the plan path`);
    assert.ok(!payload.prompt.includes('{{planPath}}'), `${runnerId} seed payload prompt has no unresolved placeholder`);
  }
}

function testCommandLineArgs() {
  const kiloArgs = buildKiloArgs({ prompt: 'go', files: [] });
  assert.ok(!kiloArgs.includes('--file'), 'kilo seed args contain no --file');
  assert.deepEqual(kiloArgs, ['run', '--auto', '--format', 'json', '--model', 'kilo/baidu/ernie-5.5-flash-preview:free', 'go'], 'kilo seed args use the explicit free model');

  const vibeArgs = buildVibeArgs({ prompt: 'go', files: [] });
  assert.ok(!vibeArgs.some((arg) => typeof arg === 'string' && arg.includes(CONTEXT_HEADER)), 'vibe seed args have no Project files line');
  assert.deepEqual(vibeArgs.slice(0, 2), ['--prompt', 'go'], 'vibe seed prompt stays as go');

  const withFiles = buildVibeArgs({ prompt: 'go', files: [PLAN_PATH] });
  assert.ok(withFiles[1].includes(PLAN_PATH), 'vibe still names files in the prompt when explicitly provided');
}

testRenderPrompt();
testSeedPayloads();
testCommandLineArgs();

console.log('seed path-only tests passed');
