---
name: create-bot
description: Create and configure an autonomous Avi bot with a working folder, model, schedule, instructions, and a verified first activation.
---
# Create an Avi bot

Create the smallest bot configuration that can reliably own the requested responsibility. Use a regular thread or sub-agent instead when the work is temporary rather than persistent and proactive.

## Procedure

1. **Inspect existing bots.** Call `bots_list` before creating anything. Avoid duplicate responsibilities and reuse an existing bot when an update is sufficient.
2. **Establish the purpose.** Determine the bot's recurring responsibility, expected outcomes, boundaries, and working folder from the conversation and available project context. Ask only when a wrong assumption would materially change the bot.
3. **Choose the runtime.** Select a configured model appropriate for the recurring work, a supported reasoning effort, and either `smart` activation for idle-aware work or `static` activation for every-period execution.
4. **Choose the schedule.** Set a positive activation period, an optional local-time window, and a consecutive activation limit when unbounded repeated work would be wasteful. Keep the bot disabled initially only when setup is incomplete or the user requests it.
5. **Write focused instructions.** Describe responsibilities, priorities, completion signals, delegation expectations, and explicit boundaries. Do not duplicate general Avi instructions. Put durable bot-only workspace rules in `BOTS.md` at the appropriate global, workspace, or nested scope.
6. **Create the bot.** Call `bots_create` with the agreed configuration. Use an absolute working folder when the bot manages a project; omit it only when a dedicated isolated bot folder is appropriate.
7. **Validate configuration.** Call `bots_list` and verify the returned bot ID, main thread, resolved folders, model, schedule, enabled state, and instructions.
8. **Activate when ready.** Call `bots_activate` for a first run when the user requested an immediately usable bot. This explicit activation ignores automatic scheduling rules, including a disabled state, but does not duplicate an already-running activation.
9. **Report the result.** Provide the bot ID, main thread ID, working and data folders, model, schedule, activation result, and any remaining setup or unverified behavior.

## Safety

- `bots_delete` removes the bot conversation and requires the normal destructive-action approval path. Bot memory and work-state files remain on disk.
- Do not let one autonomous bot create, edit, delete, or activate other bots. Bot-management tools are for normal and Quick Chat coordination.
- Do not claim a first activation succeeded unless `bots_activate` returned `started`.

Use [the bot-management reference](../skills/agent-customization/references/bots.md) for field semantics and lifecycle constraints.
