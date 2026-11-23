'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CONFIG_FILENAME,
  KILO_BASE_URL,
  KILO_MODELS,
  ensureKiloProvider
} = require('../src/opencode-provider');

const REPO_ROOT = path.resolve(__dirname, '..');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-provider-'));
}

function readConfig(root) {
  return JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILENAME), 'utf8'));
}

function testCreatesMissingFile() {
  const root = tempRoot();
  try {
    const result = ensureKiloProvider({ root });
    assert.equal(result.status, 'created', 'missing config is created');
    assert.equal(result.path, path.join(root, CONFIG_FILENAME), 'reports the config path');
    const config = readConfig(root);
    const provider = config.providers.kilo;
    assert.ok(provider, 'kilo provider present');
    assert.equal(provider.settings.baseURL, KILO_BASE_URL, 'gateway baseURL');
    assert.equal(provider.package, 'aisdk:@ai-sdk/openai-compatible', 'provider package');
    assert.ok(!('apiKey' in provider.settings), 'provider stays keyless');
    for (const id of Object.keys(KILO_MODELS)) {
      assert.ok(provider.models[id], `model ${id} declared`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testIdempotent() {
  const root = tempRoot();
  try {
    ensureKiloProvider({ root });
    const first = fs.readFileSync(path.join(root, CONFIG_FILENAME), 'utf8');
    const second = ensureKiloProvider({ root });
    assert.equal(second.status, 'unchanged', 'second run is a no-op');
    assert.equal(fs.readFileSync(path.join(root, CONFIG_FILENAME), 'utf8'), first, 'file content is stable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testPreservesOtherConfig() {
  const root = tempRoot();
  try {
    const original = {
      $schema: 'https://opencode.ai/config.json',
      theme: 'dark',
      providers: {
        other: { name: 'Other', package: 'aisdk:@ai-sdk/openai-compatible', models: { 'x/y': { name: 'XY' } } }
      }
    };
    fs.writeFileSync(path.join(root, CONFIG_FILENAME), `${JSON.stringify(original, null, 2)}\n`);
    const result = ensureKiloProvider({ root });
    assert.equal(result.status, 'updated', 'existing config is updated');
    const config = readConfig(root);
    assert.equal(config.theme, 'dark', 'unrelated keys survive');
    assert.equal(config.$schema, original.$schema, 'schema survives');
    assert.deepEqual(config.providers.other, original.providers.other, 'other providers survive');
    assert.ok(config.providers.kilo, 'kilo provider added');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testKeepsCustomProviderSettings() {
  const root = tempRoot();
  try {
    const custom = {
      providers: {
        kilo: {
          name: 'Custom Kilo',
          package: 'aisdk:@ai-sdk/openai-compatible',
          settings: { baseURL: 'https://proxy.example.test/gateway' },
          models: { 'kilo-auto/free': { name: 'Router' } }
        }
      }
    };
    fs.writeFileSync(path.join(root, CONFIG_FILENAME), `${JSON.stringify(custom, null, 2)}\n`);
    ensureKiloProvider({ root });
    const config = readConfig(root);
    const provider = config.providers.kilo;
    assert.equal(provider.name, 'Custom Kilo', 'custom name is kept');
    assert.equal(provider.settings.baseURL, 'https://proxy.example.test/gateway', 'custom baseURL is kept');
    for (const id of Object.keys(KILO_MODELS)) {
      assert.ok(provider.models[id], `missing model ${id} is filled in`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRejectsBrokenJson() {
  const root = tempRoot();
  try {
    const file = path.join(root, CONFIG_FILENAME);
    fs.writeFileSync(file, '{ "providers": {');
    assert.throws(() => ensureKiloProvider({ root }), /is not valid JSON/, 'broken JSON is reported');
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "providers": {', 'broken file is left untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRepoConfigCurrent() {
  const result = ensureKiloProvider({ root: REPO_ROOT });
  assert.equal(result.status, 'unchanged', 'committed opencode.json already carries the free lane');
  const config = readConfig(REPO_ROOT);
  const provider = config.providers.kilo;
  for (const id of Object.keys(KILO_MODELS)) {
    assert.ok(provider.models[id], `repo config declares ${id}`);
  }
}

testCreatesMissingFile();
testIdempotent();
testPreservesOtherConfig();
testKeepsCustomProviderSettings();
testRejectsBrokenJson();
testRepoConfigCurrent();

console.log('opencode provider tests passed');
