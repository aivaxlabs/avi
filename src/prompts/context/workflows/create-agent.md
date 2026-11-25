---
name: create-agent
description: Use when the user asks to create or update a specialized agent. Decide project or global scope, choose the model and reasoning effort, write the agent instruction, and validate discovery in the Agents tab and through invoke_specialized_agent.
---
# Create a specialized agent

Create or update a specialized agent: one Markdown file that combines a model, a reasoning effort, and a system instruction for one delegated task, invoked with `invoke_specialized_agent` and run in an isolated child thread.

Use a specialized agent when the task benefits from isolation, a different model, or a fixed role such as review, audit, or verification. Use a workflow instead when the current agent should follow a procedure itself, a skill for reusable knowledge, and instructions for rules that always apply.

## Required skill

This workflow depends on the [agent-customization skill](../skills/agent-customization/SKILL.md). Read it before proceeding, including its specialized agent section, and read the [workflows reference](../skills/agent-customization/references/workflows.md) for authoring principles shared with agent instructions. Do not continue without reading them.

The skill is authoritative for supported locations, frontmatter, invocation, and validation. This workflow adds only scope selection, model choice, and the agent contract.

## Inputs

Infer from the conversation and repository when possible:

- the task the agent performs and when it should be invoked;
- the model and reasoning effort, if the user names them;
- whether the agent is read-only or may change files;
- the report it must return;
- optional destination path.

Ask only when the agent's task or expected report is ambiguous and a wrong assumption would produce an agent that does the wrong thing.

## Scope decision

Choose between project and user-global scope deliberately, and state the reason in the completion report.

1. Does the agent rely on this repository's commands, structure, or conventions? If yes, use project scope: `$PWD/.agents/agents/<id>.md`.
2. Would the agent be useful unchanged in a different project? If yes, use global scope: `$HOME/.agents/agents/<id>.md`.

When still ambiguous, prefer project scope because it is the narrower default. An explicit user-provided path always wins.

## Procedure

### 1. Inspect existing context

Check both scopes for agents with the same or similar id; a project agent overrides a global one with the same id. Read instructions and skills the agent should respect, and link them from its body instead of copying them.

### 2. Define the agent contract

Before writing, clarify:

- one clear task and its boundaries;
- the id, a short lowercase file name such as `code-reviewer`;
- `model`: set it only when the user names a model or the task clearly needs a different one, using a configured model id, provider model id, or display name; leave it empty to use the invoking model;
- `reasoning-effort`: set it only when the chosen model supports that level; otherwise leave it empty;
- `user-invocable: false` only when the agent should be invoked by the model but hidden from the `/` picker;
- the report format the invoker receives.

If the task is too broad for one agent, split it into focused agents.

### 3. Write the agent

Use the frontmatter fields `name`, `description`, `model`, `reasoning-effort`, and `user-invocable`. The description states what the agent does and when to delegate to it, because invokers decide from the catalog.

Write the body as the agent's system instruction: its role, the inputs it expects from the invoking prompt, how it works, what it must not do, and the exact report it returns. The agent receives only that prompt and the shared context, so do not assume it has the invoker's conversation.

### 4. Validate

- Confirm the file is in `.agents/agents/` directly, not in a subfolder, and its frontmatter parses.
- Confirm the agent appears in **Settings → Context → Agents** and, unless hidden, in the `/` picker, and that the editor resolves its model.
- When the user agrees, invoke it once with `invoke_specialized_agent` and a small representative prompt, then check that the report follows the contract.

## Completion report

Report:

- agent id, scope, and path;
- why the chosen scope is correct;
- the model and reasoning effort, or that it inherits the invoking model;
- the task and expected invocation;
- validation actually performed;
- any limitations or assumptions.
