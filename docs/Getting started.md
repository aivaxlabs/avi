# Getting started

Avi is a local desktop workspace for AI conversations, tools, project context, and agent orchestration. This guide takes you from first launch to a working conversation.

## First-run flow

1. Open **Settings → Providers**. If no models are available, Avi opens Settings automatically.
2. Add a provider and enable at least one model.
3. Select **Back to app**, then **New chat**.
4. In the composer, choose a model, project folder, reasoning effort, and permission mode.
5. Send your first message.

A new draft uses your home directory (`$HOME`) until you choose another folder. The folder becomes locked to the thread after the conversation is created.

## Configure a provider

Avi includes three provider types:

- **OpenAI Subscription** — OAuth authentication with a ChatGPT subscription and a managed model catalog;
- **OpenAI Compatible · Responses API**;
- **OpenAI Compatible · Chat completions API**.

OpenAI-compatible endpoints require a Base URL, an API key when applicable, and manually configured models. See [Adding providers](Adding%20providers.md).

## Choose a folder and initialize context

The selected folder defines the workspace available to the thread, including files, terminal working directory, project context, and folder-scoped MCP servers.

Use **Home**, select a recent folder, or choose **Choose folder** in the composer. You can optionally add project context:

```text
project/
└── .agents/
    ├── AGENTS.Project.md
    ├── mcpconfig.json
    ├── skills/example/SKILL.md
    └── workflows/example.md
```

Use instructions for durable rules, workflows for reusable procedures, skills for specialized knowledge, and MCP for live integrations. Use a [plugin](Plugins.md) only for reviewed, trusted install-wide JavaScript extensions; plugins run with Avi main-process privileges. See [Setup folders and initialize context](Setup%20folders%20and%20initialize%20context.md).

## Composer controls

Before sending a message, review:

- **Model** and **Reasoning effort**;
- **Ask for approval** — ask before every tool call;
- **Approve for me** — ask when a call is marked as requiring approval;
- **Full access** — run tool calls without an approval dialog;
- Normal, Plan, Goal, and Ultra modes;
- attachments, audio, and the selected folder.

Start with **Approve for me**. Full access does not override higher-level runtime restrictions such as Plan mode.

Type `/` for Avi actions and workflows, or `$` for skills. Built-in commands include `/plan`, `/goal`, `/ultra`, `/model`, `/effort`, `/compress`, `/side`, `/usage`, `/mcp`, and `/restart-mcp`.

## Local data and external services

Avi stores conversations and most preferences in `~/.aivax/aivax.sqlite`. Credentials are protected with operating-system secure storage. Appearance and some layout state use renderer `localStorage`.

Configured model providers, AIVAX features, and MCP servers may receive conversation content, context, attachments, or tool data as required by each request. Review an integration before enabling it.

When an AIVAX account is connected and at least one AIVAX feature is enabled, the provider usage button beside context usage shows the current balance, consumption during the last 24 hours, storage usage as a progress bar, and remaining included storage.

## Next steps

- [UI basics](UI%20basics.md)
- [Default models](Default%20models.md)
- [Context management](Context%20management.md)
- [Plugins](Plugins.md)
- [Advanced settings](Advanced%20settings.md)
