---
name: create-plugin
description: Create or update a trusted single-file Avi JavaScript plugin against the implemented plugin API contract.
---
# Create an Avi plugin

Create the smallest plugin that satisfies the requested capability.

## Procedure

1. **Read the contract first.** Locate and read `docs/Plugins.md`. If working in the Avi repository, also inspect the current plugin API, manager validation, integration points, and loader tests. Treat implementation as authoritative when documentation and code differ.
2. **Confirm authority.** Plugin import executes trusted code with Avi main-process privileges. Never install, sideload, import, or execute third-party plugin code without the user's explicit authority. Reading source for review is not permission to execute it.
3. **Gather only essential decisions.** Determine the plugin ID, display metadata, required contribution types, external endpoints/processes, credential strategy, mutating behavior, and whether trusted CSS or provider code is truly needed. Ask only when a wrong assumption materially changes security or behavior.
4. **Use the v1 shape.** Produce one ESM `.js` file with a default definition object or async factory receiving `{ apiVersion, definePlugin }`. Set definition `apiVersion: 1`, `id`, `name`, and `version`. Use lowercase kebab-case IDs.
5. **Implement minimally.** Add only requested contribution arrays: `context`, `mcps`, `tools`, `auxiliaryPanels`, `themes`, `personalities`, or `providers`. Keep descriptor data plain and serializable and use only each contribution type's documented top-level handlers; unknown fields and unsupported function keys are rejected. Do not invent settings schemas, lifecycle/disposal hooks, enable/disable/remove/update APIs, or renderer JavaScript.
6. **Respect each boundary.** Treat plugins as fully trusted; keep panels declarative; review CSS; never embed secrets; give tools exact JSON Schemas and make mutating/destructive behavior obvious in names and descriptions; make provider tool-call identities stable; write context only through `{ path, content }` contributions and never edit `plugins/.avi`.
7. **Validate before installation.** Run the repository's focused plugin-loader/manager test when available, plus syntax checking and a direct loader test against a temporary plugin directory. Exercise the successful definition and material capability as well as atomic rejection for a representative invalid definition. Do not invoke paid model APIs merely to test documentation or structure.
8. **Review the result.** Confirm one-file scope, API compatibility, ID collisions, serializability, handler placement, no credentials, no arbitrary renderer code, correct tool approval fields, provider stream events, and failure behavior. Review the final diff.
9. **Stop before execution unless authorized.** Creating or validating with a controlled local loader is not authority to copy the plugin into Avi's installation directory. Sideload only when explicitly requested and authorized; report that startup loading requires a restart and that the installation directory may be unwritable.
10. **Report evidence.** List the file created or changed, contributions implemented, validations actually run and their results, and any unverified runtime integration or external dependency.

Use [the plugin reference](../skills/agent-customization/references/plugins.md) for a compact contract summary. Plugin parameters are JavaScript object fields defined by the plugin API, not workflow frontmatter or composer arguments.
