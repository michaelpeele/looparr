Looparr IMPLEMENT step. Fresh session. Work only inside current project directory.

Task: "Fix rate-limit Retry to start immediately by clearing future resumeAt on manual start"

Before code changes, document in markdown:
- Add `.project_documents/FIX-rate-limit-retry.md` with: root cause (`src/engine.js` `start()` returns early when `status==='rateLimited' && resumeAt && Date.now() < resumeAt`, so POST `/api/projects/:id/start` does not clear backoff or schedule tick), impact (UI Retry label added but immediate retry not real), simpler fix (clear `rt.resumeAt` on manual start and continue normal start path), and verification checklist.
- Add a new unchecked plan.md item immediately after line 130 describing this fix. Do not alter other plan items except this new item and its later completion mark.

Implement simpler fix:
- File: `src/engine.js` only (unless test requires another file; prefer engine + tests).
- In `start(id)`, remove the early return that blocks rateLimited future `resumeAt`. Simpler behavior: if rateLimited with future `resumeAt`, clear `rt.resumeAt` (user override) and continue normal start flow. Keep existing logic: preserve `rt.nextPhase`; set `rt.active=true`, `rt.paused=false`, `rt.pauseAfterStep=false`, `rt.resumeAt=null`; set `rt.status='idle'` when no child; emitState(); scheduleTick().
- Do not change rate-limit detection, backoff calculation, `rateLimitRetry()` timeout, UI, routes, or config shape.

Tests:
- Add/extend smoke test covering: project in rateLimited state with future `resumeAt` and `nextPhase` set; calling `start()` clears `resumeAt`, keeps `nextPhase`, makes project eligible/active for scheduling, and does not leave stale rateLimited block. Also confirm stale backoff timeout cannot reapply old rateLimited after manual override (mock timers or observable state).
- Run: new/updated test, `npm test`, `node scripts/test-rate-limit-detection.js`, `node scripts/test-rate-limit-retry-ui.js`, `node scripts/test-auto-resume.js`.

Production:
- Follow `plan.md` production deploy verification. Run `npm run restart:looparr -- --dry-run`, then `npm run restart:looparr`.
- Verify container healthy on new image; served `/`, `/app.js`, `/styles.css` hashes match local; container `/app/src/engine.js` or relevant deployed files match local source as applicable; `/api/state` reachable.
- Only after tests and production verification pass, mark the new plan.md item complete (`- [x]`). Do not touch `.looparr/next_prompt.txt`.

Acceptance:
- Manual Retry/start during active rate-limit countdown clears backoff and schedules immediate retry.
- Existing auto-resume behavior unchanged when user does not press Retry.
- Rate-limit detection/backoff/UI unchanged.
- Tests pass; prod verified; only the new plan item checked.
