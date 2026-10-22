# Adding providers

Providers contribute models, tools, and auxiliary panels to Avi. Only enabled providers and enabled models enter the runtime catalog.

**Add provider** groups provider types into **Subscriptions**, which sign in with an existing consumer plan and use a managed model catalog, and **API**, which connect an endpoint with an API key. Provider types with a `managed` connection, including plugin types, appear under Subscriptions.

## OpenAI Subscription

1. Open **Settings → Providers → Add provider**.
2. Select **OpenAI Subscription**, choose a name, and save it.
3. Open the provider and select **Sign in with ChatGPT**.
4. Enter the displayed **Security code** on the authorization page and complete sign-in.

GPT-6 Astra provides 272,000 input tokens; GPT-6 Astra (1M) provides 872,000. Both reserve 128,000 output tokens and offer Fast variants.

The managed catalog currently includes GPT-6 Astra and Astra (1M); GPT-5.6 Sol, Terra, and Luna; GPT-5.5; GPT-5.4 and Mini; and GPT-5.3 Codex Spark. Fast variants appear when supported. The GPT Image setting controls whether the image generation and editing tool is available to every configured model, including models from other providers. Image editing accepts local file references only.

OAuth credentials are encrypted locally. **Disconnect** removes the provider session, and removing the provider also signs it out.

## X Subscription

Use a SuperGrok or X Premium subscription through xAI OAuth, the same sign-in used by Grok Build and OpenCode.

1. Open **Settings → Providers → Add provider**.
2. Select **X Subscription**, choose a name, and save it.
3. Open the provider and select **Sign in with xAI**.
4. Enter the displayed **Security code** on the xAI authorization page and complete sign-in.

Requests use the xAI Responses API (`api.x.ai/v1/responses`) with the OAuth access token. The managed catalog includes Grok 4.7 (500,000 input tokens, reasoning up to `xhigh`); Grok 4.6, 4.5, and 4.3 (4.3 has a 1M context window); and Grok Build 0.1. xAI decides which models each subscription can use, so a model outside your plan returns an error from xAI.

Credentials are encrypted locally and refreshed automatically. **Disconnect** or removing the provider signs it out.

## OpenAI-compatible providers

Choose **OpenAI Compatible · Responses API** or **OpenAI Compatible · Chat completions API**, then configure:

- **Name**;
- an HTTP or HTTPS **Base URL**;
- **API key**, optional for unauthenticated local endpoints;
- **Reasoning effort format**;
- **Reasoning reuse**;
- optional **Temperature** and **Top K** inference hyperparameters;
- optional **Custom JSON**;
- **Enabled**.

Temperature and Top K are sent as numeric `temperature` and `top_k` request fields. Leave either value empty to omit that field from inference requests.

**Custom JSON** must be a JSON object. Avi merges it recursively into every request body after building it, so it can add fields or override fields that Avi generates. Nested objects are merged key by key; arrays and other values replace the existing value. A model's own **Custom JSON** is merged after the provider's, so model values win. The Responses, Chat completions, and Messages request formats all apply both.

Avi appends `/v1/responses` or `/v1/chat/completions` when the endpoint path is not already present.

**Reasoning effort format** controls how the selected reasoning effort is sent:

- **Default** — depends on the interface: `reasoning_effort` for Chat completions and `reasoning.effort` for Responses;
- **Modern** — `reasoning.effort`;
- **Anthropic** — `reasoning.max_tokens`;
- **Qwen** — `enable_thinking` and `thinking_budget`;
- **Mistral** — `reasoning_effort`, with reasoning forwarded as `thinking` content chunks.

Choose the format actually implemented by the endpoint.

**Reasoning reuse** controls how earlier assistant reasoning is sent back on later requests:

- **Forward as metadata** (default) — replays the provider's own reasoning data when the same model and interface produced it: Responses `reasoning` items (including `encrypted_content`) and Chat completions `reasoning_details` (including signed and encrypted entries). Without that data, Chat completions sends the reasoning text as `reasoning_content`; Responses omits it, because reasoning items cannot be rebuilt without their original IDs;
- **Forward as `<think>` block** — prefixes the reasoning text to the assistant content as `<think>...</think>`, for endpoints that only read reasoning from the message text;
- **Do not forward reasoning** — sends only assistant text and tool calls.

Reasoning is always shown in the chat; this setting only affects what is sent to the model.

## Add a custom model

After saving the provider, select **Add model**. Configure:

- model ID sent to the provider API and a display name;
- enabled state;
- input and output context limits;
- Images, Audio, and PDF files capabilities;
- supported reasoning efforts: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`;
- media size limit: **Use Tuning setting** (default), 5 MB, 10 MB, 20 MB, 100 MB, or No limit. It overrides **Tuning → Media size limit** for chat attachments and `read_media_file`;
- optional **Custom JSON**, a JSON object recursively merged into this model's request bodies after the provider's Custom JSON.

Providers that can list their models show a dropdown next to **Add model**. Choose **Scan models** to request the provider's `/v1/models` endpoint with the saved base URL and API key. The dialog lists the reported model IDs, which you can filter, and marks IDs that are already configured. Select **Add model** next to an ID to open a new model editor with that ID filled in, then complete the remaining fields and save. Both OpenAI Compatible interfaces support scanning.

Context limits, when provided, must be positive integers. Declare only capabilities that the endpoint supports because Avi uses them to accept attachments and serialize requests. Multiple configured variants can use the same model ID—for example, to expose different context limits—because Avi assigns each one a persistent internal instance ID.

The global model identifier is `<provider-id>:<model-instance-id>`. The instance ID is generated and managed internally; the configured model ID is sent unchanged to the provider API.

## Model routers

Open **Settings → Routers** to expose multiple configured models as one catalog entry. Give the router a name, choose its models in priority order, and select a mode:

- **Fallback** starts with the first available model and moves down the list when a provider exhausts its normal connection retries or is rate-limited.
- **Round robin** rotates the starting model for each request, then uses the remaining models as fallbacks in order.
- **Fusion** pairs a lead model with a sidekick model, each with its own reasoning effort. See [Fusion](Fusion.md); the fallback and catalog rules below do not apply to Fusion routers.

A model that exhausts its connection retries, or that answers with HTTP 429 or a quota error such as `INFERENCE_CAP_ERROR`, is skipped immediately and that router does not retry it for 10 minutes. Missing or disabled models remain visible as unavailable in the editor so you can repair the configuration. Other errors, such as invalid requests or unsupported input, are returned immediately instead of trying another model.

Router IDs begin with `@`. Routers cannot contain other routers. Avi adapts a requested reasoning effort to the nearest effort supported by the selected model, preferring the lower effort when two options are equally close. The router catalog entry advertises only capabilities and reasoning efforts shared by every configured model.

## Model selection and retries

A normal conversation selects the first available value from: draft model, saved conversation model, last-used model, then the first catalog model. Sending is blocked when no model is available.

A provider connection must begin responding within 30 seconds. Transport failures and HTTP 5xx responses use a limited retry schedule in normal chats. Providers that retry on their own are not retried again in normal chats; **Settings → Providers** shows this under **Harness**. Goal mode retries indefinitely while the Goal remains active, eventually waiting five minutes between attempts.

## Security and troubleshooting

Messages, context, attachments, and tool results may be sent to the configured endpoint. Review provider-contributed tools and panels before enabling them.

If a model is missing, verify that both provider and model are enabled, the model has a valid ID and name, and the configuration was saved. If a reasoning effort is missing, add it to the model’s supported efforts. Review `~/.aivax/trace.log` for connection errors when diagnostics are enabled.

Removing a provider clears the [Default models](Default%20models.md) assignments that used it. Assign replacements in **Models** afterward. Threads that last used one of its models fall back to an available model the next time you send a message.
