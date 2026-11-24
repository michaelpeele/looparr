# Self-healing debugging mode

Self-healing is an opt-in development aid for a **cloned** Looparr checkout. When a
project step errors, Looparr can spawn exactly **one** detached session of a
different runner/model with a prompt to investigate, fix, and validate the failure
inside a throwaway `git worktree`. It never edits the live checkout and never
publishes git history.

It is not a production feature. Production (`NODE_ENV=production`, which Docker
Compose sets) always disables it even when the source tree is identical.

## Enable

Both are required:

1. Turn on **Self-healing debugging mode** in Settings (`selfHealing: true` in
   `config.json`).
2. Provide an explicit dev signal in the process environment:
   - `LOOPARR_SELFHEAL=1`, or
   - a `SELFHEAL_ENABLED` file at the repository root.

`LOOPARR_SELFHEAL=0` forces it off. `NODE_ENV=production` always wins.

## Flow

1. A step errors and the guard passes: setting on, dev signal present, one round
   only, cooldown elapsed, no healer already recorded, and the failing phase is
   not `selfheal` itself.
2. The engine creates a worktree at `.looparr/selfheal/<run-id>` on a throwaway
   branch `looparr-selfheal-<run-id>` with `git worktree add`. `plan.md` and the
   live checkout are never touched.
3. A runner/model different from the one that failed is asked to investigate the
   error, fix the worktree, commit to the branch, and run the relevant tests. The
   prompt includes the ISO error time, phase, task, error, and a redacted log
   tail. **All log and error text is explicitly framed as untrusted data**, never
   as instructions.
4. When the healer exits 0 the branch is built into a preview stack
   (`docker-compose.heal.yml`, project `looparr-heal`, port `4199`) and
   `/api/state` must answer for **two consecutive cycles**. Both passes set the
   state to `healed`; any failure sets `error` and stops. There is never an
   automatic second round.
5. The preview is spun down and the worktree removed, so the checkout is back to
   its own branch with no extra directory. A Markdown report is written to
   `.looparr/selfheal/<run-id>-analysis.md` with the outcome, error, healer exit
   code, cycle count, branch diff stat, and review commands. Only the branch is
   kept, for human review.
6. The header pill shows `Debugging`, `Healing`, `Healed`, or `Error`. The
   git-branch button appears only in `healed`.

The header pill only appears when the mode is actually available (setting on,
dev signal present, not production). Idle is a dim pixel; engaged states light
the pixel cyan (`debugging`), amber (`healing`), red (`error`), or the Looparr
gradient with a green dot (`healed`).

## Host healer, prod viewer

The healer needs `git` worktrees and the Docker CLI, which exist only on the host
dev checkout — never in the prod container (the prod image has no `git`, no
`docker`). So the split is:

- **Host dev engine writes.** When self-healing is enabled it writes one JSON
  status file per project to `.looparr/selfheal/status/<projectId>.json`
  (atomic temp+rename, mode `0600`) on start (state `idle`), on every healer
  transition, and on round finish, plus a heartbeat every 60 s so a healthy idle
  daemon keeps the file fresh. A status is fresh for
  `SELFHEAL_STATUS_TTL_MS = 30 * 60_000`; stale or malformed files are ignored.
- **Prod reads, never spawns.** Prod maps the freshest status file to the same
  per-project `selfHealer` shape, so the header pill shows the live round
  (`idle` / `debugging` / `healing` / `healed` / `error`) and the merge button
  appears only when `healed` and not yet merged. Prod never runs `git`, `docker`,
  or worktree commands. The prod `selfHealing` setting does **not** gate viewing
  or merging; only a fresh status file and the executor token/URL do.
- **Merge on prod is a relay.** `POST /api/projects/:id/selfheal/merge` on prod
  validates the status file locally, then forwards an authenticated
  `POST /selfheal/merge` to the host executor (`scripts/host-executor.js`), which
  runs `git merge --no-ff` in the fixed repo root and then schedules
  `scripts/restart-looparr.js` detached after a short delay. The rebuild
  recreates the prod container, so the 200 is written **before** the restart
  starts; the UI treats a dropped request as "restarting" and confirms the merge
  on reconnect.
- **No push anywhere.** The relay performs merge + rebuild + restart only.
  Publishing stays a manual or plan-task action with no healer involvement.

The relay refuses non-healed states, foreign project ids, branch names outside
`looparr-selfheal-<number>-<number>`, and already-merged branches; a merge
conflict keeps the branch and returns `409`. Once `mergedAt` is set the merge
button hides and cannot be pressed twice across a restart.

## Caps and state

- One round per error, one healer process, a 20-minute wall-clock timeout, and a
  10-minute cooldown before another round can start.
- Worktrees are deleted at the end of every round; the analysis file is written
  with mode 0600 under `.looparr/selfheal/`, which is git-ignored.
- A healer failure never starts another healer (`failedPhase === 'selfheal'` is
  refused).
- `rt.healer` records `state`, `round`, `cycles`, branch, worktree, phase, and
  timestamps. It is included in the durable resume snapshot, and an interrupted
  `debugging`/`healing` round is restored as `error` so it can never look live.
- Audit events: `healer-spawned`, `healer-exit`, `healer-healed`,
  `healer-failed`, `healer-spundown`, plus `healer-merged` for the human-gated
  merge.

## Git stays local: the human-review rule

**Merging is mandatory human review.** The git-branch button asks
`Test complete on <branch>. Allow PR to Merge to main and rebuild?`, then merges
the branch into the checkout locally, audits `healer-merged`, and starts
`scripts/restart-looparr.js`. Nothing is pushed to a remote by Looparr. Opening,
reviewing, and landing the PR is the human's job.

Rollback is "drop the branch and restore the snapshot": delete the
`looparr-selfheal-*` branch and its `.looparr/selfheal/<run-id>` worktree, or
`git reset` the local merge.

## Threat model

- **Autonomous edits**: gated, worktree-isolated, one round, human-gated merge.
- **Prompt injection** from logs, error text, or repository content: the prompt
  labels that context as data; the healer still runs with the agent's normal
  permissions, so review the diff before merging.
- **Prod detection cannot be source-based** because prod runs the same tree:
  hence the explicit dev signal and `NODE_ENV=production` hard stop.
- **Cost**: one process, one model, timeout and cooldown; no recursion.
- **Preview build** uses the project's Dockerfile and its own compose project, so
  it never replaces the live container.

## Contributing

1. Clone Looparr, enable the setting, export `LOOPARR_SELFHEAL=1`.
2. Force or wait for an error, then watch the pill and the project log.
3. Inspect the branch: `git log --oneline HEAD..looparr-selfheal-<run-id>` and
   `git worktree list`.
4. If `healed`, review the diff, then either use the header button or merge
   manually. Open the PR yourself. Do not add a push step to this feature.

## Verification

- `node scripts/test-self-heal.js` covers the dev gate, the one-round cap, the
  worktree isolation, the two-cycle validation, the no-publish guarantee, the
  snapshot handoff, and the served pill/settings markup.
- `node scripts/test-selfheal-status.js` covers the status file round-trip, TTL,
  path containment, malformed-file rejection, prod `getState()` mapping, merge
  request refusal cases (bad token `401`, non-healed/already-merged `409`, bad
  branch `400`), the executor relay over HTTP, and the no-push guard.
- `npm test` (includes both files), and `git diff --check`.
