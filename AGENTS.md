See [workflow.md](../workflow.md) for the mandatory sandbox-first build and promotion workflow.
See [HEALER_STATE.md](HEALER_STATE.md) for required healer standby state, testing, updates, and final-state checks.
See [AUTH_FAILURE_UI.md](AUTH_FAILURE_UI.md) for the 401 auth-warning requirement and retry rules.

Promotion: use `npm run restart:looparr` (transient user unit `looparr-promote`). Never run raw `docker compose build`/`up`: raw compose dies with the agent cgroup between create and start and takes production down.

## Compact output (context budget)

Runner context is costed per token. Keep answers short:

- Report decisions and verification results only. Never echo file contents, logs, plan text, or diffs of unchanged files.
- No preamble, restating the task, or next-step suggestions unless asked.
- There is no chat reviewer: put anything the NEXT session needs into `.looparr/next_prompt.txt` or the handoff docs, then stop.
