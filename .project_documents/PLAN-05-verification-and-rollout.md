# 05 — Verification, rollback, and rollout

Status: done — verified 2026-11-26, production promotion passed (see Promotion log in PROMOTION.md).

Estimate: 1 day.

Depends on: PLAN-03 and PLAN-04.

## Goal

Prove the full Paseo transport path in sandbox, verify production deployment, and define rollback.

## Current behaviour (verified)

- Root `plan.md` requires production deploy verification for source changes.
- Existing plan docs require sandbox-first work and promote only verified files.
- `.looparr/next_prompt.txt` does not currently exist.
- Paseo daemon is systemd-supervised and healthy on `127.0.0.1:6767` with relay enabled.
- Paseo OpenCode diagnostic reports `Status: Ready`.

## Requirements

- Run all focused tests added in tasks 01–04.
- Confirm direct mode still works for `opencode`, `kilo`, and `vibe` with `paseoTransport=false`.
- Confirm Paseo mode works for all three runners with `paseoTransport=true`.
- Confirm cancellation stops the Paseo agent.
- Confirm stale-run cleanup stops the Paseo agent.
- Confirm mobile visibility for each runner.
- Keep host-executor/bridge mode on direct CLI until separately designed.
- Roll back by setting `paseoTransport=false`; direct mode must remain unchanged.

## Implementation by file

- Tests under `scripts/` for full transport path.
- `.looparr/next_prompt.txt` handoff after each completed task.
- `plan.md`: mark the Paseo transport item complete only after production verification.

## Verification

Sandbox first:

- Copy repo to `/tmp/opencode/looparr-sandbox` or an approved sandbox.
- Run the project test command.
- Run one harmless Looparr task per runner with Paseo transport on.
- Check Paseo state:
  - `paseo status --json`
  - `paseo agent ls --label looparr=true --json`
  - `paseo agent inspect --json <agentId>`

Production, per root `plan.md`:

- `docker compose build looparr && docker compose up -d looparr`
- Confirm container is healthy/running on the new image.
- Confirm served HTML/CSS/JS contain the setting UI change.
- Confirm container files match local source timestamps/content.
- Only then mark the plan item complete and write handoff.

## Done criteria

All tests pass in sandbox, production verification passes, mobile view works for all three runners, and rollback is a single setting change.

## Verification results (2026-11-26)

- Focused tests: `node scripts/test-paseo-transport-setting.js`,
  `node scripts/test-paseo-transport.js`, `node scripts/test-opencode-provider.js`,
  `node scripts/test-opencode-session.js`, `node scripts/test-runner-payload.js` — all passed.
  `npm test` green in the repo and in the sandbox copy
  `/tmp/opencode/looparr-sandbox` (`.git`, `node_modules`, `.tmp-*` excluded).
  `git diff --check` clean.
- Paseo mode (`paseoTransport=true`), host-side scratch engine on
  `127.0.0.1:4600` without `LOOPARR_EXECUTOR_URL`, one harmless task per
  runner: `paseo agent ls --label looparr=true --json` showed each agent
  labeled `looparr=true`, `runner=opencode|kilo|vibe`, `runKey=…`,
  `projectId=…`; `paseo agent inspect --json <id>` reached terminal status
  (`idle`/`closed`). Runner→provider mapping confirmed live:
  `opencode`→`opencode`, `kilo`→`kilo`, `vibe`→`mistral-vibe`.
- Environment fix found during verification: the Paseo daemon's opencode
  provider (`@opencode/client` inside paseo 0.17.3) requires
  `Promise.withResolvers` (node 22+); host node is v20, so opencode agents
  failed with `AGENT_CREATE_FAILED`. Fixed with a user-level systemd drop-in
  `paseo-daemon.service.d/override.conf` setting
  `NODE_OPTIONS=--require=/home/michaelpeele/.paseo/promise-withresolvers-polyfill.js`
  (polyfill file at `~/.paseo/promise-withresolvers-polyfill.js`). Daemon
  restarted and healthy; opencode agents then created and ran to completion.
  This is host-level config, not a repo file; reapply if the daemon unit or
  paseo is reinstalled or the host node upgrades to 22+ (drop-in can be removed).
- Direct mode (`paseoTransport=false`): one task per runner spawned the direct
  CLI (`opencode run …`, `kilo run …`, `vibe --prompt …`); no new Paseo agents
  were created (agent count unchanged before/after).
- Cancellation: per runner, a running Paseo agent was cancelled via project
  Stop; the agent left `running` within seconds (`paseo agent inspect` shows
  the terminal state). Stale-run cleanup: an agent labeled with the project's
  `projectId` but a foreign `runKey` was stopped by `cleanStaleRuns` within
  ~5s of the next engine run for that project.
- Mobile visibility: Playwright at 390x844 (mobile, touch): hamburger nav →
  Settings → `#paseo-transport` checkbox visible, enabled, and toggling
  (screenshot `/tmp/looparr-p05/mobile-paseo-setting.png`, scratch area). The
  setting is global; it applies to all three runners (exercised live above).
- Host-executor/bridge: `paseoTransport.isEnabled({paseoTransport:true})`
  returns `false` with `LOOPARR_EXECUTOR_URL` set (live check), asserted in
  `scripts/test-paseo-transport.js`; bridge runs stay on direct CLI.
- Rollback: `paseoTransport=false` returns to direct CLI for all runners;
  direct mode verified unchanged. Documented in README.md.
