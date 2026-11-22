# Handoff: prevent duplicate OpenCode sessions on planned restart

## Scope
Work only in `/home/michaelpeele/ai-projects/looparr`. Do not touch `.looparr/next_prompt.txt`. Do not restart live Looparr. Preserve unrelated dirty files already in worktree (`plan.md`, `public/*`, `scripts/test-plan-*`, `src/plan.js`, `rate-limit-retry-control.md`, existing edits in `src/engine.js`, `server.js`).

## Goal
- Stable run key per Looparr step.
- Host executor allows only one active host child per run key; same-key rerun replaces old child (never reject).
- Planned-restart preparation quiesces active child before container recreation.
- Keep existing auto-resume behavior for completed tasks and stale intents.

## Do in small pieces

### Piece 1 - engine run key + quiesce
Files: `src/engine.js`, `server.js`, `scripts/test-auto-resume.js`
- Add/export `runKeyFor(project, phase, taskText)`: SHA-256 over `project.id`, resolved `project.path`, `phase`, `taskText` with NUL separators; return first 32 hex chars.
- In `startStep(project)`, after `phase` and `task` known, compute `runKey`; pass `runKey, projectId, phase, task` into `runner.buildCommand({...})`. No prompt text/phase order changes.
- Make `prepareShutdownResume(reason)` async. After `writeIntent()` succeeds for a project: increment `rt.token`; SIGTERM `rt.child`; wait for close, SIGKILL fallback after 3s; set `rt.child=null, rt.starting=false, rt.paused=true`; keep `rt.active=true`; `emitState()`; append audit `resume-child-quiesced` with valid whitelisted fields only. Do not clear intent. Do not change `stop()` semantics (Stop still clears intent).
- `server.js`: await `engine.prepareShutdownResume(reason)` in `POST /api/auto-resume/prepare`; await it in `shutdown()` before `engine.shutdown()`.
- Tests: update `scripts/test-auto-resume.js` for async prepare; add coverage that successful planned-restart preparation writes intent, kills active child, sets paused true, keeps active true, does not launch another step. Add run-key determinism test.
- Verify: `node --check src/engine.js server.js scripts/test-auto-resume.js && node scripts/test-auto-resume.js`

### Piece 2 - runner/bridge run-key plumbing
Files: `src/runners/opencode.js`, `scripts/bridge-client.js`
- `opencode.js buildCommand`: accept `runKey, projectId, phase, task`; in bridge mode include them in `LOOPARR_TASK_PAYLOAD`; fail fast in bridge mode if `runKey` missing. Direct mode unchanged.
- `bridge-client.js`: validate `runKey` as non-empty short string; include `runKey` in JSON POST body to `${executorUrl}/run`. Keep NDJSON streaming and exit-frame behavior unchanged.
- Verify: `node --check src/runners/opencode.js scripts/bridge-client.js`

### Piece 3 - host executor single-active-run guard
Files: `scripts/host-executor.js`, add `scripts/test-host-executor-run-key.js`
- Replace `activeChildren` Set with `activeRuns` Map keyed by `runKey`.
- `validateRun(payload)`: accept/validate `runKey`; safe chars `/^[A-Za-z0-9._:-]+$/`, max 128.
- `handleRun`: if same `runKey` active, frame stderr line saying previous run being replaced, call `entry.finish(137)`, SIGTERM old child, wait close, SIGKILL after 3s, then spawn new. Replace, never reject; replacement authoritative.
- Store spawned child under `runKey`. `finish(code)` deletes map entry only if it still points to that child; must not write to destroyed/ended response. Keep `req.on('aborted')` behavior.
- Add `GET /active` returning `{ runKey, startedAt }[]`.
- `shutdown()` kills all children from `activeRuns.values()`.
- Test `scripts/test-host-executor-run-key.js`: temp token/root, bind `127.0.0.1`, ephemeral port if supported; fake opencode handles `run --help`, `serve --port 4096`, `run ...`; fake `run` records PID and sleeps; POST two runs same `runKey`, assert first PID dies and `/active` has one entry; POST different `runKey`, assert both coexist.
- Verify: `node --check scripts/host-executor.js scripts/test-host-executor-run-key.js && node scripts/test-host-executor-run-key.js`

### Piece 4 - full verify
- `node --check` every changed JS file.
- `node scripts/test-auto-resume.js`
- `node scripts/test-host-executor-run-key.js`
- `npm test`
- `git diff --check`

## Acceptance
- No two host-side `opencode run` children for same `(projectId, phase, task)`.
- Planned restart quiesces current child before Docker recreates container.
- New container resumes same unfinished task once.
- Completed task still causes stale-intent-ignore via existing `resumeOnStart()` task comparison.
- Normal new step with same key after previous run finished still starts.

## Notes
- Redaction: never log token, URL, headers, env values.
- `autoResume.appendAudit` whitelists keys; `resume-child-quiesced` must use only valid fields.
- Keep NDJSON/exit-frame behavior in bridge and host executor.
- Watch for existing dirty engine/server changes; merge carefully.
