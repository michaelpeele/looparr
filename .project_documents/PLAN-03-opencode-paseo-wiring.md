# 03 — OpenCode wiring through Paseo

Status: draft — implementation plan.

Estimate: 0.5–1 day.

Depends on: PLAN-02.

## Goal

Wire the existing `opencode` runner through Paseo's built-in OpenCode provider.

## Current behaviour (verified)

- `opencode` is built into Paseo. No custom Paseo provider entry is needed.
- `paseo provider ls --json` reports `opencode` available/enabled with modes `Build, Plan`.
- `paseo provider diagnostic opencode` reports OpenCode server `http://0.0.0.0:4096`, `Models: 6`, `Status: Ready`.
- Mobile OpenCode session visibility comes from Paseo listing importable sessions from the OpenCode service. It does not come from persisted Paseo agents.
- `paseo agent ls --global --all --json` showed no persisted `opencode` agents; only Vibe agents were present.
- Looparr's direct OpenCode runner uses `opencode run --attach/--server http://localhost:4096 --auto --format json ...`, supports `--session`, and captures OpenCode session IDs.

## Requirements

- Map Looparr runner `opencode` to Paseo provider `opencode`.
- Strip Looparr namespace from model ids before passing to Paseo. Use Paseo default model when the mapped model is unavailable.
- New run path: `paseo run --no-wait --json --provider opencode[/model] ... <prompt>`.
- Existing session path: use Paseo import/resume semantics, not raw `opencode run --session`.
  - Candidate flow: `paseo import <sessionId> --provider opencode --cwd <cwd>` then `paseo send <agentId> <prompt>`.
  - Verify this flow in sandbox before relying on it.
- Store both ids on the Looparr run state:
  - OpenCode provider session id;
  - Paseo agent id.
- Keep OpenCode session capture/checkpoint handoff working for Paseo runs.
- Do not add a custom `opencode` provider to `/home/michaelpeele/.paseo/config.json`.

## Implementation by file

- `src/paseo-transport.js`: add OpenCode provider mapping and import/send helpers.
- `src/runners/opencode.js`: expose structured Paseo metadata from `buildCommand` without breaking direct command output.
- `src/engine.js`: persist OpenCode session id and Paseo agent id together.
- Tests under `scripts/`: cover new run, import, model fallback, and session id capture.

## Tests

- Fake CLI tests for flag order and JSON parsing.
- Sandbox test against the real OpenCode service at `http://0.0.0.0:4096`.
- Confirm mobile shows the new Paseo-backed OpenCode agent.

## Verification

- `paseo provider diagnostic opencode`
- `paseo agent ls --label runner=opencode --json`
- `paseo agent inspect --json <agentId>`
- Confirm Looparr run state contains both session id and agent id.

## Done criteria

OpenCode runs created by Looparr are visible in Paseo mobile, finish correctly, and preserve session handoff.
