# Build steps: client sign-in card

Status: ready to implement — investigation done, no code written yet.
Design and rationale: [PLAN-auth-signin-card.md](PLAN-auth-signin-card.md).
Behavior contract: [AUTH_FAILURE_UI.md](../AUTH_FAILURE_UI.md).
Promotion rules: [PROMOTION.md](PROMOTION.md) and `../workflow.md` (outside
this repo; sandbox first, promote through the helper).

Work the steps in order. Each step lists the files, what to build, and the check
that proves it before moving on. Do not start a later step on a failing check.

The work is split into four plan items in `../plan.md`: 01 covers steps 1–4
(state and engine rules), 02 covers steps 5–6 (host executor sign-in), 03 covers
steps 7–9 (server proxies, home card, promotion), and 04 covers steps 10–13
(smoke, live probe, human-approved sign-in round, record). Step 0 is a one-time
preflight at the start of 01.

## Ground rules

- Detection only from raw step output of a failed run. Never from
  `auth.json` presence, `kilo auth list`, or a startup probe.
- Sticky blocks: no timeout, cooloff, restart, or new project error may clear
  them. Only a successful step on that runner or an explicit human Start.
- No token, `auth.json` content, or executor token reaches the browser. Only
  `https://app.kilo.ai/` URLs are clickable; all text stays escaped.
- One login session per runner, and never while that runner has an active step.
- The app container has no runner binaries: all login work runs on the host
  executor.
- Sandbox the build and test work before any promotion. Never run raw
  `docker compose build`/`up`.

## 0. Preflight

```bash
git status --short
curl -fsS http://172.17.0.1:4187/health
systemctl --user status looparr-host-executor --no-pager
```

Proceed only when the working tree is understood and the executor is healthy.
Do not restart the executor (step 12) while a project step is running.

## 1. Auth failure store — `src/auth-failures.js` (new)

Follow `src/rotation-store.js`: state path from `LOOPARR_AUTH_FAILURES_STATE`,
defaulting next to `CONFIG_PATH`; atomic write via `.tmp` + `renameSync`; ensure
the parent directory exists; mode `0600`.

- Record: `runnerId`, `runnerLabel`, `at` (ISO), `message` (short, redacted),
  `hint`.
- Detection signatures (explicit only): `INVALID_TOKEN`,
  `Your authentication token is invalid`, `sign in again`, `invalid api key`,
  `unauthorized`. Do not match a bare `401` in arbitrary output.
- Hint map: Kilo →
  `Open CLI and /models, pick Kilo gateway and reauthenticate.`
- Export: `detect`, `extractMessage`, `hintFor`, `record`, `get`, `list`,
  `isBlocked`, `clear`.
- Records never expire by time.

Check: `node --check src/auth-failures.js`, plus a throwaway script that records
and reloads from a temp `LOOPARR_AUTH_FAILURES_STATE`.

## 2. Store tests — `scripts/test-auth-failures.js` (new)

Cover: each signature positive; benign tool output with `401`/`Sign in` in
fetched HTML negative; persistence across a re-require with a temp state path;
sticky behavior across simulated restart/cooloff; clear on success and on
manual Start; `isBlocked` false for unknown runners.

Check: `node scripts/test-auth-failures.js` exits 0. Do not add it to
`package.json` yet (step 9 wires the chain once).

## 3. Engine wiring — `src/engine.js`

- Record in the failed-close path (`handleClose` ~2635, and `handleRecoverClose`
  ~2590) while `rt.stepOutput` still holds the child output.
- Clear on the successful-close path for `rt.activeRunner`, and on the human
  Start action (that press asserts reauth).
- Expose `authFailures` in `getState()` (~422) so `/api/state` carries it.
- Skip blocked runners in `pickRunner()` (~334) and in the rotation leg of
  `tryNextCandidate()` (~2259).
- If every configured runner is blocked, stop with a clear auth error naming
  the client and pointing at the home card. Never launch a blocked runner.
- Keep the generic park error for non-auth failures.

Check: targeted test in step 4; `node --check src/engine.js`.

## 4. Engine behavior tests

Extend the step 2 script (or add `scripts/test-auth-failures-engine.js`) for:
failed-close records while output is present; success clears; Start clears;
blocked runner is not chosen by `pickRunner`; all-blocked produces the auth
stop, not a launched step.

Check: the script exits 0.

## 5. Host executor auth endpoints — `scripts/host-executor.js`

- `POST /auth/:runner/login` → `{ state, url, code, startedAt }`; `409` when a
  session for that runner is already running.
- `GET /auth/:runner/status` → `{ state: idle|starting|waiting|authorized|failed, url, code, startedAt, finishedAt, log }`,
  log is a bounded ring (~100 lines) with ANSI/spinner frames stripped.
- `POST /auth/:runner/cancel` → terminate the child.
- Kilo adapter: `kilo auth login -p kilo -m "Kilo Gateway (Device Authorization)"`
  spawned under a pty via `script -qec <cmd> /dev/null` (plain non-TTY
  dead-ends). Parse `Go to: (https://app.kilo.ai/device-auth?code=\S+)` and
  `enter code: (\S+)`.
- Exit 0 after approval → `authorized`; nonzero or timeout → `failed`.
- One session per runner and refuse to start a login while that runner has an
  active `/run` step. Never read or return `auth.json`.
- Route dispatch belongs next to the existing `handleRun`/`handleCancel`
  handlers and must keep the existing token check (`authorized(req)`).

Check: `node --check scripts/host-executor.js`, then a fixture test (step 6).

## 6. Executor test — `scripts/test-host-auth-login.js` (new)

Fixture pty output → URL and code parsed. Assert: one session per runner, `409`
on a second login, cancel works, log sanitization drops ANSI/spinner and any
token-looking text, the login command includes both the pty wrapper and the
exact method label.

Check: script exits 0.

## 7. Server proxies — `server.js`

- `GET /api/auth/clients` — blocked list merged with executor availability and
  friendly labels (`Kilo CLI`, detail `Kilo Gateway`).
- `POST /api/auth/:runner/login`, `GET /api/auth/:runner/status`,
  `POST /api/auth/:runner/cancel` — thin authenticated proxies adding
  `LOOPARR_EXECUTOR_TOKEN`; the browser never sees that token.
- `404`/`503` when `LOOPARR_EXECUTOR_URL`/token is missing, so local dev
  without the bridge hides the card instead of breaking the page.
- Reuse the executor fetch pattern already used by
  `POST /api/projects/:id/selfheal/merge` (~895).

Check: `node --check server.js`; manual `curl` of `/api/auth/clients` with and
without executor env.

## 8. Home card UI — `public/index.html`, `public/app.js`, `public/styles.css`

- `<section id="auth-card">` inside `.view[data-view="projects"]`, directly
  above `#project-grid`; `hidden` by default; visible only when a client is
  blocked or a login session is active.
- Per client: friendly name, `AUTH REQUIRED · 401` in the existing red accent,
  hover `title` with ISO timestamp, label/id, short error, and the exact Kilo
  hint. Escape every interpolated value.
- Sign in button: disable on click and show animated `Generating code…` (reuse
  the self-heal pixel style); stream sanitized log lines into a capped
  monospace block that auto-scrolls only when the user is near the bottom.
- On URL: `Open Kilo sign-in` as
  `<a target="_blank" rel="noopener noreferrer">` plus the long code in a
  copyable monospace field; status `Waiting for authorization…`.
- On `authorized`: clear the block, refresh `/api/state`, hide the card.
- On `failed`: last error line plus Retry.
- Poll status every 1–2s only while a session is active; stop on
  `authorized`/`idle`/close. The blocked list itself comes from `/api/state`.
- Keep the existing footer warning (`updateHostSummary`, ~1343); the card is the
  primary recovery surface.

Check: `node --check public/app.js` (if module-safe) and the source-wiring test
in step 9.

## 9. UI wiring test and suite wiring

`scripts/test-auth-login-ui.js` (new): card sits above the grid, hidden by
default, names escaped, https-only link, no token text, polling stops, exact
Kilo hint and method label present.

Then append the three new scripts to the `npm test` chain in `package.json`
after the closest related entries (`test-failure-classification.js`,
`test-rate-limit-*`).

Check:

```bash
node scripts/test-auth-failures.js
node scripts/test-auth-login-ui.js
node scripts/test-host-auth-login.js
npm test
git diff --check
```

All must be clean before any promotion attempt.

## 10. Sandbox smoke

Run the app from the sandbox copy with an isolated `LOOPARR_AUTH_FAILURES_STATE`
and `CONFIG_PATH`, a missing executor URL (card hidden, no errors), and a fake
executor serving fixture `/auth/*` responses (card visible, log streams, URL and
code rendered, cancel works). Confirm `/api/state` contains `authFailures` and
that no token text appears in served HTML/JS.

## 11. Live executor verification

```bash
systemctl --user restart looparr-host-executor
curl -fsS http://172.17.0.1:4187/health
curl -fsS -X POST -H "x-looparr-token: $LOOPARR_EXECUTOR_TOKEN" \
  http://172.17.0.1:4187/auth/kilo/login
```

Expect a real device URL and long code, then cancel without approving. Confirm
the second login returns `409` while the first is running.

## 12. Promotion

Follow `PROMOTION.md` exactly:

1. `npm run restart:looparr -- --dry-run` — expect the dry-run line, no Docker
   call.
2. `npm run restart:looparr` — expect the `looparr-promote` transient unit,
   health wait, and active-run postcheck.
3. Confirm container healthy, image id recorded.
4. Container source hashes match local for `src`/`public`/`scripts` (root-owned
   `0711` scripts via `docker exec -u 0`).
5. Served `/`, `/styles.css`, `/app.js`, `/favicon.svg` hash-match local
   `public/`; served `/app.js` contains the auth-card code.
6. `/api/state` returns `projects`, `settings`, and `authFailures`;
   `/api/auth/clients` answers (or degrades cleanly with no executor).
7. `npm run watchdog:check` clean.
8. Append the promotion log entry.

Remember the executor restart is outside `npm run restart:looparr`; skipping it
ships buttons that 404.

## 13. Live round and record

One human-approved round: click the card link, approve in the browser, confirm
the CLI writes `auth.json`, the card clears, `/api/state` no longer lists the
runner, and the next step on that runner succeeds. Then record evidence in
`.project_documents/PROGRESS.md`, tick the "Client sign-in card" item in
`plan.md`, and update the status line of
[PLAN-auth-signin-card.md](PLAN-auth-signin-card.md).

## Failure handling

- Card 404s after promotion → the host executor was not restarted; restart it
  and re-verify, do not rerun the whole promotion.
- Card never appears though a step failed with auth → detection signature or
  the failed-close record point is wrong; check `rt.stepOutput` at the failure
  site, not the generic `seed step exited with code 1`.
- All runners blocked → engine must stop with the auth error; the card must
  still render and be actionable.
- Login races a running step → the executor must refuse (`409`); do not relax
  that to make a manual test pass.
- Promotion stall → stop `looparr-promote.service` and follow the stalled
  runbook in `PROMOTION.md`; never fall back to raw compose.

## Out of scope

Credential entry, token display, automatic re-login, unattended approval,
OpenCode/Vibe adapters in the first cut, and any change to model or runner
catalogues.
