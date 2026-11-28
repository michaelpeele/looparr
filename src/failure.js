'use strict';

// Classifies a failed step so the engine knows whether another candidate is
// worth trying. Auth, entitlement and billing failures are terminal: switching
// model or runner cannot fix them.
const TERMINAL_RE = /\b(?:401|403)\b|unauthorized|forbidden|invalid[ _-]?api[ _-]?key|incorrect api key|api key (?:is )?(?:invalid|missing)|payment required|billing|subscription|out of credits|insufficient (?:credits|funds|balance)|plan (?:limit|required|upgrade)|higher_plan/i;

// Provider-shaped failures that another candidate may avoid.
const RETRYABLE_RE = /\b(?:429|500|502|503|504)\b|too many requests|rate[ _-]?limit|quota (?:exceeded|reached)|usage limit|throttl|tokens per minute|budget (?:exhausted|exceeded)|max[\s-]?price (?:exceeded|reached)|spend(?:ing)? limit (?:exceeded|reached)|timed? out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|model (?:not found|does not exist|unsupported|unavailable)|unsupported (?:field|property|parameter|model)|reasoning_details|provider error|overloaded|internal server error|service temporarily unavailable|all targets were skipped by pre-dispatch filters/i;

// Transient process kills: SIGKILL / exit 137 (128+9), OOM, and resource/cgroup
// kills of the agent CLI. Phrasing matches what engine.sprintExitFailure emits.
// Terminal (auth/billing/permission) text always wins over this class.
const TRANSIENT_KILL_RE = /\bsigkill\b|\bexit(?:ed)?\b[^.\n]*\b137\b|\bcode 137\b|\boom\b|out of memory|memory (?:limit|pressure)|cgroup|resource[\s/_-]*(?:kill|limit|constraint)|killed by (?:the )?(?:oom|kernel|cgroup|resource)/i;

function classifyFailure(text, { isRateLimit } = {}) {
  const value = String(text || '');
  if (!value.trim()) return 'stop';
  if (TERMINAL_RE.test(value)) return 'stop';
  if (typeof isRateLimit === 'function' && isRateLimit(value)) return 'advance';
  if (RETRYABLE_RE.test(value)) return 'advance';
  return 'stop';
}

// True only for a transient SIGKILL/OOM/resource kill that is not also a
// terminal auth/billing/permission failure. Terminal always wins.
function isTransientKill(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  if (TERMINAL_RE.test(value)) return false;
  return TRANSIENT_KILL_RE.test(value);
}

module.exports = { classifyFailure, isTransientKill, TERMINAL_RE, RETRYABLE_RE, TRANSIENT_KILL_RE };
