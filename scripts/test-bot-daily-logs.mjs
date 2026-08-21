import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BOT_DAILY_LOG_STATUSES,
  botDailyLogDate,
  botDailyLogFileName,
  mutateBotDailyLogs,
  readBotDailyLogs,
  updateBotDailyLog,
  writeBotDailyLog,
} from '../src/main/bot-daily-logs.js';

const workingFolder = await mkdtemp(join(tmpdir(), 'avi-bot-daily-logs-'));

try {
  await Promise.all(BOT_DAILY_LOG_STATUSES.map((status) => (
    writeFile(join(workingFolder, botDailyLogFileName(status)), '[]\n', 'utf8')
  )));

  const firstDate = new Date(2026, 7, 21, 10, 30);
  const entry = await writeBotDailyLog(workingFolder, {
    title: 'Investigate renderer failure',
    content: 'Reproduced the issue and recorded the failing route.',
    status: 'backlog',
  }, firstDate);
  assert.equal(entry.date, botDailyLogDate(firstDate));
  assert.equal(entry.status, 'backlog');

  assert.deepEqual(
    await readBotDailyLogs(workingFolder, { status: 'backlog' }),
    [entry],
  );
  assert.deepEqual(
    await readBotDailyLogs(workingFolder, { date: entry.date }),
    [entry],
  );
  assert.deepEqual(
    await readBotDailyLogs(workingFolder, { date: '2026-08-20' }),
    [],
  );

  const edited = await updateBotDailyLog(workingFolder, {
    id: entry.id,
    operation: 'edit',
    content: 'Reproduced the issue and isolated the failing route.',
  }, new Date(2026, 7, 21, 11, 0));
  assert.equal(edited.title, entry.title);
  assert.equal(edited.content, 'Reproduced the issue and isolated the failing route.');
  assert.equal(edited.status, 'backlog');
  assert.equal(edited.date, entry.date);

  const moved = await updateBotDailyLog(workingFolder, {
    id: entry.id,
    operation: 'move',
    status: 'ongoing',
    title: 'Fix renderer failure',
  }, new Date(2026, 7, 21, 11, 30));
  assert.equal(moved.status, 'ongoing');
  assert.equal(moved.title, 'Fix renderer failure');
  assert.deepEqual(await readBotDailyLogs(workingFolder, { status: 'backlog' }), []);
  assert.deepEqual(await readBotDailyLogs(workingFolder, { status: 'ongoing' }), [moved]);

  const removed = await updateBotDailyLog(workingFolder, {
    id: entry.id,
    operation: 'remove',
  });
  assert.equal(removed.removed, true);
  assert.equal(removed.entry.id, entry.id);
  assert.deepEqual(await readBotDailyLogs(workingFolder, { status: 'ongoing' }), []);

  const approval = {
    id: 'approval-1',
    botId: 'bot-1',
    kind: 'work',
    title: 'Apply renderer fix',
    content: 'Requires explicit user approval.',
    context: 'Requires explicit user approval.',
    prompt: 'Apply the renderer fix.',
    status: 'waiting-user-approval',
    date: '2026-08-21',
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
  };
  await writeFile(
    join(workingFolder, 'waiting-user-approval.json'),
    `${JSON.stringify([approval], null, 2)}\n`,
    'utf8',
  );
  await assert.rejects(
    updateBotDailyLog(workingFolder, { id: approval.id, operation: 'remove' }),
    /approval workflow/,
  );

  const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) => (
    mutateBotDailyLogs('bot-1', () => writeBotDailyLog(workingFolder, {
      title: `Concurrent entry ${index + 1}`,
      content: `Result ${index + 1}`,
      status: 'done',
    }, new Date(2026, 7, 21, 13, index)))
  )));
  assert.equal(concurrent.length, 4);
  assert.equal((await readBotDailyLogs(workingFolder, { status: 'done' })).length, 4);

  await assert.rejects(
    writeBotDailyLog(workingFolder, { title: 'Invalid', content: 'Invalid', status: 'waiting-user-approval' }),
    /status must be one of/,
  );
  await assert.rejects(
    readBotDailyLogs(workingFolder, { date: '08/21/2026' }),
    /YYYY-MM-DD/,
  );
  await assert.rejects(
    readBotDailyLogs(workingFolder, { date: '2026-02-30' }),
    /valid date/,
  );
  await assert.rejects(
    updateBotDailyLog(workingFolder, {
      id: concurrent[0].id,
      operation: 'edit',
    }),
    /requires title and\/or content/,
  );

  const doneFile = JSON.parse(await readFile(join(workingFolder, 'done.json'), 'utf8'));
  assert.equal(doneFile.length, 4);
  console.log('bot daily log tests passed');
} finally {
  await rm(workingFolder, { recursive: true, force: true });
}
