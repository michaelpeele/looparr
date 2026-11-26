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