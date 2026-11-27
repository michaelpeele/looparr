# Plan: Promotion concurrency lock

Source task: `(plan) Promotion concurrency lock — see [PLAN-promotion-lock.md](.project_documents/PLAN-promotion-lock.md)`.

Prior document is marked complete and verified on 2026-11-25. This plan re-maps the work with the clarified decisions: rerun verification before closing, second concurrent promotion blocks and waits, success requires healthcheck healthy, and promotion wording must be verified before completion.

## Design

1. Single guarded path.
   - All production promotion goes through `npm run restart:looparr` (`scripts/restart-looparr.js`).
   - Raw `docker compose build` or `docker compose up` stays forbidden for Looparr itself.
   - The lock must cover the whole rebuild and recreate operation, not only state capture or preflight.

2. Block-and-wait lock.
   - `scripts/restart-lock.sh` changes ordinary contention from fail-fast to blocking wait.
   - Keep `LOOPARR_RESTART_LOCK_PATH` and `LOOPARR_RESTART_LOCK_HELD=1`.
   - Keep the lock file descriptor held until the wrapped child exits.
   - A waiting invocation logs wait start and acquisition, then runs its own promotion after release. It must not reuse stale state from the first promotion.
   - Keep a bounded wait for stuck locks. On timeout, log `PROMOTION_LOCK_HELD`, append to `logs/promotions.log`, and exit clearly. Do not treat normal contention as an error.

3. Health-gated success.
   - Success requires `State.Status == running` and healthcheck status `healthy` inside the configured start period.
   - `running` or `up` from `docker compose ps` alone is not success.
   - If health stays `starting`, `unhealthy`, unknown, or the start period expires, run the recovery path, then fail with the last 60 container logs and `CONTAINER_RECOVERY_FAILED` if still unhealthy.

4. Created-not-started recovery.
   - Keep `docker inspect looparr --format '{{.State.Status}}'`.
   - Keep recovery calls before API preflight, after the detached compose command, and as fallback after failed health wait.
   - Handle `created`, `exited`, and `dead` with exactly one `docker compose start looparr`, then poll for running and healthy.
   - On failed recovery, print `docker logs --tail 60 looparr` and `CONTAINER_RECOVERY_FAILED`.

5. Promotion wording.
   - Verify `README.md`, `src/config.js` analyze/seed templates, `src/engine.js` promotion rule injection, and any implementation template that mentions promotion.
   - Explicit wording must say engine/session-driven deploys of Looparr use `npm run restart:looparr -- --dry-run` then `npm run restart:looparr`; no raw compose.
   - State the helper path only when a production rebuild is required, matching the existing 2026-11-23 note.
   - Update wording where that statement is missing.

## File map

- `scripts/restart-looparr.js`: health gate, recovery phases, lock-wrapper invocation, detached/systemd-run path.
- `scripts/restart-lock.sh`: blocking acquisition, wait logging, bounded timeout, lock ownership.
- `scripts/test-restart-watchdog.js`: static guards for lock, health gate, recovery, signal handling, detached compose, watchdog.
- `scripts/test-promotion-lock.js` or equivalent docker-stub test: dynamic lock-wait, health, and recovery behavior; reuse `scripts/test-auto-resume.js` `BIN_DIR` stub pattern.
- `src/config.js`: analyze/seed wording and `ANALYZE_PROMOTION_LINE`.
- `src/engine.js`: `PROMOTION_RULE_LINES`, `promotionRuleBlock()`, `injectPromotionRule()`.
- `README.md`: operator-facing promotion commands.
- `.project_documents/PLAN-promotion-lock.md`: prior verified incident and acceptance record.
- `plan.md`: replace stale `(plan)` task with concrete generated checklist tasks; mark them complete only after verification.
- `.project_documents/PROMOTION.md`: mandatory production deploy procedure.
- `scripts/validate-handoff.js`, `.looparr/next_prompt.txt`: handoff validation and next-session input; no behavior change expected.

## Ordered steps

1. Baseline re-verify prior completion: run `node scripts/test-restart-watchdog.js`, `npm test`, and `git diff --check`. Record failures before edits.
2. Change `scripts/restart-lock.sh` to block and wait for the lock; add wait/acquire logging and bounded timeout for stuck locks. Preserve `logs/promotions.log` and `PROMOTION_LOCK_HELD` for timeout only.
3. Confirm `scripts/restart-looparr.js` wraps the full `docker compose build looparr && docker compose up -d looparr` sequence under the lock, including systemd-run and detached fallback paths.
4. Add explicit healthcheck-healthy gating in `scripts/restart-looparr.js`; do not return success on `running` without `healthy`.
5. Retain and harden Created/exited/dead recovery: one start attempt, polling, 60-line log tail, `CONTAINER_RECOVERY_FAILED`, and no duplicate compose up from a waiting promotion.
6. Verify promotion wording in `README.md`, `src/config.js`, `src/engine.js`, and any implementation template. Update missing explicit engine/session-driven helper wording.
7. Extend static tests in `scripts/test-restart-watchdog.js` for blocking lock, health-healthy requirement, and prior recovery guarantees.
8. Add dynamic docker-stub tests for two concurrent promotions, wait-then-proceed ordering, health success/failure, Created recovery, and one-start enforcement.
9. Add wording assertions for the explicit helper path and no raw compose.
10. Run focused tests, `node --check` on touched JS, `npm test`, and `git diff --check`.
11. If a production rebuild is required, follow `plan.md` mandatory deploy verification: `npm run restart:looparr -- --dry-run`, then `npm run restart:looparr`; confirm healthy/running on the new image, served HTML/CSS/JS contain the change, and container files match local source.
12. Mark the generated `plan.md` checklist tasks `[x]` only after verification passes. Prepare the concise handoff and commit only the scoped files.

## Tests

- `node scripts/test-restart-watchdog.js`: static guards for no raw compose, lock usage, blocking wait, systemd-run/detached path, health gate, recovery phases, log tail, and failure markers.
- Dynamic docker-stub suite: simulate held lock, launch second promotion, assert it waits without running build/up, release lock, assert second promotion proceeds and rechecks state.
- Health cases: running plus healthy passes; running plus starting/unhealthy/unknown or expired start period fails/recovers/escalates.
- Recovery cases: created, exited, and dead each trigger one `docker compose start looparr`, poll to healthy, and print logs plus `CONTAINER_RECOVERY_FAILED` on failure.
- Wording cases: helper path appears in README, config analyze/seed wording, engine injection, and implementation template; no raw compose instruction remains.
- `npm test` full suite.
- `git diff --check`.
- Production verification per `plan.md` and `.project_documents/PROMOTION.md` when code changes require a rebuild.

## Acceptance criteria

- Two simultaneous promotions cannot leave `looparr` created or unstarted.
- Second concurrent promotion blocks and waits for lock release; normal contention does not produce `PROMOTION_LOCK_HELD` fail-fast.
- No raw `docker compose build` or `docker compose up` promotion path remains for Looparr.
- The lock covers the full build and recreate sequence in helper, systemd-run, and detached fallback paths.
- Helper returns success only when healthcheck reports `healthy` within the start period.
- Created/exited/dead containers are recovered with one start attempt, or fail loudly with 60 log lines and `CONTAINER_RECOVERY_FAILED`.
- Promotion wording explicitly covers engine/session-driven deploys using `npm run restart:looparr` when a production rebuild is required.
- Focused tests, `npm test`, and `git diff --check` pass.
- Mandatory production deploy verification passes before `plan.md` tasks are checked and handoff is finalized.

## Risks

- Blocking lock can hang forever if an owner dies without releasing; mitigate with bounded wait, timeout diagnostic, and stale-lock logging.
- `flock` and mkdir fallback may diverge; test both or document the fallback limit.
- Healthcheck start period can cause false negatives; use the configured start period and poll before escalation.
- systemd-run detached process may lose lock ownership; keep descriptor inherited by wrapper until child exit.
- A waiter can reuse stale preflight or intent state; force fresh checks after acquisition.
- Engine injection duplication can conflict with template edits; verify final rendered wording, not only source constants.
- Static tests alone miss concurrency races; pair with dynamic docker-stub tests.
- Production verification must not mark tasks complete from local tests alone; follow the mandatory deploy section.
