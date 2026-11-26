# Looparr Promotion Workflow

Goal: promote to prod only after testing has completed. A restart is not a
promotion until the full verification sequence below passes.

## Verified sequence

Run in order. Any failure blocks promotion.

1. **Test gate.** `npm test` (full suite from `package.json`) and
   `git diff --check` must be clean. Never restart on a red suite.
2. **Dry run first.** `npm run restart:looparr -- --dry-run`. Expect
   `[looparr] Dry run: Docker was not called.` and no change to container or
   image.
3. **Restart.** `npm run restart:looparr`. Expect preflight pass, rebuild and
   recreate of the `looparr` service only, health wait success, and an
   active-run postcheck of 1 or 0 looparr runs.
4. **Health and image.** `docker ps` shows the `looparr` container `running`
   and `healthy`; record the new image id.
5. **Container source hashes.** Compare `sha256sum` of `/app/public/index.html`,
   `/app/public/*`, `/app/src/*`, `/app/scripts/*` inside the container against
   the same files in the working tree. Local `public/index.html` maps to
   `/app/public/index.html`; there is no `/app/index.html`. All must match.
   Some root-owned scripts are mode `0711`; read them with `docker exec -u 0`.
6. **Served asset hashes.** `curl` `/`, `/styles.css`, `/app.js`,
   `/favicon.svg` from `http://127.0.0.1:4188/` and `sha256` each against the
   matching `public/` file (`index.html` after the `/` fetch). All must match.
7. **API state.** `curl http://127.0.0.1:4188/api/state` parses as JSON
   containing `projects` and `settings`.
8. **Watchdog.** `npm run watchdog:check` exits clean.
9. **Record.** Append a promotion log entry below with the image id and
   hash-check results.

## Checklist

- [ ] `npm test` green and `git diff --check` clean
- [ ] `--dry-run` printed the dry-run line; container and image unchanged
- [ ] `npm run restart:looparr` completed with health wait and postcheck
- [ ] `docker ps` healthy; new image id recorded
- [ ] Container source hashes match local source
- [ ] Served asset hashes match local `public/` files
- [ ] `/api/state` has `projects` and `settings`
- [ ] `npm run watchdog:check` clean
- [ ] Promotion log entry appended


## Promotion execution path

`scripts/restart-looparr.js` is the compose launcher. `scripts/promote.sh` and host-executor restart requests delegate to it; agents request promotions, they do not run `docker compose` directly.

- **Preferred:** `systemd-run --user --unit=looparr-promote --wait --collect -p WorkingDirectory=<REPO_ROOT> --setenv=... -- bash -c 'docker compose build looparr && docker compose up -d looparr'`. The unit is managed by the user systemd manager, so agent-session SIGKILL/cgroup cleanup cannot kill compose between container creation and start. `--wait` propagates the compose exit code; `--collect` removes the finished transient unit before the next run. Overlap is prevented by the existing restart lock.
- **Availability probe:** before first use, launcher checks `systemd-run` is in PATH and runs a cheap `--user` probe. Result cached in module constant for the process.
- **Fallback:** when probe fails/unavailable, launcher uses the existing detached bash wrapper with `trap '' HUP INT TERM QUIT` and the same compose command. This preserves prior behavior.
- **Logging:** launcher emits `reportEvent('promotion-execution-path', { executor: 'systemd-run' | 'detached-spawn' })` and a `[looparr]` console line before execution.
- **After compose:** preflight recovery, post-compose recovery, and health wait still run in the parent process after the unit/child exits.

## Host requirements for systemd-run path

- User manager running for the executing user.
- For headless hosts, enable linger: `loginctl enable-linger <user>`.
- User manager must reach Docker socket (docker group membership or matching rootless Docker setup). Forwarded env when set: `PATH`, `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`.

## Observing the unit

- Journal output: `journalctl --user -u looparr-promote -n 200 --no-pager`
- Status: `systemctl --user status looparr-promote --no-pager`
- The unit is transient and collected after completion; status is most useful immediately after a run.

## Healer branch promotion and prod visibility

Healer branches are local and never pushed. A healed branch reaches prod only
after a human reviews it and either merges it from the UI or cherry-picks it
onto `master` by hand. Both paths require the verified sequence above.

- **UI merge path:** A fresh healer status in `data/selfheal/` must report
  `state: healed`, no `mergedAt`, and a matching branch. The branch icon appears
  only under those conditions and only inside the 30-minute status TTL.
  Clicking it POSTs `/api/projects/<id>/selfheal/merge`; `src/engine.js` runs
  `git merge --no-ff` locally, marks the status merged, writes the status file,
  and starts the restart. The icon then hides. Nothing is pushed.
- **Manual promotion path:** Cherry-pick the reviewed healer commit onto
  `master`, then run the verified sequence. This puts code on prod but does not
  write a healer status record and does not show the branch icon. An absent,
  stale, or merged status keeps the icon hidden.
- **Current case:** `4f5e761` was a manual cherry-pick of healer commit
  `2705d24`. No fresh healed status exists, so the icon is hidden by design.
  To make the icon visible later, run a fresh healer round to `healed` and use
  the UI merge path. Do not hand-edit status files.

## Promotion log

- 2026-11-22 — Rate-limit false-positive fix promoted after `npm test`.
  Container `b2c72c838f2c` healthy on image `68ca51074656`.
- 2026-11-25 — Promotion-workflow verification batch. `npm test` green,
  `git diff --check` clean, dry-run clean, restart recreated `looparr` on image
  `0fe7691c3fb3` (container `92b20acf9145`, healthy). All 75 container source
  files matched local (`src`, `public`, `scripts`; 5 root-owned `0711` scripts
  read via `docker exec -u 0`). Served `/`, `/styles.css`, `/app.js`,
  `/favicon.svg` matched local `public/`. `/api/state` returned `projects` and
  `settings`. `npm run watchdog:check` clean.
- 2026-11-25 — Manual cherry-pick `4f5e761` from healer branch
  `looparr-selfheal-1795657600462-0` (commit `2705d24`,
  `fix(plan): pin exact PLAN doc path for planWrite`). `npm test` green,
  `git diff --check` clean, dry-run clean. Restart ran through `systemd-run`
  (`looparr-promote.service`, success). Container `34d0db7a3fc7` healthy on
  image `91c5851012fc`. Container source hashes: 78 files, `bad=0`; served
  `/`, `/styles.css`, `/app.js`, `/favicon.svg` matched local `public/`;
  `/api/state` had `projects` and `settings`; `npm run watchdog:check` clean.
  Nonfatal note: active-run postcheck fetch to `LOOPARR_EXECUTOR_URL` failed;
  launcher caught it and did not fail the restart. No healer status record was
  written, so the branch icon stayed hidden by design.
- 2026-11-26 — Durable resume snapshot plus systemd-only promotion prompts.
  `npm test` green, `git diff --check` clean, dry-run clean, sandbox smoke
  passed, prod restart through `systemd-run --user` (`looparr-promote`).
  Container `769c0f9d38bf` healthy on image `sha256:8565265b…`; all 81 tracked
  `src`/`public`/`scripts` files matched local, served `/`, `/styles.css`,
  `/app.js`, `/favicon.svg` matched local `public/`, `/api/state` returned
  `projects` and `settings`, `npm run watchdog:check` clean. Nonfatal: the
  active-run postcheck fetch failed and did not fail the restart.
- 2026-11-26 — Permission-directive fix and forced image recreate. Added the
  `Permissions:` rule to `AGENTS.md`; normalized build-context modes to `0644`
  for sources and `0755` for shebang scripts; changed
  `scripts/test-selfheal-status.js` executor port from `4197` to `5497` to avoid
  the standby OpenCode range `4190-4199`. `npm test` green
  (`/tmp/opencode/looparr-npm-test-final.log`), `git diff --check` clean,
  dry-run clean. `npm run restart:looparr` promoted through `systemd-run --user
  --unit=looparr-promote --wait --collect`; its rebuild did not recreate the
  container, so a forced recreate used the same transient unit
  (`looparr-promote.service`, invocation `50736d3be76c498abf6eaa2ad684aaf4`,
  success, 5.337s). Container `9ac09bb3ab7a` healthy, restarts `0`, on image
  `sha256:be047f635d8c`; `/app/src/paseo-transport.js` is `0644 root` and
  readable by UID `1000`. All 84 tracked `src`/`public`/`scripts` hashes matched
  local (`bad=0`); served `/`, `/styles.css`, `/app.js`, `/favicon.svg` matched
  local `public/` (`bad=0`); `/api/state` returned `projects`, `settings`, and
  default models; `npm run watchdog:check` clean. Nonfatal: the first helper
  restart's active-run postcheck fetch failed, matching documented precedent.
- 2026-11-26 — Promotion with healer merge, reseed-test correction, opt-in
  paseo transport, and restart-hang incident. Committed `33e474d`, merged
  `d00268e` via `04aeacc`, committed `f7c147e`. `npm test` green twice;
  `git diff --check` clean; dry-run clean. Two `npm run restart:looparr`
  attempts hung in `docker compose up -d looparr` (`futex_wait_queue`, 0% CPU,
  15m14s then 8m+); both units stopped via
  `systemctl --user stop looparr-promote.service`; no raw docker commands run
  by agent. `npm run watchdog:fix -- fix` required explicit arg; after one
  container-removal race, container `2087ee86b7f8` running. Final `/api/state`
  valid; served `/app.js` and `/styles.css` hashes matched local;
  `npm run watchdog:check` steady. Container source hash check skipped under
  no-raw-docker constraint. Mitigation plan:
  `.project_documents/PLAN-restart-hang-mitigation.md`, referenced in `plan.md`.
- 2026-11-26 — Promotion with standby plan-watch guard. Standby host engine no
  longer reconciles external plan edits and clears the primary handoff; focused
  regression test added. `npm test` green, `git diff --check` clean, dry-run
  clean. `npm run restart:looparr` used `systemd-run` unit
  `looparr-promote.service` (invocation `b6864d974761467b98a5d99198452057`)
  and exited 0; API/container health passed. Active-run postcheck fetch failed
  (documented nonfatal). Container `5cdc8d7f6d9e` healthy on image
  `looparr:latest`, image id
  `sha256:ea4af36a05d8353439c14e23b3c8e920204ddbfa27f1df54d79c794c4755b81b`.
  Normalized container source hash diff clean; served hashes matched local for
  `/`, `/styles.css`, `/app.js`, and `/favicon.svg`. `/api/state` valid;
  `npm run watchdog:check` steady.
- 2026-11-26 — PLAN-02 verify-and-close promotion. Focused
  `node scripts/test-paseo-transport.js`, `npm test`, `node --check`, and
  `git diff --check` clean. Dry-run clean. `npm run restart:looparr` used
  `systemd-run` unit `looparr-promote.service` (invocation
  `1ed8d4ddef034416bdebf20b4f414ee4`, success, 18.163s); API/container health
  passed and active-run postcheck returned `1`. Container `607bbffcd7a3`
  healthy on image `looparr:latest`, image id
  `sha256:4bca31e985e0f7d7e519b34d0a05da10cc1a8fadfbdf0d8d596aeee586ce4a9b`.
  All 87 `src`/`public`/`scripts` hashes matched local; served `/`,
  `/styles.css`, `/app.js`, and `/favicon.svg` matched local `public/`;
  served `/app.js` contained 7 `paseoTransport` references. `/api/state` valid;
  `npm run watchdog:check` steady. Self-heal daemon `active`, unit
  `active`/`enabled`, host executor health OK, no preview container, one
  worktree.
## Idempotent, observable promotion (promotion-status.json)

`npm run restart:looparr` is idempotent. Every run writes
`.looparr/promotion-status.json` (atomic temp+rename, mode `0600`) and tees all
parent console output to `.looparr/logs/promotion-latest.log` (recorded as
`logPath`). Status starts as `result: "running"` and always ends terminal:
`success`, `skipped`, or `failed` — including timeouts and signals. Key fields:
`runId`, `startedAt`/`finishedAt`, `phase`, `result`, `executor`,
`unit`/`invocationId`, `imageId`, `containerId`, `sourceHashSummary`,
`servedHashSummary`, `apiStateOk`, `watchdogOk`, `skipReason`, `error`,
`recovery` (attempt log), `diagnostics` (failure evidence).

### Pre-promote evidence check (skip-on-evidence)

Before any dry-run/build, the launcher computes a deterministic sha256 manifest
over `src/`, `public/`, `scripts/`, `package.json`, `docker-compose.yml`,
`Dockerfile`, `.dockerignore` (sorted paths, per-file hash, combined hash). It
then checks the running container:

1. `docker inspect looparr`: state `running` and health `healthy`.
2. `/api/state` returns JSON with `projects` and `settings`.
3. Container file hashes under `/app/<relpath>` match local for every
   comparable manifest file (`src/`, `public/`, `scripts/`, `package.json`;
   read root-owned scripts with `docker exec -u 0`). Build-context-only files
   (`Dockerfile`, `.dockerignore`, `docker-compose.yml`) are not in the image
   and are not container-compared.
4. Served `/`, `/app.js`, `/styles.css`, `/favicon.svg` hashes match local
   `public/` files.

When every gate passes, the run skips rebuild/recreate, records
`result: "skipped"`, `skipReason: "skipped-already-deployed"`, and exits 0.
Deliberate rebuilds bypass the skip with `npm run restart:looparr -- --force`
or `LOOPARR_FORCE_PROMOTION=1`. A failed/incomplete evidence check never fails
`--dry-run`; it logs the reason and continues to the dry-run exit-0 path.

### Bounded compose phase and failure evidence

Compose runs under the existing `looparr-promote` systemd path and restart
lock, bounded by `LOOPARR_COMPOSE_TIMEOUT_SECONDS` (default `600`, shorter
than the lock default `900`). On timeout the launcher stops the transient unit
(`systemctl --user stop looparr-promote.service`, or kills the detached
fallback's compose children) before recovery. On failure or timeout it
captures into the status/log: `phase`, `logPath`,
`docker compose ps looparr`, full `docker inspect looparr` (bounded), and a
bounded `journalctl -u docker.service --since <start> --no-pager -n 200`
excerpt. The restart lock is released by the existing EXIT/INT/TERM traps on
timeout, signal, and failure.

### Watchdog-aware recovery

On up failure/timeout the launcher runs the existing
created/exited/dead recovery (`recoverCreatedContainer`) once; if the container
is still unhealthy it runs one one-shot `bash scripts/restart-watchdog.sh fix`
(the restart lock is already held, so the fix does not re-lock), then rechecks
container health and `/api/state`. Every attempt and result is recorded in
`status.recovery`. `npm run watchdog:check` stays read-only and its result is
recorded as `watchdogOk` at closeout.

Focused tests: `npm run test:restart-looparr`
(`scripts/test-restart-looparr.js`); also wired into `npm test`.
