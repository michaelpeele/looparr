See [workflow.md](../workflow.md) for the mandatory sandbox-first build and promotion workflow.
See [HEALER_STATE.md](HEALER_STATE.md) for required healer standby state, testing, updates, and final-state checks.
See [AUTH_FAILURE_UI.md](AUTH_FAILURE_UI.md) for the 401 auth-warning requirement and retry rules.

Promotion: use `npm run restart:looparr` (transient user unit `looparr-promote`). Never run raw `docker compose build`/`up`: raw compose dies with the agent cgroup between create and start and takes production down.

Promotion is idempotent: each run writes `.looparr/promotion-status.json` and tees output to `.looparr/logs/promotion-latest.log`; when the running container already serves the current source (hashes + health + `/api/state` evidence) it skips the rebuild and exits 0 with `skipped-already-deployed`. Bypass with `--force` or `LOOPARR_FORCE_PROMOTION=1`. See `.project_documents/PROMOTION.md` for the status artifact, evidence gates, bounded compose timeout, and recovery hook.

Permissions: all executable scripts must have permissions that enable them to be run. Files copied into images must be readable by the container runtime user: `0644` for source files, `0755` for executables. Never leave `0600` files in the build context.

## Compact output (context budget)

Runner context is costed per token. Keep answers short:

- Report decisions and verification results only. Never echo file contents, logs, plan text, or diffs of unchanged files.
- No preamble, restating the task, or next-step suggestions unless asked.
- There is no chat reviewer: put anything the NEXT session needs into `.looparr/next_prompt.txt` or the handoff docs, then stop.
