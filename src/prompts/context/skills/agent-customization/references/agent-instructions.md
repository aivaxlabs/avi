# Writing effective Avi instructions

Instructions are durable Markdown guidance that applies to work in a user, project, or directory scope. Prefer `AGENTS.md` for new instructions.

## When to use

Use instructions for:

- build, test, formatting, and validation commands;
- architecture boundaries and repository-specific conventions;
- safety requirements and prohibited operations;
- language or framework rules used throughout a directory tree;
- team preferences that should apply to many tasks.

Do not use instructions for a one-off task, a long tutorial, static copies of existing documentation, or runtime access to an external service. Use a workflow, skill, link to project documentation, or MCP instead.

## Recommended locations

| Scope | Path |
|---|---|
| User-global | `$HOME/.agents/AGENTS.md` |
| Entire project | `$PWD/AGENTS.md` |
| One project subtree | `<subdirectory>/AGENTS.md` |

A deeper `AGENTS.md` conventionally applies to that directory and its descendants. Avi catalogs nested instruction files with their paths; the agent must read and apply the relevant file. Use this hierarchy instead of an `applyTo` glob, which Avi does not implement.

## Template

```markdown
# Project instructions

## Architecture
- Keep domain logic in `src/domain/`.
- Use `src/adapters/` only for external-system boundaries.

## Commands
- Install dependencies with `bun install`.
- Run focused tests with `bun test <path>`.
- Run the production build with `bun run build`.

## Conventions
- Follow the patterns in `src/example.js` for new handlers.
- Do not edit generated files under `dist/`.

## Validation
- Run the narrowest affected test first.
- Report unrelated failures separately.
```

Only include sections the scope actually needs.

## Authoring rules

1. **Make every rule actionable.** State what to do, when to do it, and any important exception.
2. **Keep the scope honest.** Put a rule in the narrowest directory where it consistently applies.
3. **Prefer repository evidence.** Reference exact files and supported commands instead of generic best practices.
4. **Avoid duplication.** Link to `CONTRIBUTING.md`, architecture docs, or runbooks when the agent only needs to know where authoritative detail lives.
5. **Document non-obvious constraints.** Prioritize rules an agent could not infer safely from code and tooling.
6. **Keep it current.** Remove stale commands and conventions when the project changes.

## Anti-patterns

- One global file containing unrelated rules for every technology.
- Repeating the README or dependency manifest.
- Rules already enforced completely by a formatter or linter, unless the required command is non-obvious.
- Instructions that authorize deployment, publication, destructive actions, or credential use without an explicit user request.
- Editor-specific fields or paths such as `applyTo`, `.github/instructions`, prompts, hooks, or custom agents.

## Validation

- Open Settings → Context management and confirm that Avi lists the file.
- For a root file, verify its contents appear in the next conversation's runtime context.
- For a nested file, verify its path and description are listed and that the agent reads it before changing files in that subtree.
- Check for contradictions with broader global or project instructions.
