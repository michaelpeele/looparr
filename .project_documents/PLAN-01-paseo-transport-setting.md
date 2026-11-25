# 01 — Paseo transport setting and UI

Status: draft — implementation plan.

Estimate: 0.5 day.

Depends on: none. Do this first.

## Goal

Add one opt-in global setting that makes Looparr call the CLI through Paseo. Default remains direct CLI calls.

## Current behaviour (verified)

- `src/config.js` owns `DEFAULT_SETTINGS` and `normalizeSettings`.
- `server.js` validates `PATCH /api/settings` fields explicitly.
- `public/index.html` and `public/app.js` already expose global runner and boolean settings.
- `data/config.json` on this host has `globalRunner: "opencode,kilo,vibe"`.

## Requirements

- Add `paseoTransport: false` to `DEFAULT_SETTINGS`.
- Coerce `paseoTransport` to boolean in `normalizeSettings`.
- Allow `paseoTransport` in `PATCH /api/settings` validation.
- Add one checkbox near `globalRunner` in the settings UI.
- Load and save `paseoTransport` with the other settings.
- Document the setting in `README.md` near runner behaviour.
- Do not change runner selection, model rotation, or direct-mode behaviour.

## Implementation by file

- `src/config.js`: add default, normalize boolean.
- `server.js`: add `paseoTransport` to the settings validation allowlist.
- `public/index.html`: add the checkbox control.
- `public/app.js`: add the DOM ref, load value, and include it in save payload.
- `README.md`: document that Paseo transport is opt-in and initially supports host-executor-off runs.

## Tests

- Extend or add a focused settings test under `scripts/` for default `false`, accepted `true`, and rejected non-boolean input.
- Run existing settings tests to catch UI regression.

## Verification

Sandbox first. Copy the repo to `/tmp/opencode/looparr-sandbox` or use an approved sandbox. Do not edit the real tree until sandbox checks pass.

- Start Looparr in the sandbox.
- `PATCH /api/settings` with `"paseoTransport": true`, then reload settings and confirm it persists.
- Confirm direct CLI runs still work with the setting off.

## Done criteria

Setting persists, UI reflects it, validation rejects bad types, and direct mode has no behaviour change.
