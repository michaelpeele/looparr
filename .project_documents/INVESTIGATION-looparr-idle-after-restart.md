# Investigation: Looparr shows idle after container restart

Date: 2026-11-21 (updated 2026-11-22)

## Symptom (original idle-after-restart)

After a container restart/recreate, Looparr UI showed project idle (`active:false`) even though work may have been in-flight. Root cause was memory-only runtime state and no resume intent.

## Duplicate-session incident (2026-11-22)

User report: first session for task "Hide completed should be the default..." finished; a second session for the same task ran and was stopped manually; after UI stop + adding verify task to plan + start, engine ran seed then analyze. Evidence (from `.looparr/auto-resume.log`):
- `2026-11-22T17:20:14.044Z resume-cancelled` (planned-restart) for that task.
- `2026-11-22T18:19:18.256Z about-to-resume` phase implement (same task), `resume-child-quiesced`, then `18:19:45.049Z resume-on-start` phase implement. Commit `940ee2a` landed ~1.5m after resume consistent with original finishing while resumed duplicate still ran.

Confirmed root causes (code):
1. `src/engine.js` `prepareShutdownResume()` wrote intent and quiesced via `quiesceChild()`, which only SIGTERM/SIGKILLed the local bridge client (`rt.child`). It did **not** cancel host-executor active runs. Real opencode runs live in host executor (`scripts/host-executor.js`).
2. `src/runners/opencode.js` had `cancelStaleRuns` (keep key) but no `listActiveRuns` and no way to cancel all runs for a project/cwd from shutdown flow.
3. `scripts/bridge-client.js` had no SIGTERM/SIGINT handler to POST `/cancel` to executor; executor relied on stream abort semantics.
4. `scripts/host-executor.js` cancelled on `req.on('aborted')` but not reliably on response `close`; `/cancel` returned before awaited termination in some paths; `activeRuns` cleanup timing could be inconsistent.
5. `src/engine.js` `resumeOnStart()` started resume without checking executor `/active` for same project/cwd and without dedupe cancel, so a surviving host run could coexist with a resumed run.
6. `src/auto-resume.js` `consumeIntent()` used non-atomic read+unlink (race possible). No `runKey` in intent; no `intent-written` audit on writes. Checkpoint writes were not clearly auditable.
7. `src/engine.js` `reconcileExternalPlan()` degraded to seed and cleared intent/handoff whenever plan task text no longer matched current task, even if a valid implement handoff existed for the intended task flow in practice — risked dropping work.

New behavior (implemented):
- `src/runners/opencode.js`: added `listActiveRuns({projectId,cwd})` (GET `/active`, filtered), `cancelStaleRuns` now treats missing/omitted `keepRunKey` as cancel-all for project/cwd; exports `listActiveRuns`.
- `src/engine.js`: `prepareShutdownResume()` calls `runner.cancelStaleRuns({projectId, cwd, keepRunKey:null})`, audits `executor-runs-cancelled` (count or error). `writeCheckpointIntent()` stores `runKey` and writes intent via `autoResume.writeIntent` (audited). `resumeOnStart()` checks executor active runs for project/cwd; if any, cancels all for that project/cwd, audits `resume-dedupe-cancel`, then proceeds with single resume. `reconcileExternalPlan()` preserves phase when handoff exists but plan text differs (audits `plan-reconcile-preserved`), degrades with `plan-reconcile-degraded` when no handoff.
- `scripts/bridge-client.js`: on SIGTERM/SIGINT posts `/cancel` `{runKey,projectId,cwd}` with bounded timeout then exits.
- `scripts/host-executor.js`: on response `close` before exit finishes entry and terminates child; `/cancel` awaits termination where practical and returns `{ok:true,cancelled:n}`.
- `src/auto-resume.js`: `consumeIntent()` is atomic via rename-to-`.consuming-*` then read+unlink; `writeIntent()` appends `intent-written` audit (redacted). Optional `runKey` stored/validated in intent shape.
- `scripts/restart-looparr.js`: after healthy restart, attempts to query executor `/active` (token from `.env`) and warns/errors if >1 run for looparr project/cwd.

## Immediate recovery (if duplicate observed)

Stop extra runs via executor `/cancel` (or restart helper flow), ensure only one active run for project/cwd, then resume normally.

## Notes

Auto-resume is opt-in per project (`autoResumeOnStart`). Planned restarts should use `scripts/restart-looparr.js` to capture intent and cancel executor runs before recreate.
