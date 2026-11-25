# Sprints/phases, per-task branches, validation task type — design Q&A

Recorded at ANALYZE (2026-11-24) before any code change. The implement batch must follow these
decisions.

## Q1. How does a task belong to a sprint?
`[sprint:<name>]` token appended to the task text, parsed by the same suffix machinery as
dependency markers in `src/plan.js` (`parseDependencySuffix`). Tasks without the token run in the
existing linear flow. Backward compatible: old plans parse unchanged, stripping the token keeps
display text clean.

## Q2. Where do sprint definitions live?
Per-project `sprints: []` array in looparr config (`{ id, name }`), created from the project
drawer. Suggested type list (UI dropdown when editing task text) seeds naming: Backend, Frontend,
Sprint — as suggested validation types below.

## Q3. Parallel modes and their scope?
Project-level `sprintMode`: `off | serial | parallel` — off falls back to the linear flow,
serial runs one task per sprint at a time, parallel allows every dependency-satisfied task in the
sprint to run at once. Separate `sprintsParallel` boolean lets several sprints advance
simultaneously. Hard cap: the engine never spawns more runner children than the existing
`maxConcurrent` workers; cross-sprint dependencies are not modeled (tasks stay within their
sprint).

## Q4. Branch-per-task strategy?
`git worktree add -b looparr/<sprint>/<task-slug> <repo>/.looparr/sprints/<runId> <base>` where
base is the sprint branch if it exists, else the live checkout HEAD. Runner child runs with
`cwd: worktree`. The live checkout never changes branch; `plan.md` is only written by the engine
in the live checkout. Pattern copied from the self-heal worktree code (`src/engine.js:1188-1271`).
Each worktree carries its own git index, so parallel tasks cannot race the live index.

## Q5. "Merge previous branches" task-card option?
Stored as a `[merge-previous]` token in the task text. Before the task's branch is cut, all
branches of already-completed earlier tasks in the same sprint are merged into it locally. Cards
surface it as a toggle; disabled (grayed out) once the task has started.

## Q6. Merge-to-main/prod deploy option?
Stored as a `[deploy-main]` token. After the task completes and is checked, its branch is merged
into the project's main branch locally. Merge is local-only: never `git push`, never a remote
operation. Off by default; requires the project's main branch to exist in the local repo. "Prod
deploy" deliberately stops at the local main merge — deployment remains the human action.

## Q7. `[Type] Validation` task type?
Prefix marker analogous to `(plan)`: `(validation: Backend)` → `[Backend] Validation` label.
Add-task UI offers suggested types (Sprint, Backend, Frontend, Docs). The engine recognizes it at
seed time like the `(plan)` marker (`src/engine.js:2063-2068`) and reroutes to a new `validation`
phase instead of seed/analyze.

## Q8. End-of-sprint flow?
When every non-validation task in a sprint is complete: engine creates/updates the sprint branch
`looparr/sprint-<name>`, merges all task branches into it, then runs the sprint's validation task:
the `sprintTestCommand` (setting, default `npm test`) executes inside the merged sprint worktree.
Pass → validation task checked, sprint complete, and a `[deploy-main]`-style sprint-level opt-in
merges the sprint branch into main locally. Fail → sprint errors with the test log; no merge to
main.

## Q9. "Already started" gray-out across restarts?
Disk is the source of truth: the UI grays out a task's options when the engine reports the task as
the runtime's current/last run or a matching `looparr/<sprint>/<slug>` branch exists
(`git branch --list`). Git state survives container restarts.

## Q10. Untrusted output and destructive-action guards?
Git stdout/stderr is treated as log data: pass through `autoResume.redactText`, wrap any echo of
runner logs in `--- BEGIN/END UNTRUSTED ... ---` markers like `healerPrompt`
(`src/engine.js:1039`). All merges are local merges of looparr-owned branches only
(`looparr/*` prefix check); the live checkout, remotes, and non-looparr branches are refused.

## Consequences
- `plan.md` remains the single source of truth for sprint membership and per-task options.
- No new server-side persistence: settings go through existing `src/config.js` normalize path.
- Failure containment: any worktree/merge failure logs and leaves the branch on disk for manual
  review, never deleting the live checkout's work.

## Remaining questions resolved (ANALYZE 2026-11-25)

These resolutions are source of truth alongside Q1-Q10 above; the implement batch follows them.

### R1. Concurrency runtime model (single child -> multi child for sprints)
The engine today runs exactly one `rt.child` per project and `maxWorkers()` caps total children
across projects (`src/engine.js:1571`, `:2272`). Resolution:
- Add `rt.sprintRuns` (array) for concurrent sprint **implement** children. Each entry:
  `{ runKey, task, taskIndex, phase: 'implement', branch, worktree, child, status, exitCode,
  startedAt, testLog }`.
- Only the **implement** phase of sprint tasks runs concurrently. `seed`, `analyze`,
  `planQuestions`, `planWrite`, and `selfheal` keep the existing single `rt.child` path and are
  mutually exclusive with `rt.sprintRuns` for the same project (a project runs either its normal
  single-step pipeline or its sprint implement children, never both at once). A task becomes
  implement-ready only after its own seed+analyze completed and it is dependency-satisfied.
- `maxWorkers()` counts `rt.child` plus every `rt.sprintRuns[].child` across all projects; `tick()`
  starts sprint implement children up to the remaining cap.
- `stop()` kills `rt.child` and every `rt.sprintRuns[].child`; `pause()` blocks new sprint children
  and marks in-flight ones pause-after-step.

### R2. Branch and worktree naming (reconciled)
- Task branch: `looparr/task/<sprint>/<task-slug>` (slug = lowercased task text, non-alphanumeric
  runs -> `-`, trimmed to 40 chars, collision suffix `-2`, `-3`).
- Sprint integration branch: `looparr/sprint/<sprint>`.
- Task worktree: `.looparr/sprints/<runId>/task-<taskIndex>`; sprint integration worktree:
  `.looparr/sprints/<runId>/sprint`. `runId` is a stable per-project/per-sprint slug.
- Every branch must start with `looparr/`; anything else is refused. The live checkout is never
  switched and `plan.md` is written only in the live checkout.

### R3. Validation task association and gating
- A validation task carries the `(validation: <Type>)` prefix AND a `[sprint:<name>]` token.
  Suggested types (UI dropdown): Sprint, Backend, Frontend, Docs.
- The engine defers a validation task until every non-validation task in the same sprint is
  checked. It then creates/updates `looparr/sprint/<sprint>`, merges each task branch in
  task-index order into it, and runs `sprintTestCommand` (default `npm test`) with `cwd` set to the
  sprint integration worktree.
- Pass -> check the validation task; if `sprintDeployMain` or the validation task's `[deploy-main]`
  is set, merge `looparr/sprint/<sprint>` into the project main branch locally (no push). Sprint
  complete.
- Fail -> set the project error with the redacted test-log tail, leave branches/worktrees, do not
  merge to main, do not check the validation task.
- A `(validation:)` task with no `[sprint:]` token runs in the normal linear position against the
  live checkout.

### R4. Started / gray-out state (disk truth) in `/api/state`
- Add a per-task `started` boolean to `GET /api/projects/:id/plan` and to each project in
  `/api/state`: true when the task is the runtime current/last-run task, OR a
  `looparr/task/<sprint>/<slug>` branch exists (`git branch --list`), OR a sprint worktree exists
  for it. Git state survives restarts.
- The UI disables the `[merge-previous]` / `[deploy-main]` toggles when `started` is true.

### R5. Merge semantics and deploy-main interaction
- `[merge-previous]`: before the task branch is cut, merge already-completed earlier task branches
  in the same sprint into the new task branch (local).
- `[deploy-main]` (task): after the task is checked, merge its task branch into the project main
  branch locally.
- `sprintDeployMain` (sprint): after validation passes, merge the sprint branch into main locally.
- If both apply, the task-level merge runs first; the sprint merge then fast-forwards or is skipped
  when already up to date. Never `git push`, never touch remotes, never delete non-`looparr`
  branches.
- Merge conflict -> abort the merge, leave branch/worktree, set the error with redacted git output.

### R6. Failure containment and cleanup
- Success: remove the task worktree (`git worktree remove`), keep the branch for the sprint merge.
- Failure/conflict/validation-fail: keep worktree and branch for manual review; never run
  destructive `git worktree remove --force` against the live checkout; never auto-delete
  `looparr/*` branches.
- All git/test stdout/stderr pass through `autoResume.redactText` and, when echoed into prompts or
  logs, are wrapped in `--- BEGIN/END UNTRUSTED ... ---` markers like `healerPrompt`
  (`src/engine.js:1039`).

### R7. Config fields (final)
Per-project only (no new global settings): `sprintMode` (`off|serial|parallel`, default `off`),
`sprintsParallel` (boolean, default false), `sprints` (`[{ id, name }]`, default `[]`),
`sprintTestCommand` (string, default `npm test`), `sprintDeployMain` (boolean, default false).
Add them to `DEFAULT_SETTINGS` only if a global default is needed; otherwise normalize per project
in `normalizeProject`.

### R8. Implement-prompt injection
For a sprint task's implement run, append a sprint block (via `promptPreamble(extra)` or a
dedicated block) with: sprint name, task branch, worktree path, whether merge-previous/deploy-main
are set, a directive to commit only inside the provided worktree, never touch `plan.md` or other
sprints' files, and the untrusted-output note. Non-sprint runs are unchanged.

### R9. Server route
Add only `POST /api/projects/:id/sprint/merge` (idempotent manual end-of-sprint merge retry),
mirroring `/api/projects/:id/selfheal/merge` (`server.js:785`). No new state API; task toggles
write tokens through the existing `PUT /api/projects/:id/plan` (`editTask`) path.

### R10. Backward compatibility
Old plans without tokens parse unchanged; tokens are stripped from display text; `editTask`
preserves them like dependency suffixes; checklist indices are unchanged.

## ANALYZE verification round (2026-11-25)

Fresh analysis round for the same plan.md task. The five required design questions map to the
answers above; no new decisions, this section records the mapping and the on-disk verification.

1. **Parallelism modes -> engine tick/runner pool:** Q3 + R1. `sprintMode`
   (`off|serial|parallel`) selects tasks-inside-sprint behavior; `sprintsParallel` selects
   sprints-in-parallel; both true = both. Three requested modes are the three non-off combinations.
   Serialization assumption broken: one `rt.child` per project becomes `rt.child` plus
   `rt.sprintRuns[]`; only implement runs concurrent; `maxWorkers()` counts all children.
2. **Branch topology:** Q4 + R2 + Q8 + R3. Task branch `looparr/task/<sprint>/<task-slug>` cut from
   the sprint integration branch `looparr/sprint/<sprint>` (or live HEAD when absent); dedicated
   validation task merges all task branches in task-index order at sprint end, then runs
   `sprintTestCommand` in the sprint worktree.
3. **Merge options storage/injection/gray-out:** Q5 + Q6 + Q9 + R4 + R5. `[merge-previous]` and
   `[deploy-main]` tokens in task text; injected as a sprint block in the implement prompt (R8);
   gray-out rule is disk truth: runtime current/last-run task OR `looparr/task/<sprint>/<slug>`
   branch exists OR sprint worktree exists (`startedTaskIndexes`, exposed via `/api/state` and
   `/api/projects/:id/plan`).
4. **Validation naming/parsing/UI:** Q7 + R3. `(validation: <Type>)` prefix renders as
   `[Type] Validation`; add-task row offers Sprint/Backend/Frontend/Docs suggestions.
5. **Failure handling:** Q8 + R5 + R6. Merge conflict -> abort merge, keep branch/worktree, set
   error with redacted git output. Validation fail -> error with redacted test-log tail, no main
   merge, validation task stays unchecked. Manual retry via idempotent
   `POST /api/projects/:id/sprint/merge` (R9). No auto-reseed of failed sprint tasks.

On-disk verification (2026-11-25): implementation exists and is committed (`6b524ea`).
`src/config.js` normalizes all five sprint fields; `src/plan.js` parses/strips the tokens and
`(validation:)` marker; `src/sprint.js` holds branch/worktree/merge/test helpers with
`looparr/*` guards; `src/engine.js` has `sprintRuns`/`sprintPending`/`sprintValidation`,
sprint-aware task choice, `startedTaskIndexes`, and the prompt block; `server.js:848` has the
manual merge route; `public/index.html` has the sprints drawer section and validation-type
dropdown; `public/app.js` renders the two task-card toggles with `disabled` when started.
`scripts/test-sprint-parse.js` (8 groups), `scripts/test-sprint-branches.js` (8 groups),
`scripts/test-sprint-scheduling.js` (10 groups), `scripts/test-plan-helpers.js`, and
`scripts/test-plan-prompt-flow.js` all pass. Remaining work is the implement-phase audit of
R1-R10 against the code, gap fixes if any, full verification, production promotion check, and
the plan.md checkbox.
