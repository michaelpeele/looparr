'use strict';

const assert = require('node:assert/strict');
const { DEFAULT_KILO_MODEL, buildKiloArgs } = require('../src/kilo-command');

// Kilo's --file is a yargs array option and swallows every following positional,
// so the prompt has to be emitted before the file flags.
const withFile = buildKiloArgs({
  prompt: 'Reply with OK',
  files: ['plan.md'],
  model: DEFAULT_KILO_MODEL
});

assert.ok(
  withFile.indexOf('Reply with OK') < withFile.indexOf('--file'),
  `prompt must precede --file; got ${JSON.stringify(withFile)}`
);
assert.equal(withFile[withFile.length - 1], 'plan.md', 'file flag stays last');
assert.deepEqual(
  withFile.slice(0, 6),
  ['run', '--auto', '--format', 'json', '--model', DEFAULT_KILO_MODEL],
  'explicit free model flag stays first'
);

const noFiles = buildKiloArgs({ prompt: 'plain prompt' });
assert.equal(noFiles[noFiles.length - 1], 'plain prompt', 'prompt stays the last argument without files');
assert.deepEqual(noFiles.slice(4, 6), ['--model', DEFAULT_KILO_MODEL], 'blank model uses explicit free default');

assert.throws(() => buildKiloArgs({ prompt: '   ' }), /prompt is required/, 'blank prompts are rejected');

console.log('kilo args: prompt precedes --file.');
