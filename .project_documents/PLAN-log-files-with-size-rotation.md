# Plan: Log Files With Size Rotation

Status: implementation verified and committed in scoped commit `feat(logs): per-project NDJSON log store with 10 MiB rotation`; container-level verification deferred to a separate batch.
Source task: "(plan) Log files with size rotation — see PLAN-log-files-rotation.md".
Source specification: `.project_documents/PLAN-log-files-rotation.md`.

## Decisions From Clarification

- The existing uncommitted implementation is the implementation. Verify it against the source plan and commit it as-is rather than discarding or rewriting it.
- Hydration from the newest file only is accepted. After a size rotation the newest file may hold fewer than `LOG_LIMIT` entries; no walk-back into older segments is required.
- This batch covers `npm test` and the scoped commit. Container-level verification (build, forced rotation, restart, seeded prune) runs in a separate batch.

## Design

Persist the UI log buffer to disk so log history survives a process restart, while bounding disk usage per project.

The engine keeps the existing in-memory buffer and SSE behavior. For every emitted log entry it appends one NDJSON line to a per-project log store. Each project gets its own directory under the configured log root. Within that directory the store writes sequential timestamp-named segments and opens a new segment once the active segment reaches the size cap. Rotation is size-only; time does not trigger a new file. Local timestamps use lexical order (`YYYY-MM-DDTHH-mm-ss-SSS`), and a same-millisecond collision gets a numeric suffix (`-2`, `-3`, ...).

On startup the engine hydrates the in-memory log buffer from the newest segment for each active project, up to `LOG_LIMIT` entries, and restores `logSeq` to the highest sequence seen. New appends continue into that same active segment. The public API (`/api/state`) keeps returning `logs.slice(-200)`; no API shape changes.

Retention removes files older than seven days by mtime. Pruning runs once at startup and at most hourly thereafter, skips the active segment of every project, and removes project directories left empty. All log-store operations are best-effort: write or prune failures never break a run, and errors are reported once per project.

Configuration comes from environment variables with safe defaults:

- `LOG_DIR` = `LOOPARR_LOG_DIR` or `path.join(path.dirname(configStore.CONFIG_PATH), 'logs')`
- `LOG_MAX_BYTES` = `LOOPARR_LOG_MAX_BYTES` or `10 * 1024 * 1024`
- `LOG_RETENTION_MS` = `(LOOPARR_LOG_RETENTION_DAYS || 7) * 86400000`

The separate `src/auto-resume.js` log (`.looparr/auto-resume.log`, 64 KiB, `.log.1` rotation, mode `0o600`) stays unchanged. Production mounts `./data:/app/data` with `CONFIG_PATH=/app/data/config.json`, so the default log root resolves under the mounted data volume.

## File Map

| File | Role |
| --- | --- |
| `src/log-store.js` | New module. Owns per-project segments, append, hydration, prune, and close. Exports `logDir`, `fileFor`, `append`, `readRecent`, `prune`, `closeAll`, `LOG_MAX_BYTES`, `LOG_RETENTION_MS`. |
| `src/engine.js` | Wires the store into `ensureRuntime` (hydrate `rt.logs` and `logSeq`), `appendLog` (append after in-memory push and bus emit), `tick` and `init` (prune), and shutdown (`closeAll`). |
| `scripts/test-log-store.js` | New unit tests for format, rotation, collisions, retention, hydration, corrupt lines, and write failures. |
| `package.json` | Includes `node scripts/test-log-store.js` in the `test` script. |
| `.gitignore` | Ignores `data/logs/` so segments stay out of version control. |
| `.project_documents/PLAN-log-files-rotation.md` | Original specification; kept as the source of truth for the design. |
| `plan.md` | Tracks the generated checklist for this task. |
| `.looparr/next_prompt.txt` | Carries the next-phase analysis prompt. |

## Ordered Steps

1. Confirm `src/log-store.js` implements the source plan: sanitized project IDs, timestamp segment names with collision suffixes, `0o600` appends, per-project byte tracking, newest-file hydration with field validation, throttled mtime prune that skips active segments, and one-time error reporting.
2. Confirm `src/engine.js` wiring: hydrate in `ensureRuntime`, append in `appendLog`, prune in `init` and `tick`, and `closeAll` on shutdown. Confirm no API or SSE behavior changed.
3. Confirm `scripts/test-log-store.js` covers all seven cases and runs from `npm test`.
4. Confirm `.gitignore` ignores `data/logs/` and `package.json` runs the new tests.
5. Run `npm test` and `git diff --check`.
6. Review the working-tree diff and stage only the log-rotation files: `.gitignore`, `package.json`, `src/log-store.js`, `scripts/test-log-store.js`, and the log-store hunks in `src/engine.js`. Leave unrelated changes from other tasks unstaged.
7. Commit the staged log-rotation work with a message describing disk-backed, size-rotated logs with seven-day retention.
8. Update this document's status and `plan.md` checklist to reflect the completed verification and commit.

## Tests

- `scripts/test-log-store.js` sets `LOOPARR_LOG_DIR` to a temporary directory, `LOOPARR_LOG_MAX_BYTES=512`, and a fresh module instance per case.
- NDJSON format and `0o600` file mode for a normal append.
- Rotation with no lost entries and lexically ordered segment names after the cap is crossed.
- Same-millisecond appends produce `-2` and `-3` collision suffixes.
- Prune removes eight-day-old files, keeps two-day-old files, and never removes an active segment.
- `readRecent` returns the last 400 entries after a simulated restart and sequence numbering continues from the restored value.
- A corrupt or partial trailing line is skipped during hydration.
- An unwritable log directory produces no throw.
- `npm test` runs the new suite alongside existing suites.
- `git diff --check` reports no whitespace errors.

Container verification deferred to a later batch: build and start the production image, confirm a real step creates a segment, force a segment past 10 MiB and confirm rotation, restart and confirm hydration, seed an eight-day-old file and confirm prune, then compare container and source hashes.

## Acceptance Criteria

- Each log entry is one JSON line with `seq`, `ts`, `stream`, and `text`.
- One directory per project; one 10 MiB segment per file; timestamp names sort lexically; collisions get numeric suffixes.
- Disk usage is capped per project, not globally.
- Files older than seven days are removed at startup and at most hourly; active segments and non-empty directories are preserved.
- Restart restores the newest 400 entries and continues sequence numbering; `/api/state` still returns 200 entries.
- Log-store failures never break a run.
- `npm test` passes and the log-rotation change is committed without unrelated work.

## Risks

- `src/engine.js` contains changes from other tasks. Staging must be hunk-scoped so unrelated work is not committed.
- Several unrelated untracked files and temporary directories exist. Bulk staging would pollute this commit.
- Newest-file-only hydration can show fewer than 400 log lines after a recent rotation. Accepted by clarification.
- Prune relies on mtime. External tools that rewrite mtime can keep stale files or drop wanted ones.
- Local timestamp names assume a single stable local timezone across restarts; a timezone change can disturb lexical ordering.
- The size cap is checked before append, so one oversized entry can push a segment slightly past 10 MiB.
- Container-level behavior is not exercised in this batch; production verification remains outstanding.
