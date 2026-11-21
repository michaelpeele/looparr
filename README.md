# Looparr

Looparr is a local, self-hosted dashboard that drives a three-step Markdown checklist workflow across multiple projects. It uses Node.js, Express, vanilla HTML/CSS/JS, and Server-Sent Events. No build step is required.

> Visual branding is lowercase `looparr`. Package and documentation names keep the `Looparr` capitalization.

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

## Add a project

Use the add form in the dashboard:

- **Folder path**: absolute path to the project directory. `~` is expanded.
- **Name**: optional display name. Defaults to the folder name.
- **Runner**: per-project runner override. Leave at the global default unless needed.

The folder picker can read a directory in some desktop browsers. When it cannot expose an absolute path, it fills the name only; paste the full path manually.

Projects and settings persist in `config.json` next to `server.js`. That file is gitignored. Each project gets a hidden `.looparr/next_prompt.txt` handoff file, also gitignored.

## Workflow

For every unchecked task, Looparr runs three isolated, fresh-session steps via the selected runner:

1. **Seed**: reads `@plan.md`, finds the first unchecked item, and writes a concise analysis prompt to `.looparr/next_prompt.txt`.
2. **Analyze**: executes that prompt and writes a detailed implementation prompt to `.looparr/next_prompt.txt`.
3. **Implement**: executes the implementation prompt, marks the item `- [x]` in `plan.md`, and exits.

Each step runs in the project directory. The CLI attaches `plan.md` with `--file` so the agent can read and edit it. Logs stream live to the project card drawer.

## Settings

- **Max Concurrent Workers**: `2` by default. Set `1` for serial work or `0` for unlimited.
- **Execution Mode**:
  - **Parallel Pool** (default): up to N projects run continuously through their own plans.
  - **Round-Robin**: gives each active project one step per turn so all queued projects advance evenly.
- **Runner**: global default for projects without an override.
- **Rate-limit pause**: `60` seconds by default. Output containing `429`, `rate limit`, `quota`, `usage limit`, or `throttle` pauses only that project, shows a countdown, then retries the same step.

## Dashboard

- Cards show the detected app icon, current phase, exact current task, Up Next preview, and `completed / total` progress. Icons are discovered in `public/`, `src/app/`, `app/`, and `assets/`, and update automatically when a watcher sees a new `favicon.*`, `icon.*`, or image.
- **Start** begins or resumes a project. **Pause** finishes the current step, then holds. **Stop** ends the active step and resets. **Remove** deletes the project from `config.json` only, never from disk.
- Clicking a card opens a drawer with a live checklist, an editable `plan.md` textarea, and streaming stdout/stderr.

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

Register it in `src/runners/index.js`. Registered runners appear in both runner selects immediately. The OpenCode runner is the reference implementation.

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
