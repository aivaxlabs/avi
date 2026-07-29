import {
  ArrowRightLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  GitFork,
  Info,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Workflow,
} from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatBytes } from '../lib/files.js';
import { classNames } from '../lib/format.js';
import { answerTextFromTextualBlocks } from '../../shared/textual-blocks.js';

const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function Message({
  message,
  modelName,
  onFork,
  onRetry,
  onResume,
  runActive,
  questionPending,
  onSendContinuation,
  onImplementPlan,
  showContinuations,
}) {
  if (message.role === 'user') {
    return <UserMessage message={message} />;
  }
  const compression = message.role === 'system'
    ? message.segments.find((segment) => segment.type === 'context-compression')
    : null;
  if (compression) {
    const label = message.status === 'streaming'
      ? 'Compressing context'
      : message.status === 'completed'
        ? `Context compressed from ${compactTokenFormatter.format(compression.inputTokens)
        } tokens to ${compactTokenFormatter.format(compression.outputTokens)
        } tokens`
        : compression.error ?? 'Context compression stopped.';
    return (
      <article className="message-row context-compression-row" aria-live="polite">
        <div className="context-compression-indicator">
          <span className={message.status === 'streaming' ? 'assistant-placeholder' : ''}>
            {label}
          </span>
        </div>
      </article>
    );
  }
  return (
    <AssistantMessage
      message={message}
      modelName={modelName}
      onFork={onFork}
      onRetry={onRetry}
      onResume={onResume}
      runActive={runActive}
      questionPending={questionPending}
      onSendContinuation={onSendContinuation}
      onImplementPlan={onImplementPlan}
      showContinuations={showContinuations}
    />
  );
}

function UserMessage({ message }) {
  const visibleAttachments = message.attachments;
  const content = (message.content ?? '').trim();
  const reportEnvelope = /^<subagent_report\b([^>]*)>\s*([\s\S]*?)\s*<\/subagent_report>$/
    .exec(content);
  const reportThreadId = reportEnvelope
    ? /\bthread_id="([^"]+)"/.exec(reportEnvelope[1])?.[1]
    : null;
  const reportTitle = reportEnvelope
    ? /\btitle="([^"]+)"/.exec(reportEnvelope[1])?.[1]
    : null;

  if (reportEnvelope && reportThreadId && reportTitle) {
    const reportBody = reportEnvelope[2].trim();
    return (
      <article className="message-row subagent-report-row">
        <section className="subagent-report-card" aria-label={`Report from ${reportTitle}`}>
          <header className="subagent-report-header">
            <span className="subagent-report-icon" aria-hidden="true">
              <Bot size={15} />
            </span>
            <span className="subagent-report-heading">
              <small>Sub-agent report</small>
              <strong>{reportTitle}</strong>
            </span>
            <code title={reportThreadId}>{reportThreadId.slice(0, 8)}</code>
            <button
              type="button"
              aria-label={`Copy report from ${reportTitle}`}
              title="Copy report"
              onClick={() => copyText(reportBody)}
            >
              <Copy size={14} />
            </button>
          </header>
          <div className="subagent-report-body">
            <MarkdownSegment text={reportBody} finalized />
          </div>
        </section>
      </article>
    );
  }

  const crossMessageEnvelope = /^<cross-message\b([^>]*)>\s*([\s\S]*?)\s*<\/cross-message>$/
    .exec(content);
  const sourceThreadId = crossMessageEnvelope
    ? /\bfrom_thread_id="([^"]+)"/.exec(crossMessageEnvelope[1])?.[1]
    : null;

  if (crossMessageEnvelope && sourceThreadId) {
    const crossMessageBody = crossMessageEnvelope[2].trim();
    return (
      <article className="message-row subagent-report-row">
        <section
          className="subagent-report-card cross-thread-message-card"
          aria-label={`Message from thread ${sourceThreadId}`}
        >
          <header className="subagent-report-header">
            <span className="subagent-report-icon" aria-hidden="true">
              <ArrowRightLeft size={15} />
            </span>
            <span className="subagent-report-heading">
              <small>Cross-thread message</small>
              <strong>From thread</strong>
            </span>
            <code title={sourceThreadId}>{sourceThreadId.slice(0, 8)}</code>
            <button
              type="button"
              aria-label={`Copy message from thread ${sourceThreadId}`}
              title="Copy message"
              onClick={() => copyText(crossMessageBody)}
            >
              <Copy size={14} />
            </button>
          </header>
          <div className="subagent-report-body">
            <MarkdownSegment text={crossMessageBody} finalized />
          </div>
        </section>
      </article>
    );
  }

  return (
    <article className="message-row user-row">
      <div className="user-bubble">
        <div className="plain-text">{message.content}</div>
        {visibleAttachments.length > 0 && (
          <div className="attachment-list">
            {visibleAttachments.map((attachment) => (
              <span
                key={attachment.id}
                className={`attachment-pill${attachment.kind === 'context_marker' ? ' context-marker' : ''}`}
              >
                {attachment.kind === 'context_marker' && (
                  attachment.markerType === 'workflow'
                    ? <Workflow size={13} />
                    : <Sparkles size={13} />
                )}
                <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                {attachment.kind !== 'context_marker' && <small>{formatBytes(attachment.size)}</small>}
              </span>
            ))}
          </div>
        )}
        {message.status === 'waiting_mcp' && (
          <span className="user-message-status" role="status">
            Waiting for MCP servers...
          </span>
        )}
      </div>
      <button className="user-copy-float" type="button" aria-label="Copy message" onClick={() => copyText(message.content)}>
        <Copy size={14} />
      </button>
    </article>
  );
}

function AssistantMessage({
  message,
  modelName,
  onFork,
  onRetry,
  onResume,
  runActive,
  questionPending,
  onSendContinuation,
  onImplementPlan,
  showContinuations,
}) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const usageRef = useRef(null);
  const content = message.content || '';
  const activelyStreaming = message.status === 'streaming' && runActive;
  const timeline = useMemo(() => {
    const parsedTimeline = buildTimelineFromContent(content);
    const toolSegments = (message.segments ?? [])
      .filter((segment) => segment.type === 'tool-call');

    for (const timelineItem of parsedTimeline) {
      if (timelineItem.type !== 'thinking') continue;
      for (const item of timelineItem.items) {
        if (!['tool', 'tool-call', 'server-tool'].includes(item.type)) continue;
        const matchingIndex = toolSegments.findIndex((segment) => segment.name === item.name);
        if (matchingIndex < 0) continue;
        Object.assign(item, toolSegments.splice(matchingIndex, 1)[0]);
      }
    }

    return parsedTimeline
      .map((item) => (
        item.type === 'thinking'
          ? {
              ...item,
              items: item.items.filter((segment) => segment.name !== 'ask_question'),
            }
          : item
      ))
      .filter((item) => item.type !== 'thinking' || item.items.length > 0);
  }, [content, message.segments]);
  const timelinePartition = useMemo(
    () => partitionTimeline(timeline, activelyStreaming),
    [activelyStreaming, timeline],
  );
  const durationLabel = formatWorkedDuration(
    message.createdAt,
    activelyStreaming ? null : message.updatedAt,
  );
  const answerText = useMemo(() => answerTextFromTextualBlocks(content), [content]);
  const registeredTime = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const hasUsageDetails = [
    message.usage?.inputTokens,
    message.usage?.outputTokens,
    message.usage?.cachedInputTokens,
    message.usage?.tokensPerSecond,
    message.usage?.latencyMs,
    message.usage?.durationMs,
  ].some((value) => Number.isFinite(value));
  const canResumeFromFailure = showContinuations
    && message.status !== 'completed'
    && !activelyStreaming;

  useEffect(() => {
    if (!usageOpen) return undefined;

    const closeUsage = (event) => {
      if (!usageRef.current?.contains(event.target)) {
        setUsageOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeUsage);
    return () => document.removeEventListener('pointerdown', closeUsage);
  }, [usageOpen]);

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
                streaming={activelyStreaming}
                trailing={index === timelinePartition.finalItems.length - 1}
                onImplementPlan={
                  message.workMode === 'plan' && message.status === 'completed'
                    ? onImplementPlan
                    : null
                }
              />
            ))}
          </div>
        ) : null}
        {activelyStreaming && !questionPending && (
          <div className="assistant-placeholder">Thinking</div>
        )}
        {!activelyStreaming && (
          <div className="message-footer">
            <div className={classNames(
              'message-actions assistant-actions',
              canResumeFromFailure && 'has-try-again',
            )}
            >
              <button
                className="message-action-icon"
                type="button"
                aria-label="Copy response"
                title="Copy"
                onClick={() => copyText(answerText)}
              >
                <Copy size={15} />
              </button>
              {showContinuations && message.status === 'completed' && (
                <button
                  className="message-action-icon"
                  type="button"
                  aria-label="Retry response"
                  title="Retry"
                  onClick={onRetry}
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                className="message-action-icon"
                type="button"
                aria-label="Fork chat from this response"
                title="Fork"
                onClick={onFork}
              >
                <GitFork size={15} />
              </button>
              {hasUsageDetails && (
                <div
                  className="message-info"
                  ref={usageRef}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setUsageOpen(false);
                      event.currentTarget.querySelector('button')?.focus();
                    }
                  }}
                >
                  <button
                    className="message-action-icon"
                    type="button"
                    aria-label="Response usage details"
                    aria-expanded={usageOpen}
                    title="Response information"
                    onClick={() => setUsageOpen((open) => !open)}
                  >
                    <Info size={15} />
                  </button>
                  {usageOpen && (
                    <div className="message-usage-popover" role="dialog" aria-label="Response usage details">
                      <dl>
                        <div>
                          <dt>Input</dt>
                          <dd>{message.usage?.inputTokens?.toLocaleString() ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Output</dt>
                          <dd>{message.usage?.outputTokens?.toLocaleString() ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Cached</dt>
                          <dd>{message.usage?.cachedInputTokens?.toLocaleString() ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Tokens / second</dt>
                          <dd>
                            {Number.isFinite(message.usage?.tokensPerSecond)
                              ? message.usage.tokensPerSecond.toFixed(1)
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>Latency</dt>
                          <dd>{formatMetricDuration(message.usage?.latencyMs)}</dd>
                        </div>
                        <div>
                          <dt>Response time</dt>
                          <dd>{formatMetricDuration(message.usage?.durationMs)}</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              )}
              {canResumeFromFailure && (
                <button
                  className="try-again-action"
                  type="button"
                  disabled={resuming}
                  title="Continue from the last confirmed step"
                  onClick={async () => {
                    setResuming(true);
                    try {
                      await onResume();
                    } finally {
                      setResuming(false);
                    }
                  }}
                >
                  <RotateCcw size={14} />
                  <span>{resuming ? 'Trying…' : 'Try again'}</span>
                </button>
              )}
            </div>
            <div className="message-meta">
              <span>{registeredTime}</span>
              <span aria-hidden="true">·</span>
              <span className="message-meta-model" title={message.model ?? modelName}>
                {modelName}
              </span>
            </div>
          </div>
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
      </div>
    </article>
  );
}

function TimelineItem({
  item,
  streaming,
  trailing,
  onImplementPlan,
}) {
  if (item.type === 'content') {
    return (
      <MarkdownSegment
        text={item.text}
        finalized={!streaming}
        onImplementPlan={onImplementPlan}
      />
    );
  }

  return (
    <ThinkingGroup
      items={item.items}
      streaming={streaming}
      trailing={trailing}
    />
  );
}

function MarkdownSegment({ text, finalized, onImplementPlan }) {
  const [implementing, setImplementing] = useState(false);
  const components = useMemo(() => createMarkdownComponents(finalized), [finalized]);
  const parts = useMemo(() => {
    const parsed = [];
    const pattern = /<execution-plan>\s*([\s\S]*?\S)\s*<\/execution-plan>/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) {
        parsed.push({
          type: 'markdown',
          text: text.slice(cursor, match.index),
        });
      }
      parsed.push({
        type: 'execution-plan',
        text: match[1].trim(),
      });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) {
      parsed.push({
        type: 'markdown',
        text: text.slice(cursor),
      });
    }
    return parsed;
  }, [text]);
  const planCount = parts.filter((part) => part.type === 'execution-plan').length;

  if (!text.trim()) return null;
  return (
    <>
      {parts.map((part, index) => (
        part.type === 'execution-plan' ? (
          <section
            key={`execution-plan:${index}`}
            className="execution-plan"
            aria-label="Execution plan"
          >
            <div className="execution-plan-label">Execution plan</div>
            <div className="markdown-body execution-plan-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {part.text}
              </ReactMarkdown>
            </div>
            {finalized && planCount === 1 && onImplementPlan && (
              <button
                className="implement-plan-button"
                type="button"
                disabled={implementing}
                onClick={async () => {
                  setImplementing(true);
                  try {
                    await onImplementPlan();
                  } finally {
                    setImplementing(false);
                  }
                }}
              >
                {implementing ? 'Implementing...' : 'Implement plan'}
              </button>
            )}
          </section>
        ) : part.text.trim() ? (
          <div key={`markdown:${index}`} className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {part.text}
            </ReactMarkdown>
          </div>
        ) : null
      ))}
    </>
  );
}

function createMarkdownComponents(finalized) {
  return {
    pre({ children, ...props }) {
      const codeElement = codeElementFromChildren(children);
      if (!codeElement) {
        return <pre {...props}>{children}</pre>;
      }

      if (!finalized) {
        return null;
      }

      const className = codeElement.props.className ?? '';
      const language = normalizeLanguage(className);
      const code = String(codeElement.props.children ?? '').replace(/\n$/, '');
      return <CodeBlock code={code} language={language} />;
    },
  };
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const grammar = Prism.languages[language];
  const highlighted = grammar ? Prism.highlight(code, grammar, language) : '';
  const label = language === 'text' ? 'Code' : language;

  function handleCopy() {
    copyText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{label}</span>
        <button type="button" onClick={handleCopy} aria-label="Copy code">
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className={`language-${language}`}>
        {highlighted ? (
          <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code className={`language-${language}`}>{code}</code>
        )}
      </pre>
    </div>
  );
}

function codeElementFromChildren(children) {
  const childList = Array.isArray(children) ? children : [children];
  return childList.find((child) => isValidElement(child) && child.type === 'code') ?? null;
}

function normalizeLanguage(className) {
  const language = /language-([\w-]+)/.exec(className)?.[1]?.toLowerCase() ?? 'text';
  return {
    csharp: 'csharp',
    cs: 'csharp',
    html: 'markup',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    powershell: 'powershell',
    ps1: 'powershell',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'tsx',
    xml: 'markup',
  }[language] ?? language;
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
    return (
      <div className="reasoning-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.text}</ReactMarkdown>
      </div>
    );
  }

  if (segment.type === 'tool' || segment.type === 'server-tool' || segment.type === 'tool-call') {
    const name = segment.name || segment.toolType || 'tool';
    const reason = toolReason(segment);
    const rawInput = String(segment.argumentsText ?? '');
    const rawOutput = segment.resultText === undefined ? '' : String(segment.resultText);
    let input = rawInput;
    let output = rawOutput;
    try {
      input = JSON.stringify(JSON.parse(rawInput), null, 2);
    } catch { }
    try {
      output = JSON.stringify(JSON.parse(rawOutput), null, 2);
    } catch { }

    return (
      <details className="tool-entry">
        <summary className="tool-line">
          <TerminalSquare className="tool-line-icon" size={13} aria-hidden="true" />
          <strong>{name}</strong>
          {reason && <span>{reason}</span>}
          <ChevronRight className="tool-line-chevron" size={13} aria-hidden="true" />
        </summary>
        <div className="tool-details">
          <section>
            <span>Input</span>
            <pre><code>{input || '(empty input)'}</code></pre>
          </section>
          <section>
            <span>Output</span>
            <pre><code>{segment.resultText === undefined ? '(waiting for output)' : output || '(empty output)'}</code></pre>
          </section>
        </div>
      </details>
    );
  }

  if (segment.type === 'error') {
    return <div className="tool-line error-line">{segment.message}</div>;
  }

  return null;
}

function partitionTimeline(timeline, streaming) {
  if (streaming) {
    return {
      workedItems: [],
      finalItems: timeline,
    };
  }

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
  let markerSequence = 0;

  while (cursor < content.length) {
    const marker = findNextThinkingMarker(content, cursor);
    if (!marker) {
      pushContent(timeline, content.slice(cursor));
      break;
    }

    pushContent(timeline, content.slice(cursor, marker.start));

    if (marker.type === 'answer') {
      const valueStart = marker.start + marker.openTag.length;
      const valueEnd = findTag(content, marker.closeTag, valueStart);
      pushContent(timeline, valueEnd >= 0 ? content.slice(valueStart, valueEnd) : content.slice(valueStart));
      cursor = valueEnd >= 0 ? valueEnd + marker.closeTag.length : content.length;
      continue;
    }

    const parsed = parseThinkingMarker(content, marker, markerSequence);
    markerSequence += 1;

    if (parsed.items.length > 0) {
      const previous = timeline.at(-1);
      if (previous?.type === 'thinking') {
        previous.items.push(...parsed.items);
      } else {
        timeline.push({
          id: `thinking-${markerSequence}`,
          type: 'thinking',
          items: parsed.items,
        });
      }
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
    const toolResultStart = findTag(body, '<div class="tool-result', cursor);
    const nextStart = nearestPositive(thinkStart, nearestPositive(toolStart, toolResultStart));

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

    if (nextStart === toolStart) {
      const valueStart = toolStart + '<tool>'.length;
      const valueEnd = findTag(body, '</tool>', valueStart);
      const toolBody = valueEnd >= 0 ? body.slice(valueStart, valueEnd) : body.slice(valueStart);
      const tool = parseTool(toolBody, items.length, timelineIndex);
      if (tool) items.push(tool);
      cursor = valueEnd >= 0 ? valueEnd + '</tool>'.length : body.length;
      continue;
    }

    const valueEnd = findTag(body, '</div>', toolResultStart);
    const toolBody = valueEnd >= 0 ? body.slice(toolResultStart, valueEnd + '</div>'.length) : body.slice(toolResultStart);
    const tool = parseToolResult(toolBody, items.length, timelineIndex);
    if (tool) items.push(tool);
    cursor = valueEnd >= 0 ? valueEnd + '</div>'.length : body.length;
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

function parseToolResult(body, index, timelineIndex) {
  const name = attributeValue(body, 'data-tool-name') || tagValue(body, 'b') || 'tool';
  const reason = tagValue(body, 'span') || stripTags(body).replace(name, '').trim();
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

function skipThinkingMarker(content, marker) {
  if (marker.type === 'think') {
    const valueEnd = findTag(content, '</think>', marker.start + '<think>'.length);
    return valueEnd >= 0 ? valueEnd + '</think>'.length : content.length;
  }

  if (marker.type === 'tool') {
    const valueEnd = findTag(content, '</tool>', marker.start + '<tool>'.length);
    return valueEnd >= 0 ? valueEnd + '</tool>'.length : content.length;
  }

  if (marker.type === 'answer') {
    const valueEnd = findTag(content, marker.closeTag, marker.start + marker.openTag.length);
    return valueEnd >= 0 ? valueEnd + marker.closeTag.length : content.length;
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
    { type: 'answer', openTag: '<assistant-answer>', closeTag: '</assistant-answer>' },
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

function attributeValue(text, name) {
  const match = new RegExp(`${name}=["']([^"']*)["']`, 'i').exec(text);
  return match ? decodeXmlEntities(match[1]).trim() : '';
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
  const toolLabel = `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`;
  if (hasReasoning && tools.length > 0) return `Thinked, called ${toolLabel}`;
  if (hasReasoning) return 'Thinked';
  if (tools.length > 0) return `Called ${toolLabel}`;
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

function formatMetricDuration(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`;
}

function copyText(text) {
  navigator.clipboard.writeText(text ?? '');
}
