'use strict';

const assert = require('node:assert/strict');
const { isRateLimit } = require('../src/runners/opencode.js');

const falsePositives = [
  'Rate limit detected. Retrying in 600s.',
  'Provider backoff engaged. Retrying in 600s.',
  '{"tool":"grep","output":"Rate limit detected. Retrying in 600s."}',
  '- [ ] Document rate limit handling and 429 backoff',
  'Keep next_prompt.txt Lean: Only have what’s needed for the next task',
  'throttle the throughput to stay under budget',
  'Output containing 429, rate limit, quota, usage limit, or throttle pauses only that project.',
  'status rateLimited',
  'rate limit detected',
  'Tokens per minute is a budget metric, not an error',
  'We track tokens per minute usage in the dashboard',
  'The plan mentions tokens per minute and 429 handling as prose',
  '"status":400',
  '{"status":200,"message":"ok"}',
  'the team reviewed the budget for next quarter',
  'max price is configured in the account settings',
  'a spending limit exists on the card'
];

const truePositives = [
  'HTTP 429',
  'HTTP/1.1 429 Too Many Requests',
  '429 too many requests',
  'status: 429',
  'code=429',
  '429: quota exceeded',
  'quota exceeded',
  'usage limit reached',
  'rate limit error',
  'API rate limit exceeded',
  'throttling error',
  'throttled request',
  'SessionError: [429]: Tokens per minute limit exceeded - too many tokens processed. (reset after 1m)',
  'Tokens per minute limit exceeded',
  '[429]: Tokens per minute limit exceeded',
  '"status":429',
  "'code': 429",
  '{"status":429,"message":"Too Many Requests"}',
  'Error: Vibe budget exhausted.',
  'budget exceeded',
  'max price exceeded',
  'spending limit reached',
  'error: Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.',
  '{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached"}}'
];

for (const text of falsePositives) {
  assert.equal(isRateLimit(text), false, `false positive: ${text}`);
}

for (const text of truePositives) {
  assert.equal(isRateLimit(text), true, `missed rate limit: ${text}`);
}

// An agent that commits inside a step prints the commit body and diff to stderr.
// The commit that documents the widened 429 pattern must not trip the pattern.
const gitNoise = [
  [
    'commit 4cfcc6f8a1b2c3d4e5f60718293a4b5c6d7e8f90',
    'Author: Michael Peele <michael@example.com>',
    'Date: Mon Nov 23 01:09:16 2026 +0000',
    '',
    '    fix(engine): name runner default model, widen 429 parser',
    '',
    '    - src/runners/opencode.js: RATE_LIMIT_PATTERN now matches bracketed',
    "      [429]:, '429: tokens per minute', and 'tokens per minute limit",
    "      exceeded/reached' so SessionError rate-limit lines trip the fallback.",
    '',
    'diff --git a/src/engine.js b/src/engine.js',
    'index 4cfcc6f..6fc2a7c 100644',
    '--- a/src/engine.js',
    '+++ b/src/engine.js',
    '@@ -712,11 +712,17 @@ function rateLimitRetry(project, rt, pauseMs) {',
    "+  return `${runner?.label || 'Runner'} default`;",
    "-  const currentModel = models[rt.modelIndex] || 'OpenCode default';"
  ].join('\n'),
  "+ expect(isRateLimit('HTTP 429 rate limit exceeded')).toBe(true)",
  "- '429: quota exceeded' moved to the new parser test"
];

for (const text of gitNoise) {
  assert.equal(isRateLimit(text), false, `git output misread as rate limit: ${text.slice(0, 60)}`);
}

const noisyTail = `${gitNoise[0]}\nSessionError: [429]: Tokens per minute limit exceeded - too many tokens processed. (reset after 1m)`;
assert.equal(isRateLimit(noisyTail), true, 'a real 429 after git output is still detected');

console.log(
  `Rate-limit detection: ${falsePositives.length + gitNoise.length} false positives rejected, ${truePositives.length + 1} signatures detected.`
);
