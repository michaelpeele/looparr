# Design & Q&A — Plan prompt type

Task: PLAN-plan-prompt-type.md (first task in that doc; the "Documentation markdown to pointer type" section below it is already implemented — plan-file buttons, exact tooltip "click to open", GET/PUT /api/projects/:id/plan-file are live, see `.project_documents/PLAN-plan-file-modal.md` and `plan.md` checkbox "Plan file modal").

Recorded 2026-11-23 by the ANALYZE session, per the requirement that questions and design are settled before any code edit.

## Q1. How does the engine recognize a plan-type task?

**A:** Task text starts with the literal marker `(plan)` (case-insensitive), as used by the existing "(plan) …" entries in plan.md. Helper `isPlanTask(task)` in `src/plan.js` testing `/^\(plan\)\b/i`. Non-plan tasks are untouched; the marker is not stripped from prompts (the full text flows to the plan agent).

## Q2. One phase or two?

**A:** Two runtime phases: `planQuestions` (agent asks clarifying questions) and `planWrite` (agent writes the mapped-out plan after the user answers). Two phases let each step be a fresh runner session with its own model field and recovery semantics, matching the seed/analyze/implement pattern.

## Q3. How does the user's answer reach the Plan agent?

**A:** Through the existing Question handoff round-trip, unchanged: `GET /api/projects/:id/answer` shows the questions from `.looparr/next_prompt.txt`; the user appends their answers and `PUT /api/projects/:id/answer` writes the combined text back. The engine, after the planQuestions step exits 0 with non-empty `next_prompt.txt`, sets `rt.status = 'waitingAnswer'`, `rt.nextPhase = 'planWrite'`, keeps `rt.currentTask` set, and never auto-spawns. On a successful answer PUT while `status === 'waitingAnswer' && nextPhase === 'planWrite'`, the engine sets `status = 'idle'` and schedules a tick; the planWrite step then reads the full next_prompt.txt (questions + answers) as its handoff.

## Q4. How does the user confirm the written plan before Analyze/Implement start?

**A:** New endpoint `POST /api/projects/:id/plan-confirm`. After the planWrite step exits 0, the plan agent has written the mapped plan document to `.project_documents/PLAN-*.md` and overwritten `.looparr/next_prompt.txt` with the analysis-prompt handoff for the next step; the engine sets `rt.status = 'waitingConfirm'`, `rt.nextPhase = 'analyze'`, keeps `currentTask`. The drawer shows "Plan ready for review" with a Plan-file button (existing modal) and a Confirm button that calls the endpoint. The endpoint validates `status === 'waitingConfirm' && nextPhase === 'analyze'` (else 409) and sets `status = 'idle'`, schedules a tick. Only then does the existing Analyze → Implement flow run for the plan task, followed by the newly appended plan task list flowing through seed → analyze → implement as today. No endpoint = no accidental auto-advance; Start/Stop keep their existing meanings.

## Q5. What exactly does the planWrite agent produce?

**A:** (1) A fully mapped-out plan document at `.project_documents/PLAN-<slug>.md` (design, file map, steps, tests, acceptance criteria, risks); (2) new checkbox tasks appended to plan.md implementing it; (3) the analysis-prompt handoff written ONLY to `.looparr/next_prompt.txt` (overwrite). The analysis handoff must not contain meta-instructions (existing poison rules keep protecting the analyze → implement transition). Plan write is a distinct phase after Plan questions. Its handoff, like Seed and Analyze handoffs, must first be drafted to `.looparr/next_prompt.handoff.tmp` and pass `node scripts/validate-handoff.js <draft>` before overwriting `.looparr/next_prompt.txt`; fix reported phrasing and rerun until clean. The validator uses the same eight patterns as the engine post-write guard.

## Q6. Model and rotation wiring?

**A:** New `planModel` setting (global + per-project) and `planRotation` flag (global + per-project), symmetric with seed/analyze/implement: `modelFieldForPhase('planQuestions' | 'planWrite')` returns `planModel`; `MODEL_PHASE_FIELDS`, `MODEL_ROTATION_FIELDS`, labels, `getState()` effective lists, all three picker groups (global settings, add-project, drawer) get a Plan model select. Template settings: new `planQuestionsPromptTemplate` (placeholder `{{task}}`) and `planWritePromptTemplate` (placeholders `{{task}}`, `{{handoff}}`) with the same validation and UI textareas as existing templates, exposed via `PROMPT_TEMPLATE_FIELDS`.

## Q7. Restart/resume behavior for the waiting states?

**A:** `autoResume.PHASES` gains `planQuestions` and `planWrite`. While waiting (answer or confirm), the checkpoint intent is written with `status` preserved and `currentTask` = plan task text. On resume: intent `planWrite` + handoff file present with matching `handoff_task.txt` provenance → resume planWrite; intent `planWrite` without a usable handoff, or intent `planQuestions`, → degrade to planQuestions. `waitingConfirm` resumes as `waitingConfirm` (same validation as an engine restart). Existing handoff-provenance and task-no-longer-next degrade paths apply unchanged.

## Q8. Guards added so the loop never skips the user?

**A:** `eligibleProjects()` excludes `waitingAnswer`/`waitingConfirm` statuses; `startStep()` refuses to spawn while those statuses are set (and `start()` does not clear them) — a waiting plan project can only be advanced by a real answer PUT (planWrite) or POST plan-confirm (analyze). Stop continues to reset to seed/idle as today. The analyze→implement meta-prompt poison guard and `stampHandoffTask` provenance checks are unchanged.

## Q9. Risks and containment?

**A:** (1) Seed/analyze/implement flow for non-plan tasks must not change; plan branches are keyed on `isPlanTask(plan.next)` at the point the engine is about to run an initial-phase (seed) step — running analyze/implement on the *next* task after another task completed is untouched. (2) plan-file GET/PUT path containment is already implemented and must be left as is. (3) `planLib.writePlan` and plan-file PUT already write atomically; the PLAN doc writes through the same atomic path in which ever agent creates it. (4) The planQuestions template must instruct the agent to output ONLY questions into `.looparr/next_prompt.txt` so the waitingAnswer transition reads meaningful content. (5) `waitingAnswer`/`waitingConfirm` must be honored by pause/stop UI disabled states (a waiting project is not "running a child" but must show its own status).

## Q10. What stays explicitly out of scope for the implementer?

**A:** No changes to plan-file endpoints, pointer-link rendering, tooltip text, or non-plan phase templates; no auto-append of the plan task list by Looparr itself (the planWrite agent authors it; the user confirms); plan.md's own task entries are engine-managed as today.
