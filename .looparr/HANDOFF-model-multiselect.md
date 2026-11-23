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

Current working-tree hashes (re-measured 2026-11-23; values below for drifted files differ from the 2026-11-22 handoff baselines because later tasks touched them):

- `README.md`: `50ed882001d8780abc50e75181050512b547bba1263f19f07abf1b3ea499c73d`
- `public/app.js`: `fffbbad9d5c8a8a2111d1d16e5648ae2a5dac618e8e4a8e5f641ff1269b162a6`
- `public/index.html`: `6b0840afd3e01dd477be28dc7c7771ba2a06587c60a32d256135a410064b9874`
- `scripts/host-executor.js`: `815e1a18d389a8c476594547dd4003392179a05b9c17a3511fe72a348581d0d2`
- `scripts/test-model-selector.js`: `71b51c5f3aa55f7a14f7036dafce458e41470d4f2b8e99a93506d76b13503860`
- `server.js`: `7dc56583647e02cfcbd81a2c1a1e509ba5abff42fc860ef6bad2c697fe2685fe`
- `src/config.js`: `8f7b7fe0f2717524fd3c7132abefd9a3a7480c5f77a7d3e2238e74e71f03cb73`
- `src/engine.js`: `640626846bb20fb33e845e3f1d4ce2fad8d671d6c0c519f1dc8df9fb4d8e8a08`
- `src/model-list.js`: `e980e697998805b72adb4541b76b9932353c3510679e0e298e68f736b8ef859b` (unchanged from the 2026-11-22 handoff)
- `src/runners/opencode.js`: `24f128e05a68a07132871ca8011e94a3455440e207e9ac5ca19c18f22ba67ffc`

Pre-existing untracked paths `.tmp-browser-fixture/`, `.tmp-browser-sticky/`, and `looparr-a-open.yml` were left untouched. `.looparr/next_prompt.txt` was not edited or deleted.

## Validation

Commands run in order:

### Re-verification (2026-11-23)

The closeout step re-verified the working tree end to end after the later 2026-11-23 tasks (runner rotation, provider-error fallback, drawer stability) drifted the source files:

1. `node --check` on `src/model-list.js`, `src/engine.js`, `server.js`, `src/runners/opencode.js`, `public/app.js` — passed.
2. `node scripts/test-model-selector.js` — passed: `model-selector smoke tests passed`.
3. `npm test` — passed all 29 suites.
4. `npm run restart:looparr -- --dry-run` — passed; printed the Docker command, did not call Docker.
5. Grep checks — `grep -c 'multiple size="4"' public/index.html` is 12 (the 4 global, 4 project-setup, and 4 drawer model selectors); the runner rotation task added 3 additional `multiple size="3"` selectors (lines 142, 287, 436), out of scope here. `sed -n '154p' src/runners/opencode.js` shows exactly one `args.push('--model', model)` per invocation. `grep -n "modelFallbackPending\|runnerSupportsModel" src/engine.js` finds both: `runnerSupportsModel` filters the candidate list per runner so a `kilo/*` id never reaches a local or bridge `opencode` run, and `modelFallbackPending`/`modelAttemptRunKey` keep the same task, phase, and run key across retries.
6. Production asset hashes — served `http://localhost:4188/` and `/app.js` hashes equal local `public/index.html` and `public/app.js`; container source hashes equal local source for all served files. No rebuild was required because production already matched the working tree.

Served asset hashes at closeout (differ from the 2026-11-22 handoff values because later tasks drifted the files):

- `/` and `public/index.html`: `6b0840afd3e01dd477be28dc7c7771ba2a06587c60a32d256135a410064b9874`
- `/app.js` and `public/app.js`: `fffbbad9d5c8a8a2111d1d16e5648ae2a5dac618e8e4a8e5f641ff1269b162a6`
- `/styles.css` and `public/styles.css`: `fb9ec0536057b348710366f0769a16ed122bd2f30e27ecdf5065ca5cd88c8964`

Original validation (2026-11-22):

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

Hashes taken after implementation and tests, before this handoff and the `plan.md` marker edit. Re-measured 2026-11-23 at closeout; drifted files now carry current working-tree hashes because later 2026-11-23 tasks (runner rotation, provider-error fallback, drawer stability) touched them. `src/model-list.js` is unchanged.

- `README.md`: `50ed882001d8780abc50e75181050512b547bba1263f19f07abf1b3ea499c73d`
- `public/app.js`: `fffbbad9d5c8a8a2111d1d16e5648ae2a5dac618e8e4a8e5f641ff1269b162a6`
- `public/index.html`: `6b0840afd3e01dd477be28dc7c7771ba2a06587c60a32d256135a410064b9874`
- `scripts/host-executor.js`: `815e1a18d389a8c476594547dd4003392179a05b9c17a3511fe72a348581d0d2`
- `scripts/test-model-selector.js`: `71b51c5f3aa55f7a14f7036dafce458e41470d4f2b8e99a93506d76b13503860`
- `server.js`: `7dc56583647e02cfcbd81a2c1a1e509ba5abff42fc860ef6bad2c697fe2685fe`
- `src/config.js`: `8f7b7fe0f2717524fd3c7132abefd9a3a7480c5f77a7d3e2238e74e71f03cb73`
- `src/engine.js`: `640626846bb20fb33e845e3f1d4ce2fad8d671d6c0c519f1dc8df9fb4d8e8a08`
- `src/model-list.js`: `e980e697998805b72adb4541b76b9932353c3510679e0e298e68f736b8ef859b` (unchanged from 2026-11-22 handoff)
- `src/runners/opencode.js`: `24f128e05a68a07132871ca8011e94a3455440e207e9ac5ca19c18f22ba67ffc`

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
