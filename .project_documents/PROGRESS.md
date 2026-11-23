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


## Scriptable PNG icon batch — complete

Added `GET /api/projects/:id/icon.png` for native clients that cannot decode SVG. The endpoint returns a 256x256 PNG, keeps the discovered icon's version in a `-png` ETag, uses `Cache-Control: no-cache`, and reuses the browser icon route's project/path containment checks.

Changes:
- Added `src/icon-png.js` with `sharp`-based rasterization and a small in-memory cache.
- Added `resolveProjectIcon(id)` in `server.js`; both icon routes use it.
- Refactored `GET /api/projects/:id/icon` without changing its response behavior.
- Added `GET /api/projects/:id/icon.png`.
- Added PNG route tests to `scripts/test-icons.js`.
- Documented the endpoint in `README.md`.
- Added `sharp ^0.35.5` and updated `package-lock.json`.
- Marked the `plan.md` batch complete.

Verification:
- `npm test` passed all suites, including `icon discovery and serving tests passed`.
- `git diff --check` passed.
- `npm run restart:looparr -- --dry-run` produced the expected Docker command.
- `bash scripts/promote.sh --sandbox-only` built `looparr:latest` and passed sandbox smoke.
- `npm run restart:looparr` rebuilt and recreated production. API and health checks passed.
- Production container `looparr` is `running` and `healthy` on the new image.
- Local and container SHA-256 hashes match for `server.js`, `src/icon-png.js`, `package.json`, `package-lock.json`, `public/index.html`, `public/app.js`, and `public/styles.css`.
- Served `/`, `/styles.css`, and `/app.js` hashes match local source.
- `/api/state` responds on the production port.
- `/api/projects/d76e436a-8816-4342-9511-b4706e2320e4/icon` still returns the original SVG with its original ETag.
- `/api/projects/d76e436a-8816-4342-9511-b4706e2320e4/icon.png` returned `200`, `image/png`, `nosniff`, `no-cache`, ETag `"0312d5640e79-png"`, and a 256x256 RGBA PNG. Matching `If-None-Match` returned `304`.

Note: `npm run restart:looparr` printed `Active-run postcheck failed: fetch failed`, but it completed its API/health checks and printed the standard instruction to finish the served-asset and container-content checks above.

Widget follow-up: Scriptable should request `/api/projects/:id/icon.png` instead of `/api/projects/:id/icon`; keep the same `v` query value from `iconVersion || icon`.

## Model rotation per dropdown batch — complete (2026-11-22)

Added an opt-in rotation toggle to every model dropdown. Rotation is off by default and stored per field: global `modelRotation`, `seedRotation`, `analyzeRotation`, `implementRotation`, with per-project boolean overrides where `null` inherits the global. When on and the effective list has two or more models, each successfully completed step advances that field's in-memory cursor; rate-limit fallback still advances inside a step, and rotation resumes past the model that served it.

Changes:
- `src/config.js`: rotation defaults, nullable project overrides, `resolveRotation`, `rotationFieldForModelField`.
- `src/engine.js`: per-field cursor (`rt.rotationCursor`, `rt.rotationLists`), rotation start index, advance on successful close, `modelFallbackPending` so an in-step rate-limit retry is not treated as a new step, `Model: <id> (rotation n/N)` log suffix, `modelRotation`/`effectiveRotations` in state.
- `server.js`: boolean validation in `PATCH /api/settings`; boolean-or-null validation in project create and patch.
- `public/index.html`, `public/app.js`, `public/styles.css`: 12 toggles sharing one two-arrow SVG symbol, `aria-pressed` state, green filled square when on and gray when off, `title`/`aria-label` "Model Rotation", drawer `Rotation:` summary line, updated hints.
- `scripts/test-model-rotation.js` wired into `npm test`; `scripts/test-model-selector.js` asserts each select has a toggle.
- `README.md` and `plan.md` updated.

Verification:
- `npm test`: all 17 scripts passed, including `model rotation smoke tests passed`.
- `node --check` passed for `src/config.js`, `src/engine.js`, `server.js`, `public/app.js`.
- `git diff --check` passed.
- `docker compose build looparr && docker compose up -d looparr`: container healthy on new image `sha256:874be07fb107`.
- Container SHA-256 matches local for `server.js`, `src/config.js`, `src/engine.js`, `src/model-list.js`, `public/index.html`, `public/app.js`, `public/styles.css`.
- Served `/index.html` has 12 `data-rotate-for` toggles, `/app.js` has `readRotationButtons`, `/styles.css` has the green `[aria-pressed="true"]` state, `/api/state` reports all four rotation flags off by default.

## Free runner discovery batch — complete (2026-11-22)

Discovery only for the plan item on free terminal coding CLIs as runners. No application source changed, so the production rebuild block did not apply.

Recorded in `.project_documents/INVESTIGATION-free-runner-options.md`:
- Requirement list a runner must meet (no TTY, per-step model pinning, non-interactive approvals, greppable failure text, auth without a browser).
- 14-row candidate matrix with headless invocation, free-token path, prod-auth viability and verdict.
- Live probe: `opencode v2.3.2`; Kilo Gateway `api.kilo.ai/api/gateway` returned `200` for the models list and `200` for a keyless `kilo-auto/free` completion (routed to `reflection/beam-free`), so free tokens are available through the existing OpenCode runner with a provider config only.
- Decisions: build Kilo Gateway first (no new runner), then Kilo CLI as the first real second runner; probe Qoder and Mistral Vibe; rule out Antigravity (ToS forbids wrapping `agy` in third-party agents on consumer plans, headless needs a cached interactive login), Copilot Free (unquantified credits, auto model selection only), iFlow (service shut down), Qwen (free OAuth ended 2026-04-15), Gemini CLI (free access moved to Antigravity 2026-06-18), Amp (Amp Free paused).
- Rotation conclusion: keep the per-dropdown toggle, but ids must be runner-scoped (project runner selection, `runner` on `/run`, per-runner model catalogues) before a second provider's models enter the shared pickers.

Plan updates: discovery item marked complete; new `## Free runner candidates` section holds the follow-up items and the Antigravity decision.

## Kilo Gateway free lane — complete (2026-11-22)

Added the keyless Kilo Gateway free models to the picker through the existing OpenCode runner. No new runner and no engine change.

Changes:
- `opencode.json` (repo root): `kilo` provider against `https://api.kilo.ai/api/gateway`, no `apiKey`, 12 free model ids declared.
- `public/app.js`: the same 12 `kilo/*` ids appended to `MODEL_OPTIONS`, so every global, project, and drawer dropdown offers them and per-dropdown rotation works unchanged.
- `README.md`: ids documented plus the provider requirement, the host-executor restart note, and the rotating/rate-limited nature of the free catalogue.
- `scripts/test-model-selector.js`: asserts the served `app.js` carries every id, and that `opencode.json` declares the provider keyless with each model.
- `plan.md`: gateway item marked complete.

Verification:
- `opencode models` with the provider present lists 443 `kilo/...` entries, 12 tagged free; the gateway completed `kilo/kilo-auto/free` with no credential.
- Server-cwd config reaches a config-less project directory: `opencode serve` from the repo root plus `opencode run --server ... --model kilo/kilo-auto/free` printed `ok`, exit 0.
- Real Looparr path: `scripts/host-executor.js` on port 4291 with its own OpenCode server on 4124; `POST /run` with model `kilo/kilo-auto/free` streamed `{"stream":"out","text":"ok\n"}` then `{"exit":0}`.
- `node --check public/app.js`, `scripts/test-model-selector.js`, and `git diff --check` passed.
- Production rebuilt and recreated: healthy on image `sha256:9e8140ac503c`; container `/app/public/app.js` hash matches local; served `/app.js` exposes the 12 kilo ids; `/api/state` still returns settings, projects, and the four rotation flags.

Notes:
- The live host executor and its OpenCode server must be restarted for the new provider to load; verification used an isolated executor on alternate ports so no active run was interrupted.
- OpenCode 2.3.2 requires `OPENCODE_PASSWORD` for both `serve` and `run` when the server enforces it; the probe set it explicitly.
- `opencode.json` is host-side OpenCode configuration and is intentionally not copied into the Looparr image.

## Provider hardening, live restart, Qoder/Vibe probes (2026-11-22)

Hardening:
- New `src/opencode-provider.js` fills in the keyless `kilo` provider in the repo-root `opencode.json` only where keys are missing, preserves hand-edited values and unrelated config, writes atomically, and refuses to touch a file it cannot parse. `scripts/test-opencode-provider.js` covers creation, idempotency, preservation, custom settings, broken JSON, and the committed config.
- `scripts/host-executor.js` now seeds that config at startup and reports `kiloProvider`/`kiloProviderPath` in `GET /health`.
- The executor no longer attaches to an OpenCode server it did not start. It skips a listener on the configured port and starts its own server, cwd `REPO_ROOT`, on the next free port, so the server always reads this repo's provider config. If a port cannot serve, it tries the next one and fails only after the whole range.

Live restart and verification:
- Restarted the production host executor. `GET /health` on `172.17.0.1:4187` reports `kiloProvider: unchanged`; the log shows `port 4096 is served by a process this executor does not own; trying the next port` followed by `serving http://127.0.0.1:4097/ from /home/michaelpeele/ai-projects/looparr`. The pre-existing `opencode serve --service` on 4096 was left running untouched.
- A real `POST /run` through 4187 with `model: "kilo/kilo-auto/free"` streamed `{"stream":"out","text":"ok\n"}` and `{"exit":0}`; the container can reach the same health endpoint.
- Note for future sessions: a background process started inside a single tool command is killed when that command exits. The executor must be started detached (`setsid nohup node scripts/host-executor.js ... &`) or as a long-lived background job, then verified alive afterwards.

Runner investigation:
- Per-project runner selection already exists end to end: `project.runner` + `settings.globalRunner` in config, `PUT /api/projects/:id` and settings validation in `server.js`, the `project-runner` and `global-runner` selects in `public/index.html`, and `getRunner(...)` dispatch in `src/engine.js`. What is missing is a second registered runner, not the selection plumbing. The remaining gap for a second runner is the `runner` field on the host-executor `/run` payload.

Qoder and Mistral Vibe probes:
- `qodercli 1.1.95` installed from `@qoder-ai/qodercli`; headless flags confirmed, but every run stops at `Not logged in · Please run /login` and only interactive login is offered.
- `mistral-vibe 3.1.4` installed from PyPI into a venv; programmatic mode starts but exits 1 with `Missing MISTRAL_API_KEY`, and setup is interactive `vibe --setup`.
- Both probe plan items are closed with a "no runner until authenticated" decision; details and exact output are in `.project_documents/INVESTIGATION-free-runner-options.md`.

Checks: `npm test` passed (18 scripts, including the new provider test). Production was rebuilt and verified after these source changes.

## Runner payload, Kilo CLI runner, host CLI installs (2026-11-22)

Runner payload:
- `runner` now travels from the engine's bridge payload through `scripts/bridge-client.js` to the host executor. `scripts/host-executor.js` validates it against `opencode` and `kilo` (default `opencode`, HTTP 400 on an unknown id) and spawns the matching binary.
- The OpenCode bridge payload explicitly carries `runner: "opencode"`; the new Kilo runner carries `runner: "kilo"`.
- `GET /health` reports both binaries under `runnerBinaries`; `/active` entries include `runner`.

Kilo runner:
- New `src/runners/kilo.js` and `src/kilo-command.js`. Invocation: `kilo run --auto --format json [--model provider/model] [--file path]... <prompt>`, with the model validated by the shared `validateModelId`. Files are supported, so the seed step still attaches `plan.md`.
- Registered in `src/runners/index.js`; `/api/state` now lists `opencode:OpenCode,kilo:Kilo CLI`.
- Rate-limit detection, stale-run cancellation, and active-run listing are reused from the OpenCode runner because both go through the same executor endpoints.
- Local mode spawns `KILO_BIN` (default `kilo`); bridge mode spawns the executor.

Verification:
- `scripts/test-runner-payload.js` covers registry, both bridge payloads, Kilo argument building, blank prompt, comma model lists, whitespace, and the required run key.
- Live: `POST /run` with `runner: "kilo"` through the restarted executor streamed Kilo JSON events and `{"exit":0}`, routed keyless to `baidu/ernie-5.5-flash-preview:free` with `cost: 0`. No `kilo auth` login was needed.
- `POST /run` with `runner: "nope"` returned HTTP 400.
- `npm test` passed (19 scripts). Production rebuilt and healthy on image `sha256:6f546a9a3eeb`; container hashes match local for the new runner, the argument builder, the registry, and the executor.
- The executor runs detached under `setsid` (pid 1957223 at the end of the batch), with its own OpenCode server, and skips the foreign listener on 4096.

Persistent host CLIs (for the Qoder and Vibe follow-up):
- `~/.local/bin/qodercli` 1.1.95, installed with `npm install -g --prefix "$HOME/.local" @qoder-ai/qodercli` (the global `npm install -g` fails with `EACCES` on `/usr/local/lib/node_modules`).
- `~/.local/bin/kilo` 7.8.32 from `@kilocode/cli`, same prefix.
- `~/.local/bin/vibe` 3.1.4 symlinked into a venv at `~/.local/share/mistral-vibe`, because system Python is PEP 668 managed and `pip install --user` is refused.
- Auth is still pending for Qoder (`qodercli login`) and Vibe (`vibe --setup` or `MISTRAL_API_KEY`); both remain unverified end to end.

Open follow-up: model ids are still a single shared list, so a project must pair the `kilo` runner with `kilo/*` ids and `opencode` with `opencode/*` until the per-runner catalogues land.

## Post-auth re-probe: Qoder and Mistral Vibe (2026-11-22)

Both host CLIs were signed in by the user, then probed again headless with no TTY.

Qoder CLI 1.1.95:
- `qodercli whoami` exits 0 and `~/.qoder/.auth/user` exists, so login works.
- `qodercli --list-models` prints `Warning: no models available for your account.`
- `qodercli -p "Reply with the single word ok." --permission-mode auto -o json` exits 1 with `inference.remoteChat.stream failed (403): {"pricingUrl":"https://qoder.com/pricing?client=qoder"}`, `error_code: 112`, zero tokens. Forcing `--model qwen3-coder-plus` falls back to `auto` and fails identically.
- Outcome: the block is plan entitlement, not auth. No runner built; revisit only if the account gains a paid or trial plan.

Mistral Vibe 3.1.4:
- `vibe -p "Reply with the single word ok." --max-turns 2 --max-price 0 --output json` exits 0 with assistant text `ok` and empty stderr.
- Headless file edits work: an `--auto-approve --max-price 0` run appended the requested line to `plan.md` and replied `done`, creating no other files.
- `--output streaming` emits one JSON object per line (5 events for a two-step run: `message:user`, `reasoning`, two `effect`, `message:assistant`), usable as NDJSON for logs and SSE.
- `--output-dir` writes `export.json` with `outcome: finished`, `stop_reason: null`, `cost_usd: 0`, and `usage.total_tokens: 19038`.
- Free lane confirmed: `--max-price 0` did not halt the run and the run cost 0.
- Runner gaps: no attachment flag (`--prompt-file` replaces the prompt rather than attaching), `--model` accepts a Vibe alias only, and `--output-dir` is the only structured cost/stop-reason source.
- Outcome: viable second runner; recorded as the open build item in `plan.md`.

Docs-only batch: no source files changed, so production was not rebuilt. `git diff --check` clean. The host executor from the previous batch is still alive (pid 1957223) and `/api/state` still lists both runners.

## Vibe runner and per-runner model scoping (2026-11-22)

Qoder, closed out:
- After the account was signed in, `qodercli whoami` succeeds but `qodercli --list-models` prints `Warning: no models available for your account.` and every `-p` run exits 1 with a 403 pointing at the pricing page. Qoder's own pricing page lists Free as the 2-week Pro trial plus completions/NES and BYOK, with no standing free model catalogue, so the account has no models to rotate. No runner built.

Vibe runner:
- New `src/vibe-command.js` builds `vibe --prompt <prompt> --auto-approve --output streaming --max-price 0 [--model <alias>]`. `--max-price 0` stops a run before any call that would cost money, so only free-plan usage completes.
- Vibe has no attachment flag (`--prompt-file` replaces the prompt), so seed `plan.md` and handoff paths are appended to the prompt as a short context list and read from the working directory by the agent.
- New `src/runners/vibe.js`, registered in `src/runners/index.js`. Local mode spawns `VIBE_BIN` (default `vibe`); bridge mode sends `runner: "vibe"`.
- `scripts/host-executor.js` accepts `vibe` in its runner set, dispatches to `buildVibeArgs`, reports `runnerBinaries.vibe`, and names the actual runner in its signal message.
- No cost or stop-reason parsing yet: that needs `--output-dir` `export.json`, which is not wired.

Per-runner model scoping:
- Each runner exports a `models` catalogue: OpenCode 25 ids (its own namespaces plus the `kilo/*` gateway lane, which resolves through the keyless `kilo` provider in repo-root `opencode.json`), Kilo CLI 12 `kilo/*` ids, Vibe none because `--model` takes an account alias.
- `listRunners()` serves the catalogues in `/api/state`; `runnerSupportsModel()` refuses ids claimed by another runner and allows unclaimed custom/BYOK ids. `src/engine.js` filters the effective model list per step and logs `Skipped model ids not valid for <runner>`.
- `public/app.js` replaces the flat `MODEL_OPTIONS` with `MODEL_OPTIONS_BY_RUNNER`, filters every picker by the selected runner, and rebuilds the model selects when the global or project runner changes so a stale id cannot stay selected.

Verification:
- `npm test` passes (19 scripts) including the expanded runner payload tests: registry, catalogues, Kilo and Vibe argument building, both bridge payloads, shared cancellation, rate-limit detection.
- Live executor restarted and still serving (pid 1975836) reports `runnerBinaries: {opencode, kilo, vibe}` and `kiloProvider: unchanged`.
- Live `POST /run` with `runner: "vibe"` returned Vibe JSON events, assistant text `ok`, and `{"exit":0}` in 8.6 seconds.
- Production rebuilt and healthy on image `sha256:1e2f05520a6b`; container `public/app.js` hash matches local `28261f3a5ad8`, `src/runners/vibe.js` and `src/vibe-command.js` are present, and prod `/api/state` reports `opencode:OpenCode:25, kilo:Kilo CLI:12, vibe:Mistral Vibe:0`.

Host cleanup command for Qoder (not run here): `npm uninstall -g @qoder-ai/qodercli --prefix "$HOME/.local"`, plus `rm -rf ~/.qoder` for its login state.

## Vibe free-lane aliases (2026-11-23)

Vibe had an empty picker because `--model` takes an account alias rather than a `provider/model` id. The account's cached catalogue (`~/.vibe/model_catalog_cache.json`, `model_catalog_cache` key `24c552dda975e18c5e175cbbc01665d3`, plan `FREE`) lists six models and exactly one free-lane entry:

- `zai-glm-5-3-flash-vibe-free`, label `GLM 5.3 Flash (Mistral Hosted)`, alias `zai-glm-5-3-flash`, no `requires`, 262,144 ctx.
- Paid/plan-gated and therefore left out: `mistral-large-4-0`, `zai-glm-5-3`, `zai-glm-5-3-flash` (the higher-plan id), `deepseek-v4-1-flash-1017`. `mistral-medium-latest` has no `higher_plan` requirement but is priced above zero, so the `--max-price 0` guard would stop it instead of running free.

Probes (headless, no TTY, `--max-price 0 --output streaming`):
- `--model zai-glm-5-3-flash-vibe-free`: assistant `ok`, `export.json` `outcome: finished`, `cost_usd: 0`, `config.active_model: zai-glm-5-3-flash-vibe-free`, 6,224 tokens.
- `--model zai-glm-5-3-flash`: assistant `ok`, `export.json` `outcome: finished`, `cost_usd: 0`. The alias resolves to the free entry for this account even though a paid model shares that id string.

Changes:
- `src/runners/vibe.js` `MODELS` now carries the two ids with a comment recording that they are the free lane only.
- `MODEL_OPTIONS_BY_RUNNER.vibe` in `public/app.js` mirrors them for the first paint. A blank model still means the account's active model.
- `scripts/test-runner-payload.js` asserts the Vibe catalogue, that Vibe accepts both ids, and that OpenCode refuses the Vibe alias.
- `README.md` and `plan.md` updated; the plan item is closed.

Verification:
- `npm test` passes (19 scripts); `git diff --check` clean.
- Production rebuilt and recreated: healthy on image `sha256:a75d1c65c79e129a98994eefe9aefa7eb21abea010bd1dea56634b8ec79544fe`; container `public/app.js` hash `265644bea270416842cd727b410dac16e04c0556c4179f61267f94fa6097f275` matches local; `/api/state` reports `opencode:25, kilo:12, vibe:2`.
- No host executor restart was needed: the executor already forwards `--model`, and these ids only change what the picker offers.

## Qoder removal and live Vibe task run (2026-11-23)

Qoder removal:
- `npm uninstall -g @qoder-ai/qodercli --prefix "$HOME/.local"` removed 12 packages and `rm -rf ~/.qoder` cleared the login state.
- Verified afterwards: `command -v qodercli` finds nothing, `~/.qoder` is gone, no `qoder*` entry remains in `~/.local/bin`, and `~/.local/lib` lists only `@kilocode/cli@7.8.32`. The `kilo` and `vibe` CLIs were untouched.

Live Vibe task through production:
- Added a throwaway project through the prod API (`POST /api/projects` on `127.0.0.1:4188`) at `/home/michaelpeele/ai-projects/vibe-live-test` with `runner: "vibe"` and every model field blank, wrote one task (`Create notes.txt with the single line vibe-ok`), and started it.
- Phase timeline from `/api/state`: `seed` at 5s, `analyze` at 20s, `implement` at 35s, `idle` at 45s, `done` at 105s. The final `All tasks complete.` was delayed by the 60s global Cooloff after the implement step.
- Every step logged `Skipped model ids not valid for Mistral Vibe: omniroute/auto/coding, opencode/big-pickle` (the inherited global default) and then `Model: OpenCode default`, proving the per-runner filter runs before dispatch and that a blank selection reaches Vibe as its active model. Each step ran `/app/scripts/bridge-client.js` and streamed Vibe NDJSON to the log.
- Result: `notes.txt` contains `vibe-ok`, the task is `- [x]` in `plan.md`, state reports `progress 1/1`, `error: ""`, and `.looparr/next_prompt.txt` was cleared on completion.
- Cleanup: the throwaway project was deleted from config (`DELETE /api/projects/:id`) and its directory removed, so prod's project list is back to what it was.
- Cosmetic gap found and fixed (2026-11-23): the pre-step log hardcoded `Model: OpenCode default` for a blank model on every runner, so a Vibe step read as if OpenCode were involved. `src/engine.js` now derives the label from the selected runner via `defaultModelLabel`, and the rate-limit fallback messages (`Rate limited on ...; retrying with ...`) use the same helper. Verified live after the rebuild: a Vibe project started on prod logged `Model: Mistral Vibe default`, and no OpenCode label appeared. Production image `sha256:bba7fc63a99e95c51977143bed4c7e4929297742f96f51cbcc85e57ddb5d89c7`, healthy, container `src/engine.js` hash matches local. The throwaway project was stopped, deleted, and its directory removed.

## Provider-error fallback, persisted rotation, runner rotation (2026-11-23)

- `src/rotation-store.js` persists cursors and cooldowns in `data/rotation-state.json`
  (`LOOPARR_ROTATION_STATE` override). Cursors are keyed by joined list content, so inherited
  projects share the global cursor and a project-specific list gets its own; the cursor survives
  restarts and only resets when the list changes.
- `src/failure.js` classifies failed steps: 429/400-schema/5xx/timeout advance to the next
  candidate, while 401/403/billing/entitlement stop immediately. `tryNextCandidate()` in
  `src/engine.js` tries the next model, then (with `runnerRotation`) the next runner and its
  models, at most once per `runner:model` pair per step, logging `Model failure on …` /
  `Runner failure on …`.
- Runner fields accept ordered lists globally and per project with `runnerRotation`
  (project nullable, global boolean, default off); `server.js` validates every id in a list.
- `/api/state` exposes `effectiveRunners`, `runnerRotation`, `effectiveRunnerRotation`,
  `activeRunner` and `activeModel`; the project card renders `runner · model`.
- UI: global/add-project/drawer runner pickers are multi-selects with rotation toggles
  (15 `data-rotate-for` targets total).
- Tests: new `scripts/test-rotation-store.js` and `scripts/test-failure-classification.js`;
  `scripts/test-model-rotation.js` gained the 400-fallback case, the terminal-auth case, runner
  list validation and the 15-toggle assertions. `npm test` passes.
- Production rebuilt and recreated, healthy, container source hashes match local, served HTML
  carries 15 toggles, and the container runs both new test scripts.

## OmniRoute coding-safe combo (2026-11-23)

- Created the OmniRoute combo `coding-safe` (id `df0155a6-b0c2-4439-be32-f507074617d4`, strategy
  `priority`) with targets `agnes/agnes-3.0-flash` then `agnes/agnes-2.5-flash`, after probing with a
  tools payload: every `opencode-zen/*` id and `ds/deepseek-v4-pro` are rejected by the key's live
  catalogue even though `/v1/models` lists them, and `auto/*` cannot be a combo target.
- Blocked `cerebras/gpt-oss-120b` on the `opencode cli` key via `PATCH /api/keys/{id}`. Direct
  requests are blocked, but `auto/*` still selects it in this build, so the combo is the reliable path.
- Added `coding-safe` to `providers.omniroute.models` in `~/.config/opencode/opencode.json` (backup
  kept beside it); OpenCode now lists `omniroute/coding-safe`.
- Added `omniroute/coding-safe` to `src/runners/opencode.js`, `public/app.js`, the README model list,
  and the served-app.js assertion in `scripts/test-model-selector.js`. Rebuilt/redeployed looparr and
  confirmed the served picker contains it.
- Verified `POST /v1/chat/completions` with `model: coding-safe` (tools payload) returns 200 and
  `opencode run -m omniroute/coding-safe` prints OK. `npm test` passes.

## Restart-safe active executor and continuation marker (2026-11-23)

- `scripts/restart-looparr.js` no longer calls `/api/auto-resume/prepare`; dry-run makes zero API writes and zero Docker calls. Real restart writes `.looparr/restart-continue.json` (`{"message":"Restart complete continue.","writtenAt":...}`) before Docker and removes it if Docker fails. `.looparr/next_prompt.txt` is not edited.
- `src/engine.js` adds `restartContinueFile()`, `consumeRestartContinueMessage()`, and `promptPreamble(extra='')`. `resumeOnStart()` sets `rt.restartContinuePending = phase !== 'seed';` so resumed analyze/implement steps inject the marker even for pre-existing `planned-restart` intents. `startStep()` consumes the marker only for resumed non-seed phases, deletes it after successful read, and injects through `promptPreamble()`.
- `docker-compose.yml` bind-mounts `./.looparr:/app/.looparr:rw` so the container engine (`/app/.looparr/...`) can read/unlink the host-written marker.
- Tests: `scripts/test-auto-resume.js` extended with prompt logging, API write spy, dry-run zero-POST/state assertions, restart-continue marker injection + one-time consume/no-duplicate-active-run coverage, and Docker marker presence/removal assertions. `npm run test:auto-resume` and full `npm test` pass.
- Live verification (port 4188, 2026-11-23): dry-run left state unchanged with no prepare/Docker/marker. Real restart rebuilt/recreated healthy container on image `sha256:31bed8768f50f4de50141cd0fe499a172e5b6527c1fcd24a93bca3a8806e5051` (container `133b9ac83de740747e0867581b453e1924bf01bffd38aaeb84c16809365a8462`), marker consumed, one active executor (`runKey 5e3e8abfd4f836cbc683b7396c3a6f11`), resumed prompt contained `Restart complete continue.`. Served HTML `6b0840afd3e01dd477be28dc7c7771ba2a06587c60a32d256135a410064b9874`, app.js `8d114dcd2ffe82955742c18adb7b00ec4cacf01fe4b637e7a1e9a7b331eb0773`, styles.css `5b4ce9cbbdc6c63e4aeca9e433f854889b72572fc397ea71a7522815c523673b` match local; `/api/state` returns projects and settings.
- Phase 2 (not implemented): true same-session resume analysis prompt at `docs/restart-same-session-phase2-prompt.md` (untracked, intentionally not staged).
