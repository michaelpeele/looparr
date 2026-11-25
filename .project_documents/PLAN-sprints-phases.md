# Plan — sprints/phases, per-task branches, `[Type] Validation`

Design decisions live in [DESIGN-sprints-phases.md](DESIGN-sprints-phases.md); that file wins on
conflict and must be read first. The "Remaining questions resolved (ANALYZE 2026-11-25)" section
(R1-R10) is binding: it fixes the concurrency runtime model (`rt.sprintRuns`), branch/worktree
naming, validation gating, `/api/state` started flag, merge/deploy interaction, cleanup, config
fields, prompt injection, the single new server route, and backward compatibility. Build in this
order; each step ends with its focused tests.

1. **`src/config.js`** — add to `DEFAULT_SETTINGS` and both `normalizeSettings` and
   `normalizeProject` handling: project-level `sprintMode` (`off|serial|parallel`, default `off`),
   `sprintsParallel` (boolean, default false), `sprints` (array of `{ id, name }`, default `[]`),
   `sprintTestCommand` (string, default `npm test`), sprint-level merge-to-main opt-in
   (`sprintDeployMain`, boolean, default false). Follow the existing per-field normalizer pattern.

2. **`src/plan.js`** — extend the task-token layer: parse and strip `[sprint:<name>]`,
   `[merge-previous]`, `[deploy-main]` tokens in `parseDependencySuffix` (or a sibling function)
   and accept the `(validation: <Type>)` prefix next to `PLAN_TASK_MARKER_RE` (new
   `VALIDATION_TASK_MARKER_RE`, `isValidationTask`, `sprintOfTask`, `taskFlags`). All parsing
   stays tolerant of unknown/missing tokens; `editTask` preserves them like dependency suffixes.

3. **New `src/sprint.js`** (pure git orchestration, reuse `spawnSync` patterns from the self-heal
   block in `src/engine.js`): branch naming (`branchForTask`), worktree add/remove, local merges,
   end-of-sprint merge, and the validation test-run helper. Guardrails: only `looparr/*` branches,
   local repos only, git output returned raw (callers redact), failures report rather than clean
   the live checkout.

4. **`src/engine.js`** — wire scheduling and phases in `startStep` (engine.js:2037):
   - sprint-aware task choice: dependency-satisfied tasks per sprint, honoring `sprintMode` and
     `sprintsParallel` under the existing `maxConcurrent` worker cap;
   - when the chosen task's sprint needs a worktree, cut the branch/worktree via sprint.js and run
     with `cwd: worktree`; the live checkout is untouched;
   - inject `[merge-previous]`/`[deploy-main]` directives and branch info into the implement
     prompt (extra block in `promptPreamble`), plus a directive that the agent commits inside the
     provided worktree and never touches `plan.md` or other sprints' files;
   - `(validation)` routing and the end-of-sprint merge + test round from DESIGN Q7/Q8; on
     failure set the existing error state with the redacted log tail;
   - startup reconciliation: treat pre-existing `looparr/*` branches and `.looparr/sprints/`
     worktrees as "already started" state (restart-safe gray-out) and refuse double-start.

5. **`server.js`** — if routes are needed at all, add only automated, idempotent ones
   (`POST /api/projects/:id/sprint/merge` for a manual end-of-sprint merge retry); reuse the
   route/error style of `/api/projects/:id/selfheal/merge` (server.js:785). Task-card toggles
   themselves write tokens through the existing plan-edit routes — no new state API.

6. **`public/index.html` + `public/app.js`** — project drawer: sprint list editor (add/rename
   sprint), per-project sprint settings (`sprintMode`, `sprintsParallel`);
   task cards: `[merge-previous]` / `[deploy-main]` toggles that write the tokens via the plan
   edit path, disabled when the task is started (runtime current task or `looparr/*` branch
   exists — expose started state in `/api/state`);
   add-task row: validation-type suggestions dropdown inserting "[Type] Validation" task text with
   the `(validation: <Type>)` marker.

7. **`public/styles.css`** — styling for disabled toggles, sprint chips, grayed-out card options
   (match existing card/drawer classes).

8. **Tests** — add to the `package.json` test chain:
   - `scripts/test-sprint-parse.js`: token parsing/stripping/preservation, `(validation: X)`
     marker, backward compatibility on old plans;
   - `scripts/test-sprint-branches.js`: branch naming, worktree add/remove against a temp repo,
     merge ordering, refusal of non-`looparr/*` branches, validation test-run pass/fail paths;
   - `scripts/test-sprint-scheduling.js`: task selection per `sprintMode`/`sprintsParallel`,
     worker cap, gray-out/started state after a simulated restart (branch on disk).

9. **Docs** — keep DESIGN/PLAN docs current if implementation diverges; note the feature in
   `README.md` only if a user-facing flow changed more than this file covers.

## Verification
- `npm test` full pass.
- `git diff --check` clean.
- `node --check` on every touched JS file.
- Production per plan.md lines 3-11: `docker compose build looparr && docker compose up -d
  looparr`, container healthy on the new image, served HTML/CSS/JS hashes match local files,
  `/api/state` returns projects and settings including the new sprint fields.
- `node scripts/validate-handoff.js .looparr/next_prompt.txt` clean before handoff.

## Implement-phase audit (2026-11-25)

The R1-R10 audit fixed the `.looparr/sruns` -> `.looparr/sprints` path typo, included checked
tasks in the end-of-sprint merge, reused existing sprint worktrees on retry, enforced
`sprintsParallel: false`, allowed the last task flag to be toggled off, prevented normal steps
from mixing with sprint children, and made Stop/shutdown kill the validation child. No build
order or public flow changed.

## Commit scope
Stage only: `src/config.js`, `src/plan.js`, `src/engine.js`, `src/sprint.js`, `server.js`,
`public/index.html`, `public/app.js`, `public/styles.css`, the new
`scripts/test-sprint-*.js` files, `package.json`, and
`.project_documents/PLAN-sprints-phases.md` + `DESIGN-sprints-phases.md`. Leave unrelated work
unstaged. Keep `plan.md` out of this batch except the batch task's own checkbox (see the handoff
directive).
