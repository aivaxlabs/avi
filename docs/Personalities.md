# Personality and verbosity

Personality and verbosity are global response-style instructions. They are separate from the visual theme and from each other: personality controls voice and tone, while verbosity controls how much detail Avi includes.

## Available personalities

Open **Settings → Personalization → Personality** and choose:

- **None** — default; use only Avi base instructions;
- **Candid** — direct, encouraging, and concrete;
- **Cynical** — critical and dryly sarcastic without hostility;
- **Friendly** — warm, collaborative, and honest;
- **Pragmatic** — concise, factual, and technically focused;
- **Quirky** — playful and imaginative without losing precision.

## Available verbosity levels

Under **Settings → Personalization → Verbosity**, choose:

- **Low** — terse UX, minimal prose, and only the context needed to act;
- **Medium** — default; balanced detail for clear, actionable answers;
- **High** — thorough responses suited to audits, teaching, and hand-offs, without repetition or filler.

Select **Save changes**. Unlike theme changes, personality and verbosity changes are not persisted immediately.

## Behavior and precedence

The selected personality and verbosity are stored as Tuning preferences. Personality is injected into ordinary conversations; verbosity is injected into ordinary conversations and Quick Chat. Unknown personalities fall back to None; missing or invalid verbosity values fall back to Medium.

Verbosity changes presentation detail, not reasoning effort or work quality. Low still requires material risks, uncertainty, failed validation, and blockers to be disclosed. High asks for more structure and supporting detail, but not repeated conclusions, routine tool narration, or generic background.

Personality and verbosity do not:

- override system or direct user instructions;
- grant tools or permissions;
- change Plan, Goal, or Ultra behavior;
- choose a model;
- change factual or validation requirements.

Project instructions remain applicable according to normal precedence. If you need a different tone or level of detail for only one task, ask for it directly in the message instead of changing the global settings.

See [Themes](Themes.md) and [Context management](Context%20management.md).
