import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BOT_ACTIVITY_CATEGORIES,
  BOT_MESSAGE_ROLES,
  BOT_PENDENCY_STATUSES,
  BOT_WORK_STATE_FILES,
  appendBotActivity,
  appendBotPendencyMessage,
  attachBotPendencyApproval,
  completeBotPendency,
  consumeBotPendencyApproval,
  createBotPendency,
  ensureBotWorkStateFiles,
  mutateBotWorkState,
  readBotWorkState,
} from '../src/main/bot-work-state.js';
import { hasOpenBotUserAction } from '../src/shared/bot-work-items.js';

const root = mkdtempSync(join(tmpdir(), 'bot-ws-test-'));
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  return { name, fn };
}

async function run(suite) {
  for (const t of suite) {
    try {
      await t.fn();
      passed++;
    } catch (err) {
      failed++;
      failures.push({ name: t.name, err });
    }
  }
}

function sub(name) {
  return resolve(join(root, name));
}

const T = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';

const attachment = (id, overrides = {}) => ({
  id,
  kind: 'file_reference',
  name: `${id}.bin`,
  path: `/tmp/attachments/${id}.bin`,
  ...overrides,
});

// --- Constants ---
await run([
  test('constants: BOT_WORK_STATE_FILES', async () => {
    assert.equal(BOT_WORK_STATE_FILES.inbox, 'inbox.json');
    assert.equal(BOT_WORK_STATE_FILES.activity, 'diary.json');
  }),
  test('constants: statuses, roles, categories', async () => {
    assert.deepEqual(BOT_PENDENCY_STATUSES, new Set(['open', 'completed']));
    assert.deepEqual(BOT_MESSAGE_ROLES, new Set(['bot', 'user']));
    assert.deepEqual(BOT_ACTIVITY_CATEGORIES, new Set(['progress', 'discovery', 'decision', 'completed', 'failure']));
  }),
]);

// --- Badge helper ---
await run([
  test('badge: open with pending approval regardless of last role', async () => {
    assert.equal(hasOpenBotUserAction({
      status: 'open',
      approval: { id: 'a1' },
      messages: [{ role: 'user' }],
    }), true);
  }),
  test('badge: open with latest bot message', async () => {
    assert.equal(hasOpenBotUserAction({
      status: 'open',
      approval: null,
      messages: [{ role: 'bot' }, { role: 'user' }, { role: 'bot' }],
    }), true);
  }),
  test('badge: open with latest user message and no approval', async () => {
    assert.equal(hasOpenBotUserAction({
      status: 'open',
      approval: null,
      messages: [{ role: 'bot' }, { role: 'user' }],
    }), false);
  }),
  test('badge: completed pendencies never need user action', async () => {
    assert.equal(hasOpenBotUserAction({
      status: 'completed',
      approval: null,
      messages: [{ role: 'bot' }],
    }), false);
    assert.equal(hasOpenBotUserAction(null), false);
  }),
]);

// --- ensureBotWorkStateFiles ---
await run([
  test('ensure: creates inbox.json and diary.json on empty folder', async () => {
    const d = sub('ensure-create');
    await ensureBotWorkStateFiles(d);
    const inbox = await readFile(join(d, 'inbox.json'), 'utf8');
    const activity = await readFile(join(d, 'diary.json'), 'utf8');
    assert.equal(inbox.trim(), '[]');
    assert.equal(activity.trim(), '[]');
  }),
  test('ensure: does not overwrite existing files nor legacy files', async () => {
    const d = sub('ensure-nooverwrite');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'inbox.json'), '[{"legacy":true}]\n', 'utf8');
    await writeFile(join(d, 'work-items.json'), '[{"legacyWorkItem":true}]\n', 'utf8');
    await ensureBotWorkStateFiles(d);
    assert.equal((await readFile(join(d, 'inbox.json'), 'utf8')).trim(), '[{"legacy":true}]');
    assert.equal(
      (await readFile(join(d, 'work-items.json'), 'utf8')).trim(),
      '[{"legacyWorkItem":true}]',
      'legacy files must be preserved on disk, not deleted',
    );
  }),
]);

await run([
  test('read: ignores and preserves legacy activity while validating new diary', async () => {
    const d = sub('legacy-activity');
    await mkdir(d, { recursive: true });
    const legacy = '[{"old":"format"}]';
    await writeFile(join(d, 'activity.json'), legacy);
    await ensureBotWorkStateFiles(d);
    assert.deepEqual(await readBotWorkState(d), { inbox: [], activity: [] });
    assert.equal(await readFile(join(d, 'activity.json'), 'utf8'), legacy);
    await writeFile(join(d, 'diary.json'), '{}');
    await assert.rejects(readBotWorkState(d), /Invalid diary.json/);
    await assert.rejects(appendBotActivity(d, { title: 'A result', description: '', category: 'progress' }), /Invalid diary.json/);
  }),
]);

// --- readBotWorkState defaults ---
await run([
  test('read: returns defaults for missing files', async () => {
    const d = sub('read-defaults');
    const state = await readBotWorkState(d);
    assert.deepEqual(state.inbox, []);
    assert.deepEqual(state.activity, []);
  }),
]);

// --- createBotPendency ---
await run([
  test('create: produces valid pendency with first bot message', async () => {
    const d = sub('create-ok');
    const item = await createBotPendency(d, {
      title: 'My pendency',
      content: 'Please review the plan.',
      attachments: [attachment('a1')],
    }, T);
    assert.equal(item.title, 'My pendency');
    assert.equal(item.status, 'open');
    assert.equal(item.messages.length, 1);
    assert.equal(item.messages[0].role, 'bot');
    assert.equal(item.messages[0].content, 'Please review the plan.');
    assert.deepEqual(item.messages[0].attachments, [attachment('a1')]);
    assert.equal(item.approval, null);
    assert.equal(item.completedAt, null);
    assert.equal(item.createdAt, T);
    assert.equal(item.updatedAt, T);
    assert.equal(typeof item.id, 'string');
    assert.equal(typeof item.messages[0].id, 'string');
  }),
  test('create: requires non-whitespace title and text', async () => {
    const d = sub('create-required');
    await assert.rejects(() => createBotPendency(d, { title: '   ', content: 'x' }, T), /Invalid title/);
    await assert.rejects(() => createBotPendency(d, { title: 'T', content: '  ' }, T), /Invalid content/);
    await assert.rejects(() => createBotPendency(d, { title: 'T' }, T), /content/);
  }),
  test('create: ignores an injected approval field', async () => {
    const d = sub('create-approval-injected');
    const item = await createBotPendency(d, {
      title: 'T',
      content: 'C',
      approval: { id: 'injected', botId: 'b', kind: 'work', context: 'c', prompt: 'p', status: 'pending' },
    }, T);
    assert.equal(item.approval, null, 'approvals must only be created through attachBotPendencyApproval');
  }),
  test('create: keeps full attachment descriptors with inline content', async () => {
    const d = sub('create-inline-attachment');
    const inline = attachment('pasted-1', {
      kind: 'text_inline',
      path: undefined,
      text: 'pasted text body',
    });
    const dataUrl = attachment('image-1', {
      kind: 'image_url',
      path: undefined,
      dataUrl: 'data:image/png;base64,AAAA',
      mime: 'image/png',
    });
    const item = await createBotPendency(d, {
      title: 'T',
      content: 'C',
      attachments: [inline, dataUrl],
    }, T);
    assert.deepEqual(item.messages[0].attachments, [inline, dataUrl]);
  }),
  test('create: rejects malformed attachments', async () => {
    const d = sub('create-bad-attachments');
    await assert.rejects(
      () => createBotPendency(d, { title: 'T', content: 'C', attachments: ['/tmp/file.txt'] }, T),
      /Invalid attachment: expected object/,
    );
    await assert.rejects(
      () => createBotPendency(d, { title: 'T', content: 'C', attachments: [{ id: 'x', kind: 'file' }] }, T),
      /expected a file path or inline content/,
    );
    await assert.rejects(
      () => createBotPendency(d, { title: 'T', content: 'C', attachments: [{ kind: 'file', path: '/tmp/x' }] }, T),
      /attachment.id/,
    );
    await assert.rejects(
      () => createBotPendency(d, {
        title: 'T',
        content: 'C',
        attachments: [attachment('dup'), attachment('dup')],
      }, T),
      /Duplicate attachments entry/,
    );
  }),
  test('create: writes no automatic activity entries', async () => {
    const d = sub('create-no-activity');
    await createBotPendency(d, { title: 'T', content: 'C' }, T);
    await attachBotPendencyApproval(d, {
      botId: 'b', kind: 'work', title: 'A', context: 'c', prompt: 'p',
    }, T);
    const state = await readBotWorkState(d);
    assert.deepEqual(state.activity, []);
  }),
]);

// --- appendBotPendencyMessage ---
await run([
  test('message: user keeps open and lowers the badge', async () => {
    const d = sub('message-user');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    assert.equal(hasOpenBotUserAction(item), true);
    const updated = await appendBotPendencyMessage(d, {
      pendencyId: item.id,
      role: 'user',
      content: 'Done, thanks.',
    }, T2);
    assert.equal(updated.status, 'open');
    assert.equal(updated.completedAt, null);
    assert.equal(updated.messages.at(-1).role, 'user');
    assert.equal(hasOpenBotUserAction(updated), false);
  }),
  test('message: bot message reopens a completed pendency', async () => {
    const d = sub('message-reopen');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    await completeBotPendency(d, item.id, T2);
    const reopened = await appendBotPendencyMessage(d, {
      pendencyId: item.id,
      role: 'bot',
      content: 'Follow-up: one more thing.',
    }, T2);
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.completedAt, null);
    assert.equal(hasOpenBotUserAction(reopened), true);
  }),
  test('message: user cannot reply to a completed pendency', async () => {
    const d = sub('message-user-completed');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    await completeBotPendency(d, item.id, T2);
    await assert.rejects(
      () => appendBotPendencyMessage(d, { pendencyId: item.id, role: 'user', content: 'late reply' }, T2),
      /Pendency is completed/,
    );
  }),
  test('message: content-only and attachments-only are accepted', async () => {
    const d = sub('message-empty-variants');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    const contentOnly = await appendBotPendencyMessage(d, {
      pendencyId: item.id,
      role: 'user',
      content: 'text only',
      attachments: [],
    }, T2);
    assert.deepEqual(contentOnly.messages.at(-1).attachments, []);
    const attachmentsOnly = await appendBotPendencyMessage(d, {
      pendencyId: item.id,
      role: 'user',
      content: '',
      attachments: [attachment('solo')],
    }, T2);
    assert.equal(attachmentsOnly.messages.at(-1).content, '');
    assert.equal(attachmentsOnly.messages.at(-1).attachments.length, 1);
  }),
  test('message: rejects empty content without attachments and unknown pendency', async () => {
    const d = sub('message-invalid');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    await assert.rejects(
      () => appendBotPendencyMessage(d, { pendencyId: item.id, role: 'user', content: '   ' }, T2),
      /write a content or attach/,
    );
    await assert.rejects(
      () => appendBotPendencyMessage(d, { pendencyId: item.id, role: 'user', content: 'x', attachments: 'nope' }, T2),
      /Invalid attachments: expected array/,
    );
    await assert.rejects(
      () => appendBotPendencyMessage(d, { pendencyId: 'missing', role: 'user', content: 'x' }, T2),
      /Pendency not found/,
    );
    await assert.rejects(
      () => appendBotPendencyMessage(d, { pendencyId: item.id, role: 'assistant', content: 'x' }, T2),
      /Invalid message role/,
    );
  }),
]);

// --- completeBotPendency ---
await run([
  test('complete: fills completedAt and is idempotent', async () => {
    const d = sub('complete-ok');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    const completed = await completeBotPendency(d, item.id, T2);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.completedAt, T2);
    assert.equal(completed.updatedAt, T2);
    const again = await completeBotPendency(d, item.id, T2);
    assert.equal(again.status, 'completed');
    assert.equal(again.completedAt, T2);
  }),
  test('complete: blocked while approval is pending', async () => {
    const d = sub('complete-approval');
    const item = await attachBotPendencyApproval(d, {
      botId: 'b', kind: 'work', title: 'T', context: 'c', prompt: 'p',
    }, T);
    await assert.rejects(
      () => completeBotPendency(d, item.id, T2),
      /Resolve the pending approval/,
    );
  }),
  test('complete: unknown pendency throws', async () => {
    const d = sub('complete-missing');
    await assert.rejects(() => completeBotPendency(d, 'missing', T), /Pendency not found/);
  }),
]);

// --- attachBotPendencyApproval ---
await run([
  test('approval: creates protected pendency with pending approval', async () => {
    const d = sub('approval-create');
    const item = await attachBotPendencyApproval(d, {
      botId: 'bot-1',
      kind: 'work',
      title: 'Approval title',
      context: 'Need approval because X',
      prompt: 'Approve?',
    }, T2);
    assert.equal(item.status, 'open');
    assert.equal(item.completedAt, null);
    assert.equal(item.messages[0].role, 'bot');
    assert.equal(item.messages[0].content, 'Need approval because X');
    assert.equal(item.approval.botId, 'bot-1');
    assert.equal(item.approval.pendencyId, item.id);
    assert.equal(item.approval.kind, 'work');
    assert.equal(item.approval.status, 'pending');
    assert.equal(item.approval.createdAt, T2);
    assert.equal(hasOpenBotUserAction(item), true);
  }),
  test('approval: tool kind forwards toolName, workspacePath, and input', async () => {
    const d = sub('approval-tool');
    const item = await attachBotPendencyApproval(d, {
      botId: 'b',
      kind: 'tool',
      title: 'Run browser',
      context: 'Approve running browser: open page',
      prompt: 'Run browser with the approved arguments.',
      toolName: 'browser',
      workspacePath: '/ws',
      input: { url: 'https://example.com' },
    }, T);
    assert.equal(item.approval.kind, 'tool');
    assert.equal(item.approval.toolName, 'browser');
    assert.equal(item.approval.workspacePath, '/ws');
    assert.deepEqual(item.approval.input, { url: 'https://example.com' });
  }),
  test('approval: rejects invalid kind and whitespace fields', async () => {
    const d = sub('approval-invalid');
    await assert.rejects(
      () => attachBotPendencyApproval(d, { botId: 'b', kind: 'other', title: 'T', context: 'c', prompt: 'p' }, T),
      /Invalid approval kind/,
    );
    await assert.rejects(
      () => attachBotPendencyApproval(d, { botId: 'b', kind: 'work', title: 'T', context: 'c', prompt: '  ' }, T),
      /Invalid prompt/,
    );
    await assert.rejects(
      () => attachBotPendencyApproval(d, { botId: 'b', kind: 'work', title: ' ', context: 'c', prompt: 'p' }, T),
      /Invalid title/,
    );
  }),
]);

// --- consumeBotPendencyApproval ---
await run([
  test('consume: requires an explicit boolean decision', async () => {
    const d = sub('consume-strict');
    const item = await attachBotPendencyApproval(d, {
      botId: 'b', kind: 'work', title: 'T', context: 'c', prompt: 'p',
    }, T);
    await assert.rejects(() => consumeBotPendencyApproval(d, item.approval.id, 'yes'), /explicit boolean/);
    await assert.rejects(() => consumeBotPendencyApproval(d, item.approval.id, 1), /explicit boolean/);
    await assert.rejects(() => consumeBotPendencyApproval(d, item.approval.id, null), /explicit boolean/);
  }),
  test('consume: clears approval and appends the user decision atomically', async () => {
    const d = sub('consume-approved');
    const item = await attachBotPendencyApproval(d, {
      botId: 'b', kind: 'work', title: 'T', context: 'c', prompt: 'p',
    }, T);
    const { item: updated, approval } = await consumeBotPendencyApproval(d, item.approval.id, true, T2);
    assert.equal(approval.status, 'pending');
    assert.equal(approval.prompt, 'p');
    assert.equal(updated.approval, null);
    assert.equal(updated.messages.at(-1).role, 'user');
    assert.match(updated.messages.at(-1).content, /approved this request/);
    assert.equal(updated.messages.at(-1).createdAt, T2);
    assert.equal(hasOpenBotUserAction(updated), false);
    const state = await readBotWorkState(d);
    const stored = state.inbox.find((entry) => entry.id === item.id);
    assert.equal(stored.approval, null);
    assert.equal(stored.messages.at(-1).role, 'user');
  }),
  test('consume: denied decision records the denial', async () => {
    const d = sub('consume-denied');
    const item = await attachBotPendencyApproval(d, {
      botId: 'b', kind: 'work', title: 'T', context: 'c', prompt: 'p',
    }, T);
    const { item: updated } = await consumeBotPendencyApproval(d, item.approval.id, false, T2);
    assert.match(updated.messages.at(-1).content, /denied this request/);
    assert.equal(updated.status, 'open', 'a denied pendency stays open for the bot to react');
  }),
  test('consume: unknown approval throws', async () => {
    const d = sub('consume-missing');
    await assert.rejects(() => consumeBotPendencyApproval(d, 'nonexistent', true, T), /Approval not found/);
  }),
]);

// --- appendBotActivity ---
await run([
  test('activity: explicit entries only, with categories', async () => {
    const d = sub('activity-append');
    const entry = await appendBotActivity(d, {
      title: 'Found root cause',
      description: 'Cache invalidation skipped on rename.',
      category: 'discovery',
    }, T);
    assert.equal(entry.title, 'Found root cause');
    assert.equal(entry.category, 'discovery');
    assert.equal(entry.createdAt, T);
    const empty = await appendBotActivity(d, { title: 'T', category: 'progress' }, T);
    assert.equal(empty.description, '');
  }),
  test('activity: rejects invalid category and whitespace title', async () => {
    const d = sub('activity-invalid');
    await assert.rejects(
      () => appendBotActivity(d, { title: 'T', category: 'material' }, T),
      /Invalid activity category/,
    );
    await assert.rejects(
      () => appendBotActivity(d, { title: '  ', category: 'progress' }, T),
      /Invalid title/,
    );
  }),
  test('activity: legacy activity format is rejected without migration', async () => {
    const d = sub('activity-legacy');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.activity), JSON.stringify([{
      id: 'legacy-1',
      workItemId: null,
      type: 'progress',
      summary: 'Old format entry',
      details: '',
      createdAt: T,
    }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Invalid activity/);
  }),
]);

// --- Validation ---
await run([
  test('validation: invalid inbox JSON throws', async () => {
    const d = sub('val-json');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.inbox), '{broken', 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Invalid JSON/);
  }),
  test('validation: invalid inbox schema throws', async () => {
    const d = sub('val-schema');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.inbox), JSON.stringify([{ id: 123 }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Invalid/);
  }),
  test('validation: completedAt must match the status', async () => {
    const d = sub('val-completedat');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.inbox), JSON.stringify([{
      id: 'p1',
      title: 'T',
      status: 'open',
      messages: [{ id: 'm1', role: 'bot', content: 'C', attachments: [], createdAt: T }],
      approval: null,
      createdAt: T,
      updatedAt: T,
      completedAt: T,
    }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /completedAt/);
  }),
  test('validation: duplicate pendency ids throw', async () => {
    const d = sub('val-dupids');
    await mkdir(d, { recursive: true });
    const pendency = {
      id: 'dup-id',
      title: 'T',
      status: 'open',
      messages: [{ id: 'm1', role: 'bot', content: 'C', attachments: [], createdAt: T }],
      approval: null,
      createdAt: T,
      updatedAt: T,
      completedAt: null,
    };
    await writeFile(join(d, BOT_WORK_STATE_FILES.inbox), JSON.stringify([pendency, { ...pendency }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Duplicate pendency id/);
  }),
  test('validation: pending approval must belong to an open pendency', async () => {
    const d = sub('val-approval-link');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.inbox), JSON.stringify([{
      id: 'p1',
      title: 'T',
      status: 'completed',
      messages: [{ id: 'm1', role: 'bot', content: 'C', attachments: [], createdAt: T }],
      approval: {
        id: 'a1', botId: 'b', pendencyId: 'p1', kind: 'work',
        context: 'c', prompt: 'p', status: 'pending', createdAt: T, updatedAt: T,
      },
      createdAt: T,
      updatedAt: T,
      completedAt: T,
    }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /pending approval must belong to an open pendency/);
  }),
]);

// --- Lock concurrency ---
await run([
  test('lock: serial execution via mutateBotWorkState', async () => {
    const order = [];
    await Promise.all([
      mutateBotWorkState('lock-test', async () => {
        await new Promise((r) => setTimeout(r, 40));
        order.push(1);
      }),
      mutateBotWorkState('lock-test', async () => {
        order.push(2);
      }),
      mutateBotWorkState('lock-test', async () => {
        order.push(3);
      }),
    ]);
    assert.deepEqual(order, [1, 2, 3]);
  }),
  test('lock: concurrent creates produce all pendencies with unique ids', async () => {
    const d = sub('lock-concurrent-create');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createBotPendency(d, { title: `Pendency ${i}`, content: `Content ${i}` }, T)),
    );
    const state = await readBotWorkState(d);
    assert.equal(state.inbox.length, 10);
    assert.equal(new Set(state.inbox.map((item) => item.id)).size, 10);
    assert.equal(new Set(results.map((item) => item.id)).size, 10);
  }),
  test('lock: concurrent messages are all persisted in order', async () => {
    const d = sub('lock-concurrent-messages');
    const item = await createBotPendency(d, { title: 'T', content: 'C' }, T);
    await Promise.all(
      ['first', 'second', 'third', 'fourth', 'fifth'].map((suffix) =>
        appendBotPendencyMessage(d, {
          pendencyId: item.id,
          role: 'user',
          content: `Reply ${suffix}.`,
        }, T2)),
    );
    const state = await readBotWorkState(d);
    const stored = state.inbox.find((entry) => entry.id === item.id);
    assert.deepEqual(
      stored.messages.slice(-5).map((message) => message.content),
      ['Reply first.', 'Reply second.', 'Reply third.', 'Reply fourth.', 'Reply fifth.'],
    );
  }),
]);

// --- Report ---
console.log(`\nBot work state tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`\n  FAIL: ${name}`);
    console.error(`    ${err?.message || err}`);
  }
}

try { rmSync(root, { recursive: true, force: true }); } catch {}
