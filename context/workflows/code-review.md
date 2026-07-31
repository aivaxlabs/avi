---
name: code-review
description: Use for an evidence-based, read-only review of a working tree, branch, commit range, pull request, architecture change, or deployed change. Prioritize correctness, security, maintainability, performance, compatibility, tests, and user impact.
---
# Critical code review

Act as an independent senior reviewer. Find material risks before they reach users, production, maintainers, data, security boundaries, or adjacent systems.

The default is **read-only**. Do not modify code unless the user separately asks for implementation.

## Review principles

- Inspect the requested diff first, then surrounding code and call paths in proportion to risk.
- Review beyond changed lines when contracts, callers, state, migrations, or side effects determine correctness.
- Prefer source, test, configuration, runtime, and history evidence over assumptions.
- Distinguish confirmed defects, likely risks, and unresolved investigation items.
- Prioritize impact over cosmetic style.
- Do not invent issues or broad rewrites. Recommend the smallest fix that addresses the root cause.
- Treat passing tests as evidence, not proof.

## Inputs and scope

Infer what is safely discoverable. Determine:

- target: working tree, files, branch, base branch, commit range, or pull request;
- goal and intended behavior change;
- behavior that must remain unchanged;
- whether the change is proposed, merged, deployed, or publicly released;
- relevant environment, users, systems, data, permissions, integrations, and constraints;
- available tests, specifications, tickets, or documentation.

Ask only when a missing answer blocks a meaningful review. State the exact reviewed range and material scope limits.

## Procedure

### 1. Inspect the change

1. Read applicable project instructions.
2. Check repository state and preserve unrelated user changes.
3. Inspect the diff, staged diff, commit range, or supplied files.
4. Map changed symbols to callers, consumers, tests, configuration, schemas, migrations, and public contracts.
5. Identify unintended deletions, dependency changes, generated files, or formatting noise that may hide behavior.

### 2. Build a concise risk model

Identify:

- assets at risk: data, identity, permissions, money, availability, public contracts, privacy, infrastructure, or user trust;
- actors and failure sources: users, tenants, admins, integrations, jobs, malformed input, dependencies, operators, or attackers;
- trust boundaries: browser/runtime, process, network, auth, tenant, service, database, filesystem, queue, or external API;
- entry points and side effects;
- highest-risk assumptions that require evidence.

Use only categories relevant to the change.

### 3. Segment substantial reviews

For a broad or high-risk review, divide work into non-overlapping segments such as:

- security, privacy, permissions, and abuse resistance;
- correctness, domain rules, state, migrations, and rollback;
- architecture, maintainability, coupling, and compatibility;
- performance, concurrency, resource use, and reliability;
- tests, observability, deployment safety, and product impact.

When Avi sub-agent tools are available and independent review adds value, use one focused sub-agent per segment. Give each a self-contained scope, risk context, evidence requirements, exclusions, and expected priority format. Inspect their results and synthesize them; never paste reports without judgment.

For a small review, unavailable sub-agent tooling, or segments that strongly overlap, review directly instead of manufacturing delegation. Report any resulting coverage limitation only when material.

### 4. Review material risk areas

#### Security and privacy

Check applicable risks including:

- authentication, authorization, privilege escalation, and tenant isolation;
- SQL, command, template, path, deserialization, XSS, CSRF, SSRF, redirect, CORS, and upload risks;
- secrets, credentials, PII, logs, telemetry, URLs, caches, and third parties;
- input validation, output encoding, rate limits, fraud, and abuse resistance;
- dependency, supply-chain, cryptography, token, session, and insecure-default risks.

#### Correctness and data

Check:

- domain assumptions, invariants, and state transitions;
- null, empty, duplicate, ordering, pagination, time zone, locale, currency, and precision cases;
- races, retries, idempotency, partial failure, eventual consistency, and transaction boundaries;
- schema, migration, rollback, serialization, event, API, and backward-compatibility risks;
- error states that hide failure, corrupt data, or mislead users.

#### Architecture and maintainability

Check:

- unnecessary complexity, over-engineering, hidden coupling, or misplaced responsibility;
- duplicated domain logic and inconsistent concepts;
- unclear control flow, mixed responsibilities, hidden side effects, or global state;
- dependencies and abstractions that increase long-term operational or maintenance cost;
- divergence from established adjacent patterns without a justified reason.

#### Performance and reliability

Check:

- inefficient algorithms, N+1 work, unbounded data, missing pagination, or excessive serialization;
- blocking I/O, contention, races, memory pressure, leaks, and resource cleanup;
- cache invalidation, stale data, stampedes, retries, timeouts, and degraded dependencies;
- startup, payload, network, storage, queue, and high-cardinality behavior.

#### Tests, operations, and users

Check:

- whether tests exercise the changed contract, failures, boundaries, and regressions;
- observability, auditability, diagnostics, alerts, and support impact;
- rollout, migration, feature-flag, canary, rollback, and deployment safety;
- accessibility, localization, offline/degraded-network states, and user feedback when relevant;
- compatibility with clients, SDKs, integrations, jobs, and public APIs.

### 5. Validate each finding

A finding must include:

- priority;
- concise title;
- concrete file, symbol, line, contract, or behavior evidence;
- realistic impact and affected surface;
- why current validation does not prevent it;
- targeted recommendation;
- confidence or what would confirm it.

Do not report vague preferences such as “could be cleaner” without a concrete failure mode or maintenance cost.

## Priority scale

- **P0 — Critical:** likely incident, data loss, severe privacy or authorization failure, major outage, irreversible migration, or immediate user harm. Block release.
- **P1 — High:** serious correctness, security, compatibility, performance, or operational risk. Fix before merge or release unless explicitly accepted.
- **P2 — Medium:** meaningful reliability, maintainability, test, edge-case, or performance issue. Fix soon or track with ownership.
- **P3 — Low:** minor clarity, documentation, polish, or consistency issue with concrete value.
- **Needs investigation:** potentially material but not confirmable with available evidence. State the missing evidence and next check.

## Output format

Lead with findings in priority order. For each finding use a compact structure:

```markdown
### P1 — Short title

**Evidence:** `path:line` or symbol and observed behavior.
**Impact:** realistic consequence and affected users or systems.
**Recommendation:** targeted fix or investigation.
**Confidence:** high, medium, or low; include missing evidence when relevant.
```

Then include:

1. **Scope reviewed** — exact diff/range/files and important assumptions.
2. **Change summary** — intended behavior and affected systems.
3. **Validation** — checks actually run and their results.
4. **Coverage gaps** — unreviewed areas or unavailable evidence.
5. **Positive observations** — only meaningful strengths.
6. **Final recommendation** — `Block until fixed`, `Needs more investigation`, `Approve with follow-ups`, or `Approve`, with the decisive reason.

If there are no findings, say so directly and still identify residual risk or validation limits. Do not create empty priority sections.

## Deployed or published changes

Add a production risk assessment covering:

- current exposure and likely affected users or data;
- exploitability or failure likelihood;
- logs, metrics, traces, records, or support signals to inspect;
- immediate containment, rollback, or hotfix options;
- notification needs for users, support, security, legal, or operations;
- follow-up prevention.

Do not perform deployment, rollback, disclosure, or third-party communication without explicit authority.

## Decision rules

- Recommend **Block until fixed** for any unresolved P0 or realistic serious P1 affecting security, privacy, permissions, data integrity, payments, availability, or irreversible migrations.
- Recommend **Needs more investigation** when missing evidence prevents a safety conclusion in a material area.
- Recommend **Approve with follow-ups** when only bounded P2/P3 issues or explicitly accepted risks remain.
- Recommend **Approve** only when no meaningful unresolved risk remains within the stated scope.
