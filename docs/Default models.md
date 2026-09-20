# Models

**Settings → Models** assigns models to supporting tasks that are separate from the active conversation model.

The Models page keeps one draft across four tabs: **Auxiliar models**, **Sub-agents**, **Rules**, and **Model slider**. Changes remain in the draft while you move between tabs. **Save default models** saves all tabs together.

## Roles

| Setting | Used for | Behavior when unset |
|---|---|---|
| Auxiliary model | Supporting tasks such as title and Goal preparation, plus optional continuation replies | The flow uses its direct fallback behavior |
| Supervision model | Reviewing Goal completion | The Goal or orchestrator model is used |
| Compactation model | Context compactation checkpoints | The chat model performs the compactation |
| Quick chat model | Required initial model for Quick Chat | Quick Chat cannot open |
| Small, Medium, Large model | Sub-agent model levels | The orchestrator or last-used model may be used at runtime |

Each assignment can also pin a reasoning effort supported by the selected model.

The initial state is `None` for every role with **Use model levels** disabled.

## Model rules

The **Rules** tab stores `defaultModels.rules` as an array of entries with this shape:

```json
{
  "modelId": "provider:model",
  "role": "main",
  "instructions": "Instructions for this model and role."
}
```

Supported roles are `main`, `bot`, `subagent`, and `all`. The default is `[]`. A model ID may name a concrete model or a virtual model router such as `@router-id`.

Rules apply only to full chat runs. They do not apply to Quick Chat, auxiliary work, or the Rubber Duck supervisor. Main includes ordinary main conversations and Side Chat. Bot conversations use the `bot` role; sub-agent conversations use the `subagent` role.

Rules are instructions, not permissions: they can guide behavior but cannot grant access or override user requests, permissions, or safety constraints. The runtime takes a rules snapshot for each run. It matches the effective concrete model ID and, when applicable, the virtual router ID. Concrete candidate rules apply to the candidate that actually runs, including after router fallback; virtual-router rules remain applicable across router candidates. Matching order is:

1. concrete model, `all` role;
2. virtual router, `all` role;
3. concrete model, the specific role;
4. virtual router, the specific role.

The role-specific entries have higher priority than `all`; within either role, virtual-router entries have higher priority than concrete-model entries.

Save validation rejects a non-array rules value, a missing or blank model ID, an unsupported role, blank instructions, or duplicate `(modelId, role)` pairs. If a saved model later becomes unavailable, its rule is retained and Avi shows a warning; the rule is inactive until that model is available again.

## Context compactation

When a **Compactation model** is configured, manual and automatic context compactation run with it following the standard compactation attempt order (progressively reduced tool history). Compactation is best-effort: if the configured model fails during inference, Avi retries the same attempt order with the conversation's chat model. If the chat model also fails, the compactation error is reported as before.

## Sub-agent model levels

When **Use model levels** is enabled, Small, Medium, and Large become required. Orchestration tools receive a `model_level` value instead of explicit `model_name` and `reasoning_effort` fields.

If a configured level model is missing, disabled, or no longer supports its saved reasoning effort, Avi tries the orchestrator or last-used model. If that fallback is also unavailable, thread creation fails.

When model levels are disabled:

- `chat_spawn_subagent` inherits the orchestrator model and reasoning effort;
- `chat_create_thread` prefers the most recent model and reasoning effort used in the target folder, then the invoking model;
- an incompatible saved reasoning effort produces an error rather than being silently changed.

## Intelligence levels

**Settings → Models → Model slider** configures the composer intelligence slider. Define between 3 and 10 levels; each level selects a model with an optional reasoning effort and is displayed as **Model - Reasoning**.

When at least three levels are configured, the composer model picker opens in slider mode: drag the slider or use the arrow keys to preview a model and reasoning combination, then release to apply it. **Advanced** switches to direct model and reasoning selection, and the same button returns to the slider. The composer chip always shows the selected model and effort. With fewer than three configured levels, the picker stays in advanced mode.

Levels that reference a missing model or an unsupported reasoning effort are reported as availability warnings and skipped by the slider.

## Quick Chat requirement

Quick Chat requires an explicitly available **Quick chat model**. It does not automatically fall back to the last-used or first catalog model. Configure this role before selecting **Quick chat** from the Sidebar or tray. The model can be changed inside the Quick Chat window after it opens.

## Availability warnings

A saved default can become unavailable when a provider or model is removed or disabled, or when the model stops declaring the selected reasoning effort. Avi reports warnings but does not rewrite the assignment automatically.

Use this safe replacement sequence:

1. add and enable the new provider or model;
2. update **Models**;
3. save and review warnings;
4. remove or disable the old model only afterward.

See [Adding providers](Adding%20providers.md) and [Sub-agents](Sub-agents.md).
