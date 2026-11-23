# Runner rotation — implementation prompt

Status: implemented 2026-11-23. Plan item: `(plan) Runner rotation`.
See `PLAN-provider-error-fallback.md` for the shared rotation store, cooldowns
and the failure rule that now also advances across runners.

## Goal

Let a project (and the global default) name an ordered list of runners and rotate through it step by
step, exactly the way model rotation already works, with a persisted cursor so a restart does not send
every project back to the first runner.

## Current behaviour (verified)

- `src/config.js`: `normalizeProject` keeps `runner` as a single string; `DEFAULT_SETTINGS.globalRunner`
  is `'opencode'`; `DEFAULT_SETTINGS` has `modelRotation` … `implementRotation: false` and no runner
  equivalent.
- `server.js` validates a single id with `getRunner(id)` at `POST /api/projects` (~line 327),
  `PATCH /api/projects/:id` (~465) and `PATCH /api/settings` (~527), and rejects anything else with
  `Unknown runner: <id>`.
- `src/engine.js` `startStep()` resolves one runner for every step and then filters the effective model
  list through `runnerSupportsModel` (lines ~932–970), logging
  `Skipped model ids not valid for <runner>` for anything that runner does not own.
- `src/runners/index.js` is the registry: `getRunner`, `listRunners`, `runnerSupportsModel` (a model id
  claimed by another runner is refused; ids no runner claims stay allowed).
- The UI has three runner `<select>`s (`#global-runner`, `#project-runner`, drawer summary) and 12 model
  rotation toggles (`data-rotate-for`), asserted by `scripts/test-model-rotation.js`.
- Model rotation state currently lives only in memory (`rotationCursor`/`rotationLists`, engine lines
  72–73) and resets on every engine start.

## Requirements

1. `project.runner` and `settings.globalRunner` accept an ordered comma list (`"opencode,kilo,vibe"`);
   a single id stays valid and unchanged.
2. Add `runnerRotation` — project: nullable boolean, global: boolean, default `false` — resolved like
   `modelRotation` (`project ?? global`).
3. The engine picks one runner per step from the effective runner list and then filters the model list
   for that runner with the existing `runnerSupportsModel`. A model id that only the next runner owns is
   not offered to the current one.
4. The runner cursor advances only after a successful step, is stored by joined runner-list content
   (so inherited projects share the global rotation), and survives restarts. Persist it in the same
   rotation-state file as model cursors.
5. Rate-limited runners are skipped: mark `runnerId -> readyAt` in the shared cooldown map, and choose
   the next ready (runner, model) pair instead of retrying the throttled runner immediately.
6. When a project's runner list changes, its cursor resets to 0. Document that.
7. Log each dispatch's runner so the drawer and card can show it: `Runner: <label> (rotation n/m)` plus
   the existing `Model: ...` line, and expose `activeRunner`/`activeModel` in `/api/state`.

## Implementation

### Config (`src/config.js`)

- Add `runnerRotation: false` to `DEFAULT_SETTINGS`.
- Normalize runner lists with the existing list helpers (split, trim, dedupe, max length); keep the
  config layer permissive about ids, validation stays in the server against the registry.
- Add a runner counterpart to `rotationFieldForModelField` (e.g. `RUNNER_ROTATION_FIELD = 'runnerRotation'`).

### Server (`server.js`)

- POST/PATCH project and PATCH settings: parse the runner value as a list, trim/dedupe, reject any
  unknown id with `Unknown runner: <id>`, and pass the joined list through. Accept
  `runnerRotation` as a boolean or `null` and reject other types with 400 (same style as the model
  rotation validation).

### Engine (`src/engine.js`)

- `effectiveRunnerList(project)` → parsed list from `project.runner || settings.globalRunner`, filtered
  to ids present in the registry, falling back to `settings.globalRunner` when empty.
- In `startStep()`, resolve the runner from the list using the persisted cursor (shared helper with
  model selection), then filter models for that runner. Log `Skirted`/skipped ids as today.
- `advanceRotationCursor()` also advances the runner cursor when `runnerRotation` resolves true.
- On rate limit, mark the runner cooling and pick the next ready pair; if nothing is ready, use the
  earliest `readyAt` for `resumeAt`.
- `getState()`: add `runnerRotation` (and effective value), `effectiveRunners`, and
  `activeRunner`/`activeModel`.

### UI (`public/index.html`, `public/app.js`, `public/styles.css`)

- Turn the three runner selects into `multiple size="3"` and add a rotation toggle beside each, reusing
  `.model-rotate-button`, `#icon-model-rotation`, and the `readRotationButtons`/`applyRotationButtons`
  helpers.
- Extend `MODEL_ROTATION_TARGETS` and the `GLOBAL_*`/`PROJECT_SETUP_*`/`DRAWER_*` slices, and include
  the runner flags in `saveSettings`, `addProject`, `saveProjectModel`, and `applyState`.
- Model pickers scope their options from the first selected runner (or the union when rotating), and
  rebuild when the runner selection changes (`refillModelSelectsForRunner`).
- Keep single-runner configs rendering exactly as today (one option selected).

## Tests

- Extend `scripts/test-model-rotation.js`:
  - served markup assertions move from 12 toggles to the new count (15 with three runner toggles) and
    assert the runner toggles exist and map to real selects;
  - a runner-rotation case (`runner: "opencode,kilo"`, `runnerRotation: true`) asserting alternating
    `payload.runner` values in the fake executor;
  - a rate-limit case where the first runner reports 429 and the next runner is used immediately.
- `scripts/test-runner-payload.js` — registry/lookup assertions unchanged; add list parsing cases if the
  server exposes a helper.
- `scripts/test-model-rotation.js` API contract — reject `runnerRotation: 'on'` (400) and accept a valid
  runner list; verify an unknown id in a list returns 400 naming that id.

## Verification

1. `npm test` exit 0 and `git diff --check` clean.
2. Rebuild/recreate prod, confirm healthy, new image, `/api/state` 200.
3. Set a project to `opencode,kilo` with rotation on, run two tasks and confirm the log shows
   `Runner: ... (rotation 1/2)` then `2/2`, and the card switches label.
4. Restart the container and confirm the cursor continues instead of restarting at slot 1.
5. Confirm a single-runner project is unchanged and no `Skipped model ids` lines appear for valid ids.
