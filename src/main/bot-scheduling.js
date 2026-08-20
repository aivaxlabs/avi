const MINUTE_MS = 60_000;
const DAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

export const ROTATION_FOCUS = Object.freeze([
  {
    id: 'find-work',
    title: 'Find work to do',
    instructions: [
      'Rotation focus: find new work.',
      'Inspect backlog.md, the working folder, and recent thread activity, then select and record one concrete, actionable work item in backlog.md.',
      'Do not start the discovered item in this activation. If nothing new appears, refine one existing backlog item instead.',
    ].join('\n'),
  },
  {
    id: 'review-ongoing',
    title: 'Review ongoing work',
    instructions: [
      'Rotation focus: review what is in progress.',
      'Select one item from ongoing.md and inspect its tracked thread. Check its progress, unblock it when possible, and update its status.',
      'If the selected item is stale or abandoned, move it to blocked.md or discarded.md with a short reason.',
    ].join('\n'),
  },
  {
    id: 'review-agent-work',
    title: 'Review agent output',
    instructions: [
      'Rotation focus: review finished agent work.',
      'Select one thread that reported completion since your last review and verify its delivered result against the request.',
      'Record the verdict and follow-up in done.md or user-review.md; delegate corrections for that item when needed.',
    ].join('\n'),
  },
  {
    id: 'check-user-review',
    title: 'Check user review queue',
    instructions: [
      'Rotation focus: verify user review of completed work.',
      'Select one item from user-review.md and check whether the user already acted on it.',
      'Report a concise summary for that item when a decision is pending; never pressure, just keep its status accurate.',
    ].join('\n'),
  },
  {
    id: 'check-missing-work',
    title: 'Check for gaps',
    instructions: [
      'Rotation focus: verify nothing was left behind.',
      'Cross-check backlog.md, ongoing.md, blocked.md, and delegated threads until you identify one forgotten edge, unfinished follow-up, or documentation gap.',
      'Record that one gap for a later activation; do not start it now.',
    ].join('\n'),
  },
]);

export function rotationFocusFor(index) {
  const normalized = Number(index);
  const position = Number.isInteger(normalized) && normalized >= 0
    ? normalized % ROTATION_FOCUS.length
    : 0;
  return { focus: ROTATION_FOCUS[position], nextIndex: (position + 1) % ROTATION_FOCUS.length };
}

export function isWithinActivationWindow(window, date) {
  const source = window ?? {};
  const days = Array.isArray(source.days) ? source.days.map(Number) : [];
  if (days.length > 0 && !days.includes(date.getDay())) return false;
  const { startMinute, endMinute } = source;
  if (!Number.isInteger(startMinute) && !Number.isInteger(endMinute)) return true;
  const minute = date.getHours() * 60 + date.getMinutes();
  if (Number.isInteger(startMinute) && Number.isInteger(endMinute) && startMinute > endMinute) {
    return minute >= startMinute || minute < endMinute;
  }
  if (Number.isInteger(startMinute) && minute < startMinute) return false;
  if (Number.isInteger(endMinute) && minute >= endMinute) return false;
  return true;
}

export function nextWindowOpening(window, from) {
  const source = window ?? {};
  const days = Array.isArray(source.days) ? source.days.map(Number) : [];
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (days.length === 0 || days.includes(candidate.getDay())) {
      const minute = candidate.getHours() * 60 + candidate.getMinutes();
      const { startMinute, endMinute } = source;
      const wraps = Number.isInteger(startMinute)
        && Number.isInteger(endMinute)
        && startMinute > endMinute;
      const minuteInside = Number.isInteger(startMinute)
        ? (wraps ? minute >= startMinute || minute < endMinute : minute >= startMinute)
        : true;
      const beforeEnd = Number.isInteger(endMinute)
        ? (wraps ? minute < endMinute : minute < endMinute)
        : true;
      if (minuteInside && beforeEnd) return candidate.getTime();
      const opening = new Date(candidate);
      opening.setHours(0, 0, 0, 0);
      if (Number.isInteger(startMinute)) {
        opening.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
        if (opening.getTime() > candidate.getTime()) return opening.getTime();
      } else if (Number.isInteger(endMinute) && minute < endMinute) {
        return candidate.getTime();
      }
    }
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(0, 0, 0, 0);
    if (Number.isInteger(source.startMinute)) {
      candidate.setHours(Math.floor(source.startMinute / 60), source.startMinute % 60, 0, 0);
    }
  }
  return from.getTime();
}

export function nextActivationFrom(periodMinutes, fromTime) {
  const period = Math.max(1, Number(periodMinutes) || 10);
  return fromTime + period * MINUTE_MS;
}

export function smartIdleUntil(periodMinutes, fromTime) {
  const period = Math.max(1, Number(periodMinutes) || 10);
  return fromTime + period * 4 * MINUTE_MS;
}

export function describeActivationWindow(window) {
  const source = window ?? {};
  const days = Array.isArray(source.days) ? source.days.map(Number).sort((a, b) => a - b) : [];
  const dayLabel = days.length === 0 || days.length === 7
    ? 'every day'
    : days.map((day) => DAY_LABELS[day] ?? String(day)).join(', ');
  const minuteLabel = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const { startMinute, endMinute } = source;
  const timeLabel = Number.isInteger(startMinute) && Number.isInteger(endMinute)
    ? `${minuteLabel(startMinute)}-${minuteLabel(endMinute)}`
    : Number.isInteger(startMinute)
      ? `from ${minuteLabel(startMinute)}`
      : Number.isInteger(endMinute)
        ? `until ${minuteLabel(endMinute)}`
        : 'any time';
  return `${dayLabel}, ${timeLabel}`;
}

export function decideActivation({ bot, now = Date.now(), isRunning = false }) {
  if (!bot) return { action: 'skip', reason: 'missing-bot' };
  if (bot.status === 'paused') return { action: 'skip', reason: 'paused' };
  if (isRunning) return { action: 'skip', reason: 'running' };
  if (bot.idleUntil && new Date(bot.idleUntil).getTime() > now) {
    return { action: 'skip', reason: 'idle' };
  }
  if (!isWithinActivationWindow(bot.activationWindow, new Date(now))) {
    return {
      action: 'skip',
      reason: 'outside-window',
      nextActivationAt: new Date(nextWindowOpening(bot.activationWindow, now)).toISOString(),
    };
  }
  if (
    Number.isInteger(bot.maxActivations)
    && bot.maxActivations > 0
    && bot.activationCount >= bot.maxActivations
  ) {
    return { action: 'sleep', reason: 'max-activations' };
  }
  if (bot.nextActivationAt && new Date(bot.nextActivationAt).getTime() > now) {
    return { action: 'skip', reason: 'not-due' };
  }
  return { action: 'activate' };
}
