import { ArrowUpRight, Inbox } from 'lucide-react';
import { hasOpenBotUserAction } from '../../shared/bot-work-items.js';

export function EmptyChatSummary({ bots = [], botDataByBot = {}, botsLoading, botsError, onOpenInbox }) {
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
  </div>;
}
