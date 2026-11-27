'use strict';

const assert = require('node:assert/strict');
const { classifyFailure, isTransientKill } = require('../src/failure');

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

// isTransientKill: SIGKILL / exit 137 / OOM / cgroup-kill phrasings are
// retryable transient kills; terminal auth/billing/permission text always wins.
const sprintKillMessage = 'Sprint implement killed by SIGKILL (exit 137) — likely OOM or a resource/cgroup kill of the agent CLI. Reduce memory pressure or raise the limit, then resume.';
const transientCases = [
  sprintKillMessage,
  'process killed by SIGKILL',
  'Sprint implement exited with code 137',
  'exit 137',
  'JavaScript heap out of memory',
  'OOMKilled: container exceeded memory limit',
  'cgroup memory limit exceeded, killed by kernel',
  'resource/cgroup kill of the agent CLI'
];
for (const text of transientCases) {
  assert.equal(isTransientKill(text), true, `transient kill ${JSON.stringify(text)}`);
}

const terminalKillCases = [
  '401 unauthorized: killed by OOM after SIGKILL',
  'invalid api key (exit 137 SIGKILL)',
  'billing subscription required; process OOM killed',
  '403 forbidden cgroup kill'
];
for (const text of terminalKillCases) {
  assert.equal(isTransientKill(text), false, `terminal wins ${JSON.stringify(text)}`);
}

const nonKillCases = ['', 'handoff missing', 'Sprint implement exited with code 1', 'rate limit exceeded'];
for (const text of nonKillCases) {
  assert.equal(isTransientKill(text), false, `non-kill ${JSON.stringify(text)}`);
}

console.log(`failure classification: ${cases.length} classify cases + ${transientCases.length + terminalKillCases.length + nonKillCases.length} transient-kill cases matched.`);
