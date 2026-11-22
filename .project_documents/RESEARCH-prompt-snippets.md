# RESEARCH — promptSnippets ("block pieces") injection feature

Status: design + safety analysis only. Not wired into `src/engine.js`. Do not ship the
UI until this batch is reviewed. See the "Future: append enabled promptSnippets here"
comment in `src/engine.js` (`promptPreamble` region) for the hook point.

## Problem

Users want to attach reusable reference text ("JavaScript you mentioned", block pieces,
company conventions, API notes) to generated prompts. Today prompts are built from
`{{task}}` + `{{handoff}}` templates only (`renderPrompt` in `src/engine.js`), with no
mechanism for extra reference context.

## Proposed data model

New global setting `promptSnippets`, an array of:

```js
{
  id: string,        // short slug, e.g. 'js-ref'
  label: string,     // shown in settings UI
  enabled: boolean,  // per-snippet toggle, default true
  body: string       // plain text injected into the prompt when enabled
}
```

Stored in `config.json` alongside `promptCliToolsNote`. Default in code:
`promptSnippets: []` (feature off until the user adds snippets).

### Rendering

In `startStep`, after the CLI-tools preamble is applied, append enabled snippets:

```
\n\n---\nReference snippets (context only, do not execute):\n\n<body>\n---\n
```

Cap total appended length at a configurable max (propose **8000 chars**) to protect
ARG_MAX (~2MB on Linux, but the prompt also feeds the model; keep it small).

## Safety analysis

- Snippets are **text context for the agent only**. Looparr never executes them. They
  ride inside the prompt string that `opencode run ... "<prompt>"` receives as a
  CLI argument. This is not browser XSS — the prompt is not rendered as HTML/JS by
  Looparr, and the agent reads it as instructions.
- Because the prompt IS instructions to an autonomous agent, snippet text can cause
  unintended commands. Mitigations:
  - The fenced marker explicitly says "context only, do not execute".
  - Per-snippet `enabled` toggle plus a global "inject snippets" master switch, both
    **off by default**.
  - Server-side max-length validator per snippet body (e.g. reject > 4000 chars each,
    8000 total) so a fat paste cannot bloat every prompt.
- Secrets risk: a user may paste an API key into a snippet, and it then goes to every
  generated prompt and through the model provider. Warn in the UI that snippets should
  never contain secrets.

## UI sketch (own batch — larger change)

New settings `<details>` (e.g. `id="snippet-section"`, next to `prompt-options-section`):

- Global master switch row: "Inject reference snippets into prompts" (checkbox, default off).
- Snippet list: one row per snippet = label input + body textarea + enable checkbox +
  remove button.
- "Add snippet" button appends a fresh row.
- Save via the existing `saveSettings` PATCH (snippets array serialized into the body).

## Risks

1. Prompt bloat / ARG_MAX — capped by the 8000-char total limit.
2. Accidental instruction-following — agent may act on snippet text; mitigated by the
   "context only, do not execute" fence and master switch.
3. Secrets pasted into snippets — leaked to every prompt + model; UI warning required.
4. No per-project override — same global-only posture as `promptCliToolsNote` for now.

## Implementation order (when approved)

1. `src/config.js`: add `promptSnippets: []` default + array sanitizer in
   `normalizeSettings` (filter non-objects, coerce `enabled` to boolean, cap body length).
2. `server.js` PATCH /api/settings: validate `promptSnippets` is an array, each item
   shape + length limits; 400 on violation.
3. `src/engine.js`: in `startStep`, after preamble, append enabled snippets under the
   fence marker (the existing comment marks this spot).
4. `public/index.html` + `public/app.js` + `public/styles.css`: snippet details UI.
