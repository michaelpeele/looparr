'use strict';

const assert = require('node:assert/strict');
const { classifyFailure } = require('../src/failure');

const isRateLimit = (text) => /\b429\b|rate[ _-]?limit/i.test(String(text));

const cases = [
  ['advance', 'HTTP 429 Too Many Requests', { isRateLimit }],
  ['advance', 'SessionError: [429]: Tokens per minute limit exceeded', { isRateLimit }],
  ['advance', 'Error: provider returned [400]: unsupported property reasoning_details', {}],
  ['advance', 'Error: 503 service unavailable', {}],
  ['advance', 'Error: model not found', {}],
  ['advance', 'connect ECONNREFUSED 172.17.0.1:4187', {}],
  ['advance', 'read ECONNRESET', {}],
  ['advance', 'SessionError: Service temporarily unavailable: all targets were skipped by pre-dispatch filters', {}],
  ['stop', 'Error: billing: subscription required', {}],
  ['stop', 'Error: 401 invalid api key', {}],
  ['stop', 'Error: 403 forbidden', {}],
  ['stop', 'payment required: out of credits', {}],
  ['stop', 'handoff missing', {}],
  ['stop', 'rotation success', {}],
  ['stop', '', {}]
];

for (const [expected, text, options] of cases) {
  assert.equal(classifyFailure(text, options), expected, `classify ${JSON.stringify(text)}`);
}

console.log(`failure classification: ${cases.length} cases matched.`);
