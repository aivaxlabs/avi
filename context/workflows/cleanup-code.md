---
name: cleanup-code
description: Use after a coding session to remove task-related noise, organize imports, run project formatting and validation, and leave the relevant diff ready for review without staging or committing unless requested.
---
# Code cleanup

Clean the changes from the current coding task without altering unrelated user work.

## Default behavior

- Inspect and modify only files or hunks that belong to the task being cleaned up.
- Treat pre-existing changes as user-owned.
- Do not stage, commit, discard, restore, or delete user changes unless the user explicitly asks.
- Do not run repository-wide auto-fixes when they could rewrite unrelated files; prefer the narrowest supported target.
- Infer the stack and standard commands from project files and instructions before asking the user.

## Procedure

### 1. Establish scope

1. Read applicable `AGENTS.md` files and project documentation.
2. Inspect `git status --short`, the relevant unstaged diff, and the staged diff.
3. Separate task changes from pre-existing or unrelated work.
4. Identify the repository's formatter, linter, typecheck, build, and test commands from manifests and scripts.

If ownership of a mixed change cannot be determined safely, leave it untouched and report the ambiguity.

### 2. Remove task-related noise

Check the affected files for:

- temporary logs, prints, breakpoints, and debug flags;
- generated files, caches, local artifacts, or editor files created by the task;
- unused imports and code made obsolete by the change;
- explanatory or redundant comments;
- unintended TODO/FIXME markers;
- accidental secrets, tokens, private URLs, or sensitive data.

Delete or revert only artifacts known to come from the current task. Update `.gitignore` only when the new pattern is genuinely project-wide and requested by the task.

### 3. Simplify the implementation

Review the affected code for:

- unnecessary abstractions or helpers used only once;
- duplicated new logic that should reuse an established pattern;
- excessive fallbacks or speculative branches;
- inconsistent naming or imports;
- accidental refactors outside the requested behavior.

Prefer the smallest coherent implementation. Do not refactor existing code merely to make the diff look cleaner.

### 4. Format and lint narrowly

1. Use repository-defined commands rather than guessing a tool.
2. Target changed files or the smallest supported scope.
3. Apply automatic fixes only after confirming they will not rewrite unrelated work.
4. Review the diff immediately after each mutating command.

If the project has no formatter or linter command, follow adjacent code style instead of introducing new tooling.

### 5. Validate proportionately

Run, in order when relevant:

1. the narrowest test that exercises the changed behavior;
2. syntax, typecheck, or lint for affected files;
3. the relevant package or project test suite;
4. a build or runtime smoke check when it adds useful confidence.

Do not fix unrelated failures. Record the command, result, and whether a failure predates or lies outside the task.

### 6. Review the final diff

Confirm that:

- every remaining change serves the requested task;
- no debug code, temporary file, secret, or unrelated formatting remains;
- error and edge-case handling are proportionate;
- documentation changed only when behavior or usage changed;
- validation evidence matches the claimed result.

Use `git diff --check` when appropriate to catch whitespace errors.

### 7. Stage or commit only when requested

Cleanup does not imply Git publication work. If the user explicitly asks to prepare or create commits:

1. present the intended groups first;
2. preserve any pre-existing staged changes;
3. stage exact files or hunks only after approval;
4. verify `git diff --cached` before committing;
5. never push unless separately requested.

## Completion report

Report:

- what was cleaned and where;
- formatter, lint, test, build, or runtime checks actually run;
- their results;
- unrelated changes deliberately preserved;
- any remaining limitation or unverified step.
