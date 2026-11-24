# Implementation prompt: Plan prompt type (questions + plan write)

Work only in `/home/michaelpeele/ai-projects/looparr`.

Implement the designed Plan prompt flow. Reuse the existing Question handoff UI. Do not build an interactive chat question tool.

## Source of truth

Read and follow:

- `.project_documents/DESIGN-plan-prompt-type.md` (untracked design record, 2026-11-23)
- `.project_documents/PLAN-plan-prompt-type.md` line 1

The design record is authoritative for Q1-Q10. Do not rewrite it. Do not change `plan.md` markers.

## Key finding

The UI already exists:

- `public/index.html` lines 475-485: `Question handoff` section, `#answer-status`, `#answer-editor`, `#refresh-answer`, `#save-answer`
- `server.js` lines 743-749: `GET /api/projects/:id/answer`
- `server.js` lines 751-757: `PUT /api/projects/:id/answer`
- `public/app.js` lines 2323-2337: `loadAnswer(id)`
- `public/app.js` lines 2409-2426: `saveAnswer()`
- `public/app.js` lines 3227-3234: answer events

Those routes currently only read/write `.looparr/next_prompt.txt`. They do not notify engine state. Add the engine transition on successful answer PUT. Preserve the file-based handoff contract.

Existing partial support:

- `src/plan.js` lines 248-252 exports `PLAN_TASK_MARKER_RE = /^\(plan\)\b/i` and `isPlanTask(task)`
- `src/config.js` has `planModel` in `MODEL_PHASE_FIELDS`, model labels, `modelFieldForPhase`, `MODEL_ROTATION_FIELDS`, and `ROTATION_FIELD_BY_MODEL_FIELD`
- `src/auto-resume.js` line 13 already includes `planQuestions` and `planWrite` in `PHASES`

Do not duplicate those pieces. Preserve the pre-existing phase-2 same-session work in `src/engine.js`, `src/runners/opencode.js`, `src/auto-resume.js`, `package.json`, and all other unrelated uncommitted work.

## Required runtime flow

### Branch condition

- Only branch into the plan flow when `plan.next` is the first unchecked task and `isPlanTask(plan.next)` is true, at the point where engine is about to start the initial `seed` step.
- Keep the full task text including `(plan)` in prompts.
- Do not branch for non-plan tasks. Non-plan behavior must stay unchanged.
- Both `planQuestions` and `planWrite` use fresh runner sessions. Do not pass a stored OpenCode session ID into either plan phase.

### `planQuestions`

- Add template `planQuestionsPromptTemplate` with `{{task}}`.
- Template must instruct: ask only necessary clarifying questions; write ONLY the questions to `.looparr/next_prompt.txt`; do not write plan files; do not add meta-instructions.
- On exit 0, require non-empty `.looparr/next_prompt.txt`.
- Then set `status='waitingAnswer'`, `nextPhase='planWrite'`, keep `currentTask`, emit state, and do not auto-spawn.
- Invalid/empty output must not enter `waitingAnswer`.

### Answer handoff

- Keep `GET /api/projects/:id/answer` behavior: return file content.
- On `PUT /api/projects/:id/answer`, keep current validation and atomic write. If the project is `waitingAnswer`, also require non-empty content, set `status='idle'`, keep `nextPhase='planWrite'`, keep `currentTask`, emit state, and schedule tick.
- If not `waitingAnswer`, preserve current write-only behavior.
- UI must prefill editor with the questions so user appends answers. Do not overwrite questions automatically.

### `planWrite`

- Add template `planWritePromptTemplate` with `{{task}}` and `{{handoff}}`.
- `{{handoff}}` is the full question+answer text from `.looparr/next_prompt.txt`.
- Template must instruct agent to produce:
  - mapped plan doc at `.project_documents/PLAN-<slug>.md`
  - generated checkbox tasks in `plan.md`
  - overwrite `.looparr/next_prompt.txt` with only the concise analysis prompt for the next phase
- No meta-instructions in the analysis handoff.

On exit 0, before entering `waitingConfirm`:

- require non-empty next handoff
- reuse the existing meta-poison guard for the analysis handoff
- verify the new PLAN doc exists using a safe deterministic slug
- verify `plan.md` gained at least one new `- [ ]` task since phase start
- ensure the original `(plan)` task will not remain as `plan.next` after confirm; prefer requiring the agent to replace the `(plan)` line with generated tasks, or mark that exact original line done at confirm using a pre/post snapshot; do not complete generated tasks
- stamp handoff provenance as today

Then:

- set `status='waitingConfirm'`
- set `nextPhase='analyze'`
- keep `currentTask`
- emit state
- do not auto-spawn

### Plan confirm

Add `POST /api/projects/:id/plan-confirm`.

- Engine method, e.g. `confirmPlan(id)`.
- Return 409 unless state is `waitingConfirm`.
- On success set `status='idle'`, keep `nextPhase='analyze'`, keep `currentTask`, emit state, schedule tick.
- Only after this endpoint succeeds may analyze→implement run.
- Do not change plan-file GET/PUT endpoints, path containment, or tooltip text.

## Waiting-state guards

- `eligibleProjects()` must exclude `waitingAnswer` and `waitingConfirm`.
- `startStep()` must refuse to spawn while either status is set.
- `start()` must not clear waiting statuses.
- `stop()` resets to seed/idle as today.
- `statusInfo()` and UI badges must label both waiting states.
- `controlDisabled()` must disable Start/Pause in waiting states; keep Stop available.
- `applyAutoEmptySections()` must keep the questions section visible while `waitingAnswer` and plan section visible while `waitingConfirm`, even if fields are empty.

## Config and picker wiring

- Add `planModel` and `planRotation` to global defaults and per-project normalization.
- Use a concrete default model, not `omniroute/coding-safe`.
- Add effective model list handling for both plan phases.
- Add three picker groups/labels for plan phases as designed.
- Add `planQuestionsPromptTemplate` and `planWritePromptTemplate` to prompt template validation and `PROMPT_TEMPLATE_FIELDS`.
- Add UI textareas for both templates.
- Do not change non-plan templates.
- Do not reintroduce `omniroute/coding-safe` before concrete `opencode/*` entries.

## Resume behavior

- `waitingAnswer` resumes as `waitingAnswer`.
- `waitingConfirm` resumes as `waitingConfirm`; do not treat it as a `PHASES` phase.
- `planWrite` with valid handoff/provenance resumes `planWrite`.
- `planWrite` without usable handoff or provenance degrades to `planQuestions`.
- `planQuestions` degrades to `planQuestions`.
- Preserve poison guard and provenance checks.
- Do not loosen rotation, rate-limit, or model fallback behavior.

## UI

- Reuse the existing Question handoff section and Plan file controls.
- Add a `Confirm plan` button shown for `waitingConfirm`.
- Show `Plan ready for review` status text for `waitingConfirm`.
- Wire the new button to `POST /api/projects/:id/plan-confirm`.
- Reuse the existing plan-file modal for reviewing the generated PLAN doc.
- Do not change plan-file endpoint paths, pointer-link rendering, or tooltip text.

## Tests

Add focused tests. Prefer a new `scripts/test-plan-prompt-flow.js` and add it to the `package.json` test chain. Preserve all existing entries in `package.json`; it already has unrelated uncommitted changes.

Cover:

1. Non-plan project still runs seed→analyze→implement unchanged.
2. Plan task runs `planQuestions`, then stops in `waitingAnswer` with no auto-spawn.
3. `PUT /answer` while waiting advances to `planWrite` and spawns exactly once.
4. `planWrite` with bad/empty/meta handoff does not enter `waitingConfirm`.
5. Valid `planWrite` enters `waitingConfirm` with no auto-spawn.
6. `POST /plan-confirm` resumes analyze; wrong state returns 409.
7. Original `(plan)` task is not `plan.next` after confirm.
8. `eligibleProjects()` excludes both waiting states.
9. Restart resume preserves waiting states and degrades invalid `planWrite` to `planQuestions`.
10. `planModel`/`planRotation` settings and prompt templates validate and appear in UI.
11. No cooling/rate-limit path is touched.

Extend existing tests only where they already cover handoff guard, auto-resume, or model selector. Do not weaken them.

## Verification

- `node --check` every touched `.js`
- `git diff --check`
- full `npm test`

## Finish

- Append a short result section to `.project_documents/PROGRESS.md`.
- Do not change `plan.md` markers.
- Do not deploy.
- Run `git status --short`.
- Stage only tracked files changed for this task, with explicit `git add -- <paths>`.
- Never stage `.env*`, `*.pem`, `*token*`, `*secret*`, `*password*`, `.looparr/next_prompt.txt`, untracked files, or unrelated pre-existing work.
- Commit with a Conventional Commit message, e.g. `feat(plan): add plan question and write phases`.
- Report commit hash and verification results.
