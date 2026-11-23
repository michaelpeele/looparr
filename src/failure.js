'use strict';

// Classifies a failed step so the engine knows whether another candidate is
// worth trying. Auth, entitlement and billing failures are terminal: switching
// model or runner cannot fix them.
const TERMINAL_RE = /\b(?:401|403)\b|unauthorized|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|api key (?:is )?(?:invalid|missing)|payment required|billing|subscription|out of credits|insufficient (?:credits|funds|balance)|plan (?:limit|required|upgrade)|higher_plan/i;

// Provider-shaped failures that another candidate may avoid.
const RETRYABLE_RE = /\b(?:429|500|502|503|504)\b|too many requests|rate[ _-]?limit|quota (?:exceeded|reached)|usage limit|throttl|tokens per minute|timed? out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|model (?:not found|does not exist|unsupported|unavailable)|unsupported (?:field|property|parameter|model)|reasoning_details|provider error|overloaded|internal server error|service temporarily unavailable|all targets were skipped by pre-dispatch filters/i;

function classifyFailure(text, { isRateLimit } = {}) {
  const value = String(text || '');
  if (!value.trim()) return 'stop';
  if (TERMINAL_RE.test(value)) return 'stop';
  if (typeof isRateLimit === 'function' && isRateLimit(value)) return 'advance';
  if (RETRYABLE_RE.test(value)) return 'advance';
  return 'stop';
}

module.exports = { classifyFailure, TERMINAL_RE, RETRYABLE_RE };
