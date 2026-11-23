# Provider-error fallback, persisted rotation and runner rotation

Status: implemented 2026-11-23. Plan items: `(plan) Runner rotation`,
`(plan) Provider-error fallback and persisted rotation`.

## What changed

A failed step no longer always stops the project, and rotation no longer resets
on every engine start.

### Failure rule

`src/failure.js` classifies the step output:

| failure | action |
| --- | --- |
| 429 / rate limit (runner signature) | mark that model cooling, try next ready candidate |
| 400 model-schema (`reasoning_details`, unsupported property), model not found, 5xx, timeout, reset | try next candidate |
| 401 / 403 / invalid key / billing / plan entitlement | **stop** — switching cannot help |
| anything else | stop |

`tryNextCandidate()` in `src/engine.js` tries, in order:

1. the next model for the current runner that has not been tried in this step and
   is not cooling down;
2. when `runnerRotation` is on, the next runner in the project list and its first
   untried model;
3. otherwise it falls through to the existing error handler.

Every `runner:model` pair is tried at most once per step (`rt.tried`), so a broken
list cannot loop. Each switch is logged as `Model failure on X; retrying with Y.`
or `Runner failure on A; retrying with B.` Rate-limit saturation with no candidate
left logs `All candidates rate limited; next retry in Ns.` and keeps the
countdown; the next start re-picks from the persisted cooldowns instead of the
same throttled id.

### Persisted rotation

`src/rotation-store.js` writes `data/rotation-state.json` (override with
`LOOPARR_ROTATION_STATE`):

- `cursors` keyed by the joined candidate list, so a project that inherits the
  global list shares the global cursor, while a project-specific list gets its
  own. The cursor is only reset when the list content changes.
- `cooldowns` keyed by model id or runner id (`readyAt`). `pick()` walks from the
  stored cursor and skips anything still cooling, wrapping once; when everything
  is cooling it returns the earliest `waitMs` instead of a throttled candidate.
- Writes are atomic (tmp + rename) and failures are swallowed so rotation can
  never break a run.

`advanceRotationCursor()` now persists the served index after a successful step
for both models and runners.

### Runner rotation

- `project.runner` and `settings.globalRunner` accept ordered comma lists
  (`"opencode,kilo"`); a single id is unchanged and still the default.
- `runnerRotation` is a project override (nullable) over a global boolean, both
  defaulting to off, resolved exactly like the model rotation flags.
- `server.js` validates every id in a list and rejects the whole request naming
  the bad id; `src/config.js` normalizes lists and the new flag.
- `/api/state` now exposes `effectiveRunners`, `runnerRotation`,
  `effectiveRunnerRotation`, `activeRunner` and `activeModel`.
- The card renders `runner · model` (or `· default`) for the step in flight, and
  the drawer has a runner multi-select with its own rotation toggle.

### UI

Three runner pickers (global, add-project, drawer) are multi-selects with a
rotation toggle each, reusing the model rotation button. That makes 15
`data-rotate-for` toggles total (12 model + 3 runner).

## Tests

- `scripts/test-failure-classification.js` — 11 cases: rate limits, 400 schema,
  5xx, model-not-found, resets advance; 401/403/billing/unknown stop.
- `scripts/test-rotation-store.js` — cursor persists across a module reload,
  identical lists share a cursor, different lists do not, cooling ids are
  skipped, all-cooling reports a wait, expired cooldowns are ignored, advance
  wraps, single-entry lists never move.
- `scripts/test-model-rotation.js` — existing rotation/fallback cases, plus a
  400-provider-error case asserting `[ERR_MODEL, ERR_OK]` and the
  `Model failure on …` log line, an auth case asserting the project stops after
  one attempt, runner-list validation (unknown id rejected, list stored joined,
  non-boolean `runnerRotation` rejected), and the 15-toggle markup assertions.
- `npm test` passes with both new scripts appended to the chain.

## Verification

Production rebuilt and recreated, healthy, container source hashes match local
for every touched file, served `index.html` carries 15 rotation toggles, and
`/api/state` reports the new runner fields. The container runs the rotation-store
and failure-classification tests successfully.

## Known limits

- `omniroute/auto*` remains a router and can still dispatch to a model that
  rejects OpenCode's request shape; the fallback now moves on to the next model
  instead of stalling, but the id is still a poor default.
- Model cooldowns are per model id, not per runner+model, so a 429 on
  `kilo/kilo-auto/free` through one runner cools it for the other runner too.
  That is intentional (the provider is throttled), but worth remembering.
- Rotation state is a single JSON file; concurrent processes writing it will
  last-write-wins.
