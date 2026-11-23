# INVESTIGATION: free terminal CLIs with headless mode as Looparr runners

Date: 2026-11-22
Scope: discovery only. No application source changed. This records what was verified, what was ruled out and why, and the smallest next steps.

## Verdict

1. **Best immediate win needs no new runner.** The Kilo AI Gateway serves free models over a keyless, OpenAI-compatible endpoint (`api.kilo.ai/api/gateway`). Probed live from this host: models list `200`, chat completion `200`, routed to `reflection/beam-free`, no key. OpenCode can consume it as a custom provider, so free tokens land in Looparr through the runner that already exists.
2. **Best new-runner candidate is Kilo Code CLI (`kilo`).** It is an OpenCode fork (its CLI package is `packages/opencode`), with `kilo run "<prompt>" --auto --format json --model provider/model`, a headless `kilo serve`, and the same free-model catalogue. The existing `src/runners/opencode.js` shape transfers almost verbatim.
3. **Qoder CLI and Mistral Vibe are worth a probe, not a build.** Both have real headless modes and free allowances, but their headless behaviour inside a container and their actual free volume are unverified.
4. **Antigravity CLI has the most generous free tier and is the one option Looparr must not build.** Google's terms forbid wrapping `agy` in third-party coding agents on consumer plans, and headless needs a pre-existing interactive login.
5. **Rotation answer:** the per-dropdown toggle stays, but model ids must become runner-scoped before a second runner ships. Ids are passed verbatim, so a `kilo-auto/free` id on an OpenCode project is an invalid model, exactly the Freebuff hazard already recorded.

## What Looparr demands of a runner

Derived from the current code, not from vendor marketing:

| Requirement | Why |
| --- | --- |
| One non-interactive invocation per step | `scripts/host-executor.js` spawns per run and waits for exit |
| No TTY | Prod is a compose container; the bridge runs on the host with piped stdio |
| Non-interactive tool approval | A prompt must not stop for `y/n` |
| Model pinning per invocation | Rotation and fallback select a model per step |
| Machine-readable or greppable failure text | `isRateLimit()` drives fallback |
| Auth that survives without a browser | No interactive login in prod |
| Predictable free quota | Rotation/fallback is pointless if the quota is 50 requests/month |

A candidate that misses TTY-free auth or non-interactive approval is unusable regardless of how good its free tier is.

## Matrix

| CLI | Headless invocation | Free model access | Auth suitable for prod | Verdict |
| --- | --- | --- | --- | --- |
| OpenCode (`opencode`) | `opencode run --auto --model ... --file ...` | Zen/Go free models + any gateway | existing | **already the runner** |
| Kilo Code (`kilo`) | `kilo run "..." --auto --format json` | Kilo Gateway free models, keyless, 200 req/h per IP | keyless lane | **build** |
| Kilo Gateway + OpenCode | n/a (provider config) | same as above | keyless lane | **do this first** |
| Qoder CLI (`qoder` / `qodercli`) | `qoder -p "..."` | Free plan basic models, daily/monthly caps; 300-credit 2-week Pro trial; 100 credits/day claimed by hand | account login, container flow unverified | **probe** |
| Mistral Vibe (`vibe`) | `vibe -p "..." --auto-approve --max-turns N` | Free plan includes Vibe CLI with a monthly budget; free API access is gone | key env var or account | **probe** |
| Cursor CLI (`agent`) | `agent -p "..." --force --model ...` | Free plan: "Limited" agent requests, no Claude/GPT/Gemini | `CURSOR_API_KEY` | **low priority** |
| GitHub Copilot CLI (`copilot`) | `copilot -p "..." --allow-tool ...` | Free plan includes CLI, unquantified AI-credit allowance, auto model selection only | `COPILOT_GITHUB_TOKEN` | **low priority** |
| Antigravity CLI (`agy`) | `agy -p "..."` | free tier, weekly quota, personal Google account | cached login only | **do not build** |
| Qwen Code (`qwen`) | `qwen -p "..."` | free OAuth tier ended 2026-04-15; local/gateway models only | n/a | ruled out |
| Gemini CLI (`gemini`) | `gemini -p "..."` | free individual access moved to Antigravity 2026-06-18; free API key 250/day Flash only | n/a | ruled out |
| iFlow CLI (`iflow`) | `iflow -p "..."` | first-party service shut down 2026-04-17 | n/a | ruled out (dead) |
| Amp (`amp`) | `amp -x "..."` | Hobby is free but BYOK; ad-supported "Amp Free" is paused | n/a | ruled out (no free tokens) |
| Freebuff | none | chat product only | n/a | ruled out (TUI-only, already documented) |
| Goose / Crush / Aider / Pi / Codex / Droid / Muse / Grok Build / Kiro / Devin | varies | no bundled free tokens; BYOK or subscription | varies | out of scope |

## Live probe from this host (2026-11-22)

```
$ opencode --version
opencode v2.3.2

$ curl -sS -o models.json -w '%{http_code}' https://api.kilo.ai/api/gateway/models
200
{"data":[{"id":"kilo-auto/efficient","name":"Auto Efficient", ...

$ curl -sS -H 'Content-Type: application/json' \
    -d '{"model":"kilo-auto/free","messages":[{"role":"user","content":"reply with the single word ok"}],"max_tokens":16}' \
    https://api.kilo.ai/api/gateway/chat/completions
http=200
{"id":"gen_01M82Q2M1D0A06JC5TX0H4R5Y5","object":"chat.completion","created":1795387642,"model":"reflection/beam-free",...
```

Two things worth noting from the response. `kilo-auto/free` is a router, and it picked `reflection/beam-free`; the visible content was empty because a 16-token cap was consumed by reasoning text. The important result is the `200` with no credential, which is what a keyless provider config needs.

`opencode run --help` (v2.3.2) confirms the flags the runner already relies on, plus `--format json`: `--model provider/model#variant`, `--auto`, `--file`, `--session`, `--worktree`, `--archived`.

## Candidate detail

### Kilo Code CLI

- Built on OpenCode: the CLI package path in the repo is `packages/opencode`, and the `kilo run` help mirrors `opencode run`.
- `kilo run [message..]` is the non-interactive form; `kilo run --auto "..."` auto-approves anything not explicitly denied; `--format json` emits raw JSON events; `-m/--model provider/model` pins the model; `-f/--file` attaches; `--dir` sets cwd; `--attach <url>` talks to a running server, and `kilo serve` starts a headless server.
- Trap confirmed by two independent sources: **`-p` is `--password`** (basic auth for an attached server), not print. The prompt must be positional. This is the same trap as OpenCode and would silently send the whole prompt into a password field.
- Free inference: the gateway exposes `:free`-tagged models plus the `kilo-auto/free` router. Anonymous access is rate-limited to 200 requests/hour per IP; free entries may route to providers that train on prompts, and the free list rotates.
- Fit: highest, because the runner contract is nearly identical to the existing one and rate-limit text can be handled by the same parser.

### Kilo Gateway through OpenCode

- Provider block only: `npm: @ai-sdk/openai-compatible`, `baseURL: api.kilo.ai/api/gateway`, model ids such as `kilo-auto/free`, no `apiKey` (the docs' custom-provider example omits it for endpoints that need no credential).
- Costs nothing in engine code: the existing runner passes `provider/model` through, and the rotation work already cycles ids per dropdown.
- Caveats: prod's bridge host must reach `api.kilo.ai` (verified here); the host's OpenCode needs the provider config (there is none in the repo root today); free routing can change under us, so the model list must be editable rather than hard-coded.

### Qoder CLI

- `qoder -p "..."` (or `qodercli -p`), `--output-format text|json|stream-json`, `--model`, `--permission-mode auto`, `--worktree`, `--max-output-tokens`.
- In headless mode anything that would need a confirmation pop-up is **denied**, so a runner must pass an explicit permission mode rather than relying on defaults.
- Free plan keeps access to basic models under daily and monthly limits; 300 credits for a 14-day Pro trial once per account; 100 credits/day claimable by hand in the desktop app (not automatable from a container).
- Unverified: whether headless login can be completed non-interactively in the bridge container.

### Mistral Vibe

- `vibe -p "..."`, `--auto-approve` / `--yolo`, `--max-turns N`, `--max-price DOLLARS`, `--output json`, `--trust`, `--prompt-file`.
- Free plan includes Vibe CLI with a monthly usage budget and "limited coding sessions"; free mode does **not** include general API access, while Vibe Code keys are documented as working "in Free mode". Those two statements are from different pages and need a real probe before anyone relies on them.
- `--max-price 0` is a useful guard for a free-only runner: a model priced at 0 is free, and the run stops before the next call once money is spent.

### Cursor CLI

- `agent -p "..."`, `--force`, `--output-format text|json|stream-json`, `--model`, `--trust`, `--workspace`, `CURSOR_API_KEY`.
- Free plan is real but prints no number ("Limited" agent requests) and excludes Claude/GPT/Gemini; the useful models are Cursor's own and Grok. Unquantified quota makes it a poor fit for unattended loops.

### GitHub Copilot CLI

- `copilot -p "..."` (also accepts piped stdin), `--allow-tool`, `-s/--silent`, `--no-ask-user`, `--model`, `--output-format json` (JSONL), `COPILOT_GITHUB_TOKEN` for non-interactive auth, concurrency 2 on Free.
- Technically the cleanest scriptable surface of the whole list. The problem is volume: Free includes the CLI but only an unquantified AI-credit allowance (50 chat requests/month in the pre-June-2026 scheme) and auto model selection only, so per-dropdown rotation has nothing to rotate on Free.

### Antigravity CLI — the one hard no

- `agy -p` / `--print` / `--prompt` exists, free tier for personal Google accounts has a weekly quota, and `-p` is genuinely scriptable.
- Two blockers. First, auth: "Headless mode uses your cached credentials. Authenticate once with an interactive `agy` session first"; with no terminal and no cached session it exits with an authentication-required error. Second, and decisive, the FAQ: wrapping `agy` inside third-party coding agents or applications, or automating account rotation, "is not supported under consumer plans" — a breach of the terms that "may be grounds for suspension or termination". Looparr is precisely a third-party orchestrator that rotates models.
- The ToS-compatible path is `GEMINI_API_KEY` with the `gemini` provider set in `~/.gemini/antigravity-cli/settings.json`, which bills the Gemini API instead of the free Antigravity quota. That is a paid/free-API-key route, not a free-tier route, so it does not satisfy this plan item.
- Google does publish `antigravity-acp`, an ACP adapter that supports personal accounts. If Looparr ever wants Antigravity, the sanctioned integration is ACP rather than spawning `agy` from a runner. That is a separate, larger design question.

## Ruled out, briefly

- **iFlow CLI**: first-party service closed 2026-04-17; the client survives but only against custom endpoints. Not free.
- **Qwen Code**: headless is excellent (`-p`, `--output-format json|stream-json`, `--input-format`), but the OAuth free tier ended 2026-04-15. Free only with local Ollama or a free gateway, which the gateway option already covers better.
- **Gemini CLI**: free individual access moved to Antigravity on 2026-06-18. Remaining free path is an unpaid Gemini API key at ~250 requests/day, Flash only, explicitly not promised. Superseded.
- **Amp**: "Amp Free" was the ad-supported free-token mode and is paused ("we don't intend to bring it back"). Hobby is free only if you bring your own keys.
- **Generic harnesses** (Goose, Crush, Aider, Pi, Codex CLI, Droid, Muse, Grok Build, Kiro, Devin): fine CLIs, but none bundles free inference, so they add a runner without adding free tokens.

## Rotation and multiple runners

The rotation work is already runner-agnostic in the engine: it advances a per-field cursor and passes `models[index]` to whatever runner is configured. What breaks with a second runner is the **id namespace**, because:

- `MODEL_OPTIONS` in `public/app.js` is one list shared by every dropdown.
- `effectiveModelList()` returns ids that `buildCommand()` passes verbatim.
- `scripts/host-executor.js` has no runner field on `/run`; it always spawns OpenCode.

So the sequence must be: (1) a per-project runner selection, (2) a `runner` field on the host-executor `/run` payload and a matching binary env var, (3) per-runner model catalogues in the pickers, and only then (4) rotation across a second provider's models. Until (3) exists, do not add Kilo/Qoder ids to the shared list — a Qoder id selected on an OpenCode project reaches `opencode run --model` and fails, the same hazard already recorded for Freebuff.

Once ids are runner-scoped, the existing toggle semantics are exactly right for other CLIs: rotate per successful step, advance within a step on a rate limit, reset when the effective list changes. No new rotation flag is needed.

## Recommended order

1. **Kilo Gateway free lane through OpenCode** — no engine change, free tokens today, one provider config on the bridge host plus model entries. Smallest possible win.
2. **Runner selection + Kilo CLI runner** — `runner` on the project and on `/run`, `kilo run --auto --format json --model ...`, reuse the rate-limit parser. This is the first real second runner.
3. **Probe Qoder** (`qoder -p` under no TTY, free account) and **Mistral Vibe** (`vibe -p --auto-approve --max-price 0`) before committing either.
4. **Skip Antigravity** unless Google documents a third-party path (ACP is the only sanctioned one) and **skip Copilot** while Free cannot choose a model.

## Sources

- Kilo CLI reference and autonomous mode: <https://kilo.ai/docs/code-with-ai/platforms/cli-reference>, <https://kilo.ai/docs/code-with-ai/platforms/cli>
- Kilo gateway free models / anonymous limits: <https://kilo.ai/docs/gateway/models-and-providers>, <https://kilo.ai/docs/gateway/authentication>, <https://kilo.ai/docs/getting-started/using-kilo-for-free>
- OpenCode custom providers: <https://opencode.ai/docs/providers>
- Qoder scripts/headless: <https://docs.qoder.com/cli/headless>, <https://docs.qoder.com/cli/cli-reference>
- Mistral Vibe programmatic mode: <https://docs.mistral.ai/vibe/code/cli/work-with-cli>, <https://raw.githubusercontent.com/mistralai/mistral-vibe/v3.1.2/docs/programmatic-mode.md>, <https://docs.mistral.ai/admin/billing-usage/usage-limits>
- Cursor CLI headless: <https://cursor.com/docs/cli/headless>, <https://cursor.com/pricing>
- Copilot CLI programmatic reference: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference>, <https://docs.github.com/en/copilot/get-started/plans>
- Antigravity headless/auth/FAQ: <https://antigravity.google/docs/cli/headless>, <https://antigravity.google/docs/cli/install>, <https://antigravity.google/docs/faq>
- Antigravity third-party terms discussion: Google AI Developers Forum thread 185992; <https://convika.com/blog/antigravity-cli-agy-p-terms-suspension/>
- Qwen free tier end: <https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth>
- Gemini CLI transition: <https://github.com/google-gemini/gemini-cli>
- iFlow shutdown: <https://docs.iflow.cn/cli/changelog>
- Amp Free pause: <https://ampcode.com/news/amp-free>

## Probe results — Qoder and Mistral Vibe (2026-11-22)

Both CLIs were installed and probed on this host, since neither free tier can be judged from documentation alone. Neither reached a completion.

### Qoder CLI

- Installed with `npm install --prefix <dir> @qoder-ai/qodercli` (the global install fails with `EACCES` on `/usr/local/lib/node_modules`, which is a host permission issue, not a package issue). Reported version: `1.1.95`.
- Headless surface matches the docs: `-p/--print`, `--permission-mode auto`, `-o/--output-format json`, `--max-turns`, `--no-session-persistence`, `--cwd`.
- Every run in an empty directory under no TTY exited 1 with:

  ```
  Not logged in · Please run /login
  ```

- `qodercli login --help` exposes only the interactive account flow; there is no `--token`, `--api-key`, or documented environment variable for a personal access token. `QODER_API_KEY` and `QODER_PERSONAL_ACCESS_TOKEN` are not read when unset.
- Verdict: blocked on account authentication. The invocation shape is suitable for a runner (`qodercli -p "<prompt>" --permission-mode auto -o stream-json --cwd <project>`), but a runner cannot be verified without a signed-in account, and the free plan's token budget is undocumented until then.

### Mistral Vibe

- Installed from PyPI as `mistral-vibe 3.1.4` into a project-local venv, because the system Python is PEP 668 managed and `pip install --user` is refused. Documented alternatives: `uv tool install mistral-vibe` or `curl -LsSf mistral.ai/vibe/install.sh | bash`.
- `--help` confirms the programmatic surface: `-p/--prompt`, `--auto-approve`/`--yolo`, `--max-price`, `--max-turns`, `--output text|json|streaming`, `--workdir`, `--setup`.
- Headless run exited 1 with:

  ```
  Reading API keys from the system keyring (set them as environment variables to skip this)
  Error: Missing MISTRAL_API_KEY environment variable for mistral provider
  ```

- The free plan authenticates through `vibe --setup` (interactive, keyring-backed). No anonymous or keyless path exists, and no `MISTRAL_API_KEY` is present on this host.
- Verdict: blocked on credentials. The `--max-price 0` idea is sound for capping a run to free-priced models, but there is no free provider without a key, so it cannot be validated here.

### Effect on the plan

Both probe items are complete with a "no runner yet" decision. Neither CLI supplies free inference without an authenticated account, so neither advances the free-runner goal today. The next real second runner remains the Kilo CLI, which authenticates through the same gateway already proven keyless.

## Post-auth re-probe — Qoder and Mistral Vibe (2026-11-22, after login)

Both CLIs were signed in on the host, then probed again under no TTY.

### Qoder CLI 1.1.95 — ruled out (plan entitlement, not auth)

- `qodercli whoami` exits 0; `~/.qoder/.auth/user` exists. Login itself now works.
- `qodercli --list-models` → `Warning: no models available for your account.`
- `qodercli -p "Reply with the single word ok." --permission-mode auto -o json` → exit 1, `is_error: true`, `errors: ["inference.remoteChat.stream failed (403): {\"pricingUrl\":\"https://qoder.com/pricing?client=qoder\"}"]`, `error_code: 112`, zero tokens.
- `--model qwen3-coder-plus` falls back to `auto` and fails the same way, so it is not a model-name problem.
- Verdict: the account carries no model entitlement. A runner would only work after a paid or trial plan is attached, so nothing was built.

### Mistral Vibe 3.1.4 — viable, no runner built yet

- `vibe -p "Reply with the single word ok." --max-turns 2 --max-price 0 --output json` → exit 0, assistant text `ok`, stderr empty.
- File editing works headless: `vibe -p "Append the single line 'vibe was here' to plan.md. ..." --auto-approve --max-price 0 --output json` appended the line and replied `done`, no other files created.
- `--output streaming` emits one JSON object per line (5 events for a two-step run: `message:user`, `reasoning`, two `effect`, `message:assistant`) — directly consumable as NDJSON for logs and SSE.
- `--output-dir` writes `export.json`: `outcome: finished`, `stop_reason: null`, `cost_usd: 0`, `usage: {input_tokens: 18963, output_tokens: 75, cached_input_tokens: 9216, total_tokens: 19038}`.
- Free lane is real: `--max-price 0` did not stop the run, and the run cost 0.
- Runner-relevant gaps: no attachment flag (`--prompt-file` replaces the prompt, it does not attach); `--model` takes a Vibe alias only, not a `provider/model` id; `--output-dir` is the only structured cost/stop-reason source.

Verdict: build the Vibe runner once per-runner model scoping exists, so a Vibe project cannot receive OpenCode or Kilo model ids.
