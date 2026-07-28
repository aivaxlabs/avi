import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

export function SearchDialog({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      const next = await window.chatApp.conversations.search(query);
      setResults(next);
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="search-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <label className="dialog-search">
          <Search size={16} />
          <input
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved chats"
          />
        </label>
        <div className="search-results">
          {results.map((result) => (
            <button
              key={result.messageId}
              type="button"
              onClick={() => {
                onSelect(result.conversationId);
                onClose();
              }}
            >
              <strong>{result.title}</strong>
              <span>{result.content}</span>
            </button>
          ))}
          {query.trim() && results.length === 0 && <div className="empty-list">No results.</div>}
        </div>
      </section>
    </div>
  );
}
