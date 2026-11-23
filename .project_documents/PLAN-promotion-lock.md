# Promotion concurrency lock — implementation prompt

Status: open. Plan item: `(plan) Promotion concurrency lock`.
Batch: Desktop layout and drawer batch (before the GitHub tasks).

## Incident this prevents

On 2026-11-23 two `docker compose up -d looparr` runs raced: the host executor
was mid-promotion for an engine-driven implement step while a manual deploy
recreated the container. The replaced container was left in `Created` state —
not started — so Tailscale Serve proxied nothing and prod was unreachable from
iOS for ~15 minutes. `docker compose` gives no error for this race: the second
invocation "succeeds" while the new container never starts.

## Goal

Every promotion path goes through one guarded command, and a container left in
`Created` state is detected and recovered automatically.

## Requirements

1. Single promotion entry point: `npm run restart:looparr` (`scripts/restart-looparr.js`).
   It already takes a restart lock (`LOOPARR_RESTART_LOCK_PATH`) and prepares/auto-resumes
   projects. Raw `docker compose build looparr && docker compose up -d looparr` must not be
   used for promotion anymore.
2. Lock coverage: the helper's lock must actually serialize the rebuild+recreate
   (verify a second concurrent invocation waits or fails cleanly instead of racing).
   If the current lock only guards state capture, extend it to cover the whole
   `docker compose` invocation.
3. Created-not-started recovery: before the helper reports success, check
   `docker inspect looparr` — `State.Status` must be `running` (or the healthcheck
   must report healthy within the healthcheck start period). If the container is
   `Created`/`exited`, fail loudly with the `docker logs` tail and attempt one
   `docker compose start looparr` recovery.
4. Implement prompts that end with a promotion step must instruct the runner to
   use the helper (update the default template text and README promotion docs) —
   fix (2026-11-23): template says run `npm run restart:looparr` for promotion
   iff prod rebuild is required; engine/session-driven deploys use the same path.
5. Tests: extend the restart-helper test to cover (a) lock rejection of a second
   concurrent run, (b) the created-not-started detection and recovery branch,
   using the existing docker stub pattern (`test-auto-resume.js` BIN_DIR stub).

## Acceptance criteria

- Two simultaneous promotions cannot leave `looparr` unstarted.
- A `Created`-state container after promotion is detected, recovered, or escalates loudly.
- `npm test` passes with the new helper coverage.
