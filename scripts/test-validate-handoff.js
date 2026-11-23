#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../src/config');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-handoff.js');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-validate-handoff-'));

function writeHandoff(name, text) {
  const file = path.join(TEMP_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

function runValidator(file, cwd = REPO_ROOT) {
  const args = file ? [VALIDATOR, file] : [VALIDATOR];
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}

const POISON_CASES = [
  ['Do not implement code yet.', 'do not implement code yet'],
  ['Do not implement any code.', 'do not implement code'],
  ['Do not implement the feature.', 'do not implement'],
  ['Stop before coding.', 'stop before coding'],
  ['Produce the prompt only.', 'produce the prompt only'],
  ['Write only a prompt.', 'write only prompt'],
  ['Write a detailed implementation prompt.', 'write a detailed implementation prompt'],
  ['Create implementation prompt for the next agent.', 'implementation prompt for next agent']
];

try {
  for (const [index, [text, reason]] of POISON_CASES.entries()) {
    const file = writeHandoff(`poison-${index}.txt`, text);
    const result = runValidator(file);
    assert.strictEqual(result.status, 1, `validator must reject: ${text}`);
    assert.ok(result.stderr.includes(reason), `expected reason "${reason}" in: ${result.stderr}`);
  }

  const cleanText = 'Analyze the log-rotation implementation. List files, risks, verification steps, and commit scope for the next agent.';
  const cleanFile = writeHandoff('clean.txt', cleanText);
  const cleanResult = runValidator(cleanFile);
  assert.strictEqual(cleanResult.status, 0, `validator must accept clean text: ${cleanResult.stderr}`);
  assert.ok(cleanResult.stdout.includes('Handoff clean'), cleanResult.stdout);

  const defaultFile = writeHandoff('default/.looparr/next_prompt.txt', cleanText);
  const defaultResult = runValidator(null, path.dirname(path.dirname(defaultFile)));
  assert.strictEqual(defaultResult.status, 0, `validator default path failed: ${defaultResult.stderr}`);

  const missingResult = runValidator(path.join(TEMP_DIR, 'missing.txt'));
  assert.strictEqual(missingResult.status, 1, 'missing file must fail');
  assert.ok(missingResult.stderr.includes('Cannot read handoff file'), missingResult.stderr);

  const migrations = [
    ['seedPromptTemplate', config.LEGACY_SEED_PROMPT_TEMPLATE, config.DEFAULT_SEED_PROMPT_TEMPLATE],
    ['seedPromptTemplate', config.LEGACY_STORED_SEED_PROMPT_TEMPLATE, config.DEFAULT_SEED_PROMPT_TEMPLATE],
    ['analyzePromptTemplate', config.LEGACY_ANALYZE_PROMPT_TEMPLATE, config.DEFAULT_ANALYZE_PROMPT_TEMPLATE],
    ['analyzePromptTemplate', config.LEGACY_DEFAULT_ANALYZE_PROMPT_TEMPLATE, config.DEFAULT_ANALYZE_PROMPT_TEMPLATE],
    ['analyzePromptTemplate', config.LEGACY_STORED_ANALYZE_PROMPT_TEMPLATE, config.DEFAULT_ANALYZE_PROMPT_TEMPLATE],
    ['planQuestionsPromptTemplate', config.LEGACY_PLAN_QUESTIONS_PROMPT_TEMPLATE, config.DEFAULT_PLAN_QUESTIONS_PROMPT_TEMPLATE],
    ['planWritePromptTemplate', config.LEGACY_PLAN_WRITE_PROMPT_TEMPLATE, config.DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE]
  ];
  for (const [field, legacyValue, expected] of migrations) {
    assert.strictEqual(config.normalizeSettings({ [field]: legacyValue })[field], expected, `migration failed for ${field}`);
  }

  const customText = 'Custom handoff instructions from the user.';
  assert.strictEqual(config.normalizeSettings({ planWritePromptTemplate: customText }).planWritePromptTemplate, customText);

  for (const template of [
    config.DEFAULT_SEED_PROMPT_TEMPLATE,
    config.DEFAULT_ANALYZE_PROMPT_TEMPLATE,
    config.DEFAULT_PLAN_WRITE_PROMPT_TEMPLATE
  ]) {
    assert.ok(template.includes('.looparr/next_prompt.handoff.tmp'), 'template must use a draft file');
    assert.ok(template.includes('scripts/validate-handoff.js'), 'template must run the validator');
    assert.ok(template.includes('until it passes'), 'template must require a clean rerun');
  }

  console.log('validate-handoff tests passed');
} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
