export function formatTimeRemaining(targetValue, now = Date.now()) {
  const target = new Date(targetValue).getTime();
  if (!Number.isFinite(target)) return '';

  const milliseconds = target - now;
  if (milliseconds <= 0) return 'now';

  const totalHours = Math.floor(milliseconds / 3_600_000);
  if (totalHours === 0) return 'in <1h';

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
  ].filter(Boolean);

  return `in ${parts.join(' ')}`;
}
