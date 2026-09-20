import { useEffect, useRef, useState } from 'react';

export function ChatFind({ scrollRef, conversationId, compact, hasMore, loading, onLoadMore }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(0);
  const [matches, setMatches] = useState([]);
  const inputRef = useRef(null);
  useEffect(() => {
    const onShortcut = ({ detail }) => {
      if (detail !== 'chat.find') return;
      const focusedChat = document.activeElement?.closest('.chat-area');
      if (focusedChat ? !focusedChat.contains(scrollRef.current) : compact) return;
      setOpen(true);
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    };
    window.addEventListener('avi:shortcut', onShortcut);
    return () => window.removeEventListener('avi:shortcut', onShortcut);
  }, [compact, scrollRef]);
  useEffect(() => {
    if (!open || !query.trim() || !scrollRef.current) {
      setMatches([]);
      return;
    }
    const root = scrollRef.current;
    const update = () => {
      const ranges = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const needle = query.toLocaleLowerCase();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.checkVisibility() || node.parentElement.closest('button, textarea, input, script, style')) continue;
        const text = node.textContent.toLocaleLowerCase();
        for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + needle.length);
          ranges.push(range);
        }
      }
      setMatches(ranges);
    };
    let timer = setTimeout(update, 50);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(update, 50);
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [open, query, conversationId, scrollRef]);
  useEffect(() => {
    const range = matches[position % Math.max(matches.length, 1)];
    if (!range) return;
    const highlight = CSS.highlights.get('avi-chat-find') ?? new Highlight();
    highlight.add(range);
    CSS.highlights.set('avi-chat-find', highlight);
    range.startContainer.parentElement.scrollIntoView({ block: 'center' });
    return () => {
      highlight.delete(range);
      if (!highlight.size) CSS.highlights.delete('avi-chat-find');
    };
  }, [matches, position]);
  if (!open) return null;
  return (
    <div className="chat-find" role="search" aria-label="Find in current chat" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === 'Enter') { event.preventDefault(); setPosition((value) => (value + (event.shiftKey ? Math.max(matches.length - 1, 0) : 1)) % Math.max(matches.length, 1)); }
    }}>
      <input ref={inputRef} type="search" aria-label="Find in loaded chat messages" placeholder="Find in loaded messages..." value={query} onChange={(event) => { setQuery(event.target.value); setPosition(0); }} />
      <span role="status">{matches.length ? `${position % matches.length + 1} / ${matches.length}` : 'No matches'}</span>
      <button type="button" disabled={!matches.length} onClick={() => setPosition((value) => (value + matches.length - 1) % matches.length)}>Previous</button>
      <button type="button" disabled={!matches.length} onClick={() => setPosition((value) => (value + 1) % matches.length)}>Next</button>
      {hasMore && <button type="button" disabled={loading} onClick={onLoadMore}>{loading ? 'Loading...' : 'Include older messages'}</button>}
      <button type="button" onClick={() => { setOpen(false); scrollRef.current?.focus(); }}>Close</button>
    </div>
  );
}
