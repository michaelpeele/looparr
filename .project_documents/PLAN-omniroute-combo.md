# OmniRoute `coding-safe` combo

Status: implemented 2026-11-23. Plan item: `(plan) OmniRoute coding-safe combo`.
Picker entry: `omniroute/coding-safe` (OpenCode runner only).

## Why

`omniroute/auto/coding` is a score-driven router. Its top candidate is
`cerebras/gpt-oss-120b`, which rejects OpenCode's request shape with
`[400] unsupported property reasoning_details`. That 400 is not a retryable
provider failure for OmniRoute, so the router returns it instead of failing over.
The engine-level fallback in `src/engine.js` now moves past it, but the first
attempt is still wasted on every step.

A named combo makes routing deterministic: one picker entry, ordered concrete
targets, OmniRoute tries them in priority order.

## What exists

| item | value |
| --- | --- |
| combo id | `df0155a6-b0c2-4439-be32-f507074617d4` |
| name / model id | `coding-safe` → `omniroute/coding-safe` |
| strategy | `priority` |
| targets | `agnes/agnes-3.0-flash`, `agnes/agnes-2.5-flash` |

Targets were chosen by probing `/v1/chat/completions` with a tools payload using
the same inference key OpenCode uses. Rejected candidates:

- `opencode-zen/*` (all 16 live ids): `400 Model '…' is not available in the
  active live catalog for provider 'opencode-zen'`, even though `/v1/models`
  lists them.
- `ds/deepseek-v4-pro`, `deepseek/deepseek-v4-pro`: `404 model_not_found`.
- `tokenharbor/*`, `mmcode/*`, `openrouter/*`: cooling / missing auth / quota.
- `auto/pro-coding` as a combo target: combo pre-dispatch filters skip virtual
  `auto/*` targets (`ALL_TARGETS_SKIPPED`).

## Key policy

The inference key is `opencode cli` (`sk-d6d…`, id `27cb5793…`):
`modelAccessMode=all`, `allowedModels=[]`, `allowedCombos=["combo/*"]`,
`allowAutoCombos=true`, `catalogScope=all`.

`PATCH /api/keys/{id}` with `blockedModels: ["cerebras/gpt-oss-120b"]` was
applied so direct requests cannot use it. Note: the `auto/*` selector still logs
`Auto selection: cerebras/gpt-oss-120b` afterwards, so the block does not
influence auto selection in this build — use direct ids or the combo.

## OpenCode provider

`~/.config/opencode/opencode.json` → `providers.omniroute.models` gained:

```json
"coding-safe": { "name": "Coding Safe (OmniRoute combo)" }
```

The file was backed up beside itself (`opencode.json.bak-<timestamp>`). Without
this entry OpenCode refuses `-m omniroute/coding-safe` even though the gateway
lists the combo.

## Picker wiring

- `src/runners/opencode.js` — added `omniroute/coding-safe` to `MODELS` (this is
  what the server validates against).
- `public/app.js` — added it to `MODEL_OPTIONS_BY_RUNNER.opencode` so settings,
  add-project, and drawer dropdowns all show it.
- `scripts/test-model-selector.js` — served-app.js assertion.
- `README.md` — picker list note.

## Verification

- `POST /api/combos` → 201; `GET /api/combos` → 1.
- `POST /v1/chat/completions` with `model: "coding-safe"` and a tools payload →
  200, and `combo/coding-safe` also resolves.
- `opencode run -m omniroute/coding-safe "Reply with the single word OK."` → `OK`,
  exit 0.
- `npm test` green (model selector assertion included).
- looparr rebuilt/redeployed (`sha256:ac464b7f7227…`), healthy, served `app.js`
  contains the combo id, `opencode models` lists `omniroute/coding-safe`.

## Limits

- The combo currently has only two Agnes free targets; add more only after
  probing them with a tools payload, because listing in `/v1/models` does not
  guarantee routability.
- `omniroute/auto*` remains in the picker list and still prefers Cerebras; leave
  it out of production model lists or fix auto candidate selection in OmniRoute.
- The OpenCode provider change is outside this repository and must be repeated on
  any host that runs the runner.
