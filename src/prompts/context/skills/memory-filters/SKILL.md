---
name: memory-filters
description: Write precise document filters for the AIVAX memory_search tool — tags, names, content, creation and update dates, and the metadata Avi records on every memory (directory, model, thread, device). Use when a memory search needs exact constraints beyond simple search terms.
user-invocable: false
---
# Memory filters

`memory_search` accepts an optional `filter` string that restricts which memories are ranked. Use `search_terms` for meaning and `filter` for exact constraints. Only memories matching the filter are returned; when none match, the search returns no results.

Set `detailed: true` to receive a JSON array with `id`, `name`, `createdAt`, `updatedAt`, `score`, `metadata`, and `content` for each result. Use it to confirm metadata values before filtering on them, to compare dates, or to read the stored `name` before calling `memory_delete`.

## Syntax

A filter is one or more conditions `field operator value` joined by `and`, `or`, `not`, and parentheses.

- `not` binds tighter than `and`, and `and` binds tighter than `or`. Use parentheses to group explicitly.
- Keywords, operators, and field names are case-insensitive.
- Strings use double or single quotes. Escape the same quote with a backslash: `"say \"hi\""`. Supported escapes: `\"`, `\'`, `\\`, `\/`, `\n`, `\r`, `\t`, `\uXXXX`.
- Numbers use a dot as decimal separator: `10`, `-2.5`, `1e3`. Other literals: `true`, `false`, `null`, and `now` (dates only).
- Values must be literals. Functions, arithmetic, type conversions, and field-to-field comparisons are not supported.

## Fields and operators

| Field | `=` `!=` | `>` `>=` `<` `<=` | `contains` `startswith` `endswith` | `in` | `has` | `exists` |
| --- | --- | --- | --- | --- | --- | --- |
| `name`, `content` | text | — | text | text list | — | — |
| `tags` | — | — | — | text list | text | — |
| `createdAt`, `updatedAt` | date | date | — | — | — | — |
| `metadata.<key>` | text, number, boolean, `null` | number | text | any list | any value | ✓ |

- `name` is the stored identifier: `memory_write` normalizes the title to lowercase ASCII letters, digits, and hyphens. `Decisão de Arquitetura` is stored as `decisao-de-arquitetura`.
- `field in (a, b)` equals `field = a or field = b`. For `tags`, it matches memories with at least one listed tag.
- `has` checks list membership; `exists` checks that a metadata key is present, even with a `null` value.
- `x != v` is exactly `not x = v`. Other combinations, such as `tags = "x"` or `name > "a"`, are rejected.

## Text comparison

- Comparisons ignore case and accents. `=` and `in` ignore trailing spaces.
- `contains`, `startswith`, and `endswith` are literal; `%` and `_` are not wildcards. `contains` needs at least 3 characters.
- There is no word splitting or synonym matching; put meaning in `search_terms`.

## Avi memory metadata

Every memory written by Avi stores these metadata keys. Values are strings, or `null` when unavailable:

| Key | Value |
| --- | --- |
| `directory` | Absolute working folder of the thread that wrote the memory. |
| `model_name` | Provider model identifier used by that thread. |
| `task_title` | Thread title at write time. |
| `thread_id` | Avi thread ID; Quick Chat uses its session ID. |
| `thread_role` | `orchestrator`, `subagent`, `side_chat`, or `quick_chat`. |
| `parent_thread_id` | Parent thread ID for sub-agents and side chats. |
| `device_name` | Host name of the computer running Avi. |
| `device_id` | Stable Avi device ID of that computer. |

Rules for metadata conditions:

- Types are never converted. Every Avi key is text, so compare with quoted strings.
- A missing key never matches a positive condition, and `metadata.k != "x"` also matches memories without `k`. Add `metadata.k exists` to exclude them. Memories written before Avi recorded metadata have none of these keys.
- Windows paths contain backslashes; escape each one: `metadata.directory startswith "C:\\Code\\repo"`. Comparison ignores case but not separator style.
- Ordering operators work only on numbers in metadata. Use `createdAt` and `updatedAt` for dates.

## Dates

`createdAt` and `updatedAt` accept ISO 8601 or relative times.

- Absolute: `"2026-09-01"`, `"2026-09-01T18:30"`, `"2026-09-01T03:00:00Z"`. A date without a time means midnight. Without `Z` or an offset, the value is interpreted in America/Sao_Paulo (UTC−03:00).
- Relative: `now`, optionally followed by `+`/`-` and an amount with unit `m` (minutes), `h`, `d`, `w`, `mo` (calendar months), or `y`.
- Formats such as `15/06/2025` are rejected.

## Limits

- 2,048 characters and 32 conditions per filter; 8 levels of parentheses or `not`; 100 values per `in` list.
- Text values and metadata keys up to 256 characters; up to 8 keys in a metadata path.
- A filter must finish within 10 seconds. Prefer selective conditions on `name`, tags, and dates over broad `content contains`.

## Examples

| Goal | Filter |
| --- | --- |
| Decisions from the last week | `tags has "decision" and updatedAt >= now-7d` |
| Memories about one project folder | `metadata.directory startswith "C:\\Code\\repos\\avi-desktop"` |
| Written on one computer | `metadata.device_id = "<device id>"` |
| Written by sub-agents of one orchestrator | `metadata.parent_thread_id = "<thread id>"` |
| Written by one thread | `metadata.thread_id = "<thread id>"` |
| Written by a model family | `metadata.model_name startswith "claude"` |
| One memory by title | `name = "decisao-de-arquitetura"` |
| A family of memories | `name startswith "release-notes-"` |
| Exclude drafts, current month | `not tags has "draft" and createdAt >= "2026-10-01"` |
| Memories without Avi metadata | `not metadata.thread_id exists` |
| Combined | `(tags has "bug" or content contains "regression") and metadata.thread_role in ("orchestrator", "subagent")` |

## Common mistakes

| Instead of | Write |
| --- | --- |
| `name == "x"` | `name = "x"` |
| `tags = "x"` | `tags has "x"` |
| `metadata.directory = "C:\Code"` | `metadata.directory = "C:\\Code"` |
| `metadata.created >= "2026-06-15"` | `createdAt >= "2026-06-15"` |
| `createdAt >= "15/06/2025"` | `createdAt >= "2025-06-15"` |
| `content contains "ai"` | A term with at least 3 characters |
| `name = "Decisão de Arquitetura"` | `name = "decisao-de-arquitetura"` |

An invalid filter returns the API error with the problem and character position, such as `Invalid filter: Unknown field 'author'. ... (at 0)`. Fix the reported part and retry.

Full reference: https://docs.aivax.net/docs/filters/document-filters
