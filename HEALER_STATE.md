# Healer state for future errors

This is the agent handoff for the Looparr healer. It answers one question:
before a future primary error, is the standby ready to start a healer round?

The short answer: the managed host standby must be **active, armed, and idle**,
and prod must stay view-only. A stopped standby will not heal future errors.

## Invariants

- Prod is view-only. Do not set `LOOPARR_SELFHEAL=1` in prod.
- The host standby writes status files and runs healer rounds.
- One error gets one healer round. No automatic second round.
- Healer edits happen only in a throwaway worktree on a
  `looparr-selfheal-<run-id>-<attempt>` branch.
- Merge is human-gated. Looparr never pushes.
- Do not drive project tasks from the standby browser UI.

## Ready state before future errors

Check all of these before leaving the system for another agent or before waiting
for a new error.

```bash
npm run selfheal:status
systemctl --user is-active looparr-selfheal
systemctl --user is-enabled looparr-selfheal
curl -fsS http://127.0.0.1:4400/api/state
curl -fsS http://172.17.0.1:4187/health
docker ps --filter name=looparr-heal --format '{{.Names}} {{.Status}}'
git worktree list
```

Expected ready result:

- `npm run selfheal:status` reports `state=running`.
- PID is non-empty.
- `port=4400` and `bind=127.0.0.1`.
- `hostname=looparr-heal-host`.
- `git=ok` and `docker=ok`.
- `armed=on` and `daemon_armed=on`.
- `systemctl --user is-active looparr-selfheal` reports `active`.
- `systemctl --user is-enabled looparr-selfheal` reports `enabled`.
- `http://127.0.0.1:4400/api/state` returns JSON with
  `selfHealingAvailable:true`.
- `http://172.17.0.1:4187/health` returns `{"ok":true,...}`. The host executor
  is a separate service and is required for the prod merge relay.
- No `looparr-heal` container exists between rounds.
- No unfinished healer worktree exists. Branches kept for review are expected;
  active worktrees are not.
- The project status files under `.looparr/selfheal/status/` are fresh and show
  `idle`, or a completed `healed`/`error` state. A live standby writes a
  heartbeat every 60 seconds. Stale means older than 30 minutes.
- Prod is healthy and view-only: `docker ps` shows `looparr` healthy, and prod
  does not carry `LOOPARR_SELFHEAL=1`.

A stopped standby is not ready. A clean stop sends `SIGTERM` and exits zero. The
systemd unit uses `Restart=on-failure`, so a clean stop stays stopped.

After maintenance, restart and recheck:

```bash
npm run selfheal:restart
npm run selfheal:status
```

Use `systemctl --user restart looparr-selfheal` when changing the systemd unit.
Then repeat the full ready-state checklist.

## State during a round

A fresh foreign errored checkpoint can start one healer round. During that
round:

- `.looparr/selfheal/status/<projectId>.json` moves through `debugging`, then
  `healing`, then `healed` or `error`.
- The branch is `looparr-selfheal-<run-id>-<attempt>`.
- The worktree is `.looparr/selfheal/<run-id>-<attempt>`.
- Runner logs are under `data/selfheal/logs/<projectId>/`.
- The `looparr-heal` preview container may exist only during validation. It
  starts after the log line `⚙ Self-heal edits complete; validating <branch>.`
  and is removed after validation.
- The analysis file is `.looparr/selfheal/<run-id>-<attempt>-analysis.md`.
- Only the branch remains for human review.

`idle`, `debugging`, `healing`, `healed`, and `error` are valid status states.
There is no `failed` status state. An interrupted `debugging` or `healing` round
restores as `error`.

Do not start a second round by hand while a round is live. Do not delete a
healer branch or worktree without human review.

## Testing and updates for agents

1. Record the baseline: `git status --short` and `npm run selfheal:status`.
2. Edit only the main checkout. Do not edit files inside healer worktrees.
3. Add or update focused tests for the behavior changed.
4. Run the self-heal suite when healer behavior changed:

   ```bash
   node scripts/test-self-heal.js
   node scripts/test-selfheal-status.js
   node scripts/test-auto-resume.js
   node scripts/test-selfheal-daemon.js
   ```

5. Run the full gate:

   ```bash
   npm test
   git diff --check
   ```

6. If healer behavior changed, test a controlled foreign-error round. Confirm
   status transitions, preview startup and teardown, analysis output, retained
   branch, and return to fresh `idle`.
7. Promote only through `.project_documents/PROMOTION.md`. Include the dry run,
   restart, health/image checks, source hashes, served asset hashes,
   `/api/state`, and watchdog check.
8. After any restart, repeat the ready-state checklist. A prod restart does not
   prove the standby is active.

## Final state before handoff

Before telling another agent the work is done:

- `npm test` is green.
- `git diff --check` is clean.
- Standby is active, armed, and idle.
- Status files are fresh and valid.
- No preview container is running.
- No unfinished healer worktree is present unless retained for human review.
- Host executor health check passes.
- Prod container is healthy and view-only.
- Promotion log is appended if promotion happened.
- `.looparr/next_prompt.txt` or handoff docs carry anything the next session
  needs.

## Known drift observed on 2026-11-25

At observation time, `npm run selfheal:status` reported `state=stopped` with an
empty PID. `systemctl --user is-active looparr-selfheal` reported `inactive`.
`curl http://127.0.0.1:4400/api/state` refused the connection. The latest
project status file was stale in `debugging`/`phase=seed`. Two healer worktrees
remained.

That state is not ready. Future prod errors would log that self-heal is
unavailable and would not start a healer round. Treat it as drift, then restore
and verify the ready state above.

## Resolved on 2026-11-26

The stale status files and unfinished healer worktrees were removed. The live
Kilo 401 checkpoint was left suppressed in `.looparr/selfheal/round-state.json`
so starting standby would not spawn another round for the same digest. Standby
was then started and verified active, armed, and idle. One fresh `idle` status
file exists. Host executor health, standby API health, preview-container
absence, and single-worktree state were rechecked after the checkpoint cadence.
Preserve that ready state before handoff.

Canonical behavior remains in `SELFHEALING.md`. Canonical promotion rules remain
in `.project_documents/PROMOTION.md`.
