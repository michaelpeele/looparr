# Handoff recovery sweep — implementation prompt

Status: open. Plan item: `(plan) Handoff recovery sweep`.
Batch: second of three — `Durable resume snapshot` → `Handoff recovery sweep` → `Self-healing debugging mode`.

## Incident this prevents

After an error, a project sits until a human presses Start. If the required
`.looparr/next_prompt.txt` was missing (or rejected as a meta-prompt), `start()` reseeds to
`seed` (`shouldReseedOnStart`, `src/engine.js:738`). Nothing re-checks later, so if the
corrective action (a valid handoff written by a human or another agent) arrives *after* the
error, the project does not notice on its own — it waits indefinitely for a manual Start.

## Goal

A periodic sweep that, for a project in an error state, re-checks whether a valid handoff now
exists and, if so, un-sticks it back to its `analyze`/`implement` phase automatically. This is
the *wait-for-handoff* remediation that complements persistence (item 1) and self-heal (item 3):
persistence can't help when the handoff is absent; this rechecks until it appears.

## Current building blocks

- `shouldReseedOnStart` (`src/engine.js:738`) — manual-Start reseed guard.
- `hasHandoff` / `readHandoffTask` / `stampHandoffTask` (`src/engine.js` ~655-690) — handoff
  presence and provenance.
- `isMetaPromptHandoff` (`src/engine.js:933`) — rejects meta-instruction handoffs.
- `tick` (`src/engine.js:1526`) — 1 s loop; `CHECKPOINT_INTERVAL_MS` (30 s) shows the throttle
  pattern; `eligibleProjects` excludes `status === 'error'`.
- `autoResume.appendAudit` (`src/auto-resume.js`) — structured audit log.

## Design

1. New constant `HANDOFF_RECOVERY_INTERVAL_MS` (default 15000) and `lastHandoffRecoveryAt`,
   checked inside `tick` (same pattern as `CHECKPOINT_INTERVAL_MS`).
2. Predicate `handoffReadyForResume(project, rt)` — all must hold:
   - `rt.status === 'error'` and `!rt.active && !rt.child && !rt.starting`
   - `rt.nextPhase === 'analyze' || rt.nextPhase === 'implement'`
   - `hasHandoff(project)` is true
   - `!isMetaPromptHandoff(handoff).poisoned`
   - provenance: `readHandoffTask(project) === (rt.currentTask || plan.next.text)`
3. Action when ready (do not call `start()`; flip state and let the normal tick enforce
   `maxWorkers`):
   - `rt.error = ''; rt.status = 'idle'; rt.active = true;` keep `rt.nextPhase`
   - `autoResume.appendAudit(project, 'handoff-recovered', { phase, task })`
   - `appendLog(project.id, 'system', '↻ Handoff present; resuming ' + phase)`; `emitState()`;
     `scheduleTick()`.
4. When not ready: leave in `error`, and emit at most one throttled
   `handoff-recovery-waiting` audit per project per interval (store `rt.lastRecoveryAuditAt`) so
   the wait is observable without log spam.
5. Gate behind a per-project `handoffRecovery` boolean (default `false`), so auto-resume is
   opt-in; never run for `WAITING_STATUSES` (already excluded by the `status === 'error'` check).
6. Keep `shouldReseedOnStart` unchanged for the manual Start path; this sweep is the automatic
   complement, not a replacement.

## Requirements

1. Add the throttled sweep to `tick` with the predicate above; it only acts on `error` projects.
2. On a valid handoff, un-stick to `analyze`/`implement` without bypassing `maxWorkers`.
3. Never override `waitingAnswer`/`waitingConfirm`, and never act while a child is live.
4. Emit `handoff-recovered` / `handoff-recovery-waiting` audit events; throttle the waiting
   event to one per interval per project.
5. Add a `handoffRecovery` setting (default `false`) surfaced in the settings page like
   `autoResumeOnStart` (`public/app.js:1732`, `:2520`), and default it in `src/config.js`
   (`DEFAULT_SETTINGS`, `src/config.js:310`).
6. Tests in `scripts/test-auto-resume.js`: error+valid handoff → recovers; error+meta handoff →
   stays error; provenance mismatch → stays error and handoff cleared; active project not
   double-started; waiting states untouched.
7. `npm test` and `git diff --check` clean. Commit only `src/engine.js`, `src/config.js`,
   `public/index.html`, `public/app.js`, and `scripts/test-auto-resume.js` (plus
   `scripts/test-plan-ui-controls.js` if a served-asset assertion is added).

## Verification

- Unit: drive the predicate/action with a fake `rt` in each state; assert audit events.
- Live (manual, after rebuild): with a project in `error` and a valid handoff written, confirm
  the sweep flips it to `implement` within one interval and the audit logs `handoff-recovered`.
- Confirm `git diff --check` clean.

## Acceptance criteria

- An errored project resumes `analyze`/`implement` automatically once a valid, provenance-
  matched handoff appears, without a manual Start.
- Meta-prompt handoffs, provenance mismatches, and waiting plan states are never auto-advanced.
- `npm test` green; only the file-map paths changed.

## Risks

- **Surprising auto-resume.** Gate behind `handoffRecovery` (default off) and audit every action.
- **Log spam.** Throttle the waiting audit; log at most once per interval per project.
- **Wrong-task handoff.** Keep the provenance check (`readHandoffTask` vs current task) as a
  hard gate before any state change.