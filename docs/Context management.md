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

Use `AGENTS.md` for instructions shared by every full chat, `BOTS.md` for instructions exclusive to bot threads, `.agents/workflows/*.md` for workflows, `.agents/skills/<name>/SKILL.md` for skills, and `.agents/mcpconfig.json` for global or exact-folder MCP configuration. Projects may centralize qualified instruction files as `.agents/AGENTS.<subject>.md`.

Runtime authority is ordered as: Avi system/runtime instructions, the direct user request, applicable project instructions, then repository conventions. Dynamic prompt roots are assembled installation → global → workspace. For duplicate skill or workflow command names, command lookup gives workspace precedence over global, installation, and registered plugin context.

Full-chat instructions bias agents toward completing clear action requests, making reasonable scoped assumptions, and finishing safe preparatory work before asking for input or approval. If an applicable skill or project instruction causes a pause, confirmation request, incomplete result, or change of direction, the agent must identify the exact file and rule and distinguish that requirement from its own interpretation.

## Instructions

Avi recommends `AGENTS.md` for general instructions and also recognizes compatible AGENTS/MEMORY variants, `CLAUDE.md`, `GEMINI.md`, `*.instructions.md`, and `*.agents.md`. `BOTS.md` follows the same root and nested discovery rules, but is only included in bot-thread context. Its body, path, and description are excluded from ordinary threads, side chats, sub-agents, and Quick Chat.

Instructions at the workspace root or directly under its `.agents` directory are injected by default. `embeddable: false` keeps one of these root instructions in the catalog without injecting its body. Other nested instructions appear by path and description and must be read by the agent when relevant. Context management can list `BOTS.md` for administration even though normal conversation prompts cannot see it.

Avi does not implement `applyTo` matching or automatic semantic merging of nested instructions.

## Skills and workflows

Skill and workflow bodies are not embedded into the catalog. Type `$` to select a skill and `/` to select a workflow or Avi action. The accompanying user message provides the concrete task.

There is no argument schema, placeholder expansion, or automatic model selection in frontmatter. Plugin parameters are JavaScript contract fields, not workflow or skill frontmatter.

Recognized metadata includes `name` or `title`, `description`, `user-invocable: false`, and `embeddable: false`. `user-invocable: false` only hides a skill or workflow from the composer selector; it remains available to the model. Fields such as `tools`, `model`, `agent`, `hooks`, and `tags` do not control Avi runtime behavior.

## Plugins

Plugins are trusted single-file ESM `.js` extensions loaded from `~/.aivax/plugins` at startup. They can materialize managed context under `~/.aivax/plugins/.avi` (shown as `$HOME/.aivax/plugins/<plugin-id>`), but can also contribute executable tools and providers, MCP descriptors, declarative panels, themes, and personalities. They run with Avi main-process privileges and are not sandboxed.

See [Plugins](Plugins.md) for the complete contract, security model, contribution examples, installation behavior, and troubleshooting.

## Dynamic runtime context

Depending on the turn, Avi may inject personality, response verbosity, AIVAX memory guidance, MCP server instructions, Plan/Goal/Ultra contracts, Tasks, the orchestration team, current-thread identity, and environment information.

Quick Chat uses reduced instructions and does not receive the full ordinary-thread orchestration context or any discovered instruction file. Its only custom instructions come from **Settings → Tuning → Quick Chat instructions**.

## Context management UI

Open **Folders → Global or a working folder → Context** from the Activity Bar. Global inspects `~/.agents`; a working folder inspects its own context. **Settings → Context** remains available for the complete context-scope list, including plugin context. Each scope shows Instructions, Skills, and Workflows in separate tabs with item counts; every item lists its title, description, and approximate token count. A subdued relative file path appears after the title, relative to the selected context root (`~/.agents` for Global). Nested skills are grouped beneath their nearest parent skill in collapsible Sub-skills sections.

Use the search field to filter the current tab by title, description, or path; matching nested skills are shown as a flat list. The sort menu offers **Default** (directory depth, then larger token size first), **Token size**, **Created at (desc)**, **Created at (asc)**, **A-Z**, and **Z-A**. Creation dates come from the file system.

The **+** button beside the **...** menu asks for a name and creates a templated item in the scope's `.agents` directory: `AGENTS.<Name>.md` for instructions, `skills/<name>/SKILL.md` for skills, and `workflows/<name>.md` for workflows. Existing files are never overwritten. Installation and plugin context is read-only, so **+** is hidden there.

Selecting an item opens the context editor. **Content** uses Monaco, the editor from VS Code, with Markdown and YAML frontmatter highlighting, VS Code keyboard shortcuts (find, multi-cursor, Tab/Shift+Tab indentation), list continuation on Enter, Ctrl+B/Ctrl+I formatting, and Bold, Italic, Inline code, and Link in the right-click menu. Ctrl+M toggles whether Tab moves focus out of the editor, Esc closes the dialog when no editor widget is open, and Ctrl+S saves. **Properties** edits the supported frontmatter fields: name (or title), description, `embeddable` for instructions, and `user-invocable` for skills and workflows, and **Visibility**; other frontmatter is kept as written. **Visibility** moves the item between its standard location (**Default**) and `.agents/.user-private` (**Private**), keeping each kind's base path: `.agents/.user-private/AGENTS.<Name>.md` for instructions, `.agents/.user-private/skills/<name>/SKILL.md` for skills (the whole skill folder moves), and `.agents/.user-private/workflows/<name>.md` for workflows. When Avi creates `.agents/.user-private`, it also writes a `.gitignore` containing `*`, so Git ignores the folder and everything in it. Private items are discovered recursively in every `.agents` folder, with the same depth limits as `.agents`; private instructions directly in a root's `.agents/.user-private` are root instructions like those in `.agents`. Moving fails if the destination already exists. Unsaved changes require confirmation before closing. **Open externally** opens the file in the system editor.

Badges use a colored dot and text: green for **Always visible**, blue for **On demand**, and an amber diamond for invocation restrictions. Activation badges describe actual loading behavior: **Always visible** means the instruction body is injected automatically; **On demand** means the item is cataloged for explicit reading. Skills and workflows are on demand. These badges describe ordinary-chat visibility; `BOTS.md` remains bot-thread-only and its applicable root instructions are injected for bots. **Assistant only** identifies skills or workflows with `user-invocable: false`; unspecified invocation metadata has no extra badge. Avi does not currently implement a user-only activation flag.

Directory discovery and metadata reads run asynchronously with processor-count-bounded concurrency. Loading does not require a synchronous filesystem scan in the renderer. Selecting an item opens the file in its system-associated application; Avi does not include an internal Markdown editor.

## Conversation compaction

Regular copies, side chats, and Rubber Duck forks preserve the source checkpoint and its history boundary, even when that boundary is a hidden runtime message. Older history stays visible in the conversation but is not replayed to the model. The checkpoint is sent to the model as a `user` message, followed by any conversation messages after the boundary; it is not a system instruction. Forks ending before the boundary do not inherit the later checkpoint or its token counter. Sub-agents start with fresh context rather than a copy of the parent history.

When automatic compaction runs during a response, the response keeps the work done before the compaction, and the compaction marker appears at the point where it happened. The earlier text, reasoning, and tool calls stay visible but are no longer sent to the model, which continues from the checkpoint.

Automatic and manual checkpoint compaction send regular conversation messages followed by a final user request for a checkpoint. In-flight tool calls and results remain structured messages, not a JSON transcript. Provider-specific reasoning and continuation metadata are removed; assistant text, tool calls, results, and supported media are retained, including content recovered from continuation items.

For context-window errors, Avi tries the full in-flight tool history, then removes its oldest 30%, then its oldest 60%. The fourth attempt keeps that 60% reduction and also removes intermediate assistant messages from the earlier conversation, retaining complete function-call/output pairs. If the configured compactation model fails, Avi retries with the chat model using the same sequence. These percentages apply to in-flight tool-history rounds, not all conversation messages. Three consecutive failed automatic compactions stop the chat.

## Troubleshooting discovery

If an item is missing:

1. verify the active conversation folder;
2. verify the supported location and filename;
3. ensure frontmatter starts on the first line and closes with `---`;
4. check discovery depth and ignored directories;
5. determine whether `user-invocable: false` only hid it from the selector;
6. start a new turn after saving changes. Discovery results are cached for up to a minute; run `/reset-context` to reload instructions, skills, and workflows immediately. It also rereads MCP configuration and restarts MCP servers.

See [Setup folders and initialize context](Setup%20folders%20and%20initialize%20context.md).
