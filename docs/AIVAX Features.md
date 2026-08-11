# AIVAX Features

AIVAX Features is an optional external integration for persistent memory, richer web tools, and remote reranking. Avi’s core local conversation and search features do not require it.

## Connect an account

1. Open **Settings → AIVAX Features**.
2. Paste an AIVAX **Login key**.
3. Select **Connect account**.

Avi exchanges the login key for an access token and clears the input. The token is encrypted in local secure storage. A connected account can display its current balance, usage during the last 24 hours, plan, a refresh action, a link to add balance, and **Disconnect**.

## Persistent memory

All AIVAX features are disabled by default. To enable memory:

1. connect the account;
2. select an existing **Memory collection** or create one;
3. enable **Enable memory features**.

The memory toggle remains unavailable without both an account and a collection. When enabled, agents receive memory guidance and the memory search and write tools become available. Store only knowledge that should remain useful beyond the current conversation.

## Web utilities

- **AIVAX advanced fetch** — expanded extraction for HTML, images, documents, and OCR;
- **AIVAX web search** — web search with country, language, and domain filters;
- **Use Reflex for thread search** — remotely reranks candidates produced by Avi’s local conversation search.

If Reflex fails, local search remains available. Advanced fetch and web search depend on the external service.

## Security, cost, and availability

Tool queries and source content may be sent to AIVAX as required by the selected feature. Availability can depend on network access, account state, plan, balance, and service health. Select memory collections carefully to avoid mixing unrelated contexts.

**Disconnect** removes the local access token and disables the connection. It does not delete remote collections. Non-secret feature settings remain in Avi’s local database.

## Troubleshooting

If memory cannot be enabled, verify both the account connection and selected collection. If a tool is missing, confirm its toggle and start a new turn so the runtime context and tool catalog are rebuilt. Account or service failures do not prevent core local conversations or basic local thread search.
