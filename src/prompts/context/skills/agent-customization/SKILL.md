---
name: agent-customization
description: Create, update, review, or debug Avi customization: instructions, skills, workflows, MCP configuration, and trusted plugins. Use when deciding which Avi primitive to use, where files belong, why context was not discovered, how /workflow and $skill invocation works, which frontmatter fields Avi supports, or when a plugin is appropriate.
user-invocable: false
---
# Avi Context Customization

Use this skill to customize Avi with five supported primitives: **instructions, skills, workflows, MCP, and plugins**.

Avi does not discover VS Code or Copilot prompt files, hooks, custom-agent files, `.github` customization folders, or `.claude` skill folders. Runtime features such as Plan, Goal, Ultra, and sub-agents are Avi features, not additional context file types.

## Choose the primitive

| Need | Use |
|---|---|
| Durable rules that should guide work in a user, project, or directory scope | Instructions |
| A repeatable procedure selected explicitly for a task | Workflow |
| Specialized knowledge or a procedure that benefits from references, scripts, examples, or assets | Skill |
| Tools or live context from an external process, service, or API | MCP |
| A trusted install-wide JavaScript extension contributing multiple Avi capabilities or main-process behavior | Plugin |

Use instructions for behavior that should apply repeatedly. Use a workflow or skill for task-specific guidance so it does not consume every conversation's instruction context. Use MCP only when the agent needs a runtime integration; static guidance belongs in instructions or a skill. Use a plugin only when trusted executable extension code is necessary; plugins run with Avi main-process privileges.

## Supported locations

`$HOME` the user's home directory, and `$PWD` the active project folder.

| Scope | Instructions | Workflows | Skills | MCP | Plugins |
|---|---|---|---|---|---|
| User-global | `$HOME/.agents/AGENTS.md` | `$HOME/.agents/workflows/*.md` | `$HOME/.agents/skills/<name>/SKILL.md` | `$HOME/.agents/mcpconfig.json` | — |
| Project | `$PWD/AGENTS.md` | `$PWD/.agents/workflows/*.md` | `$PWD/.agents/skills/<name>/SKILL.md` | `$PWD/.agents/mcpconfig.json` | — |
| Project subdirectory | `<dir>/AGENTS.md` | `<dir>/.agents/workflows/*.md` | `<dir>/.agents/skills/<name>/SKILL.md` | Configure the project scope | — |
| Avi installation | Built-in context | Built-in context | Built-in context | — | `$INSTALL_DIR/plugins/*.js` |

A bare `$PWD/context/` directory is not a context root; project skills and workflows belong under `$PWD/.agents/`.

## Discovery and scope

Avi assembles context from two user-manageable sources:

1. User-global `$HOME/.agents` context.
2. The active workspace and its nested `.agents` directories.

Use the narrowest suitable scope. A project item can override a global command with the same type and normalized name. Avoid accidental name collisions.

Root instruction files are injected directly. Nested instruction files are listed with their paths and descriptions so the agent can read the applicable file before working in its scope. Skill and workflow catalogs likewise include metadata, not the full file body; the agent must read a relevant or explicitly selected item before following it.

The Settings → Context management screen shows the items Avi discovered for each scope. Use it to verify paths, names, descriptions, and approximate context size.

## Frontmatter Avi reads

Keep frontmatter simple:

```yaml
---
name: item-name
description: Use when the task needs this specific capability or procedure.
---
```

Avi currently reads:

- `name` or `title` for the displayed item and command name;
- `description` for catalog discovery and command help;
- `embeddable: false` on root instruction files to keep them in the available-context catalog without automatically injecting their body;
- `user-invocable: false` on skills and workflows to hide the item from the `$` or `/` composer selector.

If `name` is omitted, a skill uses its folder name and a workflow uses its filename. Put `---` on the first line. A quoted single-line description or a YAML block using `>` or `|` is supported.

Other fields such as `applyTo`, `context-embeddable`, `disable-model-invocation`, `agent`, `model`, `tools`, `hooks`, and `tags` do not control Avi behavior. `embeddable` applies only to instruction files; skills and workflows are already cataloged without embedding their full body. `user-invocable: false` only hides the composer command; the item remains in the catalog available to the model. Do not use frontmatter to imply restrictions or capabilities that Avi will not enforce.

Plugin parameters do not come from workflow or skill frontmatter. They are JavaScript definition and contribution fields from the versioned plugin contract.

## Creation process

1. **Inspect existing context.** Check the target scope and avoid duplicate names or conflicting guidance.
2. **Choose scope.** Use global context for personal cross-project behavior and project context for repository-specific behavior.
3. **Choose the primitive.** Follow the decision table above; do not turn every rule into a skill or every procedure into always-on instructions.
4. **Create the smallest useful item.** Keep instructions and workflows focused. Put detailed skill material in `references/` and load it only when needed.
5. **Validate discovery.** Confirm the path, frontmatter, command name, relative references, and appearance in Context management or the composer picker.
6. **Exercise the real invocation.** Select workflows with `/` and skills with `$`, then verify the agent reads the selected file and follows it.

## Invocation model

- Type `/` in the composer to find Avi actions and workflows.
- Type `$` to find skills.
- Selecting an item adds a context marker to the next message.
- The user's accompanying message supplies the task input; Avi does not implement prompt variables or an argument schema in frontmatter.
- Set `user-invocable: false` only when an item should remain discoverable by the model but should not appear in the composer picker.

## Unsupported VS Code concepts

Do not create these for Avi:

- `.github/prompts/*.prompt.md`;
- `.github/instructions/*.instructions.md` as a special root;
- `.github/hooks/*.json` or lifecycle hooks;
- `.github/agents/*.agent.md` or custom-agent definitions;
- `.github/skills/` or `.claude/skills/` as discovery locations;
- `applyTo` globs, prompt recommendations, model fallbacks, or per-file tool restrictions.

Avi may recognize some legacy instruction filenames for compatibility, but new project guidance should use `AGENTS.md` and directory hierarchy instead of editor-specific conventions.

## References

- [Writing effective instructions](./references/agent-instructions.md)
- [Instruction discovery and hierarchy](./references/instructions.md)
- [MCP configuration](./references/mcp.md)
- [Plugins](./references/plugins.md)
- [Skills](./references/skills.md)
- [Workflows](./references/workflows.md)
