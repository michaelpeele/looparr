# 04 — Vibe and Kilo wiring through Paseo

Status: draft — implementation plan.

Estimate: 0.5–1 day.

Depends on: PLAN-02.

## Goal

Wire the `vibe` and `kilo` runners through their existing Paseo providers, with fresh-agent scope first.

## Current behaviour (verified)

- `/home/michaelpeele/.paseo/config.json` has Paseo providers:
  - `mistral-vibe`, command `["vibe-acp"]`;
  - `kilo`, command `["kilo","acp"]`.
- `paseo provider ls --json` reports both available/enabled.
- `paseo agent ls --global --all --json` showed only Vibe agents, not Kilo agents.
- Kilo sessions exist locally, but Paseo cannot read them through ACP `session.list`; ACP plugin provider only lists sessions when the capability exists.
- Vibe has a known resume conflict on session `59bfc71c-7943-3403-60f4-57ac3aeedfa0`.

## Requirements

- Map Looparr runner `vibe` to Paseo provider `mistral-vibe`.
- Map Looparr runner `kilo` to Paseo provider `kilo`.
- Model mapping:
  - Vibe models `zai-glm-5-3-flash-vibe-free` and `zai-glm-5-3-flash` pass through when available.
  - Kilo model ids drop the `kilo/` namespace before passing to Paseo.
  - Fall back to provider default when a mapped model is unavailable.
- Add labels: `runner=vibe|kilo`, `runKey`, `projectId`, `looparr=true`.
- Initial scope is fresh Paseo agents only.
- Do not import existing Kilo sessions until ACP `session.list` support is proven.
- Do not resume the known conflicting Vibe session. If an existing Vibe session id appears, create a fresh agent and record a warning.
- Keep direct CLI mode unchanged when the setting is off.

## Implementation by file

- `src/paseo-transport.js`: add Vibe/Kilo mappings, model normalization, and unsupported-import guard.
- `src/runners/vibe.js`: expose structured Paseo metadata in `buildCommand`.
- `src/runners/kilo.js`: expose structured Paseo metadata in `buildCommand`.
- Tests under `scripts/`: provider mapping, model normalization, labels, warning path.

## Tests

- Fake CLI tests for `mistral-vibe` and `kilo` provider flags.
- Sandbox test with one fresh Vibe run and one fresh Kilo run.
- Confirm mobile shows both Paseo agents.

## Verification

- `paseo agent ls --label runner=vibe --json`
- `paseo agent ls --label runner=kilo --json`
- `paseo agent inspect --json <agentId>`
- Confirm no attempt is made to import unsupported existing Kilo sessions or resume the conflicting Vibe session.

## Done criteria

Fresh Vibe and Kilo Looparr runs are visible in Paseo mobile, finish with correct status, and do not regress direct mode.
