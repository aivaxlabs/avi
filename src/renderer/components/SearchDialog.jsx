import { Archive, Bot, LoaderCircle, MessageSquareText, Search, SearchX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { conversationStatus } from '../lib/conversation-status.js';
import { formatAge } from '../lib/format.js';
import { Overlay } from './Overlay.jsx';

const emptyObject = Object.freeze({});
const hour = 3_600_000;
const updatedRanges = [
  { value: '', label: 'Any time' },
  { value: 'day', label: 'Updated today', ms: 24 * hour },
  { value: 'week', label: 'Past 7 days', ms: 7 * 24 * hour },
  { value: 'month', label: 'Past 30 days', ms: 30 * 24 * hour },
  { value: 'year', label: 'Past year', ms: 365 * 24 * hour },
];

const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlight({ text, terms }) {
  if (!terms.length || !text) return text;
  const pattern = new RegExp(`(${terms.map(escapePattern).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => (
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part
  ));
}

function snippet(text, terms) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  const lower = source.toLowerCase();
  const matchIndex = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  return matchIndex > 48 ? `...${source.slice(matchIndex - 36)}` : source;
}

export function SearchDialog({
  conversations,
  folderColors = emptyObject,
  running = emptyObject,
  approvalPending = emptyObject,
  inputPending = emptyObject,
  semaphoreWaiting = emptyObject,
  completedUnseen = emptyObject,
  onClose,
  onSelect,
}) {
  const [query, setQuery] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [updatedRange, setUpdatedRange] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sort, setSort] = useState('relevance');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState('');
  const [opener] = useState(() => document.activeElement);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const searchTokenRef = useRef(0);
  const trimmedQuery = query.trim();
  const terms = useMemo(
    () => trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean),
    [trimmedQuery],
  );
  const filtersActive = Boolean(folderPath || updatedRange || includeArchived || sort !== 'relevance');

  const conversationsById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation])),
    [conversations],
  );

  const folders = useMemo(() => {
    const byPath = new Map();
    for (const conversation of conversations) {
      if (!byPath.has(conversation.projectPath)) {
        byPath.set(conversation.projectPath, {
          path: conversation.projectPath,
          name: conversation.projectName || '~/',
        });
      }
    }
    return [...byPath.values()].sort((a, b) => (
      Number(b.name === '~/') - Number(a.name === '~/') || a.name.localeCompare(b.name)
    ));
  }, [conversations]);

  const items = results;
  const activeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0));

  useEffect(() => {
    inputRef.current?.focus();
    return () => opener?.isConnected && opener.focus();
  }, [opener]);

  useEffect(() => {
    const searchToken = ++searchTokenRef.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      const range = updatedRanges.find((item) => item.value === updatedRange);
      try {
        const next = await window.chatApp.conversations.search({
          query: trimmedQuery,
          folderPath: folderPath || null,
          updatedAfter: range?.ms ? new Date(Date.now() - range.ms).toISOString() : null,
          includeArchived,
          sort,
        });
        if (searchToken === searchTokenRef.current) {
          setResults(next);
          setError('');
          setSelectedIndex(0);
        }
      } catch (nextError) {
        if (searchToken === searchTokenRef.current) {
          setResults([]);
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (searchToken === searchTokenRef.current) setSearching(false);
      }
    }, trimmedQuery ? 200 : 0);
    return () => clearTimeout(handle);
  }, [folderPath, includeArchived, sort, trimmedQuery, updatedRange]);

  useEffect(() => {
    resultsRef.current
      ?.querySelector(`[data-result-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectResult = (result) => {
    if (!result) return;
    onSelect(result.conversationId, { archived: Boolean(result.archivedAt) });
    onClose();
  };

  const resetFilters = () => {
    setFolderPath('');
    setUpdatedRange('');
    setIncludeArchived(false);
    setSort('relevance');
    setSelectedIndex(0);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (event.target.matches?.('select:open')) return;
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'Tab') {
      const focusable = [...dialogRef.current.querySelectorAll('input, select, button:not(:disabled)')]
        .filter((element) => element.getClientRects().length && element.tabIndex >= 0);
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
      return;
    }

    if (event.target.tagName !== 'INPUT' || items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((activeIndex + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((activeIndex - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectResult(items[activeIndex]);
    }
  };

  const sectionLabel = trimmedQuery ? 'Results' : 'Recent chats';
  const showEmpty = !searching && !error && items.length === 0;

  return (
    <Overlay className="dialog-backdrop search-dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="search-dialog-header">
          <label className="dialog-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search chats"
              aria-label="Search chats"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={items.length > 0}
              aria-controls="chat-search-results"
              aria-activedescendant={
                items[activeIndex] ? `chat-search-result-${activeIndex}` : undefined
              }
            />
            {searching && (
              <LoaderCircle className="search-spinner" size={15} aria-label="Searching" />
            )}
          </label>
          <div className="search-filters" role="group" aria-label="Search filters">
            <select
              className="select"
              value={folderPath}
              aria-label="Folder"
              onChange={(event) => {
                setFolderPath(event.target.value);
                setSelectedIndex(0);
              }}
            >
              <option value="">All folders</option>
              {folders.map((folder) => (
                <option key={folder.path} value={folder.path}>{folder.name}</option>
              ))}
            </select>
            <select
              className="select"
              value={updatedRange}
              aria-label="Last updated"
              onChange={(event) => {
                setUpdatedRange(event.target.value);
                setSelectedIndex(0);
              }}
            >
              {updatedRanges.map((range) => (
                <option key={range.value} value={range.value}>{range.label}</option>
              ))}
            </select>
            <select
              className="select"
              value={includeArchived ? 'include' : 'exclude'}
              aria-label="Archive"
              onChange={(event) => {
                setIncludeArchived(event.target.value === 'include');
                setSelectedIndex(0);
              }}
            >
              <option value="exclude">Archive: Do not include</option>
              <option value="include">Archive: Include</option>
            </select>
            {trimmedQuery && (
              <select
                className="select"
                value={sort}
                aria-label="Sort by"
                onChange={(event) => {
                  setSort(event.target.value);
                  setSelectedIndex(0);
                }}
              >
                <option value="relevance">Best match</option>
                <option value="updated">Recently updated</option>
              </select>
            )}
            {filtersActive && (
              <button className="button" type="button" onClick={resetFilters}>Reset</button>
            )}
          </div>
        </div>
        <div
          ref={resultsRef}
          id="chat-search-results"
          className="search-results"
          role="listbox"
          aria-label={trimmedQuery ? 'Chat search results' : 'Recent chats'}
          aria-busy={searching || undefined}
        >
          {items.length > 0 && (
            <div className="search-results-label" role="presentation">
              {sectionLabel}
              <span>{items.length}</span>
            </div>
          )}
          {items.map((result, index) => {
            const conversation = conversationsById.get(result.conversationId);
            const status = result.archivedAt
              ? { icon: Archive, className: 'sleep-indicator', label: 'Archived' }
              : conversationStatus({
              approvalPending: approvalPending[result.conversationId],
              inputPending: inputPending[result.conversationId],
              semaphoreWaiting: semaphoreWaiting[result.conversationId],
              running: running[result.conversationId],
              blocked: conversation?.workStatus === 'blocked',
              needsAttention: conversation?.needsAttention,
              completedUnseen: completedUnseen[result.conversationId],
            });
            const RowIcon = conversation?.createdBy === 'agent' ? Bot : MessageSquareText;
            const StatusIcon = status?.icon;
            const age = formatAge(result.updatedAt);
            const folderColor = folderColors[result.folderPath];
            const preview = trimmedQuery ? snippet(result.content, terms) : result.content;

            return (
              <button
                key={result.conversationId}
                id={`chat-search-result-${index}`}
                data-result-index={index}
                className={index === activeIndex ? 'active' : ''}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === activeIndex}
                onMouseMove={() => index !== activeIndex && setSelectedIndex(index)}
                onClick={() => selectResult(result)}
              >
                <RowIcon className="search-result-icon" size={16} aria-hidden="true" />
                <span className="search-result-copy">
                  <span className="search-result-heading">
                    <strong><Highlight text={result.title} terms={terms} /></strong>
                    <small className="search-result-folder" title={result.folderDisplayPath}>
                      {folderColor && (
                        <span
                          className="search-result-folder-dot"
                          style={{ backgroundColor: folderColor }}
                          aria-hidden="true"
                        />
                      )}
                      {result.folderName}
                    </small>
                    <span className="search-result-meta">
                      {status && (
                        <span className={`search-result-status ${status.className}`} title={status.label}>
                          <StatusIcon size={12} aria-hidden="true" />
                          {status.label}
                        </span>
                      )}
                      {age && (
                        <span
                          className="search-result-age"
                          title={`Updated ${new Date(result.updatedAt).toLocaleString()}`}
                        >
                          {age}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="search-result-preview">
                    {preview
                      ? <Highlight text={preview} terms={terms} />
                      : 'No preview available.'}
                  </span>
                </span>
              </button>
            );
          })}
          {error && (
            <div className="empty-list" role="alert">
              <SearchX size={20} aria-hidden="true" />
              <span>Search failed: {error}</span>
            </div>
          )}
          {showEmpty && (
            <div className="empty-list">
              <SearchX size={20} aria-hidden="true" />
              <span>
                {trimmedQuery
                  ? `No chats found for “${trimmedQuery}”.`
                  : 'No chats match these filters.'}
              </span>
              {filtersActive && (
                <button className="button" type="button" onClick={resetFilters}>Clear filters</button>
              )}
            </div>
          )}
        </div>
        <footer className="search-dialog-footer" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </footer>
      </section>
    </Overlay>
  );
}
