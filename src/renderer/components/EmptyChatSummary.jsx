import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, Inbox } from 'lucide-react';
import { hasOpenBotUserAction } from '../../shared/bot-work-items.js';

export function EmptyChatSummary({ folderPath, bots = [], botDataByBot = {}, botsLoading, botsError, onOpenInbox, onOpenNotes }) {
  const [today, setToday] = useState({ notes: [], total: 0, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const unsubscribe = window.chatApp.notes.onChanged(refresh);
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(-1);
    window.chatApp.notes.search({
      folderPath: folderPath ?? null, done: false, archived: false,
      dueAfter: start.toISOString(), dueBefore: end.toISOString(), orderBy: 'dueAt', limit: 3,
    }).then((result) => {
      if (active) setToday({ ...result, loading: false, error: '' });
    }).catch(() => {
      if (active) setToday({ notes: [], total: 0, loading: false, error: 'Could not load today’s notes.' });
    });
    return () => { active = false; };
  }, [folderPath, revision]);

  const inbox = [];
  let inboxUnavailable = Boolean(botsError);
  for (const bot of bots) {
    const data = botDataByBot[bot.id];
    if (data?.errors?.inbox || data?.error) inboxUnavailable = true;
    for (const item of data?.inbox ?? []) {
      if (item.status === 'open') inbox.push({ bot, item });
    }
  }
  inbox.sort((a, b) => new Date(b.item.updatedAt) - new Date(a.item.updatedAt));

  return <div className="empty-chat-summary">
    <section className={!botsLoading && !inboxUnavailable && !inbox.length ? 'summary-empty' : ''} aria-label="Bot inbox" aria-busy={botsLoading}>
      <header>
        <h2><Inbox size={16} aria-hidden="true" />Bot inbox{!botsLoading && <span className="summary-count">{inbox.length}</span>}</h2>
        <button type="button" className="summary-open" onClick={() => onOpenInbox()} aria-label="Open bot inbox">View inbox<ArrowUpRight size={14} aria-hidden="true" /></button>
      </header>
      <p className="summary-caption">Latest open messages · all bots</p>
      {botsLoading ? <p className="summary-state" role="status">Loading inbox...</p> : <>
        {inboxUnavailable && <p className="summary-state" role="status">Some inbox messages could not be loaded.</p>}
        {!inboxUnavailable && !inbox.length && <p className="summary-state">No open messages. You’re all caught up.</p>}
        <ul>{inbox.slice(0, 3).map(({ bot, item }) => <li key={item.id}>
          <button type="button" className="summary-item" onClick={() => onOpenInbox(bot.id, item.id)}>
            <span className="summary-meta"><span>{bot.name}</span><span>{hasOpenBotUserAction(item) ? 'Needs you' : 'Waiting for bot'}</span></span>
            <strong>{item.title}</strong>
            <span className="summary-preview">{item.messages.at(-1)?.role === 'user' ? 'You: ' : ''}{item.messages.at(-1)?.content || 'Attachment'}</span>
          </button>
        </li>)}</ul>
      </>}
    </section>
    <section className={!today.loading && !today.error && today.total === 0 ? 'summary-empty' : ''} aria-label="Notes due today" aria-busy={today.loading}>
      <header>
        <h2><CalendarDays size={16} aria-hidden="true" />Due today{!today.loading && !today.error && <span className="summary-count">{today.total}</span>}</h2>
        <button type="button" className="summary-open" onClick={onOpenNotes} aria-label="Open notes">Open notes<ArrowUpRight size={14} aria-hidden="true" /></button>
      </header>
      <p className="summary-caption" title={folderPath ?? 'No working folder'}>Notes · current working folder</p>
      {today.loading ? <p className="summary-state" role="status">Loading notes...</p> : today.error ? <p className="summary-state" role="status">{today.error}</p> : today.total === 0 ? <p className="summary-state">No notes due today.</p> : <ul>
        {today.notes.map((note) => <li key={note.id}>
          <button type="button" className="summary-item" onClick={onOpenNotes}>
            <span className="summary-meta"><time dateTime={note.dueAt}>{new Date(note.dueAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time><span>{note.priority !== 'none' ? `${note.priority} priority` : 'Note'}</span></span>
            <strong>{note.title}</strong>
            {note.subtasks.length > 0 && <span className="summary-preview">{note.subtasks.filter((task) => task.done).length}/{note.subtasks.length} subtasks complete</span>}
          </button>
        </li>)}
      </ul>}
    </section>
  </div>;
}
