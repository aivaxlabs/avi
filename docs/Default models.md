# Default models

**Settings → Default models** assigns models to supporting tasks that are separate from the active conversation model.

## Roles

| Setting | Used for | Behavior when unset |
|---|---|---|
| Auxiliary model | Supporting tasks such as title and Goal preparation, plus optional continuation replies | The flow uses its direct fallback behavior |
| Supervision model | Reviewing Goal completion | The Goal or orchestrator model is used |
| Quick chat model | Required initial model for Quick Chat | Quick Chat cannot open |
| Small, Medium, Large model | Sub-agent model levels | The orchestrator or last-used model may be used at runtime |

Each assignment can also pin a reasoning effort supported by the selected model.

The initial state is `None` for every role with **Use model levels** disabled.

## Sub-agent model levels

When **Use model levels** is enabled, Small, Medium, and Large become required. Orchestration tools receive a `model_level` value instead of explicit `model_name` and `reasoning_effort` fields.

If a configured level model is missing, disabled, or no longer supports its saved reasoning effort, Avi tries the orchestrator or last-used model. If that fallback is also unavailable, thread creation fails.

When model levels are disabled:

- `chat_spawn_subagent` inherits the orchestrator model and reasoning effort;
- `chat_create_thread` prefers the most recent model and reasoning effort used in the target folder, then the invoking model;
- an incompatible saved reasoning effort produces an error rather than being silently changed.

## Quick Chat requirement

Quick Chat requires an explicitly available **Quick chat model**. It does not automatically fall back to the last-used or first catalog model. Configure this role before selecting **Quick chat** from the Sidebar or tray. The model can be changed inside the Quick Chat window after it opens.

## Availability warnings

A saved default can become unavailable when a provider or model is removed or disabled, or when the model stops declaring the selected reasoning effort. Avi reports warnings but does not rewrite the assignment automatically.

Use this safe replacement sequence:

1. add and enable the new provider or model;
2. update **Default models**;
3. save and review warnings;
4. remove or disable the old model only afterward.

See [Adding providers](Adding%20providers.md) and [Sub-agents](Sub-agents.md).
