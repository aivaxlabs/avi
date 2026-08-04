---
name: init
description: Use to initialize or improve a project's agent onboarding context by creating a grounded root AGENTS.md and focused nested AGENTS.md files for each materially distinct project area.
---
# Initialize project context

Create or improve the current project's instruction hierarchy so a new agent can understand the repository, find the right code, follow local conventions, and validate work without rediscovering the project on every task.

This workflow is mutating. It may create or update `AGENTS.md` files inside the current workspace. It does not authorize installing dependencies, changing application code, staging, committing, publishing, deploying, or writing outside the workspace.

## Required skill

Before inspecting or writing project context, read and apply the bundled [agent-customization skill](../skills/agent-customization/SKILL.md), especially its [instruction-authoring](../skills/agent-customization/references/agent-instructions.md) and [workflow](../skills/agent-customization/references/workflows.md) guidance. Treat that skill as authoritative for supported Avi primitives, locations, frontmatter, hierarchy, and validation.

This file intentionally lives at `context/workflows/init.md` in the Avi source tree because that directory is packaged as `$AVI/context/workflows`, making it an installation workflow discoverable as `/init`. Do not copy this path convention to ordinary projects; a project-local workflow belongs under `$PWD/.agents/workflows/`.

Do not replace this requirement with remembered conventions. Do not create editor-specific prompt files, hooks, custom-agent definitions, or unsupported frontmatter.

## Intended result

Produce:

1. A concise project-wide root `AGENTS.md`: create it when missing, update it when materially incomplete or inaccurate, and preserve it unchanged when it already provides sufficient onboarding context.
2. A nested `<area>/AGENTS.md` for every materially distinct project area that needs local architecture, commands, conventions, or boundaries.
3. No redundant file for a directory whose guidance is already expressed accurately by its nearest parent.

A project area is a stable subsystem, application, package, service, platform target, infrastructure boundary, or documentation/test area with meaningful local context. A top-level folder alone is not sufficient reason to create a file.

## Grounding rules

- Derive all claims from the current workspace: manifests, lockfiles, source, configuration, tests, CI, scripts, and maintained documentation.
- Inspect representative entry points, callers, adjacent patterns, and tests for each area before documenting it.
- Never invent commands, architecture, ownership, deployment steps, environment variables, or conventions.
- Use exact repository-relative paths and command names.
- Prefer links to authoritative project documentation over copying long explanations.
- Document non-obvious constraints and decisions an agent could not infer safely from file names alone.
- Do not include secrets, credential values, private user paths, machine-specific state, temporary branch details, volatile file counts, or speculative plans.
- Do not traverse or write through a symlink that resolves outside the workspace unless the user explicitly includes that target.
- Treat generated output, dependencies, caches, vendored code, worktrees, and VCS metadata as inspection exclusions unless the repository explicitly requires otherwise.

## Existing context

Treat every existing instruction file as user-owned.

- Read all applicable existing instruction files before changing anything. Avi-compatible names include `AGENTS.md`, `MEMORY.md`, `CLAUDE.md`, `GEMINI.md`, names with qualifiers such as `AGENTS.local.md`, and files ending in `.instructions.md` or `.agents.md` (case-insensitive). Prefer `AGENTS.md` for newly created project instructions.
- Preserve accurate project-specific guidance and deliberate wording.
- Resolve duplication by keeping a rule at the narrowest scope where it applies consistently.
- Do not silently remove or weaken a rule. If existing guidance conflicts with repository evidence and intent cannot be established safely, preserve it and report the conflict.
- If the existing hierarchy is already sufficient, make no cosmetic rewrite; report why no change was needed.

## Procedure

### 1. Establish the project boundary

1. Confirm the active workspace and whether it is a Git repository, monorepo, or nested repository layout.
2. Inspect working-tree status and preserve unrelated changes.
3. Locate existing instruction files, manifests, lockfiles, workspace definitions, README files, contributing guides, architecture documents, CI definitions, container files, and task scripts.
4. Identify ignored, generated, vendored, cache, and dependency directories before broader inspection.

Do not assume the workspace root is the repository root when the available evidence says otherwise. Write only inside the project the user asked to initialize.

### 2. Build an evidence-based project map

Identify:

- the project's purpose and primary deliverables;
- languages, runtimes, frameworks, package managers, and pinned versions;
- applications, services, packages, libraries, and platform-specific code;
- entry points and the main runtime or request/data flow;
- boundaries between UI, domain logic, persistence, integrations, infrastructure, and generated artifacts;
- authoritative build, development, formatting, lint, typecheck, test, packaging, and migration commands;
- where tests live and how focused validation is normally run;
- high-risk or non-obvious constraints, including external services and required execution environments.

For a large repository, use available orchestration tools to delegate read-only discovery of non-overlapping subsystems. Give each sub-agent a precise area and evidence contract, communicate follow-up questions when findings conflict, and synthesize and verify the result yourself. Keep final file ownership with the orchestrator so agents do not race on shared instructions.

### 3. Choose instruction boundaries

Create an area plan before writing. For each proposed `AGENTS.md`, record:

- directory and scope;
- why parent guidance is insufficient;
- facts and source files that support the local guidance;
- child areas it covers;
- overlap that must remain in the parent instead;
- the decision to create, update, preserve, or omit the file.

Keep this plan in working notes during execution and summarize its decisions in the completion report; do not create a separate planning artifact in the project unless the user requests one.

Create a nested file when at least one of these differs materially from its parent:

- architecture or responsibility;
- runtime, framework, or toolchain;
- commands or required execution environment;
- implementation conventions or extension patterns;
- validation strategy;
- safety, generated-code, migration, or integration boundaries.

Do not create nested files merely for:

- every source directory or namespace;
- small utility, component, or feature folders following parent conventions;
- dependency, build-output, cache, coverage, or generated directories;
- duplicated root commands and generic coding advice;
- empty or placeholder areas.

### 4. Write the root `AGENTS.md`

Keep it concise and useful as the first onboarding document. Include only supported, evidenced sections such as:

```markdown
# Project agent guide

## Project overview
- Purpose, deliverables, stack, and authoritative documentation.

## Repository map
- `path/` — responsibility and important boundary.

## Architecture and flow
- Main entry points, dependency direction, and cross-area flow.

## Commands
- Install, develop, build, format, lint, typecheck, test, and package commands that actually exist.
- State required working directory or container/runtime when material.

## Project-wide conventions
- Established patterns and important generated or protected files.

## Validation
- Narrow-to-broad checks and where focused tests live.

## Instruction map
- Links to nested `AGENTS.md` files and when each applies.
```

Adapt the headings to the project. Omit empty sections. Do not turn the root file into a full repository manual or repeat the README.

### 5. Write focused nested `AGENTS.md` files

Place each file at the highest directory where its specialized guidance applies to all descendants. Start nested files with simple supported frontmatter:

```yaml
---
description: Rules and onboarding context for the <area> subsystem.
---
```

Then include only locally relevant sections, for example:

```markdown
# <Area> agent guide

## Scope and responsibility
## Entry points and local architecture
## Established implementation patterns
## Local commands and validation
## Boundaries and files to avoid editing
## Relevant references
```

Nested guidance refines the parent. Do not restate project-wide commands or rules unless the local area changes how they must be applied.

### 6. Review the hierarchy as an onboarding path

Read the result in the order a new agent receives it: root first, then each relevant nested file. Confirm that an agent can answer, without guessing:

- What does this project and area do?
- Where should a change of this type go?
- Which entry points and adjacent examples should be inspected?
- Which boundaries or generated files must be respected?
- Which exact command validates the change?
- Which deeper instruction file applies before editing?

Remove generic advice, repeated prose, unsupported claims, and instructions already enforced transparently by tooling unless the command or constraint is non-obvious.

### 7. Validate

Perform proportionate structural validation:

1. Confirm every created file is inside the intended workspace and named exactly `AGENTS.md`.
2. Confirm every nested file has a concrete `description` using only Avi-supported frontmatter.
3. Verify referenced paths and documentation links exist.
4. Verify documented scripts against manifests, CI, or tool configuration; distinguish commands actually run from commands verified only by inspection.
5. Check that instruction scopes do not overlap unnecessarily or contradict parent guidance.
6. Review the final diff for accidental application-code changes, secrets, private paths, stale claims, and unrelated rewrites.
7. Run `git diff --check` when Git is available.
8. When the Avi UI is available, confirm discovery in Settings → Context management. Otherwise report discovery as structurally validated, not visually verified.

Do not run expensive, destructive, networked, credentialed, deployment, or AI-consuming commands merely to validate onboarding instructions. Do not install missing tools just for this workflow.

## Completion criteria

The workflow is complete when:

- the root `AGENTS.md` accurately orients an agent to the whole project;
- each identified material area has focused local guidance, or the repository is simple enough that the root file is demonstrably sufficient;
- every statement is grounded in inspectable project evidence;
- existing user guidance and unrelated changes are preserved;
- the final hierarchy is concise, non-duplicative, and structurally discoverable by Avi.

## Completion report

Report:

- root project path;
- files created and files updated;
- project areas identified and why each received or did not need nested instructions;
- important repository evidence used;
- validation actually performed and its result;
- preserved conflicts, uncertainties, or UI discovery steps not verified.
