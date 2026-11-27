# Promotion restart hang — mitigation plan

Status: proposed. Plan item: bounded, diagnosable `docker compose up -d looparr` during promotion.
Batch: Desktop layout and drawer batch (before the GitHub tasks).

## Incident this prevents

On 2026-11-26 at `14:24:08Z`, `npm run restart:looparr` launched the promotion through
`systemd-run --user --unit=looparr-promote --wait --collect`. The build finished, then
`docker compose up -d looparr` stopped making progress.

- Script log last line: `Running as unit: looparr-promote.service; invocation ID: a769f30d15f54f428fa250027075ab7d`.
- Unit main PID: `docker compose up -d looparr`, alive ~15 min, `WCHAN=futex_wait_queue`, `0% CPU`.
- Docker daemon journal last activity: `14:29:50Z`, `copy stream failed` on stdout/stderr.
- `/api/state` reset: old container `9ac09bb3ab7a...` stopped and task-deleted; no confirmed new start.
- User journal for `looparr-promote.service` was empty, so no unit log survived.
- Manual stop: `systemctl --user stop looparr-promote.service`. Script exited `130` with `DOCKER_RESTART_FAILED`.

No raw `docker compose` command was run by the agent. Promotion must still go through
`npm run restart:looparr`.

## Goal

Bound the `up` phase, keep its output, release the restart lock, and give the watchdog a
clear recovery trigger. A hung recreate must fail fast with evidence instead of holding the
lock for the full 900 s and leaving prod down.

## Requirements

1. Split the compose invocation in `scripts/restart-looparr.js` into build and up phases.
   Keep both inside the existing `flock` guard and the `looparr-promote` systemd unit.
2. Wrap only the up phase with a deadline, e.g. `timeout --signal=TERM --kill-after=30s 300s docker compose up -d looparr`.
   Keep the deadline shorter than `LOCK_TIMEOUT=900` so the lock cannot be held for the
   full timeout window.
3. Capture compose stdout/stderr to a per-invocation log path and print its tail on failure.
   Include `docker compose ps looparr`, `docker inspect looparr --format '{{.State.Status}}'`,
   and a bounded `journalctl -u docker.service --since <start> --no-pager -n 200` excerpt in
   the error output. Do not stream unrelated daemon history.
4. On up timeout or nonzero exit, run the existing one-shot created/exited/dead recovery.
   Recheck running state after recovery. If still not running, emit the existing structured
   error `DOCKER_RESTART_FAILED` with `status`, `phase: up`, and log path.
5. Ensure the `flock` trap releases `/tmp/opencode/looparr-restart.lock` on timeout, signal,
   and failure. Add a test assertion that a timed-out up does not leave the lock held.
6. Coordinate with the existing watchdog item in `plan.md`: failed promotion should call
   `npm run watchdog:fix -- fix` (or an equivalent one-shot start) after the bounded failure.
   Keep `npm run watchdog:check` read-only.
7. Make watchdog `fix` probe `/api/state` even when a compose container is already running.
   Current `fix` exits `steady` on a running container, so an API-only outage is not repaired.
8. Add a manual runbook to `PROMOTION.md`: stop the unit with
   `systemctl --user stop looparr-promote.service`, then retry with `npm run restart:looparr`.
   Never substitute raw `docker compose build/up`.

## Acceptance criteria

- A hung `docker compose up -d looparr` fails within the configured deadline, not 15+ minutes.
- Failure output includes phase, status, state, log path, and a bounded Docker journal excerpt.
- The restart lock is released after timeout and after recovery failure.
- One recovery attempt runs for created/exited/dead containers before final failure.
- `npm test` passes with new stubbed timeout/recovery coverage.
- `git diff --check` clean.

## Verification

- Incident reproduced twice on 2026-11-26:
  - `14:24:08Z` run hung in `docker compose up -d looparr`; stopped manually after `15min 14.466s`, exit `130`.
  - `14:40:39Z` retry hung again; harness killed wrapper at 600s (`SIGKILL`), then unit was stopped manually.
- Both hangs left `/api/state` reset and no Docker journal entries for the stuck `up` phase.
- `npm run watchdog:fix` needs the explicit `fix` arg: `npm run watchdog:fix -- fix`.
  Recovery failed once on a container marked for removal, then container `2087ee86b7f8` was running.
- Final read-only checks: `curl http://127.0.0.1:4188/api/state` answered; `npm run watchdog:check` steady;
  served `/app.js` and `/styles.css` hashes matched local files.
- Container source hash check skipped to honor the no-raw-docker constraint.
- Implementation and tests remain open; this document proposes the mitigation only.
