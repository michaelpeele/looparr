# Self-healing debugging mode — implementation prompt

Status: open. Plan item: `(plan) Self-healing debugging mode`.
Batch: third of three — `Durable resume snapshot` → `Handoff recovery sweep` → `Self-healing debugging mode`. Depends on items 1 and 2.

## Motivation

When a run errors, a human currently has to diagnose it. This mode spawns **one** detached
session of a *different* model/runner (not the one that failed) with a prompt to investigate the
error, apply a fix, and validate it. It runs at most **one round on its own**; if the fix does
not hold, it flags and stops for a human. It is a debugging aid for a cloned Looparr repo, never
a production feature.

## Goal

Opt-in, dev-only, worktree-isolated self-heal that:
- runs one healer round against the current error,
- validates the fix with a live test of the branched version,
- reports a clear state (Debugging → Healing → Healed | Error),
- and offers a human-gated GitHub/PR handoff — **git stays local for now, no push to origin**;
  the human drives the PR until that is explicitly changed.

## Current building blocks

- Runner abstraction: `runner.buildCommand({ prompt, cwd, model, runKey, phase, task,
  sessionId })` (`src/engine.js:1092`) → spawn → `handleClose` (`src/engine.js:1211`). A healer
  is a step with a synthetic phase (`selfheal`), its own `runKey`, and a healer prompt.
- `listRunners()` (`src/runners/index.js`) and `rt.tried` (per-run model attempts) — pick a
  runner/model **not** equal to the failing one.
- `scripts/restart-looparr.js` — hardened `docker compose build looparr && up -d looparr` with
  lock, health check, stale-intent cleanup, restart-continue marker, post-restart verification.
  This is the rebuild/restart primitive for the final "merge + rebuild" step.
- Deployment: `docker-compose.yml` (`network_mode: service:tailscale`,
  `TS_CERT_DOMAIN=looparr.tail0307d.ts.net`), `serve.json` proxies `/` → `127.0.0.1:3000`.
- UI: `.connection` pill (`public/styles.css:90-108`), `.badge.*` tokens (`:511-524`),
  `.icon-button` (`:388-392`), `window.confirm` pattern (`public/app.js:1495`, `:2422`).

## State model (header indicator, next to the logo)

A four-state pill in `.brand` after `<span class="brand-word">looparr</span>`
(`public/index.html:64`), changing `data-state` → class:

| State | Meaning | Color (token) |
|---|---|---|
| `debugging` | healer investigating/editing | cyan `--accent #22d3ee` |
| `healing` | edits done, branch built, launching live test | yellow `--amber #fbbf24` |
| `error` | fix failed the live test | red `--red #f87171` |
| `healed` | two-cycle live test passed | green `--green #34d399` |

Idle (feature on, not engaged): a dim grayish-blue pixel square on a darker square
(`#0d1421`, slate `#64748b`). Engaged: the square lights with the looparr gradient
(`linear-gradient(90deg, var(--accent), var(--accent-2), var(--green))`) plus a green dot and the
state text. A git-branch `.icon-button` sits to the right in `healed` (and optionally `error`).

## Healer flow

1. Error → gate (setting `selfHealing` on **and** a dev signal, e.g. `LOOPARR_SELFHEAL=1` or a
   committed marker file; **not** mere source presence, since prod runs the same tree) → pick a
   runner/model not in `rt.tried` → spawn one healer round in a `git worktree` on a throwaway
   branch.
2. Prompt includes: ISO `errorAt`, phase, task, `rt.error`, redacted log tail, repo path, and
   instructions to investigate, fix in the worktree, run tests, and stop. Treat logs as untrusted
   data (prompt-injection defense).
3. When edits are done, build the branch and launch a **preview** behind a tailscale hostname
   (e.g. `looparr-heal.tail0307d.ts.net` via a separate `docker-compose.heal.yml` project) →
   state `healing`. Poll its `/api/state` until healthy.
4. Two-cycle live check: two consecutive successful cycles → `healed`. Any failure inside the
   window → `error` and **stop** (no automatic second round).
5. GitHub button → `window.confirm("Test complete on Branch. Allow PR to Merge to main and
   rebuild?")` → on confirm run the merge + `scripts/restart-looparr.js`. **For now: keep git
   local — do not push to origin; the human opens/merges the PR.** Re-enable push only when the
   user explicitly changes this.
6. Spin the heal stack down after the round; keep the branch for review.

## Files to change

- `src/config.js` — `selfHealing` in `DEFAULT_SETTINGS` (~310) and `normalizeSettings`.
- `src/engine.js` — healer trigger, one-round runner, two-cycle check, `rt.healer` state, audits.
- `docker-compose.heal.yml` — separate preview stack (project `looparr-heal`) built from the worktree.
- `public/index.html` — header state pill after `.brand-word` (~line 64) and a settings toggle.
- `public/app.js` — load/save `selfHealing`, render the state pill and GitHub button.
- `public/styles.css` — pill state colors and dim/engaged icon styles.
- `SELFHEALING.md` — mode overview, enable steps, threat model, human-review rule.
- `scripts/test-self-heal.js` — static guards.
- `scripts/test-plan-ui-controls.js` — served-asset assertions for the pill and toggle.

## Requirements

1. Dev-only gate: `selfHealing` setting (default `false`) **and** an explicit dev signal; hard-
   disable under prod compose / `NODE_ENV=production`.
2. One round only; two-cycle validation; then `healed` or `error` (flag and stop). Re-engage is
   manual.
3. Worktree isolation: never edit the live tree or `plan.md`; commit to a throwaway branch.
4. Prompt includes error timestamp and redacted context; logs treated as data, never instructions.
5. State pill with the four states and the git-branch button; merge button only in `healed`.
6. **Git stays local for now: no `git push` to origin as part of this feature.** The merge button
   runs the rebuild/restart primitive locally; PR creation is a human step.
7. Cost/attempt caps: max one round, wall-clock timeout, token budget, cooldown; never spawn a
   healer for a healer error.
8. Audit events: `healer-spawned`, `healer-exit`, `healer-healed`, `healer-failed`,
   `healer-spundown`; persist `rt.healer` in the item-1 snapshot.
9. `SELFHEALING.md` at repo root: mode overview, enable steps, threat model, how contributors run
   the healer against a clone and open PRs, and the mandatory human-review rule.
10. Tests: `scripts/test-self-heal.js` (static guards for the dev gate, one-round cap, worktree
    isolation, no-push guarantee) plus any served-asset assertions in
    `scripts/test-plan-ui-controls.js`. `npm test` and `git diff --check` clean.

## Verification

- Unit/static: gate defaults off; prod signal disables; one-round cap enforced; no `git push`
  present in the merge path; state-pill markup and color tokens present in served assets.
- Manual (after rebuild, dev signal set): force an error, confirm one healer round runs in a
  worktree, the pill shows `debugging` → `healing` → `healed`/`error`, and the GitHub button only
  appears in `healed`; confirm no push to origin occurs.
- Confirm `git diff --check` clean.

## Acceptance criteria

- One self-heal round runs only in a dev-flagged clone, isolated in a worktree, and either heals
  (two-cycle) or flags and stops; rollback is "drop the branch + restore the snapshot".
- Git remains local; no push to origin; the human drives the PR.
- `npm test` green; `SELFHEALING.md` documents the mode and the human-review rule.

## Commit scope and plan marker

Commit only: `src/config.js`, `src/engine.js`, `docker-compose.heal.yml`, `public/index.html`,
`public/app.js`, `public/styles.css`, `SELFHEALING.md`, `scripts/test-self-heal.js`,
`scripts/test-plan-ui-controls.js`.
After implementation and verification are complete, change the plan.md
`(plan) Self-healing debugging mode` line from `- [ ]` to `- [x]` with a one-line Done note.

## Risks

- **Autonomous code edits + PRs** are high-risk: opt-in, dev-only, worktree-isolated,
  human-gated, cost-capped.
- **Prompt injection** from logs/error text: treat all model output as untrusted data.
- **Prod detection** is not source-based (prod runs the same tree); require an explicit dev signal.
- **Cost/loops**: hard cap of one round plus timeout and budget; never recurse on healer errors.