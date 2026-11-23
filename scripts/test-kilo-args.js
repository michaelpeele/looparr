'use strict';

const assert = require('node:assert/strict');
const { buildKiloArgs } = require('../src/kilo-command');

// Kilo's --file is a yargs array option and swallows every following positional,
// so the prompt has to be emitted before the file flags.
const withFile = buildKiloArgs({
  prompt: 'Reply with OK',
  files: ['plan.md'],
  model: 'kilo/kilo-auto/free'
});

assert.ok(
  withFile.indexOf('Reply with OK') < withFile.indexOf('--file'),
  `prompt must precede --file; got ${JSON.stringify(withFile)}`
);
assert.equal(withFile[withFile.length - 1], 'plan.md', 'file flag stays last');
assert.deepEqual(
  withFile.slice(0, 4),
  ['run', '--auto', '--format', 'json'],
  'run flags stay first'
);

const noFiles = buildKiloArgs({ prompt: 'plain prompt' });
assert.equal(noFiles[noFiles.length - 1], 'plain prompt', 'prompt stays the last argument without files');

assert.throws(() => buildKiloArgs({ prompt: '   ' }), /prompt is required/, 'blank prompts are rejected');

console.log('kilo args: prompt precedes --file.');
