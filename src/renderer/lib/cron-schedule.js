export const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const minuteIntervals = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
export const scheduleModes = [
  ['minutes', 'Every N minutes'],
  ['hourly', 'Hourly'],
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['advanced', 'Advanced (cron)'],
];

export const defaultSchedule = Object.freeze({
  mode: 'daily',
  interval: 15,
  minute: 0,
  time: '09:00',
  weekdays: [1],
  day: 1,
  cron: '0 9 * * *',
});

const pad = (value) => String(value).padStart(2, '0');
const isNumber = (value, min, max) => /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

function readTime(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? ''));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('Choose a valid time.');
  return [Number(match[1]), Number(match[2])];
}

export function scheduleToCron(schedule) {
  if (schedule.mode === 'advanced') return String(schedule.cron ?? '').trim().replace(/\s+/g, ' ');
  if (schedule.mode === 'minutes') {
    if (!minuteIntervals.includes(Number(schedule.interval))) throw new Error('Choose a supported minute interval.');
    return Number(schedule.interval) === 1 ? '* * * * *' : `*/${Number(schedule.interval)} * * * *`;
  }
  if (schedule.mode === 'hourly') {
    if (!isNumber(String(schedule.minute), 0, 59)) throw new Error('Choose a minute between 0 and 59.');
    return `${Number(schedule.minute)} * * * *`;
  }
  const [hour, minute] = readTime(schedule.time);
  if (schedule.mode === 'daily') return `${minute} ${hour} * * *`;
  if (schedule.mode === 'weekly') {
    if (!schedule.weekdays?.length) throw new Error('Select at least one weekday.');
    return `${minute} ${hour} * * ${[...new Set(schedule.weekdays)].sort((a, b) => a - b).join(',')}`;
  }
  if (schedule.mode === 'monthly') {
    if (!isNumber(String(schedule.day), 1, 31)) throw new Error('Choose a day between 1 and 31.');
    return `${minute} ${hour} ${Number(schedule.day)} * *`;
  }
  throw new Error(`Unknown schedule type "${schedule.mode}".`);
}

// Maps a cron expression back to the friendly preset that generates it; anything else opens in advanced mode.
export function cronToSchedule(expression) {
  const cron = String(expression ?? '').trim().replace(/\s+/g, ' ');
  const base = { ...defaultSchedule, weekdays: [...defaultSchedule.weekdays], mode: 'advanced', cron };
  const fields = cron.split(' ');
  if (fields.length !== 5) return base;
  const [minute, hour, day, month, weekday] = fields;
  if (month !== '*') return base;

  if (hour === '*' && day === '*' && weekday === '*') {
    const step = /^\*\/(\d+)$/.exec(minute);
    if (minute === '*') return { ...base, mode: 'minutes', interval: 1 };
    if (step && minuteIntervals.includes(Number(step[1]))) return { ...base, mode: 'minutes', interval: Number(step[1]) };
    if (isNumber(minute, 0, 59)) return { ...base, mode: 'hourly', minute: Number(minute) };
    return base;
  }

  if (!isNumber(minute, 0, 59) || !isNumber(hour, 0, 23)) return base;
  const time = `${pad(Number(hour))}:${pad(Number(minute))}`;
  if (day === '*' && weekday === '*') return { ...base, mode: 'daily', time };
  if (day === '*' && /^[0-7](,[0-7])*$/.test(weekday)) {
    const weekdays = [...new Set(weekday.split(',').map((value) => Number(value) % 7))].sort((a, b) => a - b);
    return { ...base, mode: 'weekly', time, weekdays };
  }
  if (isNumber(day, 1, 31) && weekday === '*') return { ...base, mode: 'monthly', time, day: Number(day) };
  return base;
}

export function describeCron(expression) {
  const schedule = cronToSchedule(expression);
  if (schedule.mode === 'minutes') return schedule.interval === 1 ? 'Every minute' : `Every ${schedule.interval} minutes`;
  if (schedule.mode === 'hourly') return `Hourly at :${pad(schedule.minute)}`;
  if (schedule.mode === 'daily') return `Daily at ${schedule.time}`;
  if (schedule.mode === 'weekly') {
    return `Weekly on ${schedule.weekdays.map((day) => weekdayLabels[day]).join(', ')} at ${schedule.time}`;
  }
  if (schedule.mode === 'monthly') return `Monthly on day ${schedule.day} at ${schedule.time}`;
  return `Custom (${schedule.cron})`;
}
