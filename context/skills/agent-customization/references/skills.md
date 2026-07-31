# Skills in Avi

A skill is an on-demand package of specialized operational knowledge. Use it when the procedure benefits from supporting references, scripts, examples, templates, or assets.

## Locations

```text
$AVI/context/skills/<skill-name>/SKILL.md
$HOME/.agents/skills/<skill-name>/SKILL.md
$PWD/.agents/skills/<skill-name>/SKILL.md
<project-subdirectory>/.agents/skills/<skill-name>/SKILL.md
```

Avi does not discover project skills from `.github/skills`, `.claude/skills`, a bare `$PWD/skills`, or a normal `$PWD/context/skills` directory.

## Recommended structure

```text
<skill-name>/
├── SKILL.md
├── references/   # Detailed guidance loaded only when needed
├── scripts/      # Reusable helpers the agent may run explicitly
└── assets/       # Templates or other supporting files
```

Only `SKILL.md` is required and discovered. Supporting files are not injected automatically; `SKILL.md` should tell the agent when to read or use them. Scripts still follow Avi's normal tool availability, permission, and approval rules.

## Supported frontmatter

```yaml
---
name: skill-name
description: Use when performing X, diagnosing Y, or working with Z. Covers the important trigger terms.
---
```

Avi reads `name` (or `title`), `description`, and `user-invocable`. Keep the name lowercase kebab-case and match the directory name for predictable `$skill-name` invocation, even though Avi does not currently enforce the match.

Set `user-invocable: false` only to hide the skill from the `$` selector. It remains in the catalog and can still be discovered by the model. Avi ignores `disable-model-invocation`, `context-embeddable`, `argument-hint`, `tools`, `model`, `agent`, and `hooks` for skill behavior.

## Invocation and discovery

- Type `$` in the composer to list skills.
- Select `$skill-name` to attach a marker to the next message.
- Avi catalogs the skill's path and description; the agent must read `SKILL.md` before following it.
- The accompanying user message is the task input. There is no skill argument schema or variable interpolation.
- Project skills take command-name precedence over global skills, which take precedence over installation skills.

Descriptions are the discovery surface. Include both what the skill knows and when it should be used. A description is not a substitute for the skill body.

## When to use a skill

Use a skill for:

- library, framework, protocol, or product-specific procedures;
- repeatable tasks requiring detailed decision rules;
- tasks with reusable scripts, templates, examples, or reference material;
- knowledge that should be available across several workflows.

Prefer a workflow when the content is one focused procedure that fits comfortably in one Markdown file. Prefer instructions when rules should apply repeatedly throughout a scope. Prefer MCP when live tools or external data are required.

## Authoring principles

1. Keep `SKILL.md` concise and executable.
2. Put long explanations and source notes in `references/`.
3. From `SKILL.md`, use relative links such as `./references/api.md` and ensure the target exists.
4. State prerequisites, decision points, safety constraints, and validation.
5. Ensure every referenced file exists.
6. Do not add scripts or assets unless they are actually useful.
7. Never imply that selecting a skill bypasses approvals or grants unavailable tools.

## Troubleshooting

1. Confirm the file is named exactly `SKILL.md`.
2. Confirm it is below a discovered `skills/<name>/` directory in `.agents` or installation context.
3. Check Settings → Context management for its title and description.
4. Type `$` rather than `/` in the composer.
5. Check for another skill with the same normalized command name at a narrower scope.
6. Use only simple `name` and `description` frontmatter and ensure `---` is the first line.
