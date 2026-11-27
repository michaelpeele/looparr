# Idempotent, observable promotion

Status: draft — implementation plan.
Priority: top unfinished plan task; work next.

## Problem

Plan 04 code is already present locally and in the running prod container, but promotion observability was lost when the agent shell was interrupted during `npm run restart:looparr`. The restart log ended at `looparr-promote.service` launch; the transient unit/journal did not survive inspection; `.looparr/restart-continue.json` remained; plan marker stayed `[ ]`. Agents can cycle by rerunning expensive tests/dry-run/rebuild without a cheap proof that current source is already deployed and healthy.

## Goals

- Make promotion automatable and idempotent for agent runs.
- Prove “already promoted” from evidence before rebuilding.
- Preserve restart safety: never raw `docker compose` from agent; keep `looparr-promote` systemd path and lock.
- Make failures diagnosable without manual journal spelunking.

## Non-goals

- No manual/mobile UI verification gate in the automated path.
- No change to direct runner behavior or Paseo runtime semantics.
- No auto-push, auto-merge, or destructive git operations.

## Design

### 1. Promotion status artifact

- Write a machine-readable status file, e.g. `.looparr/promotion-status.json` (gitignored/engine-managed, not committed), with: `runId`, `startedAt`, `finishedAt`, `phase`, `result` (`running|success|failed|skipped`), `executor` (`systemd-run|detached-spawn`), `invocationId`/unit name when available, `imageId`, `containerId`, `sourceHashSummary`, `servedHashSummary`, `apiStateOk`, `watchdogOk`, `skipReason`, `error`.
- Tee console output to a known log path, e.g. `/tmp/opencode/looparr-restart.log` or `.looparr/logs/promotion-latest.log`, and record the path in status.
- On start, mark `running`; on any exit path, write terminal status before process exit.

### 2. Idempotent pre-promote evidence check

- Before dry-run/build, compute a deterministic local source hash manifest for promotion-relevant files (at minimum `src/`, `public/`, `scripts/`, `package.json`, `docker-compose.yml`, files copied by Docker build context as needed; reuse PROMOTION.md scope where practical).
- Compare against running container evidence:
  - `docker inspect looparr` reports `running` and `healthy` on current image.
  - `/api/state` returns JSON with `projects` and `settings`.
  - Container file hashes for the manifest match local hashes (read root-owned scripts via `docker exec -u 0` as PROMOTION.md allows).
  - Optional but cheap: served `/`, `/app.js`, `/styles.css`, `/favicon.svg` hashes match local `public/`.
- If all pass, skip rebuild/recreate, emit `promotion-execution-path`/status as skipped-already-deployed, and exit 0. This is the key anti-cycle guard.
- Provide explicit override (`--force` or env) only for deliberate rebuilds; default path is idempotent.

### 3. Bounded, observable compose phases

- Split compose into build and up phases under the same lock and same `looparr-promote` unit strategy, or keep single command but wrap with bounded timeout and phase-aware logging. Prefer phase split per PLAN-restart-hang-mitigation.
- Bound `up -d` with deadline < lock timeout; include phase, status, log path, `docker compose ps`, `docker inspect` state, and bounded `journalctl -u docker.service --since <start> --no-pager -n 200` excerpt on failure.
- Ensure lock release on timeout/signal/failure; assert in tests.

### 4. Recovery hook

- On up timeout/failure, run existing created/exited/dead recovery once. If still unhealthy, optionally invoke `npm run watchdog:fix -- fix` as one-shot recovery attempt, then recheck health/API. Keep `watchdog:check` read-only.
- Record recovery attempts/results in status artifact.

### 5. Closeout automation contract

- Agent closeout for plan items that change source:
  1. Run targeted tests + `npm test` + `git diff --check`.
  2. `npm run restart:looparr -- --dry-run`.
  3. `npm run restart:looparr` (idempotent; may skip with evidence).
  4. Verify healthy container, source hashes, served hashes, `/api/state`, `npm run watchdog:check`.
  5. Flip plan marker only after evidence.
  6. Commit only explicit safe paths.
- If promotion was interrupted but evidence now passes, agent records evidence and continues closeout; it does not rebuild.

## Files likely touched

- `scripts/restart-looparr.js`
- `scripts/restart-lock.sh` (only if lock/logging behavior needs adjustment)
- `scripts/restart-watchdog.sh` / watchdog tests only if recovery hook needs support
- `.project_documents/PROMOTION.md`
- `AGENTS.md` (brief pointer, if needed)
- `scripts/test-restart-watchdog.js` and/or new `scripts/test-restart-looparr.js`
- `package.json` only if adding focused test script
- `.gitignore` for promotion status/log artifacts if stored in-repo

## Acceptance criteria

- Re-running promotion when current local source is already deployed healthy skips rebuild and exits 0 with recorded skip reason.
- Interrupted/timeout promotion leaves a terminal status artifact and releases the lock.
- Up-phase hang fails within configured deadline with bounded evidence.
- No raw `docker compose build/up` introduced.
- Focused tests cover skip-on-evidence, force-rebuild path, timeout/lock release, and recovery/failure reporting.
- `npm test` and `git diff --check` clean.

## Verification

- Unit/stub tests for evidence-skip and timeout paths.
- `npm run restart:looparr -- --dry-run` clean.
- Real promotion: first run may rebuild; second run on unchanged source reports skipped-already-deployed.
- Post-checks: healthy container, image id recorded, container/source/served hashes match, `/api/state` valid, `npm run watchdog:check` clean.
