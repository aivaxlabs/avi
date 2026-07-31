# Workflows in Avi

A workflow is a reusable task procedure stored as one Markdown file. Use it for a focused operation that a user should be able to select explicitly from the composer.

## Locations

```text
$AVI/context/workflows/<workflow-name>.md
$HOME/.agents/workflows/<workflow-name>.md
$PWD/.agents/workflows/<workflow-name>.md
<project-subdirectory>/.agents/workflows/<workflow-name>.md
```

Use `.md` for predictable editing and display. Avi catalogs files under these workflow directories, but a bare `$PWD/workflows` or `.github/prompts` directory is not a supported workflow location.

## Supported frontmatter

```yaml
---
name: workflow-name
description: Use when the user needs this focused procedure and expected result.
---
```

Avi reads `name` (or `title`), `description`, and `user-invocable`. If `name` is omitted, the filename stem becomes the command name. Prefer a human-readable name that normalizes to the filename, such as `name: Code Review` in `code-review.md`. Set `user-invocable: false` only when the workflow should remain cataloged for the model but hidden from the `/` selector.

Fields copied from prompt systems—`agent`, `model`, `tools`, `argument-hint`, `context-embeddable`, `hooks`, and `tags`—do not configure Avi workflows.

## Invocation

- Type `/` in the composer to list Avi actions and workflows.
- Select `/workflow-name` and describe the concrete task in the same message.
- Selecting the workflow adds a context marker; it does not execute a separate script or switch models.
- Avi has no workflow argument schema, prompt variables, editor selection placeholder, or model fallback list.
- Project workflows take command-name precedence over global workflows, which take precedence over installation workflows.

Avoid names that collide with built-in Avi commands such as `/plan`, `/goal`, `/ultra`, `/model`, `/effort`, `/compress`, `/side`, `/mcp`, and `/restart-mcp`.

## When to use a workflow

Use a workflow for:

- code review, cleanup, release checks, or commit organization;
- a repeatable research, planning, or documentation procedure;
- a task with a clear sequence and output contract;
- guidance that should run only when selected or clearly relevant.

Use a skill instead when the capability needs several reference files, reusable scripts, examples, or assets. Use instructions for durable project rules. Use MCP for live external tools or data.

## Template

```markdown
---
name: Example Task
description: Use when the user asks to perform the example task and produce a verified report.
---
# Example task

## Inputs
- Target or scope supplied by the user.
- Constraints discoverable from the repository.

## Procedure
1. Inspect the relevant project context and applicable instructions.
2. Perform the requested operation without expanding scope.
3. Run proportionate validation.
4. Review the final diff or artifact.

## Output
- What changed or was found.
- Validation performed and its result.
- Remaining limitations or blockers.
```

## Authoring principles

1. Keep one clear objective per workflow.
2. Let the agent discover repository facts before asking the user.
3. Use only tools available in the current Avi run; never invent editor-specific commands.
4. Respect Avi approval and Git rules. A workflow cannot authorize destructive actions by itself.
5. State whether the default is read-only or mutating.
6. Include a concrete completion and validation contract.
7. Do not duplicate a second reusable prompt inside the workflow; the workflow file is already the reusable procedure.

## Troubleshooting

1. Confirm the file is under a discovered `.agents/workflows` or `$AVI/context/workflows` directory.
2. Check Settings → Context management for the workflow.
3. Type `/` and search for the normalized `name` or filename stem.
4. Check for a same-name workflow at a narrower scope.
5. Remove unsupported frontmatter and make the description specific.
6. Confirm any referenced local files actually exist; workflows do not bundle references automatically.
