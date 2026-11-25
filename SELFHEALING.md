# Self-healing debugging mode

Self-healing is an opt-in development aid for a **cloned** Looparr checkout. When a
project step errors, Looparr can spawn exactly **one** detached session of a
different runner/model with a prompt to investigate, fix, and validate the failure
inside a throwaway `git worktree`. It never edits the live checkout and never
publishes git history.

It is not a production feature. The containerized viewer (`NODE_ENV=production`,
which Docker Compose sets, no `git`, no `docker`) never spawns a healer; it can
only display what the dev engine wrote. An explicit `LOOPARR_SELFHEAL=1`
overrides `NODE_ENV=production`, which is how a host-primary engine that runs
with production env opts in — the container never carries that variable, so the
compose stack stays view-only.

## Enable

Precedence, top to bottom:

1. `selfHealing: true` in `config.json` (Settings).
2. `LOOPARR_SELFHEAL=0` forces it off, overriding everything below.
3. `LOOPARR_SELFHEAL=1` turns it on, overriding `NODE_ENV=production`.
4. Without an env signal: `NODE_ENV=production` disables it; otherwise a
   `SELFHEAL_ENABLED` file at the repository root turns it on.

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
explicit signal, or dev with the marker file). Idle is a dim pixel; engaged
states light the pixel cyan (`debugging`), amber (`healing`), red (`error`), or
the Looparr
gradient with a green dot (`healed`).

### Live trigger: healing a running primary

The standing dev engine also watches the primary's checkpoint intents on the
checkpoint cadence. When a fresh (≤ one checkpoint interval) checkpoint from a
different hostname is in `status: error`, the same single-round flow starts
automatically — no restart of either engine. Guards: the dev engine's own
project is idle (no child, no healer), the cooldown is clear, and a digest of
`runKey + error` dedupes the trigger — the same error never starts two rounds,
while a changed error text re-arms. The dev engine never adopts or resumes the
primary's task; it only starts the healer, and the merge stays human-gated.

The flow above is unchanged: same one round, same branch, same preview
validation, same pill and merge button.

At boot the same rule applies: a healing-capable engine that finds a fresh
foreign checkpoint — healthy *or* errored — never adopts the primary's task.
It audits `resume-skipped-primary-live` or `resume-skipped-foreign-error`
and lets the live trigger handle the error. Only a stale intent (no live
primary for a while) or a same-hostname restart is adopted as before.

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
  A dev engine is only needed to *run* a round; the idle pill does not need one.
- **Prod reads, never spawns.** Prod maps the freshest status file to the same
  per-project `selfHealer` shape, so the header pill shows the live round
  (`idle` / `debugging` / `healing` / `healed` / `error`) and the merge button
  appears only when `healed` and not yet merged. Prod never runs `git`, `docker`,
  or worktree commands.
- **Setting ON lights an idle pill.** Whenever the `selfHealing` setting is on,
  the pill is available and each project falls back to `idle` when no fresh live
  status exists (no dev engine running, or all rounds finished). When a dev engine
  is actively healing, its fresh status file overrides the idle fallback and the
  pill progresses through the colors; once the file goes stale (TTL) prod falls
  back to idle. The setting alone never lets prod spawn a healer or run git.
- **Standby gate.** A healing-capable engine can run beside the primary. At
  boot, a fresh (under ~3 checkpoint intervals) non-error checkpoint written by
  a different hostname means the primary is mid-task: the engine does not adopt
  it, writes a `resume-skipped-primary-live` audit entry and a log line, and
  stays idle. Errored checkpoints still resume, and a same-hostname engine
  restarting into itself always resumes, so crash recovery is untouched.
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
- A finished round is parked in `rt.lastHealer` (also snapshot-persisted), so
  the engine is free to heal again later while the pill — and, for a `healed`
  round, the merge button — stays visible. The merge works from `lastHealer`;
  `mergedAt` set on it keeps the button hidden across restarts.
- Audit events: `healer-triggered-by-primary` (live trigger picked up a
  foreign error), `healer-spawned`, `healer-exit`, `healer-healed`,
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
  hence the explicit signal with the documented precedence above. The compose
  prod stack never sets `LOOPARR_SELFHEAL=1`; do not add it there — that side
  has no `git`, and merging must stay on the host checkout.
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
- `node scripts/test-auto-resume.js` covers the foreign-error intent unit
  contract (freshness, identity, status, error round-trip) and the live
  trigger: a standing engine picks up a fresh foreign errored checkpoint, does
  not re-trigger for the same digest, and re-arms when the error changes.
- `npm test` (includes all three files), and `git diff --check`.
