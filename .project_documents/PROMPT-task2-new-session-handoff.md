# New-session prompt: finish Looparr plan-task markdown modal

You are continuing work in the Looparr repo. The context is too full, so follow this handoff exactly and break work into subagent tasks. Do not continue using the old context.

## Fixed constraints

- Sandbox working copy: `/tmp/opencode/looparr-sandbox`.
- Production tree: `/home/michaelpeele/ai-projects/looparr`.
- Do not edit production files until every sandbox check passes.
- Production `git status --short` contains only pre-existing untracked user files: `.tmp-browser-fixture/`, `.tmp-browser-sticky/`, `looparr-a-open.yml`. Preserve them.
- Do not modify Curatarr.
- Looparr's linked workflow doc is Curatarr-specific; user authorized the isolated sandbox copy above.
- Follow sandbox-first: implement and verify in `/tmp/opencode/looparr-sandbox`, then promote only verified files.

## Already done

Task 1 done in sandbox only:

- Created `/tmp/opencode/looparr-sandbox/.project_documents/PROMPT-plan-task-split.md`.
- Sandbox test `scripts/test-plan-task-split-directive.js` passed with `plan task split directive: sandbox checks passed`.
- Fixture exists at `/tmp/opencode/looparr-sandbox/.tmp-plan-task-split-test/`:
  - transformed `plan.md` pointer;
  - `.project_documents/PLAN-hosted-deployment-baseline.md`.
- Do not promote Task 1 yet. Do not promote the test script.

Task 2 not implemented yet.

## User goal for Task 2

Every Looparr render path for references matching `PLAN-*.md` or `plan-*.md` on Home, Project detail, and Task page must:

- show exact hover tooltip `click to open`;
- show exact keyboard-focus tooltip `click to open`;
- open a modal on click;
- show raw markdown in an editable textarea;
- have Save and Cancel/Close;
- Save writes edited raw markdown back to the same file through existing app/API pattern;
- Cancel/Close discards edits;
- show success/error feedback after save;
- affect only plan-task markdown references; other links unchanged;
- reuse existing Looparr modal, tooltip, API, and style patterns;
- add endpoints only if no suitable pattern exists.

Sandbox verification required:

- copy a plan task markdown file and its `plan.md` reference;
- tooltip on Home, Project detail, Task page;
- tooltip text exactly `click to open`;
- click opens modal with correct file contents;
- edit + save, reload, change persists;
- Cancel/Close discards;
- non-plan links show no tooltip;
- checks pass before any prod promotion.

## Exact code anchors

### Server

- `server.js:1-125` imports `path`, `fs`, `express`; `engine`, `bus`, `envSettings`, `iconLib`.
- `PROJECTS_ROOT` line 19.
- Helpers:
  - `isInside(root,target)` 21-24;
  - `rootRealPath()` 26-28;
  - `normalizeRelativeDir(value)` 30-37 rejects NUL/backslash/absolute;
  - `toRootRelative` 39-42;
  - `resolveInsideRootDirectory(value,{rejectSymlink})` 44-86;
  - `fail(res,status,message)` 107-109;
  - `findProject(id)` 111-113.
- No module exports. Importing `server.js` starts listen. Test via source assertions or spawned HTTP.
- Existing `GET/PUT /api/projects/:id/plan` at `server.js:471-487`:

```js
app.get('/api/projects/:id/plan', (req, res) => {
  const plan = engine.getPlan(req.params.id);
  if (!plan) return fail(res, 404, 'Project not found');
  res.set('Cache-Control', 'no-store');
  return res.json(plan);
});

app.put('/api/projects/:id/plan', (req, res) => {
  if (!findProject(req.params.id)) return fail(res, 404, 'Project not found');
  if (typeof req.body?.content !== 'string') return fail(res, 400, 'content must be a string');
  try {
    engine.writePlan(req.params.id, req.body.content, req.body.change);
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 500, error.message);
  }
});
```

- Add plan-file GET/PUT immediately after line 487, before tasks POST at 489.

### Frontend

- `public/app.js:55-125` `dom` object tail:
  - line 61 `folderBrowserStatus: $('folder-browser-status'),`;
  - line 114 `planEditor: $('plan-editor'),`;
  - line 115 `insertPlan: $('insert-plan'),`;
  - line 116 `savePlan: $('save-plan'),`;
  - line 124 `saveBlockPolicy: $('save-block-policy')`;
  - line 125 `};`.
- Add refs: `planFileModal`, `planFileTitle`, `planFileContent`, `planFileStatus`, `planFileSave`, `planFileCancel`, `planFileClose`.
- `public/app.js:386-400` exact `esc`/`api` block:

```js
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
  }

  function api(url, options = {}) {
    return fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    }).then(async (res) => {
      let body = null;
      try { body = await res.json(); } catch { /* no json body */ }
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      return body;
    });
  }
```

- Insert new helper functions after line 400.
- `public/app.js:789-802` `updateCard`; preserve exact lines:
  - 793 `currentText.textContent = project.currentTask || taskFallback(project);`;
  - 800 `upText.textContent = project.nextTask || '—';`.
- Insert `linkPlanReferences(currentText, project.id)` after 793 and `linkPlanReferences(upText, project.id)` after 800, before `syncTaskExpansion` calls.
- `public/app.js:1077-1102` `updateDrawerHeader`; preserve exact lines:
  - 1084 `dom.drawerTask.textContent = project.currentTask || taskFallback(project);`;
  - 1086 `dom.drawerNext.textContent = project.nextTask || '—';`.
- Insert helper calls before sync calls.
- `public/app.js:1258-1331` `renderChecklist`; preserve line 1287 `<span class="task-text">${esc(task.text || '(empty task)')}</span>`.
- Insert between 1321 `}).join('');` and 1322 `updatePlanControls();`:

```js
    dom.checklist.querySelectorAll('.task-text').forEach((span) => linkPlanReferences(span, app.drawerId));
```

- `public/app.js:2221-2233` folder dialog helpers use `<dialog>.showModal()/.close()` with fallback open attribute; reuse.
- `public/app.js:2319-2414` boot bindings; Escape handler closes folder fallback/sidebar/drawer. Update to close plan modal first.
- `public/app.js:2441+` checklist handlers ignore buttons without `[data-action]`, so `.plan-file-ref` buttons will not conflict.
- `public/index.html:470-481` tail:
  - line 477 `</aside>`;
  - line 479 `<script src="/app.js" defer></script>`;
  - line 480 `</body>`;
  - line 481 `</html>`.
- Insert `<dialog id="plan-file-modal" class="plan-file-modal">` between line 477 and 479.
- `public/styles.css:820-845` is end of file inside `@media`; final `}` at 845. Append new CSS after 845, outside media query.
- Earlier CSS anchors: folder dialog CSS 239-276; card/task styles 479-507; checklist styles 633-657.
- `scripts/test-plan-ui-controls.js:351-359` asserts exact textContent lines and forbids card-up innerHTML/interpolated task text. Preserve those lines and use DOM post-processing.
- `package.json:7-16` `npm test` runs 14 scripts; update if adding a test script.

## API contract

Add after plan route in `server.js`:

- `GET /api/projects/:id/plan-file?path=<relative>`
- `PUT /api/projects/:id/plan-file?path=<relative>` with body `{ "content": "raw markdown" }`.

Rules:

- project must exist via `findProject(req.params.id)`;
- `path` must be a string;
- reject NUL, backslash, absolute paths, `..`, and traversal;
- allow optional `./` or `.project_documents/` prefix;
- basename must match `^(PLAN|plan)-[^/\\]+\.md$`;
- resolve inside the project's real directory; confirm project directory field from `engine.getState()` if uncertain;
- use `fs.realpathSync` plus existing containment helper;
- cap at 200000 bytes;
- GET returns `{ ok: true, content }` with `Cache-Control: no-store`;
- PUT writes raw string unchanged, atomically with temp file + rename;
- PUT returns `{ ok: true }`;
- errors use `fail(res, status, message)`.

## UI contract

Modal markup ids:

- `plan-file-modal`
- `plan-file-title`
- `plan-file-content` textarea
- `plan-file-status` with `aria-live="polite"`
- `plan-file-save`
- `plan-file-cancel`
- `plan-file-close`

Renderer:

- `linkPlanReferences(element, projectId)`;
- DOM `TreeWalker` over text nodes; do not use `innerHTML`;
- skip text inside `a`, `button`, `script`, `style`, `textarea`;
- match markdown links `[label](target)` and bare `PLAN-*.md` / `plan-*.md`;
- accept targets `.project_documents/PLAN-foo.md`, `./PLAN-foo.md`, `PLAN-foo.md`;
- validate basename before converting;
- replace valid refs with:

```html
<button type="button" class="plan-file-ref" data-project-id="..." data-plan-file="..." title="click to open" aria-label="click to open" data-tooltip="click to open">label</button>
```

- label = markdown link label for `[label](target)`, basename for bare refs;
- leave all other text and links unchanged.

Events:

- capture-phase `document.addEventListener('click', handler, true)` for `.plan-file-ref`;
- `preventDefault()` and `stopPropagation()`;
- call `openPlanFileModal(projectId, relativePath)`;
- native button activation covers Enter/Space;
- Escape closes plan modal first without closing drawer;
- Save uses PUT with raw textarea value and shows success/error;
- Cancel/Close only closes modal and discards;
- reopen reads from server.

CSS:

- `.plan-file-ref` native title exact; custom tooltip via `::after { content: "click to open"; }`;
- show tooltip on `:hover` and `:focus-visible`;
- `.plan-file-modal` follows folder dialog CSS token pattern.

## Subagent breakdown

Use subagents. Do not overlap file ownership. Keep all edits in sandbox.

1. **Read-only verify subagent** (`explore` or `general`)
   - Re-check current sandbox line numbers and snippets for `server.js`, `public/app.js`, `public/index.html`, `public/styles.css`, `scripts/test-plan-ui-controls.js`, and `package.json`.
   - Confirm no one edited Task 2 files.
   - Return exact current anchors. No edits.

2. **Server subagent** (`cavecrew-builder` or `general`, owns `server.js` only)
   - Implement GET/PUT plan-file endpoints per API contract.
   - Do not touch frontend or tests.

3. **Markup/CSS subagent** (`general`, owns `public/index.html` and `public/styles.css`)
   - Add modal markup per UI contract.
   - Append CSS per UI contract.
   - Do not touch `public/app.js` or `server.js`.

4. **Frontend logic subagent** (`general`, owns `public/app.js` only)
   - Add dom refs, renderer, modal open/save/cancel/close handlers, capture click handler, Escape update.
   - Insert calls at exact anchors.
   - Preserve exact asserted textContent lines.
   - Do not touch HTML/CSS/server.

5. **Tests subagent** (`general`, owns `scripts/test-plan-file-modal.js` and `package.json` only)
   - Add source assertions for API route, modal ids, renderer, exact tooltip, hook insertion points.
   - Add script to `npm test` chain.
   - Do not change `scripts/test-plan-ui-controls.js` unless mandatory.

6. **Main session after subagents finish**
   - Review diffs.
   - Run `npm test` in sandbox.
   - Start sandbox server on an isolated port; do not use production ports.
   - Browser-verify Home card, Project detail drawer, and Task page checklist with fixture from `.tmp-plan-task-split-test/`.
   - Verify exact tooltip, modal contents, save persistence after reload, cancel discard, and non-plan links unchanged.
   - Only then promote Task 1 directive and Task 2 source changes to production.
   - Append pointer bullets to real `plan.md` using `### [ ] (verify) ... — see [...](...)` format.
   - Do not promote sandbox-only test scripts or temp fixtures.

## Final pointer bullets

After promotion, append to real `plan.md` preserving every other byte:

- Task 1 pointer to `.project_documents/PROMPT-plan-task-split.md`.
- Task 2 pointer to an implementation plan file if one is created; otherwise ask the user for the desired target rather than inventing one.

Use exact style:

```markdown
### [ ] (verify) Short task title — see [TARGET.md](.project_documents/TARGET.md)
```
