---
name: multi-commit
description: Use when the user asks to organize current workspace changes into multiple coherent local commits autonomously, with exact staging, proportionate validation, and Conventional Commit messages in English.
---
# Multiple semantic commits

Inspect the current worktree, choose the most coherent commit split, and create the local commits without making the user manage the process.

## Autonomy contract

- Invoking this workflow authorizes inspecting all current changes, reorganizing the Git index as needed, staging exact files or hunks, and creating the resulting local commits.
- Do not ask the user to approve the plan, number of commits, grouping, order, scopes, messages, staging, or each individual commit.
- Resolve routine uncertainty by inspecting the diff, surrounding code, repository conventions, tests, and dependencies.
- Ask a focused question only when a material ambiguity remains after inspection and choosing incorrectly could mix unrelated ownership, expose sensitive data, lose work, or produce a meaningfully wrong history.
- Do not push, create a branch, merge, rebase, amend, or rewrite existing commits unless separately requested.
- Never discard working-tree content. Preserve all changes, including pre-existing staged changes, while reorganizing them into the appropriate commits.
- If the worktree has no committable changes, report that and stop without creating an empty commit.

## Procedure

### 1. Understand the complete change set

Inspect at least:

```text
git status --short
git diff --stat
git diff
git diff --cached --stat
git diff --cached
```

Inspect untracked files deliberately. Read relevant surrounding code, tests, manifests, and project instructions when the diff alone does not explain intent.

Determine:

- the distinct user-facing or technical intentions;
- implementation, tests, documentation, and configuration that belong together;
- dependency order between groups;
- mixed files that require hunk-level separation;
- generated artifacts, secrets, or unrelated changes that must not enter a commit.

### 2. Choose the split autonomously

Create the smallest useful set of cohesive commits. Each commit should represent one understandable intention and, when practical, leave the repository in a valid state.

Do not split tightly coupled implementation and tests. Do not create tiny commits merely because files differ. Do not combine unrelated fixes merely because they are in the same file.

Choose English Conventional Commit messages using the repository's existing style. Use a scope only when it improves clarity.

### 3. Validate and commit

Reorganize the index non-destructively when necessary, then process groups in dependency order:

1. Run the narrowest useful validation for the group or the integrated worktree.
2. Stage exactly the intended files or hunks.
3. Inspect `git diff --cached --stat` and `git diff --cached`.
4. Correct the index yourself if it contains content from another group.
5. Create the commit.
6. Verify the remaining worktree and continue immediately with the next group.

Do not pause for confirmation between these steps or commits.

If a validation fails, determine whether the failure was caused by the current changes. Fix it when that is within the requested work; otherwise preserve the changes, avoid making a knowingly invalid commit when material, and report the concrete blocker.

### 4. Verify the result

Run:

```text
git log --oneline -n <created-count>
git status --short
```

Confirm that every intended change was committed once, no content was lost, no unrelated content entered a commit, and any remaining worktree changes are understood.

## Completion report

Report concisely:

- each created hash and message;
- the intent covered by each commit;
- validation run and its result;
- any remaining changes or blocker;
- confirmation that nothing was pushed.
