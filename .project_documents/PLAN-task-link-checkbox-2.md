# Task link checkbox — implementation plan

Status: planned. Plan item: `(plan) Task link checkbox`.
Input: analysis in [PLAN-task-link-checkbox.md](PLAN-task-link-checkbox.md) plus four decisions below.
This file is `-2` because the auto-derived slug collided with the existing analysis doc (decision 2).

## Design

Add a "Link doc" checkbox (plus an optional prefix/filename input) to the add-task row. When checked,
the new task line is composed as:

`- [ ] (plan) <title> — see [<file>](.project_documents/<file>)`

where `<file>` = `<PREFIX>-<slug>.md`, `PREFIX` defaults to `PLAN`, and `<slug>` is a kebab-case
ASCII slug of the title (max 60 chars, fallback `task`). The linked doc is created as a stub
(`# <title>`) via `PUT /api/projects/:id/plan-file` before the plan is saved, so the link is never
dead. When unchecked, behavior is byte-identical to today.

Decisions from the clarifying questions:

1. **Prefixes** — `PROGRESS` is a user-selectable prefix for new linked docs. The selectable list is
   kept identical to the renderer/file-endpoint accept list:
   `PLAN` (and lowercase `plan`), `PROMPT`, `ANALYSIS`, `RESEARCH`, `INVESTIGATION`, `HANDOFF`,
   `PROGRESS`. One shared list expressed in three places (renderer normalizer, renderer linkify
   pattern, server basename check) must stay aligned.
2. **Overwrites** — if the resolved filename already exists, link to it unchanged; never overwrite.
   `-2`/`-3` suffixes apply only to auto-derived slug collisions (fresh doc wanted, name taken), not
   to user-typed filenames that already exist (user chose that exact file → reuse it).
3. **Stub failure** — if stub creation via `PUT /plan-file` fails (non-2xx, network, name
   validation), abort the task addition with a clear status message and do not write the plan.
   Never add a dead link.
4. **Default state** — first visit with no `localStorage['looparr.taskLinkDoc']` entry defaults the
   checkbox to unchecked. Users opt in to linked-doc creation.

## Existing behavior (verified against current code)

- `public/index.html` ~521: `.task-add-row` holds `#task-input` + `#add-task`.
- `public/app.js` `addChecklistTask()` (~2147): `cleanTaskText` → `appendTask` →
  `savePlanContent` (PUT `/api/projects/:id/plan`).
- `public/app.js` `normalizePlanFilePath()` (~736) and the `linkPlanReferences` pattern (~763) both
  still accept only `(PLAN|plan)-*.md`.
- `server.js` line 24: `PLAN_FILE_BASENAME = /^(PLAN|plan)-[^/\\]+\.md$/` gates both `GET` and `PUT`
  `/api/projects/:id/plan-file`. `PUT` already supports creating a new file under
  `.project_documents/` (requires the directory to exist, which it does) but rejects any
  non-`PLAN` prefix — so the server list must be widened too, or `PROGRESS-…` stub creation 400s.
- Consequence: the renderer widen is step 1 of this plan (it also fixes already-existing
  `PROMPT-`/`RESEARCH-`/… references that currently render as plain text).

## File map

| File | Change |
| --- | --- |
| `public/app.js` ~736 (`normalizePlanFilePath`) | widen basename regex to the decision-1 list |
| `public/app.js` ~763 (`linkPlanReferences` pattern) | same prefix list in the bare-filename alternation |
| `public/app.js` `addChecklistTask` (~2147) | when checkbox checked: strip leading `(plan)`, build slug + prefix, resolve doc name (collision rules), stub-create via `PUT /plan-file`, compose linked text, abort-with-status on stub failure |
| `public/app.js` (new small helpers near `addChecklistTask`) | `buildTaskSlug(title)`, `resolveLinkedDocName(...)`, `formatLinkedTask(title, file)`; shared prefix constant exported for tests |
| `public/app.js` (setup) | persist checkbox state in `localStorage['looparr.taskLinkDoc']`; read on load, default `false`; toggle visibility of the filename input |
| `public/index.html` ~521 | `<input id="task-link-doc">` + label, and `<input id="task-doc-file">` (prefix/filename override, hidden until checked) inside `.task-add-row` |
| `public/styles.css` | reuse `.auto-resume-row` styling if possible; verify the row wraps at 320px |
| `server.js` ~24 (`PLAN_FILE_BASENAME`) | widen to the same list (server gate for GET/PUT `/plan-file`) |
| `scripts/test-plan-ui-controls.js` | checkbox markup present, formatter + widened prefix list present in served assets |
| `scripts/test-plan-helpers.js` | unit tests for slug, prefix override, collision suffix, existing-file reuse, invalid names |

## Ordered steps

1. Widen the renderer/file prefix list: `normalizePlanFilePath` regex, `linkPlanReferences` pattern,
   `server.js` `PLAN_FILE_BASENAME` — identical lists: `PLAN|plan|PROMPT|prompt|ANALYSIS|analysis|RESEARCH|research|INVESTIGATION|investigation|HANDOFF|handoff|PROGRESS|progress`.
2. Add the checkbox + filename input markup in `public/index.html`.
3. Add helpers in `public/app.js`:
   - `buildTaskSlug(title)`: strip leading `(plan)`, NFKD-normalize, lowercase, keep `[a-z0-9]` runs,
     `-`-join, trim `-`, max 60, fallback `task`.
   - `resolveLinkedDocName(...)`: user-typed `PREFIX-slug.md` (validated client-side as
     `^[A-Za-z0-9][A-Za-z0-9._-]*\.md$` and matching the widened prefix list) is used verbatim;
     auto-derived name that already exists gets `-2`, `-3`… appended;
     user-typed name that already exists is reused unchanged.
   - `formatLinkedTask(title, file)`: `(plan) <title> — see [<file>](.project_documents/<file>)`
     (em dash U+2014, one space each side).
4. Wire `addChecklistTask`: read checkbox state (default unchecked, first visit → unchecked);
   when checked, resolve the doc name, `GET /plan-file?path=…` to test existence
   (404 → create stub `# <title>`; 200 → leave untouched per decision 2); abort with a clear
   `dom.taskStatus` message and no plan write if the stub PUT fails (decision 3); then append the
   linked task text and save as today. `parseDependencySuffix` still works because the link stays
   inside the task text.
5. Persist the checkbox in `localStorage['looparr.taskLinkDoc']`; show/hide the filename input.
6. Update the two test scripts; run `npm test` and `git diff --check`.

## Tests

1. Checked + title only → task text `- [ ] (plan) Task link checkbox — see [PLAN-task-link-checkbox.md](.project_documents/PLAN-task-link-checkbox.md)`; missing doc created with `# Task link checkbox`.
2. Unchecked → byte-identical to today's `- [ ] <text>` (existing tests keep passing).
3. Prefix `PROGRESS` (and `PROMPT`, `ANALYSIS`) selectable and produces matching filenames; server accepts them on `PUT /plan-file`.
4. Existing doc + user-typed filename → linked unchanged, content untouched (no overwrite).
5. Auto-derived slug collision → `-2` suffix used, original file untouched.
6. Stub `PUT /plan-file` failure → status message, no plan write, no dead link.
7. Invalid filenames (`../x.md`, `foo.txt`, spaces) rejected with status message, no plan write.
8. `linkPlanReferences` renders the new prefixes as clickable `plan-file-ref` buttons.
9. Checkbox default unchecked on first visit; checked state survives reload via localStorage.
10. `/api/state` and plan format unchanged for legacy tasks without links.

## Acceptance criteria

- `[a-z0-9-]` slugs, decision-1 prefix list, no-dead-link rule, no-overwrite rule, abort-on-stub-
  failure rule, and opt-in default all demonstrable in the running UI and covered by tests.
- All existing `npm test` suites pass; new tests added for items 1–10 above.
- `git diff --check` clean; only the files in the file map touched.

## Risks

- **List drift**: three copies of the prefix list (renderer ×2, server ×1) can diverge. Mitigation:
  keep one exported constant per file and add a test asserting the renderer and server lists match
  textually.
- **Stub race**: two tabs creating the same doc — second `PUT` would overwrite the first `# <title>`
  stub with identical content, acceptable; the plan write itself is already guarded elsewhere.
- **Overwrite risk if existence check is skipped**: stub creation must run through the
  404-check→PUT sequence, not fired with `{ name: 'w+' }` semantics; covered by test 4/5.
- **Dead links**: only if the abort path is bypassed; covered by test 6.
- Accidental adds leave stub `.md` files in `.project_documents/`; acceptable (task is the record;
  file easy to delete).
