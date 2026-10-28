const CRON_FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

const MAX_SEARCH_YEARS = 5;

function parseField(source, { name, min, max }) {
  const values = new Set();
  for (const part of source.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid cron ${name} field: "${source}".`);
    const [, range, stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    let [start, end] = range === '*'
      ? [min, max]
      : range.split('-').map(Number);
    if (end === undefined) end = stepText === undefined ? start : max;
    if (step < 1 || start < min || end > max || start > end) {
      throw new Error(`Invalid cron ${name} field: "${source}".`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

export function parseCron(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('Cron expressions need five fields: minute hour day-of-month month day-of-week.');
  }
  const [minutes, hours, days, months, weekdays] = fields.map((field, index) => parseField(field, CRON_FIELDS[index]));
  if (weekdays.has(7)) weekdays.add(0);
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    anyDay: fields[2] === '*',
    anyWeekday: fields[4] === '*',
  };
}

function matchesDay(cron, date) {
  const dayMatch = cron.days.has(date.getDate());
  const weekdayMatch = cron.weekdays.has(date.getDay());
  // Standard cron: when both day fields are restricted, either one matching is enough.
  if (cron.anyDay) return weekdayMatch;
  if (cron.anyWeekday) return dayMatch;
  return dayMatch || weekdayMatch;
}

// Returns the first local-time occurrence strictly after `from`, or null when none exists within five years.
export function nextCronOccurrence(expression, from = new Date()) {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = new Date(date);
  limit.setFullYear(limit.getFullYear() + MAX_SEARCH_YEARS);

  while (date <= limit) {
    if (!cron.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
    } else if (!matchesDay(cron, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    } else if (!cron.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!cron.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
    } else {
      return date;
    }
  }
  return null;
}
