# Looparr self-management plan

## Production deploy verification — mandatory

Stale production assets have shipped three times. For every batch that changes source files, verify production before marking its plan item complete.

- Rebuild and recreate: `docker compose build looparr && docker compose up -d looparr`.
- Confirm container healthy and running on the new image.
- Confirm served HTML, CSS, and JS contain the new change.
- Confirm container files match local source timestamps or content.
- Only then mark the plan item complete and write the handoff.

## Hosted deployment baseline

- [x] The previously worked task "Hide completed should be the default task", appeared to launch another session when looparr prod was restarted, verify and correct.
- [x] When a task finishes it is marking the plan completed too early and looparr shows the project current item as “idle press start" verbiage instead of task it is working on. It does show when it moves to the next task though, but not while it is wrapping up the previous since it was marked too early. Does the implement prompt need to be updated?
- [x] Hide completed should be the default, last UI state of all settings should be remembered per project. Anything empty should be collapse like questions when there are none
- [x] Mobile view only shows four icons across per task should be all
- [ ] Seed prompts injecting entire plan markdown ballooning context. See if just filePath to plan is sufficient to pass context
- [ ] Remove project count from top right of home page

## Bootstrap batch

- [x] Add container and Tailscale Serve deployment files
- [x] Add host-side OpenCode execution bridge
- [x] Verify local API, SSE, bridge health, Serve, and Funnel status
- [x] Commit hosted deployment changes locally

## Next batch

- [x] Keep host executor running for hosted task execution
- [x] Keep Funnel disabled
- [x] Create plan.md and initial handoff from deployment docs

## Next after

- [x] Register Looparr repository as a managed project
- [x] Harden project watcher against unreadable state directories

## iOS home-screen batch

- [x] Re-verify hosted deployment after project registration and record current status

## Touch icon fill batch

- [x] Audit the existing dashboard UI for project setup and hosted status gaps

## Touch icon fit batch

- [x] Implement the needed UI changes in `public/`

## Touch icon fit follow-up batch

- [x] Verify the UI through local HTTP and update `.project_documents/PROGRESS.md`

## Touch icon scale 1.5 batch

- [x] Propose UI grouping: sidebar navigation versus all-on-one-page layout. Review Splitarr or Curatarr for patterns, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.

## Touch icon scale 1.3 batch

- [x] Propose iOS web-app icon support: favicon plus Apple touch icon and meta tags for saving to the iOS home screen. Review Splitarr or Curatarr for clues, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.

## Touch icon confirmation

- [x] Add 180x180 opaque RGB `public/apple-touch-icon.png` and iOS home-screen meta tags to `public/index.html`.

## Plan setup guidance batch

- [x] Scale `public/apple-touch-icon.png` edge to edge, keep opaque RGB format, and verify served hash.

## Drawer activity and logs batch

- [x] Reduce the touch icon artwork scale from 2.2 to 2.0 to address user-reported home-screen crop, keep full-bleed opaque RGB background, and verify served hash.

## Hosted add-project documentation batch

- [x] Reduce the touch icon artwork scale from 2.0 to 1.8 after user feedback, keep full-bleed opaque RGB background, and verify served hash.

## Headless handoff documentation batch

- [x] Reduce the touch icon artwork scale from 1.8 to 1.5 after user feedback, keep full-bleed opaque RGB background, and verify served hash.

## Constraint block discovery list

- [x] Reduce the touch icon artwork scale from 1.5 to 1.3 after user feedback, keep full-bleed opaque RGB background, and verify served hash.
- [x] User confirmed the scale 1.3 icon is correct; icon work is complete.
- [x] Add drawer guidance for creating a valid `plan.md` from the browser without backend changes.
- [x] Improve the project drawer with labeled current/up-next task text, log status, empty state, and jump-to-latest control without backend changes.

### Current discovered block

- User lifted the `src/engine.js` and `public/app.js` constraints for this session on 2026-11-21. The lift lasts until the user says stop. Repeated-block threshold: ask after 2 blocks. Permanent lift not granted.
- Original block: `src/engine.js` must remain untouched. It blocked full headless prompt/answer round-trip implementation and the editable prompt template/settings panel. `public/app.js` was also listed as pre-existing uncommitted work.

## E2E UI batch

- [x] Update `README.md` for the server-side Add Project path flow, validation, `~` expansion, setup state, and hosted mounted-path behavior.
- [x] Document the current headless prompt/answer phase contract and manual markdown question/answer archive flow in `README.md` without engine, backend, or UI changes.
- [x] Add the escalation rule: when a constraint blocks work, ask the user instead of silently switching to a smaller batch.
- [x] Record repeated blocks in this list and carry them into `.looparr/next_prompt.txt`.
- [x] Ask the user to choose when the same block occurs twice: keep the block, temporary lift, or permanent lift.
- [x] Add settings in the Looparr UI for block threshold, temporary lift scope, and permanent lift. Store global defaults in the existing Looparr runtime config (`config.json` under `settings`; no separate `settings.json` exists today). Add per-project override fields to each project entry. Per-project value wins; otherwise inherit the global default.
- [x] Add sidebar navigation with projects at top and global settings grouped under a Settings header.
- [x] Surface blocker settings in global settings and sidebar navigation.
- [x] Add project checklist task creation and reorder controls in the project drawer.
- [x] Add Question handoff UI backed by `GET /api/projects/:id/answer` and `PUT /api/projects/:id/answer` for `.looparr/next_prompt.txt`.
- [x] Document the E2E UI flow in `README.md` and verify local, container, bridge, Serve, and Funnel state.
- [x] I tried running looparr with this looparr ui project, it showed Error. Diagnose.
- [x] Unblock settings and sidebar directive. I want them in a sidebar. Settings is a gear icon, only shows text “settings” on tooltip and header.
- [x] Add a matching Start/Pause/Stop row to the project detail drawer below the idle/current/up-next block. Use existing `/api/projects/:id/start|pause|stop` routes and the same disabled states as home-page cards; keep card buttons unchanged. Interrupt finding: no safe chat-level interrupt is wired; each step uses a fresh `opencode run` with no session id. Pause is a soft process-level pause; stop sends SIGTERM. Supersedes the earlier play/pause-at-top wording.
- [x] For adding projects see if a server side browse can be opened. Also a dropdown list of folder names under root, and an add new project folder button that would create a directory
- [x] Add model selector, it looks like tidepool was picked. I normally use big pickle set it to this and add dropdown to be able to select by type of prompt send global and per project
- [x] Add auto-resume-on-start for Looparr projects. Root cause: container recreation wipes in-memory runtime (`runtime = new Map()` in src/engine.js), so an active project becomes status:idle/active:false with no logs. Persist opt-in `autoResumeOnStart` per project; before graceful shutdown/restart of the looparr container, log and persist whether auto-resume should occur; on startup check marked projects and resume them with preserved phase. Add API/config fields, drawer toggle, append-only audit log, restart helper, and tests. See .project_documents/INVESTIGATION-looparr-idle-after-restart.md.
- [x] Add hide/show button for completed tasks. Add double arrows to move to top / bottom on plan list. Add hamburger icon on left to be able to hold click and drag item to different place
- [x] Add to looparr UI project that prompt should include CLI tools may be installed, and this is an option on a settings page as a checkbox. Investigate other items that could go here like collecting broad items like JavaScripts you mentioned and having the block pieces there.
- [x] Rather than references for page jumps I want the sections on their own page. I want icons instead of text, review how Curatarr did this. Override blocks
- [x] Pin the detail-view Start/Pause/Stop controls to the top so they stay visible while scrolling a long project detail drawer, especially on iOS Safari. Current state after the last batch and prod promotion: `#drawer-controls` and `#drawer-control-status` sit immediately below `.drawer-status-row` (idle/current/up-next) in `public/index.html`; this works but scrolls out of view on long details. Use the existing `controlDisabled(project)` and `updateDrawerControls(project)` helpers in `public/app.js` and the existing POST `/api/projects/:id/start|pause|stop` routes. Keep the home-page card buttons unchanged. Avoid covering the drawer title/close control; verify one clear control set remains and that disabled states and inline API errors still work. Test with a long detail in a narrow/mobile viewport. After source edits, rebuild and recreate the production container (`docker compose build looparr && docker compose up -d looparr`) and verify the served assets; source-only edits did not reach prod in this session.
- [x] 1. Filtering Up next to show current_index + 1 (the next unchecked item after the active one) will make the card feel cleaner and give you a true lookahead.
- [x] For current up next project section with start menu from main page Expose Both Endpoints on Node.js Add two lightweight routes to your Looparr server so Scriptable can list active projects and fetch status by project name or path: something similar to this // 1. List all active projects for the Scriptable picker app.get('/api/active-projects', (req, res) => { // Return an array of active project objects: [{ name, path }, ...] res.json(activeProjects.map(p => ({ name: p.name, path: p.path }))); }); // 2. Get status for a specific project (or default to the first active one) app.get('/api/widget-status', (req, res) => { const query = req.query.project || req.query.path; const project = activeProjects.find(p => p.name === query || p.path === query) || activeProjects[0]; if (!project) return res.status(404).json({ error: "No active projects" }); res.json({ project: project.name, path: project.path, status: project.status, currentTask: project.currentTask, upNext: project.upNext, completed: project.completed, total: project.total }); });
- [x] For task list add an edit and remove button. Edit is a pencil, swaps to floppy icon for save. Delete is a red x and a prompt pops asking to confirm delete
- [x] Keep next_prompt.txt Lean: Only have what’s needed for the next task
- [x] For UI model picker, make drop down of available models from target AI provider if possible. Documented as blocked (2026-11-21): the container image has no `opencode` binary, so the looparr server cannot enumerate models itself; dynamic population would need the host executor (external host process, has `opencodeBin`) to expose `GET /models` running `opencode models`, a looparr server `GET /api/models` route merging that with the static list as fallback, and `fillModelSelect` fetching it — a host-executor change plus restart and a server route, all outside the public/-only scope. Static list kept manually in sync; verified 1:1 against `opencode models` today.
- [x] Does looparr pull favicon for the project display? If not have it look for one and show that icon
- [x] If detail on current and next task is too long, have it collapsed/ only show three lines, if it’s more than three lines add a triangle or something that designates more and I can tap it to view more. The triangle or arrow would flip after clicking and clicking again hides it, this would be available for current and up next. Remember state so navigate away and back doesn’t reset. Default is collapsed
- [x] See if there is a way to freeze the add task textbox and button as I scroll to it, make it configurable if I want it to do this on the settings page
- [x] Mobile looks good with layout, desktop things aren’t lining up and opening to the side, keep mobile but see if desktop can be fixed. If multiple steps are needed add to plan markdown at the end.
- [x] Mark hide show completed per project persist after setting
- [x] Implement should include directive in prompt to commit to git if tracked updated files, exclude files with secrets tokens or passwords.
- [x] Model picker (global settings and per-project drawer) supports multi-select. Implemented 2026-11-22: all four global and all four per-project model fields accept one model or an ordered comma-separated fallback list. All 12 selectors use native multi-select; shared parsing persists canonical strings; engine falls back on rate limit with the same task, phase, and run key; one model id reaches each local or bridge `opencode` run. Previously blocked (2026-11-21): `opencode run --model` takes one string (`provider/model#variant`); repeated `--model` is unsupported, so a comma string would pass `parseModel` but reach `opencode` as one invalid id. Historical smallest enabling change: keep the single comma string through `parseModel`, add engine fallback over models on `isRateLimit`, and add a multi-select UI plus `index.html` change. Applies uniformly to all model fields (global `model`/`seedModel`/`analyzeModel`/`implementModel` and per-project equivalents).

## New-project planning flow

- [ ] When clicking project to show details keep icons and buttons in the same place, for example implement moves to the left side and it should stay in the same place so it’s not jumping

## Sprint and phase parallelism

- [ ] (plan) Plan prompt type — see [PLAN-plan-prompt-type.md](.project_documents/PLAN-plan-prompt-type.md)
- [ ] Add sprints or phases so one project can split by area, for example backend and frontend. Provide options to run sprints in parallel, run tasks inside a sprint in parallel, or both. Add options on task cards to merge previous branches, and a merge to main/prod deploy option. This way it could be injected into the implement task. Grayed out if task already started. Each task works in its own Git branch. Merge branches at the end of the sprint, then run an automated testing round before the sprint is complete as a new task type ‘[Type] Validation, I.e. if I picked sprint Sprint Validation, or have some suggestions of types like sprint backend front end etc to choose from. Questions and design for this flow come first; record the answers in `.project_documents/` before editing code.
- [ ] Verify / Update Promotion workflow: promote to prod only after testing has completed. Run relevant test scripts and `npm test`, then `npm run restart:looparr -- --dry-run` and `npm run restart:looparr`. Verify container health, new image, container source hashes matching local source, served HTML/CSS/JS hashes matching local files, and `/api/state` before treating deployment as verified. Rate-limit false-positive fix promoted 2026-11-22 after `npm test`; container `b2c72c838f2c` healthy on image `68ca51074656`.
- [ ] Investigate desktop layout, div not going wide on project card, awkward placement of sidebar and detail just goes to the right side instead of overlay like mobile.
- [ ] Add Triangle to main screen project card. Look at legibility for up next in div, vertical on home page but correct on detail page.
- [ ] Add a setting global, and per project, pause in seconds, between tasks. Default is 0.

## Desktop layout and drawer batch

- [ ] Link GitHub repo, push to origin with tag as v1.0
- [ ] Publish docker container with multi arch testing similar to how we did Curatarr. Link docker container repo link to project so button appears
- [ ] Add GitHub button to project detail on home page and detail page, if a GitHub repo is linked. Add a whale icon to link to docker image repo if one is linked.
- [x] Add desktop-only CSS for centered page width, compact icon rail, aligned full-width cards, and unchanged mobile breakpoints.

## Project removal batch (2026-11-22)

- [x] Convert desktop project drawer to a centered modal overlay with stable scrollbar gutter, pinned header/toolbar, and scrolling body.

- [x] Run unit tests, diff checks, local and production browser checks at all required widths, promote to production, verify served assets, and commit tracked changes.
- [x] Send card Remove through `DELETE /api/projects/:id`, keep confirm text and start/pause/stop POST paths, add regression test, remove the two `.tmp-browser-fixture` temp projects, and verify production per lines 3-11. Handoff: `.project_documents/PROGRESS.md`.
- [x] Plan task split prompt — see [PLAN-plan-task-split.md](.project_documents/PLAN-plan-task-split.md)
- [x] Plan file modal — see [PLAN-plan-file-modal.md](.project_documents/PLAN-plan-file-modal.md)

## Scriptable PNG icon batch

Why: Scriptable on iOS uses native image decoding. It cannot decode SVG (`image/svg+xml`) from `GET /api/projects/:id/icon`, so the widget falls back to initials even though the browser renders the project's SVG favicon. Looparr discovery often selects SVG first. Keep the browser endpoint unchanged and add a PNG endpoint for native clients.

- [x] Add `GET /api/projects/:id/icon.png` that returns real PNG bytes, preserves icon discovery versioning, and uses a `-png` ETag.
- [x] Rasterize SVG and other supported source formats to PNG in the server; pass through or re-encode PNG without changing the source.
- [x] Reuse the existing project/icon path containment checks before reading or rendering any icon.
- [x] Update README and tests, then verify local and production per lines 3-11 before marking complete.
