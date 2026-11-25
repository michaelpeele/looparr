# Plan: Self-heal live round, test repair, and host install

Implement this plan in `/home/michaelpeele/ai-projects/looparr`. First read `AGENTS.md` and `/home/michaelpeele/ai-projects/workflow.md`; the sandbox-first build/promotion rules apply. Do not repeat the diagnosis below — it was verified on 2026-11-25. This is alpha testing with one user (the developer); prod may be used for continued work, but prod stays a view-only primary.

## Verified state at handoff (2026-11-25 ~12:45 UTC)

- Branch `master`, HEAD `6b524ea feat(alpha): self-heal standby daemon, sprint scheduling and hosted UI work`. All previously dirty work is committed. Excluded from that commit: `.tmp-*` directories and `looparr-a-open.yml` (generated Playwright/accessibility snapshot) — leave them untracked.
- Standby daemon is running from the host checkout: PID 911523, `127.0.0.1:4400`, hostname `looparr-heal-host`, entry `server.js`, config `data/selfheal/config.json` (copied from `data/config.json`), PID file `.looparr/selfheal-daemon.pid`, log `logs/selfheal-daemon.log`.
- Arming setting is ON in `data/config.json` (`settings.selfHealing: true`). Prod compose is unchanged: `HOSTNAME=looparr`, `NODE_ENV=production`, `PORT=3000`, no `LOOPARR_SELFHEAL`.
- Prod's engine (`d76e436a-8816-4342-9511-b4706e2320e4`, project `looparr`) writes a fresh errored checkpoint every 30 s to `.looparr/auto-resume-state.json`: `status=error`, `hostname=looparr`, `error="No .looparr/next_prompt.txt for implement step"`, `nextPhase=implement`.
- The daemon picked that foreign error up and started a real round at `12:37:30Z`: audit `healer-triggered-by-primary` then `healer-spawned`, branch `looparr-selfheal-1795610250479-0`, worktree `.looparr/selfheal/1795610250479-0`, runner `opencode`, model `opencode/big-pickle`, status file state `debugging`, `exitCode=null`. At 12:43 the `opencode run` child (PID 911590) was still running; `HEALER_TIMEOUT_MS` is 20 minutes, so the round may have ended by the time this plan is read.
- The runner fix from Issue A is committed in `05ae70b` on top of `6b524ea` (`src/runners/opencode.js`, `scripts/host-executor.js`); the daemon was restarted on that code before the live round started.
- Temp probe artifacts (`.tmp-selfheal-probe`, branch `probe-heal`) were removed; the healer's own worktree and branch are intentionally left in place for review.

## Issues found (evidence, not guesses)

### A. opencode attach flag made every direct run exit 1 (fixed in working tree)

Symptom: each healer round spawned and exited with code 1 within ~200 ms; analysis file written with no diff (`healer-failed cause=exit-1`).

Cause: `getAttachFlag()` returned `--server` when `opencode run --help` mentioned it, and the runner passed `--server http://localhost:4096`. On the installed build (`/home/michaelpeele/.opencode/bin/opencode`, v2.x help) that URL requires a server password:

```
opencode run --server http://127.0.0.1:4096 --auto --format json --model opencode/big-pickle ok
# exit 1
# {"type":"error",...,"message":"Server at http://127.0.0.1:4096 requires a password; set OPENCODE_PASSWORD"}
```

`opencode run --auto --format json --model opencode/big-pickle "…"` (no attach flag) exits 0 and prints JSON lines; it connects to the background service itself. Older builds expose `--attach`; this one does not.

Fix applied (both files, committed in `05ae70b`): `getAttachFlag()` now returns `--attach` only when the help lists it as a flag line (`/^\s+--attach\b/m`), otherwise `''`; `buildCommand()` and the host executor only push the flag plus URL when non-empty. `attachProbed` caches the probe so `''` is not re-probed every call. Checked: `node --check` both files, `test-host-executor-run-key.js` ok, runner args now `["run","--auto","--format","json","--model","opencode/big-pickle","…"]`.

Side effect to document: on this build the host executor's `ensureServer()` URL is no longer passed, so executor runs use the background opencode service instead of the executor-owned server. Acceptable for alpha; revisit with `OPENCODE_PASSWORD` if server isolation is required.

### B. Host executor is not running

`ps` shows only `opencode serve --service`; no `scripts/host-executor.js`, no `looparr-*` systemd user unit, and prod's `LOOPARR_EXECUTOR_URL` default `http://172.17.0.1:4187` has no listener. Prod therefore cannot start implementation rounds through the bridge right now; it only keeps writing the old errored checkpoint. The standby daemon runs in direct mode (no `LOOPARR_EXECUTOR_URL`), which is what made the round possible. Decide the intended production topology before installing: either run the executor as a second host service, or accept direct-mode only for the standby.

### C. `npm test` is red before install (pre-existing, unrelated to the daemon)

The chain stops at `scripts/test-model-rotation.js`; each of these also fails standalone:

| test | failure |
| --- | --- |
| `test-model-rotation.js` | `Error: Timed out waiting for completion of rotation-on; server output: [looparr] Dashboard running at http://127.0.0.1:4201` (`test-model-rotation.js:86`) |
| `test-plan-ui-controls.js` | `Error: row 0 control indexes: expected 7, got 9` (`:1463`) |
| `test-rate-limit-success-guard.js` | `Error: timed out waiting for expected state` (`:56`) |
| `test-implement-marker-race.js` | `Error: timed out waiting for expected state` (`:70`) |
| `test-plan-prompt-flow.js` | `Error: Timed out waiting for plain project done; last value: null` (`:208`) |

Everything else in the chain was run individually and passes, including `test-self-heal`, `test-selfheal-toggle`, `test-selfheal-status`, `test-selfheal-daemon`, `test-auto-resume`, and the three sprint tests. The rotation timeout was already reproduced by a prior session in `.tmp-rot-repro-test/` (rotation-on stuck at `idle`/`seed`, no logs). Fix these before treating a green `npm test` as an install gate; do not skip or weaken them.

### D. Install is untested

`npm run selfheal:install` has never been executed. Open questions: `Type=forking` plus the script's `setsid`-detached child, `PIDFile=` ownership, `systemctl --user` PATH missing `/usr/local/bin` or `~/.opencode/bin`, `After=docker.service` in a user unit, `loginctl enable-linger`, and whether `ExecStop` leaves the opencode background service running. The unit requires host `git` and `docker`; both are present.

### E. Status-file hygiene

`.looparr/selfheal/status/` holds hundreds of stale records (TTL 30 min, no pruning). The current prod status file (`d76e436a….json`) was last written `2026-11-25T01:57Z` with `hostname: ""`, so prod's pill reads it as expired. The live round's status file is fresh and `hostname=looparr-heal-host`. Decide whether to prune old records (e.g. keep the newest per project) and whether prod should show "no standby" when no fresh file exists.

### F. Restart resets the cooldown and dedupe map

`HEALER_COOLDOWN_MS` (10 min) and `foreignHealedErrors` are in-memory. Two rounds fired 100 s apart because the daemon was restarted in between (12:32:54 and 12:34:31). The live round (12:37:30) needed the restart to clear the pre-fix failure. Document this as an operational caveat, or persist the last-healed digest and cooldown.

### G. Shared checkpoint file must stay unconsumed

The daemon shares `.looparr/auto-resume-state.json` with prod. It does not clobber it because `writeCheckpointIntent()` returns early when `rt.currentTask` is empty, and `resumeOnStart` peeks only under `LOOPARR_SELFHEAL_STANDBY=1`. Keep both guards covered by tests; a daemon that adopts a task would overwrite prod's intent and hide the error.

## Goal

- Commit the runner fix.
- Get `npm test` green by fixing the five failures above.
- Install the standby daemon as a `systemd --user` service, verify stop/start/reboot behavior, and keep prod unchanged and view-only.
- Prove one complete round through `debugging → healing → healed` (or a clean, evidenced `error`) with a fresh status file, a worktree branch, and a preview validation; merge stays manual.
- Update `SELFHEALING.md`, `README.md`, and this plan's status as needed.

## Steps

1. **Inspect the live round's outcome.**
   - `cat .looparr/selfheal/1795610250479-0-analysis.md` (or the newest `*-analysis.md`); `git branch --list 'looparr-selfheal-*'`; `git log --oneline HEAD..looparr-selfheal-1795610250479-0`; `git diff --stat HEAD..<branch>`.
   - `node -e "const s=require('./.looparr/selfheal/status/d76e436a-8816-4342-9511-b4706e2320e4.json');console.log(s)"`.
   - `tail -n 40 .looparr/auto-resume.log` for `healer-exit` / `healer-healed` / `healer-failed`.
   - If the round is still running, let it finish (20 min timeout) before changing engine code; restarting the daemon kills nothing (the child is separate), but the daemon loses `rt.healer` and the status file stops updating.
2. **Keep the runner fix and add a regression guard.**
   - Add an assertion (e.g. in `scripts/test-runner-payload.js` or `test-selfheal-daemon.js`) that `buildCommand()` never emits `--attach`/`--server` when the local help lacks `--attach`, and that it emits no attach URL on this build. Stub `execFileSync` or export the probe behind a test seam; do not spawn the real CLI in tests.
   - Re-run `node scripts/test-runner-payload.js`, `test-opencode-session.js`, `test-host-executor-run-key.js`.
3. **Repair the five failing tests** listed in Issue C. Start with `test-model-rotation.js` (rotation-on stuck at `idle/seed`); `.tmp-rot-repro-test/` contains prior repro notes, and `.tmp-browser-*` holds UI fixtures. Fix causes; do not weaken assertions. Then run the full `npm test` once and record the result.
4. **Install the daemon.**
   - `npm run selfheal:install`; inspect `~/.config/systemd/user/looparr-selfheal.service`.
   - `systemctl --user daemon-reload && systemctl --user enable --now looparr-selfheal`; `systemctl --user status looparr-selfheal`; `npm run selfheal:status` (exit 0, `state=running`).
   - `systemctl --user restart looparr-selfheal` and confirm one process, unchanged PID file semantics, `selfHealingAvailable=true`, and an idle status heartbeat within 60 s.
   - `sudo loginctl enable-linger "$USER"` if the service must survive logout/reboot; note whether the unit's `After=docker.service` is meaningful for a user unit.
   - Fix the unit/script if `Type=forking` or PATH prevents readiness.
5. **Second live round.**
   - Keep `settings.selfHealing` on and prod's errored checkpoint live; the daemon scans every 30 s.
   - Watch `.looparr/selfheal/status/<id>.json` for `debugging → healing → healed|error`, the analysis file, `.looparr/selfheal/<runId>/` worktree, and `docker compose -p looparr-heal` during validation.
   - Confirm prod (port 3000) shows the same state from the status file; the merge button only appears on `healed`; do not click it in this session unless the developer asks.
   - If the round fails, record the runner exit code and stderr tail; the branch is kept for review.
6. **Cleanup and docs.** Drop the throwaway probe artifacts (`.tmp-selfheal-probe` was removed), remove failed healer branches only with explicit approval, prune stale status records if you add that, and update `SELFHEALING.md` (install/linger/executor caveat), `README.md`, and the plan status.

## Constraints

- Prod remains view-only: never add `LOOPARR_SELFHEAL=1` to `docker-compose.yml`, never spawn git/docker from the prod container, never change `looparr.tail0307d.ts.net`.
- Never auto-merge, never push; merge is human-gated and local only.
- The standby must not adopt or consume prod's resume intent; it only reacts to fresh foreign errored checkpoints and writes status files.
- Do not remove the `[probe] tick error` `console.error` in `src/engine.js` unless explicitly asked.
- Keep `.tmp-*` and `looparr-a-open.yml` out of commits.
- Alpha mode: real rounds, real model spend, and real worktrees are allowed; do not touch unrelated services or data.

## Verification

- `npm test` green (all 34 entries), `git diff --check` clean.
- `npm run selfheal:status` reports running/armed with the expected hostname, port, config, PID and log after install and after restart.
- One live round produces: audit `healer-triggered-by-primary` + `healer-spawned`, a fresh status file with `hostname=looparr-heal-host`, a `looparr-selfheal-*` branch, and either `healed` with two preview cycles or `error` with a cause and analysis file.
- Prod `/api/state` reflects the same healer state without any prod env change.
- `systemctl --user status looparr-selfheal` active; daemon survives logout/reboot if linger is enabled.

## Rollback

- `npm run selfheal:stop`; `systemctl --user disable --now looparr-selfheal`.
- Delete the worktree/branch (`git worktree remove --force .looparr/selfheal/<runId>`, `git branch -D looparr-selfheal-<runId>`) only with approval.
- Revert the runner commit if the attach change breaks a legacy build; prod compose and config are untouched.

## Commit scope

`src/runners/opencode.js`, `scripts/host-executor.js`, any test files touched, this plan, and docs updates. Keep `.tmp-*` and `looparr-a-open.yml` untracked.
