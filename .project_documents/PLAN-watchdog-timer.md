# Watchdog timer — mapped plan

Status: planned 2026-11-24. Plan item: `(plan) Watchdog timer` in plan.md (replaced by concrete checklist there).

## Decisions from clarifying answers

1. **Alert channel: none external.** The user no longer uses ntfy for this
   ("I use Looparr"). All notification is via failure-only handling in
   `scripts/restart-watchdog.sh`: distinct `FAILED:` log lines in
   `logs/watchdog.log` plus a non-zero exit in direct modes. No ntfy publish,
   no new dependency. `FAILED:` lines are the grep-able alert surface.
2. **Timer units live in the repo**: `systemd/looparr-watchdog.service` and
   `systemd/looparr-watchdog.timer`, persisted and enabled by
   `scripts/install-watchdog-timer.sh` (systemd user units, `--now`,
   `daemon-reload`, `loginctl enable-linger` so the timer survives without an
   active user session).
3. **Review-mode check is required**: every 5th timer cycle additionally runs
   `watchdog:check` (read-only) and records a `review:` line in
   `logs/watchdog.log`. If the fix pass just succeeded but check still reports
   down, log `FAILED: review check` so an off-stack that was not recovered is
   visible. It must never open a second mutate path — the fix pass earlier in
   the same cycle is what recovers an off stack.
4. **Alert/exit-75 logic lives inside `scripts/restart-watchdog.sh`**, not in a
   wrapper: a new `timer` mode in the script owns cycle counting, the
   every-5th review, and exit-code normalization.

## Design

`systemd/looparr-watchdog.timer`

- `OnBootSec=2min`, `OnUnitActiveSec=5min`, `Persistent=true` (missed runs
  after downtime fire once on boot), `Unit=looparr-watchdog.service`.
- No cron fallback unless systemd user units prove unusable on the host.

`systemd/looparr-watchdog.service`

- `Type=oneshot`, `ExecStart=/bin/bash <abs-repo-path>/scripts/restart-watchdog.sh timer`,
  `WorkingDirectory=<abs-repo-path>` (install script rewrites a placeholder to
  the real repo path at install time), `SuccessExitStatus=0 75` as a belt-and-
  braces guard (the script already normalizes, so 75 should never escape).

`scripts/restart-watchdog.sh` — new `timer` mode (fix/check unchanged):

- Accept `timer` in the case statement. Timer mode runs the fix logic under
  the existing restart lock via a `LOOPARR_TIMER_MODE=1`-style re-entry or a
  refactor of the fix body into a function; it never bypasses
  `scripts/restart-lock.sh` and never treats exit 75 as failure.
- Cycle counter in `logs/watchdog-cycle-count` (plain integer, `cut -d' ' -f1`
  of `/proc/uptime`-free simple increment; tolerant of file loss — resets to 1).
- Exit-75 handling: log `busy: restarting/promotion lock held; skipping this cycle`
  and exit 0 (log-only, no FAILED, no noise) — the requirement says log only.
- Other fix failure (compose error, API never answered): the existing
  `FAILED:` log lines already fire; timer mode propagates exit 1.
- Every 5th cycle (counter % 5 == 0): after the fix pass, run the check-mode
  body read-only, log `review: looparr service is up (cycle N)` on exit 0 or
  `FAILED: review check reports the service down (cycle N)` on exit 1 (exit 1
  propagates).
- Direct `fix`/`check` invocations keep their current behavior and exit codes;
  nothing changes for `npm run watchdog:fix` / `watchdog:check`.

`scripts/install-watchdog-timer.sh`

- Resolves the repo root, substitutes the repo path into copies of the unit
  files under `~/.config/systemd/user/`, runs `systemctl --user daemon-reload`,
  `systemctl --user enable --now looparr-watchdog.timer`, and
  `loginctl enable-linger` for the current user (best-effort with a clear
  message if it needs sudo). Idempotent; re-running refreshes the units.
- `--uninstall` path: `disable --now`, remove the installed copies.

## File map

| File | Change |
| --- | --- |
| `systemd/looparr-watchdog.timer` | new — 5-min schedule, Persistent |
| `systemd/looparr-watchdog.service` | new — oneshot calling restart-watchdog.sh timer |
| `scripts/install-watchdog-timer.sh` | new — install/enable/persist units, --uninstall |
| `scripts/restart-watchdog.sh` | add `timer` mode: cycle counter, review check on 5th, exit-75 log-only |
| `scripts/test-watchdog-timer.js` | new — static guards |
| `plan.md` | replace the `(plan)` line with checklist items |
| `.project_documents/PROGRESS.md` | verification record appended |

## Ordered steps

1. Add the `timer` mode to `scripts/restart-watchdog.sh` (counter file, busy
   log-only branch, every-5th review check, failure FAILED lines unchanged).
2. Write `systemd/looparr-watchdog.service` and `systemd/looparr-watchdog.timer`
   with a `__LOOPARR_REPO__` placeholder and documented install-time rewrite.
3. Write `scripts/install-watchdog-timer.sh` (chmod +x; include the watchdog
   log path in the unit via `LOOPARR_WATCHDOG_LOG` if logs/ is bind-mounted
   differently on the host — default repo-relative works).
4. Add `scripts/test-watchdog-timer.js` guarding: both unit files exist and
   reference `restart-watchdog.sh`, the timer has `Persistent=true` and a 5
   minute cadence, the script contains `timer` mode, exit-75 log-only branch,
   and the every-5th review check; register it so `npm test` runs it.
5. Update `plan.md` checklist and run verification.

## Tests

- `node scripts/test-watchdog-timer.js` (new static guards).
- `node scripts/test-restart-watchdog.js` still passes (direct modes untouched).
- `bash -n scripts/restart-watchdog.sh scripts/install-watchdog-timer.sh`.
- `npm test` green overall.
- Host drill (needs host access): `bash scripts/install-watchdog-timer.sh`,
  `systemctl --user list-timers` shows the timer; `docker stop looparr`, wait
  one period (or run `restart-watchdog.sh timer` by hand), confirm recovery,
  `steady:` then `review:` lines in `logs/watchdog.log`; hold the restart lock
  in a shell and confirm a cycle logs `busy:` quietly with no `FAILED:`.

## Acceptance criteria

- The looparr service recovers from an interrupted restart within one timer
  period with no human action; outage window ≤5 min + re-run.
- Schedule is a systemd user timer with `Persistent=true`, installed via
  `scripts/install-watchdog-timer.sh`, and survives host reboot
  (`enable-linger`).
- Every 5th cycle writes a `review:` verification line; an unrecovered off
  stack produces `FAILED: review check`.
- Exit 75 (restart/promotion lock held) logs `busy:` only — never a FAILED
  alert; genuine failures log `FAILED:` and exit non-zero.
- No second independent timer; the restart lock is never bypassed; `npm test`
  passes with the new guards.

## Risks

- systemd user units may need `loginctl enable-linger`; without it the timer
  dies at logout. Mitigation: install script enables linger and reports if
  sudo is required.
- Very old systemd without `OnUnitActiveSec` + `Persistent` interplay —
  fallback to `OnCalendar=*:0/5` if the active-sec form misbehaves.
- Cycle-counter file lives in `logs/`; log rotation must not delete it
  (name it outside the rotated pattern; tolerate a missing file by resetting).
- Timer mode shares the fix path: a bug there could break `npm run
  watchdog:fix`; mitigate by keeping the fix body intact and testing direct
  modes in `test-restart-watchdog.js`.
- The host drill (`docker stop looparr`) is deliberately disruptive — run it
  only when no active executor runs are in flight.
