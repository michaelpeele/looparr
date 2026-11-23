See [workflow.md](../workflow.md) for the mandatory sandbox-first build and promotion workflow.

## Compact output (context budget)

Runner context is costed per token. Keep answers short:

- Report decisions and verification results only. Never echo file contents, logs, plan text, or diffs of unchanged files.
- No preamble, restating the task, or next-step suggestions unless asked.
- There is no chat reviewer: put anything the NEXT session needs into `.looparr/next_prompt.txt` or the handoff docs, then stop.
