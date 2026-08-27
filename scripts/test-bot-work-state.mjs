import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  BOT_WORK_ITEM_STATES,
  BOT_WORK_PRIORITIES,
  BOT_ATTENTION_TYPES,
  BOT_EVIDENCE_TYPES,
  BOT_ACTIVITY_TYPES,
  BOT_WORK_STATE_FILES,
  ensureBotWorkStateFiles,
  readBotWorkState,
  mutateBotWorkState,
  createBotWorkItem,
  updateBotWorkItem,
  appendBotActivity,
  createBotWorkApproval,
  consumeBotWorkApproval,
} from '../src/main/bot-work-state.js';

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
const OBJ = 'Deliver the requested feature end-to-end';

// --- Constants ---
await run([
  test('constants: BOT_WORK_STATE_FILES', async () => {
    assert.equal(BOT_WORK_STATE_FILES.workItems, 'work-items.json');
    assert.equal(BOT_WORK_STATE_FILES.activity, 'activity.json');
  }),
  test('constants: BOT_WORK_ITEM_STATES', async () => {
    assert.deepEqual(BOT_WORK_ITEM_STATES, new Set(['planned', 'active', 'waiting', 'completed', 'cancelled']));
  }),
  test('constants: BOT_WORK_PRIORITIES', async () => {
    assert.deepEqual(BOT_WORK_PRIORITIES, new Set(['critical', 'high', 'normal', 'low']));
  }),
  test('constants: BOT_ATTENTION_TYPES', async () => {
    assert.deepEqual(BOT_ATTENTION_TYPES, new Set(['approval', 'review', 'answer']));
  }),
  test('constants: BOT_EVIDENCE_TYPES', async () => {
    assert.deepEqual(BOT_EVIDENCE_TYPES, new Set(['file_reference', 'external_reference', 'text']));
  }),
  test('constants: BOT_ACTIVITY_TYPES', async () => {
    assert.ok(BOT_ACTIVITY_TYPES.has('created'));
    assert.ok(BOT_ACTIVITY_TYPES.has('approval'));
    assert.equal(BOT_ACTIVITY_TYPES.size, 11);
  }),
]);

// --- ensureBotWorkStateFiles ---
await run([
  test('ensure: creates default files on empty folder', async () => {
    const d = sub('ensure-create');
    await ensureBotWorkStateFiles(d);
    const wi = await readFile(join(d, 'work-items.json'), 'utf8');
    const act = await readFile(join(d, 'activity.json'), 'utf8');
    assert.equal(wi.trim(), '[]');
    assert.equal(act.trim(), '[]');
  }),
  test('ensure: does not overwrite existing files', async () => {
    const d = sub('ensure-nooverwrite');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'work-items.json'), '[1]\n', 'utf8');
    await ensureBotWorkStateFiles(d);
    const wi = await readFile(join(d, 'work-items.json'), 'utf8');
    assert.equal(wi.trim(), '[1]');
  }),
]);

// --- readBotWorkState defaults ---
await run([
  test('read: returns defaults for missing files', async () => {
    const d = sub('read-defaults');
    const state = await readBotWorkState(d);
    assert.deepEqual(state.workItems, []);
    assert.deepEqual(state.activity, []);
  }),
  test('read: normalizes legacy string evidence', async () => {
    const d = sub('read-legacy-evidence');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'work-items.json'), `${JSON.stringify([{
      id: 'legacy', title: 'Legacy', objective: OBJ, state: 'active', summary: '',
      lastProgress: '', nextStep: '', attention: null, blocker: null, priority: 'normal',
      workerThreadIds: [], evidence: ['https://example.com/pr/1', 'validated locally'],
      createdAt: T, updatedAt: T, completedAt: null,
    }])}\n`, 'utf8');
    const state = await readBotWorkState(d);
    assert.deepEqual(state.workItems[0].evidence, [
      { type: 'external_reference', value: 'https://example.com/pr/1' },
      { type: 'text', value: 'validated locally' },
    ]);
  }),
]);

// --- CRUD create ---
await run([
  test('create: produces valid item with defaults', async () => {
    const d = sub('create-ok');
    const item = await createBotWorkItem(d, { title: 'My item', objective: OBJ }, T);
    assert.equal(item.title, 'My item');
    assert.equal(item.objective, OBJ);
    assert.equal(item.state, 'planned');
    assert.equal(item.priority, 'normal');
    assert.deepEqual(item.workerThreadIds, []);
    assert.deepEqual(item.evidence, []);
    assert.equal(item.attention, null);
    assert.equal(item.blocker, null);
    assert.equal(item.approval, undefined);
    assert.equal(item.completedAt, null);
    assert.equal(item.createdAt, T);
    assert.equal(item.updatedAt, T);
    assert.equal(typeof item.id, 'string');
  }),
  test('create: with explicit next step, priority, and workerThreadIds', async () => {
    const d = sub('create-explicit');
    const item = await createBotWorkItem(d, {
      title: 'T', objective: OBJ, nextStep: 'Inspect the current implementation.', priority: 'high', workerThreadIds: ['w1', 'w2'],
    }, T);
    assert.equal(item.nextStep, 'Inspect the current implementation.');
    assert.equal(item.priority, 'high');
    assert.deepEqual(item.workerThreadIds, ['w1', 'w2']);
  }),
  test('create: generates activity entry', async () => {
    const d = sub('create-activity');
    await createBotWorkItem(d, { title: 'Foo', objective: OBJ }, T);
    const state = await readBotWorkState(d);
    assert.equal(state.activity.length, 1);
    assert.equal(state.activity[0].type, 'created');
    assert.equal(state.activity[0].createdAt, T);
  }),
  test('create: invalid priority throws', async () => {
    const d = sub('create-badprio');
    await assert.rejects(
      () => createBotWorkItem(d, { title: 'T', objective: OBJ, priority: 'mega' }, T),
      /Invalid priority/,
    );
  }),
  test('create: duplicate workerThreadIds throws', async () => {
    const d = sub('create-dupworkers');
    await assert.rejects(
      () => createBotWorkItem(d, { title: 'T', objective: OBJ, workerThreadIds: ['a', 'a'] }, T),
      /Duplicate workerThreadIds entry/,
    );
  }),
  test('create: missing objective rejects', async () => {
    const d = sub('create-no-obj');
    await assert.rejects(
      () => createBotWorkItem(d, { title: 'T' }, T),
      /objective/,
    );
  }),
]);

// --- CRUD update ---
await run([
  test('update: patches fields and preserves completedAt=null for active', async () => {
    const d = sub('update-patch');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const updated = await updateBotWorkItem(d, { id: item.id, state: 'active', summary: 'S' }, T2);
    assert.equal(updated.state, 'active');
    assert.equal(updated.summary, 'S');
    assert.equal(updated.completedAt, null);
    assert.equal(updated.updatedAt, T2);
  }),
  test('update: completed work requires a final summary and clears open state', async () => {
    const d = sub('update-completed');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ, nextStep: 'Run validation.' }, T);
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, state: 'completed' }, T2),
      /summary for completed work/,
    );
    await updateBotWorkItem(d, {
      id: item.id,
      state: 'waiting',
      attention: { type: 'review', summary: 'Review the result.' },
      blocker: { reason: 'Review is pending.', waitingOn: 'user' },
    }, T);
    const updated = await updateBotWorkItem(d, {
      id: item.id,
      state: 'completed',
      summary: 'Implemented the requested behavior to remove duplicated reporting, using the existing work-item fields.',
      nextStep: 'This must be cleared.',
    }, T2);
    assert.equal(updated.completedAt, T2);
    assert.equal(updated.nextStep, '');
    assert.equal(updated.attention, null);
    assert.equal(updated.blocker, null);
  }),
  test('update: cancelled work fills completedAt and clears open state', async () => {
    const d = sub('update-cancelled');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await updateBotWorkItem(d, {
      id: item.id,
      state: 'waiting',
      attention: { type: 'answer', summary: 'Answer a question.' },
      blocker: { reason: 'An answer is pending.', waitingOn: 'user' },
    }, T);
    const updated = await updateBotWorkItem(d, { id: item.id, state: 'cancelled' }, T2);
    assert.equal(updated.completedAt, T2);
    assert.equal(updated.attention, null);
    assert.equal(updated.blocker, null);
  }),
  test('update: clears completedAt when transitioning from completed to active', async () => {
    const d = sub('update-clear-completed');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await updateBotWorkItem(d, { id: item.id, state: 'completed', summary: 'Completed the first item for the transition test.' }, T2);
    const item2 = await createBotWorkItem(d, { title: 'T2', objective: OBJ }, T);
    const active = await updateBotWorkItem(d, { id: item2.id, state: 'active' }, T2);
    assert.equal(active.completedAt, null);
  }),
  test('update: throws on missing id', async () => {
    const d = sub('update-missing');
    await assert.rejects(
      () => updateBotWorkItem(d, { id: 'nonexistent', title: 'x' }, T),
      /not found/,
    );
  }),
  test('update: waiting without attention/blocker throws', async () => {
    const d = sub('update-waiting-needs');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, state: 'waiting' }, T),
      /attention or blocker/,
    );
  }),
  test('update: waiting with attention is valid', async () => {
    const d = sub('update-waiting-att');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const updated = await updateBotWorkItem(d, {
      id: item.id,
      state: 'waiting',
      attention: { type: 'review', summary: 'Needs review' },
    }, T);
    assert.equal(updated.state, 'waiting');
  }),
  test('update: waiting with blocker is valid', async () => {
    const d = sub('update-waiting-block');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const updated = await updateBotWorkItem(d, {
      id: item.id,
      state: 'waiting',
      blocker: { reason: 'Missing dep', waitingOn: 'other' },
    }, T);
    assert.equal(updated.state, 'waiting');
  }),
  test('update: accepts typed evidence', async () => {
    const d = sub('update-evidence');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const evidence = [
      { type: 'file_reference', value: './src/main/bot-work-state.js' },
      { type: 'external_reference', value: 'https://example.com/pr/1' },
      { type: 'text', value: 'Focused tests passed.' },
    ];
    const updated = await updateBotWorkItem(d, { id: item.id, evidence }, T);
    assert.deepEqual(updated.evidence, evidence);
  }),
  test('update: rejects invalid evidence types and references', async () => {
    const d = sub('update-invalid-evidence');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, evidence: [{ type: 'unknown', value: 'x' }] }, T),
      /Invalid evidence type/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, evidence: [{ type: 'external_reference', value: 'file:///tmp/report' }] }, T),
      /Invalid external_reference/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, evidence: [{ type: 'file_reference', value: 'src/main/bot-work-state.js' }] }, T),
      /Invalid file_reference/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, evidence: ['legacy text'] }, T),
      /Invalid evidence entry/,
    );
  }),
  test('update: duplicate evidence throws', async () => {
    const d = sub('update-dupev');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await assert.rejects(
      () => updateBotWorkItem(d, {
        id: item.id,
        evidence: [
          { type: 'text', value: 'e1' },
          { type: 'text', value: 'e1' },
        ],
      }, T),
      /Duplicate evidence entry/,
    );
  }),
]);

// --- Approval protection ---
await run([
  test('approval: create forces waiting + attention, returns updated item', async () => {
    const d = sub('approval-create');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const updated = await createBotWorkApproval(d, {
      botId: 'bot-1', workItemId: item.id, kind: 'work', context: 'Need approval', prompt: 'Approve?',
    }, T2);
    assert.equal(updated.state, 'waiting');
    assert.deepEqual(updated.attention, { type: 'approval', summary: 'Need approval' });
    assert.ok(updated.approval);
    assert.equal(updated.approval.status, 'pending');
    assert.equal(updated.approval.kind, 'work');
    assert.equal(updated.completedAt, null);
    assert.equal(updated.updatedAt, T2);
  }),
  test('approval: optional fields forwarded', async () => {
    const d = sub('approval-optional');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const updated = await createBotWorkApproval(d, {
      botId: 'b', workItemId: item.id, kind: 'tool', context: 'c', prompt: 'p',
      toolName: 'browser', workspacePath: '/ws', input: 'do it',
    }, T);
    assert.equal(updated.approval.toolName, 'browser');
    assert.equal(updated.approval.workspacePath, '/ws');
    assert.equal(updated.approval.input, 'do it');
  }),
  test('approval: duplicate approval on same item throws', async () => {
    const d = sub('approval-dup');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await createBotWorkApproval(d, { botId: 'b', workItemId: item.id, kind: 'work', context: 'c', prompt: 'p' }, T);
    await assert.rejects(
      () => createBotWorkApproval(d, { botId: 'b', workItemId: item.id, kind: 'work', context: 'c2', prompt: 'p2' }, T),
      /already has a pending approval/,
    );
  }),
  test('approval: throws on nonexistent workItemId', async () => {
    const d = sub('approval-noexist');
    await assert.rejects(
      () => createBotWorkApproval(d, { botId: 'b', workItemId: 'nope', kind: 'work', context: 'c', prompt: 'p' }, T),
      /not found/,
    );
  }),
  test('approval: update cannot change state/attention/blocker while pending', async () => {
    const d = sub('approval-protect');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await createBotWorkApproval(d, { botId: 'b', workItemId: item.id, kind: 'work', context: 'c', prompt: 'p' }, T);

    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, state: 'active' }, T), /Cannot change state/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, attention: { type: 'review', summary: 's' } }, T), /Cannot change attention/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, blocker: { reason: 'r', waitingOn: 'w' } }, T), /Cannot change blocker/,
    );
    await assert.rejects(
      () => updateBotWorkItem(d, { id: item.id, approval: null }, T), /Cannot modify approval/,
    );
  }),
  test('approval: safe fields can be updated while approval pending', async () => {
    const d = sub('approval-safeupd');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    await createBotWorkApproval(d, { botId: 'b', workItemId: item.id, kind: 'work', context: 'c', prompt: 'p' }, T);
    const updated = await updateBotWorkItem(d, { id: item.id, summary: 'still ok' }, T);
    assert.equal(updated.summary, 'still ok');
  }),
]);

// --- Consume ---
await run([
  test('consume: returns { item, approval }, clears fields, sets active', async () => {
    const d = sub('consume-ok');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const withApproval = await createBotWorkApproval(d, {
      botId: 'b', workItemId: item.id, kind: 'tool', context: 'c', prompt: 'p',
      toolName: 'read_media_file',
    }, T2);
    const result = await consumeBotWorkApproval(d, withApproval.approval.id, T2);

    assert.ok(result.item);
    assert.ok(result.approval);
    assert.equal(result.item.approval, null);
    assert.equal(result.item.attention, null);
    assert.equal(result.item.blocker, null);
    assert.equal(result.item.state, 'active');
    assert.equal(result.item.completedAt, null);
    assert.equal(result.approval.status, 'pending');
    assert.equal(result.approval.kind, 'tool');
    assert.equal(result.approval.toolName, 'read_media_file');
  }),
  test('consume: activity is appended', async () => {
    const d = sub('consume-activity');
    const item = await createBotWorkItem(d, { title: 'T', objective: OBJ }, T);
    const wa = await createBotWorkApproval(d, { botId: 'b', workItemId: item.id, kind: 'work', context: 'c', prompt: 'p' }, T);
    await consumeBotWorkApproval(d, wa.approval.id, T2);
    const state = await readBotWorkState(d);
    const approvalActs = state.activity.filter((a) => a.type === 'approval');
    assert.equal(approvalActs.length, 2);
    assert.equal(approvalActs[1].summary, 'Approval consumed');
  }),
  test('consume: throws on unknown id', async () => {
    const d = sub('consume-missing');
    await assert.rejects(
      () => consumeBotWorkApproval(d, 'nonexistent', T),
      /not found/,
    );
  }),
]);

// --- appendBotActivity ---
await run([
  test('activity: append works', async () => {
    const d = sub('activity-append');
    const entry = await appendBotActivity(d, { type: 'discovery', summary: 'Found', details: 'details' }, T);
    assert.equal(entry.type, 'discovery');
    assert.equal(entry.workItemId, null);
    assert.equal(entry.createdAt, T);
  }),
  test('activity: invalid type throws', async () => {
    const d = sub('activity-badtype');
    await assert.rejects(
      () => appendBotActivity(d, { type: 'bad', summary: 's' }, T),
      /Invalid activity type/,
    );
  }),
  test('activity: duplicate id in file throws', async () => {
    const d = sub('activity-dup-id');
    await mkdir(d, { recursive: true });
    const dupEntry = {
      id: 'dup-act-id',
      workItemId: null,
      type: 'progress',
      summary: 'First',
      details: '',
      createdAt: T,
    };
    await writeFile(
      join(d, BOT_WORK_STATE_FILES.activity),
      JSON.stringify([dupEntry, { ...dupEntry, summary: 'Second' }]),
      'utf8',
    );
    await assert.rejects(() => readBotWorkState(d), /activity/);
  }),
]);

// --- Validation ---
await run([
  test('validation: invalid JSON throws', async () => {
    const d = sub('val-json');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.workItems), '{broken', 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Invalid JSON/);
  }),
  test('validation: invalid schema throws', async () => {
    const d = sub('val-schema');
    await mkdir(d, { recursive: true });
    await writeFile(join(d, BOT_WORK_STATE_FILES.workItems), JSON.stringify([{ id: 123 }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Invalid/);
  }),
  test('validation: duplicate IDs in file throws', async () => {
    const d = sub('val-dupids');
    await mkdir(d, { recursive: true });
    const item = {
      id: 'dup-id', title: 'T', objective: OBJ, state: 'planned', summary: '',
      lastProgress: '', nextStep: '', attention: null, blocker: null, priority: 'normal',
      workerThreadIds: [], evidence: [], createdAt: T, updatedAt: T, completedAt: null,
    };
    await writeFile(join(d, BOT_WORK_STATE_FILES.workItems), JSON.stringify([item, { ...item }]), 'utf8');
    await assert.rejects(() => readBotWorkState(d), /Duplicate work item id/);
  }),
]);

// --- Arrays únicos ---
await run([
  test('unique: createWorkItem with duplicate workerThreadIds throws', async () => {
    const d = sub('unique-workers');
    await assert.rejects(
      () => createBotWorkItem(d, { title: 'T', objective: OBJ, workerThreadIds: ['a', 'a'] }, T),
      /Duplicate workerThreadIds entry/,
    );
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
  test('lock: concurrent createBotWorkItem produces all items with unique ids', async () => {
    const d = sub('lock-concurrent');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createBotWorkItem(d, { title: `Item ${i}`, objective: `Objective ${i}` }, T),
      ),
    );
    const state = await readBotWorkState(d);
    assert.equal(state.workItems.length, 10);
    const ids = new Set(state.workItems.map((i) => i.id));
    assert.equal(ids.size, 10);
    assert.equal(state.activity.length, 10);
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

process.exit(failed > 0 ? 1 : 0);