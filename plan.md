# Looparr self-management plan

## Production deploy verification — mandatory

Stale production assets have shipped three times. For every batch that changes source files, verify production before marking its plan item complete.

- Rebuild and recreate: `docker compose build looparr && docker compose up -d looparr`.
- Confirm container healthy and running on the new image.
- Confirm served HTML, CSS, and JS contain the new change.
- Confirm container files match local source timestamps or content.
- Only then mark the plan item complete and write the handoff.

## Hosted deployment baseline

- [x] Add container and Tailscale Serve deployment files
- [x] Add host-side OpenCode execution bridge
- [x] Verify local API, SSE, bridge health, Serve, and Funnel status
- [x] Commit hosted deployment changes locally
- [x] Keep host executor running for hosted task execution
- [x] Keep Funnel disabled

## Bootstrap batch

- [x] Create plan.md and initial handoff from deployment docs
- [x] Register Looparr repository as a managed project
- [x] Harden project watcher against unreadable state directories
- [x] Re-verify hosted deployment after project registration and record current status

## Next batch

- [x] Audit the existing dashboard UI for project setup and hosted status gaps
- [x] Implement the needed UI changes in `public/`
- [x] Verify the UI through local HTTP and update `.project_documents/PROGRESS.md`

## Next after

- [x] Propose UI grouping: sidebar navigation versus all-on-one-page layout. Review Splitarr or Curatarr for patterns, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.
- [x] Propose iOS web-app icon support: favicon plus Apple touch icon and meta tags for saving to the iOS home screen. Review Splitarr or Curatarr for clues, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.

## iOS home-screen batch

- [x] Add 180x180 opaque RGB `public/apple-touch-icon.png` and iOS home-screen meta tags to `public/index.html`.

## Touch icon fill batch

- [x] Scale `public/apple-touch-icon.png` edge to edge, keep opaque RGB format, and verify served hash.

## Touch icon fit batch

- [x] Reduce the touch icon artwork scale from 2.2 to 2.0 to address user-reported home-screen crop, keep full-bleed opaque RGB background, and verify served hash.

## Touch icon fit follow-up batch

- [x] Reduce the touch icon artwork scale from 2.0 to 1.8 after user feedback, keep full-bleed opaque RGB background, and verify served hash.

## Touch icon scale 1.5 batch

- [x] Reduce the touch icon artwork scale from 1.8 to 1.5 after user feedback, keep full-bleed opaque RGB background, and verify served hash.

## Touch icon scale 1.3 batch

- [x] Reduce the touch icon artwork scale from 1.5 to 1.3 after user feedback, keep full-bleed opaque RGB background, and verify served hash.

## Touch icon confirmation

- [x] User confirmed the scale 1.3 icon is correct; icon work is complete.

## Plan setup guidance batch

- [x] Add drawer guidance for creating a valid `plan.md` from the browser without backend changes.

## Drawer activity and logs batch

- [x] Improve the project drawer with labeled current/up-next task text, log status, empty state, and jump-to-latest control without backend changes.

## Hosted add-project documentation batch

- [x] Update `README.md` for the server-side Add Project path flow, validation, `~` expansion, setup state, and hosted mounted-path behavior.

## Headless handoff documentation batch

- [x] Document the current headless prompt/answer phase contract and manual markdown question/answer archive flow in `README.md` without engine, backend, or UI changes.

## Constraint block discovery list

- [x] Add the escalation rule: when a constraint blocks work, ask the user instead of silently switching to a smaller batch.
- [x] Record repeated blocks in this list and carry them into `.looparr/next_prompt.txt`.
- [x] Ask the user to choose when the same block occurs twice: keep the block, temporary lift, or permanent lift.
- [x] Add settings in the Looparr UI for block threshold, temporary lift scope, and permanent lift. Store global defaults in the existing Looparr runtime config (`config.json` under `settings`; no separate `settings.json` exists today). Add per-project override fields to each project entry. Per-project value wins; otherwise inherit the global default.

### Current discovered block

- User lifted the `src/engine.js` and `public/app.js` constraints for this session on 2026-11-21. The lift lasts until the user says stop. Repeated-block threshold: ask after 2 blocks. Permanent lift not granted.
- Original block: `src/engine.js` must remain untouched. It blocked full headless prompt/answer round-trip implementation and the editable prompt template/settings panel. `public/app.js` was also listed as pre-existing uncommitted work.

## E2E UI batch

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
- [ ] For task list add an edit and remove button. Edit is a pencil, swaps to floppy icon for save. Delete is a red x and a prompt pops asking to confirm delete
- [ ] Keep next_prompt.txt Lean: Only have what’s needed for the next task
- [x] For UI model picker, make drop down of available models from target AI provider if possible. Documented as blocked (2026-11-21): the container image has no `opencode` binary, so the looparr server cannot enumerate models itself; dynamic population would need the host executor (external host process, has `opencodeBin`) to expose `GET /models` running `opencode models`, a looparr server `GET /api/models` route merging that with the static list as fallback, and `fillModelSelect` fetching it — a host-executor change plus restart and a server route, all outside the public/-only scope. Static list kept manually in sync; verified 1:1 against `opencode models` today.
- [ ] Does looparr pull favicon for the project display? If not have it look for one and show that icon
- [ ] If detail on current and next task is too long being frozen takes up almost the whole page, have it collapsed/ only show three lines, if it’s more than three lines add a triangle or something that designates more and I can tap it to view more. The triangle or arrow would flip after clicking and clicking again hides it, this would be available for current and up next
- [ ] See if there is a way to freeze the add task textbox and button as I scroll to it, make it configurable if I want it to do this on the settings page
- [ ] Mobile looks good with layout, desktop things aren’t lining up and opening to the side, keep mobile but see if desktop can be fixed. If multiple steps are needed add to plan markdown at the end.
- [ ] Mark hide show completed per project persist after setting
- [x] Model list should include additional models. `auto/coding` is missing from the UI model picker but is available in the opencode CLI. Investigate how the picker builds its list and how the opencode CLI/model registry exposes `auto/coding` (and similar provider/model IDs), then add the missing entries so the UI matches what the CLI can run. See the existing model selector implementation and `For UI model picker, make drop down of available models from target AI provider if possible` for related work. Done: `MODEL_OPTIONS` in `public/app.js` extended to mirror `opencode models` exactly (13 entries; added `omniroute/auto` and `omniroute/auto/coding`; all 11 `opencode/*` entries already present).
- [ ] Model picker (global settings and per-project drawer) should support multi-select so more than one model can be chosen, not just a single dropdown value. On the main settings page and on the project-level dropdowns, allow selecting multiple models if possible; if multi-select is not feasible in the current UI/API shape, document that in plan markdown and describe the smallest change that would enable it (for example multiple `--model` fallbacks in the runner, or comma-separated values through `parseModel`). Documented as blocked (2026-11-21): `opencode run --model` takes a single string (`provider/model#variant`); repeated `--model` is not supported by the CLI, so a comma-separated value would pass `parseModel` (no whitespace, <=200 chars) but be passed to `opencode` as one invalid model id. Smallest enabling change: keep the single-string comma-separated value through `parseModel`, split on comma in `src/runners/opencode.js` `buildCommand` (or engine fallback loop over models on failure via the existing `isRateLimit` path), plus a multiple-select UI composing the comma string and an `index.html` change. Choice if enabled: applies uniformly to all model fields (global `model`/`seedModel`/`analyzeModel`/`implementModel` and per-project equivalents).
- [ ] Add GitHub button to project detail on home page and detail page, if a GitHub repo is linked. Add a whale icon to link to docker image repo if one is linked.
- [ ] Link GitHub repo, publish and tag as v1.0
- [ ] Publish docker container with multi arch testing similar to how we did Curatarr. Link docker container repo link to project so button appears
- [ ] When clicking project to show details keep icons and buttons in the same place, for example implement moves to the left side and it should stay in the same place so it’s not jumping
- [ ] Project detail model options should list all available models to pick from similar to main global settings this will allow override
- [x] Rate-limit UI visibility analysis: keep the existing auto-retry countdown, but change the primary `Start` button label while status is `rateLimited`. `Retry` is more accurate than `Resume` because a backoff timer is already pending; `src/engine.js` `start()` clears `rt.resumeAt` and calls `scheduleTick()`, so the existing POST `/api/projects/:id/start` already forces an immediate retry. No new endpoint is needed. A circular-arrow icon beside the status is compact but ambiguous on mobile and needs a tooltip plus `aria-label`. A separate centered `Retry` control duplicates the primary action and adds layout complexity. Best option: dynamic text on the existing button, optionally with a small `↻` glyph inside it, while keeping the countdown text. Update the helper line from `Waiting for rate limit window.` to say auto-retry is pending and the button retries immediately. Reuse the existing button rendering and disabled-state helpers in `public/app.js`; add a CSS rule only if icon spacing needs one. Do not add a separate retry route.
- [ ] Add a Plan prompt type for new projects. Seed still reads `plan.md` and writes the analysis prompt. Plan returns questions through `.looparr/next_prompt.txt`, waits for the user's answer, then writes a fully mapped-out `plan.md`. Only after the user confirms does the flow switch to Analyze, then Implement, for each task on that new list. Questions and design for this flow come first; record the answers in `.project_documents/` before editing code.

## New-project planning flow

- [ ] Add sprints or phases so one project can split by area, for example backend and frontend. Provide options to run sprints in parallel, run tasks inside a sprint in parallel, or both. Each task works in its own Git branch. Merge branches at the end of the sprint, then run an automated testing round before the sprint is complete. Questions and design for this flow come first; record the answers in `.project_documents/` before editing code.

## Sprint and phase parallelism

- [ ] Promotion workflow: promote to prod only after testing has completed. Run relevant test scripts and `npm test`, then `npm run restart:looparr -- --dry-run` and `npm run restart:looparr`. Verify container health, new image, container source hashes matching local source, served HTML/CSS/JS hashes matching local files, and `/api/state` before treating deployment as verified. Rate-limit false-positive fix promoted 2026-11-22 after `npm test`; container `b2c72c838f2c` healthy on image `68ca51074656`.
- [ ] Remove project count from top right of home page
