# Setup folders and initialize context

A conversation folder is its workspace: files, `<fileref path="./path" />` references, terminal working directory, project context, and folder-scoped MCP servers.

## Select a folder

Before the first message, open the folder picker in the composer and choose **Home**, a recent folder, or **Choose folder**. Avi stores the absolute path and detects the Git branch when available.

After the thread is created, the folder is locked. Create a new conversation to use a different workspace.

## Initialize the project with `/init`

Use Avi's bundled `/init` workflow instead of creating the instruction hierarchy by hand:

1. Start a new conversation in the folder you want to initialize.
2. Type `/` in the composer and select **init**.
3. Send a concrete request such as `Initialize this project's agent context.`
4. Review the proposed and completed changes before accepting them.

`/init` inspects the repository, existing instructions, manifests, source layout, commands, tests, and maintained documentation. It then creates or improves a concise root `AGENTS.md` and adds nested `AGENTS.md` files only for materially distinct project areas. If the existing hierarchy is already sufficient, it should leave it unchanged rather than rewrite it cosmetically.

The workflow may create or update instruction files inside the selected workspace. It does not authorize application-code changes, dependency installation, staging, commits, publishing, deployment, or writes outside the workspace.

A typical result is:

```text
project/
├── AGENTS.md
└── src/
    └── AGENTS.md
```

## Add specialized context only when needed

`/init` focuses on the project's `AGENTS.md` instruction hierarchy. Add other primitives separately when the project genuinely needs them:

- `.agents/workflows/*.md` for repeatable procedures selected with `/`;
- `.agents/skills/<name>/SKILL.md` for specialized knowledge selected with `$`;
- `.agents/mcpconfig.json` for live tools or external data.

Bare `project/context`, `project/skills`, and `project/workflows` directories are not Avi context roots. Use `.agents` for project workflows, skills, and MCP configuration.

## Discovery limits

Context discovery has a maximum depth of six and a five-second timeout. It ignores common dependency, build, cache, and source-control directories such as `.git`, `node_modules`, `dist`, and `build`.

Nested instructions are cataloged for on-demand reading; they are not automatically injected or semantically merged. Use them only for areas with materially different rules.

## Verify the setup

- **Context** shows the expected Instructions, Skills, and Workflows.
- `/` and `$` show user-invocable items.
- **MCP servers** shows the global scope and the exact project folder.
- A new thread displays the expected folder and Git branch.

See [Context management](Context%20management.md) and [MCP servers](MCP%20servers.md).
