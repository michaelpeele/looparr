# Plan: Durable resume snapshot

Status: open
Source: `.project_documents/PLAN-durable-resume-snapshot.md`
Scope: verify and close the existing snapshot path, then add the missing one-retry bound and behavioral prior-step context. No code changes are made by this PLAN WRITE step.

## Decisions

- No gap skip: treat capture, sanitize, and restore as implemented baseline; verify them against this plan.
- Keep `project.autoResumeOnStart === true` gate for snapshot writes. Decoupling is a follow-up.
- Errored snapshots auto-re-run on resume, bounded to one retry across restarts.
- `stepOutput` is behaviorally consumed as prior-step context on the resumed re-run.
- Keep schema `version: 1` with optional `snapshot`. Old intents read as absent. No v2 in this batch.
- Every-tick rewrite while errored is acceptable. No dedupe in this batch.

## Design

1. Persistence and policy stay coupled for this increment.
   - `writeCheckpointIntent` writes a snapshot only when `project.autoResumeOnStart === true`.
   - `autoResume.shouldCaptureResumeIntent()`, a valid current task, not paused, and status not `done` remain required.
   - Capture when `rt.active === true`, `rt.status === 'error'`, or idle with a current task. Keep paused, done, and opt-out paths unchanged.

2. Keep the v1 intent shape.
   - Top level: `version: 1`, `projectId`, `capturedAt`, `reason`, `nextPhase`, `status`, `currentTask`, `resumeAt`, `pid`, `hostname`, optional `error`, `runKey`, `opencodeSessionId`, optional `snapshot`.
   - `snapshot` stays optional and additive. v1 files without it remain valid. Non-object snapshots are ignored.
   - Write atomically via temp file plus rename, mode `0o600`. Keep 24 h TTL and future-skew validation.

3. Snapshot is a whitelist.
   - Preserve `nextPhase`, `status`, `currentTask`, `stepTask`, redacted/capped `stepOutput`, `modelIndex`, `modelAttemptRunKey`, `rotationCursor`, `rateLimitBackoffKey`, `resumeAt`, `cooloffUntil`, `resumeSessionId`, `planPhaseSnapshot`, `healer`/`lastHealer`, and the new bounded retry counter.
   - Keep existing caps: step output 4000 chars, task 2000 chars, rotation entries 50, plan keys 20, plan strings 500 chars, healer strings 200 chars, key length 64.
   - `redactText` must keep Bearer tokens, Authorization headers, URLs, and token/secret/password/api-key assignments out of persisted and prompted text.
   - Define retry bound once in `src/auto-resume.js`. Do not duplicate the limit or cap constants.

4. Restore only through existing gates.
   - Validate version, project id, reason, phase, capturedAt, 24 h TTL, future skew, session id, handoff provenance, task provenance, task-no-longer-next, and plan phase snapshot.
   - Keep degrade rules: provenance mismatch, stale intent, task no longer next, and plan phase mismatch degrade to seed and clear handoff.
   - Paused and rate-limited intents keep their waiting behavior. Exactly-once consumption stays unchanged.
   - Live `child` is never serialized.

5. Errored runs retry once.
   - Add bounded integer `resumeRetryCount` to runtime and snapshot. Sanitizer accepts only finite integers in `[0, RESUME_RETRY_LIMIT]`.
   - On restore of `status: 'error'` and count `< RESUME_RETRY_LIMIT`, increment, start the same phase/task/step once, and audit the retry.
   - On count `>= RESUME_RETRY_LIMIT`, do not start a runner. Preserve the error state for visibility, emit `resume-on-start` with cause `retry-exhausted`, and leave manual intervention to the operator.
   - Non-error snapshots keep current restore behavior.

6. `stepOutput` changes the resumed run.
   - Capture the sanitized previous output into a separate runtime field such as `resumePriorStepOutput` during restore.
   - At step prompt construction, feed that field through `promptPreamble()` once with a clear prior-step-context label.
   - Clear the field immediately after the prompt is built. The existing pre-spawn `rt.stepOutput = ''` must not erase the context before consumption.
   - Do not inject prior-step context for degraded resumes, plan phases, seed phase, stale intents, or opt-out paths.

## File map

- `.project_documents/PLAN-durable-resume-snapshot.md`: source plan and incident background.
- `.project_documents/PLAN-durable-resume-snapshot-see-plan-durable-resume-snapshot-md-project-documents-pl.md`: this mapped plan.
- `plan.md`: replace the original `(plan)` item with generated checklist tasks.
- `src/auto-resume.js`: retry-limit constant, snapshot sanitizer projection/caps, v1 read/consume validation, redaction, TTL.
- `src/engine.js`: `ensureRuntime`, `snapshotRuntime`, `writeCheckpointIntent`, `resumeOnStart`, prompt preamble hook, audit fields, idle/error gate.
- `src/config.js`: touch only if config normalization proves necessary.
- `scripts/test-auto-resume.js`: snapshot fields, incident drill, retry bound, behavioral context, degrade rules, gate regression.
- `.looparr/next_prompt.txt`: validated handoff prompt for next phase.

## Ordered steps

1. Baseline the current implementation. Confirm `snapshotRuntime`, `sanitizeSnapshot`, error checkpoint capture, session id capture, restore, and degrade rules match this plan. Record any missing behavior before editing.
2. Add the single retry-limit constant and bounded integer field in `src/auto-resume.js`. Extend `sanitizeSnapshot` projection and validation without changing `version: 1`.
3. Add runtime fields for retry count and prior-step context in `ensureRuntime`. Keep defaults zero and empty string.
4. Update `snapshotRuntime` and `writeCheckpointIntent` to capture error and idle-with-currentTask states, retry count, and all existing fields. Keep opt-out, paused, done, and atomic write behavior unchanged.
5. Update `resumeOnStart` to consume the retry count, apply the one-retry branch, preserve exhausted error state, and capture prior `stepOutput` before the runtime reset clears it.
6. Add the one-time prompt hook before the step spawn clears `rt.stepOutput`. Use the already sanitized and capped context. Clear the field after use.
7. Update audit events with retry and context-use cause without leaking raw output.
8. Add focused tests listed below. Keep existing tests green.
9. Run `npm test`, `node --check` on touched JS, and `git diff --check`.
10. For source changes, perform mandatory production deploy verification from `plan.md`: rebuild/recreate `looparr`, confirm healthy new image, confirm served HTML/CSS/JS contain changes, confirm container files match local source, then mark plan items complete.
11. Commit only the approved source and test files.

## Tests

Add or extend tests in `scripts/test-auto-resume.js`:

1. `testSnapshotFields`: assert v1 optional snapshot, error status, `nextPhase: implement`, `stepTask.index`, `rotationCursor`, `modelIndex`, `resumeSessionId`, `opencodeSessionId`, retry count, redacted `stepOutput`, and caps.
2. 2026-11-24 incident drill: errored `implement` with `active: false` writes a checkpoint; restart consumes it; engine resumes `implement` with the same task and step instead of `seed`.
3. Retry bound: first restored error re-runs once; a second error snapshot with count at limit does not start a runner; a third restart still does not start.
4. Behavioral `stepOutput`: restored redacted output appears once in the resumed prompt as prior-step context, is capped, contains no secrets, and is absent from the next step prompt.
5. Degrade gates: provenance mismatch, stale TTL, future skew, task no longer next, plan phase mismatch, and invalid session degrade to seed and clear handoff.
6. Gate and schema regression: `autoResumeOnStart !== true` writes no snapshot; v1 without snapshot reads; array snapshot ignored; every-tick error rewrite remains accepted.
7. Waiting states: paused and rate-limited intents keep `resumeAt`/`cooloffUntil` behavior and exactly-once consumption.
8. Full suite: `npm test`, `node --check` on touched JS, `git diff --check`.

## Acceptance criteria

- Snapshot persistence remains gated by `project.autoResumeOnStart === true`.
- Error and idle-with-currentTask states capture phase, status, task, step bookkeeping, rotation cursor, session ids, retry count, and redacted prior output.
- v1 intents written before this batch remain readable with no snapshot.
- Atomic write, 0600 mode, 24 h TTL, redaction, caps, and no duplicate constants remain intact.
- Restore resumes the same resumable state after all provenance/TTL gates, except documented degrade paths.
- Restored errors re-run exactly once across restarts; exhausted retries never start a new runner.
- Prior-step output affects the resumed prompt once and never leaks secrets or repeats later.
- All focused and full tests pass, `git diff --check` is clean, and production verification passes before completion.

## Risks

- Retry count could increment twice or reset to zero, causing a crash loop. Verify capture, consume, and snapshot round trip together.
- Prior `stepOutput` could leak secrets into prompts. Use only sanitized text and assert redaction in tests.
- Pre-spawn clearing of `rt.stepOutput` at `src/engine.js:2875` could discard context. Consume before that reset.
- Adding idle capture could widen the gate to paused or done runs. Keep those exclusions explicit.
- Plan phase and handoff degrade rules may conflict with retry logic. Degrade wins; no retry or prompt context on degraded paths.
- Session id reuse could resume the wrong OpenCode session. Keep cwd and validity checks before reuse.
- Opt-out regression could break user settings. Test gate off before and after restart.
- Production assets may go stale. Follow `plan.md` deploy verification for every source-changing batch.

## Commit scope

Only `src/engine.js`, `src/auto-resume.js`, `src/config.js` if needed, and `scripts/test-auto-resume.js`. Keep plan and handoff artifacts out of the commit unless project workflow explicitly requires them.
