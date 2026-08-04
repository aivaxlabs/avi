---
name: create-workflow
description: Use when the user asks to create or update a reusable Avi workflow. Decide project or global scope, define the workflow contract, write a focused procedure file, and validate discovery via the / selector.
---
# Create a workflow

Create or update a reusable task procedure stored as one Markdown file that users can select explicitly from the `/` composer.

Use a workflow for a focused operation with a clear sequence and output contract. Use a skill instead when the capability needs several reference files, reusable scripts, examples, or assets. Use instructions for durable rules that should apply without explicit selection.

## Required skill

This workflow depends on the [agent-customization skill](../skills/agent-customization/SKILL.md). Read it and its [workflows reference](../skills/agent-customization/references/workflows.md) before proceeding. Do not continue without reading them.

The skill is authoritative for supported locations, frontmatter, naming, invocation, authoring principles, and validation. This workflow adds only scope selection and contract definition.

## Inputs

Infer from the conversation and repository when possible:

- the task or procedure the user wants to make repeatable;
- expected inputs and outputs;
- whether the workflow is read-only or mutating;
- relevant commands, tools, or constraints;
- optional destination path.

Ask only when the procedure's goal or expected result is ambiguous and a wrong assumption would produce a workflow that does the wrong thing.

## Scope decision

Choose between project and user-global scope deliberately, and state the reason in the completion report.

Decision questions, in order:

1. Does the procedure reference this repository's commands, structure, or conventions? If yes, use project scope.
2. Would this procedure be useful unchanged in a different project? If yes, use global scope.
3. Is it a personal habit or cross-project standard? If yes, use global scope.

When still ambiguous, prefer project scope because it is the narrower default. An explicit user-provided path always wins.

## Procedure

### 1. Inspect existing context

Check the target scope for existing workflows with the same or similar name to avoid collisions. Read applicable instructions and skills that the new workflow should reference or respect.

### 2. Define the workflow contract

Before writing, clarify:

- one clear objective;
- expected inputs from the user;
- whether the default is read-only or mutating;
- the output or completion criteria;
- validation steps proportionate to the risk.

If the procedure is too broad for one workflow, split it into focused workflows or suggest a skill instead.

### 3. Write the workflow

Follow the template and authoring principles from the agent-customization skill's workflows reference.

### 4. Validate

Follow the validation and troubleshooting guidance from the workflows reference.

## Completion report

Report:

- workflow name, scope, and path;
- why the chosen scope is correct;
- the objective and expected invocation;
- validation actually performed;
- any limitations or assumptions.
