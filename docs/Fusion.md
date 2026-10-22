# Fusion

Fusion is a model router mode that pairs two models. The **lead** is a frontier model that talks to you, plans, decides, and reviews. The **sidekick** is a cost-effective model that executes the work the lead delegates. The lead keeps the intelligent work; the sidekick takes the laborious work.

## Creating a Fusion router

Open **Settings → Routers**, add a router, and choose **Fusion** as the routing mode. Select:

- **Lead model** and its reasoning effort;
- **Sidekick model** and its reasoning effort.

Both use the same model and reasoning pickers as **Settings → Models**. Each effort is fixed in the router, so the composer shows no reasoning selector for a Fusion router. The router catalog entry advertises the lead model's capabilities and context limits, because the sidekick receives only text briefs. Fusion routers cannot contain other routers, and the lead and sidekick may be the same model.

## How a Fusion conversation runs

Select the Fusion router in the composer like any other model. The conversation runs on the lead model.

- The lead receives the `dispatch_sidekick` tool instead of `chat_spawn_subagent` and `chat_create_thread`. `dispatch_sidekick` accepts only a `brief` and starts the sidekick model with the router's sidekick reasoning effort as an ordinary sub-agent thread that reports back automatically.
- The lead delegates by verifiable milestones. Each milestone ends in a state the lead can check itself, such as a successful build, a passing test, or a complete coherent unit. The brief shares the overall plan for context but authorizes only the current milestone. The lead sizes milestones by risk: one brief for small, well-defined work and smaller milestones for risky or ambiguous work.
- After each milestone, the lead inspects the changed files and validation itself, then sends the next milestone or corrections to the same sidekick through `chat_send_prompt`, so it keeps its context and cache.
- The lead makes pointwise adjustments itself, such as changing a few lines in a known place or applying a fix it has already identified, because a sidekick would cost a new thread, a brief, and a review.
- The lead may run several sidekicks in parallel for independent work with disjoint file scopes.
- Sidekicks are told to report changed files, validation, deviations, and blockers concisely, without diffs or file contents. The lead inspects the changed files itself.
- By default the lead is skeptical of sidekick work and validates it before accepting it. It does not redo sidekick work: it returns defects to the sidekick and takes over a milestone only after repeated failure on it.

## Permissions

Permissions come only from the lead conversation. Sidekicks cannot use `ask_question` or create threads or sub-agents. A sidekick sends questions, permission needs, and blockers to the lead with `chat_send_prompt`, and the lead resolves pending sidekick approvals with `chat_approve_tool_call` or asks you, exactly as with ordinary sub-agents.

## Ultra and Plan modes

With Ultra, the lead applies Ultra's maximum quality standards and scope discipline without Ultra's sub-agent team: it delegates in smaller milestones, inspects each one more rigorously, and is maximally skeptical of every sidekick result, while still leaving execution to the sidekick. Sidekicks never become Ultra specialists.

In Plan mode the lead may dispatch read-only sidekicks for focused lookups and consolidation, but keeps the exploration that shapes the plan.

## Instructions by role

Avi injects delegation instructions by role instead of keeping them in the base instructions:

| Role | Delegation instructions |
| --- | --- |
| Main (default) | Execute directly and use sub-agents for independent supporting work. |
| Ultra | Ultra orchestrator contract with an independent-critique team. |
| Fusion lead | Lead contract with `dispatch_sidekick`, brief, review, and permission rules. |
| Ultra + Fusion | Lead contract plus Ultra's maximum rigor, without team delegation. |
| Fusion sidekick | Sidekick contract: follow the brief, escalate to the lead, report concisely. |

Sub-agents, side chats, and Quick Chat receive no delegation instructions.

## Bots

Bots cannot use Fusion routers. Creating or updating a bot with a Fusion router is rejected, Fusion routers are hidden from the bot model picker, and a router used by a bot cannot be changed to Fusion.
