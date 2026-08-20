# Avi instruction discovery and hierarchy

Avi discovers Markdown instruction files in the user-global `.agents` directory and the active workspace.

## Recommended convention

Use `AGENTS.md` for general instruction files. Use `BOTS.md` only for guidance that must apply exclusively to bot threads:

```text
$HOME/.agents/AGENTS.md            # Personal rules across projects
$PWD/AGENTS.md                     # Project-wide rules
$PWD/src/feature/AGENTS.md         # Rules for one subtree
$HOME/.agents/BOTS.md              # Personal rules for bots only
$PWD/BOTS.md                       # Project rules for bots only
$PWD/src/feature/BOTS.md           # Bot-only rules for one subtree
```

`BOTS.md` uses the same root and nested scope behavior as `AGENTS.md`, but Avi only adds its body or catalog entry to bot-thread prompts. Ordinary threads, side chats, sub-agents, and Quick Chat cannot see it. Settings → Context can still list the file so the user can administer it.

Avi also recognizes the following names case-insensitively for compatibility:

- `AGENTS.md` and `AGENTS.<suffix>.md`;
- `MEMORY.md` and `MEMORY.<suffix>.md`;
- `CLAUDE.md`;
- `GEMINI.md`;
- `*.instructions.md`;
- `*.agents.md`.

These compatibility names do not gain VS Code or other editor semantics. In particular, frontmatter such as `applyTo` is not evaluated. Prefer `AGENTS.md` unless maintaining an existing convention.

## How scope works

- An instruction file at the root of a context source is injected in full by default.
- A root instruction file with `embeddable: false` in its front matter is cataloged with its path and description instead of having its body injected.
- A nested instruction file is cataloged with its path and description.
- The agent must read applicable nested instructions before modifying files in their scope.
- Directory hierarchy communicates intended scope to the agent: a deeper instruction file should refine or override broader guidance for its descendants. The Avi loader catalogs nested files but does not itself evaluate directory applicability or merge their bodies.
- Ordinary Markdown files are not instructions merely because they contain imperative text.

For predictable behavior, keep project-wide general guidance in `$PWD/AGENTS.md`, bot-only guidance in `$PWD/BOTS.md`, and place specialized guidance in the relevant subdirectory's matching file.

## Descriptions for nested files

Avi uses the first `description` in simple frontmatter when cataloging a nested instruction file:

```markdown
---
description: Rules for database migrations under this directory.
---
# Migration instructions

- Make migrations reversible.
- Validate both upgrade and rollback paths.
```

If there is no description, Avi uses the first non-empty body line. Descriptions help discovery but do not replace reading the file.

Use `embeddable: false` when a root instruction should remain available for the agent to discover and read without consuming every turn's system-instruction context:

```markdown
---
description: Optional release-process guidance.
embeddable: false
---
```

## Source order

Avi builds runtime context from:

1. global instructions under `$HOME/.agents`;
2. workspace instructions.

Keep broad defaults in the global scope and project-specific refinements in the workspace. Avoid contradictory rules at the same scope.

## What is not supported

- `.github/instructions/` as a special discovery directory;
- profile prompt folders;
- `applyTo` globs or automatic file-pattern attachment;
- manual “Add Context → Instructions” behavior from VS Code;
- instruction-level model, tool, agent, or hook configuration.

## Troubleshooting

If instructions appear to be ignored:

1. Confirm the filename matches a supported pattern.
2. Confirm the file is inside `$HOME/.agents` or the active workspace.
3. Confirm the conversation is using the expected project folder.
4. Check Settings → Context management for the file and its description.
5. Start a new turn after saving the file so runtime context is rebuilt.
6. Check for a narrower instruction file or higher-priority runtime/user instruction that conflicts with it.
7. Shorten vague or contradictory guidance and state the intended scope explicitly.
