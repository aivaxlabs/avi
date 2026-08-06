---
name: create-instruction
description: Use when the user asks to create or update a focused instruction file or rule set for Avi. Decide project, subdirectory, or global scope, write grounded AGENTS.md content, and validate discovery. Not for initializing an entire project's instruction hierarchy—use /init for that.
---
# Create an instruction

Create or update a focused instruction file that durably guides agent work in a user, project, or directory scope.
Use this workflow when the user has a specific rule, convention, or set of guidance to persist.

## Required skill

This workflow depends on the [agent-customization skill](../skills/agent-customization/SKILL.md). Read it, its [writing effective instructions](../skills/agent-customization/references/agent-instructions.md) reference, and its [instruction discovery](../skills/agent-customization/references/instructions.md) reference before proceeding. Do not continue without reading them.

The skill is authoritative for supported locations, file naming, frontmatter, hierarchy, authoring rules, anti-patterns, and validation. This workflow adds only scope selection, grounding discipline, and conflict detection.

## Inputs

Infer from the conversation and repository when possible:

- the rule, convention, or guidance the user wants persisted;
- the scope where it should apply (user-global, project root, or subdirectory);
- whether to create a new file or update an existing one;
- relevant commands, paths, or constraints mentioned.

Ask only when the intended scope or the rule itself is ambiguous and a wrong assumption would produce guidance that misfires.

## Scope decision

Choose the narrowest scope where the rule consistently applies, and state the reason in the completion report.

Decision questions, in order:

1. Does this rule reference this repository's structure, commands, or conventions? If yes, it belongs in project scope.
2. Does it apply to the entire project or only a subtree? If only a subtree, place it in that subdirectory.
3. Is it a personal preference or convention that should follow the user regardless of project? If yes, use global scope.

When still ambiguous, prefer project scope over global scope, and subdirectory scope over project root. Narrower scope is safer because it cannot misfire in unrelated contexts.

## Grounding rules

- Derive claims from the current workspace: manifests, lockfiles, source, configuration, tests, CI, and maintained documentation.
- Never invent commands, architecture, conventions, or paths.
- Use exact repository-relative paths and command names.
- Document non-obvious constraints an agent could not infer safely from file names alone.
- Do not include secrets, credential values, private user paths, or machine-specific state.

## Procedure

### 1. Inspect existing context

Read existing instruction files at and around the target scope. Check for rules that duplicate, contradict, or already cover the requested guidance. If the rule already exists in a suitable file, update that file rather than creating a new one.

### 2. Decide placement

Based on the scope decision above, determine the exact file path. If updating an existing file, identify where the new rule fits structurally.

### 3. Decide whether to embed a root instruction

Root instruction files are embedded in the system instructions by default. Add `embeddable: false` to the front matter only when the root instruction is optional or specialized and should remain available for the agent to discover and read without consuming context on every turn. Include a clear `description` so the available-context catalog explains when the agent should read it.

Do not add `embeddable` to nested instructions, skills, or workflows. Nested instructions are already cataloged instead of embedded, and skills and workflows use their own discovery behavior.

### 4. Write the instruction

Follow the authoring rules and anti-patterns from the agent-customization skill's instructions references.

### 5. Validate

Follow the validation guidance from the instructions references. For a root instruction with `embeddable: false`, confirm that its path and description appear in the available-context catalog and that its body is absent from the system instructions. Additionally confirm that no contradiction exists with broader or narrower instruction files and no secrets or machine-specific paths were included.

## Completion report

Report:

- file path and whether it was created or updated;
- why the chosen scope is correct;
- the rules added or modified;
- validation actually performed;
- any conflicts found and how they were resolved.
