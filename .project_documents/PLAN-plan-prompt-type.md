- [ ] Add a Plan prompt type for new projects. This comes before the current flow of analyze implement pairs and is not per task. Seed still reads `plan.md` and writes the analysis prompt. Plan returns questions through `.looparr/next_prompt.txt`, waits for the user's answer, then writes a fully mapped-out `plan.md`. Only after the user confirms does the flow switch to current flow of Analyze, then Implement for the plan task list. Questions and design for this flow come first; record the answers in `.project_documents/` before editing code.

## Documentation markdown to pointer type

- plan.md keeps a short checkbox task line.
- Full task details live in .project_documents/PLAN-*.md.
- Markdown links whose target basename matches PLAN-*.md or plan-*.md become plan-file buttons.
- Hover and keyboard focus tooltip must be exactly "click to open".
- Click loads raw markdown through GET /api/projects/:id/plan-file?path=...
- Save writes raw markdown through PUT /api/projects/:id/plan-file?path=...
- Non-plan links remain unchanged.
- Pointer files must start with PLAN- or plan- and end with .md.
