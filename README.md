# Looparr

Looparr is a local, self-hosted dashboard that drives a three-step Markdown checklist workflow across multiple projects. It uses Node.js, Express, vanilla HTML/CSS/JS, and Server-Sent Events. No build step is required.

> Visual branding is lowercase `looparr`. Package and documentation names keep the `Looparr` capitalization.

## Why Looparr

Looparr keeps every prompt one-shot and scoped to a single task. That drives a cache-to-context ratio between 88% and 99.2% cache, which keeps token cost low enough to run almost 24/7 on one free provider. Multiple free providers are configured, and the next step is parallel processing across them.

Two additions are queued in `plan.md`. A Plan prompt type lets questions come back and maps out a complete `plan.md` before Analyze and Implement run on the new list. Sprint support splits a project into phases such as backend and frontend, with options for parallel sprints and parallel tasks, each task in its own Git branch, a merge at the end of the sprint, and an automated testing round. Both go through question and design before implementation.

## Requirements

- Node.js 20 or newer
- npm 9 or newer
- An AI CLI runner on your `PATH`. OpenCode is the default.

Optional: `opencode` v2.3.0 or newer. Looparr starts a shared `opencode serve --port 4096` process when needed and reuses it for every step. The runner auto-detects the CLI flag: v2.3.0 uses `--server`; newer builds that support `--attach` use that instead.

## Install and run

```bash
cd /home/michaelpeele/ai-projects/looparr
npm install
npm start
```

Open <http://127.0.0.1:3000>.

For development with automatic server restart:

```bash
npm run dev
```

Environment overrides:

```bash
PORT=3100 HOST=127.0.0.1 npm start
```

## Prepare a project

Each project directory needs a `plan.md` in its root:

```markdown
# Build plan

- [ ] Scaffold the app
- [ ] Add authentication
- [ ] Write tests
```

Only `- [ ]`, `- [x]`, `* [ ]`, and `+ [ ]` checklist items are tracked. Looparr reads the first unchecked item for each step and marks it complete only after the Implement step succeeds.

Tasks can declare dependencies with an optional trailing suffix:

```markdown
- [ ] Build
- [ ] Deploy (depends: 1)
```

Dependency numbers are 1-based checklist positions. `#1` also works. The suffix is stripped from the task text passed to agents. Old plans without dependencies stay valid.

The first unchecked item still runs next. Start reports a clean error and does not reorder or skip tasks when that item waits on an incomplete dependency, or when the plan has a missing dependency or cycle:

- `Cannot start task 1: waiting on dependency #2`
- `Cannot start plan: Checklist item 2 depends on missing task #9`
- `Cannot start plan: dependency cycle detected: 1 -> 2 -> 1`

The plan drawer shows `Depends on: #1, #2` and a warning while dependencies are unmet. Completing the listed tasks clears the warning.

## Add a project

Use the add form in the dashboard:

- **Server-side project directory**: absolute path to the project directory on the Looparr host. `~` is expanded. Existing project paths and their parent directories are offered as suggestions.
- **Name**: optional display name. Defaults to the directory name.
- **Runner**: per-project runner override. Leave at the global default unless needed.
- **Block policy overrides**: optional block threshold, temporary lift scope, and permanent lift for this project. Blank fields inherit the global defaults.

Looparr uses a server-side folder browser, not a browser folder picker. Browser folders are not visible to the server. The folder dropdown lists directories directly under `LOOPARR_PROJECTS_ROOT`. **Browse server folders** navigates subdirectories under that root, and selecting a directory fills the path with the server/container path. **Add new folder** creates a real directory under the current browse directory, or under the root when used from the Add Project row. You can still type any absolute server/container path that exists. The server rejects paths that do not exist or are not directories.

A directory without a valid `plan.md` is still added. It appears as **Setup Needed** until the plan has at least one tracked checklist item. Open the project drawer, create or edit `plan.md`, then save it. The host strip shows `N need setup` while any project needs this step, or `all configured` when every project has a valid plan. Press **Start** after setup is complete.

Projects and settings persist in `config.json` next to `server.js`. That file is gitignored. Each project gets a hidden `.looparr/next_prompt.txt` handoff file, also gitignored.

## Workflow

For every unchecked task, Looparr runs three isolated, fresh-session steps via the selected runner:

1. **Seed**: reads `@plan.md`, finds the first unchecked item, and writes a concise analysis prompt to `.looparr/next_prompt.txt`.
2. **Analyze**: executes that prompt and writes a detailed implementation prompt to `.looparr/next_prompt.txt`.
3. **Implement**: executes the implementation prompt, verifies the work, and exits. Looparr marks the item `- [x]` in `plan.md` on successful close.

Each step runs in the project directory. The CLI attaches `plan.md` with `--file` so the agent can read and edit it. Logs stream live to the project card drawer.

After a Seed or Analyze step, open the project drawer and use **Question handoff** to refresh, edit, and save the current `.looparr/next_prompt.txt`. Press **Start** again after saving the answer.

### Headless prompt files and archive flow

Looparr is headless: agents exchange prompts through files, not a chat transcript. `.looparr/next_prompt.txt` is the single handoff file between steps. Its trimmed content becomes the next agent prompt. Do not add commentary around the prompt.

The phase contract is:

- **Seed question**: built-in Seed prompt plus attached `plan.md`. **Answer**: write only a concise analysis prompt to `.looparr/next_prompt.txt`. Do not edit `plan.md`.
- **Analyze question**: current `.looparr/next_prompt.txt` from Seed. **Answer**: overwrite `.looparr/next_prompt.txt` with a detailed implementation prompt. Do not implement code.
- **Implement question**: current `.looparr/next_prompt.txt` from Analyze. **Answer**: implement the task, run verification, commit safe tracked modified files, and leave `.looparr/next_prompt.txt` untouched. Leave the plan marker unchanged until verification passes; Looparr marks the item `- [x]` in `plan.md` on successful close.

Analyze handoffs are validated before Implement. A handoff containing meta-instructions such as "do not implement code yet" or "produce the prompt only" is rejected. Looparr keeps the phase at Analyze, sets a visible error, and requires a manual retry. The Implement prompt also ignores that wording if it reaches a custom template. The default Implement prompt directs the agent to stage explicit paths, skip untracked files, and skip files containing secrets, tokens, passwords, API keys, or credentials.

Settings > Prompt templates edits the Seed, Analyze, and Implement prompt templates. Use `{{task}}` for the current task text; Analyze and Implement also use `{{handoff}}` for the current `.looparr/next_prompt.txt` content. Defaults live in `config.json` under `settings` and are saved through `PATCH /api/settings`. Saved settings equal to the previous default Implement template are upgraded once on load; custom templates are preserved.

To keep a markdown question/answer archive:

1. Treat the drawer log stream as the full transcript for each step.
2. Before pressing **Start** for a new Seed step, create `.looparr/archive/<YYYYMMDD-HHMMSS>-<task-slug>/`. The Seed step deletes a stale `.looparr/next_prompt.txt`.
3. Copy retained prompts into the archive as `01-seed-question.md`, `02-analysis-question.md`, and `03-implementation-question.md` as those phases finish.
4. Save each agent response beside its question as `01-seed-answer.md`, `02-analysis-answer.md`, and `03-implementation-answer.md`. Record exact files changed, checks run, and the final result.
5. Leave only the correct next prompt in `.looparr/next_prompt.txt` for Analyze or Implement. A fresh Seed step works with no handoff file.

A compact archive file format:

````markdown
# Question

- Phase: analyze
- Task: exact unchecked task text

```text
paste the exact prompt here
```

# Answer

- Files changed: none for Seed or Analyze; exact paths for Implement
- Checks run: commands and results
- Result: handoff prompt or implementation summary
````

The archive is manual. Looparr does not create or rotate these files automatically.

## Settings

- **Max Concurrent Workers**: `2` by default. Set `1` for serial work or `0` for unlimited.
- **Execution Mode**:
  - **Parallel Pool** (default): up to N projects run continuously through their own plans.
  - **Round-Robin**: gives each active project one step per turn so all queued projects advance evenly.
- **Runner**: global default for projects without an override.
- **Models**: every global and per-project model field (`model`, `seedModel`, `analyzeModel`, `implementModel`) accepts one model id or an ordered comma-separated fallback list such as `opencode/big-pickle,opencode/tidepool-alpha-free`. Global fields and per-project overrides use the same format. The first id is tried first; Looparr falls back to the next id only when the runner reports an explicit provider rate-limit error. An empty selection or blank value means inherit/default: blank project phase fields inherit, blank global phase fields inherit the global default model, and a blank global default uses the OpenCode default. A single-model value stays valid and unchanged. Dropdown options come from the manually maintained `MODEL_OPTIONS` list in `public/app.js`: `omniroute/auto`, `omniroute/auto/coding`, `opencode/big-pickle` (default), `opencode/tidepool-alpha-free`, `opencode/hy4-flash-free`, `opencode/iceman-free`, `opencode/longcat-2.5-free`, `opencode/flint-40b-free`, `opencode/deepseek-v4.1-flash-free`, `opencode/nemotron-3.5-super-vl-free`, `opencode/beam-free`, `opencode/mimo-v2.6-flash-free`, and `opencode/nemotron-3.5-lightning-free`. Dynamic model loading is blocked because the server/container has no OpenCode CLI. Seed, Analyze, and Implement each have an independent global default and project override. Resolution order is project phase model list, project default model list, global phase model list, global default model list, then OpenCode default.
- **Rate-limit pause**: `60` seconds by default. Only an explicit provider error signature reported by the runner pauses that project, shows a countdown, then retries the same step. Incidental mentions of rate limits, `429`, quota, usage limits, or throttling do not trigger a pause. Looparr's own backoff notice does not trigger a pause.
- **Sticky add task row**: off by default. When enabled, the Add task input and button stay visible while scrolling the plan checklist in a project drawer.
- **Prompt templates**: edit the Seed, Analyze, and Implement prompts. `{{task}}` is required; `{{handoff}}` is also required for Analyze and Implement. The Implement default includes the git commit directive and replaces the saved previous default once on load.
- **Block threshold**: `2` by default. Allowed range is `1` to `20`. It records how many repeated constraint blocks happen before asking the user.
- **Temporary lift scope**: blank by default. Enter comma- or newline-separated file or path fragments temporarily lifted for the current session.
- **Permanent lift**: blank by default. Uses the same path-fragment format for paths lifted permanently.

All three global values live in `config.json` under `settings`. A project override wins over the global value. Blank project fields inherit the global default. Settings-page `<details>` open state is remembered in the browser only. That state is global and is not stored in `config.json` or per project.

These fields record agent and user guidance. Looparr stores and displays them, but it does not enforce blocks or exempt files from edits.

## Dashboard

- The sidebar keeps **Projects** first and uses a gear icon for **Settings**. The gear tooltip reads “settings”; the settings panel heading reads “Settings” and contains global settings, blocker settings, and prompt templates.
- Cards and the project detail drawer show the detected app icon, current phase, exact current task, Up Next preview, and `completed / total` progress. Icons are discovered from conventional `favicon.*` paths, HTML-declared `<link rel="icon">`, `apple-touch-icon`, manifest icons, and the existing `public/`, `src/app/`, `app/`, and `assets/` filename and directory scan. Remote, escaping, unreadable, or broken icons are ignored; the UI falls back to initials. Icon asset URLs are versioned so same-path content changes refresh without a manual cache clear.
- **Start** begins or resumes a project. **Pause** finishes the current step, then holds. **Stop** ends the active step and resets. **Remove** deletes the project from `config.json` only, never from disk.
- Clicking a card opens a drawer with a live checklist, add-task input, up/down reorder buttons, the effective block policy and its source, **Question handoff**, an editable `plan.md` textarea, and streaming stdout/stderr.
- Drawer sections collapse and expand from their headings. The open state of the drawer, plan guide, and log follow is remembered per project in the browser. Empty Question handoff and Logs start collapsed and expand when content arrives, unless you manually override them.
- Each drawer has a **Startup** section with an `Auto-resume on container start` checkbox, a `Save startup` button, and this helper text: "Resume this project after a planned Looparr container restart. User Stop always wins." The toggle is per project and off by default. The status shows `Pending intent` when a resume is staged. **Stop** clears that pending intent.

### Auto-resume on start

Auto-resume restores an active project after the Looparr container restarts. In-memory runtime state is not durable, so Looparr stages a short-lived intent before a graceful shutdown or planned rebuild and consumes it once on startup.

- Opt in per project in the drawer **Startup** section. There is no global master switch.
- Before a graceful container shutdown or a planned restart, Looparr writes `<project.path>/.looparr/auto-resume-state.json` and appends an `about-to-resume` line to `<project.path>/.looparr/auto-resume.log`. The intent records the current phase, task, and rate-limit timer only. It never records child processes, tokens, prompts, answers, executor URLs, headers, or environment values.
- On startup, Looparr consumes the intent once, restores the saved phase, reads the first unchecked task from `plan.md`, and writes a visible `↻ Auto-resume after restart (phase ...).` line to the project log. Analyze and Implement fall back to Seed when `.looparr/next_prompt.txt` is missing or empty. A completed plan, stale intent older than 24 hours, invalid schema, opt-out, or **Stop** prevents resume.
- Pending intents are written only when `HOSTNAME=looparr` or when tests set `LOOPARR_ALLOW_RESUME_INTENT=1`. Local `npm start` and `npm run dev` sessions do not stage intents. Docker Compose sets `HOSTNAME=looparr` for the `looparr` service.
- The audit log is append-only JSON lines, capped at 64 KiB with one `.log.1` rotation. It contains only timestamps, event names, project identity, safe phase/task snapshots, reason, PID, and hostname. No endpoint exposes the audit log.

## Add another runner

Runners live in `src/runners/`. A runner module exports:

```js
{
  id,
  label,
  description,
  isRateLimit(text),
  ensureServer(),
  buildCommand({ prompt, cwd, file }),
  shutdown()
}
```

Register it in `src/runners/index.js`. Registered runners appear in both runner selects immediately. The OpenCode runner is the reference implementation. `isRateLimit(text)` must recognize only explicit provider error signatures. Broad matches on bare `429`, `rate limit`, quota, usage limits, or throttling cause false positives and repeated steps.

## Hosted deployment

Hosted URL: <https://looparr.tail0307d.ts.net/>.

This deployment uses Tailscale Serve only. It is reachable from the tailnet, not from the public internet. Funnel is intentionally off. Do not enable Funnel without explicit approval: Looparr can run AI CLIs inside mounted project directories.

### Files

- `Dockerfile`: Node 20 image, production dependencies only, no OpenCode install.
- `docker-compose.yml`: `looparr` app plus `ts-looparr` Tailscale sidecar.
- `serve.json`: HTTPS 443 for `${TS_CERT_DOMAIN}` proxies to `http://127.0.0.1:3000`.
- `.env.example`: required settings. Copy to `.env`; `.env` is gitignored.
- `scripts/host-executor.js`: host-side OpenCode bridge. It runs on the host, not in Docker.
- `scripts/bridge-client.js`: runs in the container and forwards each step to the host bridge.
- `data/config.json`: runtime config; gitignored.

### Configure

```bash
cd /home/michaelpeele/ai-projects/looparr
cp .env.example .env
chmod 600 .env
```

Set these in `.env`:

- `TS_AUTHKEY`: Tailscale auth key. Use a reusable key and do not make it ephemeral. The Curatarr and Splitarr keys use this pattern. Never commit or print the key.
- `TS_CERT_DOMAIN=looparr.tail0307d.ts.net`: Keep this exact suffix.
- `LOOPARR_EXECUTOR_TOKEN`: Replace the placeholder with `openssl rand -hex 32`.
- `LOOPARR_LOCAL_PORT=4188`: Host debug port for HTTP.
- `LOOPARR_PROJECTS_ROOT=/home/michaelpeele/ai-projects`: Mounted read-write at the same path.
- `PUID=1000`, `PGID=1000`: Keep mounted project files owned by the host user.
- `OPENCODE_PASSWORD`: Optional. Set when the host executor reuses a password-protected OpenCode service on port `4096`.

The Settings page includes an `.env settings` editor. Existing values appear masked as `********`; use the eye button to reveal one value. Only changed keys are saved. Looparr writes to the mounted host `.env`, rereads it, then masks saved values again. Saving an empty value removes that key. Keys read at startup by the host executor require a host executor restart.

### Start

Start the host executor first. It binds only the Docker bridge gateway, not all interfaces.

```bash
npm run executor
```

In another shell:

```bash
docker compose up -d
docker compose ps
```

The app shares the Tailscale container network namespace. Tailscale terminates HTTPS and proxies to the Express server on port `3000`. Local HTTP debug is available at <http://127.0.0.1:4188>.

### Execution model

Execution stays on the host. The container never installs or starts `opencode`.

When a step starts, the container runner calls `scripts/bridge-client.js`. The bridge client posts the existing prompt, project path, and plan file to the Docker bridge gateway on port `4187`, for example `http://172.17.0.1:4187`. The host executor authenticates with the bearer token, requires the project path to be inside `/home/michaelpeele/ai-projects`, runs the real host `opencode` in that directory, and streams stdout/stderr back to Looparr. The host executor manages the shared `opencode serve --port 4096` server the same way local mode does.

`extra_hosts` is not used. It conflicts with `network_mode: service:tailscale` on this Docker host. Discover the gateway with `docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}'` if the default changes.

`HOME=/home/michaelpeele` in the container so the add-project form expands `~` to the mounted host home.

### Persistence and mounted projects

Tailscale state persists in `./looparr-tailscale-data`. Looparr config persists in `./data/config.json`. All of `/home/michaelpeele/ai-projects` is mounted read-write at the same absolute path, so project paths in `config.json` remain valid on both host and container. Looparr writes `plan.md` and `.looparr/next_prompt.txt` through that mount.

### Add a project on the hosted deployment

In the hosted **Add Project** form, use the **Server-side project directory** field. Paths shown and entered are server/container paths, not browser-local paths. The folder dropdown and server-side browser list directories under `LOOPARR_PROJECTS_ROOT`, normally `/home/michaelpeele/ai-projects`. Browse navigates subdirectories under that root; selecting one fills the absolute path. **Add new folder** creates a real directory under the current browse directory, or under the root from the Add Project row. You can also enter an absolute path such as `/home/michaelpeele/ai-projects/example`. The server checks that the path exists and is a directory. `~` expands to `/home/michaelpeele` because the container sets `HOME=/home/michaelpeele`.

If the directory has no valid `plan.md`, Looparr adds it anyway and marks it **Setup Needed**. The project card says to create `plan.md` in the drawer, then press **Start**. The drawer offers a format guide, an **Insert starter plan** button, and an editable `plan.md` textarea. Save the plan there; Looparr reads the saved file through the mount. The host strip reports the number of projects needing setup, or `all configured` when none do.

### Verify

```bash
docker compose config --quiet
docker compose build
BIND=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
curl -fsS "http://$BIND:4187/health"
curl -fsS http://127.0.0.1:4188/api/state
curl -N -i --max-time 3 http://127.0.0.1:4188/api/events
docker exec ts-looparr tailscale serve status
docker exec ts-looparr tailscale funnel status
curl -fsS https://looparr.tail0307d.ts.net/
```

SSE output must include `Content-Type: text/event-stream`, `retry: 3000`, and an initial `event: state`. `tailscale funnel status` must not show a Funnel for `looparr`.

For a planned app rebuild, use the restart helper. It checks `/api/state`, stages opt-in intents through `/api/auto-resume/prepare`, aborts if the app is ungated, then rebuilds and recreates only the `looparr` service:

```bash
npm run restart:looparr -- --dry-run
npm run restart:looparr
```

The helper leaves `data/config.json`, the host executor, and the Tailscale sidecar alone. After a real restart, confirm the served HTML, CSS, and JS contain the change and that container files match local source before treating the deployment as verified.

### Future Funnel

Funnel is not configured. If public access is ever approved, the host command is:

```bash
docker exec ts-looparr tailscale funnel --bg --https=443 --yes http://127.0.0.1:3000
```

Do not run it until the access model is explicitly approved.

## Project layout

```text
looparr/
├── server.js               # Express routes and SSE
├── Dockerfile              # production container image
├── .dockerignore
├── docker-compose.yml      # looparr app + Tailscale sidecar
├── serve.json              # Tailscale Serve config; no Funnel
├── .env.example
├── .env                    # local secrets, gitignored
├── data/
│   ├── .gitkeep
│   └── config.json         # created at runtime, gitignored
├── looparr-tailscale-data/ # created at runtime, gitignored
├── scripts/
│   ├── host-executor.js    # host-side OpenCode bridge
│   └── bridge-client.js    # in-container step client
├── src/
│   ├── config.js           # config.json load/save; CONFIG_PATH aware
│   ├── engine.js           # scheduler, workers, watchers
│   ├── events.js           # in-process event bus
│   ├── icon.js             # icon discovery
│   ├── plan.js             # Markdown checklist parser/edits
│   └── runners/
│       ├── index.js        # runner registry
│       └── opencode.js     # OpenCode CLI or bridge runner
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── logo.svg
│   └── favicon.svg
└── package.json
```

## Git

This repository is initialized locally with an initial commit and no remote. Add a remote only when you want to publish it.
