# Plan: Managed Host-Side Standby Self-Healer

## Implementation request

Implement automatic self-healing in `/home/michaelpeele/ai-projects/looparr` using option #1: a managed host-side standby healer.

First read `AGENTS.md` and `/home/michaelpeele/ai-projects/workflow.md`. Follow the mandatory sandbox-first build/promotion workflow. Do not repeat the earlier diagnosis; use the confirmed facts below.

## Confirmed facts

- Production sits behind `looparr.tail0307d.ts.net`.
- Prod container is `looparr`, `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=looparr`, and has no `LOOPARR_SELFHEAL`.
- Tailscale proxy `ts-looparr` forwards HTTPS to `127.0.0.1:3000`, which is the prod container.
- No second self-heal stack exists today.
- No healer or host-executor process is running.
- The `Self-healing debugging mode` checkbox only writes `settings.selfHealing` to `config.json`. It does not set `LOOPARR_SELFHEAL` and does not spawn a process.
- In production, self-healing is unavailable unless the engine process has `LOOPARR_SELFHEAL=1`.
- `SELFHEALING.md:164` says the prod stack never sets `LOOPARR_SELFHEAL=1`. Prod only displays status and relays merge.
- `SELFHEALING.md:172` gives the dev healer recipe: `NODE_ENV=development LOOPARR_SELFHEAL=1 node server.js`.
- Prod must keep acting as primary task runner/viewer. Healing must stay on a separate host-side dev/standby engine.
- Prod reads healer state from `.looparr/selfheal/status/<projectId>.json` for the pill and merge button.

## Goal

- Keep production behind `looparr.tail0307d.ts.net` unchanged and view-only.
- Do not set `LOOPARR_SELFHEAL=1` in `docker-compose.yml` or the prod container.
- Do not make prod spawn git/docker worktrees.
- Add a repeatable host-side standby healer service/script that runs the same Looparr engine with `LOOPARR_SELFHEAL=1`, per `SELFHEALING.md:172`.
- The standby healer must share `.looparr` state with prod.
- The standby healer must use a distinct hostname from prod.
- The standby healer must use a separate port, config path, and log path so it does not race the primary.
- With `settings.selfHealing` ON, the standby healer must watch fresh foreign errored checkpoints.
- The standby healer must start exactly one healed round, subject to existing cooldown and dedupe guards.
- The standby healer must write `.looparr/selfheal/status/<projectId>.json`.
- Merge must stay human-gated.
- Prod must continue reading those status files for the pill and merge button.

## Required deliverables

- Add start, stop, install, and status commands.
  - Use `package.json` scripts where appropriate.
  - Add a script such as `scripts/selfheal-daemon.sh`.
  - Make start idempotent.
  - Use a PID file.
  - Use a dedicated log path.
  - Provide a status command.
- Document setup in `SELFHEALING.md` and any relevant README/config docs.
- Keep the existing `Self-healing debugging mode` checkbox as the arming setting.
  - It only writes `settings.selfHealing`.
  - Do not claim it sets env.
- Optional only: add a checkbox/API control to start/stop the standby daemon through the existing host executor.
  - Do not expose arbitrary host commands.
  - If this is not safe or clean, implement scripts only and document why.
- Add or extend tests for:
  - daemon env composition;
  - distinct-hostname requirement;
  - prod-no-spawn behavior;
  - status-file handoff.
- Run `npm test`.
- Run targeted self-heal tests:
  - `scripts/test-self-heal.js`;
  - `scripts/test-selfheal-toggle.js`;
  - `scripts/test-selfheal-status.js`.
- Verify in sandbox with a simulated foreign error.
- Do not trigger the healer against the live prod error without explicit approval.
- Report:
  - changed files;
  - commands run;
  - verification results;
  - remaining risks.

## Constraints

- Never auto-merge.
- Never push.
- Keep the existing human merge gate.
- Do not add `LOOPARR_SELFHEAL=1` to the prod compose stack.
  - `SELFHEALING.md:164` explicitly forbids it.
  - Prod has no git/docker.
  - Merging must stay on the host checkout.
- The standby engine needs host git and Docker CLI.
  - Verify this before considering the implementation complete.
- The standby engine must not adopt primary tasks.
  - It only reacts to fresh foreign errored checkpoints.
- The prod process must still log self-heal as unavailable when no standby engine owns the gate.
- Baseline working tree is already dirty. Preserve existing user work.
- A temporary probe exists in `src/engine.js` around line 2898:
  - `console.error('[probe] tick error:', error.stack);`
- Do not remove or rewrite that probe unless explicitly asked.
  - If it blocks changes or tests, stop and report.
- Current live error is unrelated to this implementation:
  - project `d76e436a-8816-4342-9511-b4706e2320e4`;
  - status `error`;
  - error `"No .looparr/next_prompt.txt for implement step"`.
- Do not conflate the live error with the daemon work.

## Definition of done

- Prod has no healer process and never spawns one.
- Standby daemon can be started with one documented command.
- Prod pill shows `idle` before a round.
- Prod pill shows live healer states during a round.
- Healer branch is created in a worktree.
- Healer branch is validated in the preview stack.
- Merge button appears only on healed status.
- Merge still requires a human action.
