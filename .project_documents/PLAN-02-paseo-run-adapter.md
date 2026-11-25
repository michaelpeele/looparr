# 02 — Paseo run adapter and engine integration

Status: draft — implementation plan.

Estimate: 1–2 days.

Depends on: PLAN-01.

## Goal

Create the shared adapter that converts a Looparr run into a Paseo agent, streams its output, waits for completion, and stops it on cancellation.

## Current behaviour (verified)

- `src/engine.js` builds `{ command, args, options }`, calls `spawn(...)`, streams stdout/stderr, and uses child exit status.
- Self-heal at roughly `src/engine.js:1234–1257` also builds and spawns directly.
- `paseo run [options] <prompt>` creates and starts a Paseo agent. Useful flags: `--no-wait`, `--json`, `--provider`, `--model`, `--cwd`, `--env`, `--label`, `--title`, `--workspace`.
- `paseo attach <id>` views one agent stream. It cannot attach an arbitrary CLI command.
- `paseo agent wait <id>` returns structured status and message.
- `paseo agent stop <id>` cancels an agent.

## Requirements

- Add a new module, suggested name `src/paseo-transport.js`.
- Adapter API:
  - detect setting enabled;
  - map runner/model to Paseo provider/model;
  - start a Paseo agent;
  - record `agentId`;
  - stream timeline or `paseo attach <id>` into Looparr run state;
  - wait for final status;
  - stop agent on cancel or stale-run cleanup.
- Start command shape:
  - `paseo run --no-wait --json --provider <provider[/model]> --cwd <cwd> --title <title> --label looparr=true --label runner=<runner> --label runKey=<key> --label projectId=<id> <prompt>`
- Reuse a stable Paseo workspace per Looparr project. Use `--workspace` or `PASEO_WORKSPACE_ID`; do not create a new workspace for every step.
- Status mapping:
  - `idle` → completed;
  - `error` → failed;
  - `permission` → failed with attention note;
  - `timeout` → timed out.
- Preserve direct CLI mode when `paseoTransport` is false.
- Do not change bridge/host-executor payloads in this task. Keep Paseo transport disabled under host-executor until a later task proves it.

## Implementation by file

- `src/paseo-transport.js`: new adapter.
- `src/engine.js`: in `spawnRunnerAttempt` and self-heal, route through adapter when setting is enabled; store `rt.paseoAgentId`; hook cancellation and stale-run cleanup.
- `src/runners/index.js`: optional shared helper export for provider mapping; do not register a new runner unless needed.
- Runner files: expose structured Paseo metadata only if required. Tasks 03 and 04 handle per-runner details.

## Tests

- Add `scripts/test-paseo-transport.js` with a fake `paseo` binary on `PATH`.
- Verify flags, labels, JSON parsing, status mapping, stop call, and workspace reuse.
- Verify setting off still returns the original built command.

## Verification

Sandbox first. Run focused tests, then one Looparr task with Paseo transport on using a harmless provider. Confirm with:

- `paseo agent ls --label looparr=true --json`
- `paseo agent inspect --json <agentId>`

## Done criteria

Engine can start, observe, finish, and cancel Paseo agents without changing direct mode.
