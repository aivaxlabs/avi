---
name: learn-skill
description: Use when the user asks Avi to research a subject and persist the result as a new or updated reusable skill. Choose project or global scope, write SKILL.md with grounded references, record source provenance and freshness, and validate discovery.
---
# Learn a skill

Research a technology, library, framework, protocol, tool, API, or concept and turn the result into a durable Avi skill.

Do not use this workflow for a one-off explanation when the user did not request persistent skill files.

## Inputs

Infer from the conversation and repository when possible:

- topic and intended outcome;
- target audience and expected prior knowledge;
- relevant version, language, runtime, platform, or deployment constraints;
- whether to create, refresh, correct, or expand a skill;
- optional destination path.

Ask only when a missing answer would materially change the skill.

## Destination

Use this order:

1. An explicit user-provided path.
2. `$PWD/.agents/skills/<skill-slug>` for repository-specific knowledge, pinned versions, architecture, or internal conventions.
3. `$HOME/.agents/skills/<skill-slug>` for knowledge reusable across unrelated projects.

Do not write project skills to `.github/skills`, `.claude/skills`, `$PWD/skills`, or a normal `$PWD/context/skills` directory. The `context/skills` path is reserved for skills distributed with the Avi installation.

Use a short lowercase kebab-case slug. Keep the directory and frontmatter `name` identical.

## Output contract

Create at least:

```text
<skill-slug>/
├── SKILL.md
└── references/
    ├── README.md
    ├── overview.md
    └── sources.md
```

Rename `overview.md` to a more precise topic name when useful. Add `patterns.md`, `pitfalls.md`, `troubleshooting.md`, `version-notes.md`, `examples/`, `scripts/`, or `assets/` only when they add real operational value.

`SKILL.md` must be concise and executable. Put detailed explanation, research notes, long examples, and provenance in `references/`.

## Research rules

1. Prefer official documentation, specifications, source repositories, tests, changelogs, release notes, standards, and primary research.
2. Never invent APIs, flags, versions, limits, benchmarks, or behavior.
3. Record the research date and applicable version or version range for changing topics.
4. Synthesize original notes; do not copy substantial source text.
5. Separate verified facts, recommendations, inferences, context-dependent advice, and unresolved conflicts.
6. Preserve useful existing skill content and user-authored conventions when updating.
7. Do not install software, use credentials, change system configuration, or run destructive commands merely to research a skill.

## Procedure

### 1. Inspect local context

For project-specific topics, read:

- manifests and lockfiles;
- actual usage in source, configuration, and tests;
- applicable `AGENTS.md` files;
- existing skills and project documentation.

Treat the project's pinned version and observed usage as stronger context than generic examples.

### 2. Define a focused research checklist

Cover only relevant dimensions, such as:

- purpose and mental model;
- prerequisites and minimal setup;
- core APIs, commands, or workflow;
- important decisions and trade-offs;
- integration patterns;
- security, privacy, performance, compatibility, and reliability;
- testing, debugging, and troubleshooting;
- common mistakes and version-specific behavior.

Split an overly broad topic into a focused skill or small family rather than creating an encyclopedia.

### 3. Research authoritative sources

Use available web, URL-reading, repository, and local inspection tools. Prefer primary sources. When sources conflict, document the conflict and favor the source closest to the applicable implementation or standard.

In `references/sources.md`, record for each substantive source:

- title and publisher or maintainer;
- URL or stable identifier;
- version or publication date when relevant;
- access date;
- claims or sections it supports.

One authoritative source is better than several weak sources.

### 4. Write the skill

Use only Avi-supported frontmatter:

```yaml
---
name: skill-slug
description: Use when working with the exact topic, tasks, and trigger terms this skill covers.
---
```

The body should normally contain:

- purpose and when to use it;
- prerequisites or inputs;
- default procedure;
- decision rules;
- safety and correctness constraints;
- validation checklist;
- a map of relative links to relevant files under `references/`.

Do not add `disable-model-invocation`, `context-embeddable`, `agent`, `model`, `tools`, or hooks. Use `user-invocable: false` only when the user explicitly wants the skill hidden from the `$` selector; it remains discoverable in the model catalog.

### 5. Add examples or scripts only when valuable

Examples must be minimal, version-appropriate, and internally consistent. Run or validate them when safe and practical; otherwise mark them unverified.

Scripts must have safe defaults, narrow scope, clear prerequisites, and useful errors. A script does not bypass Avi's tool or approval rules.

### 6. Validate

Confirm that:

- the destination and scope are correct;
- `SKILL.md` is named exactly and its `name` matches the directory;
- the description contains concrete trigger terms;
- every relative reference exists;
- examples contain no invented or unexplained API;
- changing claims include version and freshness context;
- `sources.md` supports substantive external claims;
- no secret, private data, cache, or dependency directory was added;
- the skill appears in Settings → Context management and under `$` in the intended project.

Do not claim the model's permanent knowledge changed. The durable result is the created skill and its files.

## Completion report

Report:

- skill name and exact path;
- why the scope is project-local or user-global;
- researched version or scope and research date;
- key files created or updated;
- validation actually performed;
- uncertainties, unverified examples, or maintenance notes.
