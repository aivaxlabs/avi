# Remote control

Remote control exposes Avi orchestration as an authenticated local MCP server. It is an experimental integration surface, not remote desktop control.

## Enable the server

1. Open **Settings → Remote control**.
2. Choose a port. The default is `18992`; a change is applied when the field loses focus.
3. Turn the server on.
4. Copy the endpoint or access key into a local MCP client.

The UI shows **Listening** or **Not listening** and displays startup errors such as a port already being in use.

## Security boundary

The server:

- binds only to `127.0.0.1`;
- accepts only localhost and 127.0.0.1 host values;
- uses Streamable HTTP;
- requires the key in the endpoint URL or as a Bearer token;
- compares credentials with a timing-safe check;
- limits request bodies to 1 MiB;
- enables DNS-rebinding protection;
- stores the access key through Avi secure storage.

Despite its name, Remote control is not directly exposed to the LAN or Internet. Any external tunnel or proxy would be a separate system and security responsibility.

## Exposed tools

Remote control exposes:

- `bots_list`;
- `bots_create`;
- `bots_update`;
- `bots_delete`;
- `bots_activate`;
- `chat_list_folders`;
- `chat_list_threads`;
- `chat_create_thread`;
- `chat_send_prompt`;
- `chat_interrupt_thread`;
- `chat_inspect_thread`.

`chat_list_threads` includes each configured bot's main thread. Bot threads use the bot name as the conversation name and `~avi-bot/<bot name>` as the model so MCP clients can identify them without a separate lookup.

The create-thread schema follows [Default models](Default%20models.md): model levels when enabled, or explicit model and reasoning fields when disabled. Text results are returned directly as MCP text content. Structured tool results, including `bots_*` responses, are returned as MCP `structuredContent` without an additional JSON-encoded text envelope.

During MCP initialization, Avi provides complementary operational instructions for orchestrators. They explain how to choose persistent bots versus bounded threads, discover and reuse existing ownership, follow asynchronous work without tight polling, verify mutations, and reserve interruption or deletion for intentional lifecycle decisions. Tool descriptions remain the source for individual inputs and immediate behavior.

## Manage the access key

- **Copy key** copies the current credential.
- **Regenerate** invalidates clients configured with the previous key.
- **Remove key** disables Remote control. A new key is created the next time it is enabled.

## Limitations

Remote control does not synchronize files, control the desktop UI, or expose every Avi tool. The selected port must be available, and Avi must remain running for clients to connect.
