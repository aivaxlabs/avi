import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';

// The database resolves its storage dir from os.homedir() at import time, so
// USERPROFILE is redirected only while importing and restored right after:
// keeping it redirected crashes window initialization on Windows.
const testProfile = mkdtempSync(join(tmpdir(), 'aivax-tags-ipc-test-'));
const realProfile = process.env.USERPROFILE;
process.env.USERPROFILE = testProfile;
const database = await import('../src/main/database.js');
process.env.USERPROFILE = realProfile;

const here = fileURLToPath(new URL('.', import.meta.url));
const preloadPath = join(here, '..', 'src', 'preload', 'preload.cjs');

// Mirrors invokeApplicationRequest in src/main/runtime.js: handlers always
// receive (event, payload) with a single payload object. The set-tags body is
// copied verbatim from the runtime registration.
const handlers = new Map([
  ['conversations:set-tags', (_event, payload = {}) => (
    database.setConversationTags(payload.conversationId, payload.tags)
  )],
  ['conversations:list', () => database.listConversations()],
]);

ipcMain.handle('avi:invoke', async (_event, { channel, payload } = {}) => {
  const handler = handlers.get(channel);
  if (!handler) return { ok: false, error: { name: 'Error', message: `Unknown application request: ${channel}` } };
  try {
    return { ok: true, value: await handler(_event, payload) };
  } catch (error) {
    return { ok: false, error: { name: 'Error', message: error instanceof Error ? error.message : String(error) } };
  }
});

let failures = 0;

app.whenReady().then(async () => {
  const conversation = database.createConversation({
    model: 'test/model',
    projectPath: process.cwd(),
    title: 'Tags IPC test',
  });
  database.insertMessage({
    conversationId: conversation.id,
    role: 'user',
    status: 'sent',
    content: 'Seeded message',
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL('about:blank');

  try {
    const pageTags = await win.webContents.executeJavaScript(
      `window.chatApp.conversations.setTags(${JSON.stringify(conversation.id)}, ${JSON.stringify(['review', 'important'])})
        .then((result) => result.tags)`,
      true,
    );
    assert.deepEqual(pageTags, ['review', 'important'], 'setTags response must echo persisted tags');

    const listedTags = await win.webContents.executeJavaScript(
      `window.chatApp.conversations.list()
        .then((list) => list.find((item) => item.id === ${JSON.stringify(conversation.id)}).tags)`,
      true,
    );
    assert.deepEqual(listedTags, ['review', 'important'], 'fresh listing must keep the tags');

    assert.deepEqual(
      database.getConversation(conversation.id).tags,
      ['review', 'important'],
      'database row must keep the tags',
    );

    console.log('conversations tags IPC: all checks passed');
  } catch (error) {
    failures = 1;
    console.error('conversations tags IPC: FAILED');
    console.error(error);
  }

  win.destroy();
  try {
    rmSync(testProfile, { recursive: true, force: true });
  } catch {
    // The SQLite handle may still hold files open on Windows; the temp dir is disposable.
  }
  app.exit(failures);
});
