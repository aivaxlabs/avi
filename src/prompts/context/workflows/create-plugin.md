---
name: create-plugin
description: Create or update a trusted Avi JavaScript plugin package against the implemented plugin API contract.
---
# Create an Avi plugin

Create the smallest plugin that satisfies the requested capability.

## Procedure

1. **Read the contract first.** Read `docs/Plugins.md` and the relevant file under `docs/api/`. In the Avi repository, inspect the current API runtime, manager validation, integration point, and focused tests. Treat implementation as authoritative if documentation differs.
2. **Confirm authority.** Plugin import executes trusted code with Avi main-process privileges. Never install, sideload, import, or execute third-party plugin code without explicit authority. Source review alone is not permission to execute it.
3. **Choose exact capabilities.** Determine which v2 capabilities are required, what data the plugin reads or mutates, external endpoints or processes, credential strategy, tool risk, and whether trusted CSS or provider code is necessary.
4. **Use the v2 shape.** Produce ESM `plugin.js` with a default definition or factory receiving `{ apiVersion, definePlugin }`. Use `apiVersion: 2`, lowercase kebab-case IDs, strict semantic versions, an explicit `capabilities` array, and optional `activate(avi)` or `deactivate(reason)`.
5. **Choose static or runtime registration.** Use static `contributions` for resources known at load time. Use `activate(avi)` for dynamic tools, per-thread resources, event listeners, interceptors, storage, panels, provider types, or resources needing deterministic cleanup.
6. **Respect boundaries.** Keep panels declarative, descriptors JSON-like, credentials write-only, events observational, and behavior changes in typed interceptors. Never expose or depend on internal database, ChatRunner, BotManager, Electron, IPC, or renderer objects.
7. **Preserve Avi controls.** Tools and interceptors must not bypass approval, Plan restrictions, cancellation, output limits, provider normalization, bot scheduling, or context scoping. Mark destructive runtime tools accurately.
8. **Validate before installation.** Run `bun run test:plugins`, `bun run syntax`, and the narrow affected tests. Exercise activation, capability denial, cleanup, and representative failure behavior. Do not invoke paid model APIs merely to test structure.
9. **Review the result.** Confirm the entrypoint, requested capabilities only, necessary package files only, collision behavior, serializability, handler placement, no embedded secrets, cleanup, and documentation alignment.
10. **Stop before execution unless authorized.** A controlled loader test is not authority to install into Avi's application directory. Report restart requirements and unverified external dependencies.
11. **Report evidence.** List files, capabilities, registrations or contributions, validations actually run, and any runtime flow not exercised.

Use [the plugin reference](../skills/agent-customization/references/plugins.md) for a compact contract summary. Plugin fields are JavaScript API fields, not workflow frontmatter or composer arguments.
