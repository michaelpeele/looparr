# Durable resume snapshot — implementation prompt

Status: open. Plan item: `(plan) Durable resume snapshot`.
Batch: first of three — `Durable resume snapshot` → `Handoff recovery sweep` → `Self-healing debugging mode`. Self-heal depends on this and on recovery.

## Incident this prevents

On 2026-11-24 an `implement` run errored. The runtime phase (`nextPhase`) lives only in
memory (`ensureRuntime`, `src/engine.js:58`, defaults `status:'idle', nextPhase:'seed'`).
`writeCheckpointIntent` (`src/engine.js:561`) returns early when `rt.status === 'error'`
(`:565`) and requires `rt.active` (`:563`), so the errored `implement` phase was never
persisted. On the next boot there was no checkpoint to restore, and the project came up at
`seed`. A restart therefore loses the phase and silently re-runs the seed step instead of
resuming `implement`.

## Goal

Persist a **serializable runtime snapshot** to disk often enough that a crash or purposeful
restart resumes the same *resumable* state: `nextPhase`, `status`, `currentTask`, the step
bookkeeping, model/rotation cursor, and session ids. This is not byte-exact process state — a
live child process, open handles, and tokens cannot be serialized; a crash mid-step resumes by
re-running that step from its start (idempotent via `runKey` + `resumeSessionId`).

## Current building blocks (already implemented)

- Auto-resume intent `writeIntent` / `readIntent` / `consumeIntent`
  (`src/auto-resume.js`): versioned (`version: 1`), atomic temp+rename, `0o600`, 24 h TTL,
  redaction of tokens/urls, validates `projectId`, `reason`, `nextPhase`, `capturedAt`.
  Fields today: `nextPhase, status, currentTask, resumeAt, runKey, pid, hostname, opencodeSessionId`.
- `writeCheckpointIntent` (`src/engine.js:561`) — runs every `CHECKPOINT_INTERVAL_MS`
  (30 s, `src/engine.js:23`) from `tick`, but skips error/idle and requires `rt.active`.
- `resumeOnStart` (`src/engine.js:1707`) — consumes the intent, validates provenance
  (`readHandoffTask` vs task text), restores `nextPhase`/`status`/`currentTask`/`opencodeSessionId`.
- `data/rotation-state.json` (`src/rotation-store.js`) already persists rotation cursors/cooldowns.
- `data/logs/` NDJSON (`src/log-store.js`) already persists logs.

## Design

1. **Split persistence from policy.** Today persistence is gated on
   `project.autoResumeOnStart === true` and `shouldCaptureResumeIntent()`
   (`src/auto-resume.js`). Add a *snapshot* that is written regardless of auto-resume policy, so
   the disk state always exists; auto-resume-on-boot remains a separate policy decision.
2. **Extend the intent schema** with a `snapshot` object (keep `version` bump to 2, or add an
   optional `snapshot` field read as `undefined` for v1). Snapshot fields (all serializable):
   `nextPhase, status, currentTask, stepTask, stepOutput, modelIndex, modelAttemptRunKey,
   rotationCursor, rateLimitBackoffKey, resumeAt, cooloffUntil, opencodeSessionId,
   resumeSessionId, planPhaseSnapshot, runKey, capturedAt`. Never persist secrets; redact.
3. **Capture more states.** Relax `writeCheckpointIntent` to also snapshot when
   `status === 'error'` and when idle-but-`currentTask` is set, so the phase survives an error.
   Keep the `rt.child`/`rt.starting` guard (do not snapshot mid-spawn of a live child; the
   between-step and error states are what matter).
4. **Restore in `resumeOnStart`.** After the existing provenance/TTL validation, apply the
   snapshot fields to the fresh `rt` (model index, rotation cursor, step bookkeeping, session
   ids, rate-limit/cooloff timers). Preserve the existing degrade-to-seed rules: provenance
   mismatch, stale intent, task-no-longer-next, plan-phase handling.
5. **Atomic + bounded.** Keep temp+rename writes and the 24 h TTL; cap `stepOutput` and
   `currentTask` length in the snapshot as the intent already does (`STATE_TASK_MAX_CHARS`).

## Requirements

1. Add a serializable snapshot to the auto-resume state file and restore it on boot. Do not
   persist `rt.child`, functions, or secrets.
2. Write the snapshot on every checkpoint tick (keeping the existing
   `autoResumeOnStart` gate for this increment) and also when `status === 'error'`, so the
   errored phase is persisted. Decoupling persistence from the auto-resume policy is a follow-up.
3. Restore `nextPhase`, `status`, `currentTask`, `stepTask`, `modelIndex`, rotation cursor,
   `resumeAt`/`cooloffUntil`, and session ids from the snapshot after validation.
4. Keep every existing degrade rule intact: provenance mismatch (`readHandoffTask` vs task
   text), stale TTL, task-no-longer-next, and plan-phase special cases must still fall back to
   `seed` and clear the handoff.
5. Do not reintroduce a second copy of any list/constant; keep `PLAN_FILE_PREFIXES` and other
   shared constants single-sourced.
6. Tests: extend `scripts/test-auto-resume.js` with snapshot round-trip (write → read →
   restored fields), error-status capture, v1-without-snapshot backward compatibility,
   redaction (no token/url in file), and degrade-to-seed on provenance mismatch.
7. `npm test` and `git diff --check` clean. Commit only `src/engine.js`, `src/auto-resume.js`,
   `src/config.js` (if a setting is needed), and `scripts/test-auto-resume.js`.

## Verification

- Unit: round-trip a snapshot through `writeIntent`/`readIntent` and assert restored fields;
  assert `status:'error'` is now captured; assert a v1 file (no `snapshot`) still loads.
- Live (manual, after rebuild): force an `implement` error, confirm the state file contains the
  snapshot with `nextPhase:'implement'`, restart the container, and confirm the project resumes
  `implement` (not `seed`).
- Confirm `git diff --check` reports nothing.

## Acceptance criteria

- A crash or purposeful restart restores `nextPhase` and the resumable fields for an errored or
  between-step run; the pre-seed drop no longer happens.
- Existing auto-resume degrade/provenance behavior and `scripts/test-auto-resume.js` still pass.
- `npm test` green; only the file-map paths changed.

## Risks

- **Over-persisting a live child.** Snapshot only between-step/error states; a mid-spawn child
  is represented by its runKey/session id so the step re-runs cleanly.
- **Stale/wrong-task injection.** Provenance and TTL checks must run before any snapshot field
  is applied — a snapshot never overrides the handoff provenance gate.
- **Secret leakage.** Reuse `redactText`; never write auth tokens or full URLs.
- **Schema drift.** Version the file and read unknown/absent `snapshot` as "no snapshot" so old
  checkpoints still degrade to seed rather than crash.