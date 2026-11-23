# INVESTIGATION: model rotation and Freebuff runner feasibility

Date: 2026-11-22
Scope: discovery gate only. No application code changed. Nothing here is implemented; this file records what was verified, what failed, and what the next session may safely build.

## Verdict

1. **Model rotation is not implemented and is unblocked.** Looparr today has a rate-limit *fallback chain*, not a rotation. The change lives entirely in this repository.
2. **Freebuff cannot be a Looparr runner on CLI 0.2.36.** It is a TUI-only client: no headless/print mode, no prompt argument, no `--model`, no model listing, and piping stdin does not submit a prompt. It also requires a real TTY. The honest scope is *no runner*.
3. **Adding Freebuff model ids to the shared menus is not safe on its own.** Model ids are runner-agnostic in the engine: whatever id is selected is passed verbatim to the configured runner. A `freebuff/...` id added to `MODEL_OPTIONS` could be selected on an OpenCode project and would reach `opencode run --model freebuff/...` as an invalid id. Recommendation: do **not** add Freebuff ids until a run path exists; record the block in `plan.md` instead (see "Next step").

## Environment probed

| Item | Value |
| --- | --- |
| Wrapper | `/usr/local/bin/freebuff` -> `../lib/node_modules/freebuff/index.js` (`createLauncher`), package `freebuff` 0.2.36 |
| Wrapper version | `freebuff -v` -> `0.2.36` |
| Native binary | `~/.config/manicode/freebuff`, 136,816,784 bytes, `freebuff-metadata.json`: `{"version":"0.2.36","target":"linux-arm64"}` |
| Config dir | `~/.config/manicode` (binary contains the string `FREEBUFF_CONFIG_DIR`; not exercised here because a fresh config dir triggers a 136 MB binary download) |
| Launcher spawn | `spawn(CONFIG.binaryPath, process.argv.slice(2))` with `stdio: ['inherit','inherit','inherit']` on Linux — the binary owns the terminal |
| `freebuff doctor --json` | Valid JSON, 20 checks, **exit 1** because of findings; top keys `version,product,generatedAt,durationMs,appVersion,platform,arch,options,findings,checks` |
| Doctor findings | 1 `error` (`log.illegal-instruction` — "The engine crashed on an unsupported processor instruction"), 3 `warning` (`log.permission-denied`, `log.too-many-files`, `system.inotify-low` at 64324), 1 `info` (`node.several`), 9 `ok` (auth, clock, disk, git, install, network reachable, hosts, TLS, temp). Auth and network checks pass, so the unusable surface is the CLI contract, not this host's setup. |

## Evidence: exact CLI surface

`freebuff --help` (0.2.36), verbatim:

```
Usage: freebuff [options] [command]

Freebuff - Free AI coding assistant

Arguments:
  command                       Command to run: login, or doctor to check this
                                computer for common problems (choices: "login",
                                "doctor")

Options:
  -v, --version                 Print the CLI version
  --continue [conversation-id]  Continue from a previous conversation
                                (optionally specify a conversation id)
  --cwd <directory>             Set the working directory (default: current
                                directory)
  --trust-agents                Load this repository's .agents files and
                                mcp.json without asking (for CI)
  -h, --help                    Show this help message
```

`freebuff login --help` prints that same top-level help: the subcommands have no options of their own. `freebuff doctor` does have a scriptable surface (`--json`, `--markdown`, `--ask`, `--full-paths`, `--verbose`).

### Probe results (run in this repository, stdin closed unless stated)

| Command | Exit | Observed |
| --- | --- | --- |
| `freebuff -v` | 0 | `0.2.36` |
| `freebuff --model opencode/big-pickle` | 1 | `error: unknown option '--model'` |
| `freebuff --print hi` | 1 | `error: unknown option '--print'` |
| `freebuff --headless` | 1 | `error: unknown option '--headless'` |
| `freebuff --json` | 1 | `error: unknown option '--json'` |
| `freebuff "say hi"` | 1 | `error: command-argument value 'say hi' is invalid for argument 'command'. Allowed choices are login, doctor.` |
| `freebuff models` | 1 | same invalid-command error |
| `printf 'say hi\n' \| freebuff --cwd .` | 124 (killed at 20 s) | Full TUI rendered, prompt **not** submitted: landing screen still showed `Your first message starts the session.` and `Enter a coding task or / for commands`. On shutdown it printed `To continue this session later, run: freebuff --continue 2026-11-22T22-25-43.407Z`. |
| `freebuff --continue <id>` with stdin closed | 124 (killed at 12 s) | Renders the same TUI landing screen. Resume is a TUI action, not a batch run. |
| `freebuff doctor --json` | 1 | Valid JSON report (exit 1 = error findings) |

The piped-stdin run also created a chat directory (`~/.config/manicode/projects/freebuff/chats/2026-11-22T22-25-43.407Z/log.jsonl`) without ever receiving the piped text, which confirms stdin is consumed only by the TUI's raw-mode input, not as a prompt.

## What the CLI can and cannot do non-interactively

**Can**

- Print its version (`-v`) and help (`-h`).
- Run read-only diagnostics and emit JSON/Markdown: `freebuff doctor --json`.
- Store a login (`freebuff login`), with credentials in `~/.config/manicode/credentials.json`.
- Accept `--cwd` and `--trust-agents` as session modifiers for the interactive client.

**Cannot**

- Accept a prompt as an argument (only `login`/`doctor` are valid command values).
- Accept a prompt on stdin and submit it.
- Run without a TTY (`stdio: inherit`; the TUI renders alternate-screen escape sequences and waits).
- Select or pin a model (`--model` unknown; model choice is the in-TUI `/model` picker).
- List models (no `models` subcommand; the catalog is server-side).
- Stream NDJSON/JSON agent events, or return a step result in a machine-readable form.
- Be resumed non-interactively (`--continue` re-enters the TUI).

This matches upstream documentation and issue tracking: the CLI is described as "an interactive client: it does not accept an initial prompt as an argument, and it is not a scriptable JSON mode" (docs.freebuff.page/cli, retrieved via search snippet; the direct page fetch timed out here), and CodebuffAI/freebuff issue #947 documents the same probe failures. PR #1477 ("Accept an initial prompt argument") explicitly says it is "deliberately not a headless mode", and 0.2.36 still rejects prompt arguments, so it is not in this build.

## Model selection findings

- No CLI flag, subcommand, or documented env var pins the model.
- `~/.config/manicode/settings.json` contains only:
  ```json
  {
    "mode": "DEFAULT",
    "adsEnabled": true,
    "freebuffModelDefaultMigration": "glm-5.3-flash-2026-09-05",
    "hasSubmittedFirstPrompt": true
  }
  ```
  There is no model field to edit. `freebuffModelDefaultMigration` records a one-time migration, not the active model.
- Chat state lives in `~/.config/manicode/projects/<project>/chats/<chat-id>/` (`log.jsonl`, `chat-meta.json`, `chat-messages.json`, `run-state.json`). The chosen model is part of that session state, and the live catalog is resolved per account and connection.
- Availability is gated server-side. The TUI displayed `Some models aren't available on this connection` and `May use data for AI training`, so a static list cannot promise that a given model will start.
- The only enumerable catalog is documentation. The bundled README's picker list: MiMo v2.6 Flash Fast (default), GLM 5.3 Flash, DeepSeek, DeepSeek V4.1 Flash Fast, GPT-6 Luna, MiMo 2.6 Pro, Solar Mini 4, Solar Pro 4, Space Bunny Alpha, Gemini 3.8 Flash, Muse Spark 1.3, Gemini 4 Argon, GPT-6.1 Terra, GPT-6.1 Sol. Its FAQ also mentions limited-mode variants such as "DeepSeek V4.1 Flash 10/17" and "DeepSeek V4.1 Flash Fast 10/17". Display names would need a hand-written slug mapping, and it could drift.

## Repo-side facts confirmed

- `public/app.js` defines `MODEL_OPTIONS` with 13 ids (`omniroute/*`, `opencode/*`); `modelOptions()` renders them into every selector. `public/index.html` has 12 `<select multiple size="4">` model controls (4 global, 4 add-project, 4 drawer), all populated from that one list.
- `src/runners/index.js` registers only `require('./opencode')`; `getRunner()` lowercases the id.
- `scripts/host-executor.js` spawns `opencodeBin` unconditionally: line 198 (`serve`) and line 348 (per-run). The `/run` payload is `{prompt,cwd,files,url,model,runKey,projectId,phase,task}` and carries no runner identifier; `/health` reports `opencodeBin`.
- `src/runners/opencode.js` `buildCommand()` sends one model id: locally `opencode run --attach <url> --auto --model <id> --file ... <prompt>`; in bridge mode it serializes the payload for `scripts/bridge-client.js`. `validateModelId()` (from `src/model-list.js`) rejects commas, whitespace, and leading `-`.
- `src/config.js` defaults all four model fields to `opencode/big-pickle`; phase resolution is project phase -> project default -> global phase -> global default -> runner default.

## Rotation findings (why item 1 is real work)

- `src/engine.js` `ensureRuntime()` initializes `modelIndex: 0` and `modelAttemptRunKey: ''`.
- `startStep()` computes `models = effectiveModelList(project, phase)`, then resets `rt.modelIndex = 0` whenever `rt.modelAttemptRunKey !== runKey` (every new task and phase), and re-zeros when `rt.modelIndex >= models.length`. It then passes `models[rt.modelIndex]`.
- `scheduleModelFallback()` advances `rt.modelIndex` only when `runner.isRateLimit(rt.stepOutput)` matches, and returns `false` once the last model is exhausted.
- Consequence: later models are used only after an explicit rate-limit error, and every new task restarts at the first model. There is no round-robin through the selected list, and a successful fallback leaves no cursor for the next step.

## Decision and next step

**Do not** add a Freebuff runner now. A runner that cannot start a run would be worse than no runner: `getRunner('freebuff')` would exist, the UI would offer it, and every Start would fail.

**Do not** add Freebuff ids to `MODEL_OPTIONS` yet. The list is shared by all runners and ids are passed through verbatim, so a `freebuff/...` id selected on an OpenCode project reaches `opencode run --model` as an invalid id. If ids are ever added before a runner exists, they need an explicit "runner unavailable" treatment rather than silently sitting in the list.

Next step is the rotation item from `.project_documents/PROMPT-model-rotation-freebuff.md` (unblocked, self-contained), plus a `plan.md` blocked item for Freebuff worded like the existing model-picker block: record that CLI 0.2.36 has no headless mode, no prompt argument, and no model flag; that the model picker is TUI-only; and that the smallest enabling change is an upstream `--model` + non-interactive prompt/print mode (or a free-tier SDK auth path), after which Looparr would need a `runner` field on the host-executor `/run` payload, a `LOOPARR_EXECUTOR_FREEBUFF_BIN`, and a PTY or print-mode spawn. Note that ads render in the TUI, which is why upstream has not shipped a print mode (per PR #1477); a future runner must not assume one is coming.

## Reproduction

```bash
freebuff -v
freebuff --help
freebuff --model x </dev/null; echo "exit=$?"
freebuff --print hi </dev/null; echo "exit=$?"
freebuff --headless </dev/null; echo "exit=$?"
freebuff --json </dev/null; echo "exit=$?"
freebuff "say hi" </dev/null; echo "exit=$?"
freebuff models </dev/null; echo "exit=$?"
printf 'say hi\n' | timeout 20 freebuff --cwd .
timeout 12 freebuff --continue 2026-11-22T22-25-43.407Z </dev/null; echo "exit=$?"
freebuff doctor --json | head -40
cat ~/.config/manicode/settings.json
grep -n "spawn(opencodeBin" scripts/host-executor.js
grep -n "MODEL_OPTIONS" public/app.js
grep -c 'multiple size="4"' public/index.html
```

## Sources

- Local CLI 0.2.36 probes and files above (primary evidence).
- Freebuff CLI docs, <https://docs.freebuff.page/cli/> — flags list, "interactive client... not... a scriptable JSON mode", config dir `~/.config/manicode`, history layout (read via search snippet; direct fetch timed out).
- CodebuffAI/freebuff issue #947 — headless/print mode request with the same negative probe results.
- CodebuffAI/freebuff PR #1477 — initial prompt argument, explicitly not a headless mode.
