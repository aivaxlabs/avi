import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  decideActivation,
  describeActivationWindow,
  isWithinActivationWindow,
  nextActivationFrom,
  nextWindowOpening,
  smartIdleUntil,
} from '../src/main/bot-scheduling.js';

const minute = 60_000;
const base = new Date('2026-08-19T12:00:00'); // Wednesday (day 3)
const wednesday = base.getTime();

// isWithinActivationWindow
assert.equal(isWithinActivationWindow({}, base), true, 'empty window allows any time');
assert.equal(
  isWithinActivationWindow({ days: [3] }, base),
  true,
  'matching day allowed',
);
assert.equal(
  isWithinActivationWindow({ days: [0, 6] }, base),
  false,
  'non-matching day blocked',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 9 * 60, endMinute: 18 * 60 }, base),
  true,
  '12:00 inside business hours',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 13 * 60, endMinute: 18 * 60 }, base),
  false,
  '12:00 before afternoon window',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 22 * 60, endMinute: 6 * 60 }, base),
  false,
  '12:00 outside overnight window',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 22 * 60, endMinute: 6 * 60 }, new Date('2026-08-19T23:30:00')),
  true,
  '23:30 inside overnight window',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 22 * 60, endMinute: 6 * 60 }, new Date('2026-08-19T05:00:00')),
  true,
  '05:00 inside overnight window tail',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 9 * 60, endMinute: 18 * 60, days: [1, 3, 5] }, base),
  true,
  'day plus time range both applied',
);
assert.equal(
  isWithinActivationWindow({ endMinute: 0 }, base),
  false,
  'an until-midnight-only window is empty',
);
assert.equal(
  isWithinActivationWindow({ startMinute: 9 * 60, endMinute: 9 * 60 }, base),
  false,
  'equal time bounds form an empty window',
);

// nextWindowOpening
assert.equal(
  nextWindowOpening({ startMinute: 13 * 60 }, base),
  new Date('2026-08-19T13:00:00').getTime(),
  'same-day opening',
);
assert.equal(
  nextWindowOpening({ days: [4], startMinute: 9 * 60 }, base),
  new Date('2026-08-20T09:00:00').getTime(),
  'next allowed day opening',
);
assert.equal(
  nextWindowOpening({ startMinute: 22 * 60, endMinute: 6 * 60 }, new Date('2026-08-19T07:00:00')),
  new Date('2026-08-19T22:00:00').getTime(),
  'overnight window reopens at night',
);
assert.equal(
  nextWindowOpening({ endMinute: 0 }, wednesday),
  wednesday,
  'empty windows return a numeric epoch without searching for an opening',
);
assert.equal(
  nextWindowOpening({ startMinute: 9 * 60, endMinute: 9 * 60 }, wednesday),
  wednesday,
  'equal bounds return a numeric epoch without searching for an opening',
);

// activation math
assert.equal(nextActivationFrom(10, wednesday), wednesday + 10 * minute);
assert.equal(nextActivationFrom(0, wednesday), wednesday + 10 * minute, 'invalid period falls back to 10');
assert.equal(smartIdleUntil(15, wednesday), wednesday + 60 * minute, 'smart idle is four periods');

// decideActivation
const defaultBot = {
  workQueue: ['Review current work'],
  status: 'active',
  activationWindow: {},
  maxActivations: 10,
  activationCount: 0,
  nextActivationAt: null,
  idleUntil: null,
};

assert.equal(decideActivation({ bot: defaultBot, now: wednesday }).action, 'activate');
assert.deepEqual(
  decideActivation({ bot: { ...defaultBot, workQueue: [] }, now: wednesday }),
  { action: 'activate' },
  'bots without recurring tasks still activate to review their full scope',
);
assert.equal(decideActivation({ bot: null, now: wednesday }).action, 'skip');
assert.equal(
  decideActivation({ bot: { ...defaultBot, status: 'paused' }, now: wednesday }).action,
  'skip',
  'paused bots never activate',
);
assert.deepEqual(
  decideActivation({ bot: { ...defaultBot, enabled: false }, now: wednesday }),
  { action: 'skip', reason: 'disabled' },
  'disabled bots never activate',
);
assert.equal(
  decideActivation({ bot: defaultBot, now: wednesday, isRunning: true }).action,
  'skip',
  'running bots wait',
);
assert.equal(
  decideActivation({ bot: { ...defaultBot, idleUntil: new Date(wednesday + minute).toISOString() }, now: wednesday }).reason,
  'idle',
  'idle bots wait',
);
assert.equal(
  decideActivation({ bot: { ...defaultBot, nextActivationAt: new Date(wednesday + minute).toISOString() }, now: wednesday }).reason,
  'not-due',
  'future activations wait',
);
assert.equal(
  decideActivation({ bot: { ...defaultBot, maxActivations: 10, activationCount: 10 }, now: wednesday }).action,
  'sleep',
  'max activations starts a sleep period',
);
assert.equal(
  decideActivation({
    bot: {
      ...defaultBot,
      status: 'sleeping',
      maxActivations: 10,
      activationCount: 10,
      idleUntil: new Date(wednesday - minute).toISOString(),
    },
    now: wednesday,
  }).action,
  'wake',
  'activation-limit sleep ends automatically',
);
assert.equal(
  decideActivation({
    bot: { ...defaultBot, status: 'sleeping', maxActivations: 10, activationCount: 10 },
    now: wednesday,
  }).action,
  'wake',
  'legacy sleeping bots without a limit marker wake automatically',
);
assert.equal(
  decideActivation({ bot: { ...defaultBot, maxActivations: 0, activationCount: 999 }, now: wednesday }).action,
  'activate',
  'max activations can be disabled',
);
const outsideWindow = decideActivation({
  bot: { ...defaultBot, activationWindow: { days: [4] } },
  now: wednesday,
});
assert.equal(outsideWindow.reason, 'outside-window');
assert.equal(
  new Date(outsideWindow.nextActivationAt).getTime(),
  new Date('2026-08-20T00:00:00').getTime(),
  'outside-window pushes next activation to the window opening',
);
assert.equal(
  decideActivation({
    bot: { ...defaultBot, activationWindow: { startMinute: 9 * 60, endMinute: 18 * 60 } },
    now: new Date('2026-08-19T18:30:00').getTime(),
  }).reason,
  'outside-window',
  'after hours is outside the window',
);
for (const activationWindow of [{ endMinute: 0 }, { startMinute: 9 * 60, endMinute: 9 * 60 }]) {
  const decision = decideActivation({
    bot: { ...defaultBot, activationWindow },
    now: wednesday,
  });
  assert.equal(decision.reason, 'outside-window', 'empty windows never activate');
  assert.equal(
    new Date(decision.nextActivationAt).getTime(),
    wednesday,
    'empty windows preserve the numeric now epoch',
  );
}

// describeActivationWindow
assert.equal(describeActivationWindow({}), 'every day, any time');
assert.equal(
  describeActivationWindow({ days: [1, 3], startMinute: 540, endMinute: 1080 }),
  'Mon, Wed, 09:00-18:00',
);
assert.equal(describeActivationWindow({ startMinute: 540 }), 'every day, from 09:00');

const [preloadSource, runtimeSource] = await Promise.all([
  readFile(new URL('../src/preload/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/main/runtime.js', import.meta.url), 'utf8'),
]);
const preloadBotChannels = [...preloadSource.matchAll(/invoke\('(bots:[^']+)'/g)]
  .map((match) => match[1]);
assert.ok(preloadBotChannels.length > 0, 'preload must expose bot channels');
for (const channel of preloadBotChannels) {
  assert.ok(
    runtimeSource.includes(`applicationIpc.handle('${channel}'`),
    `runtime must register the ${channel} application handler`,
  );
}

console.log('bot scheduling and IPC contract tests passed');
