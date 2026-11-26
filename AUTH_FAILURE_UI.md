# Auth failure warning for CLI runners

This document records the required behavior for CLI authentication failures.
It is a specification for future work, not an implementation note. Do not treat
this document as permission to change runtime state or promote code.

## Problem

A runner can fail with an authentication error while the generic engine error
only says `seed step exited with code 1`. The useful detail stays in CLI step
output, so the user sees neither the cause nor a recovery action. The runner can
then be selected again and fail repeatedly.

The observed production case was:

- Runner: Kilo CLI.
- Model: `kilo/baidu/ernie-5.5-flash-preview:free`.
- Step output: HTTP `401`, `INVALID_TOKEN`, and
  `Your authentication token is invalid. Please sign in again.`
- Generic error: `seed step exited with code 1`.

## Required behavior

When a CLI step emits an authentication failure, especially HTTP `401`,
`INVALID_TOKEN`, or `Your authentication token is invalid. Please sign in
again.`, Looparr must:

1. Detect the failure from the raw step output, not from the generic
   `seed step exited with code 1` message.
2. Persist the failure by runner id with the ISO timestamp and a short error
   line.
3. Include the failure in `/api/state` so the UI can render it.
4. Show the warning in the footer near `CONFIGURED RUNNER`.
5. Mark the configured runner red while the block is active.
6. Show a short visible note, such as `AUTH REQUIRED · 401`.
7. Put the full detail in the native hover tooltip on the runner and note:
   - ISO timestamp.
   - Runner label and id.
   - The `401` error line.
   - The recovery hint.
8. For Kilo, use this exact hint:
   `Open CLI and /models, pick Kilo gateway and reauthenticate.`
9. Skip the blocked runner in automatic retries, failover, and rotation.
10. Clear the block only after reauth has been confirmed.

## UI anchors

The warning belongs in the existing host strip:

- `public/index.html`: `#host-runner` and `#host-runner-detail` under
  `CONFIGURED RUNNER`.
- `public/app.js`: `updateHostSummary(state)`, currently around lines
  1322-1350.
- `public/styles.css`: `.host-strip`, `.host-item`, and `.host-note`, currently
  around lines 194-215.

The UI should read an `authFailures` collection from `state`. Text assignments
must stay escaped. Native `title` is sufficient for hover detail.

## Retry and clearing rules

Authentication blocks must be sticky.

- Do not clear on timeout, cooloff, daemon restart, standby restart, or a new
  project error.
- Do not use a long timed cooldown as a substitute. Reauth has no reliable
  checkpoint API, so the block lasts until human action or verified success.
- Clear a runner only after one of these events:
  - a human presses Start, which asserts reauth happened; or
  - a later step with that same runner completes successfully.
- If every configured runner is blocked, stop with a clear auth error. Do not
  launch a step with a blocked runner.
- Manual clearing, if added later, must be explicit in the UI and API.

## Suggested implementation shape

Future implementation should follow existing repo patterns:

- Add `src/auth-failures.js` with state path controlled by
  `LOOPARR_AUTH_FAILURES_STATE`. Default the file next to `CONFIG_PATH`, using
  the pattern in `src/rotation-store.js`.
- Store records keyed by runner id:
  `runnerId`, `runnerLabel`, `at`, `message`, and `hint`.
- Export helpers for detection, message extraction, hint lookup, record, get,
  list, block check, and clear.
- Add auth state to `getState()` in `src/engine.js` so `/api/state` exposes it.
- Record the failure in the failed-close path where `rt.stepOutput` is still
  available.
- Clear the failure in the successful-close path for `rt.activeRunner`.
- Skip blocked runners during candidate selection in `src/engine.js`.

## Verification for implementation work

When this feature is implemented later:

- Add `scripts/test-auth-failures.js` for detection and persistence.
- Add `scripts/test-auth-failure-ui.js` for UI source wiring.
- Add both scripts to the `package.json` test chain.
- Run `npm test`.
- Run `git diff --check`.
- Verify the footer shows red runner text, a short auth note, and a tooltip
  containing timestamp, `401` error, and the exact Kilo hint.
- Verify a blocked runner is skipped by automatic retry and failover.
- Verify clearing happens only after human Start or verified success.
- Promote only through `.project_documents/PROMOTION.md`.
