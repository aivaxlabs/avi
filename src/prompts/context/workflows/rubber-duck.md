---
name: rubber-duck
description: Use when the user asks to rubber-duck an idea, plan, design, or decision. Run a rubber-duck analysis, present the critique and key points to the user, and propose a plan without implementing anything.
---
# Rubber duck

Scrutinize the user's idea or plan through a rubber-duck analysis and return the critique for the user to decide on. This workflow only analyzes and proposes; it never acts on the report by itself.

## Procedure

1. Collect from the conversation the idea, plan, design, or decision to scrutinize, plus the relevant constraints and context. Ask the user only when something essential is missing.
2. Invoke the `invoke_rubber_duck` tool with that material and let it run its bounded dialogue. Do not paraphrase intermediate turns back to the user while it works.
3. Present the result to the user:
   - a short summary of the dialogue's strongest objections, risks, and open questions;
   - the concrete points worth addressing, ordered by impact;
   - what survived the critique unchanged.
4. Propose a revised plan that addresses the critique. Present every item as a suggestion.
5. Stop and wait for the user's decision.

## Boundaries

- Do not edit files, run mutating commands, or execute any part of the plan as a consequence of the report.
- The rubber-duck dialogue is advisory evidence, not a decision. The user decides what changes.
- If the tool fails or is unavailable, say so and offer to critique the idea directly in conversation instead.
