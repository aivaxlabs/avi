---
name: Grill Me
description: Use when a complex task, large refactor, or new feature needs scope and design alignment before implementation through a structured interactive interview.
---
# Structured discovery interview

Do not implement the task yet. Investigate the available context, resolve material decisions with the user, and then produce an actionable plan grounded in confirmed requirements and repository evidence.

## Objective

Turn an incomplete or ambiguous request into a shared understanding of:

- the goal and expected result;
- included and excluded scope;
- technical and product decisions;
- constraints, dependencies, risks, and trade-offs;
- validation and success criteria.

Stop interviewing once the remaining uncertainty is not material to the plan. Do not prolong the process for details that can be discovered safely during implementation.

## Before asking

Inspect the relevant repository context first:

- applicable instructions and project documentation;
- architecture, technologies, configuration, and deployment constraints;
- existing code and tests for similar behavior;
- current user flow, API, data, integration, and permission boundaries;
- realistic validation methods;
- existing changes that must be preserved.

If the answer is safely established by evidence, record it as a finding instead of asking the user. Ask only when a wrong assumption would materially change behavior, architecture, scope, data, UX, risk, or cost.

## Interview rules

1. Ask one focused question at a time.
2. Resolve prerequisite decisions before dependent or late-stage details.
3. Briefly state the current understanding and relevant evidence.
4. Explain why the pending decision matters.
5. Provide a recommended answer and its practical rationale.
6. Offer alternatives only when they represent meaningful choices.
7. Surface contradictions and hidden risks before proceeding.
8. Do not produce the final plan while a material decision remains open.

When `ask_question` is available:

- use `single_choice` for one decision with up to three concrete options;
- use `multiple_choice` only when several listed choices may apply together;
- use `free_text` when the answer is open-ended or the option space cannot be represented honestly;
- never invent the user's answer or add a fake “Other” option in place of `free_text`.

If the tool is unavailable, ask the same focused question directly in chat.

## Question format

Keep each turn compact:

1. **Current understanding** — what is already established.
2. **Evidence** — the relevant repository finding, or that evidence is insufficient.
3. **Pending decision** — what must be decided and what it unlocks.
4. **Recommendation** — the preferred choice and why.
5. **Question** — one objective question.

Put the recommended choice first when options are used. State the practical effect of each option and clearly identify unsafe or technically weak trade-offs.

## Topics to cover when relevant

- primary goal, audience, and expected outcome;
- current and desired flows;
- included and excluded scope;
- compatibility and migration requirements;
- architecture, data, integrations, permissions, and external dependencies;
- security, privacy, legal, operational, time, or budget constraints;
- edge cases, error states, and degraded behavior;
- testing, validation, rollout, and failure criteria;
- explicit user preferences and decisions imposed by existing code.

Do not force every topic into every interview.

## Handling uncertainty and disagreement

- Keep hypotheses explicit.
- If several materially different interpretations remain, ask which one is intended.
- If the user does not know, recommend the safest reasonable option and ask for confirmation.
- If a choice carries avoidable technical risk, explain it kindly and propose the better alternative.
- If the user confirms the risk, record the accepted trade-off and continue.
- If the request, repository evidence, and answers conflict, pause and realign before planning.

## Completion

Once all material decisions are confirmed, produce a plan containing:

1. objective and expected result;
2. final scope and out-of-scope items;
3. relevant repository evidence;
4. confirmed requirements and constraints;
5. decisions and accepted trade-offs;
6. risks and mitigations;
7. ordered implementation steps;
8. validation strategy and success criteria;
9. remaining assumptions or external blockers, if any.

Emit the completed plan as exactly one non-empty `<execution-plan>...</execution-plan>` block. Include a dedicated decisions section that records every confirmed decision, its rationale, and any accepted trade-off from the interview. Avi automatically writes that block to `.agents/plannings/<timestamp>/<conversation-title>.md` in the current workspace; do not create a second planning file manually. If formal Plan mode is active, also follow its complete output contract.
