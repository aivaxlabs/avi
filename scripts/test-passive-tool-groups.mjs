import assert from 'node:assert/strict';
import { app } from 'electron';
import { CLIENT_TOOLS } from '../src/main/client-tools.js';
import {
  ENABLE_TOOLS_NAME,
  PASSIVE_TOOL_GROUPS,
  applyPassiveToolGroups,
} from '../src/main/tools/passive-groups.js';

const names = (tools) => tools.map((tool) => tool.name);
const clientToolNames = new Set(names(CLIENT_TOOLS));

for (const name of Object.values(PASSIVE_TOOL_GROUPS).flat()) {
  assert.ok(clientToolNames.has(name), `${name} must be a client tool.`);
}

const initial = applyPassiveToolGroups(CLIENT_TOOLS);
const enableTool = initial.find((tool) => tool.name === ENABLE_TOOLS_NAME);
assert.ok(enableTool);
assert.equal(initial.at(-1), enableTool);
for (const name of Object.values(PASSIVE_TOOL_GROUPS).flat()) {
  assert.ok(!names(initial).includes(name), `${name} must be hidden initially.`);
}
for (const name of ['chat_spawn_subagent', 'chat_send_prompt', 'chat_inspect_thread', 'sleep', 'run_in_terminal']) {
  assert.ok(names(initial).includes(name), `${name} must stay visible.`);
}
assert.deepEqual(
  enableTool.inputSchema.properties.groups.items.enum,
  Object.keys(PASSIVE_TOOL_GROUPS),
);
assert.match(enableTool.description, /- bots: bots_list, bots_create/);
assert.match(
  await enableTool.execute({ groups: ['secret_vault'] }),
  /Enabled secret_vault \(secret_vault_put, secret_vault_list, secret_vault_get\)/,
);

const enabled = applyPassiveToolGroups(CLIENT_TOOLS, {
  calls: [{ name: ENABLE_TOOLS_NAME, argumentsText: JSON.stringify({ groups: ['bots', 'secret_vault'] }) }],
});
assert.ok(names(enabled).includes('bots_create'));
assert.ok(names(enabled).includes('secret_vault_get'));
assert.ok(!names(enabled).includes('task_scheduler_list_tasks'));
assert.deepEqual(
  enabled.find((tool) => tool.name === ENABLE_TOOLS_NAME).inputSchema.properties.groups.items.enum,
  ['threads', 'semaphores', 'task_scheduler'],
);

const used = applyPassiveToolGroups(CLIENT_TOOLS, {
  calls: [{ name: 'task_scheduler_list_tasks', argumentsText: '{}' }, { name: ENABLE_TOOLS_NAME, argumentsText: '{' }],
  activeGroups: ['semaphores'],
});
assert.ok(names(used).includes('task_scheduler_schedule_task'));
assert.ok(names(used).includes('release_semaphore'));
assert.ok(!names(used).includes('bots_list'));

const allEnabled = applyPassiveToolGroups(CLIENT_TOOLS, { activeGroups: Object.keys(PASSIVE_TOOL_GROUPS) });
assert.equal(allEnabled, CLIENT_TOOLS);

const withoutPassiveTools = CLIENT_TOOLS.filter((tool) => tool.name === 'read_file');
assert.equal(applyPassiveToolGroups(withoutPassiveTools), withoutPassiveTools);

console.log('Passive tool group tests passed.');
app.exit(0);
