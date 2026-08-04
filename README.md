<p align="center">
  <img src="./assets/icon.svg" width="180" height="180" alt="Avi logo">
</p>

<h1 align="center">Avi</h1>

<p align="center">
  A local desktop workspace for AI conversations, tools, and orchestration.
</p>

<p align="center">
  <a href="https://avi.aivax.net">Website</a>
  ·
  <a href="https://github.com/aivaxlabs/avi">Source code</a>
</p>

Avi brings model conversations, project context, local tools, MCP servers, and multi-agent workflows into one desktop application. Conversation state is stored locally, while model requests are sent only to the providers you configure.

## Features

- **Light**: small footprint compared to other harnesses
  - Low RAM and CPU consumption with multiple agents working
  - Fast startup, launches with the system
  - Few dependencies, easy to maintain
- **Multiple providers**: connect multiple AI providers and customize the models you’ll use for each provider.
  - OpenAI Subscription: your ChatGPT subscription – no need for Codex ACP
  - OpenAI-Compatible endpoints: /v1/responses and /v1/chat/completions
  - Model-specific settings: capabilities, reasoning supported
- **Powerful sub-agents**: sub-agents can actively communicate with the orchestrator and other sub-agents.
  - Define sub-agent levels: model + reasoning per sub-agent invocation level (low, medium, high), lets you choose which models and providers will run different task types
  - Active communication: sub-agents can send messages to the orchestrator and other sub-agents while working, and vice versa.
  - Sub-agent view panel: track sub-agent progress via the side panel.
- **Powerful orchestration**: chats have advanced reflection and orchestration tools.
  - Start, inspect, and converse with parallel threads: agents can view conversations, work folders, tasks, monitor and supervise other agents.
  - Remote MCP: persistent server that provides orchestration tools to connect to external services (Claude, ChatGPT, etc.)
  - Orchestration panel: view ongoing tasks, newly completed tasks, consumption insights
- **MCP client**: MCP client scoped per project
  - MCP control panel: view MCP tools, provided instructions
  - Isolation: separate MCP servers by folder or globally
  - Diagnostics: visually check servers that failed or are slow to start
- **Context management and discovery**: advanced discovery of skills, workflows, and instructions
  - Recursive context listing: searches for skills and workflows in the current folder and globally (in $HOME/.agents) without the agent having to search
  - Automatic contextualization: injects AGENTS.md, MEMORY.md, AGENTS.foobar.md... automatically into the agent’s context.
  - Slash commands: invoke workflows with /command and skills via $skill in the composer.
  - Context panel: 
- **Advanced inference**:
  - Very large tool results are truncated and written to files
  - Agent can query large tool outputs with tools.
  - Native tools for file reading, media reading (images, PDFs) and file writing (encoding‑sensitive).
  - Automatic retry for server errors.
  - Queue and steer mechanism for advanced chat.
  - Execution permission level for potentially dangerous tools (ask for approval, allow for me, full access).
  - Automatic context compression on provider errors (context_length_exceeded) or when reaching user‑defined threshold.
- **Goals and targets**:
  - Goals can be started with /goal or by the agent itself.
  - Helper model expands the goal with completion criteria, execution rules, and relevant meta‑information.
  - Model loops until the condition is met.
  - *Infinite* inference retry with long timeout for provider errors, rate‑limits, or server not interrupting the goal.
- **Ultra mode**:
  - Aggressive delegation mode of sub‑agents to different solution‑exploration fronts.
  - Has a rigid workflow of recognition, judgment, and refinement of the work done.
  - Can consume many more tokens.
  - Can be used together with goals.
- **Planning mode**:
  - Agent uses sub‑agents to create an execution plan for a task.
  - Delegates sub‑agents for exploration, research, and independent checks to refine the plan.
  - Instructs sub‑agents to talk actively with each other to reach a consensus.
- **Quick chat and side chats**:
  - Side chats: fork the current conversation into a quick side chat to ask about the agent’s work without interrupting the main chat. Side chats can direct, orchestrate, and assist the main agent and its sub‑agents.
  - Quick chats: minimalist quick chat for fast questions unrelated to any thread or folder.
- **Side panel**:
  - View files, git changes in the side panel
  - View tasks started by the agent during its threads
  - View provider limits and consumption (OpenAI Subscription only)
- **Customizable**:
  - Choose different personalities for the chat (friendly, candid, cynical, etc.)
  - Choose interface themes

## Technology

- [Electron](https://www.electronjs.org/) for the desktop runtime and [electron-builder](https://www.electron.build/) for installers
- [Bun](https://bun.sh/) for package management and development/build scripts
- [React](https://react.dev/) for the renderer
- [Vite](https://vite.dev/) for renderer builds
- [Cascadium](https://github.com/cypherpotato/cascadium) for stylesheet compilation
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) for MCP integrations

## Getting started

### Prerequisites

- [Bun](https://bun.sh/) installed and available in your terminal
- Git
- A supported Windows, macOS, or Linux desktop environment

### Install and run

```bash
git clone https://github.com/aivaxlabs/avi.git
cd avi
bun install
bun run dev
```

To open the renderer developer tools:

```bash
bun run dev:devtools
```

During development only, pass `--skip-single-instance` when parallel Avi instances are required:

```bash
bun run dev --skip-single-instance
```

No environment variables are required for normal development. Providers and MCP servers are configured inside the application.

## Provider setup

Open **Settings → Providers**, then choose one of the supported connection types:

### OpenAI Subscription

Connect a ChatGPT account through the browser-based OAuth flow. Supported models are managed by Avi and become available after authorization.

### OpenAI Compatible

Configure a provider that implements either:

- `POST /v1/responses`
- `POST /v1/chat/completions`

Provide the base URL, API key, and models exposed by the service. Model capabilities and reasoning behavior can be adjusted per model.

## Development commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Build the renderer and start Avi in development mode |
| `bun run dev:devtools` | Start development mode with renderer developer tools |
| `bun run styles` | Compile Cascadium styles into the renderer stylesheet |
| `bun run styles:watch` | Recompile styles when source files change |
| `bun run syntax` | Check JavaScript and JSX syntax |
| `bun run renderer:build` | Compile styles and produce the Vite renderer build |
| `bun run build` | Build the renderer |
| `bun package` | Build the renderer and create an installer for the current platform |
| `bun package --all` | Request Windows, macOS, and Linux installers (use native CI runners for release artifacts) |

## Tests

The repository contains focused test scripts instead of a single aggregate test command:

```bash
bun run test:context
bun run test:plan
bun run test:goal
bun run test:ultra
bun run test:server-retry
bun run test:provider-auth
bun run test:interruptions
bun run test:mcp
bun run test:files
bun run test:side-chat
```

Run the tests relevant to your change, followed by:

```bash
bun run syntax
bun run build
```

## Building a release

The application version is defined in `package.json` and compiled into the renderer and desktop package.

```bash
bun package
```

Installers are written to `artifacts/`. `bun package --all` requests every configured target, but signed and production-ready artifacts should be generated on native Windows, macOS, and Linux CI runners because DMG signing/notarization, NSIS signing, and Linux packaging tools are platform-specific.

## Project structure

| Path | Responsibility |
| --- | --- |
| `assets/` | Product artwork and platform icons |
| `src/main/` | Desktop process, persistence, tools, IPC, context, and MCP runtime |
| `src/providers/` | Model provider definitions and request implementations |
| `src/renderer/` | React interface and renderer-side APIs |
| `src/styles/` | Cascadium source styles |
| `scripts/` | Development, validation, test, and packaging scripts |
| `package.json` | Electron entry point, metadata, and electron-builder release configuration |
| `src/preload/` | Isolated renderer IPC bridge |
| `vite.config.js` | Renderer build configuration |

## Local data and credentials

Avi stores conversation data and preferences in a local SQLite database. Provider credentials and OAuth tokens are encrypted locally with a key protected by the operating system.

Model prompts, tool calls, and attachments may be sent to the configured model provider when required to complete a request. Review the provider's privacy and retention policies before using sensitive data.

## Contributing

1. Fork the repository.
2. Create a focused branch.
3. Install dependencies with `bun install`.
4. Make the smallest coherent change.
5. Run the relevant tests, syntax check, and build.
6. Open a pull request describing the behavior and validation performed.

Prefer concise changes that preserve existing behavior and keep provider-specific logic inside `src/providers/`.

## Project information

- Website: [avi.aivax.net](https://avi.aivax.net)
- Repository: [github.com/aivaxlabs/avi](https://github.com/aivaxlabs/avi)
- Created by [AIVAX Labs](https://aivax.net)
- License: no license file is currently included in this repository
