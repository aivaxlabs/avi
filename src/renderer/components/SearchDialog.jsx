import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function SearchDialog({ onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    let stale = false;
    const handle = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const next = await window.chatApp.conversations.search(query);
        if (!stale) {
          setResults(next);
          setSelectedIndex(0);
        }
      } finally {
        if (!stale) setSearching(false);
      }
    }, 200);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
  }, [query]);

  useEffect(() => {
    resultsRef.current
      ?.querySelector(`[data-result-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const selectResult = (result) => {
    if (!result) return;
    onSelect(result.conversationId);
    onClose();
  };

  return (
    <div className="dialog-backdrop search-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'ArrowDown' && results.length > 0) {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % results.length);
          } else if (event.key === 'ArrowUp' && results.length > 0) {
            event.preventDefault();
            setSelectedIndex((current) => (current - 1 + results.length) % results.length);
          } else if (event.key === 'Enter' && results.length > 0) {
            event.preventDefault();
            selectResult(results[selectedIndex]);
          }
        }}
      >
        <label className="dialog-search">
          <Search size={16} />
          <input
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="chat-search-results"
            aria-activedescendant={
              results[selectedIndex] ? `chat-search-result-${selectedIndex}` : undefined
            }
          />
          {searching ? (
            <LoaderCircle className="search-spinner" size={15} aria-label="Searching" />
          ) : (
            <kbd>Esc</kbd>
          )}
        </label>
        {query.trim() && (
          <div
            ref={resultsRef}
            id="chat-search-results"
            className="search-results"
            role="listbox"
            aria-label="Chat search results"
          >
            {!searching && results.length > 0 && (
              <div className="search-results-label">
                Results
                <span>{results.length}</span>
              </div>
            )}
            {results.map((result, index) => (
              <button
                key={result.conversationId}
                id={`chat-search-result-${index}`}
                data-result-index={index}
                className={index === selectedIndex ? 'active' : ''}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => selectResult(result)}
              >
                <strong>{result.title}</strong>
                <span>{result.content || 'No preview available.'}</span>
              </button>
            ))}
            {!searching && results.length === 0 && (
              <div className="empty-list">
                <Search size={18} />
                <span>No chats found for “{query.trim()}”.</span>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
