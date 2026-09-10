import { readFile } from 'node:fs/promises';
import { ComputerSessionManager } from './runtime/computerRuntime.js';

export default async ({ definePlugin }) => {
  let owner;
  let manager;
  return definePlugin({
    apiVersion: 2,
    id: 'computer-use',
    name: 'Computer Use',
    version: '1.0.0',
    description: 'Inspect and control the desktop with screenshots, a visible session overlay, Escape to stop and pauses for manual input.',
    capabilities: ['tools.register'],
    contributions: { context: [{ path: 'skills/computer-use/SKILL.md', content: await readFile(new URL('./skills/computer-use/SKILL.md', import.meta.url), 'utf8') }] },
    async activate(avi) {
      manager = new ComputerSessionManager();
      avi.lifecycle.onDeactivate(async () => {
        if (manager.session) await manager.endSession(manager.session.session_id, 'plugin_disabled');
        await manager.dispose();
      });
      const tools = [
        { name: 'computer_get_context', description: 'Inspect system time, cursor, monitors and visible windows without starting a control session.',
          schema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true,
          execute: () => manager.getContext() },
        { name: 'computer_focus_window', description: 'Focus a visible desktop window by exact process PID or case-insensitive window/application name. Requires pid or name.',
          schema: { type: 'object', properties: { pid: { type: 'integer', minimum: 1 }, name: { type: 'string', minLength: 1 } }, additionalProperties: false },
          execute: (input) => { if (!input.pid && !input.name) throw new Error('Supply pid or name.'); return manager.focusWindow(input); } },
        { name: 'computer_toggle_session', description: 'Start or end a desktop control session with a visible overlay. Start returns session_id and monitor inventory. End requires that session_id. The user can press Escape to stop at any time.',
          schema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'end'] }, session_id: { type: 'string', minLength: 1 } }, required: ['action'], additionalProperties: false },
          execute: (input) => manager.toggleSession(input) },
        { name: 'computer_use', description: 'Execute ordered desktop actions in an active session. Read the computer-use skill. Coordinates are local to the selected monitor screenshot, not the combined desktop. Manual input pauses actions for 5 seconds. Escape ends the session. Always end the session when finished.',
          schema: { type: 'object', properties: {
            session_id: { type: 'string', minLength: 1 },
            actions: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: {
              action: { type: 'string', enum: ['key', 'type', 'mouse_move', 'left_click', 'left_click_drag', 'right_click_drag', 'right_click', 'middle_click', 'double_click', 'scroll', 'get_screenshot', 'sleep'] },
              monitor_id: { type: 'string' }, coordinate: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              text: { type: 'string' }, duration_ms: { type: 'integer', minimum: 0, maximum: 60000 },
            }, required: ['action'], additionalProperties: false } },
          }, required: ['session_id', 'actions'], additionalProperties: false }, execute: (input) => manager.use(input) },
      ];
      for (const tool of tools) avi.tools.register({
        name: tool.name, description: tool.description, inputSchema: tool.schema,
        annotations: { readOnly: tool.readOnly === true, destructive: tool.readOnly !== true },
        async execute(input, context) {
          context.signal.throwIfAborted();
          if (!tool.readOnly && manager.session && owner !== context.threadId) throw new Error('Another conversation owns the active desktop session.');
          const abort = () => { if (manager.session && owner === context.threadId) void manager.endSession(manager.session.session_id, 'interrupted'); };
          if (!tool.readOnly) { owner = context.threadId; context.signal.addEventListener('abort', abort, { once: true }); }
          try {
            const result = await tool.execute(input);
            if (context.signal.aborted) { abort(); context.signal.throwIfAborted(); }
            if (result.isError || result.structuredContent?.ok === false) throw new Error(result.structuredContent?.error || JSON.stringify(result.structuredContent || result.content));
            return {
              output: JSON.stringify(result.structuredContent ?? result.content?.filter((item) => item.type === 'text') ?? result),
              mediaContent: (result.content ?? []).filter((item) => item.type === 'image').map((item) => ({ type: 'image_url', image_url: { url: `data:${item.mimeType};base64,${item.data}` } })),
            };
          } finally { context.signal.removeEventListener('abort', abort); }
        },
      });
    },
  });
};
