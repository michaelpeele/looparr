# Implementation prompt: per-dropdown model rotation toggle

Paste everything below into a fresh agent session in this repository.

---

You are working in the Looparr repository (self-hosted Express + vanilla JS dashboard that drives AI CLI runs over a Markdown checklist). Follow `AGENTS.md` and the mandatory sandbox-first build and promotion workflow in `../workflow.md`. Read `plan.md` first, then `.project_documents/PROGRESS.md` for recent verification patterns.

Implement **rotation per model dropdown**, enabled by a small toggle next to each model multi-select. Rotation must be opt-in per dropdown and default off.

## Verified starting state (re-check before editing, but do not re-litigate)

- `src/engine.js` is a **rate-limit fallback chain, not a rotation**: `startStep()` sets `rt.modelIndex = 0` whenever `rt.modelAttemptRunKey !== runKey` (every new task and phase) and re-zeros when the index runs past the list; `scheduleModelFallback()` advances `rt.modelIndex` only when `runner.isRateLimit(rt.stepOutput)` matches. A successful step leaves no cursor, so every task starts on model 1.
- `effectiveModelList(project, phase)` resolves one field via `configStore.modelFieldForPhase(phase)` with order `project[phaseField] || project.model || settings[phaseField] || settings.model`.
- `src/config.js` `DEFAULT_SETTINGS` holds `model`, `seedModel`, `analyzeModel`, `implementModel` (all `opencode/big-pickle`), plus `cooloffSeconds`, `stickyAddTaskRow`, `promptCliToolsNote`. `normalizeProject` coerces the four model fields and returns `null` for unset numeric overrides; `normalizeSettings` coerces booleans like `promptCliToolsNote`.
- `server.js` validates models with `parseModel` / `applyModelPhaseFields` in `PATCH /api/settings`, `POST /api/projects`, and the project patch handler. Boolean fields are validated inline (see the `promptCliToolsNote` and `stickyAddTaskRow` checks in the settings patch).
- 12 model multi-selects exist in `public/index.html`: global `#model`, `#seed-model`, `#analyze-model`, `#implement-model` (lines ~138-153); add-project `#project-model`, `#project-seed-model`, `#project-analyze-model`, `#project-implement-model` (lines ~268-282); drawer `#drawer-model-input`, `#drawer-seed-model`, `#drawer-analyze-model`, `#drawer-implement-model` (lines ~397-403).
- `public/app.js` renders all options from `MODEL_OPTIONS` (line ~156) through `modelOptions` / `fillModelSelect` / `readModelSelect` (~lines 918-948), saves global fields in `saveSettings` (~line 2273), drawer fields in the `save-project-model` handler (~line 2125), and add-project fields in the project submit handler.
- `public/styles.css` already has `.icon-button` (34x34, bordered, `var(--muted)` color, `place-items: center`, `:focus-visible` outline) and the palette `--green: #34d399`, `--muted: #8b9bb4`, `--panel-2`. Reuse `.icon-button`; do not add an icon font or dependency.

## Task 1 — data model

Add one boolean rotation flag per model dropdown, global and per project. Do not rotate on a global switch; the toggle belongs to its own dropdown.

- Global settings: `modelRotation`, `seedRotation`, `analyzeRotation`, `implementRotation`, all default `false` in `DEFAULT_SETTINGS`.
- Per project: the same four names, each `boolean | null`, where `null`/absent means inherit the global flag. Normalize them in `normalizeProject` (keep `null` on load, coerce any non-boolean to `null`); normalize the global ones in `normalizeSettings` (`=== true`).
- Effective flag: project value when it is a boolean, otherwise the global value. Add `resolveRotation(project, settings, field)` next to `resolveCooloff` and export it.
- Effective list stays exactly as it is today; rotation never changes which models are in the list, only the starting index.

## Task 2 — engine rotation

- Replace the ad-hoc reset in `startStep()` with one helper that returns the starting index for the step.
  - Rotation off for the resolving field: start at `0` (identical behavior to today).
  - Rotation on and the effective list has one model: start at `0` (no-op).
  - Rotation on with two or more models: start at the project's cursor for that field, modulo list length.
- Cursor: `rt.rotationCursor` keyed by the resolved field name (`model`, `seedModel`, `analyzeModel`, `implementModel`), in memory only, like `rt.modelIndex`. Reset a field's cursor to `0` when the project runtime is created and whenever that field's effective list changes (compare a stored joined list string); never persist it.
- Advance the cursor **only after a step completes successfully**. Use the index of the model that actually served the step (after any rate-limit fallback): next = `(servedIndex + 1) % models.length`.
- Leave `scheduleModelFallback`'s rate-limit-only gate untouched: inside one step, a rate limit still advances to the next model and retries; that retry must not also move the rotation cursor. A rate-limited step that eventually errors out leaves the cursor where it was.
- Rotation applies uniformly to seed, analyze, and implement through the existing resolution order. Rotation across phases is independent per dropdown.
- Keep the `Model: <id>` log line and make the position visible:
  - rotating: `Model: <id> (rotation 2/3)`
  - not rotating with fallbacks: existing `(fallback 1/3)` text
  - single model: no suffix
- Do not change phase sequencing, `nextPhase`, cooloff, auto-resume, checkpoint intent, or the marker race logic.

## Task 3 — server

- `PATCH /api/settings`: accept the four `*Rotation` fields, reject non-booleans with `400` and a field-specific message, and include them in the patch object.
- `POST /api/projects` and the project patch handler: accept the four fields as `boolean` or `null` (explicit `null` clears the override), reject anything else with `400`. Persist through `engine.addProject` / the existing update path.
- Extend the existing routes only. No new endpoints.

## Task 4 — UI: one toggle per model dropdown

Every one of the 12 model selects gets its own toggle button, placed immediately after that select inside a shared row wrapper.

Markup per dropdown:

```html
<div class="model-field-row">
  <select id="model" multiple size="4">…</select>
  <button type="button" class="icon-button model-rotate-button"
          data-rotate-for="model" aria-pressed="false"
          aria-label="Model Rotation" title="Model Rotation">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-13.6-4.6L4 9"/>
      <path d="M4 4v5h5"/>
      <path d="M4 13a8 8 0 0 0 13.6 4.6L20 15"/>
      <path d="M20 20v-5h-5"/>
    </svg>
  </button>
</div>
```

The icon is two curved arrows (a cycle/refresh glyph), stroke-based, no text label.

Visual states — the state must be readable at a glance, not only on hover:

- **Enabled**: `aria-pressed="true"`, icon and border `var(--green)`, and the button background fills green as a lit square (`color: #06231a; background: var(--green); border-color: var(--green)`). Hover may slightly brighten it.
- **Disabled**: `aria-pressed="false"`, gray `var(--muted)` icon, transparent background, existing `.icon-button` border. Hover restores `var(--text)`.
- Include a real indicator beyond color for accessibility and grayscale: the pressed state must also set `aria-pressed` (screen readers) and the button must keep a visible border, so on/off differ in fill, not only in hue. Never remove the focus ring.
- Tooltip: `title="Model Rotation"` on all 12 buttons, plus `aria-label="Model Rotation"`. Do not rename the tooltip per field; the button's position identifies the dropdown.

Behavior:

- Toggle is instant UI state; the owning form's existing Save button persists it (global settings Save, add-project submit, drawer "Save models"). No auto-save request on click.
- Global toggles persist to `settings.*Rotation`. Add-project and drawer toggles persist to the project's overrides. The drawer button reflects the effective state on open; once the user toggles it and saves, that field is pinned for the project and no longer follows the global value. State this in the drawer hint text in one short sentence.
- Wire the 12 buttons from a single table (select id -> field) so ids cannot drift; reuse the same helper for reading (`aria-pressed`) and writing (`applyRotationButtons(state)` during `applyState`).
- Update the two existing hint strings ("The first model is tried first; later models are fallbacks on rate limit.") to say rotation is available per dropdown and off by default.
- Add a rotation line to the drawer model summary, e.g. `Rotation: on (implement)` or `Rotation: off`, using the effective flags.
- CSS additions go in `public/styles.css` near `.icon-button`: `.model-field-row`, `.model-rotate-button[aria-pressed="true"]`, and a hover rule. Keep the compact dark UI; no layout shift when toggling.

## Task 5 — tests and verification

- Extend `scripts/test-model-selector.js` markup assertions: all 12 selects are wrapped so each `data-rotate-for` value matches a real select id, every button has `title="Model Rotation"` and `aria-pressed`, and the served `app.js` contains the field table and `applyRotationButtons`.
- Add `scripts/test-model-rotation.js`, wired into `package.json` `test`, driving the real server against the fake executor pattern already used in `scripts/test-model-selector.js`. Cover at minimum:
  - rotation off: three consecutive tasks all run model 1 of a three-model list;
  - rotation on: three consecutive tasks run models 1, 2, 3 in order, and a fourth wraps to 1;
  - rotation is per field: an analyze rotation does not move the implement cursor;
  - rate-limit fallback inside a step advances to model 2, the retry succeeds, and the next step starts at model 3 (not back at 2);
  - single-model selection with rotation on is a no-op;
  - per-project override wins over the global flag, and `null` inherits;
  - `PATCH /api/settings` with a non-boolean rotation value returns `400`;
  - project create/patch rejects a non-boolean, non-null rotation value.
- Run `npm test` as one command and report the exact output. Run `git diff --check` and `node --check` on each touched JS file.
- Rebuild and verify production per the mandatory block at the top of `plan.md`: `docker compose build looparr && docker compose up -d looparr`, container healthy on the new image, served `/`, `/app.js`, `/styles.css` contain the toggle markup, classes, and new settings, container file hashes match local, and `/api/state` shows the rotation fields.
- Update `README.md` (Models and Rate-limit pause sections), mark the rotation item in `plan.md` complete, and append a dated batch section to `.project_documents/PROGRESS.md` with commands and results.

## Constraints

- Rotation only. Do not add Freebuff or other runner ids here; `MODEL_OPTIONS` and the `opencode/big-pickle` defaults stay untouched.
- No new npm dependencies, no icon fonts or icon libraries; the icon is inline SVG.
- No new API endpoints; extend the existing settings/project routes.
- Do not replace the native multi-selects or change `fillModelSelect`/`readModelSelect` semantics.
- Do not touch unrelated files or pre-existing uncommitted work.
- If any step is blocked, record it instead of faking support.

## Deliverable

One handoff summary containing: the toggle contract (per field, default off, inherit rule), the rotation cursor rules and reset behavior, the exact log-line format, the icon/state spec as built, the test command and output, and production verification numbers.
