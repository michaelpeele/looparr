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
5. **Container source hashes.** Compare `sha256sum` of `/app/index.html`,
   `/app/public/*`, `/app/src/*`, `/app/scripts/*` inside the container against
   the same files in the working tree. All must match. Some root-owned scripts
   are mode `0711`; read them with `docker exec -u 0`.
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