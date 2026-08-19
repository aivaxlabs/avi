import {
  ArrowRightLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleStop,
  Copy,
  ExternalLink,
  FileDiff,
  FilePenLine,
  FileText,
  FolderOpen,
  FolderSearch,
  FolderTree,
  GitFork,
  Globe,
  Image,
  Info,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
  RotateCcw,
  ScanSearch,
  Send,
  Sparkles,
  SquareFunction,
  Target,
  TerminalSquare,
  Wrench,
  Workflow,
  X,
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
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatBytes } from '../lib/files.js';
import { consolidateFileEdits, createUndoPrompt } from '../lib/file-edits.js';
import { parseStructuredUserMessage } from '../lib/message-groups.js';
import { classNames } from '../lib/format.js';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu.jsx';
import {
  answerTextFromTextualBlocks,
  executionPlansFromTextualBlocks,
} from '../../shared/textual-blocks.js';

const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const STANDARD_MARKDOWN_PLUGINS = Object.freeze([remarkGfm]);
const MARKDOWN_PLUGINS = Object.freeze([
  ...STANDARD_MARKDOWN_PLUGINS,
  () => (tree) => {
    for (const node of tree.children ?? []) {
      const firstChild = node.children?.[0];
      if (
        (node.type !== 'paragraph' && node.type !== 'heading')
        || firstChild?.type !== 'text'
      ) {
        continue;
      }
      const match = /^[\u200B-\u200D\u2060\uFEFF]*#finding:(P[0-3])\s+/.exec(firstChild.value);
      if (!match) continue;

      const priority = match[1];
      node.type = 'heading';
      node.depth = 3;
      firstChild.value = firstChild.value.slice(match[0].length);
      if (!firstChild.value) node.children.shift();
      node.data = {
        hProperties: {
          className: `finding-heading finding-${priority.toLowerCase()}`,
          'data-finding-priority': priority,
        },
      };
    }
  },
  () => (tree) => {
    const walk = (node) => {
      if (
        !node.children
        || ['code', 'inlineCode', 'link', 'linkReference', 'html'].includes(node.type)
      ) {
        return;
      }

      node.children = node.children.flatMap((child) => {
        if (child.type !== 'html') {
          walk(child);
          return child;
        }

        const parts = [];
        let cursor = 0;
        for (const match of parseFileReferences(child.value)) {
          if (match.index > cursor) {
            parts.push({
              type: 'text',
              value: child.value.slice(cursor, match.index),
            });
          }
          parts.push({
            type: 'link',
            url: `#file-reference=${encodeURIComponent(JSON.stringify(match.reference))}`,
            children: [{
              type: 'text',
              value: match.raw,
            }],
          });
          cursor = match.index + match.raw.length;
        }
        if (parts.length === 0) return child;
        if (cursor < child.value.length) {
          parts.push({
            type: 'text',
            value: child.value.slice(cursor),
          });
        }
        return parts;
      });
    };

    walk(tree);
  },
]);
const MemoizedMarkdown = memo(ReactMarkdown);
const TOOL_ICONS = Object.freeze({
  ask_question: CircleHelp,
  chat_create_thread: MessageSquarePlus,
  chat_inspect_thread: ScanSearch,
  chat_interrupt_thread: CircleStop,
  chat_list_folders: FolderTree,
  chat_list_threads: MessagesSquare,
  chat_send_prompt: Send,
  chat_spawn_subagent: Bot,
  read_file: FileText,
  read_terminal_output: TerminalSquare,
  read_url: Globe,
  release_semaphore: Moon,
  run_in_terminal: TerminalSquare,
  sleep: Moon,
  sleep_semaphore: Moon,
  send_to_terminal: TerminalSquare,
  start_goal: Target,
  update_goal_status: Target,
  update_tasks: ListChecks,
  write_file: FilePenLine,
});

export function Message({
  message,
  modelName,
  workedMessages,
  workedStartedAt,
  onFork,
  onRetry,
  onResume,
  runActive,
  questionPending,
  onSendContinuation,
  onUndoEdits,
  onOpenFileEdit,
  onImplementPlan,
  onOpenFileReference,
  onFileReferenceAction,
  showContinuations,
  canRetry,
  canResume,
  editing = false,
  onEdit,
  editor = null,
}) {
  if (message.role === 'user') {
    return (
      <UserMessage
        message={message}
        editing={editing}
        onEdit={onEdit}
        editor={editor}
      />
    );
  }
  const compression = message.role === 'system'
    ? message.segments.find((segment) => segment.type === 'context-compression')
    : null;
  if (compression) {
    return (
      <article className="message-row context-compression-row" aria-live="polite">
        <ContextCompressionIndicator compression={compression} status={message.status} />
      </article>
    );
  }
  return (
    <AssistantMessage
      message={message}
      modelName={modelName}
      workedMessages={workedMessages}
      workedStartedAt={workedStartedAt}
      onFork={onFork}
      onRetry={onRetry}
      onResume={onResume}
      runActive={runActive}
      questionPending={questionPending}
      onSendContinuation={onSendContinuation}
      onUndoEdits={onUndoEdits}
      onOpenFileEdit={onOpenFileEdit}
      onImplementPlan={onImplementPlan}
      onOpenFileReference={onOpenFileReference}
      onFileReferenceAction={onFileReferenceAction}
      showContinuations={showContinuations}
      canRetry={canRetry}
      canResume={canResume}
    />
  );
}

export function parseSubagentReport(message) {
  const structured = parseStructuredUserMessage(message);
  return structured?.type === 'subagent-report' ? structured : null;
}

function SubagentReportCard({ report }) {
  return (
    <section className="subagent-report-card" aria-label={`Report from ${report.title}`}>
      <header className="subagent-report-header">
        <span className="subagent-report-icon" aria-hidden="true">
          <Bot size={15} />
        </span>
        <span className="subagent-report-heading">
          <small>Sub-agent report</small>
          <strong>{report.title}</strong>
        </span>
        <code title={report.threadId}>{report.threadId.slice(0, 8)}</code>
        <button
          type="button"
          aria-label={`Copy report from ${report.title}`}
          title="Copy report"
          onClick={() => copyText(report.body)}
        >
          <Copy size={14} />
        </button>
      </header>
      <div className="subagent-report-body">
        <MarkdownSegment text={report.body} finalized />
      </div>
    </section>
  );
}

function AttachmentLightbox({ attachment, onClose }) {
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const isVideo = attachment?.kind === 'video_url';
  return createPortal(
    <div
      className="attachment-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? 'Video' : 'Image'} preview: ${attachment.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {isVideo ? (
        <video src={attachment.dataUrl} controls autoPlay />
      ) : (
        <img src={attachment.dataUrl} alt={attachment.name} />
      )}
      <button
        type="button"
        aria-label="Close image preview"
        title="Close"
        autoFocus
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </div>,
    document.body,
  );
}

function UserMessage({ message, editing, onEdit, editor }) {
  const [lightboxAttachment, setLightboxAttachment] = useState(null);
  const visibleAttachments = message.attachments;
  const content = (message.content ?? '').trim();
  const report = parseSubagentReport(message);

  if (report) {
    return (
      <article className="message-row subagent-report-row">
        <SubagentReportCard report={report} />
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

  const hasBubble = Boolean(message.content) || message.status === 'waiting_mcp';

  if (editing) {
    return (
      <article className="message-row user-row editing">
        {editor}
      </article>
    );
  }

  return (
    <article className="message-row user-row">
      <div className="user-message-content">
        {message.fromAgent && (
          <small className="agent-message-marker">Sent from another agent</small>
        )}
        {hasBubble && (
          <div className="user-bubble">
            {message.content && <div className="plain-text">{message.content}</div>}
            {message.status === 'waiting_mcp' && (
              <span className="user-message-status" role="status">
                Waiting for MCP servers...
              </span>
            )}
          </div>
        )}
        {visibleAttachments.length > 0 && (
          <div className="attachment-list user-attachment-list" aria-label="Message attachments">
            {visibleAttachments.map((attachment) => (
              attachment.kind === 'image_url' && attachment.dataUrl
                ? (
                    <button
                      key={attachment.id}
                      className="user-attachment-image"
                      type="button"
                      aria-label={`Open ${attachment.name}`}
                      title={attachment.name}
                      onClick={() => setLightboxAttachment(attachment)}
                    >
                      <img src={attachment.dataUrl} alt={attachment.name} />
                    </button>
                  )
                : attachment.kind === 'video_url' && attachment.dataUrl
                  ? (
                      <div key={attachment.id} className="user-attachment-video" title={attachment.name}>
                        <video src={attachment.dataUrl} controls preload="metadata" />
                      </div>
                    )
                  : (
                    <span
                      key={attachment.id}
                      className={`attachment-pill${attachment.kind === 'context_marker' ? ' context-marker' : ''}`}
                    >
                      {attachment.kind === 'context_marker' && (
                        attachment.markerType === 'workflow'
                          ? <Workflow size={13} />
                          : attachment.markerType === 'directory_reference'
                            ? <FolderTree size={13} />
                            : attachment.markerType?.startsWith('file_')
                              ? <FileText size={13} />
                              : <Sparkles size={13} />
                      )}
                      <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                      {attachment.kind !== 'context_marker' && <small>{formatBytes(attachment.size)}</small>}
                    </span>
                  )
            ))}
          </div>
        )}
        <div className="user-message-actions">
          {!message.fromAgent && onEdit && (
            <button
              className="user-message-action"
              type="button"
              aria-label="Edit message"
              title="Edit"
              onClick={onEdit}
            >
              <FilePenLine size={14} />
            </button>
          )}
          <button
            className="user-message-action"
            type="button"
            aria-label="Copy message"
            title="Copy"
            onClick={() => copyText(message.content)}
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
      {lightboxAttachment && (
        <AttachmentLightbox
          attachment={lightboxAttachment}
          onClose={() => setLightboxAttachment(null)}
        />
      )}
    </article>
  );
}

function AssistantMessage({
  message,
  modelName,
  workedMessages = [],
  workedStartedAt,
  onFork,
  onRetry,
  onResume,
  runActive,
  questionPending,
  onSendContinuation,
  onUndoEdits,
  onOpenFileEdit,
  onImplementPlan,
  onOpenFileReference,
  onFileReferenceAction,
  showContinuations,
  canRetry,
  canResume,
}) {
  const [usageOpen, setUsageOpen] = useState(false);
  const [showAllEdits, setShowAllEdits] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [responseCopied, setResponseCopied] = useState(false);
  const [lightboxAttachment, setLightboxAttachment] = useState(null);
  const [imageContextMenu, setImageContextMenu] = useState(null);
  const usageRef = useRef(null);
  const copyResetTimerRef = useRef(null);
  const content = message.content || '';
  const activelyStreaming = message.status === 'streaming' && runActive;
  const timeline = useMemo(() => buildMessageTimeline(message), [content, message.segments]);
  const timelinePartition = useMemo(
    () => partitionTimeline(timeline, activelyStreaming),
    [activelyStreaming, timeline],
  );
  const thinkingLabel = useMemo(() => {
    let label = 'Thinking';
    for (const segment of message.segments ?? []) {
      if (segment.type !== 'reasoning') continue;
      const statusLabel = parseReasoningStatus(segment.text);
      if (statusLabel !== null) label = statusLabel;
    }
    return label;
  }, [message.segments]);
  const durationLabel = formatWorkedDuration(
    workedStartedAt ?? message.createdAt,
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
  const cachedInputTotal = message.usage?.inputTokens + message.usage?.cachedInputTokens;
  const cachedInputPercentage = Number.isFinite(message.usage?.inputTokens)
    && Number.isFinite(message.usage?.cachedInputTokens)
    && cachedInputTotal > 0
    ? message.usage.cachedInputTokens / cachedInputTotal
    : null;
  const canResumeFromFailure = canResume && !activelyStreaming;
  const edits = useMemo(
    () => consolidateFileEdits([...workedMessages, message]),
    [message, workedMessages],
  );

  useEffect(() => () => clearTimeout(copyResetTimerRef.current), []);

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

  useEffect(() => {
    if (!imageContextMenu) return undefined;
    const controller = new AbortController();
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setImageContextMenu(null);
    }, { signal: controller.signal });
    if (imageContextMenu) {
      window.addEventListener('pointerdown', (event) => {
        if (event.target.closest?.('.generated-image-context-menu')) return;
        setImageContextMenu(null);
      }, { signal: controller.signal });
      window.addEventListener('resize', () => setImageContextMenu(null), {
        once: true,
        signal: controller.signal,
      });
      queueMicrotask(() => (
        document.querySelector('.generated-image-context-menu [role="menuitem"]')?.focus()
      ));
    }
    return () => controller.abort();
  }, [imageContextMenu]);

  return (
    <article className="message-row assistant-row">
      <div className="assistant-message">
        {timeline.length > 0 || workedMessages.length > 0 ? (
          <div className="assistant-timeline">
            {(timelinePartition.workedItems.length > 0 || workedMessages.length > 0) && (
              <WorkedBlock
                key={workedBlockKey(timelinePartition, workedMessages)}
                items={timelinePartition.workedItems}
                messages={workedMessages}
                label={durationLabel}
                onOpenFileReference={onOpenFileReference}
                onFileReferenceAction={onFileReferenceAction}
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
                onOpenFileReference={onOpenFileReference}
                onFileReferenceAction={onFileReferenceAction}
              />
            ))}
          </div>
        ) : null}
        {message.attachments.some((attachment) => (
          attachment.kind === 'image_url' && attachment.dataUrl
        )) && (
          <div className="attachment-list user-attachment-list" aria-label="Generated images">
            {message.attachments.filter((attachment) => (
              attachment.kind === 'image_url' && attachment.dataUrl
            )).map((attachment) => (
              <button
                key={attachment.id}
                className="user-attachment-image"
                type="button"
                aria-label={`Open ${attachment.name}`}
                title={attachment.name}
                onClick={() => setLightboxAttachment(attachment)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setImageContextMenu({
                    attachment,
                    left: Math.min(event.clientX, window.innerWidth - 190),
                    top: Math.min(event.clientY, window.innerHeight - 170),
                  });
                }}
              >
                <img src={attachment.dataUrl} alt={attachment.name} />
              </button>
            ))}
          </div>
        )}
        {lightboxAttachment && (
          <AttachmentLightbox
            attachment={lightboxAttachment}
            onClose={() => setLightboxAttachment(null)}
          />
        )}
        {imageContextMenu && createPortal(
          <DropdownMenu
            className="generated-image-context-menu"
            fixed
            role="menu"
            aria-label={`Actions for ${imageContextMenu.attachment.name}`}
            style={{ left: imageContextMenu.left, top: imageContextMenu.top }}
          >
            <DropdownMenuItem
              icon={<ExternalLink size={14} />}
              role="menuitem"
              disabled={!imageContextMenu.attachment.path}
              onClick={() => {
                const { path } = imageContextMenu.attachment;
                setImageContextMenu(null);
                void window.chatApp.attachments.imageAction({ action: 'open', path });
              }}
            >
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<FolderOpen size={14} />}
              role="menuitem"
              disabled={!imageContextMenu.attachment.path}
              onClick={() => {
                const { path } = imageContextMenu.attachment;
                setImageContextMenu(null);
                void window.chatApp.attachments.imageAction({ action: 'reveal', path });
              }}
            >
              Open in explorer
            </DropdownMenuItem>
            <div className="dropdown-menu-divider" role="separator" />
            <DropdownMenuItem
              icon={<Image size={14} />}
              role="menuitem"
              disabled={!imageContextMenu.attachment.path}
              onClick={() => {
                const { path } = imageContextMenu.attachment;
                setImageContextMenu(null);
                void window.chatApp.attachments.imageAction({ action: 'copy-image', path });
              }}
            >
              Copy image
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<Copy size={14} />}
              role="menuitem"
              disabled={!imageContextMenu.attachment.path}
              onClick={() => {
                const { path } = imageContextMenu.attachment;
                setImageContextMenu(null);
                void window.chatApp.attachments.imageAction({ action: 'copy-path', path });
              }}
            >
              Copy path
            </DropdownMenuItem>
          </DropdownMenu>,
          document.body,
        )}
        {activelyStreaming && !questionPending && (
          <div className="assistant-placeholder" aria-live="polite">
            <span key={thinkingLabel} className="assistant-placeholder-label">
              {thinkingLabel}
            </span>
          </div>
        )}
        {!activelyStreaming && message.status === 'completed' && edits.length > 0 && (
          <EditSummary
            edits={edits}
            expanded={showAllEdits}
            onToggleExpanded={() => setShowAllEdits((expanded) => !expanded)}
            onOpen={(edit) => onOpenFileEdit({
              kind: 'edit',
              path: edit.filePath,
              edit,
            })}
            onUndo={() => onUndoEdits(createUndoPrompt(edits))}
          />
        )}
        {!activelyStreaming && (
          <div className="message-footer">
            <div className={classNames(
              'message-actions assistant-actions',
              canResumeFromFailure && 'has-try-again',
            )}
            >
              <button
                className={classNames('message-action-icon', responseCopied && 'copied')}
                type="button"
                aria-label={responseCopied ? 'Response copied' : 'Copy response'}
                title={responseCopied ? 'Copied' : 'Copy'}
                onClick={async () => {
                  await copyText(answerText);
                  clearTimeout(copyResetTimerRef.current);
                  setResponseCopied(true);
                  copyResetTimerRef.current = setTimeout(() => setResponseCopied(false), 1800);
                }}
              >
                {responseCopied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              {canRetry && (
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
                          <dt>
                            Cached
                            {cachedInputPercentage !== null && (
                              <span className="cached-input-percentage">
                                {cachedInputPercentage.toLocaleString(undefined, {
                                  style: 'percent',
                                  maximumFractionDigits: 1,
                                })}
                              </span>
                            )}
                          </dt>
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
                  <span>{resuming ? 'Trying...' : 'Try again'}</span>
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
            {message.continuations.slice(0, 4).map((topic) => (
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


function EditSummary({ edits, expanded, onToggleExpanded, onOpen, onUndo }) {
  const visibleEdits = expanded ? edits : edits.slice(0, 3);
  return (
    <section className="edit-summary" aria-label="Edit summary">
      <header className="edit-summary-header">
        <span className="edit-summary-icon" aria-hidden="true"><FileDiff size={17} /></span>
        <strong>Edited {edits.length} {edits.length === 1 ? 'file' : 'files'}</strong>
        <button className="edit-summary-undo" type="button" onClick={onUndo}>
          Undo <RotateCcw size={14} />
        </button>
      </header>
      <div className="edit-summary-files">
        {visibleEdits.map((edit) => (
          <button key={edit.filePath} type="button" onClick={() => onOpen(edit)}>
            <span title={edit.filePath}>{edit.filePath}</span>
            <span className="edit-summary-stats">
              <ins>+{edit.additions}</ins> <del>-{edit.deletions}</del>
            </span>
          </button>
        ))}
      </div>
      {edits.length > 3 && (
        <button className="edit-summary-more" type="button" onClick={onToggleExpanded}>
          {expanded ? 'Show fewer files' : `Show ${edits.length - 3} more files`}
          <ChevronDown size={14} className={expanded ? 'is-open' : ''} />
        </button>
      )}
    </section>
  );
}

function TimelineItem({
  item,
  streaming,
  trailing,
  onImplementPlan,
  onOpenFileReference,
  onFileReferenceAction,
}) {
  if (item.type === 'context-compression') {
    return <ContextCompressionIndicator compression={item} status={item.status} />;
  }

  if (item.type === 'content') {
    return (
      <MarkdownSegment
        text={item.text}
        finalized={!streaming}
        onImplementPlan={onImplementPlan}
        onOpenFileReference={onOpenFileReference}
        onFileReferenceAction={onFileReferenceAction}
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

function ContextCompressionIndicator({ compression, status }) {
  const label = status === 'streaming'
    ? 'Compressing context'
    : status === 'completed'
      ? `Context compressed from ${compactTokenFormatter.format(compression.inputTokens)
      } tokens to ${compactTokenFormatter.format(compression.outputTokens)
      } tokens`
      : compression.error ?? 'Context compression stopped.';
  return (
    <div className="context-compression-indicator" aria-live="polite">
      <span className={status === 'streaming' ? 'assistant-placeholder' : ''}>{label}</span>
    </div>
  );
}

const MarkdownSegment = memo(function MarkdownSegment({
  text,
  finalized,
  onImplementPlan,
  onOpenFileReference,
  onFileReferenceAction,
}) {
  const [implementing, setImplementing] = useState(false);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [fileReferenceMenu, setFileReferenceMenu] = useState(null);
  const planActionsRef = useRef(null);
  const fileReferenceTargetRef = useRef(null);
  const deferredText = useDeferredValue(text);
  const renderedText = finalized ? text : deferredText;
  useEffect(() => {
    if (!planMenuOpen) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (planActionsRef.current?.contains(event.target)) return;
      setPlanMenuOpen(false);
    }, { signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setPlanMenuOpen(false);
    }, { signal: controller.signal });
    return () => controller.abort();
  }, [planMenuOpen]);
  useEffect(() => {
    if (!fileReferenceMenu) return undefined;
    const controller = new AbortController();
    window.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.('.file-reference-context-menu')) return;
      setFileReferenceMenu(null);
    }, { once: true, signal: controller.signal });
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      setFileReferenceMenu(null);
      fileReferenceTargetRef.current?.focus();
    }, { signal: controller.signal });
    window.addEventListener('resize', () => setFileReferenceMenu(null), {
      once: true,
      signal: controller.signal,
    });
    queueMicrotask(() => (
      document.querySelector('.file-reference-context-menu [role="menuitem"]')?.focus()
    ));
    return () => controller.abort();
  }, [fileReferenceMenu]);
  const components = useMemo(
    () => createMarkdownComponents(finalized, onOpenFileReference, (event, reference) => {
      event.preventDefault();
      fileReferenceTargetRef.current = event.currentTarget;
      const width = 180;
      const height = 112;
      const rect = event.currentTarget.getBoundingClientRect();
      const clientX = event.clientX || rect.left + 8;
      const clientY = event.clientY || rect.bottom;
      setFileReferenceMenu({
        reference,
        left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
      });
    }),
    [finalized, onOpenFileReference],
  );
  const parts = useMemo(() => {
    const parsed = [];
    const plans = executionPlansFromTextualBlocks(renderedText);
    const pattern = /<execution-plan>\s*[\s\S]*?\S\s*<\/execution-plan>/gi;
    let cursor = 0;
    let planIndex = 0;
    let match;
    while ((match = pattern.exec(renderedText)) !== null) {
      if (match.index > cursor) {
        parsed.push({
          type: 'markdown',
          text: renderedText.slice(cursor, match.index),
        });
      }
      parsed.push({
        type: 'execution-plan',
        text: plans[planIndex],
      });
      planIndex += 1;
      cursor = match.index + match[0].length;
    }
    if (cursor < renderedText.length) {
      parsed.push({
        type: 'markdown',
        text: renderedText.slice(cursor),
      });
    }
    return parsed;
  }, [renderedText]);
  const planCount = parts.filter((part) => part.type === 'execution-plan').length;
  const startPlanAction = async (action, plan) => {
    setPlanMenuOpen(false);
    setImplementing(true);
    try {
      await onImplementPlan({ action, plan });
    } finally {
      setImplementing(false);
    }
  };

  if (!renderedText.trim()) return null;
  return (
    <>
      {parts.map((part, index) => (
        part.type === 'execution-plan' ? (
          <section
            key={`execution-plan:${index}`}
            className="execution-plan"
            aria-label="Execution plan"
          >
            <div className="execution-plan-label">
              <span>Execution plan</span>
              <button
                type="button"
                aria-label="Copy execution plan"
                title="Copy execution plan"
                onClick={() => copyText(part.text)}
              >
                <Copy size={13} />
              </button>
            </div>
            <div className="markdown-body execution-plan-content">
              <MemoizedMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={components}>
                {part.text}
              </MemoizedMarkdown>
            </div>
            {finalized && planCount === 1 && onImplementPlan && (
              <div className="implement-plan-actions" ref={planActionsRef}>
                <button
                  className="implement-plan-button"
                  type="button"
                  disabled={implementing}
                  onClick={() => startPlanAction('default', part.text)}
                >
                  {implementing ? 'Starting...' : 'Start implementation'}
                </button>
                <button
                  className="implement-plan-menu-button"
                  type="button"
                  aria-label="More implementation options"
                  aria-haspopup="menu"
                  aria-expanded={planMenuOpen}
                  disabled={implementing}
                  onClick={() => setPlanMenuOpen((open) => !open)}
                >
                  <ChevronDown size={14} />
                </button>
                {planMenuOpen && (
                  <DropdownMenu className="implement-plan-menu" role="menu">
                    <DropdownMenuItem
                      role="menuitem"
                      onClick={() => startPlanAction('goal', part.text)}
                    >
                      Start on goal mode
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      role="menuitem"
                      onClick={() => startPlanAction('ultra', part.text)}
                    >
                      Start on ultra mode
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      role="menuitem"
                      onClick={() => {
                        setPlanMenuOpen(false);
                        if (!window.confirm('Start this plan in Ultra Goal mode? This mode may use significantly more time and resources.')) return;
                        startPlanAction('ultra-goal', part.text);
                      }}
                    >
                      Start on ultra goal mode
                    </DropdownMenuItem>
                    <div className="dropdown-menu-divider" role="separator" />
                    <DropdownMenuItem
                      role="menuitem"
                      onClick={() => startPlanAction('new-thread', part.text)}
                    >
                      Start on a new thread
                    </DropdownMenuItem>
                    <div className="dropdown-menu-divider" role="separator" />
                    <DropdownMenuItem
                      role="menuitem"
                      onClick={() => {
                        setPlanMenuOpen(false);
                        copyText(part.text);
                      }}
                    >
                      Copy plan
                    </DropdownMenuItem>
                  </DropdownMenu>
                )}
              </div>
            )}
          </section>
        ) : part.text.trim() ? (
          <div key={`markdown:${index}`} className="markdown-body">
            <MemoizedMarkdown remarkPlugins={MARKDOWN_PLUGINS} components={components}>
              {part.text}
            </MemoizedMarkdown>
          </div>
        ) : null
      ))}
      {fileReferenceMenu && createPortal(
        <DropdownMenu
          className="file-reference-context-menu"
          fixed
          role="menu"
          aria-label={`Actions for ${fileReferenceMenu.reference.path}`}
          style={{ left: fileReferenceMenu.left, top: fileReferenceMenu.top }}
        >
          <DropdownMenuItem
            icon={<FileText size={14} />}
            role="menuitem"
            onClick={() => {
              setFileReferenceMenu(null);
              onOpenFileReference(fileReferenceMenu.reference);
            }}
          >
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<FolderSearch size={14} />}
            role="menuitem"
            disabled={!onFileReferenceAction}
            onClick={() => {
              setFileReferenceMenu(null);
              void onFileReferenceAction?.('reveal', fileReferenceMenu.reference);
            }}
          >
            Open in Explorer
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<Copy size={14} />}
            role="menuitem"
            disabled={!onFileReferenceAction}
            onClick={() => {
              setFileReferenceMenu(null);
              void onFileReferenceAction?.('copy-path', fileReferenceMenu.reference);
            }}
          >
            Copy path
          </DropdownMenuItem>
        </DropdownMenu>,
        document.body,
      )}
    </>
  );
});

function createMarkdownComponents(finalized, onOpenFileReference, onFileReferenceContextMenu) {
  return {
    a: function MarkdownLink({
      children,
      href,
      node: _node,
      className,
      ...props
    }) {
      const external = Boolean(href && /^https?:\/\//i.test(href));
      const [favicon, setFavicon] = useState(null);
      useEffect(() => {
        if (!external) return undefined;
        let active = true;
        void window.chatApp.app.favicon(href).then((dataUrl) => {
          if (active) setFavicon(dataUrl);
        }).catch(() => {});
        return () => {
          active = false;
        };
      }, [external, href]);

      if (!href?.startsWith('#file-reference=')) {
        return (
          <a
            className={classNames(
              className,
              external && 'file-reference-link external-markdown-link',
            )}
            href={href}
            {...props}
            onClick={external ? (event) => {
              event.preventDefault();
              window.chatApp.app.openExternal(href);
            } : undefined}
          >
            {external && favicon && (
              <img className="external-markdown-link-favicon" src={favicon} alt="" />
            )}
            {external ? <span>{children}</span> : children}
            {external && (
              <ExternalLink className="external-markdown-link-icon" size={12} aria-hidden="true" />
            )}
          </a>
        );
      }

      let reference;
      try {
        reference = JSON.parse(decodeURIComponent(href.slice('#file-reference='.length)));
      } catch {
        return <code>{children}</code>;
      }
      if (!onOpenFileReference) return <code>{children}</code>;
      const fileName = reference.path.split(/[\\/]/).filter(Boolean).at(-1) ?? reference.path;
      const displayLabel = reference.lineFrom === null
        ? fileName
        : reference.lineFrom === reference.lineTo
          ? `${fileName}, line ${reference.lineFrom}`
          : `${fileName}, lines ${reference.lineFrom}-${reference.lineTo}`;
      const lineLabel = reference.lineFrom === null
        ? ''
        : reference.lineFrom === reference.lineTo
          ? ` at line ${reference.lineFrom}`
          : ` at lines ${reference.lineFrom} to ${reference.lineTo}`;
      return (
        <a
          className="file-reference-link"
          href={href}
          title={`Open ${reference.path}${lineLabel}`}
          onClick={(event) => {
            event.preventDefault();
            onOpenFileReference(reference);
          }}
          onContextMenu={(event) => onFileReferenceContextMenu(event, reference)}
        >
          <FileText size={13} aria-hidden="true" />
          <span>{displayLabel}</span>
        </a>
      );
    },
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
  const highlighted = useMemo(() => {
    const grammar = Prism.languages[language];
    return grammar ? Prism.highlight(code, grammar, language) : '';
  }, [code, language]);
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

function WorkedMessage({ message, onOpenFileReference, onFileReferenceAction }) {
  if (message.fromAgent) return <UserMessage message={message} />;
  const structured = parseStructuredUserMessage(message);
  if (structured?.type === 'subagent-report') return <SubagentReportCard report={structured} />;
  if (structured?.type === 'cross-thread-message') {
    return (
      <section className="subagent-report-card cross-thread-message-card">
        <header className="subagent-report-header">
          <span className="subagent-report-icon" aria-hidden="true"><ArrowRightLeft size={15} /></span>
          <span className="subagent-report-heading"><small>Cross-thread message</small><strong>From thread</strong></span>
          <code title={structured.sourceThreadId}>{structured.sourceThreadId.slice(0, 8)}</code>
        </header>
        <div className="subagent-report-body"><MarkdownSegment text={structured.body} finalized /></div>
      </section>
    );
  }
  return buildMessageTimeline(message).map((item, index, timeline) => (
    <TimelineItem key={message.id + ':' + item.id} item={item} streaming={false}
      trailing={index === timeline.length - 1} onOpenFileReference={onOpenFileReference}
      onFileReferenceAction={onFileReferenceAction} />
  ));
}

function buildMessageTimeline(message) {
  const compressionSegments = (message.segments ?? [])
    .filter((segment) => segment.type === 'context-compression')
    .sort((left, right) => left.contentOffset - right.contentOffset);
  const parsedTimeline = [];
  let contentOffset = 0;
  for (const compression of compressionSegments) {
    parsedTimeline.push(...buildTimelineFromContent(
      (message.content || '').slice(contentOffset, compression.contentOffset),
    ));
    parsedTimeline.push(compression);
    contentOffset = compression.contentOffset;
  }
  parsedTimeline.push(...buildTimelineFromContent((message.content || '').slice(contentOffset)));
  parsedTimeline.forEach((item, index) => {
    item.id = `timeline-${index}-${item.id}`;
  });
  const toolSegments = (message.segments ?? []).filter((segment) => segment.type === 'tool-call');
  for (const timelineItem of parsedTimeline) {
    if (timelineItem.type !== 'thinking') continue;
    for (const item of timelineItem.items) {
      if (!['tool', 'tool-call', 'server-tool'].includes(item.type)) continue;
      const matchingIndex = toolSegments.findIndex((segment) => segment.name === item.name);
      if (matchingIndex >= 0) Object.assign(item, toolSegments.splice(matchingIndex, 1)[0]);
    }
  }
  return parsedTimeline.map((item) => item.type === 'thinking' ? {
    ...item,
    items: item.items.filter((segment) => segment.name !== 'ask_question'),
  } : item).filter((item) => item.type !== 'thinking' || item.items.length > 0);
}

function WorkedBlock({ items, messages, label, onOpenFileReference, onFileReferenceAction }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={classNames('worked-block', open && 'open')}>
      <button type="button" className="worked-summary" onClick={() => setOpen(!open)}>
        <span>{label}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <div className="worked-details" aria-hidden={!open}>
        {open && (
          <div className="worked-details-inner">
            {messages.map((message) => (
              <WorkedMessage
                key={message.id}
                message={message}
                onOpenFileReference={onOpenFileReference}
                onFileReferenceAction={onFileReferenceAction}
              />
            ))}
            {items.map((item, index) => (
              <TimelineItem
                key={item.id}
                item={item}
                streaming={false}
                trailing={index === items.length - 1}
                onOpenFileReference={onOpenFileReference}
                onFileReferenceAction={onFileReferenceAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingGroup({ items, streaming, trailing }) {
  const [manualOpen, setManualOpen] = useState(null);
  const open = manualOpen ?? (streaming && trailing);
  const tools = items.filter((item) => ['tool', 'tool-call', 'server-tool'].includes(item.type));
  const label = groupLabel(items);
  const toolsLabel = groupLabel(tools);

  return (
    <div className={classNames('thinking-group', tools.length > 0 && 'has-tools', open && 'open')}>
      <button type="button" className="thinking-summary" onClick={() => setManualOpen(!open)}>
        <span className="thinking-label">{label}</span>
        <span className="tools-label">{toolsLabel}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <div className="thinking-details" aria-hidden={!open}>
        {open && (
          <div className="thinking-details-inner">
            {items.map((item) => (
              <MutedSegment key={item.id} segment={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MutedSegment({ segment }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const formattedDetails = useMemo(() => {
    if (
      !detailsOpen
      || !['tool', 'server-tool', 'tool-call'].includes(segment.type)
    ) {
      return null;
    }

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
    return { input, output };
  }, [detailsOpen, segment.argumentsText, segment.resultText, segment.type]);

  if (segment.type === 'reasoning') {
    return (
      <div className="reasoning-text">
        <MemoizedMarkdown remarkPlugins={STANDARD_MARKDOWN_PLUGINS}>
          {segment.text}
        </MemoizedMarkdown>
      </div>
    );
  }

  if (segment.type === 'tool' || segment.type === 'server-tool' || segment.type === 'tool-call') {
    const name = segment.name || segment.toolType || 'tool';
    const ToolIcon = segment.isMcp || name.startsWith('mcp_')
      ? SquareFunction
      : TOOL_ICONS[name] ?? Wrench;
    const reason = toolReason(segment);

    return (
      <details
        className="tool-entry"
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
      >
        <summary className="tool-line">
          {segment.resultText === undefined && (
            <LoaderCircle
              className="tool-line-spinner"
              size={12}
              aria-label="Waiting for tool output"
            />
          )}
          <ToolIcon className="tool-line-icon" size={13} aria-hidden="true" />
          <span>
            <strong>{name}</strong>
            {reason && (
              <span className={segment.resultText === undefined ? 'tool-line-pending-text' : undefined}>
                {' '}{reason}
              </span>
            )}
          </span>
          <ChevronRight className="tool-line-chevron" size={13} aria-hidden="true" />
        </summary>
        {formattedDetails && (
          <div className="tool-details">
            <section>
              <span>Input</span>
              <pre><code>{formattedDetails.input || '(empty input)'}</code></pre>
            </section>
            <section>
              <span>Output</span>
              <pre>
                <code>
                  {segment.resultText === undefined
                    ? '(waiting for output)'
                    : formattedDetails.output || '(empty output)'}
                </code>
              </pre>
            </section>
          </div>
        )}
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

function workedBlockKey({ workedItems, finalItems }, messages) {
  return [
    messages.map((message) => message.id).join(','),
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
  if (parseReasoningStatus(text) !== null) return;
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

// Models frequently emit <fileref> with a missing or malformed closing
// (">" instead of " />", stray text before the closing ">", missing quotes).
// The parser is intentionally tolerant about the closing shape and strict
// about the payload: invalid references are left as plain text.
const FILE_REFERENCE_TAG_PATTERN = /<fileref\b((?:(?!<\/?>)[\s\S])*?)(?:\/(?:\s|>|$)|>)/gi;

export function parseFileReferences(text) {
  const matches = [];
  for (const match of text.matchAll(FILE_REFERENCE_TAG_PATTERN)) {
    const body = match[1];
    const path = attributeValue(body, 'path');
    const normalizedPath = path.replaceAll('\\', '/');
    const lineFromText = attributeValue(body, 'line-from');
    const lineToText = attributeValue(body, 'line-to');
    const lineFrom = /^\d+$/.test(lineFromText) ? Number(lineFromText) : null;
    const lineTo = /^\d+$/.test(lineToText) ? Number(lineToText) : lineFrom;
    if (
      (!normalizedPath.startsWith('./') && !normalizedPath.startsWith('../'))
      || (lineFromText && lineFrom === null)
      || (lineToText && lineTo === null)
      || (lineToText && lineFrom === null)
      || (lineFrom !== null && (lineFrom < 1 || lineTo < lineFrom))
    ) {
      continue;
    }
    matches.push({
      index: match.index,
      raw: match[0],
      reference: { path, lineFrom, lineTo },
    });
  }
  return matches;
}

function attributeValue(text, name) {
  const match = new RegExp(`${name}=["']([^"']*)["']`, 'i').exec(text);
  return match ? decodeXmlEntities(match[1]).trim() : '';
}

function stripTags(text) {
  return decodeXmlEntities(String(text ?? '').replace(/<\/?[^>]+>/g, ''));
}

function parseReasoningStatus(text) {
  const source = String(text ?? '');
  const statuses = [...source.matchAll(/\*\*((?:(?!\*\*)[^\r\n])+)\*\*/g)];
  if (
    statuses.length === 0
    || statuses.map((status) => status[0]).join('') !== source
    || statuses.some((status) => !status[1] || status[1].trim() !== status[1])
  ) {
    return null;
  }
  return statuses.at(-1)[1];
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
  return text.indexOf(tag, start);
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
  return navigator.clipboard.writeText(text ?? '');
}
