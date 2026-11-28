# Client sign-in card on the home page

Status: steps 01–03 implemented and promoted (2026-11-27). Plan 04 verification on 2026-11-28: steps 10–12 passed; step 13 pending — no human-approved Kilo Gateway round or successful Kilo step completed.
Evidence gathered 2026-11-27. Companion spec: [AUTH_FAILURE_UI.md](../AUTH_FAILURE_UI.md).
Executable build steps: [PLAN-auth-signin-card-steps.md](PLAN-auth-signin-card-steps.md).

## Problem

Kilo frequently asks the user to sign in. Today the only recovery is manual:
open the Kilo surface, pick a model, click the link, and complete the device
authorization by hand. Looparr never learns that the client is blocked, so it
keeps selecting the runner and parking steps with a generic
`seed step exited with code 1`.

The requested surface is a card at the top of the home page, above the project
cards, listing the clients that need sign-in again. Its Sign in button starts
the flow, shows friendly client names, animates `Generating code…`, streams the
login log, and ends with a clickable link plus the code the user must present.

## Verified findings

### Kilo auth model

- `kilo auth list` reports one credential, `Kilo Gateway oauth`, stored in
  `~/.local/share/kilo/auth.json` (mode `0600`). The file holds `access`,
  `refresh`, and `expires` for provider `kilo`.
- Login is Gateway OAuth device authorization. The exact method label is
  `Kilo Gateway (Device Authorization)`; an unknown method prints
  `Available: Kilo Gateway (Device Authorization)`.
- **A plain non-TTY login dead-ends.** `kilo auth login -p kilo` with no TTY
  prints only `┌  Add credential` and exits 0 — no URL, no code.
- **A pty makes the flow scriptable.** Verified with
  `script -qec "kilo auth login -p kilo -m 'Kilo Gateway (Device Authorization)'" /dev/null`:

  ```
  ●  Go to: https://app.kilo.ai/device-auth?code=ZRXS-RG87
  ●  Open https://app.kilo.ai/device-auth?code=ZRXS-RG87 and enter code: <long code>
  ◒  Waiting for authorization…
  ```

  The short `?code=` parameter is prefilled in the URL; the long code is a
  separate value the user must present. The process then polls until approved,
  writes `auth.json`, and exits 0. Codes are short-lived; a killed probe leaves
  nothing behind.
- The URL shape is stable enough to parse, but must be treated as untrusted
  text from a child process: only `https://app.kilo.ai/` links may be rendered
  as clickable, and text must stay escaped.

### Current runtime state (why detection cannot be a startup guess)

- The stored Kilo token is valid right now: `GET https://api.kilo.ai/api/gateway/models`
  with the stored bearer token returned `200`, and a live
  `kilo run --auto --format json --model kilo/baidu/ernie-5.5-flash-preview:free "Reply with just: ok"`
  returned `ok` (exit 0).
- The sign-in failures are recorded in `~/.local/share/kilo/log/opencode.log`
  at `2026-11-26T00:53`, across several concurrent sessions in the same minute:
  `AI_APICallError: Your authentication token is invalid. Please sign in again.`
- Consequence: `kilo auth list` only proves a credential exists, not that it is
  accepted. The authoritative trigger for the card is a real step failure whose
  raw output carries the auth signature. Optionally, a later enhancement can
  probe the gateway before a step, but that is not required for the first cut.
- Hypothesis for "frequent": several `kilo run` processes share one
  `auth.json` and may race OAuth refresh-token rotation, invalidating each
  other. This is unproven. Instrument the 401 path (runner, project, pid,
  timestamp) before claiming a fix, and serialize sign-in per client.

### Where the code goes

| Concern | Location today |
| --- | --- |
| Home projects view | `public/index.html` `.view[data-view="projects"]`, `#projects-heading` / `#project-grid` (~116-122) |
| Card styles to reuse | `public/styles.css` `.host-strip`, `.host-item`, `.host-note`, `.card` |
| State application | `public/app.js` `applyState()` (~3261), `updateHostSummary()` (~1343), `renderCards()` |
| Log rendering | `public/app.js` `formatLogText()` (~1743), `addLogEntries()` (~1905); terminal overlay is project-scoped |
| Failure classification | `src/failure.js` `TERMINAL_RE` (401/403/unauthorized/invalid token) |
| Engine failed-close path | `src/engine.js` `handleClose()` (~2630), `handleRecoverClose()` (~2588), `parkStepError()` (~2544) |
| Runner choice | `src/engine.js` `pickRunner()` (~333), `tryNextCandidate()` (~2255) |
| State payload | `src/engine.js` `getState()` (~421), served by `server.js` `GET /api/state` (~359) |
| Host bridge | `scripts/host-executor.js` (`/run`, `/cancel`, `/active`, `/health`), reached with `LOOPARR_EXECUTOR_URL` + token |
| Executor service | `~/.config/systemd/user/looparr-host-executor.service` (`node scripts/host-executor.js`) |

The app container ships no `kilo`/`opencode`/`vibe` binary, so the login action
must run on the host executor. Shipping it therefore needs
`systemctl --user restart looparr-host-executor` in addition to
`npm run restart:looparr`.

## Design

### 1. Auth failure store (`src/auth-failures.js`, new)

Follow [AUTH_FAILURE_UI.md](../AUTH_FAILURE_UI.md) and the persistence pattern in
`src/rotation-store.js`:

- State path from `LOOPARR_AUTH_FAILURES_STATE`, defaulting next to `CONFIG_PATH`.
- Record per runner: `runnerId`, `runnerLabel`, `at` (ISO), `message` (short,
  redacted), `hint`.
- Detection from raw step output using explicit signatures only:
  `INVALID_TOKEN`, `Your authentication token is invalid`, `sign in again`,
  `invalid api key`, `unauthorized`. Do not match a bare `401` inside tool
  output or fetched HTML.
- Helpers: `detect`, `record`, `get`, `list`, `isBlocked`, `clear`.
- Records are sticky: never expire by time, never cleared by restart, cooloff,
  or a new project error. Clear only after a successful step on that runner or
  an explicit human Start.

### 2. Engine wiring (`src/engine.js`)

- Record in the failed-close path while `rt.stepOutput` still holds the child
  output, before it is reset.
- Clear on the successful-close path for `rt.activeRunner`, and when a human
  presses Start (that press asserts reauth).
- Expose `authFailures` in `getState()`.
- Skip blocked runners in `pickRunner()` and in the runner-rotation leg of
  `tryNextCandidate()`. If every configured runner is blocked, stop with a clear
  auth error instead of launching a blocked step.
- Keep the generic park error for non-auth failures; for auth failures prefer a
  phase error that names the client and points at the home card.

### 3. Host executor endpoints (`scripts/host-executor.js`)

- `POST /auth/:runner/login` — start exactly one login session per runner.
  Return `409` when one is already running. Response:
  `{ state, url, code, startedAt }`.
- `GET /auth/:runner/status` — `{ state: idle|starting|waiting|authorized|failed, url, code, startedAt, finishedAt, log: [...] }`
  with a bounded log ring (last ~100 lines, ANSI and spinner frames stripped,
  no token material).
- `POST /auth/:runner/cancel` — terminate the login child.
- Runner adapter table; only `kilo` is implemented first:
  - command: `kilo auth login -p kilo -m "Kilo Gateway (Device Authorization)"`;
  - must run under a pty: spawn via `script -qec <cmd> /dev/null` (verified on
    this host; `/usr/bin/script` exists);
  - parse `Go to: (https://app.kilo.ai/device-auth?code=…)` and
    `enter code: (\S+)`; ignore spinner animation;
  - exit 0 after approval → `authorized`; nonzero or timeout → `failed`.
- One session per runner, and no session for a runner with an active `/run`
  step, so two processes never refresh the same OAuth token concurrently.
- The executor never reads or returns `auth.json` contents; it only reports the
  flow state that the CLI already prints.

### 4. Server proxies (`server.js`)

- `GET /api/auth/clients` — the blocked list merged with executor availability
  and friendly labels.
- `POST /api/auth/:runner/login`, `GET /api/auth/:runner/status`,
  `POST /api/auth/:runner/cancel` — thin authenticated proxies that add
  `LOOPARR_EXECUTOR_TOKEN`. The browser never receives the executor token.
- `404`/`503` when no executor URL is configured, so local dev without a bridge
  degrades to hiding the card rather than breaking the page.

### 5. Home card (`public/index.html`, `public/app.js`, `public/styles.css`)

- New `<section id="auth-card">` inside `.view[data-view="projects"]`, directly
  above `#project-grid`; `hidden` by default.
- Hidden unless at least one client is blocked or a login session is active.
- Content per client:
  - friendly name: `Kilo CLI` from the runner label, with `Kilo Gateway` as the
    detail line (a small label map, not the raw provider id);
  - `AUTH REQUIRED · 401` in the existing red accent;
  - hover `title` with ISO timestamp, runner label/id, short error, and the
    Kilo hint `Open CLI and /models, pick Kilo gateway and reauthenticate.`
    (keep the hint cross-referenced with `AUTH_FAILURE_UI.md`).
- Sign in button:
  - on click, disable and show `Generating code` with an animated ellipsis or
    pixel spinner (reuse the self-heal pixel style);
  - stream the sanitized login log lines into a small monospace block, capped
    and auto-scrolled only while the user is near the bottom;
  - when the URL arrives, render `Open Kilo sign-in` as
    `<a target="_blank" rel="noopener noreferrer">` plus the long code in a
    copyable monospace field, and switch the status to `Waiting for authorization…`;
  - on `authorized`, clear the block, refresh `/api/state`, and hide the card;
  - on `failed`, show the last error line and a Retry button.
- Poll `/api/auth/clients`/`status` every 1-2s only while a session is active;
  stop polling on `authorized`, `idle`, or card close. Reuse the SSE state
  stream for the blocked list itself so `/api/state` stays the single source.
- Keep the existing footer auth note from `AUTH_FAILURE_UI.md`; the card is the
  primary recovery surface, the footer the compact always-visible marker.

### 6. Tests (add to `npm test`)

- `scripts/test-auth-failures.js` — detection signatures, persistence path,
  sticky behavior, clear-on-success/manual Start, blocked-runner skip.
- `scripts/test-auth-login-ui.js` — UI source wiring: card above the grid,
  hidden-by-default, escaped names, https-only link, no token text, polling
  stops, exact Kilo hint/method label.
- `scripts/test-host-auth-login.js` — executor URL/code parsing from a fixture
  pty output, one-session-per-runner, 409, cancel, log sanitization, and a guard
  that the login command includes the pty wrapper and exact method label.
- Extend `scripts/test-failure-classification.js` only if classification
  changes; the auth store must not broaden `TERMINAL_RE` for tool output.

### 7. Rollout and verification

1. Focused tests, then `npm test`, then `git diff --check`.
2. `systemctl --user restart looparr-host-executor`; confirm
   `curl -fsS http://172.17.0.1:4187/health` and a live
   `POST /auth/kilo/login` returns a URL; cancel it without approving.
3. `npm run restart:looparr -- --dry-run`, then `npm run restart:looparr`.
4. Verify health, image id, container source hashes, served HTML/JS/CSS hashes,
   and that `/api/state` carries `authFailures` and `/api/auth/clients` answers.
5. One human-approved live round: click the card link, approve, confirm the
   CLI writes `auth.json`, the card clears, and the next step on that runner
   succeeds. Record evidence in `.project_documents/PROGRESS.md`.

## Non-goals

- No credential entry, token display, or copy of `auth.json` through Looparr.
- No automatic re-login and no unattended approval.
- No OpenCode or Vibe adapter in the first cut. `opencode auth login` exposes
  `--method`/`--answer`, and `vibe --setup` is interactive, but neither has a
  verified capturable device URL yet.
- No change to model/runner catalogues or the free-lane defaults.

## Risks and open questions

- **Refresh rotation race** across parallel runs is a hypothesis; without
  instrumentation a "fix" would be guesswork. Log runner, project, pid, and
  timestamp on every auth failure.
- **False positives**: a successful step can print a fetched page containing
  `401`/`Sign in`. Detection must require the explicit auth phrases and should
  ignore code === 0 output, mirroring the rate-limit success guard.
- **A blocked runner must not brick the dashboard**: with every runner blocked,
  the engine stops with a clear message rather than looping; the card must stay
  actionable.
- **Login during a running step** could still race the token refresh; serialize
  per runner and refuse to start a login while that runner has an active run.
- **Executor is outside container promotion**; forgetting its restart ships a
  UI whose buttons 404. Include it in the checklist above.
- The existing live `plan.md` item "Investigate remaining errors on other
  projects" may be running while this is implemented; do not restart the
  executor underneath an active step.

## Evidence appendix

```
kilo 7.8.32
kilo auth list        -> 1 credentials: Kilo Gateway oauth
                       file ~/.local/share/kilo/auth.json (0600)
kilo auth login -p kilo -m bogus
                       -> Error: Unknown method "kilocode" for kilo.
                          Available: Kilo Gateway (Device Authorization)
kilo auth login -p kilo </dev/null
                       -> "Add credential", exit 0 (no URL; pty required)
script -qec "kilo auth login -p kilo -m 'Kilo Gateway (Device Authorization)'" /dev/null
                       -> Go to: https://app.kilo.ai/device-auth?code=ZRXS-RG87
                       -> enter code: <long code>
                       -> Waiting for authorization…
GET api.kilo.ai/api/gateway/models (stored bearer)
                       -> 200, model catalogue
kilo run --model kilo/baidu/ernie-5.5-flash-preview:free "Reply with just: ok"
                       -> text "ok", exit 0
~/.local/share/kilo/log/opencode.log (2026-11-26T00:53)
                       -> AI_APICallError: Your authentication token is invalid.
                          Please sign in again. (multiple sessions, same minute)
```
