import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Message } from './Message.jsx';
import { useStreamingAutoScroll } from '../lib/use-streaming-auto-scroll.js';

const emptyList = [];

export function QuickQuestionPopover({ request, models, onClose, onForked }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState(emptyList);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [forking, setForking] = useState(false);
  const sessionRef = useRef(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.chatApp.quickQuestion.onEvent((event) => {
      if (event.sessionId !== sessionRef.current) return;
      if (event.type === 'message') {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === event.message.id);
          if (index < 0) return [...current, event.message];
          const next = [...current];
          next[index] = event.message;
          return next;
        });
      } else if (event.type === 'run-state') {
        setRunning(event.running);
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
    window.chatApp.quickQuestion.open(request.context).then((session) => {
      if (!active) {
        void window.chatApp.quickQuestion.close(session.id);
        return;
      }
      sessionRef.current = session.id;
      setSessionId(session.id);
    }).catch((failure) => {
      if (active) setError(failure.message || String(failure));
    });
    return () => {
      active = false;
      unsubscribe();
      if (sessionRef.current) void window.chatApp.quickQuestion.close(sessionRef.current);
      sessionRef.current = null;
    };
  }, [request.context]);

  const lastMessage = messages.at(-1);
  const { scrollRef } = useStreamingAutoScroll({
    scrollKey: `${lastMessage?.id ?? ''}:${lastMessage?.updatedAt ?? ''}:${String(lastMessage?.content ?? '').length}`,
    isRunning: running,
    resetKey: sessionId,
  });

  async function ask() {
    const question = text.trim();
    if (!question || !sessionId || running || forking) return;
    setText('');
    setError('');
    setRunning(true);
    try {
      await window.chatApp.quickQuestion.ask({ sessionId, text: question });
    } catch (failure) {
      setText(question);
      setRunning(false);
      setError(failure.message || String(failure));
    }
  }

  async function fork() {
    setForking(true);
    setError('');
    try {
      const { conversation } = await window.chatApp.quickQuestion.fork(sessionId);
      sessionRef.current = null;
      onForked(conversation);
      onClose();
    } catch (failure) {
      setError(failure.message || String(failure));
      setForking(false);
    }
  }

  const top = Math.max(8, Math.min(request.top, window.innerHeight - 360));
  const left = Math.max(8, Math.min(request.left, window.innerWidth - 448));
  const hint = error ? '' : !sessionId ? 'Preparing context...' : running ? 'Answering...' : 'Enter to ask';

  return createPortal(
    <form
      className="git-review-annotation quick-question-popover"
      role="dialog"
      aria-label="Quick question"
      style={{ left, top, maxHeight: window.innerHeight - top - 8 }}
      onSubmit={(event) => {
        event.preventDefault();
        void ask();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <blockquote title={request.label}>{request.label}</blockquote>
      <div className="quick-question-messages" ref={scrollRef} aria-live="polite">
        {messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            modelName={models.find((model) => model.id === message.model)?.name ?? message.model}
            workedMessages={emptyList}
            runActive={running && index === messages.length - 1 && message.role === 'assistant'}
            questionPending={false}
            showContinuations={false}
          />
        ))}
      </div>
      {error && <p className="quick-question-error" role="alert">{error}</p>}
      <textarea
        autoFocus
        aria-label="Question"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form.requestSubmit();
        }}
        placeholder={messages.length ? 'Ask a follow-up...' : 'Ask about this selection...'}
        rows={2}
      />
      <footer>
        <small role="status">{hint}</small>
        <button
          type="button"
          disabled={!sessionId || running || forking || !messages.length}
          onClick={() => void fork()}
        >
          {forking ? 'Forking...' : 'Fork to thread'}
        </button>
        <button type="button" onClick={onClose}>Close</button>
      </footer>
    </form>,
    document.body,
  );
}
