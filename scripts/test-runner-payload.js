'use strict';

const assert = require('assert');
const path = require('path');

process.env.LOOPARR_EXECUTOR_URL = 'http://127.0.0.1:4187';
process.env.LOOPARR_EXECUTOR_TOKEN = 'test-executor-token';
delete process.env.KILO_BIN;
delete process.env.VIBE_BIN;

const { getRunner, listRunners, runnerSupportsModel } = require('../src/runners');
const kilo = require('../src/runners/kilo');
const vibe = require('../src/runners/vibe');
const { buildKiloArgs } = require('../src/kilo-command');
const { buildVibeArgs } = require('../src/vibe-command');

const REPO_ROOT = path.resolve(__dirname, '..');

function testRegistry() {
  const ids = listRunners().map((runner) => runner.id);
  assert.deepEqual(ids.sort(), ['kilo', 'opencode', 'vibe'], 'all three runners are registered');
  assert.equal(getRunner('KILO').id, 'kilo', 'runner lookup is case-insensitive');
  assert.equal(getRunner('Vibe').id, 'vibe', 'vibe lookup is case-insensitive');
  assert.equal(getRunner('nope'), null, 'unknown runner lookup returns null');
}

function testModelCatalogues() {
  const runners = listRunners();
  const opencodeModels = runners.find((runner) => runner.id === 'opencode').models;
  const kiloModels = runners.find((runner) => runner.id === 'kilo').models;
  const vibeModels = runners.find((runner) => runner.id === 'vibe').models;
  assert.ok(opencodeModels.length > 0, 'opencode advertises model ids');
  assert.ok(kiloModels.length > 0, 'kilo advertises free model ids');
  assert.deepEqual(
    vibeModels,
    ['zai-glm-5-3-flash-vibe-free', 'zai-glm-5-3-flash'],
    'vibe advertises its account free-lane id and alias'
  );
  assert.ok(
    opencodeModels.every((id) => id.startsWith('opencode/') || id.startsWith('omniroute/') || id.startsWith('kilo/')),
    'opencode accepts its own ids plus the Kilo Gateway lane'
  );
  assert.ok(kiloModels.every((id) => id.startsWith('kilo/')), 'kilo ids stay in its namespace');
  assert.equal(runnerSupportsModel(getRunner('kilo'), 'kilo/kilo-auto/free'), true, 'kilo accepts its own ids');
  assert.equal(runnerSupportsModel(getRunner('kilo'), 'opencode/big-pickle'), false, 'kilo rejects opencode ids');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'kilo/kilo-auto/free'), true, 'opencode resolves kilo gateway ids');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'opencode/big-pickle'), false, 'vibe rejects opencode ids');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'kilo/kilo-auto/free'), false, 'vibe rejects kilo ids');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'zai-glm-5-3-flash-vibe-free'), true, 'vibe accepts its free id');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'zai-glm-5-3-flash'), true, 'vibe accepts its free alias');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'zai-glm-5-3-flash'), false, 'opencode rejects vibe aliases');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'custom/provider-model'), true, 'unclaimed custom ids stay allowed');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'custom/provider-model'), true, 'custom ids stay allowed on vibe');
}

function testKiloArgs() {
  const args = buildKiloArgs({
    prompt: 'implement the task',
    files: ['/project/plan.md', '/project/.looparr/next_prompt.txt'],
    model: 'kilo/kilo-auto/free'
  });
  assert.deepEqual(args, [
    'run',
    '--auto',
    '--format',
    'json',
    '--model',
    'kilo/kilo-auto/free',
    'implement the task',
    '--file',
    '/project/plan.md',
    '--file',
    '/project/.looparr/next_prompt.txt'
  ], 'kilo invocation puts the prompt before the greedy --file array');

  assert.deepEqual(buildKiloArgs({ prompt: 'go' }), ['run', '--auto', '--format', 'json', 'go'], 'model is optional');
  assert.throws(() => buildKiloArgs({ prompt: '   ' }), /prompt is required/, 'blank prompt is rejected');
  assert.throws(() => buildKiloArgs({ prompt: 'go', model: 'a,b' }), /single model id/, 'model lists are rejected');
  assert.throws(() => buildKiloArgs({ prompt: 'go', model: 'a b' }), /whitespace/, 'model whitespace is rejected');
}

function testVibeArgs() {
  const args = buildVibeArgs({
    prompt: 'implement the task',
    files: ['/project/plan.md'],
    model: 'zai-glm-5-3-flash-vibe-free'
  });
  assert.deepEqual(args.slice(0, 6), [
    '--prompt',
    'implement the task\n\nProject files for this step (read them from the working directory):\n- /project/plan.md',
    '--auto-approve',
    '--output',
    'streaming',
    '--max-price'
  ], 'vibe names seed files in the prompt and streams structured output');
  assert.equal(args[6], '0', 'vibe runs are capped at zero cost');
  assert.deepEqual(args.slice(7), ['--model', 'zai-glm-5-3-flash-vibe-free'], 'vibe model alias is appended last');
  assert.ok(!args.includes('--file'), 'vibe has no attachment flag');
  assert.ok(!args.includes('--prompt-file'), 'vibe reads the prompt inline, not from a file');

  assert.deepEqual(
    buildVibeArgs({ prompt: 'go' }).slice(0, 2),
    ['--prompt', 'go'],
    'files are optional and the prompt is unchanged'
  );
  assert.throws(() => buildVibeArgs({ prompt: '  ' }), /prompt is required/, 'blank prompt is rejected');
  assert.throws(() => buildVibeArgs({ prompt: 'go', model: 'a,b' }), /single model id/, 'model lists are rejected');
  assert.throws(() => buildVibeArgs({ prompt: 'go', model: '-x' }), /cannot start with/, 'flag-like models are rejected');
}

function testKiloBridgePayload() {
  const built = kilo.buildCommand({
    prompt: 'go',
    cwd: '/project',
    files: ['/project/plan.md'],
    model: 'kilo/kilo-auto/free',
    runKey: 'kilo-run-1',
    projectId: 'p1',
    phase: 'implement',
    task: 'Task'
  });
  assert.equal(built.command, process.execPath, 'bridge mode runs node');
  assert.deepEqual(built.args, [path.join(REPO_ROOT, 'scripts', 'bridge-client.js')], 'bridge client is the entry point');
  const payload = JSON.parse(built.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(payload.runner, 'kilo', 'payload carries the kilo runner id');
  assert.equal(payload.model, 'kilo/kilo-auto/free', 'payload carries the model');
  assert.deepEqual(payload.files, ['/project/plan.md'], 'payload carries file attachments');
  assert.equal(built.options.env.LOOPARR_EXECUTOR_URL, 'http://127.0.0.1:4187', 'payload targets the executor');
  assert.throws(
    () => kilo.buildCommand({ prompt: 'go', cwd: '/project' }),
    /runKey is required/,
    'bridge mode requires a run key'
  );
}

function testVibeBridgePayload() {
  const built = vibe.buildCommand({
    prompt: 'go',
    cwd: '/project',
    files: ['/project/plan.md'],
    model: '',
    runKey: 'vibe-run-1',
    projectId: 'p1',
    phase: 'seed',
    task: 'Task'
  });
  const payload = JSON.parse(built.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(payload.runner, 'vibe', 'payload carries the vibe runner id');
  assert.equal(payload.model, '', 'vibe model is optional');
  assert.deepEqual(payload.files, ['/project/plan.md'], 'payload carries the seed file');
  assert.throws(
    () => vibe.buildCommand({ prompt: 'go', cwd: '/project' }),
    /runKey is required/,
    'vibe bridge mode requires a run key'
  );
}

function testOpencodeBridgePayload() {
  const opencode = require('../src/runners/opencode');
  const built = opencode.buildCommand({
    prompt: 'go',
    cwd: '/project',
    files: [],
    model: 'opencode/big-pickle',
    runKey: 'opencode-run-1',
    projectId: 'p1'
  });
  const payload = JSON.parse(built.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(payload.runner, 'opencode', 'opencode payload carries its runner id');
  assert.equal(payload.model, 'opencode/big-pickle', 'opencode payload carries the model');
}

function testRunnersReachExecutor() {
  // Every CLI runner delegates cancellation to the same executor endpoints.
  const opencode = getRunner('opencode');
  assert.equal(kilo.cancelStaleRuns, opencode.cancelStaleRuns, 'kilo cancel is shared');
  assert.equal(vibe.cancelStaleRuns, opencode.cancelStaleRuns, 'vibe cancel is shared');
  assert.equal(vibe.listActiveRuns, opencode.listActiveRuns, 'vibe active listing is shared');
  assert.equal(kilo.isRateLimit('{"error":"HTTP 429 Too Many Requests"}'), true, 'rate limits are detected');
  assert.equal(vibe.isRateLimit('{"error":"HTTP 429 Too Many Requests"}'), true, 'vibe rate limits are detected');
}

testRegistry();
testModelCatalogues();
testKiloArgs();
testVibeArgs();
testKiloBridgePayload();
testVibeBridgePayload();
testOpencodeBridgePayload();
testRunnersReachExecutor();

console.log('runner payload tests passed');
