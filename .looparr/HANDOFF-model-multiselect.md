# Handoff: model multiselect

Date: 2026-11-22  
Branch: `master`  
Scope: completed Looparr multi-model selection task.

## Decision

Implemented ordered comma-separated model lists for all four global model fields and all four per-project model fields. Persisted config still uses one string per field. No arrays and no migration.

`opencode run --model` still receives exactly one model id. Repeated `--model` is not used. A comma string never reaches `opencode`.

Fallback lives in the engine. On a rate-limited attempt, the engine retries the same task, phase, and run key with the next configured model. Plan, handoff, and phase advance only after final success. Exhausted lists keep the existing `rateLimited` behavior.

Previously blocked on 2026-11-21: `opencode run --model` takes one `provider/model#variant` string; repeated `--model` is unsupported, and passing a comma string would be one invalid id. That block is resolved by engine fallback plus UI list composition.

## Temporary lift

`src/engine.js` and `public/app.js` were edited under the user-granted temporary lift recorded in `plan.md:93`. The lift applies to this task only. Permanent lift was not granted.

## Changed files

- `README.md`
- `public/app.js`
- `public/index.html`
- `scripts/host-executor.js`
- `scripts/test-model-selector.js`
- `server.js`
- `src/config.js`
- `src/engine.js`
- `src/model-list.js` (new)
- `src/runners/opencode.js`
- `plan.md`
- `.looparr/HANDOFF-model-multiselect.md` (this file)

Pre-existing untracked paths `.tmp-browser-fixture/`, `.tmp-browser-sticky/`, and `looparr-a-open.yml` were left untouched. `.looparr/next_prompt.txt` was not edited or deleted.

## Validation

Commands run in order:

1. `node --check` on every changed JS file — passed.
2. `node scripts/test-model-selector.js` — passed: `model-selector smoke tests passed`.
3. `npm test` — passed all suites: plan-helpers, model-selector, auto-resume, plan-ui-controls, up-next, prompt-cli-tools-note, sticky-add-task-row, rate-limit detection, rate-limit retry UI, prompt-handoff-guard, start-reseed, icon discovery/serving.
4. `npm run restart:looparr -- --dry-run` — passed; prepared intent, skipped existing IDs, printed Docker command, did not call Docker.
5. `npm run restart:looparr` — passed; rebuilt and recreated `looparr`, then checked API and container health.
6. `docker compose build looparr && docker compose up -d looparr` — passed; `looparr` recreated and started.

Focused tests cover global and per-project comma round-trips, dedupe and canonical serialization, clear semantics, invalid values returning HTTP 400, `omniroute/auto` and `omniroute/auto/coding`, one `--model` per local command, one bridge payload model per attempt, runner/executor comma rejection, served multi-select markup, served save paths, rate-limited fallback order, same task/phase/run key across retries, one plan and handoff advance, and exhausted rate-limit behavior.

## Production verification

- Container: `status=running health=healthy configured=looparr:latest`.
- Image digest: `sha256:c084ef7c0c9e1af1785e49c5c83fc35a7621f516adb2b838607f821778aa6136`.
- Source hashes matched local files with normalized sort order, including new `src/model-list.js`: `source hashes match`.
- Served asset hashes matched local files:
  - `/` and `public/index.html`: `fddc2ec74b396c8f6466dcf9fa6eaa31d4e45f594d09df23faecc65b3e0c04f8`
  - `/app.js` and `public/app.js`: `d39ef4c6df12dd6f2f1a30e2c043b2b2af0e99369e2f17804b261c25004558e3`
  - `/styles.css` and `public/styles.css`: `587adf3d16351c0cf594f2eeb1ba0c7d95d5c25581d5e02c4d3140e5df03f23f`
- `GET /api/state` loaded old single-id config values and new `effectiveModelLists`.
- Served page contained `multiple size="4"` exactly 12 times, covering all global, project setup, and drawer model selectors.
- Prod settings comma round-trip passed. Original values restored: `model=omniroute/auto/coding`, `seedModel=opencode/big-pickle`, `analyzeModel=opencode/big-pickle`, `implementModel=opencode/big-pickle`.
- Fake-executor fallback test confirmed rate-limited first model falls through to second model without duplicate steps.

## Source hashes

Hashes taken after implementation and tests, before this handoff and the `plan.md` marker edit:

- `README.md`: `086998813db4db115523303d5ffdbd8c710262f4ee950ea312fd2c3a040c4176`
- `public/app.js`: `d39ef4c6df12dd6f2f1a30e2c043b2b2af0e99369e2f17804b261c25004558e3`
- `public/index.html`: `fddc2ec74b396c8f6466dcf9fa6eaa31d4e45f594d09df23faecc65b3e0c04f8`
- `scripts/host-executor.js`: `36a5ee0f879c729d2c498144dbaad49d572d138a4149ab42ef29e152edc57c46`
- `scripts/test-model-selector.js`: `0e58288d296433cf2e93d85359ac6ab4e7ae5203f435ec0284dd1958fb818e3a`
- `server.js`: `7a0d53687410e801662c0dc2a2ba225b48e7d408e8e2b618d3ac68eb86f449e9`
- `src/config.js`: `a20b62f7ed93fc23e5c301cfe1309e674b5b0b35dac95cd9938c6640ab936c72`
- `src/engine.js`: `2ac3dc7d69e01d07f9a8f12a6d6092eb60e865271ae915b60434327831f93ad1`
- `src/model-list.js`: `e980e697998805b72adb4541b76b9932353c3510679e0e298e68f736b8ef859b`
- `src/runners/opencode.js`: `dce4c400b8dfb312cda00d9ef4fb264610322ab2dde1e5877d5e94e94651afbd`

## Residual limits

- Model fallback happens only on detected rate limits. Other failures keep existing error behavior.
- Fallback is sequential. Only one model id is sent per runner attempt.
- `MODEL_OPTIONS` remains manually maintained. Dynamic model discovery stays blocked because the container has no `opencode` binary.
- Model ids cannot contain commas, whitespace, control characters, or leading `-`. Normalized field length is limited to 200 characters.
- No config migration exists. Existing single-id configurations remain valid.
- UI uses native multiple selects with visible size and help text. iOS Safari behavior was not manually exercised in this session.

## Rollback

Revert the implementation commit, then rebuild and restart:

```sh
git revert <commit>
npm run restart:looparr
```

If only the runtime image must be rolled back, check out the previous source tree and run:

```sh
docker compose build looparr && docker compose up -d looparr
```

No config rollback is required. Production settings were restored to their original values. No schema migration or persisted engine state needs undoing.
