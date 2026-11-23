# Plan task split directive

Apply this directive to one task section in root `plan.md`.

## Scope

- Read root `plan.md`.
- Work sandbox-first. Copy the repository to `/tmp/opencode/looparr-sandbox` or use an existing approved sandbox. Do not edit the real `plan.md` until sandbox checks pass.
- Promote only verified files to the real tree after sandbox checks pass.
- Preserve untracked user files. Do not delete or overwrite them.

## Select one task section

Pick one full `##` task section whose body is still inline:

- The section heading starts with `## `.
- The body contains at least one checklist item (`- [ ]` or `- [x]`).
- The section has no nested heading (`###` or deeper).
- The section is not already a title-pointer line with `— see [PLAN-`.
- Pick one section only.

Let `<Task title>` be the heading text after `## `, trimmed of leading and trailing whitespace.

Let `<kebab-task-title>` be the lowercased `<Task title>` with each run of characters outside `a-z0-9` replaced by `-`, then leading and trailing `-` removed.

## Move the body

The section body is every line after the heading line up to the next heading line, excluding the blank line directly after the heading and excluding blank separator lines before the next heading. Preserve the body bytes exactly: same text, order, indentation, line endings, and final newline state.

Create `.project_documents/PLAN-<kebab-task-title>.md` with exactly this opening, followed by the original body:

```markdown
# <Task title>
Status: draft — implementation plan.

```

Do not summarize, rewrite, reorder, or reformat the body. Do not add commentary before or after it.

## Replace the inline section in plan.md

Replace the selected heading and its inline body with exactly this one line:

```markdown
### [ ] (verify) <short task title> — see [PLAN-<kebab-task-title>.md](.project_documents/PLAN-<kebab-task-title>.md)
```

Use `<Task title>` as `<short task title>` unless a shorter form is already established in the plan. Keep the blank separator line before the next heading. Do not change any other byte of `plan.md`.

## Verify in sandbox before promotion

Run these checks against a sandbox copy of Looparr's own `plan.md`:

- The new file starts with `# <Task title>` and `Status: draft — implementation plan.`.
- The body below the status line matches the removed inline body byte for byte.
- The pointer line matches the required format exactly.
- The relative link target `.project_documents/PLAN-<kebab-task-title>.md` resolves from `plan.md`.
- Replacing the pointer with the original section reproduces the original `plan.md` byte for byte; every unrelated byte is unchanged.
- No real-tree file is touched until all checks pass.

Promote the verified directive and any verified split files only after every sandbox check passes.
