---
name: multi-commit
description: Use when the user asks to split current workspace changes into multiple local semantic commits, with an approved grouping plan, exact staging, validation, and Conventional Commit messages in English.
---
# Multiple semantic commits

Organize current changes into cohesive local commits without mixing unrelated user work.

## Safety contract

- This workflow authorizes local commits only after the user confirms the proposed groups.
- Do not push, create a branch, rebase, merge, amend, or rewrite existing history unless separately requested.
- Preserve pre-existing staged changes. Do not unstage, restore, discard, or delete them silently.
- Group by intent and hunk, not only by filename. A mixed file may require careful patch staging or user direction.
- Do not claim a commit is valid unless the relevant checks actually ran successfully.

## Procedure

### 1. Inspect all change states

Run read-only Git checks such as:

```text
git status --short
git diff --stat
git diff
git diff --cached
```

Inspect untracked files deliberately. Do not assume generated, ignored, or unfamiliar files belong to the requested work.

Identify:

- staged changes that existed before this workflow;
- unstaged and untracked changes;
- files containing more than one logical change;
- dependencies between changes that constrain commit order;
- changes that should not be committed.

### 2. Build the commit plan

For each proposed commit, list:

- purpose and category;
- exact files or hunks;
- dependencies and intended order;
- relevant validation;
- proposed English message in `type(scope): concise description` form.

Keep each commit independently understandable and buildable when practical. Do not split tightly coupled implementation and tests merely to increase the number of commits.

Call out ambiguous or mixed files explicitly. If existing staged changes cannot safely be incorporated or separated, pause for user direction.

### 3. Obtain confirmation

Present the complete plan before staging new changes or committing. Wait for the user's actual confirmation. If the user revises a group, update the plan before proceeding.

### 4. Validate and create each commit

For each approved group, in dependency order:

1. Run the narrowest relevant validation against the working tree.
2. Stage the exact approved files or hunks with `git add -- <paths>` or a safe patch-staging method.
3. Inspect `git diff --cached --stat` and `git diff --cached`.
4. Confirm the index contains only that group, including any pre-existing staged content intentionally assigned to it.
5. Create the commit with `git commit -m "<message>"`.
6. Record the resulting hash and verify the remaining working tree with `git status --short`.

The order is always **stage, inspect, then commit**.

If validation fails, stop before committing that group. Fix only when the user requested implementation; otherwise report the blocker and preserve the working tree.

### 5. Final verification

Run:

```text
git log --oneline -n <created-count>
git status --short
```

Verify that no approved change was omitted, no unrelated change entered a commit, and no unrequested staged state was lost.

## Commit message rules

- Use English Conventional Commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, or another established project type.
- Use a meaningful scope only when it improves clarity.
- Keep the subject imperative, concise, and normally at most 72 characters.
- Describe the reason in a body when the change, migration, risk, or trade-off is not obvious.

## Completion report

List:

- each created hash and message;
- the files or intent included in each commit;
- validation run and its result;
- remaining unstaged, staged, or untracked changes;
- confirmation that nothing was pushed.

If there are no changes, report that and stop without creating an empty commit.
