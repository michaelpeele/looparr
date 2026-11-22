# looparr deployment progress

Date: 2026-11-21

## Scope

Host the existing Looparr dashboard at `https://looparr.tail0307d.ts.net/` using the same Tailscale sidecar pattern as Curatarr and Splitarr.

Confirmed decisions:

- Tailnet-only Serve now; no Funnel until explicitly approved.
- AI execution stays on the host; no `opencode` binary or auth in the app image.
- Mount `/home/michaelpeele/ai-projects` read-write at the same absolute path.
- Local git only, branch `master`, no remote, no push.
- Do not publish `TS_AUTHKEY`.

## Implementation summary

- Added `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `serve.json`, `.env.example`.
- Added host executor at `scripts/host-executor.js` and bridge client at `scripts/bridge-client.js`.
- Added `executor` npm script.
- Added `CONFIG_PATH` override in `src/config.js`; app config persists at `/app/data/config.json`.
- Added bridge mode to `src/runners/opencode.js`; local runner behavior unchanged when `LOOPARR_EXECUTOR_URL` is unset.
- Added `AGENTS.md` pointer to `../workflow.md`.
- Updated `README.md` with hosted setup, persistence, mount details, bridge setup, verification, and future Funnel warning.
- Added `.project_documents/RESEARCH-deployment.md`.

## Verification results

### Static and build checks

- `docker compose config --quiet`: passed.
- `docker compose build`: passed.
- Final image `looparr:latest` includes `scripts/bridge-client.js`.

### Isolated smoke tests

- Ran `looparr-smoke` without Tailscale on host port `4189`.
- `curl -fsS http://127.0.0.1:4189/api/state`: returned default settings and `projects: []`.
- SSE check on `http://127.0.0.1:4189/api/events`:
  - `HTTP/1.1 200 OK`
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `retry: 3000`
  - initial `event: state` with JSON data
- Fake-binary host bridge smoke on Docker gateway port `4190`: `/health` OK; `/run` streamed fake stdout/stderr and exited 0.
- Container bridge smoke `looparr-smoke-bridge` on host port `4191` with host-gateway access: bridge client streamed fake stdout/stderr and exited 0.
- Smoke containers and smoke executor were removed.

### Production checks

- Stack after promotion:
  - `looparr`: Up, healthy.
  - `ts-looparr`: Up.
  - Host port mapping: `0.0.0.0:4188->3000/tcp`.
- App and sidecar share network namespace: both report `net:[4026534676]`.
- `curl -fsS http://127.0.0.1:4188/api/state`: returned bridge runner description `Host-side opencode executor via HTTP bridge; fresh opencode run per step.`
- Local SSE check on `http://127.0.0.1:4188/api/events`:
  - `HTTP/2 200` through proxy / `HTTP/1.1 200 OK` direct.
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `retry: 3000`
  - initial `event: state` with JSON data
  - `curl` timeout after 3s is expected for an open SSE stream.
- Host executor health on Docker gateway port `4187`:
  - `{"ok":true,"projectsRoot":"/home/michaelpeele/ai-projects","opencodeBin":"/home/michaelpeele/.opencode/bin/opencode"}`
- `docker exec ts-looparr tailscale serve status`:
  - `https://looparr.tail0307d.ts.net (tailnet only)`
  - `|-- / proxy http://127.0.0.1:3000`
- `docker exec ts-looparr tailscale funnel status`: no Funnel for looparr; output matches Serve status and shows `(tailnet only)`.
- `tailscale status` shows peer `looparr` at `100.64.214.29`.
- `dig +short looparr.tail0307d.ts.net @100.100.100.100`: `100.64.214.29`.
- Plain host `curl -fsS https://looparr.tail0307d.ts.net/` failed with `Could not resolve host` because local host resolution had not picked up the new MagicDNS record. Direct verification with explicit resolution succeeded:
  - `curl -fsS --resolve looparr.tail0307d.ts.net:443:100.64.214.29 https://looparr.tail0307d.ts.net/`: HTML with `<title>looparr</title>`.
  - `curl -fsS --resolve ... /api/state`: expected JSON.
  - SSE through TLS proxy with explicit resolution: expected headers, `retry: 3000`, and initial `event: state`.

### UI batch checks

- `node --check public/app.js`: passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, recreated `looparr`, and started it healthy.
- `curl -fsS http://127.0.0.1:4188/api/state`: returned settings, OpenCode bridge runner, and managed project state.
- `curl -fsS http://127.0.0.1:4188/`: served updated HTML with `host-strip` and `Server-side project directory`.
- `curl -fsS http://127.0.0.1:4188/app.js`: served updated JS with `Setup Needed`, `isPlanSetup`, `hostRunner`, and `projectPathSuggestions`.
- `curl -fsS http://127.0.0.1:4188/styles.css`: served updated CSS with `.host-strip` and `.badge.setup`.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` and `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: no Funnel; output shows `(tailnet only)`.

### Documentation proposal batch checks

- Read `plan.md` and `.looparr/next_prompt.txt`; selected the two proposal items as one documentation batch.
- Reviewed Splitarr and Curatarr navigation and icon patterns; recorded both recommendations in `.project_documents/RESEARCH-ui-ux.md`.
- `git diff --check`: passed.
- `node --check public/app.js`: passed (no JS changed in this batch; regression check only).
- `curl -fsS http://127.0.0.1:4188/api/state`: returned settings, bridge runner, and managed project state.
- `grep -n '^- \[ \]' plan.md`: no remaining unchecked items.
- No static asset or container change; no rebuild, Serve, or Funnel recheck needed for this batch.

### iOS home-screen batch checks

- Rendered the existing favicon artwork at 180x180 using headless Chromium with an `#0d1421` background; output reported `19090 bytes written`.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)` confirms no alpha channel.
- Pixel sample: corners `(0,0)`, `(179,0)`, `(0,179)`, `(179,179)` each `(13,20,33)` = `#0d1421`; center `(90,90)` = `(128,140,247)`.
- `git diff --check`: passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: returned settings, bridge runner, and managed project `d76e436a-8816-4342-9511-b4706e2320e4` as idle.
- `curl -fsS http://127.0.0.1:4188/ | grep -E 'apple-touch-icon|apple-mobile-web-app|theme-color'`: served all five new head tags.
- `curl -fsS http://127.0.0.1:4188/app.js`: `200 application/javascript; charset=UTF-8 22548`.
- `curl -fsS http://127.0.0.1:4188/styles.css`: `200 text/css; charset=UTF-8 11926`.
- Served `GET /apple-touch-icon.png` sha256 `e29cba36f84e380a5f6d2cd628217f6a28449338d2487054db3b80d9885f86e5` matched `public/apple-touch-icon.png`.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` and `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: no Funnel configured; output shows `(tailnet only)`.

### Touch icon fill batch checks

- Selected the smallest useful batch from the handoff: fill the home-screen tile edge to edge.
- Replaced `public/apple-touch-icon.png` with a scale-2.2 render of the favicon artwork on `#0d1421`; the dark rect no longer has rounded corners. `public/index.html` head tags unchanged.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)`.
- Pixel sample via headless Chromium canvas: size `[180,180]`; corners `[15,22,35]`, `[19,32,46]`, `[19,32,50]`, `[15,22,35]`; `edgeNonBg` `447`, `white` `0`, center `[129,140,248]`. No white space or transparent pixels.
- Local sha256 `e9184a69fde1dc89ae19b098faae3109ede4ca21e77713c7fb9b3531196ac370`.
- `node --check public/app.js` passed; `git diff --check` passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: returned settings, bridge runner, and managed project `d76e436a-8816-4342-9511-b4706e2320e4` as idle with progress `16/16`.
- GET `/`, `/app.js`, and `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- Served `GET /apple-touch-icon.png` sha256 `e9184a69fde1dc89ae19b098faae3109ede4ca21e77713c7fb9b3531196ac370` matched `public/apple-touch-icon.png`.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: same tailnet-only config; no public Funnel route. JSON status had no `Funnel` key.

### Touch icon fit batch checks

- User reported the edge-to-edge icon was cropped by about 10% when saved to the Apple home screen. Asked for a slightly smaller mark.
- Regenerated the favicon artwork at scale 2.0 instead of 2.2 on full-bleed `#0d1421`; the dark background still reaches all edges. `public/index.html` head tags unchanged.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)`.
- Pixel check: size `[180,180]`; corners `[13,20,33]`, `[13,20,34]`, `[13,20,34]`, `[13,20,33]`; `edgeNonBg` `343` (was `447` at scale 2.2); `white` `0`; center `[129,140,248]`.
- Local and served sha256 both `a64a2be5e7eee02e8c335a2ba17b2b26f0736edb100562fce7937408baeec50c`.
- `node --check public/app.js` passed; `git diff --check` passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: managed project `d76e436a-8816-4342-9511-b4706e2320e4` idle with progress `17/17`.
- GET `/`, `/app.js`, and `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: same tailnet-only config; no public Funnel route.

### Touch icon fit follow-up batch checks

- User said the icon was getting there and asked to drop the artwork scale to 1.8.
- Regenerated the favicon artwork at scale 1.8 instead of 2.0 on full-bleed `#0d1421`; the dark background still reaches all edges. `public/index.html` head tags unchanged.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)`.
- Pixel check: size `[180,180]`; corners `[13,20,33]`, `[13,20,33]`, `[13,20,33]`, `[13,20,33]`; `edgeNonBg` `261` (was `343` at scale 2.0); `white` `0`; center `[129,141,248]`. Bright outer-band pixels `2849` (was `3336`); bright bounding box `[0,18,179,161]` (was `[0,10,179,169]`). No white space or transparent pixels.
- Local and served sha256 both `5736f9c84e8df58e9e33b22a9f24906398137ee7d3d5494fdf4bec824fa7718f`.
- `node --check public/app.js` passed; `git diff --check` passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up. Manifest `sha256:5ce8be507d2dd1386215cd0737363b57050e486b33c023b069db102d1a4ea4b8`.
- `curl -fsS http://127.0.0.1:4188/api/state`: managed project `d76e436a-8816-4342-9511-b4706e2320e4` idle with progress `18/18`.
- GET `/`, `/app.js`, and `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: same tailnet-only config; no public Funnel route.

### Touch icon scale 1.5 batch checks

- User asked to drop the artwork scale to 1.5.
- Regenerated the favicon artwork at scale 1.5 instead of 1.8 on full-bleed `#0d1421`; the dark background still reaches all edges. `public/index.html` head tags unchanged.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)`.
- Pixel check: size `[180,180]`; corners `[13,20,33]`, `[13,20,33]`, `[13,20,33]`, `[13,20,33]`; `edgeNonBg` `189` (was `261` at scale 1.8); `white` `0`; center `[129,141,248]`. Bright pixel count `12491` (was `14464`); bright bounding box `[0,30,179,149]` (was `[0,18,179,161]`). No white space or transparent pixels.
- Local and served sha256 both `b86b9155d5740c151d92069db4511dd378c68435d703c7ffdbfb1ead942ea517`.
- `node --check public/app.js` passed; `git diff --check` passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up. Manifest `sha256:acdef2532ebae81a23ac0683e759865d93db7d109b63adae5a793e0c54d1b557`.
- `curl -fsS http://127.0.0.1:4188/api/state`: managed project `d76e436a-8816-4342-9511-b4706e2320e4` idle with progress `19/19`.
- GET `/`, `/app.js`, and `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: same tailnet-only config; no public Funnel route.

### Touch icon scale 1.3 batch checks

- User asked to try scale 1.3.
- Regenerated the favicon artwork at scale 1.3 instead of 1.5 on full-bleed `#0d1421`; the dark background still reaches all edges. `public/index.html` head tags unchanged.
- `file public/apple-touch-icon.png`: `PNG image data, 180 x 180, 8-bit/color RGB, non-interlaced`; IHDR `(180, 180, 8, 2, 0, 0, 0)`.
- Pixel check: size `[180,180]`; corners `[13,20,33]`, `[13,20,33]`, `[13,20,33]`, `[13,20,33]`; `edgeNonBg` `71` (was `189` at scale 1.5); `white` `0`; center `[128,140,247]`. Bright pixel count `9886` (was `12491`); bright outer count `1261` (was `2883`); bright bounding box `[4,38,173,141]` (was `[0,30,179,149]`). No white space or transparent pixels.
- At threshold `200`: bright count `6341` (was `8151`); bright outer count `622` (was `1450`); bright bounding box `[6,38,172,141]` (was `[0,30,179,149]`).
- Local and served sha256 both `6d12b28996e8984b988b7305056a7215198f319e04ff716f5f4e8949268c4ef4`.
- `node --check public/app.js` passed; `git diff --check` passed.
- `docker compose up -d --build looparr`: rebuilt `looparr:latest`, copied `public/`, recreated `looparr`, and started it healthy; `ts-looparr` remained Up. Manifest `sha256:b09f257421c0d7bf6a4008a2fc4109db38ec81865f72ac5a68745742f82e1584`.
- `curl -fsS http://127.0.0.1:4188/api/state`: managed project `d76e436a-8816-4342-9511-b4706e2320e4` idle with progress `20/20`.
- GET `/`, `/app.js`, and `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: same tailnet-only config; no public Funnel route.
- User confirmed the icon is correct; all icon follow-ups are closed. Moving to a new session.

### Plan setup guidance batch checks

- Selected the smallest useful handoff item: add browser guidance for a valid `plan.md` without backend changes.
- Updated the drawer in `public/index.html` with a collapsible `plan.md format` guide. It shows `# Build plan`, valid checklist lines, accepted `- [ ]`, `- [x]`, `* [ ]`, and `+ [ ]` forms, and notes that Looparr runs the first unchecked item and does not run headings or notes.
- Kept `aria-describedby="plan-format-hint"` on `textarea#plan-editor`. The id now points to the always-visible guide summary.
- Added `.plan-guide` styles in `public/styles.css` using existing color variables and the current drawer style.
- Added `planGuide` and `planGuideSummary` to the app DOM map, `planGuideTouched` state, automatic open for missing or empty plans in `updatePlanGuide(plan)`, a call from `loadPlan(id)`, an interaction flag on summary click, and a reset in `openDrawer(id)`. No backend or endpoint changes.
- `node --check public/app.js`: passed.
- `git diff --check -- public/index.html public/app.js public/styles.css`: passed.
- `git diff -- public/index.html public/app.js public/styles.css`: inspected. New batch changes appeared alongside pre-existing uncommitted UI work from earlier batches. Pre-existing changes were not altered. No `src/engine.js` change.
- `docker compose up -d --build looparr`: passed. Build copied `public`, produced `looparr:latest`, recreated `looparr`, and started it. Manifest list `sha256:649fc0bbba11a4722d1c13aff4bbde68f3fe808a576b7ce5849f409aabe997cd`. `ts-looparr` remained Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: passed. Settings were `maxConcurrent:2`, `mode:"parallel"`, `globalRunner:"opencode"`, `rateLimitPauseSeconds:60`. Managed project `d76e436a-8816-4342-9511-b4706e2320e4` was idle with progress `22/22`.
- `curl -fsS http://127.0.0.1:4188/ | grep -F 'plan.md format'`: served `<summary id="plan-format-hint">plan.md format</summary>`.
- `curl -fsS http://127.0.0.1:4188/app.js | grep -F 'planGuideTouched'`: served the new state, helper, reset, and summary click listener lines.
- `curl -fsS http://127.0.0.1:4188/styles.css | grep -F '.plan-guide'`: served the new guide styles.
- `docker ps --filter name=looparr`: `looparr` Up with health starting at check time; `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve. `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`, plus tailnet-only HTTP aliases.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed `(tailnet only)` entries. Funnel remains disabled.
- No browser or Playwright interaction test was run. Verification was static JS syntax, served asset checks, API state, container status, and Tailscale status.

### Drawer activity and logs batch checks

- Selected smallest useful handoff item: improve drawer task and log presentation for active projects. Public UI only; `src/engine.js` and backend stayed untouched.
- Updated `public/index.html`: status row now shows labeled Current and Up next text via `#drawer-task` and `#drawer-next`; Logs heading now shows `#log-status` and a hidden `#log-follow` button; `#log-list` has `role="log"` and `aria-live="polite"`.
- Updated `public/app.js`: added DOM refs and `app.logFollow`; added `isNearBottom`, `toggleFollowButton`, and `updateLogStatus`; `scrollLogs(force)` respects follow state; `appendLogLine`, `renderLogs`, and `updateDrawerHeader` keep task/log status in sync; `renderLogs` shows an empty state; opening drawer resets follow; scroll and Jump to latest listeners added. Existing dedupe by `data-seq` and 400-entry cap preserved.
- Updated `public/styles.css`: added `.drawer-activity`, `.drawer-task.empty`, `.drawer-next`, `.log-heading-actions`, and `.log-empty` styles; kept dark compact UI.
- `node --check public/app.js`: passed.
- `git diff --check -- public/index.html public/app.js public/styles.css`: passed.
- `git diff -- public/index.html public/app.js public/styles.css`: inspected; this batch appeared with prior uncommitted UI work. No unrelated files changed.
- `docker compose up -d --build looparr`: passed. Build copied `public`, produced manifest `sha256:f01089e96e24941c36eb6d37e598ff09fe3fc700f48cf32068eb9b6bc4388daf`, config `sha256:5db66f9f183fd019bf5bab408b8c9b0d3c2dd10c88a3700e580fa2715de8f92e`, recreated `looparr`, and kept `ts-looparr` Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: passed. Settings were `maxConcurrent:2`, `mode:"parallel"`, `globalRunner:"opencode"`, `rateLimitPauseSeconds:60`. Managed project `d76e436a-8816-4342-9511-b4706e2320e4` was idle with `progress {total:23, completed:23}`, no current or next task, and zero logs.
- GET through `http://127.0.0.1:4188/`: `/` served `drawer-activity`, `drawer-next`, `log-status`, and `log-follow`; `/app.js` served `isNearBottom` and `logFollow`; `/styles.css` served `.drawer-activity` and `.log-empty`.
- `docker ps --filter name=looparr`: `looparr` Up 20 seconds (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve. `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`, plus tailnet-only HTTP aliases.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed `(tailnet only)` entries. Funnel remains disabled.
- No browser or Playwright interaction test was run. Verification was static JS syntax, diff checks, served asset checks, API state, container status, and Tailscale status.

### Hosted Add Project documentation batch checks

- Selected smallest useful handoff item: review hosted documentation for the Add Project path flow and setup state.
- Updated `README.md` generic Add Project text: server-side project directory, absolute host path, no browser folder picker, server validation, `~` expansion, suggestions, and **Setup Needed** flow.
- Added hosted deployment section `Add a project on the hosted deployment`: mounted path example `/home/michaelpeele/ai-projects/example`, no folder picker, `HOME=/home/michaelpeele`, drawer `plan.md` setup, starter plan, and host strip setup count.
- No JS, CSS, backend, or static asset change; no rebuild was needed.
- `git diff -- README.md`: inspected. Diff contained only the intended Add Project text replacement and hosted subsection addition.
- `curl -fsS http://127.0.0.1:4188/api/state` before the `plan.md` update: passed. Settings were `maxConcurrent:2`, `mode:"parallel"`, `globalRunner:"opencode"`, `rateLimitPauseSeconds:60`. Managed project `d76e436a-8816-4342-9511-b4706e2320e4` was idle with `progress {total:24, completed:24}`, no current or next task, and zero logs.
- `docker ps --filter name=looparr`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve. `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`, plus tailnet-only HTTP aliases.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed `(tailnet only)` entries. Funnel remains disabled.
- `git diff --check` after documentation writes: passed.
- `curl -fsS http://127.0.0.1:4188/api/state` after the `plan.md` update: passed. Managed project `d76e436a-8816-4342-9511-b4706e2320e4` was idle with `progress {total:25, completed:25}`, no current or next task, and zero logs.
- No browser or Playwright interaction test was run.

### Headless handoff documentation batch checks

- Selected smallest useful handoff item: document current headless prompt/answer exchange and manual markdown archive flow.
- Added `README.md` section `Headless prompt files and archive flow`. It records the Seed/Analyze/Implement question contract, required answers, hardcoded prompt templates, manual archive layout, and archive file format.
- The editable prompt template/settings panel remains unimplemented. No engine, backend, JS, CSS, static asset, or container change was made.
- `git diff -- README.md`: inspected. Diff contained the new handoff documentation plus the pre-existing Add Project documentation changes.
- `git diff --check`: passed.
- `curl -fsS http://127.0.0.1:4188/api/state`: passed. Settings were `maxConcurrent:2`, `mode:"parallel"`, `globalRunner:"opencode"`, `rateLimitPauseSeconds:60`. Managed project `d76e436a-8816-4342-9511-b4706e2320e4` was idle with `progress {total:26, completed:26}`, no current or next task, and zero logs.
- `docker ps --filter name=looparr --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve. `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`, plus tailnet-only HTTP aliases.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed `(tailnet only)` entries. Funnel remains disabled.
- No browser or Playwright interaction test was run.

### Constraint-block escalation follow-up

- User requested a discovery-list rule for constraints that block work: ask questions, track repeats, clarify whether the block continues, and support configurable block count, temporary lift, and permanent lift.
- Added `plan.md` section `Constraint block discovery list` with the escalation rule and a `Current discovered block` entry.
- Asked which JS constraint to lift, what the lift duration means, and the repeated-block threshold.
- User lifted `src/engine.js` and `public/app.js` for this session. Lift lasts until the user says stop. Permanent lift was not granted.
- User set the repeated-block threshold to 2 blocks.
- Updated `.looparr/next_prompt.txt` with the flow rule, current lift, and revised JS constraint.
- `git diff --check`: passed after the `plan.md` rule was added.
- User clarified the block policy controls belong in Looparr's UI and runtime configuration for work Looparr performs.
- Intended storage design recorded in `plan.md`: global defaults in `config.json` under `settings`; per-project override on each project entry; project value wins, global value is fallback. No separate `settings.json` exists today.

### Editable prompt templates batch checks

- Selected smallest useful batch: editable Seed, Analyze, and Implement prompt templates.
- `src/config.js`: added default templates with `{{task}}` and `{{handoff}}` placeholders. `DEFAULT_SETTINGS` now stores `seedPromptTemplate`, `analyzePromptTemplate`, and `implementPromptTemplate`.
- `src/engine.js`: replaced hardcoded prompt functions with `renderPrompt(settingKey, values)`. It uses the configured template when valid and falls back to `DEFAULT_SETTINGS`. `startStep()` renders the per-phase template.
- `server.js`: extended existing `PATCH /api/settings` to validate template fields as strings, non-empty, at most 20000 characters, and containing required placeholders. No new endpoint was added.
- `public/index.html`, `public/app.js`, `public/styles.css`: added Settings > Prompt templates with three textareas. State sync uses `setIfIdle()`, and Save posts templates through the existing PATCH endpoint.
- `README.md`: updated the headless handoff section and Settings list for editable templates.
- `node --check public/app.js`: passed.
- `node --check server.js`: passed.
- `node --check src/config.js`: passed.
- `node --check src/engine.js`: passed.
- `git diff --check`: passed.
- `docker compose up -d --build looparr`: build passed; `looparr` recreated and started.
- `curl -fsS http://127.0.0.1:4188/api/state`: passed. Settings included `seedPromptTemplate`, `analyzePromptTemplate`, and `implementPromptTemplate`; managed project `d76e436a-8816-4342-9511-b4706e2320e4` was present.
- GET `/`, `/app.js`, `/styles.css`: passed. Served HTML included `prompt-templates`, `seed-prompt-template`, `analyze-prompt-template`, and `implement-prompt-template`; served JS included all three template setting keys; served CSS included `.prompt-templates`.
- `docker ps --filter name=looparr --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'`: `looparr` Up (healthy); `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve. `https://looparr.tail0307d.ts.net (tailnet only)` with `/ proxy http://127.0.0.1:3000`, plus tailnet-only HTTP aliases.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed `(tailnet only)` entries. Funnel remains disabled.
- No browser or Playwright interaction test was run.
- `plan.md` was not changed. The block-policy settings item remains open.

### Constraint block policy settings batch checks

- Selected smallest useful batch: final plan item for block-policy settings, global defaults, and per-project overrides.
- `src/config.js`: added `blockThreshold`, `temporaryLiftScope`, and `permanentLift` defaults plus project normalization and policy resolution helpers.
- `src/engine.js`: exposed effective `project.blockPolicy` with override source and stored override fields on new projects.
- `server.js`: extended existing `PATCH /api/settings` and `POST /api/projects` with validation. No new endpoint.
- `public/index.html`, `public/app.js`, `public/styles.css`: added Settings fields, Add Project override fields, and read-only drawer policy summary in the dark compact UI.
- `README.md`: documented global fields, per-project overrides, blank-inherits rule, storage location, and that Looparr records policy without enforcing edits.
- `node --check server.js && node --check src/config.js && node --check src/engine.js && node --check public/app.js`: passed.
- `git diff --check`: passed.
- `docker compose up -d --build looparr`: built `looparr:latest`, recreated `looparr`, and started it; `ts-looparr` stayed Up.
- `curl -fsS http://127.0.0.1:4188/api/state`: settings showed `blockThreshold:2`, `temporaryLiftScope:""`, `permanentLift:""`. Managed project included `blockPolicy` with effective values and null/blank overrides.
- GET `/`, `/app.js`, `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- `docker ps --filter name=looparr`: `looparr` Up with health starting; `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve for `https://looparr.tail0307d.ts.net/`, proxying `/` to `http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: no public Funnel route; output showed tailnet-only entries.
- No browser or Playwright interaction test was run.
- `plan.md`: marked the block-policy settings item complete. No unchecked plan items remain.

### E2E UI readiness batch checks

- User requested sidebar navigation, projects at top, global settings under a Settings header, blocker settings, checklist add/reorder, and question answering for an E2E test.
- `public/index.html`: added sidebar navigation, moved the Projects section above Settings/Add Project, grouped global settings under sidebar Settings links, renamed the block policy panel to Blocker settings, and added drawer Question handoff plus task add controls.
- `src/engine.js`: added `getAnswer(id)` and `writeAnswer(id, content)` for project `.looparr/next_prompt.txt` with path containment checks, atomic writes, and a 200000 character cap.
- `server.js`: added `GET /api/projects/:id/answer` and `PUT /api/projects/:id/answer`. No other new endpoint.
- `public/app.js`: added sidebar active/open handling, task append, task move up/down through the existing plan endpoint, answer refresh/save, and state refresh after plan edits.
- `public/styles.css`: added dark compact sidebar layout, task add/reorder styles, and answer editor styles with mobile rules.
- `README.md`: documented the sidebar, project drawer checklist add/reorder, and Question handoff answer flow.
- `node --check server.js && node --check src/config.js && node --check src/engine.js && node --check public/app.js`: passed.
- `git diff --check`: passed.
- `docker compose up -d --build looparr`: built `looparr:latest`, recreated and started `looparr`; `ts-looparr` stayed Up.
- `curl -fsS http://127.0.0.1:4188/api/state | jq ...`: settings showed `blockThreshold:2`, `temporaryLiftScope:""`, `permanentLift:""`. Managed project `looparr` was idle with runner `opencode`, progress `{total:30,completed:30}`, and expected `blockPolicy` overrides.
- GET `/`, `/app.js`, `/styles.css` through `http://127.0.0.1:4188/`: `200` for each.
- GET `/api/projects/d76e436a-8816-4342-9511-b4706e2320e4/answer`: `200`; no mutation.
- `curl -fsS http://172.17.0.1:4187/health`: `{"ok":true,"projectsRoot":"/home/michaelpeele/ai-projects","opencodeBin":"/home/michaelpeele/.opencode/bin/opencode"}`.
- `docker ps --filter name=looparr`: `looparr` Up healthy; `ts-looparr` Up with `0.0.0.0:4188->3000/tcp` and `[::]:4188->3000/tcp`.
- `docker exec ts-looparr tailscale serve status`: tailnet-only Serve for `https://looparr.tail0307d.ts.net/`, proxying `/` to `http://127.0.0.1:3000`.
- `docker exec ts-looparr tailscale funnel status`: tailnet-only entries only; no public Funnel route.
- Browser/Playwright check at `http://127.0.0.1:4188/`: sidebar links Projects, Blocker settings, and Prompt templates were visible; Projects region rendered before Settings; opening the looparr card showed Question handoff with status `handoff ready`, the Add a task input/button, and 30/30 tasks. Console had 0 errors and 1 warning.
- No Start press, task run, answer write, checklist write, or runtime config mutation was performed. The user must add a new unchecked task before Start will run.

### Auto-resume on start batch checks

- Implemented opt-in auto-resume-on-start for projects. Added `autoResumeOnStart` normalization in `src/config.js`, API fields and strict validation in `server.js`, state exposure and capture/consume logic in `src/engine.js`, and dependency-free intent/audit handling in `src/auto-resume.js`.
- Added drawer-only Startup toggle in `public/index.html`, `public/app.js`, and `public/styles.css`. No home-card controls or `#drawer-controls` button order changed.
- Added `scripts/restart-looparr.js`, `scripts/test-auto-resume.js`, npm scripts `restart:looparr`, `test:auto-resume`, and combined `test`. Added `HOSTNAME: looparr` to the `looparr` service environment.
- Added README documentation for the toggle, pending intent, audit log, gating, and restart helper.
- `npm test`: passed both `model-selector smoke tests` and `auto-resume smoke tests`.
- `git diff --check` and `node --check` for `server.js`, `src/config.js`, `src/engine.js`, `src/auto-resume.js`, `public/app.js`, `scripts/restart-looparr.js`, and `scripts/test-auto-resume.js`: passed.
- `docker compose config --quiet`: passed.
- `docker compose build looparr && docker compose up -d looparr`: built `looparr:latest` and recreated `looparr`.
- `docker compose ps looparr`: `Up (healthy)` on `looparr:latest`, created `2026-11-21T17:48:58.120019488Z`; container id `044cd38b5cd5b38484af7ac989abebff363da675088297ee3bffe6d5b8c49ed1`.
- `GET /api/state`: project `looparr` returned `autoResumeOnStart:false` and `autoResumePending:false`.
- Served asset checks through `http://127.0.0.1:4188/`: `/` contained `drawer-auto-resume`, `/app.js` contained `saveAutoResume`, `/styles.css` contained `auto-resume`.
- SHA-256 and `stat -c %Y` comparisons for `server.js`, `src/engine.js`, `src/config.js`, `src/auto-resume.js`, `public/index.html`, `public/app.js`, `public/styles.css`, and `scripts/restart-looparr.js` matched local source and `/app/...` inside the container.
- Safe behavior check used a temporary API-created project with a one-task plan. `npm run restart:looparr -- --dry-run` passed preflight and prepare, staged one valid `planned-restart` intent, and did not call Docker. Intent schema and audit keys matched the spec; audit had only `about-to-resume`; no token, header, prompt, answer, executor URL, or environment value appeared in the intent or audit output.
- Stop cancelled the staged intent: pending file removed and `resume-cancelled` appended. Temporary project was removed through the API and its directory deleted. Production config was never hand-edited; final `/api/state` again showed only the original `looparr` project with `autoResumeOnStart:false`.
- The real restart helper was not run because this non-interactive run could not obtain operator approval for the conditional rebuild. Resume startup behavior is covered by the passing temp-only integration suite, including phase preservation, degraded phase, stale intent, duplicate prevention, rate-limited restore, and exactly-once consumption.
- `plan.md` item for auto-resume-on-start was marked complete after the above verification.

### Hide/show completed tasks, top/bottom move, drag reorder batch checks

- Implemented plan drawer checklist controls: hide/show completed toggle (`#toggle-completed-tasks`, `data-action="toggle-completed"`, UI-only, never PUTs `/plan`), double-arrow move-top (`⇈`) / move-bottom (`⇊`) buttons, and a `☰` drag handle per task with pointer-based hold-and-drag reorder plus ArrowUp/ArrowDown keyboard fallback. Public UI only: `public/index.html`, `public/app.js`, `public/styles.css`.
- `app.showCompleted` is in-memory only (reset in `openDrawer`/`closeDrawer`); hiding completed tasks never changes `plan.md` or progress. Checkbox `data-index` keeps the API index (`POST /tasks`); reorder/drag use full parsed `data-task-index` so hidden completed rows stay addressable.
- Reorder preserves raw file bytes: headings, notes, blank lines, task text, markers (`-`/`*`/`+`, `[ ]`/`[x]`/`[X]`), indentation, CRLF, and trailing newline. `reorderPlanTask(content, fromTaskIndex, toTaskIndex)` rewrites only task lines in place; dirty editor content goes through `ensurePlanContent()`; saves are serialized via `planSaveChain` with an in-flight guard (`updatePlanControls()` disables move/drag/add/insert/save/hide-show during save, shows `Save plan.md first` when dirty).
- Added `scripts/test-plan-ui-controls.js` wired into `package.json` `test` (runs after model-selector and auto-resume suites). Covers served-asset ids/classes/actions for `/`, `/app.js`, `/styles.css`, pure reorder/CRLF/`TASK_LINE_RE` unit checks, and API flows (task check, reorder PUT, index mapping) on a temp project.
- `npm test`: passed `model-selector smoke tests`, `auto-resume smoke tests`, and `plan-ui-controls smoke tests`.
- Local serve verification on `PORT 4321`: served `/` contained `id=toggle-completed-tasks`, `data-action="toggle-completed"`, `Hide completed`; served `/app.js` contained `data-action="drag"`, `move-bottom`, `move-top`, `No incomplete tasks. Show completed to edit.`, `reorderPlanTask`, `setPointerCapture`; served `/styles.css` contained `.drag-handle`, `touch-action: none`, `cursor: grab`, `.drag-before`, `.drag-after`, `body.plan-dragging`.
- `docker compose build looparr && docker compose up -d looparr`: rebuilt `looparr:latest`, recreated `looparr`, `docker compose ps looparr` shows `Up (healthy)`.
- Production served-asset checks through `http://127.0.0.1:4188/`: `/` contained `toggle-completed-tasks`, `data-action="toggle-completed"`, `Hide completed`, `⊟`, `plan-actions`; `/app.js` contained `data-action="drag"`, `move-top`, `move-bottom`, `⇈`, `⇊`, `No incomplete tasks. Show completed to edit.`, `reorderPlanTask`, `reorderChecklistTask`, `planSaveChain`, `setPointerCapture`, `elementFromPoint`, `drag-before`, `drag-after`; `/styles.css` contained `.plan-actions`, `.toggle-completed`, `.drag-handle`, `touch-action: none`, `cursor: grab`, `.drag-before`, `.drag-after`, `body.plan-dragging`.
- SHA-256 comparisons for `public/app.js`, `public/index.html`, `public/styles.css` matched local source and the container (`/app/public/...`); container timestamps consistent with local `stat -c %Y`.
- Manual desktop and narrow-mobile/iOS Safari hold-and-drag testing was not possible in this non-interactive environment and remains a documented manual check. Pointer Events with `setPointerCapture`, `touch-action: none` on the handle only, `elementFromPoint` drop targeting, and the ~44 px mobile touch targets are in place for iOS Safari.
- `plan.md` hide/show item was already marked complete (`- [x]`) by the prior session and was left unchanged. `.looparr/next_prompt.txt` untouched.

### Model picker batch checks

- Item 1 (plan.md line 123, "Model list should include additional models"): extended `MODEL_OPTIONS` in `public/app.js` from 11 to 13 entries to mirror `opencode models` output exactly. Added `omniroute/auto` and `omniroute/auto/coding` (the CLI's canonical form includes the `omniroute/` provider prefix; the headline `auto/coding` maps to `omniroute/auto/coding`). The 11 `opencode/*` entries were already present. Added a comment above `MODEL_OPTIONS` noting the list mirrors the CLI registry and is kept in sync manually because the server/container has no `opencode` binary.
- Item 2 (plan.md line 117, dropdown from target AI provider): documented as blocked in `plan.md` with the concrete path. Blockers: the container image has no `opencode` binary, so the looparr server cannot enumerate models itself; dynamic population would require the host executor (external host process with `opencodeBin`) to expose `GET /models` running `opencode models`, a looparr server `GET /api/models` route merging that with the static list as fallback, and `fillModelSelect` fetching it — a host-executor change plus restart and a server route, all outside the `public/`-only scope. Static list kept manually in sync; verified 1:1 against `opencode models` today (13 IDs, of which the same 2 are missing from the old list).
- Item 3 (plan.md line 124, multi-select): documented as blocked in `plan.md`. `opencode run --model` takes a single string (`provider/model#variant`); repeated `--model` is not supported by the CLI, so a comma-separated value would pass `parseModel` (no whitespace, <=200 chars) but be passed to `opencode` as one invalid model id. Smallest enabling change recorded: keep the single-string comma-separated value through `parseModel`, split on comma in `src/runners/opencode.js` `buildCommand` (or engine fallback loop over models on failure via the existing `isRateLimit` path), plus a multiple-select UI composing the comma string and an `index.html` change. Choice if enabled: applies uniformly to all model fields (global `model`/`seedModel`/`analyzeModel`/`implementModel` and per-project equivalents).
- Extended `scripts/test-model-selector.js`: `testRunnerForwarding()` now asserts `buildCommand({model:'omniroute/auto/coding'})` passes `--model omniroute/auto/coding`; new `testServedModelOptions()` fetches served `/app.js` and asserts it contains `omniroute/auto/coding` and `'omniroute/auto'`; `main()` now round-trips `PATCH /api/settings {model:'omniroute/auto/coding'}` and `PATCH /api/projects/{id} {model:'omniroute/auto'}` through the API unchanged.
- `npm test`: passed all 3 suites — `model-selector smoke tests`, `auto-resume smoke tests`, `plan-ui-controls smoke tests`.
- `git diff --check`: passed.
- Local serve verification on `PORT 4198`: served `/` (23641B), `/app.js` (72692B), `/styles.css` (25951B) all `200`; served `/app.js` contained `omniroute/auto` (2 matches, including `omniroute/auto/coding`).
- Browser automation (Playwright against `http://127.0.0.1:4198/`): global `#model`, per-project `#project-model`, and `#seed-model` dropdowns all contain `omniroute/auto` and `omniroute/auto/coding`. Global settings select `omniroute/auto/coding` → save → status `saved`; reload → `#model` value persisted as `omniroute/auto/coding`. Project drawer model inputs are free-form text inputs (`#drawer-model-input`, `#drawer-seed-model`, `#drawer-analyze-model`, `#drawer-implement-model`), so any CLI model id is acceptable there; per-project persistence of `omniroute/auto` is covered by the API round-trip test.
- `docker compose build looparr && docker compose up -d looparr`: rebuilt `looparr:latest`, recreated `looparr`; `docker compose ps` shows `looparr` `Up (healthy)` and `ts-looparr` `Up` with `0.0.0.0:4188->3000/tcp`.
- Production served-asset checks through `http://127.0.0.1:4188/`: `/` 200 (23641B), `/app.js` 200 (72692B) contained `omniroute/auto` (2 matches, including `omniroute/auto/coding`), `/styles.css` 200 (25951B).
- SHA-256 comparisons for `public/app.js`, `public/index.html`, `public/styles.css`, `scripts/test-model-selector.js` matched local source and the container (`/app/...`).
- `plan.md` items on lines 117, 123, 124 marked `- [x]` with the above documentation appended. Line 110 ("CLI tools may be installed") and the other unchecked items (lines 111-116, 118-122) left untouched. `.looparr/next_prompt.txt` untouched.

### CLI-tools prompt note batch checks

- Added global setting `promptCliToolsNote` (default `false`) in `DEFAULT_SETTINGS` (`src/config.js`) with boolean coercion in `normalizeSettings` (`normalized.promptCliToolsNote = normalized.promptCliToolsNote === true`), so a bad stored value cannot crash the engine.
- `src/engine.js`: added `CLI_TOOLS_NOTE` const, exported `promptPreamble()` (returns the note only when the flag is `true`, else `''`), and applied the preamble once in `startStep` right before `rt.status = phase` so seed, analyze, and implement prompts all get the prefix `note\n\n<rendered prompt>`. Flag off produces byte-identical prompts to before. Left a future hook comment for promptSnippets near `promptPreamble`.
- `server.js` `PATCH /api/settings`: strict boolean validation — non-boolean `promptCliToolsNote` returns HTTP 400 `promptCliToolsNote must be a boolean`.
- UI: `<details class="prompt-options" id="prompt-options-section">` with `#prompt-cli-tools-note` checkbox (reusing `.auto-resume-row` styling) in `public/index.html`; `dom` map entry, explicit `.checked` handling in `applyState` (guarded by `document.activeElement` so an in-focus checkbox is not clobbered), and PATCH body field in `saveSettings` in `public/app.js`; `.prompt-options` / `.prompt-options-fields` CSS in `public/styles.css`.
- Added `scripts/test-prompt-cli-tools-note.js` (temp `CONFIG_PATH` + `LOOPARR_PROJECTS_ROOT` under `.tmp-prompt-cli-tools-note-test`, server on `127.0.0.1:4198`) wired as the 4th suite in `package.json` `test`. Covers: fresh-config default `false`; PATCH `true` persists; `GET /api/state` reflects it; PATCH `"yes"` → 400 with the boolean message; `promptPreamble()` non-empty when flag true and `''` when false (engine required fresh from disk); reload-after-PATCH-`false` via `loadConfig()`.
- `npm test`: passed all 4 suites — `model-selector smoke tests`, `auto-resume smoke tests`, `plan-ui-controls smoke tests`, `prompt-cli-tools-note smoke tests`.
- `node --check` (`server.js`, `src/engine.js`, `src/config.js`, `public/app.js`) and `git diff --check`: passed. No `.tmp-*` dirs left behind.
- `docker compose build looparr && docker compose up -d looparr`: built `looparr:latest`, recreated and started `looparr`; `docker compose ps looparr` shows `Up (healthy)`; `GET /api/state` over `http://127.0.0.1:4188` returns `200`.
- Production served-asset checks through `http://127.0.0.1:4188/`: `/` and `/app.js` each contain `prompt-cli-tools-note`; `/styles.css` contains the `.prompt-options` rules (the CSS selector is class-based, so the id string is absent by design). SHA-256 and `stat -c %Y` comparisons for `server.js`, `public/index.html`, `public/app.js`, `public/styles.css` match local source and `/app/...` inside the container.
- `.project_documents/RESEARCH-prompt-snippets.md` documents the future `promptSnippets` feature (data model `{id,label,enabled,body}`, fenced-marker rendering capped at 8000 chars total / 4000 per snippet, safety analysis, UI sketch, risks) — documented only, not wired into the engine in this batch.
- `plan.md` line 110 (CLI-tools note item) was already marked `- [x]` by the prior session and was left unchanged; no other `plan.md` edits made. `.looparr/next_prompt.txt` untouched. `config.json` is gitignored runtime state and was never committed.

## Sections-on-own-page + icon nav + block overrides batch (2026-11-21)

- `plan.md` line 111 marked `- [x]`: "Rather than references for page jumps I want the sections on their own page. I want icons instead of text, review how Curatarr did this. Override blocks".
- Reviewed Curatarr (`/home/michaelpeele/ai-projects/Curatarr`): state-driven views in `Curatarr.Web/src/App.tsx` (`useState<ViewKey>`, one page component per view), `Sidebar.tsx` icon nav (emoji strings + inline SVG gear/server icons, active border + background, aria-labels).
- Looparr now uses state-driven views instead of anchor page jumps: `.view[data-view]` containers for `projects` (host strip + project grid), `settings`, `add`; `showView(view)` in `public/app.js` toggles views + sidebar active state; sidebar nav is icon-only buttons (📚 Projects, gear SVG Settings, ➕ Add project) with `title`/`aria-label` tooltips, matching the line-104 gear-only precedent.
- "Override blocks" gap closed: per-project block-policy overrides were read-only after project creation. Added editable threshold/temporary-lift/permanent-lift fields to the drawer's "Constraint block policy" section (`#save-block-policy` -> `saveBlockPolicy()`), backed by new `blockThreshold`/`temporaryLiftScope`/`permanentLift` handling in `PATCH /api/projects/:id` (`server.js`), reusing the existing `parseBlockThreshold`/`parseLiftScope` validators. Blank threshold clears the override to inherit the global default (`null`); invalid values rejected 400.
- Tests: `scripts/test-plan-ui-controls.js` extended with served-asset markers (views, icon nav, drawer override fields) plus API assertions (patch overrides persist, effective policy uses override, clearing inherits global default 2, invalid threshold 400). `npm test`: all 4 suites pass.
- Prod verification per plan.md: `docker compose build looparr && docker compose up -d looparr`; container `healthy`; served `/`, `/app.js`, `/styles.css` on `http://127.0.0.1:4188/` contain the new markers; SHA-256 of all three served assets matches local source.
- `.looparr/next_prompt.txt` replaced (was the stale line-110 CLI-tools handoff, which caused the pipeline to re-run completed work) with a lean handoff for plan.md line 112 (pin drawer Start/Pause/Stop controls). This is the plan.md-mandated handoff write for a completed batch.
- No source constraint blocks this session: `src/engine.js` and `public/app.js` remain lifted until the user says stop (plan.md "Current discovered block"); no engine changes were needed for this batch.

## Task detail collapse batch (2026-11-22)

- Implemented plan.md line 119: current-task and up-next detail now clamp to three lines. Text that exceeds three lines shows a `▼` toggle; tapping expands to `▲` and tapping again collapses. Collapsed is the default.
- Applied behavior to home-page cards and the project drawer with shared `data-project-id`/`data-task-field` wrappers. Toggles stay in sync across card and drawer instances, stop propagation from the card click/keyboard handler, and use literal `textContent` for task text.
- Added per-project/per-field expansion persistence under `looparr.taskExpansion.v1` in `localStorage`, with schema validation, default `false`, and an in-memory fallback when storage throws. Stored state survives drawer close/reopen, view changes, SSE re-renders, and reload. No overflow removes the visible toggle and expanded styling without deleting stored state.
- Re-measurement runs after text updates, drawer open, card reuse, and window resize. Toggle controls are real buttons with `aria-controls`, `aria-expanded`, `aria-label`/`title`, a visible focus outline, and a 44x44 tap target.
- Files changed: `public/index.html`, `public/app.js`, `public/styles.css`, `scripts/test-plan-ui-controls.js`. No change to `.looparr/next_prompt.txt`.
- Checks passed: `node --check public/app.js`, `node --check scripts/test-plan-ui-controls.js`, `git diff --check`, full `npm test` (11 scripts, including `plan-ui-controls smoke tests passed`), and targeted `node scripts/test-plan-ui-controls.js`.
- Production verification: `docker compose build looparr && docker compose up -d looparr` succeeded; `docker compose ps looparr` showed `Up ... (healthy)`, image `looparr:latest`, manifest `sha256:933cbccef5758771acec60fef01a07b72c99ad86191d78cdd150989f15c7933d`. Served `/`, `/app.js`, and `/styles.css` from `http://127.0.0.1:4188/` contained the new toggle IDs/classes, storage key, overflow check, and `-webkit-line-clamp:3`. `GET /api/state` returned HTTP 200.
- SHA-256 matched local vs container for `/app/public/index.html` (`d13aff8e7622c78fe41a5a326a38e8ac61e9cf5b1b0105298df9c86432c5b45f`), `/app/public/app.js` (`d633d5a4e4c97432823d3345975deb8b92819f0399cb06a6419c24ec8c05d9a4`), and `/app/public/styles.css` (`85e0617b5a5e4676003269d029c1b6ce46cb0eb8531699e75c7aa5b693f7a727`). Timestamps matched to the second for all three files.
- Browser checks passed against production: short text showed no chevron; long text clamped to three lines and showed the chevron; card and drawer chevrons toggled glyph, `aria-expanded`, labels, and `localStorage`; card chevron did not open the drawer; drawer/card stayed in sync; close/reopen, view navigation, and reload preserved state; resize text swaps hid and restored the chevron; 390x844 viewport kept 44x44 toggles and pinned drawer controls visible; `<img src=x onerror="window.__xss=1">` rendered as literal text with no image or script effect.

## Issues found and fixed

- `extra_hosts` with `network_mode: service:tailscale` produced daemon error `conflicting options: custom host-to-IP mapping and the network mode`. Removed `extra_hosts`.
- Moving `extra_hosts` to the Tailscale sidecar broke network namespace sharing and caused app/sidecar netns mismatch. Removed it entirely and used the Docker bridge gateway (`172.17.0.1`) for the host executor URL.
- Node 20 `fetch()` to the Docker gateway failed with `Error: bad port`. Rewrote bridge client using Node `http`/`https` request.
- Tailscale sidecar restarted repeatedly after a new auth key because `serve.json` used an array for `TCP`. Fixed to sibling shape: `"TCP": { "443": { "HTTPS": true } }`.
- A 30-second background shell timeout killed the first long-lived host executor with SIGTERM. Restarted it with a long timeout.

## Remaining

- Commit changes locally. No remote and no push.
- Keep the host executor running for hosted task execution.
- Funnel remains disabled; explicit approval required before enabling.

## Task detail collapse final verification batch (2026-11-22)

- Rebuilt `looparr:latest` with `docker compose build looparr && docker compose up -d looparr`. `docker compose images looparr` showed image ID `ca02ad0b3388`, created after the rebuild. `docker compose ps looparr` showed `Up ... (healthy)`.
- Served `/`, `/app.js`, and `/styles.css` from `http://127.0.0.1:4188/` and confirmed the new toggle IDs/classes, `looparr.taskExpansion.v1`, `aria-expanded`, `stopPropagation`, `syncAllTaskExpansion`, and `-webkit-line-clamp:3`. `GET /api/state` returned HTTP 200.
- SHA-256 matched across local source, served asset, and container copy: `public/index.html` / `/app/public/index.html` `d13aff8e7622c78fe41a5a326a38e8ac61e9cf5b1b0105298df9c86432c5b45f`; `public/app.js` / `/app/public/app.js` `9a391377f74bb9a36a2fd3d494f32ebb033b25656931b7243489d6bc1bfc376f`; `public/styles.css` / `/app/public/styles.css` `85e0617b5a5e4676003269d029c1b6ce46cb0eb8531699e75c7aa5b693f7a727`.
- `stat -c %Y` epoch timestamps matched local and container: `index.html` `1795327139`, `app.js` `1795327566`, `styles.css` `1795327322`.
- Checks passed: `node --check public/app.js`, `git diff --check`, full `npm test` (11 scripts), and targeted `node scripts/test-plan-ui-controls.js`.
- Browser checks passed with routed fixture state: short text showed no chevron; long text clamped to three lines with `clientHeight 54` / `scrollHeight 198` and a visible chevron; card and drawer toggles flipped `▼`/`▲`, `aria-expanded`, and `localStorage` together; drawer stayed closed when the card toggle was used; drawer/card stayed in sync.
- Close/reopen, settings→projects navigation, and reload preserved stored state. Keyboard Enter/Space toggled only the button and did not open the drawer.
- Resize measurement showed toggle visibility following actual overflow: viewport 500 gave card width 468, overflow true, toggle visible; viewport 550 gave card width 518, overflow false, toggle hidden.
- At 390x844 the drawer toggle measured 44x44 and did not overlap `#drawer-close`, `#drawer-controls`, `.drawer-toolbar`, or `.drawer-header`. Real iOS Safari was not emulated; this was a viewport and tap-target approximation.
- `<img src=x onerror="window.__xss=1"> She said "hi" & bye` rendered as literal text in card and drawer, with zero `img` elements and no `window.__xss` value.
- Only the marker on `plan.md` line 119 was changed for this task. No other plan item, `.looparr/next_prompt.txt`, or commit was touched.

## Per-project hide/show completed persistence final verification batch (2026-11-22)

- Implemented per-project checklist hide/show completed persistence in browser localStorage under key `looparr.showCompleted.v1`.
- Stored value is a JSON object mapping `String(projectId)` to boolean. Only boolean `true` means shown. Missing, invalid, and corrupted values default to hidden.
- Default state is hidden: `app.showCompleted === false`; static button uses `aria-pressed="false"`, `⊞ Show completed`, and `Show completed tasks in the checklist` for aria-label and title.
- `openDrawer(id)` restores the saved value for `id` after setting `app.drawerId` and before `loadPlan(id)` or first checklist render. `closeDrawer()` preserves saved values.
- `toggleCompleted()` writes immediately via `setShowCompleted(app.drawerId, show)`, flips state, updates button label/icon/aria/title, and re-renders `app.currentPlan`. It contains no API call.
- Added storage helper tests with fake storage for unknown id hidden, stored `true` restore, invalid id/value ignored, two-project isolation, immediate write, and storage failure fallback.
- `npm test` passed, including `plan-ui-controls smoke tests passed`.
- Standalone `node scripts/test-plan-ui-controls.js` passed.
- Ran `docker compose build looparr && docker compose up -d looparr` for the source change.
- `docker compose ps -a` showed `looparr` running on newly built image `looparr:latest`; `ts-looparr` published `0.0.0.0:4188->3000/tcp`.
- `docker inspect -f '{{.State.Health.Status}} {{.Config.Image}} {{.Image}}' looparr` returned `healthy looparr:latest sha256:e750e1f6d3d6180dd19f7273f97f7cb5d150c5fe252eff7cdd2c1c29fc5e075c`.
- Served `http://127.0.0.1:4188/` assets contained the change: `/` had hidden-default button markup, `/app.js` had `const SHOW_COMPLETED_KEY = 'looparr.showCompleted.v1';`, `/styles.css` served unchanged expected toggle styling.
- Local and container `/app` copies of `public/app.js`, `public/index.html`, `public/styles.css`, and `scripts/test-plan-ui-controls.js` matched by SHA-256 and mtime.
- Browser check with fixture projects A and B passed: unknown A defaulted hidden; toggle A showed completed and wrote only `{"cece3a42-d798-4378-a219-c3a79ad41fb9":true}`; B stayed hidden; switching back to A stayed shown; reload and new page in the same browser context kept A shown and B hidden.
- Toggle made zero API requests. Fixture plan files and the main `plan.md` had unchanged mtime and size after the browser check.
- Commit status: tracked task files staged and committed with a conventional commit message. Untracked `.tmp-browser-fixture/`, `.tmp-browser-sticky/`, and `looparr-a-open.yml`, plus `.env` and secrets, were excluded.

## Project removal final verification batch (2026-11-22)

- Fixed `public/app.js` `handleCardAction`: card Remove now calls `DELETE /api/projects/${encodeURIComponent(project.id)}`; start/pause/stop still call `POST /api/projects/${encodeURIComponent(project.id)}/${action}`. Confirm text, `flashCard(card, error.message)`, and `buttons[3].disabled = false` stayed in place. No `/remove` URL remains.
- Added `scripts/test-remove-project-ui.js` and appended it to the `package.json` `test` chain. New test asserts the DELETE branch, exact confirm text, POST action branch, inline error handling, enabled remove button, absence of `/remove`, server `app.delete('/api/projects/:id')` route, `engine.removeProject`, and no filesystem removal calls in `removeProject`.
- Checks passed: `npm test` (all scripts, ending `remove-project UI smoke tests passed`), `node --check public/app.js`, and `node --check scripts/test-remove-project-ui.js`.
- Production rebuild: `docker compose build looparr && docker compose up -d looparr` succeeded. `docker compose ps` showed `looparr` `Up ... (healthy)`. `docker inspect looparr` returned `status=running health=healthy image=sha256:e0b96cae40fb086db5892844894a814e70a31ec778b0fc5c6a9878aff589b921`. `docker image inspect looparr:latest` returned the same image ID, created `2026-11-22T14:56:15.785758417Z`.
- Served assets from `http://localhost:4188` matched local source by SHA-256: `public/index.html` `/` `fddc2ec74b396c8f6466dcf9fa6eaa31d4e45f594d09df23faecc65b3e0c04f8`; `public/styles.css` `/styles.css` `587adf3d16351c0cf594f2eeb1ba0c7d95d5c25581d5e02c4d3140e5df03f23f`; `public/app.js` `/app.js` `4a40522651bb72132e33edd1716cfd5b68b4c02c1578ee4bc3f1bfa3c4ec0e91`.
- Served `/app.js` line 853 contained `await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });`; line 855 contained the POST action branch.
- Local and container `/app` copies matched by mtime, size, and SHA-256 for `public/app.js`, `public/index.html`, `public/styles.css`, `server.js`, `src/engine.js`, `package.json`, and `scripts/test-remove-project-ui.js`. Example: `public/app.js` local and container `1795359284 99286 4a40522651bb72132e33edd1716cfd5b68b4c02c1578ee4bc3f1bfa3c4ec0e91`.
- Temp project cleanup after fixed build live: `DELETE /api/projects/cece3a42-d798-4378-a219-c3a79ad41fb9` and `DELETE /api/projects/659ebca2-d99e-4ea0-a624-5d0e7b4557b7` both returned `{"ok":true}`.
- `/api/state` and `data/config.json` then listed only looparr id `d76e436a-8816-4342-9511-b4706e2320e4`; both temp IDs were absent. Container remained `running healthy` on image `sha256:e0b96cae40fb086db5892844894a814e70a31ec778b0fc5c6a9878aff589b921`.
- `.tmp-browser-fixture/a/plan.md`, `.tmp-browser-fixture/b/plan.md`, `.tmp-browser-fixture/config.json`, `.tmp-browser-fixture/server.log`, and `.tmp-browser-fixture/server.pid` remained. Existing unrelated changes and untracked `.tmp-browser-fixture/`, `.tmp-browser-sticky/`, and `looparr-a-open.yml` were left untouched. `.looparr/next_prompt.txt` was not changed. No commit was made in this batch.

## Drawer UI state final verification batch (2026-11-22)

- Completed `plan.md` line 15: hide-completed remains the default, drawer UI state is remembered per project, and empty Questions or Logs sections collapse until content arrives.
- Preserved the existing hide-completed system exactly: `looparr.showCompleted.v1`, `app.showCompleted: false`, boolean-only state, `restoreShowCompletedForProject(id)` inside `openDrawer(id)`, `closeDrawer()` persistence, checklist filter, `toggleCompleted()` immediate write, and unchanged static button wording/aria/title.
- Added browser-local per-project state under `looparr.uiState.v1` for six drawer sections, plan-guide open/touched state, and log-follow state. State is boolean-only, corrupt-safe, memory-fallback on storage failure, keyed by `String(projectId)`, and never written to server config or plan files.
- Added global browser-only details state under `looparr.settingsUiState.v1` for `promptTemplates`, `promptOptions`, `blockPolicy`, and `envSettings`. Actual setting values remain in `config.json` under `settings` with per-project overrides. No new API route was added.
- Converted the six drawer headings to keyboard-accessible buttons with `aria-expanded`, `aria-controls`, visible chevrons, and `section-body` wrappers. `#log-follow` remains outside the toggle button. Added focus, hidden-body, chevron rotation, spacing, and 44px mobile target CSS. Desktop header and toolbar remain pinned, with `.drawer-body` as the only scroll area.
- Empty-state automation affects only Questions and Logs. Explicit manual choices win. Plan, constraint, runner, and startup sections are never auto-collapsed. Section toggles call `setSectionOpen` only and make no API call or plan write.
- `node scripts/test-plan-ui-controls.js` passed: `plan-ui-controls smoke tests passed`.
- `npm test` passed all 14 scripts, ending `remove-project UI smoke tests passed`.
- `npm run restart:looparr -- --dry-run` passed and prepared intent `d76e436a-8816-4342-9511-b4706e2320e4`. Planned Docker command: `docker compose build looparr && docker compose up -d looparr`. Dry run skipped Docker.
- `git diff -- src/config.js server.js` showed no `src/config.js` diff. `server.js` still contains pre-existing prior-session plan-file route work (`PLAN_FILE_MAX_BYTES`, `PLAN_FILE_BASENAME`, `PLAN_FILE_DIR_PREFIX`, `resolveProjectPlanFile`, and GET/PUT `/api/projects/:id/plan-file`). That work was not reverted and is not staged in this task commit.
- `npm run restart:looparr` rebuilt and recreated the container. Build manifest `sha256:16e6a1981dbfcfa30168ad099ea68446866b92e259aa9c614b3b00e1198d4b40` differs from the prior recorded image `sha256:e0b96cae40fb086db5892844894a814e70a31ec778b0fc5c6a9878aff589b921`. The pre-build image id was not captured before the real restart because the restart command included the build; the new build manifest and prior recorded image establish the difference.
- `docker inspect -f '{{.Image}}' looparr` returned `sha256:16e6a1981dbfcfa30168ad099ea68446866b92e259aa9c614b3b00e1198d4b40`.
- `docker compose ps looparr` showed `looparr` `Up ... (healthy)`.
- `curl -fsS http://127.0.0.1:4188/api/state` returned valid JSON for the healthy looparr state. Container-side `fetch('http://127.0.0.1:3000/api/state')` returned `api/state ok`.
- Local and container `/app` source hashes matched: `public/index.html` `257cc6f91e434651b05b0c768e38e2a5e99e2ae39dcbca9c41aa22bf516bc858`; `public/app.js` `31299a77743830b87fdabbc96d92dc54b233501068a2c2c0844de88b3fa4daf7`; `public/styles.css` `6f6f5de34c181e527a284676106066340d33d413c6c3bab17524f8f2bf8c1298`; `scripts/test-plan-ui-controls.js` `68a7c2609967c3dc140ac982529062384b24cf6da892dfb3331f4c0133a7b6a6`.
- Served asset hashes matched local disk: `/` `257cc6f91e434651b05b0c768e38e2a5e99e2ae39dcbca9c41aa22bf516bc858`; `/app.js` `31299a77743830b87fdabbc96d92dc54b233501068a2c2c0844de88b3fa4daf7`; `/styles.css` `6f6f5de34c181e527a284676106066340d33d413c6c3bab17524f8f2bf8c1298`.
- Served content checks passed: `/` contains `data-section="questions"`, `data-section="logs"`, `data-action="toggle-section"`, and `data-settings-section="envSettings"`; `/app.js` contains both `looparr.uiState.v1` and `looparr.settingsUiState.v1`; `/styles.css` contains `.section-toggle` and `.section-body[hidden]`.
- `git diff --check` passed for all staged-path candidates. Secret-pattern scan found only ordinary UI wording and documentation references; no credential values were present.
- Commit: `e8b96367a4546f2f02aa618ec17680e7169a194e` (`feat: remember drawer UI state per project`).
- Untracked files, `.tmp-*`, `looparr-a-open.yml`, pre-existing `server.js` changes, and engine-managed `.looparr/next_prompt.txt` were excluded or left untouched.
