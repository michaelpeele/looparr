# 05 — Verification, rollback, and rollout

Status: draft — implementation plan.

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
