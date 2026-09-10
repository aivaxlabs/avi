const weights = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };

export function compareNotes(a, b, orderBy = 'urgency', now = Date.now()) {
  let difference = 0;
  if (orderBy === 'manual') difference = a.position - b.position;
  if (orderBy === 'priority') difference = weights[b.priority] - weights[a.priority];
  if (orderBy === 'createdAt' || orderBy === 'updatedAt') difference = Date.parse(b[orderBy]) - Date.parse(a[orderBy]);
  if (orderBy === 'dueAt') difference = (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity);
  if (orderBy === 'urgency') {
    const scores = [a, b].map((note) => weights[note.priority] * 2 + (note.dueAt ? Math.max(-4, Math.min(12, 4 - (Date.parse(note.dueAt) - now) / 86400000)) : 0));
    difference = Number(a.done) - Number(b.done) || scores[1] - scores[0];
  }
  return difference || a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
