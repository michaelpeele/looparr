'use strict';

const assert = require('assert');
const path = require('path');

process.env.LOOPARR_EXECUTOR_URL = 'http://127.0.0.1:4187';
process.env.LOOPARR_EXECUTOR_TOKEN = 'test-executor-token';
delete process.env.KILO_BIN;
delete process.env.VIBE_BIN;

const { getRunner, listRunners, runnerSupportsModel, resolveRunnerModels } = require('../src/runners');
const kilo = require('../src/runners/kilo');
const vibe = require('../src/runners/vibe');
const { buildKiloArgs } = require('../src/kilo-command');
const { buildVibeArgs, CONTEXT_HEADER } = require('../src/vibe-command');
const { isKnownNonFreeModel } = require('../src/model-list');

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
    opencodeModels.every((id) => id.startsWith('opencode/') || id.startsWith('kilo/')),
    'opencode advertises only free OpenCode ids plus the Kilo Gateway lane'
  );
  assert.ok(kiloModels.every((id) => id.startsWith('kilo/')), 'kilo ids stay in its namespace');
  assert.equal(runnerSupportsModel(getRunner('kilo'), 'kilo/baidu/ernie-5.5-flash-preview:free'), true, 'kilo accepts its own ids');
  assert.equal(runnerSupportsModel(getRunner('kilo'), 'opencode/tidepool-alpha-free'), false, 'kilo rejects opencode ids');
  assert.equal(runnerSupportsModel(getRunner('kilo'), 'custom/provider-model'), false, 'kilo rejects custom ids');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'kilo/baidu/ernie-5.5-flash-preview:free'), true, 'opencode resolves kilo gateway ids');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'opencode/tidepool-alpha-free'), false, 'vibe rejects opencode ids');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'kilo/baidu/ernie-5.5-flash-preview:free'), false, 'vibe rejects kilo ids');
  for (const id of ['kilo/kilo-auto/free', 'kilo/openrouter/free', 'kilo/nvidia/nemotron-3.5-super-vl:free']) {
    for (const runnerId of ['opencode', 'kilo', 'vibe']) {
      assert.equal(runnerSupportsModel(getRunner(runnerId), id), false, `${runnerId} rejects unsupported ${id}`);
    }
  }
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'zai-glm-5-3-flash-vibe-free'), true, 'vibe accepts its free id');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'zai-glm-5-3-flash'), true, 'vibe accepts its free alias');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'opencode/big-pickle'), true, 'opencode accepts its default draft model');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'opencode/big-pickle'), false, 'vibe rejects an unlisted opencode-namespaced id');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'zai-glm-5-3-flash'), false, 'opencode rejects vibe aliases');
  assert.equal(runnerSupportsModel(getRunner('opencode'), 'custom/provider-model'), true, 'unclaimed custom ids stay allowed');
  assert.equal(runnerSupportsModel(getRunner('vibe'), 'custom/provider-model'), true, 'custom ids stay allowed on vibe');

  let skipped = [];
  let fallback = '';
  const resolvedKilo = resolveRunnerModels(getRunner('kilo'), 'opencode/big-pickle,omniroute/auto', {
    onSkip: (dropped) => { skipped = dropped; },
    onFallback: (id) => { fallback = id; }
  });
  assert.deepEqual(skipped, ['opencode/big-pickle', 'omniroute/auto'], 'opencode and omniroute ids are skipped for Kilo');
  assert.equal(isKnownNonFreeModel('opencode/big-pickle'), false, 'big-pickle stays available on OpenCode');
  assert.deepEqual(resolvedKilo.models, ['kilo/baidu/ernie-5.5-flash-preview:free'], 'Kilo falls back to its first free model');
  assert.equal(fallback, 'kilo/baidu/ernie-5.5-flash-preview:free', 'Kilo fallback callback receives the free model');
  assert.equal(resolvedKilo.usedFallback, true, 'Kilo fallback is reported');
}

function testVibeModelResolution() {
  const skipped = [];
  let fallback = '';
  let usedFallback = null;
  const configured = 'opencode/big-pickle,kilo/baidu/ernie-5.5-flash-preview:free,zai-glm-5-3-flash-vibe-free';
  const resolved = resolveRunnerModels(getRunner('vibe'), configured, {
    onSkip: (dropped) => { skipped.push(...dropped); },
    onFallback: (id) => { fallback = id; }
  });
  usedFallback = resolved.usedFallback;
  assert.deepEqual(
    skipped,
    ['opencode/big-pickle', 'kilo/baidu/ernie-5.5-flash-preview:free'],
    'vibe drops foreign-namespaced ids instead of dispatching them'
  );
  assert.deepEqual(resolved.models, ['zai-glm-5-3-flash-vibe-free'], 'a free vibe id survives resolution');
  assert.equal(fallback, '', 'no fallback fires while a compatible id remains');
  assert.equal(usedFallback, false, 'fallback is not reported');
}

function testKiloArgs() {
  const args = buildKiloArgs({
    prompt: 'implement the task',
    files: ['/project/plan.md', '/project/.looparr/next_prompt.txt'],
    model: 'kilo/baidu/ernie-5.5-flash-preview:free'
  });
  assert.deepEqual(args, [
    'run',
    '--auto',
    '--format',
    'json',
    '--model',
    'kilo/baidu/ernie-5.5-flash-preview:free',
    'implement the task',
    '--file',
    '/project/plan.md',
    '--file',
    '/project/.looparr/next_prompt.txt'
  ], 'kilo invocation puts the prompt before the greedy --file array');

  assert.deepEqual(
    buildKiloArgs({ prompt: 'go' }),
    ['run', '--auto', '--format', 'json', '--model', 'kilo/baidu/ernie-5.5-flash-preview:free', 'go'],
    'blank model uses explicit free default'
  );
  assert.deepEqual(
    buildKiloArgs({ prompt: 'go', files: [] }),
    ['run', '--auto', '--format', 'json', '--model', 'kilo/baidu/ernie-5.5-flash-preview:free', 'go'],
    'empty files list produces no --file arg'
  );
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
  const emptyFilesArgs = buildVibeArgs({ prompt: 'go', files: [] });
  assert.deepEqual(emptyFilesArgs.slice(0, 2), ['--prompt', 'go'], 'empty files keep the prompt as go');
  assert.ok(!emptyFilesArgs[1].includes(CONTEXT_HEADER), 'empty files add no Project files line');
  assert.ok(
    buildVibeArgs({ prompt: 'go', files: ['/abs/plan.md'] })[1].includes('/abs/plan.md'),
    'files provided still append the Project files line'
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
    model: 'kilo/baidu/ernie-5.5-flash-preview:free',
    runKey: 'kilo-run-1',
    projectId: 'p1',
    phase: 'implement',
    task: 'Task'
  });
  assert.equal(built.command, process.execPath, 'bridge mode runs node');
  assert.deepEqual(built.args, [path.join(REPO_ROOT, 'scripts', 'bridge-client.js')], 'bridge client is the entry point');
  const payload = JSON.parse(built.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(payload.runner, 'kilo', 'payload carries the kilo runner id');
  assert.equal(payload.model, 'kilo/baidu/ernie-5.5-flash-preview:free', 'payload carries the model');
  assert.deepEqual(payload.files, ['/project/plan.md'], 'payload carries file attachments');
  assert.equal(built.options.env.LOOPARR_EXECUTOR_URL, 'http://127.0.0.1:4187', 'payload targets the executor');
  assert.throws(
    () => kilo.buildCommand({ prompt: 'go', cwd: '/project' }),
    /runKey is required/,
    'bridge mode requires a run key'
  );

  const seedBuilt = kilo.buildCommand({
    prompt: 'seed prompt',
    cwd: '/project',
    files: [],
    runKey: 'kilo-run-seed',
    projectId: 'p1',
    phase: 'seed',
    task: 'Task'
  });
  const seedPayload = JSON.parse(seedBuilt.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(seedPayload.model, 'kilo/baidu/ernie-5.5-flash-preview:free', 'kilo seed payload carries explicit free model');
  assert.deepEqual(seedPayload.files, [], 'kilo seed payload carries no files');
  const bridgeArgs = seedBuilt.args.slice(1).join(' ');
  assert.ok(!bridgeArgs.includes('--file'), 'kilo seed bridge args have no --file');
  assert.ok(seedPayload.prompt.includes('seed prompt'), 'kilo seed payload carries the prompt');
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

  const seedBuilt = vibe.buildCommand({
    prompt: 'seed prompt',
    cwd: '/project',
    files: [],
    runKey: 'vibe-run-seed',
    projectId: 'p1',
    phase: 'seed',
    task: 'Task'
  });
  const seedPayload = JSON.parse(seedBuilt.options.env.LOOPARR_TASK_PAYLOAD);
  assert.deepEqual(seedPayload.files, [], 'vibe seed payload carries no files');
  assert.ok(!seedPayload.prompt.includes(CONTEXT_HEADER), 'vibe seed prompt has no Project files line');
  assert.ok(seedPayload.prompt.includes('seed prompt'), 'vibe seed payload carries the prompt');
}

function testOpencodeBridgePayload() {
  const opencode = require('../src/runners/opencode');
  const built = opencode.buildCommand({
    prompt: 'go',
    cwd: '/project',
    files: [],
    model: 'opencode/tidepool-alpha-free',
    runKey: 'opencode-run-1',
    projectId: 'p1'
  });
  const payload = JSON.parse(built.options.env.LOOPARR_TASK_PAYLOAD);
  assert.equal(payload.runner, 'opencode', 'opencode payload carries its runner id');
  assert.equal(payload.model, 'opencode/tidepool-alpha-free', 'opencode payload carries the model');
  assert.deepEqual(payload.files, [], 'opencode payload carries no files for files: []');
  assert.ok(
    !built.args.slice(1).join(' ').includes('--file'),
    'opencode bridge args contain no --file'
  );
}

function testDirectAttachFlagGuard() {
  const executorUrl = process.env.LOOPARR_EXECUTOR_URL;
  const runnerPath = require.resolve('../src/runners/opencode');
  const registryPath = require.resolve('../src/runners');
  try {
    delete process.env.LOOPARR_EXECUTOR_URL;
    delete require.cache[runnerPath];
    delete require.cache[registryPath];
    const opencode = require('../src/runners/opencode');
    assert.equal(opencode.probeAttachFlag('Usage\n      --server <url>\n'), '', 'modern help yields no attach flag');
    assert.equal(opencode.probeAttachFlag('Usage\n      --attach <url>\n'), '--attach', 'legacy help yields attach flag');

    opencode.setHelpProviderForTests(() => 'Usage\n      --server <url>\n');
    const modern = opencode.buildCommand({ prompt: 'fix bug', cwd: process.cwd() });
    assert.equal(modern.command, 'opencode', 'direct mode uses the opencode CLI');
    assert.equal(modern.args[0], 'run', 'direct mode starts with run');
    assert.ok(!modern.args.includes('--attach'), 'modern help never emits --attach');
    assert.ok(!modern.args.includes('--server'), 'modern help never emits --server');
    assert.ok(!modern.args.some((arg) => arg.startsWith('http')), 'modern help never passes an explicit URL');

    opencode.setHelpProviderForTests(() => 'Usage\n      --attach <url>\n');
    const legacy = opencode.buildCommand({ prompt: 'fix bug', cwd: process.cwd() });
    assert.equal(legacy.args[1], '--attach', 'legacy help still passes --attach');
    assert.equal(legacy.args[2], 'http://localhost:4096', 'legacy help still passes the URL');
  } finally {
    if (executorUrl === undefined) delete process.env.LOOPARR_EXECUTOR_URL;
    else process.env.LOOPARR_EXECUTOR_URL = executorUrl;
    delete require.cache[runnerPath];
    delete require.cache[registryPath];
  }
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
testVibeModelResolution();
testKiloArgs();
testVibeArgs();
testKiloBridgePayload();
testVibeBridgePayload();
testOpencodeBridgePayload();
testDirectAttachFlagGuard();
testRunnersReachExecutor();

console.log('runner payload tests passed');
