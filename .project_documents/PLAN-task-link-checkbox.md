# Analysis: Add-task checkbox that creates a linked plan doc

Status: analysis only; no code changed. Plan item: `(plan) Task link checkbox`.

## Question

Can the Add task row gain a checkbox that makes the new checklist item use the same
`— see [FILE.md](.project_documents/FILE.md)` format as the plan items that link to
`.project_documents/`, so the link is created and rendered automatically?

Yes. It is a small client-side change plus one renderer fix. Details below.

## How a task is added today (verified)

1. Markup: `public/index.html` lines 485–487 —
   `<div class="task-add-row"><input id="task-input"><button id="add-task">Add task</button></div>`.
2. Handler: `public/app.js` `addChecklistTask()` (~line 2010). It calls
   `cleanTaskText(dom.taskInput.value)`, appends a `- [ ] <text>` line with `appendTask(content, text)`,
   then saves the whole file through `savePlanContent(next, 'task added')`.
3. `savePlanContent` PUTs `/api/projects/:id/plan` (`server.js` ~601), which calls
   `engine.writePlan()`; `src/plan.js` `parseTasks` re-reads it with
   `TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)(.*)$/`. The task text is everything after `- [ ] `,
   so an em-dash and a Markdown link are preserved verbatim.
4. Display: `updateCard`/`updateDrawerHeader` call `linkPlanReferences()` (`public/app.js` ~723). It
   walks text nodes and linkifies `[label](target)` or bare `PLAN-*.md` / `plan-*.md` names, but
   `normalizePlanFilePath()` only accepts
   `/^(PLAN|plan)-[^/\\]+\.md$/` under `.project_documents/`.

### Consequence for the files created by this batch

This document and its two sibling specs were renamed to the `PLAN-` prefix so they match the current
`^(PLAN|plan)-` check and render as clickable `plan-file-ref` buttons. Any other prefix (`PROMPT-`,
`ANALYSIS-`, `RESEARCH-`, `INVESTIGATION-`, `HANDOFF-`) still falls through as plain text, so the
checkbox feature must widen that check before it can link such files automatically.

## Proposed UX

In `.task-add-row`, add:

```html
<label class="auto-resume-row" title="Create a .project_documents file and link it">
  <input type="checkbox" id="task-link-doc">
  <span>Link doc</span>
</label>
<input type="text" id="task-doc-file" placeholder="PLAN-<slug>.md" autocomplete="off" hidden>
```

Behaviour when **Link doc** is checked:

- Task text is composed as
  `(plan) <title> — see [<file>](.project_documents/<file>)`.
- `<file>` defaults to a slug of the title: `PLAN-` + lowercased, kebab-cased, ASCII-only title
  (`Task link checkbox` → `PLAN-task-link-checkbox.md`). The optional filename input lets the author
  override the prefix (`PLAN-`, `PROMPT-`, `ANALYSIS-`, `RESEARCH-`, `INVESTIGATION-`, `HANDOFF-`) and
  the slug.
- If the file does not exist, create a stub through the existing
  `PUT /api/projects/:id/plan-file` endpoint (`server.js` ~646) containing `# <title>`, so the link is
  never dead. If it exists, leave it untouched.
- If the user unchecks it, the typed text is added exactly as today.
- Remember the checkbox state per browser (`localStorage['looparr.taskLinkDoc']`), not per project, so
  authors who always link docs keep the box checked.

## Formatting rules and edge cases

- Title: `cleanTaskText` already collapses whitespace; strip a leading `(plan)` if the author typed one
  so it is not duplicated.
- Slug: `toLowerCase()`, `NFKD` normalize, drop non `[a-z0-9]+` runs, `-` join, trim `-`, max ~60 chars,
  fall back to `task`. Collide with an existing file → append `-2`, `-3`.
- The em dash is `—` (U+2014) with one space on each side, matching the existing plan lines.
- `parseDependencySuffix` (plan.js) only strips a trailing `(depends: …)`; the link stays inside the task
  text, so dependencies keep working.
- Long titles: the card clamps text and the drawer has an expand toggle, so no other UI change is needed.
- Security: the filename must match `^[A-Za-z0-9][A-Za-z0-9._-]*\.md$`; the plan-file endpoint already
  contains paths inside the project, but validating client-side gives a clear message.
- Server-side: no new endpoint is needed; `PUT /plan-file` already creates and writes doc files
  (verify it allows creating a new file under `.project_documents/`, and if it does not, add creation
  support there rather than a second endpoint).

## Where to change

| File | Change |
| --- | --- |
| `public/index.html` (~485) | checkbox + optional filename input in `.task-add-row` |
| `public/app.js` `addChecklistTask` (~2010) | when checked, build the linked text, ensure the doc exists, then save |
| `public/app.js` `normalizePlanFilePath` (~700) | widen the accepted prefixes to `PLAN|plan|PROMPT|ANALYSIS|RESEARCH|INVESTIGATION|HANDOFF|PROGRESS` (still `.project_documents/` only) |
| `public/app.js` `linkPlanReferences` pattern (~748) | same prefix list for bare filenames |
| `public/styles.css` | nothing required if the checkbox reuses `.auto-resume-row`; check the row wraps at 320px |
| `src/plan.js` | optional: export `planDocFileName(title, prefix)`/`formatLinkedTask()` for server-side reuse and unit tests |
| `scripts/test-plan-ui-controls.js` | assert the checkbox exists, and (served-asset style) that the formatter and widened prefix list are present |
| `scripts/test-plan-helpers.js` | if the formatter moves to `plan.js`, unit-test slug, prefix override, collision suffix, and invalid names |

## Tests worth writing

1. Checked + title only → adds `- [ ] (plan) Title — see [PLAN-title.md](.project_documents/PLAN-title.md)`.
2. Unchecked → byte-identical to today's `- [ ] Title`.
3. Prefix override `PROMPT` and `ANALYSIS` produce the matching file name.
4. Existing file is not overwritten; missing file is created with `# Title`.
5. Collision (`PLAN-title.md` exists) → `PLAN-title-2.md`.
6. Invalid name (`../x.md`, `foo.txt`, spaces) is rejected with a status message and no plan write.
7. `linkPlanReferences` turns `PROMPT-…`/`ANALYSIS-…` references into clickable `plan-file-ref` buttons.
8. `/api/state` and plan text remain unchanged for legacy tasks.

## Risks

- **Renderer prefix gap** is the only real blocker; without it the feature appears broken.
- Creating the stub file on add means an accidental add leaves an empty `.md`; acceptable because the
  task is the record, and the doc is easy to delete.
- The task text is part of the checklist; a long title plus filename can wrap on mobile — the existing
  clamp/expand behaviour covers it.

## Recommendation

Implement in one batch: widen the prefix list first (it fixes the three plan links added today), then
add the checkbox, the formatter, the stub creation, and the tests above. Estimated diff: ~120 lines of
JS/HTML plus ~60 lines of tests, no server changes beyond verifying `/plan-file` creation.
