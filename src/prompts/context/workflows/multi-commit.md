---
name: multi-commit
description: Use when the user asks to organize current workspace changes into multiple coherent local commits autonomously, grouping by intent and writing Conventional Commit messages in English. Stage and commit directly; this is not a review.
---
# Multiple semantic commits

Inspect the worktree once, choose the most coherent commit split, and create the local commits. This workflow stages and commits; it does not review, validate, or re-inspect the changes.

## Autonomy contract

- Invoking this workflow authorizes staging the current changes and creating the resulting local commits.
- Do not ask the user to approve the plan, number of commits, grouping, order, messages, staging, or individual commits.
- Resolve routine uncertainty by inspecting the diff and the surrounding code.
- Ask a focused question only when a material ambiguity remains after inspection and choosing incorrectly could mix unrelated ownership, expose sensitive data, or lose work.
- Do not push, branch, merge, rebase, amend, or rewrite existing commits unless separately requested.
- Never discard working-tree content; fold pre-existing staged changes into the appropriate commit.
- Never stage `.env`, `.env.*`, `appservice.ini`, credentials, or secrets. Leave them out and mention it in the report.
- If the worktree has no committable changes, report that and stop.

## Procedure

1. Inspect once, in a single batched call:

   ```text
   git status --short && git diff --stat && git diff --cached --stat
   ```

   Read the full `git diff` or untracked file contents only when the stat output is not enough to decide grouping or a message.

2. Group by intent. One commit per user-facing or technical intention; keep tightly coupled implementation, tests, and docs together. Avoid micro-commits; avoid mixing unrelated fixes. Prefer grouping a file with its dominant concern over hunk-level index surgery.

3. Commit each group in a single chained call:

   ```text
   git add <paths> && git commit -m "<type>(<scope>): <subject>"
   ```

   English Conventional Commit messages following the repository's existing style. Do not re-inspect the index, run builds, tests, or linters, or pause between commits. If the user asked for validation, run it once at the end, not per commit.

4. Finish with one batched check:

   ```text
   git log --oneline -n <created-count> && git status --short
   ```

## Execution budget

Expect roughly 1 inspection call, N commit calls, and 1 final check for N commits. If the run needs materially more calls, simplify the split instead of adding steps.

## Completion report

- each created hash and message;
- any left-over changes and why;
- confirmation that nothing was pushed.
