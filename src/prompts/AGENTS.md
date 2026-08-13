---
description: Rules and onboarding context for Avi's base prompts and bundled installation instructions, workflows, and skills.
---
# Prompt and bundled context guide

## Source and runtime boundaries
- `base-instructions.md`, `quick-chat-instructions.md`, and `personality/*.md` are runtime prompt sources loaded by `src/main/context-injection.js`. Preserve their distinct full-chat, Quick Chat, and personality roles.
- `context/` is the authoring source for context shipped with Avi. Electron Builder copies its contents to packaged `resources/context`, and `resolveInstallationContextPath()` selects that installation root at runtime.
- Do not place a repository-maintainer `AGENTS.md` inside `context/`: it would be copied and treated as installed root instructions. Edit sources here, not a packaged installation's `resources/context`.
- The unusual `context/workflows/` and `context/skills/` layout is installation-specific. Ordinary project context belongs under `<project>/.agents/`; user-global context belongs under `$HOME/.agents/`.

## Supported Avi context
- Use `context/workflows/<name>.md` for focused user-selectable procedures and `context/skills/<name>/SKILL.md` when reusable knowledge needs references, scripts, examples, or assets.
- Use simple supported frontmatter only. For workflows and skills, Avi reads `name` or `title`, `description`, and `user-invocable`; unsupported editor/prompt-system fields do not configure behavior.
- Keep detailed knowledge in a skill's `references/` and link to it from `SKILL.md`. Keep workflows focused on one procedure, its boundaries, validation, and completion output.
- Relative Markdown links must remain valid after the whole `context/` directory is copied unchanged to `resources/context`.
- Before changing customization behavior, read `context/skills/agent-customization/SKILL.md` and its relevant references. Do not duplicate its full contract in adjacent workflows.

## Discovery/runtime coupling
- Changes to filenames, locations, frontmatter, scope, precedence, or ignored directories may require coordinated updates to `src/main/context-injection.js`, user documentation in `docs/Context management.md`, and focused tests.
- Preserve the distinction between injected root instructions and cataloged workflows, skills, and nested instructions.
- Do not document editor-specific prompt files, hooks, custom agents, or unsupported frontmatter as Avi features.

## Validation
- Run `bun run test:context` for prompt assembly, context discovery, injection order, filename, scope, or dynamic-context changes.
- For a changed workflow or skill, verify frontmatter, referenced files, relative links, command naming, and that the item is structurally discoverable in its copied layout.
- Run `bun run build` when packaging/import behavior or Markdown loading changes. UI discovery in Settings → Context management or the `/`/`$` picker is a separate manual validation; report it as unverified unless actually exercised.
