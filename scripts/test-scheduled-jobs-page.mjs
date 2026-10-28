import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCron } from '../src/shared/cron.js';
import { cronToSchedule, defaultSchedule, describeCron, scheduleToCron } from '../src/renderer/lib/cron-schedule.js';

const presets = [
  [{ mode: 'minutes', interval: 1 }, '* * * * *', 'Every minute'],
  [{ mode: 'minutes', interval: 15 }, '*/15 * * * *', 'Every 15 minutes'],
  [{ mode: 'hourly', minute: 5 }, '5 * * * *', 'Hourly at :05'],
  [{ mode: 'daily', time: '09:30' }, '30 9 * * *', 'Daily at 09:30'],
  [{ mode: 'weekly', time: '18:00', weekdays: [5, 1, 3] }, '0 18 * * 1,3,5', 'Weekly on Mon, Wed, Fri at 18:00'],
  [{ mode: 'monthly', time: '07:05', day: 31 }, '5 7 31 * *', 'Monthly on day 31 at 07:05'],
];

for (const [changes, cron, description] of presets) {
  const schedule = { ...defaultSchedule, ...changes };
  assert.equal(scheduleToCron(schedule), cron);
  parseCron(cron);
  const parsed = cronToSchedule(cron);
  assert.equal(parsed.mode, schedule.mode, cron);
  assert.equal(scheduleToCron(parsed), cron, `round trip ${cron}`);
  assert.equal(describeCron(cron), description);
}

for (const cron of ['0 9 * * 1-5', '*/7 * * * *', '0 */2 * * *', '0 9 1 1 *', '0 9 1 * 1', 'bad', '']) {
  assert.equal(cronToSchedule(cron).mode, 'advanced', cron);
  assert.equal(cronToSchedule(cron).cron, cron.trim());
}
assert.deepEqual(cronToSchedule('0 8 * * 7,1').weekdays, [0, 1]);
assert.equal(describeCron('0 9 * * 1-5'), 'Custom (0 9 * * 1-5)');
assert.equal(scheduleToCron({ ...defaultSchedule, mode: 'advanced', cron: '  0  9 * * 1-5 ' }), '0 9 * * 1-5');
assert.throws(() => scheduleToCron({ ...defaultSchedule, mode: 'weekly', weekdays: [] }), /weekday/);
assert.throws(() => scheduleToCron({ ...defaultSchedule, mode: 'hourly', minute: 60 }), /minute/);
assert.throws(() => scheduleToCron({ ...defaultSchedule, mode: 'monthly', day: 0 }), /day/);
assert.throws(() => scheduleToCron({ ...defaultSchedule, mode: 'daily', time: '' }), /time/);

const noop = () => {};
globalThis.window = {
  setInterval: () => 0,
  clearInterval: noop,
  chatApp: {
    folders: { list: () => Promise.reject(new Error('offline')) },
    taskScheduler: {
      onEvent: () => noop,
      listTasks: () => Promise.reject(new Error('unavailable')),
      listRecurringJobs: () => Promise.reject(new Error('unavailable')),
    },
  },
};
const { ScheduledJobsPage } = await import('../src/renderer/components/ScheduledJobsPage.jsx');
const markup = renderToStaticMarkup(React.createElement(ScheduledJobsPage, {
  models: [{ id: 'm1', name: 'Model one', providerId: 'p', providerName: 'Provider', reasoning: [] }],
  defaultFolder: { path: 'C:\\Code\\Alpha', name: 'Alpha' },
  defaultModel: 'm1',
  onOpenThread: noop,
}));
assert.match(markup, /<h2>Scheduled jobs<\/h2>/);
assert.match(markup, /role="tab" aria-selected="true"[^>]*>Tasks</);
assert.match(markup, />Recurring jobs</);
assert.match(markup, /New task/);
assert.match(markup, /role="status">Loading\.\.\.</);

console.log('Scheduled jobs cron presets and page rendering tests passed.');
