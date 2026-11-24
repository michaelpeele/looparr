# Prod self-heal status + merge relay — implementation prompt

Status: open. Plan item: none yet (candidate `(plan) Prod self-heal status + merge relay` line).

This file is self-contained: read it in full before writing code. It carries the motivation, the
repo baseline, the exact contract, the constraints, the tests, and the commit scope.

## Motivation

The healer must run where `git` worktrees and the Docker CLI exist, which is the host dev
checkout — never the prod container (verified: prod image has no `git`, no `docker`). Today the
prod instance cannot show any of it: `selfHealingAvailable` is false there, so the header pill is
hidden even with the setting saved, and `POST /api/projects/:id/selfheal/merge` returns 403 from
`selfHealingEnabled()`.

The desired split: the healer runs in the background on the host dev stack, prod shows the live
state (idle / debugging / healing / healed / error) and, when the round is healed, offers the
same merge button. Pressing it on prod merges the healed branch locally, rebuilds prod, and
restarts it — with no remote push. Publishing is a deliberate act later (manual or a plan task),
never a healer or merge-side effect.

## Current building blocks

- `selfHealingEnabled()` (`src/engine.js:917`): setting on + `NODE_ENV !== production` +
  `LOOPARR_SELFHEAL=1` or `SELFHEAL_ENABLED` marker. Spawn, validation, merge, and pill
  availability all use it.
- `getState()` exposes `selfHealingAvailable` (`src/engine.js:235`) and per-project
  `selfHealer` (`:327`) from `rt.healer` — runtime-only, invisible to prod.
- Pill/merge UI: `renderSelfHealing()` (`public/app.js:744`) unhides the pill when
  `selfHealingAvailable`, renders `data-state` + label, and shows `#self-heal-branch` only when
  healed. The merge call is already `POST /api/projects/:id/selfheal/merge`.
- `mergeHealerBranch()` (`src/engine.js:1269`): requires the dev gate and `state === 'healed'`,
  runs `git merge --no-ff` in `healer.repoRoot`, records `healer-merged`, then spawns
  `scripts/restart-looparr.js` detached. Nothing is pushed.
- `scripts/restart-looparr.js`: locked `docker compose build looparr && docker compose up -d
  looparr`, waits for API + container health, cleans stale resume intents, optional executor
  active-run postcheck.
- `scripts/host-executor.js`: host-only HTTP service bound to the Docker bridge gateway (refuses
  `0.0.0.0`), bearer `LOOPARR_EXECUTOR_TOKEN` (>=16 chars, timing-safe compare), endpoints
  `/health`, `/active`, `/run`, `/cancel`. Prod already calls it for CLI runner steps via
  `LOOPARR_EXECUTOR_URL` (default `http://172.17.0.1:4187`).
- `docker-compose.yml`: prod is `NODE_ENV=production`, mounts `.looparr` rw, the projects root
  rw, and `.env`; the `looparr` container shares the tailscale network namespace. So
  `.looparr/selfheal/` is already a same-machine channel between the dev engine and prod.

## Design

1. **Status file is the feed.** The dev engine writes one JSON per project at
   `.looparr/selfheal/status/<projectId>.json` (atomic temp+rename, `0o600`) on engine start when
   self-healing is enabled (state `idle`), on every healer transition, and on round finish, plus a
   heartbeat every 60 s so a healthy idle daemon keeps the file fresh. Default freshness window
   `SELFHEAL_STATUS_TTL_MS = 30 * 60_000`. Fields:
   `version, projectId, projectName, state, round, cycles, branch, phase, errorAt, mergedAt,
   analysisFile, exitCode, hostname, updatedAt, expiresAt`. No secrets; plain paths relative to
   `.looparr`.
2. **Prod reads, never spawns.** `getState()` keeps `selfHealer` from `rt.healer` when the dev
   gate is on, and otherwise maps the freshest status file (within `SELFHEAL_STATUS_TTL_MS`) to
   the same `selfHealer` shape. `selfHealingAvailable` becomes
   `selfHealingEnabled() || freshStatusExists()`. Stale or malformed files are ignored (pill
   hidden), so a dead dev engine cannot leave a lit pill forever. The prod `selfHealing` setting
   does not gate the pill or the merge: prod cannot spawn, so viewing is driven by the status
   source alone; spawning still requires `selfHealingEnabled()`.
3. **Pill unchanged in shape.** Prod renders the existing idle / debugging / healing / healed /
   error pill from the file, including the branch merge button when `state === 'healed'`. Idle
   is shown when a fresh status source exists and no round has run. Once `mergedAt` is set, keep
   the healed state but hide the merge button (show the merged branch instead) so a restart cannot
   offer a second merge.
4. **Merge on prod is a relay, not in-process git.** Add a narrow
   `POST /selfheal/merge` to `scripts/host-executor.js` (bearer auth, same token; JSON body
   `{ projectId, branch }`):
   - validate the fresh status file for the project; require `state === 'healed'`, an empty
     `mergedAt`, and the body branch matching both the status branch and
     `^looparr-selfheal-[0-9]+-[0-9]+$`;
   - operate only in the fixed repo root; no free-form command, no caller-supplied paths;
   - refuse if already merged (`git merge-base --is-ancestor`), otherwise
     `git merge --no-ff -m "selfheal: merge <branch>" <branch>`;
   - on conflict keep the branch and return 409; on success write `mergedAt`, respond
     `200 { ok: true, branch, mergeCommit, restart: 'scheduled' }`, then schedule
     `scripts/restart-looparr.js` detached after a 5 s delay. The rebuild recreates the prod
     container, so the response must reach prod and the browser before the restart starts;
   - executor error codes: 400 invalid body, 401 bad token, 409 stale/not-healed/branch
     mismatch/conflict; the prod route returns 503 when the executor URL/token is not configured.
5. **Prod route forwards.** `POST /api/projects/:id/selfheal/merge` on prod validates the status
   file locally, then calls the executor endpoint with the token and returns its body. In a dev
   checkout the existing local `mergeHealerBranch()` path still runs. No git or docker calls ever
   execute inside prod. The UI tolerates the restart disconnect: a dropped request after submit
   shows "merging/restarting", and the reconnected state confirms the merge and hides the button.
6. **No push anywhere.** The relay performs merge + rebuild + restart only. The no-push guard in
   `scripts/test-self-heal.js` stays; a remote publish remains a manual or plan-task action run
   by a normal runner, with no healer involvement.

## Environment and commands

- Host executor: `node scripts/host-executor.js` from the repo root. It loads `.env`
  (`LOOPARR_EXECUTOR_TOKEN`, >=16 chars), binds the Docker bridge gateway (or
  `LOOPARR_EXECUTOR_BIND`), listens on `LOOPARR_EXECUTOR_PORT` (default 4187), and must be
  restarted after edits.
- Dev engine: `NODE_ENV=development LOOPARR_SELFHEAL=1 node server.js` in the checkout; this is
  the only process that writes healer status or spawns a healer.
- Prod reaches the executor at `LOOPARR_EXECUTOR_URL` (compose default
  `http://172.17.0.1:4187`) with `LOOPARR_EXECUTOR_TOKEN`; no new compose variables are needed.
- Unit checks: `node scripts/test-selfheal-status.js`, `node scripts/test-selfheal-toggle.js`,
  `node scripts/test-self-heal.js`; full suite `npm test`; cleanliness `git diff --check`.
- Promotion (only after sandbox verification): the existing `docker compose build looparr &&
  docker compose up -d looparr` path, with human approval per `../workflow.md`.

## Repo state and workflow (read before starting)

Follow the mandatory sandbox-first workflow in `../workflow.md`: build and verify in a sandbox
clone, then promote only after a human approves. Development must not rebuild, recreate, or
restart the live `looparr` container. Use a throwaway clone of the repo (never the live checkout)
and a separate compose project name and port for any prod-shaped instance; remove it after
verification.

`master` is already dirty. Leave these pre-existing changes uncommitted and out of the feature
commit:

- modified: `.project_documents/PLAN-handoff-recovery-sweep.md`,
  `.project_documents/PLAN-self-healing.md`, `plan.md`
- untracked: `.tmp-browser-controls-all/`, `.tmp-browser-fixture/`, `.tmp-browser-sticky/`,
  `.tmp-rate-limit-success-guard-test/`, `looparr-a-open.yml`

Feature work already in the tree, uncommitted, and part of this change: the `server.js` fix that
accepts `selfHealing` in `PATCH /api/settings`, `scripts/test-selfheal-toggle.js`, the matching
`package.json` test-chain entry, and this plan document. Keep and commit them with the
implementation.

`.looparr/` is gitignored: status files, worktrees, and analysis writeups stay local and never
enter a commit.

## Files to change

- `src/selfheal-status.js` (new) — atomic write, read, TTL validation, path containment, and
  merge-request validation (fresh healed status, branch pattern, empty `mergedAt`, already-merged
  helper) so the relay refusals are unit-testable without Docker.
- `src/engine.js` — write status on healer transitions/finish; read it in `getState()` for prod;
  keep `selfHealer` authoritative in dev; merge decision (local vs relay).
- `server.js` — merge route forwards to the executor when `selfHealingEnabled()` is false but a
  fresh status file exists; clear 503 when the executor URL/token is missing.
- `scripts/host-executor.js` — `POST /selfheal/merge` (status validation, merge, restart).
- `scripts/restart-looparr.js` — reuse as-is; no change expected.
- `public/app.js` — render the relayed state; hide the merge button once `mergedAt` is set; treat
  a dropped merge request as "restarting" and confirm via reconnect; surface executor errors in
  `settingsStatus`.
- `SELFHEALING.md`, `README.md` — document the host-healer/prod-viewer split, the status file, the
  relay, and that publishing stays manual.
- `scripts/test-selfheal-status.js` (new) + `scripts/test-selfheal-toggle.js` and
  `scripts/test-self-heal.js` updates; wire the new suite into `npm test`.

## Requirements

1. Status file written atomically under `.looparr/selfheal/status/`, one per project (id
   validated, path contained), `0o600`, with a TTL and a 60 s heartbeat while the dev engine is
   running with self-healing enabled (idle included).
2. Prod `selfHealingAvailable` is true only with a fresh status source; stale/malformed files are
   ignored. Prod never spawns a healer and never runs git, docker, or worktree commands; it only
   reads the status file and forwards a merge request.
3. Pill shows all five states from the file, merge button only in `healed`, exactly as in dev.
4. Merge on prod goes through the authenticated executor endpoint; the container never gains
   `docker.sock` or `git`.
5. Executor endpoint refuses non-healed states, foreign project ids, branch names outside the
   pattern, and already-merged branches; conflicts keep the branch.
6. After a successful merge the executor responds `restart: 'scheduled'` and then runs the
   existing rebuild/restart primitive detached; the UI confirms through reconnect and shows real
   merge failures instead of a false success.
7. No `git push` is introduced anywhere; the existing guard test remains.
8. Product constraints stay: one healer round, dev-only spawning, local-only merge, human confirm
   before merge.
9. Tests cover: status write/read/TTL/containment; prod state mapping from a file; relay request
   shape and refusal cases (401 token, 409 not healed, 409 conflict, idempotent already merged);
   the no-push guard. `npm test` and `git diff --check` clean.
10. Follow the repo's sandbox-first workflow for any build/restart verification; do not touch the
    live prod container until the feature is verified in a sandbox clone.
11. Start from the repo-state section above: do not commit the pre-existing dirty files, and keep
    the uncommitted `selfHealing` settings fix, its test, and the `package.json` entry.
12. The relay contract is fixed as above; the response is sent before the restart is scheduled,
    and the UI treats a post-submit disconnect as "restarting", not as a merge failure.
13. A status with `mergedAt` set hides the merge button and cannot be merged again.
14. Prod viewing/merging depends only on a fresh status file and the executor token/URL; the prod
    `selfHealing` setting never turns on healer spawning.

## Verification

- Unit: status file round-trip; stale TTL hides the pill; prod `getState()` maps `state/branch/
  cycles`; merge relay rejects missing token, stale status, non-healed state, bad branch names,
  and already-merged branches.
- Sandbox (clone with `NODE_ENV=development LOOPARR_SELFHEAL=1`, an executor token, and a demo
  project with one deliberate failing test): run one real healer round, confirm the status file
  and prod-shaped `getState()` expose the healed branch, press merge through the relay, and confirm
  a local `--no-ff` merge commit plus rebuild/restart. Report the observed state transitions and
  confirm nothing was pushed (no remote is configured; do not add one).
- Relay ordering: assert the 200 response is written before the detached restart is scheduled,
  and that a simulated dropped connection is not reported as a merge failure.
- Post-restart: after the sandbox prod-shaped container is recreated, confirm the status file is
  still mapped, the pill shows healed/merged, and the merge button is gone.
- Confirm prod still cannot merge without a fresh status file or the token.
- `npm test` green; `git diff --check` clean.

## Acceptance criteria

- With the host healer enabled, the prod header pill shows the round live (including idle) and the
  merge button appears only when healed.
- Pressing merge on prod merges locally and rebuilds/restarts prod; pressing merge on dev behaves
  as it does today.
- No push to a remote from either path; no git or docker execution inside prod.
- The merge button disappears once merged and cannot be pressed twice across a restart.

## Commit scope and plan marker

Commit only: `src/selfheal-status.js`, `src/engine.js`, `server.js`,
`scripts/host-executor.js`, `public/app.js`, `SELFHEALING.md`, `README.md`,
`scripts/test-selfheal-status.js`, `scripts/test-selfheal-toggle.js`,
`scripts/test-self-heal.js`, `package.json`, `.project_documents/PLAN-prod-heal-status-merge.md`.
Exclude the pre-existing dirty files listed under repo state.
If a plan.md line is added for this work, flip it to `- [x]` with a one-line Done note after
verification.

## Risks

- **Privileged action reachable from prod.** Keep the executor bound to the bridge gateway, require
  the bearer token, accept only the fixed repo root and a validated healed branch, and confirm in
  the UI. No generic command endpoint.
- **Stale/forged status file.** Treat it as untrusted input: TTL, schema validation, project
  existence, branch regex, and `git merge-base` checks before merging.
- **Restart kills live steps.** Rebuild/recreate aborts running project steps; rely on auto-resume
  / the durable snapshot work, and note it in the merge confirmation copy.
- **Split-brain status.** A dev engine and prod both writing status would race; only the healer
  daemon writes, prod is read-only for this feature.
- **Lost merge response.** The rebuild recreates prod mid-request; send the response first,
  schedule the restart after a short delay, and let the UI confirm via reconnect.
- **Branch leakage.** Keep remote publishing out of both paths; the branch stays local for human
  review.
