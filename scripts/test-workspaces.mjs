import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { projectChatEventForClient } from '../src/main/client-message-projection.js';
import { WorkspaceManager } from '../src/main/workspaces.js';
import { searchWorkspaceFiles } from '../src/main/files.js';
import { searchWorkspaceMentions } from '../src/main/workspace-mentions.js';

const base = join(tmpdir(), '.avi', 'visualizations', '2026-09-05-07-40-UTC', 'workspace-tests');
await mkdir(base, { recursive: true });
const temp = await mkdtemp(join(base, 'run-'));
try {
  const manager = new WorkspaceManager(join(temp, 'workspaces'));
  const source = join(temp, 'source');
  const second = join(temp, 'second');
  await mkdir(source);
  await mkdir(second);
  await writeFile(join(source, 'keep.txt'), 'original');
  const workspace = await manager.save({ name: 'Example', folders: [{ path: source }] });
  assert.equal(manager.isWorkspace(workspace.path), true);
  assert.equal(manager.isWorkspace(source), false);
  const runtime = await readFile(new URL('../src/main/runtime.js', import.meta.url), 'utf8');
  const sendChatEventSource = runtime.match(/^function sendChatEvent\(payload\) \{[\s\S]*?^\}/m)?.[0];
  assert(sendChatEventSource, 'Runtime chat event dispatcher must exist');
  const pluginEvents = [];
  const rendererEvents = [];
  const remoteEvents = [];
  const sendChatEvent = runInNewContext(`${sendChatEventSource}\nsendChatEvent`, {
    workspaceManager: manager,
    projectChatEventForClient,
    pluginManager: { runtime: { emitChatEvent: (event) => pluginEvents.push(event) } },
    sendRendererEvent: (channel, event) => {
      assert.equal(channel, 'chat:event');
      rendererEvents.push(event);
    },
    remoteChatEventListeners: [(event) => remoteEvents.push(event)],
  });
  for (const [projectPath, expected] of [[workspace.path, true], [source, false], [undefined, false]]) {
    const event = { type: 'conversation', conversation: { id: 'thread', projectPath, title: 'Updated' } };
    sendChatEvent(event);
    assert.equal(Object.hasOwn(event.conversation, 'isWorkspace'), false);
    assert.equal(pluginEvents.at(-1), event);
    for (const events of [rendererEvents, remoteEvents]) {
      assert.equal(events.at(-1).conversation.isWorkspace, expected);
      assert.equal(events.at(-1).conversation.title, 'Updated');
    }
  }
  sendChatEvent({ type: 'conversation', conversation: { projectPath: source, isWorkspace: true } });
  assert.equal(rendererEvents.at(-1).conversation.isWorkspace, false);
  const runState = { type: 'run-state', conversationId: 'thread', running: true };
  sendChatEvent(runState);
  assert.equal(rendererEvents.at(-1), runState);
  assert.equal((await lstat(join(workspace.path, 'source'))).isSymbolicLink(), true);
  assert.equal(await readFile(join(workspace.path, 'source', 'keep.txt'), 'utf8'), 'original');
  const search = await searchWorkspaceFiles(workspace.path, 'keep');
  assert(search.files.some((item) => item.path.replaceAll('\\', '/') === 'source/keep.txt'));
  const content = await searchWorkspaceFiles(workspace.path, 'original');
  assert(content.content.some((item) => item.path.replaceAll('\\', '/') === 'source/keep.txt'));
  await symlink(workspace.path, join(source, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  const mentions = await searchWorkspaceMentions(workspace.path, 'keep');
  assert(mentions.some((item) => item.path === 'source/keep.txt'));
  await writeFile(join(workspace.path, 'AGENTS.md'), '# Workspace context');
  await manager.save({ path: workspace.path, folders: [{ path: second, name: 'linked' }] });
  assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'original');
  assert.equal(await readFile(join(workspace.path, 'AGENTS.md'), 'utf8'), '# Workspace context');
  await assert.rejects(lstat(join(workspace.path, 'source')), { code: 'ENOENT' });
  await assert.rejects(manager.save({ name: '../escape', folders: [] }));
  await assert.rejects(manager.save({ name: 'Example', folders: [] }), { code: 'EEXIST' });
  await assert.rejects(manager.save({ path: source, folders: [] }));
  await assert.rejects(manager.save({ path: workspace.path, folders: [{ path: temp }] }));
  await assert.rejects(manager.save({ path: workspace.path, folders: [{ path: source, name: 'same' }, { path: second, name: 'same' }] }));
  await assert.rejects(manager.save({ path: workspace.path, folders: [{ path: source, name: 'AGENTS.md' }] }));
  assert.equal((await manager.inspect(workspace.path)).folders.length, 1);
  await rm(second, { recursive: true });
  const broken = await manager.inspect(workspace.path);
  assert.equal(broken.folders[0].available, false);
  await manager.save({ path: workspace.path, folders: broken.folders });
  await manager.save({ path: workspace.path, folders: [] });
  assert.deepEqual((await manager.inspect(workspace.path)).folders, []);
  console.log('Workspace creation, editing, link safety, validation, and broken-link tests passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
