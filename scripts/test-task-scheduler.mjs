import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nextCronOccurrence, parseCron } from '../src/shared/cron.js';

const local = (...parts) => new Date(...parts);
assert.equal(nextCronOccurrence('*/15 * * * *', local(2026, 0, 1, 10, 7, 30)).getTime(), local(2026, 0, 1, 10, 15).getTime());
assert.equal(nextCronOccurrence('0 9 * * 1-5', local(2026, 0, 2, 9, 0)).getTime(), local(2026, 0, 5, 9, 0).getTime());
assert.equal(nextCronOccurrence('30 8 1 * *', local(2026, 0, 15)).getTime(), local(2026, 1, 1, 8, 30).getTime());
assert.equal(nextCronOccurrence('0 0 * * 7', local(2026, 0, 1)).getDay(), 0);
assert.equal(nextCronOccurrence('0 0 31 2 *', local(2026, 0, 1)), null);
assert.throws(() => parseCron('* * *'), /five fields/);
assert.throws(() => parseCron('61 * * * *'), /minute/);

const testProfile = mkdtempSync(join(tmpdir(), 'avi-task-scheduler-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;
process.env.HOME = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { TaskScheduler } = await import('../src/main/task-scheduler.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const workspace = join(resolvedProfile, 'workspace');
  await mkdir(workspace, { recursive: true });

  const model = { id: 'test/model', name: 'Test model', reasoning: ['low'] };
  const sends = [];
  const events = [];
  const chatRunner = {
    runs: new Map(),
    stop() {},
    async send(request) {
      sends.push(request);
      database.insertMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        status: 'completed',
        content: 'Done.',
        segments: [{ type: 'tool-call', name: 'read_file', status: 'completed' }],
        usage: { inputTokens: 120, outputTokens: 30 },
      });
      return { message: null };
    },
  };
  const scheduler = new TaskScheduler({
    getChatRunner: () => chatRunner,
    getModels: () => [model],
    getPreferences: () => ({ lastModel: model.id }),
    sendEvent: (event) => events.push(event),
  });
  chatRunner.taskScheduler = scheduler;
  const tool = (name) => CLIENT_TOOLS.find((item) => item.name === name);
  const context = { chatRunner, workspacePath: workspace, model: model.id, reasoningEffort: 'low', permissionMode: 'approve_for_me' };

  assert.equal(CLIENT_TOOLS.filter((item) => item.name.startsWith('task_scheduler_')).length, 8);

  const future = await tool('task_scheduler_schedule_task').execute({
    instruction: 'Summarize the repository.',
    runAt: new Date(Date.now() + 3_600_000).toISOString(),
  }, context);
  assert.equal(future.status, 'scheduled');
  assert.equal(future.folderPath, workspace);
  assert.equal(future.reasoningEffort, 'low');
  assert.equal(future.createdBy, 'agent');
  assert.equal(future.title, 'Summarize the repository.');

  await assert.rejects(
    tool('task_scheduler_schedule_task').execute({ instruction: 'x', permissionMode: 'full_access' }, context),
    /Full access/,
  );
  await assert.rejects(
    tool('task_scheduler_schedule_task').execute({ instruction: 'x', model: 'missing' }, context),
    /not configured/,
  );

  await scheduler.dispatchDueTasks();
  assert.equal(sends.length, 0, 'future tasks must not run early');

  const due = scheduler.scheduleTask({ instruction: 'Run now', folderPath: workspace });
  await scheduler.dispatchDueTasks();
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  assert.equal(sends.length, 1);
  assert.match(sends[0].text, /^<scheduled-task task_id="[^"]+" title="Run now"/);
  assert.equal(sends[0].fromAgent, true);
  assert.equal(sends[0].permissionMode, 'approve_for_me');
  const finished = scheduler.viewTask(due.id);
  assert.ok(finished.conversationId);
  assert.equal(database.getConversation(finished.conversationId).createdBy, 'agent');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.output, 'Done.');
  assert.equal(typeof finished.stats.durationMs, 'number');
  assert.deepEqual(
    { input: finished.stats.inputTokens, output: finished.stats.outputTokens, total: finished.stats.totalTokens, tools: finished.stats.toolCalls },
    { input: 120, output: 30, total: 150, tools: 1 },
  );

  const cancelled = await tool('task_scheduler_cancel_task').execute({ id: future.id }, context);
  assert.equal(cancelled.status, 'cancelled');
  await assert.rejects(tool('task_scheduler_cancel_task').execute({ id: future.id }, context), /cannot be cancelled/);
  assert.equal(scheduler.deleteTask(future.id).deleted, true);

  const listed = await tool('task_scheduler_list_tasks').execute({}, context);
  assert.equal(listed.tasks.length, 1);
  assert.equal('output' in listed.tasks[0], false);

  const job = await tool('task_scheduler_create_recurring_job').execute({ instruction: 'Daily report', cron: '0 9 * * *' }, context);
  assert.equal(job.enabled, true);
  assert.ok(new Date(job.nextRunAt) > new Date());
  await assert.rejects(
    tool('task_scheduler_create_recurring_job').execute({ instruction: 'x', cron: 'bad' }, context),
    /five fields/,
  );

  database.updateRecurringJob(job.id, { nextRunAt: new Date(Date.now() - 1_000).toISOString() });
  scheduler.materializeRecurringJobs();
  const generated = scheduler.listTasks({ recurringJobId: job.id }).tasks;
  assert.equal(generated.length, 1);
  assert.equal(generated[0].status, 'scheduled');
  assert.ok(new Date(scheduler.viewRecurringJob(job.id).nextRunAt) > new Date());

  database.updateRecurringJob(job.id, { nextRunAt: new Date(Date.now() - 1_000).toISOString() });
  scheduler.materializeRecurringJobs();
  assert.equal(scheduler.listTasks({ recurringJobId: job.id }).tasks.length, 1, 'overlapping occurrences are skipped');

  const disabled = scheduler.updateRecurringJob(job.id, { enabled: false });
  assert.equal(disabled.nextRunAt, null);
  assert.equal((await tool('task_scheduler_view_recurring_job').execute({ id: job.id }, context)).recentTasks.length, 1);
  assert.equal(tool('task_scheduler_delete_recurring_job').forceApproval, true);
  await tool('task_scheduler_delete_recurring_job').execute({ id: job.id }, context);
  assert.equal(scheduler.viewTask(generated[0].id).status, 'cancelled');
  assert.equal(scheduler.viewTask(generated[0].id).recurringJobId, null);
  assert.equal((await tool('task_scheduler_list_recurring_jobs').execute({}, context)).jobs.length, 0);
  assert.ok(events.some((event) => event.type === 'recurring-job' && event.deletedId === job.id));

  await assert.rejects(
    tool('task_scheduler_create_recurring_job').execute({ instruction: 'x', cron: '* * * * *', endsAt: '2000-01-01T00:00:00Z' }, context),
    /future/,
  );
  const bounded = await tool('task_scheduler_create_recurring_job').execute({
    instruction: 'Bounded job',
    cron: '* * * * *',
    endsAt: new Date(Date.now() + 90_000).toISOString(),
  }, context);
  assert.ok(bounded.endsAt);
  assert.ok(new Date(bounded.nextRunAt) <= new Date(bounded.endsAt));
  database.updateRecurringJob(bounded.id, { nextRunAt: new Date(Date.now() - 1_000).toISOString() });
  scheduler.materializeRecurringJobs(new Date(Date.now() + 120_000));
  assert.equal(scheduler.listTasks({ recurringJobId: bounded.id }).tasks.length, 1, 'the due occurrence before endsAt still runs');
  assert.equal(scheduler.viewRecurringJob(bounded.id).nextRunAt, null, 'no occurrence is scheduled after endsAt');
  const extended = scheduler.updateRecurringJob(bounded.id, { endsAt: null });
  assert.equal(extended.endsAt, null);
  assert.ok(extended.nextRunAt);
  scheduler.deleteRecurringJob(bounded.id);

  database.updateScheduledTask(due.id, { status: 'running' });
  new TaskScheduler({ getChatRunner: () => null, getModels: () => [model], getPreferences: () => ({}) }).start();
  assert.equal(scheduler.viewTask(due.id).status, 'failed', 'running tasks interrupted by a restart are marked failed');

  console.log('Task scheduler tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
