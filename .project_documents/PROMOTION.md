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

- **Preferred:** two distinct phases inside the same `looparr-promote` unit and
  restart lock: `docker compose build looparr`, then
  `timeout --signal=TERM --kill-after=30s ${LOOPARR_UP_TIMEOUT_SECONDS}s docker compose up -d looparr`.
  The unit is managed by the user systemd manager, so agent-session
  SIGKILL/cgroup cleanup cannot kill compose between container creation and
  start. `--wait` propagates each phase's exit code; `--collect` removes the
  finished transient unit before the next run. Overlap is prevented by the
  existing restart lock. Raw `docker compose build`/`up` is never a substitute
  for this helper.
- **Availability probe:** before first use, launcher checks `systemd-run` is in PATH and runs a cheap `--user` probe. Result cached in module constant for the process.
- **Fallback:** when probe fails/unavailable, launcher uses the existing detached bash wrapper with `trap '' HUP INT TERM QUIT` for the same two bounded phases. This preserves prior behavior outside systemd hosts.
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

- **UI merge path:** A fresh healer status in `.looparr/selfheal/status/` must
  report `state: healed`, no `mergedAt`, and a matching branch. The branch icon
  appears only under those conditions and only inside the 30-minute status TTL.
  Clicking it POSTs `/api/projects/<id>/selfheal/merge`; `src/engine.js` runs
  `git merge --no-ff` locally, marks the status merged, writes the status file,
  and starts the restart. The icon then hides. Nothing is pushed.
- **Manual promotion path:** Cherry-pick the reviewed healer commit onto
  `master`, then run the verified sequence. This puts code on prod but does not
  write a healer status record by itself. To account for the fix visibly, run
  `node scripts/selfheal-account.js --project <projectId> [--branch <branch>]
  --confirm`. It is human-gated (`--confirm` required), host/dev-side only,
  TTL-bound (30 minutes, re-stamped by the dev heartbeat), and writes a
  `state: accounted` record via `writeStatus` only. It refuses unless the
  branch's fix is already applied to the current checkout (patch-equivalent via
  `git cherry`, or an ancestor of `HEAD`). Accounted never enables the merge
  button and never satisfies the merge path. Do not hand-edit status files.
- **Current case:** `4f5e761` was a manual cherry-pick of healer commit
  `2705d24`. Run the accounted command for project
  `d76e436a-8816-4342-9511-b4706e2320e4`, branch
  `looparr-selfheal-1795657600462-0`, to show the pill as Accounted. The branch
  icon stays hidden by design; accounted is not healed and cannot be merged.

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
- 2026-11-26 — PLAN-05 verification-and-rollout close-out promotion. Focused
  paseo/opencode/runner-payload tests, `npm test` (repo + sandbox
  `/tmp/opencode/looparr-sandbox`), and `git diff --check` clean. Dry-run
  clean, no Docker call. Full promotion evidence-gated skip:
  `result: "skipped"`, `skipReason: "skipped-already-deployed"`, exit 0 —
  container `b88a15e0a8d9` healthy on image `looparr:latest` (image id
  `sha256:49ff51a0dc84df5fe73dc7503c421b2c44e08e2e355f5ea37d8f56e8057361ad`)
  already serves the current source (92-file source hash evidence `ok:true`).
  Live verification after skip: served `/`, `/app.js`, `/index.html` contain
  the `paseo-transport` setting UI; served `app.js`/`index.html`/`styles.css`/
  `favicon.svg` hash-match local `public/`; `/api/state` returns `projects`
  and `settings` (incl. `paseoTransport:false`); `npm run watchdog:check`
  steady. Paseo/direct/cancel/stale-run/mobile/bridge verification recorded in
  PLAN-05; host-level Paseo daemon polyfill documented there.
- 2026-11-27 — Merge-button progress/Refresh UI, Save-answer state transition,
  and favicon check. `npm test` green and `git diff --check` clean at that
  point. Dry-run clean. `npm run restart:looparr` promoted through
  `systemd-run --user --unit=looparr-promote` (run
  `6b6766b5-dab7-402b-9142-711bb2c3efae`), image
  `sha256:ccfab13bd93f56011529ec6cd1fe28001c124418a132f03f27676464713e651f`,
  container `8f995af9dbd5` healthy. Promotion status `result: "success"`,
  `apiStateOk: true`, `watchdogOk: true`, recovery `recoverCreatedContainer`
  ok. All 101 tracked `src`/`public`/`scripts` hashes matched local (`bad=0`);
  served `/`, `/styles.css`, `/app.js`, `/favicon.svg` matched local `public/`
  (`bad=0`); `/api/state` returned `projects` and `settings`;
  `npm run watchdog:check` steady. Nonfatal: active-run postcheck fetch
  failed, matching documented precedent. The running container had returned
  404 for `/favicon.svg`; source favicon was already at HEAD, and a temporary
  favicon variant was included in that run. Original `public/favicon.svg` was
  restored from HEAD afterwards, so this evidence is superseded by the final
  promotion entry after the UI edits.
- 2026-11-27 — Final promotion after merge-button progress/Refresh UI and
  Save-answer state transition. `npm test` green and `git diff --check` clean.
  Dry-run at 19:55:43Z detected stale `public/app.js`, `public/styles.css`, and
  `/favicon.svg` hashes; it made no Docker call. `npm run restart:looparr` at
  19:55:48Z promoted via `systemd-run --user --unit=looparr-promote` (run
  `7e9e2fc5-8e64-4989-8906-21dc46a73d60`), finished 19:56:05.308Z. Status:
  `result: "success"`, `phase: "done"`, `apiStateOk: true`, `watchdogOk: true`,
  `error: null`, recovery `recoverCreatedContainer` ok. Image
  `sha256:469b40a40cce507398d7bc6e622c16ce2f0f3f75f25925b557e87bf7dc11b2ed`,
  container `2c547c7104a6` healthy. Source manifest: 105 files, combined hash
  `b128afff01dcc4c1352d29a6206320f5d0e40859bd2e1344bc5562da8212474a`; served
  manifest: 4 files, combined hash
  `e269e3ec05a987c060e6c714fd941fc780fef0adcbbde6db31006b965b014b30`. Live
  verification: tracked `src`/`public`/`scripts` hashes matched local (`bad=0`,
  excluding Docker build-context files); served `/`, `/styles.css`, `/app.js`,
  `/favicon.svg` matched local `public/` via container-local fetch (`bad=0`);
  `/api/state` returned `projects=4 settings=31`; `npm run watchdog:check`
  steady. Host `curl /app.js` returns 302 to `/login` from the external auth
  proxy, so container-local fetch was used for served assets. Nonfatal
  `Active-run postcheck failed: fetch failed`, matching documented precedent.
  `public/favicon.svg` is unchanged from HEAD after restoring the original art.
- 2026-11-27 — Sprint provider-limit handling, handoff-loop guard, and the
  home-grid card render fix. `npm test` green and `git diff --check` clean;
  dry-run detected 10 stale container files + 1 missing test and made no Docker
  call. `npm run restart:looparr` promoted through `systemd-run --user
  --unit=looparr-promote` (build invocation `f10b9a6f982c4c41ac6dfa3743a02bab`,
  18.405s; up invocation `0c708d91237c4ce6bf95a9ebc724824b`, 6.574s), exit 0.
  Image `sha256:ee8ddb4382c0528b86501cbaea28ce522cc73a4a119d3953f6907df3ad34ba04`,
  container `896eb6e4535e` healthy, restarts 0. All 108 container
  `src`/`public`/`scripts`/`package.json` hashes matched local (`mismatch=0`,
  `local-not-in-container=0`); served `/`, `/styles.css`, `/app.js`,
  `/favicon.svg` matched local `public/`; `/api/state` returned `projects=5
  settings=31`; `npm run watchdog:check` steady. Live headless-browser check of
  `http://127.0.0.1:4188/`: all 5 project cards rendered, zero console errors
  (previously only the first card and a repeating
  `buttons.querySelector is not a function`). Nonfatal: active-run postcheck
  fetch failed, matching documented precedent.

- 2026-11-27 — Client sign-in card and `/api/auth/*` proxies (plan 03),
  committed `af62f98`. `npm test` green, `git diff --check` clean. Dry run and
  the real `npm run restart:looparr` both reported
  `promotion-evidence: ok:true, failures:[]`; the run exited 0 with
  `result: "skipped"`, `skipReason: "skipped-already-deployed"`, because the
  running image already served this source (the batch had been live in the
  working tree since before the previous promotion). Image
  `sha256:ee8ddb4382c0528b86501cbaea28ce522cc73a4a119d3953f6907df3ad34ba04`,
  container `896eb6e4535e`, healthy, restarts 0. Served `/`, `/styles.css`,
  `/app.js`, `/favicon.svg` matched local `public/`; `/api/auth/clients`
  returned `{ok:true, available:true, clients:[]}`; `/api/state` returned
  `projects=5` with `authFailures: []`; `npm run watchdog:check` steady. No
  rebuild was forced; plan 04 (live human-approved sign-in round) is still
  outstanding.

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

### Bounded compose phases and failure evidence

Build and up run as separate phases under the existing `looparr-promote`
systemd path and restart lock. Build is bounded by
`LOOPARR_COMPOSE_TIMEOUT_SECONDS` (default `600`). Up is wrapped with
`timeout --signal=TERM --kill-after=30s <deadline>s docker compose up -d looparr`
and `LOOPARR_UP_TIMEOUT_SECONDS` (default `300`), below the `900`-second lock
timeout. The up deadline stays below the lock timeout after adding kill-after
and backstop time. Each invocation tees stdout and stderr to
`.looparr/logs/compose-build-<run>.log` or
`.looparr/logs/compose-up-<run>.log`. Up start is recorded as
`status.upStartedAt`. On any failed phase the launcher prints the relevant log
tail and records `logPath` and `logTail` in `.looparr/promotion-status.json`
and `.looparr/logs/promotion-latest.log`.

On timeout the launcher stops the transient unit
(`systemctl --user stop looparr-promote.service`) or kills the detached
fallback's compose children before recovery. `DOCKER_RESTART_FAILED` carries
`phase`, `status`, container state from
`docker inspect looparr --format '{{.State.Status}}'`, compose `logPath`, and
a bounded `journalctl -u docker.service --since <up-start> --no-pager -n 200`
excerpt, plus `docker compose ps looparr`. The restart lock is released by the
existing EXIT/INT/TERM traps on timeout, signal, and failure.

### Watchdog-aware recovery

On up failure/timeout the launcher runs the existing
created/exited/dead recovery (`recoverCreatedContainer`) once; if the container
is still unhealthy it runs one one-shot `bash scripts/restart-watchdog.sh fix`
(the restart lock is already held, so the fix does not re-lock), then rechecks
container health and `/api/state`. The npm equivalent is
`npm run watchdog:fix -- fix`. Watchdog `fix` probes `/api/state` even when the
container is running: an answering API is steady and exits 0; otherwise it
re-converges with `docker compose up -d looparr` and polls `/api/state`.
`npm run watchdog:check` stays read-only. Every attempt and result is recorded
in `status.recovery`; watchdog check result is recorded as `watchdogOk` at
closeout.

### Stalled promotion runbook

If a promotion stalls during `docker compose up -d looparr`, stop the transient
unit with `systemctl --user stop looparr-promote.service`, then retry with
`npm run restart:looparr`. Inspect `.looparr/promotion-status.json`,
`.looparr/logs/promotion-latest.log`, the phase compose log, and the journal
excerpt before retrying. Raw `docker compose build`/`up` is never a substitute:
the host-executor cgroup can kill raw compose between container create and
start, leaving a created-not-started container and production down.

Focused tests: `npm run test:restart-looparr`
(`scripts/test-restart-looparr.js`); also wired into `npm test`.
