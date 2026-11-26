# Looparr self-management plan

## Production deploy verification — mandatory

Stale production assets have shipped three times. For every batch that changes source files, verify production before marking its plan item complete.

- Promote with the restart helper, never raw `docker compose`: `npm run restart:looparr -- --dry-run`, then `npm run restart:looparr`. It runs compose in the user systemd unit `looparr-promote`, outside the agent cgroup; raw compose is killed with the agent session between container create and start and leaves production down.
- Confirm container healthy and running on the new image.
- Confirm served HTML, CSS, and JS contain the new change.
- Confirm container files match local source timestamps or content.
- Only then mark the plan item complete and write the handoff.

## Hosted deployment baseline

- [x] Look at legibility for up next in div, vertical on home page but correct on detail page. On larger task verbiage it goes vertical. It is on a separate line in detail page (preferred)
- [x] Re-verify prior promotion-lock work: `node scripts/test-restart-watchdog.js`, `npm test`, `git diff --check`; map gaps in [PLAN-promotion-concurrency-lock](.project_documents/PLAN-promotion-concurrency-lock-see-plan-promotion-lock-md-project-documents-plan-pro.md).
- [ ] For terminal icon when clicked it is showing raw json, can you make it human readable like the CLI would show?
- [x] Convert `scripts/restart-lock.sh` contention from fail-fast to block-and-wait, preserving `LOOPARR_RESTART_LOCK_PATH`, `LOOPARR_RESTART_LOCK_HELD=1`, logging, and bounded timeout.
- [x] Watchdog timer mapped plan — see [PLAN-watchdog-timer.md](.project_documents/PLAN-watchdog-timer.md). Tasks:
  - [x] Add `timer` mode to `scripts/restart-watchdog.sh`: cycle counter file in `logs/`, exit-75 `busy:` log-only branch, failure `FAILED:` lines, every-5th-cycle read-only `review:` check (required for acceptance: an off stack must be recovered by the fix pass earlier in the same cycle)
  - [x] Add `systemd/looparr-watchdog.timer` + `systemd/looparr-watchdog.service` (5-min cadence, `Persistent=true`, repo-path placeholder)
  - [x] Add executable `scripts/install-watchdog-timer.sh` to install, `daemon-reload`, `enable --now`, and `enable-linger` the units (plus `--uninstall`)
  - [x] Add `scripts/test-watchdog-timer.js` static guards (units reference `restart-watchdog.sh`, Persistent, 5-min cadence, timer mode, exit-75 log-only, review check) and keep `npm test` green
  - [x] Verify: host drill per plan (recovery within one period, `review:` line, `busy:` quiet on held lock); record in `.project_documents/PROGRESS.md`
- [x] Run promotions outside the agent cgroup with `systemd-run --user --unit=looparr-promote` or a dedicated user service, so rate-limit backoff, SIGKILL, or cgroup cleanup cannot kill compose between container creation and start. Agents may still request promotions.
- [x] Durable resume snapshot — mapped plan: [PLAN-durable-resume-snapshot-see-plan-durable-resume-snapshot-md-project-documents-pl.md](.project_documents/PLAN-durable-resume-snapshot-see-plan-durable-resume-snapshot-md-project-documents-pl.md). Tasks: Done 2026-11-26 — snapshot, one-retry bound, and prior-step context implemented; `npm test` green; promoted via `scripts/promote.sh` (sandbox smoke, systemd `looparr-promote`) on image `sha256:8565265b…`, container `769c0f9d38bf` healthy; 81 container files and served assets matched local; watchdog clean.
  - [x] Baseline current snapshot capture, sanitize, restore, and degrade paths against 2026-11-24 incident scenario.
  - [x] Keep `autoResumeOnStart` gate and schema `version: 1` with optional `snapshot`; define one bounded retry constant.
  - [x] Capture error and idle-with-currentTask state with step bookkeeping, rotation cursor, session ids, and redacted prior output.
  - [x] Restore only after provenance, TTL, session, handoff, task-next, and plan-phase gates; preserve degrade rules.
  - [x] Auto-re-run restored error once; stop after one retry and preserve exhausted error state.
  - [x] Feed redacted prior `stepOutput` into the resumed step prompt once; clear it immediately after use.
  - [x] Extend `scripts/test-auto-resume.js` for incident drill, retry bound, behavioral context, degrade gates, and gate/schema regression.
  - [x] Run `npm test`, `node --check` on touched JS, and `git diff --check`.
  - [x] Verify production per mandatory deploy section before marking complete.
  - [x] Commit only `src/engine.js`, `src/auto-resume.js`, `src/config.js` if needed, and `scripts/test-auto-resume.js`.
- [x] Ensure `scripts/restart-looparr.js` holds the lock across full build and recreate in helper, systemd-run, and detached fallback paths.
- [x] Add small terminal icon next to the agent - model section of the card on project and detail views. Clicking it shows a live view of what is showing in agent terminal (pretty format) based off logs
- [x] Add healthcheck-healthy gating in `scripts/restart-looparr.js`; never report success on `running` without `healthy` in the start period.
- [x] Preserve Created/exited/dead recovery: one `docker compose start looparr`, polling, 60-line log tail, `CONTAINER_RECOVERY_FAILED`, no duplicate compose up.
- [x] Verify and update promotion wording in `README.md`, `src/config.js`, `src/engine.js`, and the implementation template for explicit engine/session-driven helper use.
- [x] Extend `scripts/test-restart-watchdog.js` and add docker-stub tests for blocking wait, health gate, recovery, one-start enforcement, and wording.
- [x] Run focused tests, `node --check` on touched JS, `npm test`, and `git diff --check`.
- [x] If prod rebuild is required, run dry-run then `npm run restart:looparr`; verify healthy/running new image, served HTML/CSS/JS, and container files match local source.
- [x] Mark these tasks `[x]` only after verification; write handoff and commit scoped files explicitly.
- [x] Add a setting global, and per project, pause in seconds, between tasks. Default is 0. Call it "Cooloff"
- [x] Model rotation toggle on every model dropdown: two curved arrows, lit green square when enabled, gray when disabled, tooltip "Model Rotation". Prompt: [PROMPT-model-rotation-toggle.md](.project_documents/PROMPT-model-rotation-toggle.md)

## Free runner candidates

- [x] Investigate which free terminal-based AI coding CLIs/agents with free tokens could be added as Looparr runners (beyond OpenCode and Freebuff), and after discovery decide whether the same per-dropdown rotation toggle should apply to those terminal apps/providers too. Findings: [INVESTIGATION-free-runner-options.md](.project_documents/INVESTIGATION-free-runner-options.md)
- [x] Check for additional 429 error messages the rate-limit parser misses. Example encountered in a log that was not pulled: `SessionError: [429]: Tokens per minute limit exceeded - too many tokens processed. (reset after 1m)`. Widen the `RATE_LIMIT_PATTERN` in `src/runners/opencode.js` so bracketed `[429]` and tokens-per-minute phrasing both match. Done 2026-11-23: pattern now matches `[429]:`, `429: tokens per minute`, and `tokens per minute limit exceeded/reached`; test `scripts/test-rate-limit-detection.js` extended with 3 new true positives and 3 new false-positive prose guards; `npm test` passes.
- [x] The previously worked task "Hide completed should be the default task", appeared to launch another session when looparr prod was restarted, verify and correct.
- [x] When a task finishes it is marking the plan completed too early and looparr shows the project current item as “idle press start" verbiage instead of task it is working on. It does show when it moves to the next task though, but not while it is wrapping up the previous since it was marked too early. Does the implement prompt need to be updated?
- [x] Hide completed should be the default, last UI state of all settings should be remembered per project. Anything empty should be collapse like questions when there are none
- [x] Mobile view only shows four icons across per task should be all
- [x] Seed prompts injecting entire plan markdown ballooning context. See if just filePath to plan is sufficient to pass context
- [x] Add the Kilo Gateway free lane to the model picker through OpenCode (no new runner): provider `kilo` with `baseURL api.kilo.ai/api/gateway`, keyless, models from `kilo-auto/free` and the `:free` catalogue; verify a real run on prod. Repo-root `opencode.json` declares the provider; 12 free ids added to `MODEL_OPTIONS`. Verified 2026-11-22: host-executor `/run` with `kilo/kilo-auto/free` returned `ok` (exit 0) through the Looparr server path; gateway catalogue exposes 443 models, 12 tagged free.
- [x] Harden the provider setup so the free lane survives a fresh host: the host executor seeds the keyless `kilo` provider into `opencode.json` before starting OpenCode, owns its own `opencode serve` instead of reusing a foreign one, and reports the result in `GET /health`. Verified 2026-11-22 by restarting the live executor (it skipped the pre-existing `--service` listener on 4096, served from 4097 at the repo root) and a real `kilo/kilo-auto/free` run on port 4187 returned `ok` with exit 0.

## Bootstrap batch

- [x] Add a `runner` field on the host-executor `/run` payload and a Kilo CLI runner (`kilo run --auto --format json --model provider/model`, prompt positional, `--file` repeatable, `-p` is `--password`). Per-project and global runner selection already existed in config, API, UI, and engine, so only the payload and runner were missing. Verified 2026-11-22 by `scripts/test-runner-payload.js` (registry, both bridge payloads, Kilo argument building, validation) and a live `POST /run` with `runner: "kilo"` that exited 0, routed keyless to `baidu/ernie-5.5-flash-preview:free` at cost 0 with no login.
- [x] Scope model ids per runner so the shared pickers cannot send a `kilo/*` id to OpenCode or an `opencode/*` id to the Kilo CLI; only then is rotation safe across two providers. Implemented 2026-11-22: each runner exports a `models` catalogue, `/api/state` serves it, both picker groups filter by the selected runner and rebuild when it changes, and the engine drops ids claimed by another runner while logging `Skipped model ids not valid for <runner>`. Unclaimed custom/BYOK ids still pass. `kilo/*` stays valid for OpenCode because the repo-root `opencode.json` declares the keyless provider.
- [x] Probe Qoder CLI headless under no TTY with a free account (`qoder -p`, `--permission-mode auto`) and decide whether to build a runner. Probed 2026-11-22 with `qodercli 1.1.95` installed from `@qoder-ai/qodercli`: the headless flags exist (`-p`, `--permission-mode auto`, `-o json`) but every run stops at `Not logged in · Please run /login`, and `qodercli login` has no token or API-key option. Re-probed 2026-11-22 after the account was signed in: `qodercli whoami` succeeds, but `qodercli --list-models` prints `Warning: no models available for your account.` and every `-p` run exits 1 with `inference.remoteChat.stream failed (403)` pointing at `https://qoder.com/pricing`. Decision: no runner; the block is Qoder plan entitlement, not auth. Revisit only if the account gains a paid or trial plan.
- [x] Probe Mistral Vibe free-plan headless (`vibe -p --auto-approve --max-price 0`) and confirm the free CLI budget before building anything. Probed 2026-11-22 with `mistral-vibe 3.1.4` from PyPI: programmatic mode starts, but the run exits 1 with `Missing MISTRAL_API_KEY environment variable for mistral provider`, and the only setup path is interactive `vibe --setup` (system keyring). Re-probed 2026-11-22 after `vibe --setup` stored the key: `vibe -p "Reply with the single word ok." --max-price 0 --output json` exited 0 with `ok`, and an auto-approve run appended its line to `plan.md` correctly. A streaming run (`--output streaming --output-dir`) emitted parseable NDJSON and `export.json` reported `outcome: finished`, `cost_usd: 0`, 19,038 tokens. Decision: viable second runner; build it next.
- [x] Build a Mistral Vibe runner: `vibe --prompt <prompt> --auto-approve --output streaming --max-price 0`, runner id `vibe` through the host executor, model blank by default because Vibe takes account aliases. Vibe has no attachment flag, so `src/vibe-command.js` names the seed files in the prompt for the agent to read from the working directory. Verified 2026-11-22 by `scripts/test-runner-payload.js` and a live `POST /run` with `runner: "vibe"` that streamed Vibe JSON events and exited 0 with assistant text `ok` in 8.6 seconds; prod serves it after the rebuild.

## Next batch

- [x] Populate the Vibe model picker with the account's free-lane aliases instead of leaving it blank only. Implemented 2026-11-23: the free plan exposes one free catalogue entry, `zai-glm-5-3-flash-vibe-free`, with the published alias `zai-glm-5-3-flash`; both were probed headless at `--max-price 0` and returned `ok` with `cost_usd: 0` and `outcome: finished` (`export.json` `active_model: zai-glm-5-3-flash-vibe-free`). Paid ids that require `higher_plan` stay out of the catalogue. `src/runners/vibe.js` and `MODEL_OPTIONS_BY_RUNNER` in `public/app.js` carry the two ids, `scripts/test-runner-payload.js` covers them plus the cross-runner refusal. Production rebuilt 2026-11-23 on image `sha256:a75d1c65c79e`, healthy, served `public/app.js` hash `265644bea270` matches local, and prod `/api/state` reports `vibe:2` with both ids.
- [x] Rule out Antigravity CLI as a runner: free tier is real, but Google's terms forbid wrapping `agy` inside third-party agents on consumer plans and headless requires a cached interactive login. Revisit only via ACP or a documented third-party path.
- [x] Remove project count from top right of home page. Implemented 2026-11-23: removed host-projects count from home header (pre-existing local UI edits in `public/index.html`, `public/app.js`, `README.md`). Restart-safety fix: `scripts/restart-looparr.js` no longer calls `/api/auto-resume/prepare`; dry-run makes zero API writes and zero Docker calls; real restart writes `.looparr/restart-continue.json` before Docker and removes it on Docker failure. `src/engine.js` consumes marker in `startStep()` and injects through `promptPreamble()` for resumed non-seed phases, deleting marker after successful read. `docker-compose.yml` bind-mounts `./.looparr:/app/.looparr:rw` so container can consume host marker. Live verified 2026-11-23 on port 4188: dry-run left state unchanged with no prepare/Docker/marker; real restart healthy on new image `sha256:31bed8768f50f4de50141cd0fe499a172e5b6527c1fcd24a93bca3a8806e5051` (container `133b9ac83de740747e0867581b453e1924bf01bffd38aaeb84c16809365a8462`), marker consumed, one active executor (`runKey 5e3e8abfd4f836cbc683b7396c3a6f11`), resumed prompt contained `Restart complete continue.`; served HTML `6b0840afd3e01dd477be28dc7c7771ba2a06587c60a32d256135a410064b9874`, app.js `8d114dcd2ffe82955742c18adb7b00ec4cacf01fe4b637e7a1e9a7b331eb0773`, styles.css `5b4ce9cbbdc6c63e4aeca9e433f854889b72572fc397ea71a7522815c523673b` match local; `/api/state` returns projects and settings.

## Next after

- [x] True same-session resume after Looparr container restart (phase 2). Implemented 2026-11-23: OpenCode CLI v2.3.2 contract verified from `run --help`, `session list --format json --standalone`, and `--format json` JSON lines. Capture uses top-level `sessionID`; resume uses explicit `--session <id>` only after cwd-scoped existence check. Intent field `opencodeSessionId` is optional; old intents mean fresh run. Missing, invalid, foreign-cwd, stale, or nonexistent IDs fall back fresh; dedupe/runKey/opt-in/handoff/task-mismatch/Stop behavior preserved. Host executor exposes captured ID in `/active` and emits a short resume/fallback frame without raw invalid IDs. Focused verification: `node scripts/test-opencode-session.js`, `node scripts/test-runner-payload.js`, `node scripts/test-host-executor-run-key.js`, full `npm test`, `node --check` on touched JS, and `git diff --check` (results in `.project_documents/PROGRESS.md`). Production deploy verification completed 2026-11-23 with explicit approval: rebuilt/recreated on image `sha256:960d9f75a32f745e3f13faa3cf5248d85b95371fcdc105feeec5a4f6905e5265`, healthy, served HTML/CSS/JS/icon hashes matched local, and `/api/state` returned projects and settings.
- [x] Add container and Tailscale Serve deployment files

## iOS home-screen batch

- [x] Add host-side OpenCode execution bridge

## Touch icon fill batch

- [x] Verify local API, SSE, bridge health, Serve, and Funnel status

## Touch icon fit batch

- [x] Commit hosted deployment changes locally

## Touch icon fit follow-up batch

- [x] Keep host executor running for hosted task execution

## Touch icon scale 1.5 batch

- [x] Keep Funnel disabled

## Touch icon scale 1.3 batch

- [x] Create plan.md and initial handoff from deployment docs

## Touch icon confirmation

- [x] Register Looparr repository as a managed project

## Plan setup guidance batch

- [x] Harden project watcher against unreadable state directories

## Drawer activity and logs batch

- [x] Re-verify hosted deployment after project registration and record current status

## Hosted add-project documentation batch

- [x] Audit the existing dashboard UI for project setup and hosted status gaps

## Headless handoff documentation batch

- [x] Implement the needed UI changes in `public/`

## Constraint block discovery list

- [x] Verify the UI through local HTTP and update `.project_documents/PROGRESS.md`
- [x] Propose UI grouping: sidebar navigation versus all-on-one-page layout. Review Splitarr or Curatarr for patterns, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.
- [x] Propose iOS web-app icon support: favicon plus Apple touch icon and meta tags for saving to the iOS home screen. Review Splitarr or Curatarr for clues, then record the recommendation in project markdown. Recommendation in `.project_documents/RESEARCH-ui-ux.md`.
- [x] Add 180x180 opaque RGB `public/apple-touch-icon.png` and iOS home-screen meta tags to `public/index.html`.

### Current discovered block

- User lifted the `src/engine.js` and `public/app.js` constraints for this session on 2026-11-21. The lift lasts until the user says stop. Repeated-block threshold: ask after 2 blocks. Permanent lift not granted.
- Original block: `src/engine.js` must remain untouched. It blocked full headless prompt/answer round-trip implementation and the editable prompt template/settings panel. `public/app.js` was also listed as pre-existing uncommitted work.

## E2E UI batch

- [x] Scale `public/apple-touch-icon.png` edge to edge, keep opaque RGB format, and verify served hash.
- [x] Reduce the touch icon artwork scale from 2.2 to 2.0 to address user-reported home-screen crop, keep full-bleed opaque RGB background, and verify served hash.
- [x] Reduce the touch icon artwork scale from 2.0 to 1.8 after user feedback, keep full-bleed opaque RGB background, and verify served hash.
- [x] Reduce the touch icon artwork scale from 1.8 to 1.5 after user feedback, keep full-bleed opaque RGB background, and verify served hash.
- [x] Reduce the touch icon artwork scale from 1.5 to 1.3 after user feedback, keep full-bleed opaque RGB background, and verify served hash.
- [x] User confirmed the scale 1.3 icon is correct; icon work is complete.
- [x] Add drawer guidance for creating a valid `plan.md` from the browser without backend changes.
- [x] Improve the project drawer with labeled current/up-next task text, log status, empty state, and jump-to-latest control without backend changes.
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

## New-project planning flow

- [x] For UI model picker, make drop down of available models from target AI provider if possible. Documented as blocked (2026-11-21): the container image has no `opencode` binary, so the looparr server cannot enumerate models itself; dynamic population would need the host executor (external host process, has `opencodeBin`) to expose `GET /models` running `opencode models`, a looparr server `GET /api/models` route merging that with the static list as fallback, and `fillModelSelect` fetching it — a host-executor change plus restart and a server route, all outside the public/-only scope. Static list kept manually in sync; verified 1:1 against `opencode models` today.

## Sprint and phase parallelism

- [x] Does looparr pull favicon for the project display? If not have it look for one and show that icon
- [x] If detail on current and next task is too long, have it collapsed/ only show three lines, if it’s more than three lines add a triangle or something that designates more and I can tap it to view more. The triangle or arrow would flip after clicking and clicking again hides it, this would be available for current and up next. Remember state so navigate away and back doesn’t reset. Default is collapsed
- [x] See if there is a way to freeze the add task textbox and button as I scroll to it, make it configurable if I want it to do this on the settings page
- [x] Mobile looks good with layout, desktop things aren’t lining up and opening to the side, keep mobile but see if desktop can be fixed. If multiple steps are needed add to plan markdown at the end.
- [x] Mark hide show completed per project persist after setting
- [x] Implement should include directive in prompt to commit to git if tracked updated files, exclude files with secrets tokens or passwords.
- [x] When clicking project to show details keep icons and buttons in the same place, for example implement moves to the left side and it should stay in the same place so it’s not jumping. Done 2026-11-23: task controls now use a fixed left rail; toolbar and status reserve no longer shift; drawer body keeps a stable scrollbar gutter.
- [x] Model picker (global settings and per-project drawer) supports multi-select. Implemented 2026-11-22: all four global and all four per-project model fields accept one model or an ordered comma-separated fallback list. All 12 selectors use native multi-select; shared parsing persists canonical strings; engine falls back on rate limit with the same task, phase, and run key; one model id reaches each local or bridge `opencode` run. Previously blocked (2026-11-21): `opencode run --model` takes one string (`provider/model#variant`); repeated `--model` is unsupported, so a comma string would pass `parseModel` but reach `opencode` as one invalid id. Historical smallest enabling change: keep the single comma string through `parseModel`, add engine fallback over models on `isRateLimit`, and add a multi-select UI plus `index.html` change. Applies uniformly to all model fields (global `model`/`seedModel`/`analyzeModel`/`implementModel` and per-project equivalents). Done 2026-11-23: re-verified against working tree — model-list engine fallback, 12 native multi-selects, one --model per opencode run, and prod asset/container hashes all confirmed; checkbox was stale.
- [x] (plan) Plan prompt type — see [PLAN-plan-prompt-type.md](.project_documents/PLAN-plan-prompt-type.md)
- [x] Verify `src/log-store.js` against [PLAN-log-files-with-size-rotation.md](.project_documents/PLAN-log-files-with-size-rotation.md): NDJSON lines, per-project 10 MiB rotation with timestamp and collision suffixes, mode `0o600`, newest-file hydration, throttled mtime prune, one-time error reporting. Done 2026-11-23: all seven requirements confirmed present in `src/log-store.js`.
- [x] Verify `src/engine.js` wiring: hydrate `rt.logs` and `logSeq` in `ensureRuntime`, append in `appendLog`, prune in `init` and `tick`, `closeAll` on shutdown, with no API or SSE change. Done 2026-11-23: wiring confirmed at engine.js:11, :94, :210, :1496, :1887, :1902; getState and SSE bus unchanged.
- [x] Verify `scripts/test-log-store.js` covers all seven cases and runs through the `test` script in `package.json`. Done 2026-11-23: seven-case suite passes via `node scripts/test-log-store.js`; `package.json` test script includes it.
- [x] Verify `.gitignore` ignores `data/logs/` and that `data/*` coverage remains intact. Done 2026-11-23: `.gitignore` line 13 ignores `data/logs/`; `data/*` and `!data/.gitkeep` intact.
- [x] Run `npm test` and `git diff --check`. Done 2026-11-23: full `npm test` suite passes and `git diff --check` is clean.
- [x] Stage only the log-rotation files: `.gitignore`, `package.json`, `src/log-store.js`, `scripts/test-log-store.js`, and the log-store hunks in `src/engine.js`; leave other tasks' work unstaged. Done 2026-11-23: staged the five paths plus only the six log-store hunks in `src/engine.js`; opencode-session hunks left unstaged.

- [x] Commit the staged log-rotation implementation with a scoped message. Done 2026-11-23: committed as `feat(logs): per-project NDJSON log store with 10 MiB rotation`.
- [x] Record deferred container verification (build, forced rotation, restart, seeded prune) for a separate batch and mark this checklist complete. Done 2026-11-23: recorded for a separate batch; container build, forced 10 MiB rotation, restart hydration, seeded prune, and hash comparison are not done in this batch.
- [x] Task link checkbox: widen the plan-file prefix list (renderer + server) to PLAN/plan/PROMPT/ANALYSIS/RESEARCH/INVESTIGATION/HANDOFF/PROGRESS in `public/app.js` `normalizePlanFilePath` and `linkPlanReferences`, and `server.js` `PLAN_FILE_BASENAME`. See `.project_documents/PLAN-task-link-checkbox-2.md` steps 1. Verify: linkified `plan-file-ref` buttons for existing non-PLAN docs; padded prefix lists match textually. Done 2026-11-23: confirmed `PLAN_FILE_PREFIXES` is the single shared constant at `public/app.js:165` and `server.js:23`; `normalizePlanFilePath`, the `linkPlanReferences` alternation, and `PLAN_FILE_BASENAME` all interpolate it. Focused suites and full `npm test` pass; `git diff --check` clean.
- [x] Task link checkbox: add "Link doc" checkbox and optional prefix/filename input to `.task-add-row` (`public/index.html` ~521), default unchecked on first visit, state persisted in `localStorage['looparr.taskLinkDoc']`; input visibility toggles with the checkbox; row wraps at 320px. Done 2026-11-23: markup in `.task-add-row` (`public/index.html:523-527`), helpers and linked-doc branch in `public/app.js`, persistence via `loadTaskLinkDocState`/`saveTaskLinkDocState` with try/catch in-memory fallback, `#task-doc-file` shrinkable via `flex: 0 1 160px; min-width: 0`; full `npm test` pass; `Handoff clean`.
- [x] Task link checkbox: add `buildTaskSlug` / `resolveLinkedDocName` / `formatLinkedTask` helpers in `public/app.js` per `.project_documents/PLAN-task-link-checkbox-2.md`: strip leading `(plan)`, NFKD kebab slug ≤60 chars, client-validated filename, em-dash linked text.
- [x] Task link checkbox: wire stub creation into `addChecklistTask` (`public/app.js` ~2147): GET existence check → PUT `# <title>` stub → compose linked task → save; user-typed existing filename reused unchanged, auto-derived collision buffered with -2/-3, PUT failure aborts with a status message and no plan write (never a dead link). Done 2026-11-24: verified GET-then-PUT stub creation with `# <title>`, verbatim override reuse, `-2`/`-3` auto-collision buffering, and abort-with-status before plan write on PUT failure; helper/UI suites, full `npm test`, and `git diff --check` pass.
- [x] Task link checkbox: tests and sign-off — covered slug/prefix/collision/no-overwrite/abort cases in `scripts/test-plan-helpers.js` and `scripts/test-plan-ui-controls.js`; `npm test` and `git diff --check` clean; commit only the file-map paths. Done 2026-11-24: added the success-path and unchecked-path `addChecklistTask` tests, the live-server `/plan-file` prefix gate test, and a real `linkPlanReferences` rendering test; focused suites and `git diff --check` pass, and full `npm test` passes at HEAD (the working-tree failure is the unrelated in-progress `scripts/test-auto-resume.js`).

## Paseo spawned-agent transport batch

Opt-in Paseo transport so spawned agent CLI sessions (mobile session visibility via the Paseo daemon) back Looparr runs, with direct CLI calls as the unchanged default. Build in the numbered order; each PLAN doc carries its own verification steps.

- [x] (plan) Runner rotation — see [PLAN-runner-rotation.md](.project_documents/PLAN-runner-rotation.md). Done 2026-11-23: runner fields accept ordered lists with a global/per-project `runnerRotation` flag, the engine picks the runner per step and filters models for it, and cursors/cooldowns persist in `data/rotation-state.json`.
- [x] (plan) Provider-error fallback and persisted rotation — see [PLAN-provider-error-fallback.md](.project_documents/PLAN-provider-error-fallback.md). Done 2026-11-23: a 400/5xx/timeout advances to the next model or runner once per step, auth/billing errors stop immediately, rotation cursors survive restarts, and the card shows the active runner and model.
- [x] (plan) OmniRoute coding-safe combo — see [PLAN-omniroute-combo.md](.project_documents/PLAN-omniroute-combo.md). Done 2026-11-23: `coding-safe` (priority: agnes 3.0 → agnes 2.5) is live in the gateway, OpenCode's provider lists it, and `omniroute/coding-safe` is selectable in every model picker; `opencode run` against it returns OK.
- [x] Add sprints or phases so one project can split by area, for example backend and frontend. Provide options to run sprints in parallel, run tasks inside a sprint in parallel, or both. Add options on task cards to merge previous branches, and a merge to main/prod deploy option. This way it could be injected into the implement task. Grayed out if task already started. Each task works in its own Git branch. Merge branches at the end of the sprint, then run an automated testing round before the sprint is complete as a new task type ‘[Type] Validation, I.e. if I picked sprint Sprint Validation, or have some suggestions of types like sprint backend front end etc to choose from. Questions and design for this flow come first; record the answers in `.project_documents/` before editing code.
- [x] Verify / Update Promotion workflow: promote to prod only after testing has completed. Run relevant test scripts and `npm test`, then `npm run restart:looparr -- --dry-run` and `npm run restart:looparr`. Verify container health, new image, container source hashes matching local source, served HTML/CSS/JS hashes matching local files, and `/api/state` before treating deployment as verified. Rate-limit false-positive fix promoted 2026-11-22 after `npm test`; container `b2c72c838f2c` healthy on image `68ca51074656`. Done 2026-11-25: `npm test` green and `git diff --check` clean, dry-run clean, `npm run restart:looparr` recreated `looparr` on image `0fe7691c3fb3` (container `92b20acf9145`, healthy), all 75 container source hashes matched local, served `/`, `/styles.css`, `/app.js`, `/favicon.svg` matched local `public/`, `/api/state` had `projects` and `settings`, `npm run watchdog:check` clean; canonical sequence in `.project_documents/PROMOTION.md`.

## Durable resume and self-healing batch

- [x] Investigate desktop layout, div not going wide on project card, awkward placement of sidebar and detail just goes to the right side instead of overlay like mobile.
- [ ] (plan 01) Paseo transport setting — see [PLAN-01-paseo-transport-setting.md](.project_documents/PLAN-01-paseo-transport-setting.md): add opt-in global `paseoTransport` setting (default false) plus settings-UI checkbox near `globalRunner`; validate in `PATCH /api/settings`.
- [ ] (plan 02) Paseo run adapter — see [PLAN-02-paseo-run-adapter.md](.project_documents/PLAN-02-paseo-run-adapter.md): new `src/paseo-transport.js` adapter (spawn Paseo agent, stream output, wait, stop on cancel) integrated into the engine and self-heal spawn paths.

## Desktop layout and drawer batch

- [ ] (plan 03) OpenCode through Paseo — see [PLAN-03-opencode-paseo-wiring.md](.project_documents/PLAN-03-opencode-paseo-wiring.md): map the `opencode` runner to Paseo's built-in provider, strip Looparr model-id namespace, fall back to Paseo default model.
- [ ] (plan 04) Vibe and Kilo through Paseo — see [PLAN-04-vibe-kilo-paseo-wiring.md](.project_documents/PLAN-04-vibe-kilo-paseo-wiring.md): map `vibe` → `mistral-vibe` and `kilo` Paseo providers; fresh-agent scope first.
- [ ] (plan 05) Verification, rollback, rollout — see [PLAN-05-verification-and-rollout.md](.project_documents/PLAN-05-verification-and-rollout.md): focused tests from 01-04, direct mode regression with `paseoTransport=false`, Paseo mode with `true`, production deploy verification per lines 3-11, rollback path.
- [x] (plan) Handoff recovery sweep — see [PLAN-handoff-recovery-sweep.md](.project_documents/PLAN-handoff-recovery-sweep.md). Done 2026-11-24: opt-in `handoffRecovery` sweeps every 15s, un-sticking errored analyze/implement projects only on a provenance-matched, non-meta handoff, and stands down for waiting states and active OpenCode sessions with a throttled `handoff-recovery-waiting` audit; `npm test` and `git diff --check` clean.
- [x] (plan) Self-healing debugging mode — see [PLAN-self-healing.md](.project_documents/PLAN-self-healing.md). Done 2026-11-24: dev-signalled `selfHealing` runs one worktree-isolated healer round, validates the branch with two preview cycles, reports Debugging/Healing/Healed/Error in the header pill, and merges locally only (no push); `SELFHEALING.md`, `scripts/test-self-heal.js`, `npm test`, and `git diff --check` clean.
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
- [ ] I don't need to know the access route (card on project table). Make this a setting on the settings tab to show the card, and then turn it off
- [ ] I don't need to know all settings are done in a card, if there are settings that need to be done put a badge in the upper right of the gear icon for settings with a count of how many items need to be completed instead.
- [ ] Fill the space of the selected runners/models on the project page bottom card so it is same width as project card and fills the area.
- [ ] Make watchdog recovery immediate: run `npm run watchdog:fix` after promotions or in the helper completion path, and shorten `looparr-watchdog.timer` so a `Created` container is started quickly. Keep `watchdog:check` read-only.
- [ ] Future session — healer fix prod visibility: make a reviewed healer fix visibly accounted for on prod. Current state: master `4f5e761`, manual cherry-pick of healer `2705d24`. Branch icon hidden because no fresh `data/selfheal/` status exists; read `.project_documents/PROMOTION.md` healer section, `src/selfheal-status.js`, `public/app.js`, `src/engine.js`. Implement a safe, human-gated record/command without hand-editing status files or pushing. Do not fake `healed`. Sandbox-first workflow; compact output; covering tests; `git diff --check`; commit current branch only; never push; stop after one round.
- [ ] Publish docker container with multi arch testing similar to how we did Curatarr. Link docker container repo link to project so button appears
- [ ] Add GitHub button to project detail on home page and detail page, if a GitHub repo is linked. Add a whale icon to link to docker image repo if one is linked.
- [ ] Link GitHub repo, push to origin with tag as v1.0
