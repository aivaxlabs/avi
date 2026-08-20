# Context management

Avi separates customization into five primitives:

| Need | Use |
|---|---|
| Durable rules | Instruction |
| A reusable procedure selected for a task | Workflow |
| Specialized knowledge with references or assets | Skill |
| Live tools or data from another process or service | MCP |
| A trusted install-wide JavaScript extension | Plugin |

Plan, Goal, Ultra, and sub-agents are runtime features, not context file types. Plugins are trusted executable extensions, not Markdown context files.

## Scopes and locations

- Installation context: `$AVI/context`;
- Global user context: `$HOME/.agents`;
- Workspace context: `$PWD` and supported nested `.agents` directories.

Use `AGENTS.md` for instructions shared by every full chat, `BOTS.md` for instructions exclusive to bot threads, `.agents/workflows/*.md` for workflows, `.agents/skills/<name>/SKILL.md` for skills, and `.agents/mcpconfig.json` for global or exact-folder MCP configuration.

Runtime authority is ordered as: Avi system/runtime instructions, the direct user request, applicable project instructions, then repository conventions. Dynamic prompt roots are assembled installation → global → workspace. For duplicate skill or workflow command names, command lookup gives workspace precedence over global, installation, and registered plugin context.

## Instructions

Avi recommends `AGENTS.md` for general instructions and also recognizes compatible AGENTS/MEMORY variants, `CLAUDE.md`, `GEMINI.md`, `*.instructions.md`, and `*.agents.md`. `BOTS.md` follows the same root and nested discovery rules, but is only included in bot-thread context. Its body, path, and description are excluded from ordinary threads, side chats, sub-agents, and Quick Chat.

Root instructions are injected by default. `embeddable: false` keeps a root instruction in the catalog without injecting its body. Nested instructions appear by path and description and must be read by the agent when relevant. Context management can list `BOTS.md` for administration even though normal conversation prompts cannot see it.

Avi does not implement `applyTo` matching or automatic semantic merging of nested instructions.

## Skills and workflows

Skill and workflow bodies are not embedded into the catalog. Type `$` to select a skill and `/` to select a workflow or Avi action. The accompanying user message provides the concrete task.

There is no argument schema, placeholder expansion, or automatic model selection in frontmatter. Plugin parameters are JavaScript contract fields, not workflow or skill frontmatter.

Recognized metadata includes `name` or `title`, `description`, `user-invocable: false`, and `embeddable: false`. `user-invocable: false` only hides a skill or workflow from the composer selector; it remains available to the model. Fields such as `tools`, `model`, `agent`, `hooks`, and `tags` do not control Avi runtime behavior.

## Plugins

Plugins are trusted single-file ESM `.js` extensions loaded from the Avi installation at startup. They can materialize managed context under `plugins/.avi`, but can also contribute executable tools and providers, MCP descriptors, declarative panels, themes, and personalities. They run with Avi main-process privileges and are not sandboxed.

See [Plugins](Plugins.md) for the complete contract, security model, contribution examples, installation behavior, and troubleshooting.

## Dynamic runtime context

Depending on the turn, Avi may inject personality, AIVAX memory guidance, MCP server instructions, Plan/Goal/Ultra contracts, Tasks, the orchestration team, current-thread identity, environment information, and the active workspace summary.

Quick Chat uses reduced instructions and does not receive the full ordinary-thread workspace and orchestration context.

## Context management UI

**Settings → Context** lists Global and known project folders. Each scope groups Instructions, Skills, and Workflows with a title, description, and approximate token count. Selecting an item opens the file in its system-associated application; Avi does not include an internal Markdown editor.

## Troubleshooting discovery

If an item is missing:

1. verify the active conversation folder;
2. verify the supported location and filename;
3. ensure frontmatter starts on the first line and closes with `---`;
4. check discovery depth and ignored directories;
5. determine whether `user-invocable: false` only hid it from the selector;
6. start a new turn after saving changes.

See [Setup folders and initialize context](Setup%20folders%20and%20initialize%20context.md).
