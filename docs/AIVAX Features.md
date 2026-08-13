# AIVAX Features

AIVAX Features is an optional external integration for persistent memory, richer web tools, and semantic thread search. Avi’s core local conversations and local search do not require it.

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
- **AIVAX web search** — web search with country, language, and domain filters.

Advanced fetch and web search depend on the external service.

## In-app search

Select a dedicated **Thread search collection** to enable semantic thread search. Do not use the Memory collection or a collection containing other documents: Avi synchronizes the complete thread-search corpus with `sync` mode, which removes remote documents that are not part of the current corpus.

Avi synchronizes the collection when the app opens, when the collection is selected, and every 15 minutes. Each eligible conversation contributes at most its three most recent completed `user → assistant` turns. Each turn is a separate document containing the conversation title, user message, and assistant response; every component is limited to approximately 256 tokens. Hidden messages, agent-authored user messages, incomplete responses, archived conversations, deleted conversations, side chats, and sub-agent threads are excluded.

Search uses AIVAX semantic search with RRF reranking, a minimum score of `0.2`, and up to 20 results. If indexing or remote search fails, Avi records the failure in `~/.aivax/trace.log` and local thread search remains available. Successful index and search requests log elapsed time, consumed credits, and applicable document/result counts without logging message content.

## Security, cost, and availability

Tool queries and source content may be sent to AIVAX as required by the selected feature. Thread search stores the eligible excerpts in the selected remote RAG collection until a later successful synchronization removes them or the collection is deleted. Availability can depend on network access, account state, plan, balance, indexing progress, and service health. Select collections carefully to avoid mixing unrelated contexts.

**Disconnect** removes the local access token. It does not delete remote collections or their documents. Non-secret feature settings remain in Avi’s local database, but remote search and synchronization pause until an account is connected again.

## Troubleshooting

If memory cannot be enabled, verify both the account connection and selected Memory collection. If semantic thread search is unavailable, verify that a different, dedicated Thread search collection is selected and allow time for AIVAX to index queued documents. If a tool is missing, confirm its toggle and start a new turn so the runtime context and tool catalog are rebuilt. Account or service failures do not prevent core local conversations or basic local thread search.
