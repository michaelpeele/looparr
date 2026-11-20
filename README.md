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

## Project layout

```text
looparr/
├── server.js               # Express routes and SSE
├── src/
│   ├── config.js           # config.json load/save
│   ├── engine.js           # scheduler, workers, watchers
│   ├── events.js           # in-process event bus
│   ├── icon.js             # icon discovery
│   ├── plan.js             # Markdown checklist parser/edits
│   └── runners/
│       ├── index.js        # runner registry
│       └── opencode.js     # OpenCode CLI runner
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
