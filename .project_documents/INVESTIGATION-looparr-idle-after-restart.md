# Investigation: Looparr shows idle after container restart

Date: 2026-11-21

## Symptom

After the model-selector session, the `looparr` project showed `idle` in the dashboard. The user did not click Stop. No error was visible.

## Evidence

`GET http://127.0.0.1:4188/api/state` returned, for the `looparr` project:

- `status: "idle"`
- `active: false`
- `paused: false`
- `pauseRequested: false`
- `error: ""`
- `logs: []`
- `nextTask: "Add hide/show button for completed tasks. Add double arrows to move to top / bottom on plan list. Add hamburger icon on left to be able to hold click and drag item to different place"`
- `progress: { "total": 50, "completed": 40 }`

Container and runtime evidence:

- `docker inspect -f '{{.State.StartedAt}}' looparr` returned `2026-11-21T17:20:15.98710581Z`.
- The check ran at `2026-11-21T17:23:40Z`; container had been up about 3 minutes.
- `docker compose logs --tail 200 looparr` showed only `[looparr] Dashboard running at http://0.0.0.0:3000`.
- `docker compose ps looparr` showed `Up ... (healthy)`.
- Host executor is alive and healthy from inside the container: `GET http://172.17.0.1:4187/health` returned `{"ok":true,"projectsRoot":"/home/michaelpeele/ai-projects","opencodeBin":"/home/michaelpeele/.opencode/bin/opencode"}`.
- `ss -ltnp` showed the executor listening on `172.17.0.1:4187`, not `127.0.0.1:4187`.

Code evidence in `src/engine.js`:

- Line 15: `const config = configStore.loadConfig();`
- Line 16: `const runtime = new Map();`
- Lines 27-48: `ensureRuntime(project)` creates in-memory runtime state with `status: 'idle'`, `active: false`, and empty `logs`.
- Lines 292-311: `start(id)` sets `rt.active = true` and clears `resumeAt`/`error`.
- Lines 325-346: `stop(id)` sets `rt.active = false`, `rt.status = 'idle'`, and clears `currentTask`.
- Lines 375-420: `handleClose()` on success keeps `rt.active` true and sets `rt.status = 'idle'`; failure paths set `status: 'error'` and write an `✖` log.
- Lines 540-544: `eligibleProjects()` requires `rt.active && !rt.paused && !rt.child && !rt.starting && !rt.resumeAt`.

## Conclusion

The project did not stop because of a user Stop click, a runner failure, or an executor failure. The production `looparr` container was rebuilt and recreated during the mandatory verification step at `17:20:15Z`. Engine runtime state is memory-only. Recreation discarded the previous `active: true` state. On startup `ensureRuntime()` rebuilt the runtime as `idle`/`active: false` with empty logs.

Result: Looparr is healthy but idle. It will not start the next phase until Start is clicked, because `eligibleProjects()` excludes `active: false` projects.

## Immediate recovery

Click Start on the `looparr` project. The next task is plan.md line 108: hide/show completed tasks, move-to-top/bottom controls, and drag handle.

## Durable fix direction

Add an opt-in, persisted per-project `autoResumeOnStart` flag.

Required behavior:

1. Before a graceful shutdown/restart of the looparr container, log whether auto-resume should occur. Gate this check on the process actually running as the looparr container (for example `HOSTNAME=looparr`). Persist the pending intent so it survives recreation.
2. On engine startup, check projects marked `autoResumeOnStart` and any persisted pending intent. Resume those projects, preserving the prior phase where possible. Clear stale pending intent after it is handled.
3. Keep a small append-only log (for example `.looparr/auto-resume.log` per project) so the before/after behavior is auditable. Never log tokens.
4. Expose the flag through config, API state, and a project drawer checkbox.
5. Add dependency-free tests. Verify in a temp config before touching production.
6. Use a restart helper for planned rebuilds so the "about to resume" log happens before `docker compose up -d looparr`.

See `.looparr/next_prompt.txt` for the implementation directive.
