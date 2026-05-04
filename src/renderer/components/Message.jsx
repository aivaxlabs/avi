import { ChevronDown, ChevronRight, Copy, GitFork, RotateCcw, TerminalSquare, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatBytes } from '../lib/files.js';
import { classNames } from '../lib/format.js';

export function Message({ message, onFork, onRetry, onCancelQueued, onSendContinuation, showContinuations }) {
  if (message.role === 'user') {
    return <UserMessage message={message} onCancelQueued={onCancelQueued} />;
  }
  return (
    <AssistantMessage
      message={message}
      onFork={onFork}
      onRetry={onRetry}
      onSendContinuation={onSendContinuation}
      showContinuations={showContinuations}
    />
  );
}

function UserMessage({ message, onCancelQueued }) {
  const queueLabel = queueStatusLabel(message.status);
  const visibleAttachments = message.attachments.filter(isVisibleAttachment);

  return (
    <article className="message-row user-row">
      {queueLabel && (
        <div className="queue-indicator">
          <span>{queueLabel}</span>
          <button type="button" aria-label={`Cancel ${queueLabel.toLowerCase()} message`} onClick={onCancelQueued}>
            <X size={12} />
          </button>
        </div>
      )}
      <div className="user-bubble">
        <div className="plain-text">{message.content}</div>
        {visibleAttachments.length > 0 && (
          <div className="attachment-list">
            {visibleAttachments.map((attachment) => (
              <span key={attachment.id} className="attachment-pill">
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                <small>{formatBytes(attachment.size)}</small>
              </span>
            ))}
          </div>
        )}
      </div>
      <button className="user-copy-float" type="button" aria-label="Copy message" onClick={() => copyText(message.content)}>
        <Copy size={14} />
      </button>
    </article>
  );
}

function isVisibleAttachment(attachment) {
  return attachment.kind !== 'text_inline';
}
function queueStatusLabel(status) {
  if (status === 'queued') return 'Queued';
  if (status === 'steered') return 'Steered';
  return '';
}

function AssistantMessage({ message, onFork, onRetry, onSendContinuation, showContinuations }) {
  const content = message.content || '';
  const timeline = useMemo(() => buildTimelineFromContent(content), [content]);
  const timelinePartition = useMemo(() => partitionTimeline(timeline), [timeline]);
  const durationLabel = formatWorkedDuration(message.createdAt, message.status === 'streaming' ? null : message.updatedAt);
  const answerText = useMemo(() => answerTextForCopy(content), [content]);

  return (
    <article className="message-row assistant-row">
      <div className="assistant-message">
        {timeline.length > 0 ? (
          <div className="assistant-timeline">
            {timelinePartition.workedItems.length > 0 && (
              <WorkedBlock
                key={workedBlockKey(timelinePartition)}
                items={timelinePartition.workedItems}
                label={durationLabel}
              />
            )}
            {timelinePartition.finalItems.map((item, index) => (
              <TimelineItem
                key={item.id}
                item={item}
                streaming={message.status === 'streaming'}
                trailing={index === timelinePartition.finalItems.length - 1}
              />
            ))}
          </div>
        ) : (
          <div className="assistant-placeholder">Generating...</div>
        )}
        {showContinuations && message.continuations.length > 0 && (
          <div className="continuations">
            {message.continuations.map((topic) => (
              <button key={topic} type="button" onClick={() => onSendContinuation(topic)}>
                {topic}
              </button>
            ))}
          </div>
        )}
        {message.status !== 'streaming' && (
          <div className="message-actions assistant-actions">
            <button type="button" onClick={() => copyText(answerText)}>
              <Copy size={13} />
              Copy
            </button>
            {showContinuations && (
              <button type="button" onClick={onRetry}>
                <RotateCcw size={13} />
                Retry
              </button>
            )}
            <button type="button" onClick={onFork}>
              <GitFork size={13} />
              Fork
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function TimelineItem({ item, streaming, trailing }) {
  if (item.type === 'content') {
    return <MarkdownSegment text={item.text} />;
  }

  return (
    <ThinkingGroup
      items={item.items}
      streaming={streaming}
      trailing={trailing}
    />
  );
}

function MarkdownSegment({ text }) {
  if (!text.trim()) return null;
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function WorkedBlock({ items, label }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={classNames('worked-block', open && 'open')}>
      <button type="button" className="worked-summary" onClick={() => setOpen(!open)}>
        <span>{label}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <div className="worked-details" aria-hidden={!open}>
        <div className="worked-details-inner">
          {items.map((item, index) => (
            <TimelineItem
              key={item.id}
              item={item}
              streaming={false}
              trailing={index === items.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThinkingGroup({ items, streaming, trailing }) {
  const [manualOpen, setManualOpen] = useState(null);
  const open = manualOpen ?? (streaming && trailing);
  const label = groupLabel(items);

  return (
    <div className={classNames('thinking-group', open && 'open')}>
      <button type="button" className="thinking-summary" onClick={() => setManualOpen(!open)}>
        <span>{label}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <div className="thinking-details" aria-hidden={!open}>
        <div className="thinking-details-inner">
          {items.map((item) => (
            <MutedSegment key={item.id} segment={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MutedSegment({ segment }) {
  if (segment.type === 'reasoning') {
    return <div className="reasoning-text">{segment.text}</div>;
  }

  if (segment.type === 'tool' || segment.type === 'server-tool' || segment.type === 'tool-call') {
    const name = segment.name || segment.toolType || 'tool';
    const reason = toolReason(segment);
    return (
      <div className="tool-line">
        <TerminalSquare className="tool-line-icon" size={13} aria-hidden="true" />
        <strong>{name}</strong>
        {reason && <span>{reason}</span>}
      </div>
    );
  }

  if (segment.type === 'error') {
    return <div className="tool-line error-line">{segment.message}</div>;
  }

  return null;
}

function partitionTimeline(timeline) {
  const lastThinkingIndex = timeline.findLastIndex((item) => item.type === 'thinking');
  if (lastThinkingIndex < 0) {
    return {
      workedItems: [],
      finalItems: timeline,
    };
  }

  const finalItems = timeline.slice(lastThinkingIndex + 1);
  if (!finalItems.some((item) => item.type === 'content' && item.text.trim())) {
    return {
      workedItems: [],
      finalItems: timeline,
    };
  }

  return {
    workedItems: timeline.slice(0, lastThinkingIndex + 1),
    finalItems,
  };
}

function workedBlockKey({ workedItems, finalItems }) {
  return [
    workedItems.at(-1)?.id ?? 'none',
    finalItems[0]?.id ?? 'none',
  ].join(':');
}

function toolReason(segment) {
  if (segment.reason) return segment.reason;
  return '';
}

function buildTimelineFromContent(content) {
  if (!content.trim()) return [];

  const timeline = [];
  let cursor = 0;

  while (cursor < content.length) {
    const marker = findNextThinkingMarker(content, cursor);
    if (!marker) {
      pushContent(timeline, content.slice(cursor));
      break;
    }

    pushContent(timeline, content.slice(cursor, marker.start));

    const parsed = parseThinkingMarker(content, marker, timeline.length);

    if (parsed.items.length > 0) {
      timeline.push({
        id: `thinking-${timeline.length}`,
        type: 'thinking',
        items: parsed.items,
      });
    }

    cursor = parsed.nextCursor;
  }

  return timeline;
}

function parseThinkingMarker(content, marker, timelineIndex) {
  if (marker.type === 'think') {
    const valueStart = marker.start + '<think>'.length;
    const valueEnd = findTag(content, '</think>', valueStart);
    const text = valueEnd >= 0 ? content.slice(valueStart, valueEnd) : content.slice(valueStart);
    const items = [];
    pushReasoning(items, text, timelineIndex);
    return {
      items,
      nextCursor: valueEnd >= 0 ? valueEnd + '</think>'.length : content.length,
    };
  }

  if (marker.type === 'tool') {
    const valueStart = marker.start + '<tool>'.length;
    const valueEnd = findTag(content, '</tool>', valueStart);
    const body = valueEnd >= 0 ? content.slice(valueStart, valueEnd) : content.slice(valueStart);
    const tool = parseTool(body, 0, timelineIndex);
    return {
      items: tool ? [tool] : [],
      nextCursor: valueEnd >= 0 ? valueEnd + '</tool>'.length : content.length,
    };
  }

  const groupBodyStart = marker.start + marker.openTag.length;
  const groupEnd = findTag(content, marker.closeTag, groupBodyStart);
  const groupBody = groupEnd >= 0 ? content.slice(groupBodyStart, groupEnd) : content.slice(groupBodyStart);
  return {
    items: parseThinkingGroup(groupBody, timelineIndex),
    nextCursor: groupEnd >= 0 ? groupEnd + marker.closeTag.length : content.length,
  };
}

function parseThinkingGroup(body, timelineIndex) {
  const items = [];
  let cursor = 0;

  while (cursor < body.length) {
    const thinkStart = findTag(body, '<think>', cursor);
    const toolStart = findTag(body, '<tool>', cursor);
    const nextStart = nearestPositive(thinkStart, toolStart);

    if (nextStart < 0) {
      pushReasoning(items, body.slice(cursor), timelineIndex);
      break;
    }

    pushReasoning(items, body.slice(cursor, nextStart), timelineIndex);

    if (nextStart === thinkStart) {
      const valueStart = thinkStart + '<think>'.length;
      const valueEnd = findTag(body, '</think>', valueStart);
      const text = valueEnd >= 0 ? body.slice(valueStart, valueEnd) : body.slice(valueStart);
      pushReasoning(items, text, timelineIndex);
      cursor = valueEnd >= 0 ? valueEnd + '</think>'.length : body.length;
      continue;
    }

    const valueStart = toolStart + '<tool>'.length;
    const valueEnd = findTag(body, '</tool>', valueStart);
    const toolBody = valueEnd >= 0 ? body.slice(valueStart, valueEnd) : body.slice(valueStart);
    const tool = parseTool(toolBody, items.length, timelineIndex);
    if (tool) items.push(tool);
    cursor = valueEnd >= 0 ? valueEnd + '</tool>'.length : body.length;
  }

  return items;
}

function parseTool(body, index, timelineIndex) {
  const name = tagValue(body, 'toolname') || 'tool';
  const reason = tagValue(body, 'toolreason') || stripTags(body).trim();
  return {
    id: `tool-${timelineIndex}-${index}`,
    type: 'tool',
    name,
    reason,
  };
}

function pushContent(timeline, text) {
  if (!text.trim()) return;
  timeline.push({
    id: `content-${timeline.length}`,
    type: 'content',
    text,
  });
}

function pushReasoning(items, text, timelineIndex) {
  const normalized = stripTags(text).trim();
  if (!normalized) return;
  items.push({
    id: `reasoning-${timelineIndex}-${items.length}`,
    type: 'reasoning',
    text: normalized,
  });
}

function answerTextFromContent(content) {
  let output = '';
  let cursor = 0;

  while (cursor < content.length) {
    const marker = findNextThinkingMarker(content, cursor);
    if (!marker) {
      output += content.slice(cursor);
      break;
    }

    output += content.slice(cursor, marker.start);
    cursor = skipThinkingMarker(content, marker);
  }

  return output.trim();
}

function answerTextForCopy(content) {
  let cursor = 0;
  let lastMarker = null;

  while (cursor < content.length) {
    const marker = findNextThinkingMarker(content, cursor);
    if (!marker) break;

    lastMarker = marker;
    cursor = skipThinkingMarker(content, marker);
  }

  if (!lastMarker) {
    return answerTextFromContent(content);
  }

  return answerTextFromContent(content.slice(skipThinkingMarker(content, lastMarker)));
}

function skipThinkingMarker(content, marker) {
  if (marker.type === 'think') {
    const valueEnd = findTag(content, '</think>', marker.start + '<think>'.length);
    return valueEnd >= 0 ? valueEnd + '</think>'.length : content.length;
  }

  if (marker.type === 'tool') {
    const valueEnd = findTag(content, '</tool>', marker.start + '<tool>'.length);
    return valueEnd >= 0 ? valueEnd + '</tool>'.length : content.length;
  }

  const valueEnd = findTag(content, marker.closeTag, marker.start + marker.openTag.length);
  return valueEnd >= 0 ? valueEnd + marker.closeTag.length : content.length;
}

function findNextThinkingMarker(text, start) {
  const candidates = [
    { type: 'group', openTag: '<thinking-group>', closeTag: '</thinking-group>' },
    { type: 'group', openTag: '<thinking-blocks>', closeTag: '</thinking-blocks>' },
    { type: 'group', openTag: '<thinking-block>', closeTag: '</thinking-block>' },
    { type: 'think', openTag: '<think>', closeTag: '</think>' },
    { type: 'tool', openTag: '<tool>', closeTag: '</tool>' },
  ];

  return candidates
    .map((candidate) => ({
      ...candidate,
      start: findTag(text, candidate.openTag, start),
    }))
    .filter((candidate) => candidate.start >= 0)
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

function tagValue(text, tagName) {
  const startTag = `<${tagName}>`;
  const endTag = `</${tagName}>`;
  const start = findTag(text, startTag, 0);
  if (start < 0) return '';
  const valueStart = start + startTag.length;
  const end = findTag(text, endTag, valueStart);
  return stripTags(end >= 0 ? text.slice(valueStart, end) : text.slice(valueStart)).trim();
}

function stripTags(text) {
  return decodeXmlEntities(String(text ?? '').replace(/<\/?[^>]+>/g, ''));
}

function decodeXmlEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function findTag(text, tag, start) {
  return text.toLowerCase().indexOf(tag.toLowerCase(), start);
}

function nearestPositive(a, b) {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

function groupLabel(items) {
  const hasReasoning = items.some((item) => item.type === 'reasoning');
  const tools = items.filter((item) => ['tool', 'tool-call', 'server-tool'].includes(item.type));
  if (hasReasoning && tools.length > 1) return `Thinked, ran ${tools.length} commands`;
  if (hasReasoning && tools.length === 1) return `Thinked, ran ${tools[0].name || '1 command'}`;
  if (hasReasoning) return 'Thinked';
  if (tools.length === 1) return `Ran ${tools[0].name || '1 command'}`;
  if (tools.length > 1) return `Ran ${tools.length} commands`;
  return 'Details';
}

function formatWorkedDuration(startValue, endValue) {
  const start = Date.parse(startValue);
  const end = Date.parse(endValue) || Date.now();
  const seconds = Math.max(1, Math.round((end - start) / 1000));

  if (!Number.isFinite(seconds) || seconds < 60) {
    const safeSeconds = Number.isFinite(seconds) ? seconds : 1;
    return `Worked for ${safeSeconds} ${safeSeconds === 1 ? 'second' : 'seconds'}`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `Worked for ${minutes}m ${remainingSeconds}s`;
}

function copyText(text) {
  navigator.clipboard.writeText(text ?? '');
}
