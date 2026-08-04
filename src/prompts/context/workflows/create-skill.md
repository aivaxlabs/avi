---
name: create-skill
description: Use when the user asks to create, update, or persist reusable specialized knowledge as an Avi skill. Decide project or global scope, research when needed, write SKILL.md with grounded references, and validate discovery.
---
# Create a skill

Turn specialized knowledge into a durable Avi skill. The knowledge may come from research on a technology, library, framework, protocol, tool, API, or concept, or from expertise and conventions the user already provides.

Do not use this workflow for a one-off explanation. Use a workflow for a single focused procedure and instructions for durable rules; use this workflow when the knowledge benefits from references, scripts, examples, or assets.

## Required skill

This workflow depends on the [agent-customization skill](../skills/agent-customization/SKILL.md). Read it and its [skills reference](../skills/agent-customization/references/skills.md) before proceeding. Do not continue without reading them.

The skill is authoritative for supported locations, directory structure, frontmatter, naming, discovery, and validation. This workflow adds only scope selection, research discipline, and the output contract for research-backed skills.

## Inputs

Infer from the conversation and repository when possible:

- topic and intended outcome;
- target audience and expected prior knowledge;
- relevant version, language, runtime, platform, or deployment constraints;
- whether to create, refresh, correct, or expand a skill;
- optional destination path.

Ask only when a missing answer would materially change the skill.

## Scope decision

Choose between project and user-global scope deliberately, and state the reason in the completion report.

Decision questions, in order:

1. Would this skill be accurate and useful in a different project? If no, use project scope.
2. Does it depend on this repository's pinned versions, structure, or internal APIs? If yes, use project scope.
3. Is it a personal or team-wide convention that should follow the user everywhere? If yes, use global scope.

When still ambiguous, prefer project scope because it is the narrower and safer default. An explicit user-provided path always wins.

## Research rules

Apply these when the skill requires external or not-yet-known information:

1. Prefer official documentation, specifications, source repositories, tests, changelogs, release notes, standards, and primary research.
2. Never invent APIs, flags, versions, limits, benchmarks, or behavior.
3. Record the research date and applicable version or version range for changing topics.
4. Synthesize original notes; do not copy substantial source text.
5. Separate verified facts, recommendations, inferences, context-dependent advice, and unresolved conflicts.
6. Preserve useful existing skill content and user-authored conventions when updating.
7. Do not install software, use credentials, change system configuration, or run destructive commands merely to research a skill.

When the knowledge comes entirely from the user or the current workspace, skip external research and ground the skill in the provided information and repository evidence instead.

## Procedure

### 1. Inspect local context

For project-specific topics, read manifests, lockfiles, actual usage in source, configuration, tests, applicable instructions, and existing skills. Treat the project's pinned version and observed usage as stronger context than generic examples.

### 2. Define a focused checklist

Cover only relevant dimensions, such as purpose and mental model, prerequisites, core APIs or commands, important decisions and trade-offs, integration patterns, security, testing, and common mistakes. Split an overly broad topic into a focused skill or small family rather than creating an encyclopedia.

### 3. Research authoritative sources

Use available web, URL-reading, repository, and local inspection tools. Prefer primary sources. When sources conflict, document the conflict and favor the source closest to the applicable implementation or standard.

In `references/sources.md`, record for each substantive source: title and publisher, URL or stable identifier, version or publication date, access date, and which claims it supports. One authoritative source is better than several weak sources.

### 4. Write the skill

Follow the structure, frontmatter, and authoring principles from the agent-customization skill's skills reference. Keep `SKILL.md` concise and executable; put detailed explanation, research notes, long examples, and provenance in `references/`.

### 5. Validate

Follow the validation and troubleshooting guidance from the skills reference. Additionally confirm that examples contain no invented APIs, changing claims include version and freshness context, and `sources.md` supports substantive external claims.

## Completion report

Report:

- skill name, scope, and path;
- why the chosen scope is correct;
- research sources and their freshness, when applicable;
- validation actually performed;
- any limitations, unresolved conflicts, or unverified claims.
