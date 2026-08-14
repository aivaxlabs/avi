# Adding providers

Providers contribute models, tools, and auxiliary panels to Avi. Only enabled providers and enabled models enter the runtime catalog.

## OpenAI Subscription

1. Open **Settings → Providers → Add provider**.
2. Select **OpenAI Subscription**, choose a name, and save it.
3. Open the provider and select **Sign in with ChatGPT**.
4. Enter the displayed **Security code** on the authorization page and complete sign-in.

The managed catalog currently includes GPT-5.6 Sol, Terra, and Luna; GPT-5.5; GPT-5.4 and Mini; and GPT-5.3 Codex Spark. Fast variants appear when supported. The GPT Image setting controls whether the image generation and editing tool is available to every configured model, including models from other providers. Image editing accepts local file references only.

OAuth credentials are encrypted locally. **Disconnect** removes the provider session, and removing the provider also signs it out.

## OpenAI-compatible providers

Choose **OpenAI Compatible · Responses API** or **OpenAI Compatible · Chat completions API**, then configure:

- **Name**;
- an HTTP or HTTPS **Base URL**;
- **API key**, optional for unauthenticated local endpoints;
- **Reasoning format**;
- **Enabled**.

Avi appends `/v1/responses` or `/v1/chat/completions` when the endpoint path is not already present.

Supported reasoning mappings are:

- **Default** — `reasoning_effort`;
- **Modern** — `reasoning.effort`;
- **Anthropic** — `reasoning.max_tokens`;
- **Qwen** — `enable_thinking` and `thinking_budget`.

Choose the format actually implemented by the endpoint.

## Add a custom model

After saving the provider, select **Add model**. Configure:

- unique model ID and display name;
- enabled state;
- input and output context limits;
- Images, Audio, and PDF files capabilities;
- supported reasoning efforts: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

Context limits, when provided, must be positive integers. Declare only capabilities that the endpoint supports because Avi uses them to accept attachments and serialize requests.

The global model identifier is `<provider-id>:<model-id>`. Changing an ID can invalidate favorites, default-model assignments, and saved thread selections.

## Model selection and retries

A normal conversation selects the first available value from: draft model, saved conversation model, last-used model, then the first catalog model. Sending is blocked when no model is available.

A provider connection must begin responding within 30 seconds. Transport failures and HTTP 5xx responses use a limited retry schedule in normal chats. Goal mode retries indefinitely while the Goal remains active, eventually waiting five minutes between attempts.

## Security and troubleshooting

Messages, context, attachments, and tool results may be sent to the configured endpoint. Review provider-contributed tools and panels before enabling them.

If a model is missing, verify that both provider and model are enabled, the model has a valid ID and name, and the configuration was saved. If a reasoning effort is missing, add it to the model’s supported efforts. Review `~/.aivax/trace.log` for connection errors when diagnostics are enabled.

Before removing a provider, update any assignments in [Default models](Default%20models.md).
