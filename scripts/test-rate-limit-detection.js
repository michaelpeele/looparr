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
  'The plan mentions tokens per minute and 429 handling as prose'
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
  '[429]: Tokens per minute limit exceeded'
];

for (const text of falsePositives) {
  assert.equal(isRateLimit(text), false, `false positive: ${text}`);
}

for (const text of truePositives) {
  assert.equal(isRateLimit(text), true, `missed rate limit: ${text}`);
}

console.log(`Rate-limit detection: ${falsePositives.length} false positives rejected, ${truePositives.length} signatures detected.`);
