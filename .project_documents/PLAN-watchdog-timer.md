# Watchdog timer — implementation prompt

Status: open. Plan item: `(plan) Watchdog timer`.
Batch: pairs with `(plan) Promotion concurrency lock` (same incident family).

## Incident this prevents

On 2026-11-23 15:48 UTC a killed agent session process group tore down
`docker compose up -d looparr` mid-recreate. The replacement looparr container
was left in `Created` state — never started, never supervised (`restart:
unless-stopped` does not resurrect a container that never started) — and the UI
was offline for ~46 minutes until a human noticed. Commit `88cb168` already
shipped two guards: the compose rebuild now runs detached and signal-immune in
`scripts/restart-looparr.js`, and `scripts/restart-watchdog.sh` can detect and
recover the outage manually (`npm run watchdog:fix` / `watchdog:check`). What
is still missing is anything that runs the watchdog automatically.

## Goal

A reboot-safe scheduled timer runs the watchdog every few minutes, so an
interrupted restart self-heals within minutes without a human, and failures
that cannot self-heal alert visibly.

## Current building blocks (already implemented in commit 88cb168)

- `scripts/restart-watchdog.sh <fix|check>`
  - `fix` (default): if no looparr container is running and a stopped/created
    looparr compose container exists, re-converges via `docker compose up -d
    looparr` **under the restart lock** (`scripts/restart-lock.sh`, exits 75
    while a promotion/restart is in flight — must be treated as "busy", not as
    failure), then polls `GET http://127.0.0.1:${LOOPARR_LOCAL_PORT:-4188}/api/state`.
  - `check`: read-only, exits 0 when a looparr container is running, exit 1
    when down; never takes the lock, never mutates.
  - Both modes append UTC-prefixed lines to `logs/watchdog.log`.
- npm scripts: `watchdog:fix`, `watchdog:check`.

## Requirements

1. Schedule `npm run watchdog:fix` (or an equivalent direct invocation of
   `bash scripts/restart-watchdog.sh` from the repo root) every 5 minutes.
   Prefer a systemd user timer (`Persistent=true` so missed runs after reboots
   still fire) over a bare crontab entry; if systemd user units are not usable
   in this environment use `cron` `*/5 * * * *` with the output going to
   `logs/watchdog.log` (the script already tees there, so cron logs may go to
   `logs/watchdog-cron.log`).
2. The timer must survive reboots and engine restarts: it lives on the host,
   not in the container, and must not be defined as a Looparr project task.
3. Alert on failure, not on busy: trigger the alert channel (the host already
   runs an `ntfy-router` container — route through the same ntfy topic the iOS
   widgets use, or server-side `docs/` if a different channel is standard)
   only when `watchdog:fix` exits with an error (container started but API
   never answered, compose failed) or when `watchdog:check` exits 1 while no
   active executor run is holding the restart lock. Exit 75 (lock held) is a
   normal "promotion in progress" event: log only, no alert, no noise.
4. Keep the check/fix decision documented: every 5th cycle may additionally
   run `watchdog:check` in review mode for the verification record; do not add
   a second independent timer for the same job.
5. Do not weaken the restart lock: no timer code may bypass
   `scripts/restart-lock.sh` or ignore its exit code 75.
6. Tests: extend `scripts/test-restart-watchdog.js` (or add
   `scripts/test-watchdog-timer.js` in the same style) with static guards: the
   timer unit/crontab file exists and references `restart-watchdog.sh`, the
   failure-only alert branch exists, and exit-75 handling logs without
   alerting. `npm test` must stay green.

## Verification

- `systemctl --user list-timers` (or `crontab -l`) shows the schedule enabled
  and target reachable.
- Live drill: `docker stop looparr`, then run the watchdog in fix mode by hand
  once to confirm the outage path recovers the friendly-named container and
  the API answers; confirm `logs/watchdog.log` records
  `steady:`/`fix:` lines correctly. Restore the timer and confirm it reports
  `steady:` within 5 minutes.
- Stop the looparr container, suppress the watchdog's fix path (e.g. hold the
  restart lock in a test shell), and confirm the alert branch fires or,
  alternatively, exit 75 is logged quietly — no false page for a busy promotion.

## Acceptance criteria

- A stalled/never-started looparr container is detected and recovered
  automatically within one timer period; the UI outage window without human
  intervention drops from "until someone notices" to ≤5 minutes plus re-run.
- Failures that cannot self-heal alert on the chosen channel; promotion-in-
  progress (lock held) never alerts.
- Schedule survives host reboot; `npm test` passes with the new guards.
