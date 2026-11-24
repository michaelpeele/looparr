# New-session prompt: phase 2 same-session resume after container restart

Paste everything below into a fresh agent session in `/home/michaelpeele/ai-projects/looparr`.

---

You are working in the Looparr repository. Read `AGENTS.md`, `plan.md`, and `.project_documents/PROGRESS.md` first. Follow the repository's verification and promotion rules. Do not restart live Looparr or change production state unless the operator explicitly approves that step after tests pass.

Implement **phase 2: true same-session resume after a Looparr container restart**. Phase 1 already restores task, phase, handoff provenance, and a single active run after a planned restart. It does not preserve the OpenCode conversation. A resumed step currently starts a fresh `opencode run`. Phase 2 must resume the same OpenCode session when that session still exists on the host, and must fall back safely when it does not.

## No-code-change boundary for this prompt artifact

This file is a prompt and analysis artifact only. No phase 2 application code was changed when it was created. Phase 2 code is authorized only in a later session that receives this prompt. The implementing session must preserve unrelated dirty files, must not touch `.looparr/next_prompt.txt`, and must not change production configuration or perform a live promotion without explicit approval.

## Concise findings to start from

- OpenCode CLI supports `--continue`/`--session`. `opencode run --help` (v2.3.2) also confirms `--format json` and the flags the runner already uses; see `.project_documents/INVESTIGATION-free-runner-options.md:68`.
- No code extracts or stores an OpenCode session ID today. The host executor's active-run entry and `GET /active` expose only `runKey`, `runner`, `projectId`, `cwd`, and `startedAt` (`scripts/host-executor.js:443,541`). The resume intent stores an optional `runKey` only (`src/auto-resume.js:95`).
- Runner command construction is the handoff point. Bridge payload assembly is in `src/runners/opencode.js:125-146`. The actual OpenCode argument list is built in `scripts/host-executor.js:409` as `args = ['run', flag, serverUrl, '--auto']`.
- Existing restart flow: `src/engine.js:1266-1349` writes the intent and quiesces the child; `src/engine.js:1371-1489` consumes the intent and starts the resumed step; `src/auto-resume.js:80-202` writes, reads, and atomically consumes the intent.
- Host-side `activeRuns` is memory-only (`scripts/host-executor.js:113`, `443-460`). For container-only restart, the durable copy must live with the project intent. The active-run record should also expose the session ID for observability and dedupe checks.
- Existing guards must stay intact: stable `runKey`, single active run per key, executor `/active` dedupe before resume, handoff provenance checks, task-change degradation, opt-in `autoResumeOnStart`, and Stop clearing intent.

## Implementation direction

1. **Verify the CLI contract before coding.** Probe the installed OpenCode binary and confirm the exact semantics of `--session` and `--continue`, including whether the ID is project-scoped by `cwd`. Confirm how to extract the session ID from `--format json` output or another reliable source. Do not assume an event field name from memory. Preserve existing streamed logs and rate-limit detection; JSON output must not break `isRateLimit()` in `src/runners/opencode.js`.

2. **Plumb the ID through the runner path.** Extend `src/runners/opencode.js:125-146` so a resume can pass a validated `sessionId` in `LOOPARR_TASK_PAYLOAD`. Leave fresh runs unchanged. Prefer an explicit `--session <id>` on the resumed command. Use `--continue` only if the probe proves it is safe and scoped to the project directory. Validate type, length, and safe characters; never pass arbitrary text into argv.

3. **Change the host executor command.** At `scripts/host-executor.js:409`, add the verified resume flag only when a validated session ID is supplied. Include the ID in the `activeRuns` entry and in `GET /active` output around `scripts/host-executor.js:443,541`. Keep NDJSON frames and the final `exit` frame unchanged.

4. **Persist the ID in the intent.** Extend `src/auto-resume.js:80-202` with an optional validated `opencodeSessionId` field. Keep old intents valid: missing field means fresh run. Do not store prompts, answers, tokens, headers, executor URLs, or environment values in the intent or audit log. Record only a short audit cause such as `session-resumed`, `session-missing`, or `session-invalid`.

5. **Wire the engine.** In `src/engine.js`, capture the session ID for the active step, write it from `writeCheckpointIntent()` and `prepareShutdownResume()`, read it from the consumed intent in `resumeOnStart()`, and pass it into the resumed runner attempt through `spawnRunnerAttempt()`. Clear or ignore the ID when the task no longer matches, handoff provenance fails, the phase degrades to seed, the user presses Stop, or the project is not opted in.

6. **Fallback behavior.** A missing, malformed, foreign-cwd, or nonexistent session ID must produce a fresh run, not a failure loop. Keep dedupe cancellation and the single-active-run guard authoritative. Non-OpenCode runners and normal fresh steps must remain unchanged.

7. **Documentation.** Update `README.md` auto-resume text, `plan.md`, and `.project_documents/PROGRESS.md` with the contract, fallback rules, commands run, and verification results. State clearly that phase 2 covers a Looparr container restart while the host executor and OpenCode session store survive; host executor or OpenCode data loss still degrades to a fresh run.

## Acceptance criteria

- With `autoResumeOnStart` enabled and the same task and handoff, a planned Looparr restart resumes the step with the persisted OpenCode session ID instead of creating a fresh conversation.
- The resumed command visibly uses the verified `--session <id>` (or approved `--continue`) path in logs and tests, while a normal new step remains fresh.
- Session ID is present in the intent and active-run records, validated, and absent from audit logs except for whitelisted cause strings.
- Missing, invalid, or stale session ID falls back to a fresh run with an audit entry and no crash.
- No duplicate host runs occur for the same `runKey`; existing dedupe-cancel behavior still produces exactly one active run after resume.
- Task mismatch, stale intent, opt-out, handoff provenance mismatch, and Stop behavior are unchanged.
- `npm test`, focused session tests, `git diff --check`, and `node --check` on every touched JavaScript file all pass.

## Test and live verification plan

- Extend `scripts/test-auto-resume.js` to assert that intent write/read/consume preserve a valid session ID, reject invalid shapes, tolerate old intents without the field, and clear or ignore it on task mismatch, Stop, and degraded handoff.
- Extend `scripts/test-runner-payload.js` to assert that `opencode.buildCommand()` includes the session ID only for resume paths and that bridge mode fails fast on malformed IDs.
- Extend `scripts/test-host-executor-run-key.js` with a fake OpenCode that records argv. Assert the resumed run receives the verified flag, `GET /active` exposes the ID, and a fresh run does not include the flag.
- Add a focused extraction test if the chosen session-ID source parses JSON. Wire it into `package.json` `test` and cover valid JSON, split chunks, malformed JSON, and absent ID.
- Run `npm test` as one command and report exact output. Run `node --check` on all changed JavaScript files and `git diff --check`.
- Live verification must use a temporary project and an isolated executor port. Start a real OpenCode step, let the session ID be recorded, run the planned-restart preparation path, simulate or perform an approved Looparr restart, and confirm exactly one resumed run with the same OpenCode transcript. Then verify stale-session fallback after removing or invalidating the recorded ID. Restore or delete all temporary projects and state.
- Production promotion is separate from the tests. Only after explicit approval, follow the block at the top of `plan.md`: run `npm run restart:looparr -- --dry-run`, then `npm run restart:looparr`; verify container health, new image, served HTML/CSS/JS hashes, container file hashes, and `/api/state`.

## Deliverable

One handoff summary containing: the verified OpenCode CLI contract, the chosen session-ID source and flag, the persisted field name and compatibility rule, fallback behavior, files changed, test commands with results, live verification evidence, and production verification numbers if promotion was approved.
