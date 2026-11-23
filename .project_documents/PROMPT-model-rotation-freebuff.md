# Implementation prompt: model rotation + Freebuff in the model menus

Paste everything below into a fresh agent session in this repository.

---

You are working in the Looparr repository (self-hosted Express + vanilla JS dashboard that drives AI CLI runs over a Markdown checklist). Follow `AGENTS.md` and the mandatory sandbox-first build and promotion workflow in `../workflow.md`. Read `plan.md` first, then `.project_documents/PROGRESS.md` for recent verification patterns.

Do two things, in this order: (1) make Looparr actually rotate through the models selected in the UI, and (2) add Freebuff as a selectable runner with its models present in every model menu.

## Verified starting state (do not re-litigate, but do re-check before editing)

Models today are a **rate-limit fallback chain, not a rotation**:

- `src/engine.js` `effectiveModelList(project, phase)` returns the ordered list from `project.<phase>Model || project.model || settings.<phase>Model || settings.model`, split on commas.
- `src/engine.js` `startStep()` picks `models[rt.modelIndex]` and resets `rt.modelIndex = 0` whenever `rt.modelAttemptRunKey !== runKey` (every new task and phase), and re-zeros when the index runs past the list.
- `src/engine.js` `scheduleModelFallback()` advances `rt.modelIndex` **only** when `runner.isRateLimit(rt.stepOutput)` matches. A step that succeeds on model 3 leaves no trace, and the next task starts again at model 1.
- Net effect: model 2..N are used only after an explicit rate-limit error, and the selection is never round-robined across steps. If the user selects three models, tasks 1..N all run on model 1 until it 429s.

Freebuff today is **not present anywhere**: no runner in `src/runners/`, no `freebuff` entry in `MODEL_OPTIONS` in `public/app.js`, no freebuff literal in the repo. The CLI is installed on this host at `/usr/local/bin/freebuff` (v0.2.36).

## Task 0 — discovery gate (required, before writing code)

Record findings in `.project_documents/INVESTIGATION-model-rotation-freebuff.md`. Do not invent flags or endpoints; anything unverified must be written down as unverified.

1. Run and capture `freebuff --help` and `freebuff -v`.
   Currently: usage is `freebuff [options] [command]`; commands are `login` and `doctor` only; options are `-v/--version`, `--continue [conversation-id]`, `--cwd <directory>`, `--trust-agents`, `-h/--help`. **There is no `--model` flag and no `models` subcommand.**
2. Determine, with evidence, whether Freebuff can be driven non-interactively and whether its model can be chosen without the interactive picker. Check for a documented prompt-on-stdin/argument path, a config file or env var that pins the model, and whether `--continue` can carry a model. Report the exact evidence. If no non-interactive model pin exists, stop at the honest conclusion and implement the degraded scope below instead of guessing.
3. Confirm the current model-list source of truth: `MODEL_OPTIONS` in `public/app.js` (13 ids, `omniroute/*` and `opencode/*`), rendered into 12 `<select multiple>` controls — global `#model`, `#seed-model`, `#analyze-model`, `#implement-model`; add-project `#project-model`, `#project-seed-model`, `#project-analyze-model`, `#project-implement-model`; drawer `#drawer-model-input`, `#drawer-seed-model`, `#drawer-analyze-model`, `#drawer-implement-model`.
4. Confirm runner plumbing: `src/runners/index.js` registry; `scripts/host-executor.js` spawns `opencodeBin` unconditionally (around line 348) from `/run` payload `{prompt,cwd,files,url,model,runKey,projectId,phase,task}`; the container image has no AI CLI, so any Freebuff execution on the hosted deployment is host-executor work.

## Task 1 — rotate through the selected models

Add rotation without breaking the existing fallback contract.

Required behavior:

- New setting `modelRotation` with values `off` (default) and `rotate`. `off` preserves today's behavior byte for byte: first model preferred, later models only on rate limit.
- With `rotate`, each step starts on the next model in the effective list, cycling: task/phase 1 -> index 0, next -> index 1, ... wraparound. Rate-limit fallback still advances within the same step, and after a step succeeds the cursor advances past whatever model served it, so a rate-limited model is not immediately reused.
- A single-model selection is a no-op under both values.
- Per-project override, same inherit rule as the other model fields: blank project value inherits the global setting.
- Cursor is per project (not per phase) and in memory only, like `rt.modelIndex`. State the reset behavior explicitly (runKey change, project restart, container restart) in the docs; do not invent durability across restarts.
- Rotation applies uniformly to `seedModel`, `analyzeModel`, `implementModel`, and the inherited default, using the existing resolution order.
- The model actually used must stay visible: keep the existing `Model: <id>` log line and add the rotation position when rotating, e.g. `Model: <id> (rotation 2/3)`.

Implementation surface (smallest that works):

- `src/config.js`: default `modelRotation: 'off'` in `DEFAULT_SETTINGS`, project normalization for the override, and a resolver next to `resolveCooloff`.
- `src/engine.js`: replace the ad-hoc `modelIndex` reset with one helper that returns the starting index for a step (rotation cursor vs. current behavior), and advance the cursor on successful close. Do not change `scheduleModelFallback`'s rate-limit-only gate, phase logic, `nextPhase`, cooloff, or auto-resume.
- `server.js`: validate `modelRotation` in the existing `PATCH /api/settings` (`'off' | 'rotate'`) and in the project create/patch path. Extend existing routes only; no new endpoints.
- `public/index.html`, `public/app.js`, `public/styles.css`: one selector in global settings, one in the add-project form, one drawer override plus a line in the drawer model summary. Keep the control always visible (it is harmless with one model) and label it plainly, "Rotate models each step". Update the field hints that currently say "fallbacks on rate limit".
- `src/engine.js` state: expose `modelRotation` (effective) and the resolved value in `getState()`; keep `effectiveModelLists` as-is.

## Task 2 — add Freebuff and its models to the menus

Scope decision is yours, driven by Task 0 evidence, but it must be one of these and must be stated in the handoff:

- **Full runner**: a `src/runners/freebuff.js` implementing `{id, label, description, isRateLimit, ensureServer, buildCommand, shutdown}`, registered in `src/runners/index.js`, using only a verified non-interactive invocation. Add `LOOPARR_EXECUTOR_FREEBUFF_BIN` handling plus a `runner` field on the host-executor `/run` payload so the bridge spawns the right binary (default stays `opencode`; reject unknown runner ids). Extend `src/env-settings.js` if a new env var is required.
- **Menus only**: if no verified non-interactive model pin exists, add Freebuff model ids to `MODEL_OPTIONS` (and the runner entry **only** if runs can actually start), and record the block in `plan.md` with the concrete missing capability, the date, and the smallest enabling change — the same format as the existing model-picker blocked item.

Menu requirements either way:

- Freebuff model ids use the existing `provider/model` shape, e.g. `freebuff/<slug>`, and must pass `validateModelId` in `src/model-list.js` (no whitespace, no commas, no leading `-`).
- Add every Freebuff model that the CLI actually offers. The Freebuff picker per its bundled README lists: MiMo v2.6 Flash Fast (default), GLM 5.3 Flash, DeepSeek V4.1 Flash 10/17, DeepSeek V4.1 Flash Fast, GPT-6 Luna, MiMo 2.6 Pro, Solar Mini 4, Solar Pro 4, Space Bunny Alpha, Gemini 3.8 Flash, Muse Spark 1.3, Gemini 4 Argon, GPT-6.1 Terra, GPT-6.1 Sol. Derive the slugs from the CLI where possible and record an id -> display-name mapping table in `README.md`; do not silently rename a model.
- All 12 model selects must offer the new ids with no other UI change (they all render from `MODEL_OPTIONS`), and the runner selects must show Freebuff only if Task 0 proved it can run.
- Do not change `DEFAULT_SETTINGS` model defaults; `opencode/big-pickle` stays the default.
- Do not add Freebuff ids to the "verified 1:1 against `opencode models`" claim in `README.md` — that sentence must be split so OpenCode and Freebuff lists are described separately.

## Tests and verification

- Extend `scripts/test-model-selector.js` (and add a focused script if rotation needs its own executable timeline, wired into `package.json` `test`) to cover: `off` keeps first-model preference; `rotate` cycles across consecutive tasks and across phases; rate-limit fallback still advances inside a step and rotation resumes past the served model; single-model no-op; per-project override wins over global; invalid `modelRotation` rejected; Freebuff ids accepted by `parseModelList`/`validateModelId` and present in every served select's markup.
- Keep `npm test` green as one command; report the exact command and output. `git diff --check` and `node --check` each touched file.
- For Freebuff, prove the claim you make: if you claim runs work, show a real run (or a fake-bin bridge test mirroring `scripts/test-host-executor-run-key.js`). If you claim menus only, show the block evidence.
- Rebuild and verify production per the mandatory block at the top of `plan.md`: `docker compose build looparr && docker compose up -d looparr`, container healthy on the new image, served `/`, `/app.js`, `/styles.css` contain the new ids/settings, container hashes match local, `/api/state` shows the new fields.
- Update `README.md` (Models, Rate-limit pause, Add another runner sections), `plan.md` (mark items and add any blocked item), and append a dated batch section to `.project_documents/PROGRESS.md` with commands and results.

## Constraints

- Do not touch unrelated files or pre-existing uncommitted work.
- No new npm dependencies.
- No invented CLI flags, env vars, or endpoints: every Freebuff invocation in code must be one you observed working.
- No new API endpoints; extend the existing settings/project routes and the existing host-executor contract.
- If a step is blocked (e.g. no non-interactive Freebuff model selection), record it and take the degraded scope — do not fake support with a runner that cannot start a run.
- Keep the dark compact UI conventions and the existing multi-select behavior (`fillModelSelect`/`readModelSelect`); do not replace native multi-selects.

## Deliverable

One handoff summary containing: what rotation does now vs. before, the `modelRotation` contract and reset rules, the Freebuff scope chosen and the evidence behind it, the id -> model mapping, test output, and production verification numbers. Leave `plan.md` accurate enough that the next session needs no archaeology.
