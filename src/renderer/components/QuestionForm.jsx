import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const QUESTION_MODE_HINTS = {
  single_choice: 'Select one',
  multiple_choice: 'Select all that apply',
  free_text: 'Write your answer',
};
const QUESTION_MARKDOWN_COMPONENTS = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
};

function replaceAt(list, index, value) {
  const next = [...list];
  next[index] = value;
  return next;
}

export function QuestionForm({
  formId,
  questions,
  disabled = false,
  autoFocus = true,
  onSubmit,
  onCancel,
  onActivity,
}) {
  const formRef = useRef(null);
  const focusOnPageRef = useRef(autoFocus);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState(() => questions.map((question) => (
    question.type === 'multiple_choice' ? [] : ''
  )));
  const [customAnswers, setCustomAnswers] = useState(() => questions.map(() => ''));
  const [customActive, setCustomActive] = useState(() => questions.map(() => false));
  const [submitting, setSubmitting] = useState(false);
  const busy = disabled || submitting;
  const activeQuestion = questions[questionIndex];
  const multiple = questions.length > 1;

  const isAnswered = (question, index) => {
    if (question.type === 'free_text') return Boolean(String(answers[index] ?? '').trim());
    if (customActive[index]) return Boolean(String(customAnswers[index] ?? '').trim());
    return question.type === 'multiple_choice'
      ? answers[index]?.length > 0
      : Boolean(String(answers[index] ?? '').trim());
  };
  const allAnswered = questions.every(isAnswered);

  useEffect(() => {
    if (!focusOnPageRef.current) {
      focusOnPageRef.current = true;
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      formRef.current
        ?.querySelector('[data-question-control]')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [questionIndex]);

  function reportActivity() {
    if (!busy) onActivity?.();
  }

  async function resolve(cancelled) {
    if (busy || (cancelled && !onCancel)) return;
    setSubmitting(true);
    try {
      if (cancelled) {
        await onCancel();
        return;
      }
      await onSubmit(questions.map((question, index) => ({
        question: question.question,
        answer: customActive[index]
          ? question.type === 'multiple_choice'
            ? [...answers[index], customAnswers[index].trim()]
            : customAnswers[index].trim()
          : answers[index],
      })));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      className="question-card"
      onPointerMove={reportActivity}
      onPointerDown={reportActivity}
      onClick={reportActivity}
      onKeyDownCapture={reportActivity}
      onInput={reportActivity}
      onWheel={reportActivity}
      aria-labelledby={`question-card-title-${formId}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !onCancel) return;
        event.preventDefault();
        resolve(true);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (allAnswered) resolve(false);
      }}
    >
      <header className="question-card-header">
        <CircleHelp className="question-card-icon" size={18} aria-hidden="true" />
        <div className="question-card-copy">
          <div className="question-card-meta">
            {multiple && (
              <span>
                Question {questionIndex + 1} of {questions.length}
              </span>
            )}
            <span id={`question-card-hint-${formId}`}>
              {QUESTION_MODE_HINTS[activeQuestion.type]}
            </span>
          </div>
          <div
            id={`question-card-title-${formId}`}
            className="question-card-prompt"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={QUESTION_MARKDOWN_COMPONENTS}
            >
              {activeQuestion.question.replace(
                /\s+(?=1\.\s+)/,
                '\n\n',
              ).replace(/\s+(?=[2-9]\d*\.\s+)/g, '\n')}
            </ReactMarkdown>
          </div>
        </div>
      </header>
      <fieldset className="question-card-field">
        <legend className="sr-only">{activeQuestion.question}</legend>
        {activeQuestion.type === 'free_text' ? (
          <textarea
            data-question-control
            value={answers[questionIndex] ?? ''}
            rows={4}
            placeholder="Type your answer"
            aria-label={activeQuestion.question}
            disabled={busy}
            onChange={(event) => setAnswers((state) => replaceAt(state, questionIndex, event.target.value))}
          />
        ) : (
          <div className="question-card-options">
            {activeQuestion.options.map((option, optionIndex) => {
              const inputId = `question-${formId}-${questionIndex}-${optionIndex}`;
              const description = activeQuestion.optionDescriptions?.[optionIndex];
              const checked = activeQuestion.type === 'multiple_choice'
                ? answers[questionIndex]?.includes(option)
                : answers[questionIndex] === option && !customActive[questionIndex];
              return (
                <label
                  key={`${option}:${optionIndex}`}
                  className="question-card-option"
                  htmlFor={inputId}
                >
                  <input
                    id={inputId}
                    aria-describedby={description ? `${inputId}-description` : undefined}
                    data-question-control={optionIndex === 0 ? '' : undefined}
                    type={activeQuestion.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name={`question-${formId}-${questionIndex}`}
                    value={option}
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => setAnswers((state) => {
                      if (activeQuestion.type !== 'multiple_choice') {
                        return replaceAt(state, questionIndex, option);
                      }
                      const selected = new Set(state[questionIndex] ?? []);
                      if (event.target.checked) {
                        selected.add(option);
                      } else {
                        selected.delete(option);
                      }
                      return replaceAt(state, questionIndex, [...selected]);
                    })}
                    onClick={() => {
                      if (activeQuestion.type !== 'single_choice') return;
                      setCustomActive((state) => replaceAt(state, questionIndex, false));
                    }}
                  />
                  <span className="question-card-option-copy">
                    <span className="question-card-option-label">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{ ...QUESTION_MARKDOWN_COMPONENTS, p: 'span' }}
                      >
                        {option}
                      </ReactMarkdown>
                    </span>
                    {description && (
                      <span
                        id={`${inputId}-description`}
                        className="question-card-option-description"
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={QUESTION_MARKDOWN_COMPONENTS}
                        >
                          {description}
                        </ReactMarkdown>
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
            <div className="question-card-custom-option">
              <label className="question-card-option">
                <input
                  type={activeQuestion.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                  name={`question-${formId}-${questionIndex}`}
                  checked={Boolean(customActive[questionIndex])}
                  disabled={busy}
                  onChange={(event) => setCustomActive((state) => (
                    replaceAt(state, questionIndex, event.target.checked)
                  ))}
                />
                <span className="question-card-option-copy">
                  <span className="question-card-option-label">Other</span>
                </span>
              </label>
              {customActive[questionIndex] && (
                <input
                  className="question-card-custom-input"
                  type="text"
                  value={customAnswers[questionIndex] ?? ''}
                  placeholder="Type your answer"
                  aria-label={`${activeQuestion.question} — custom answer`}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setCustomAnswers((state) => (
                    replaceAt(state, questionIndex, event.target.value)
                  ))}
                />
              )}
            </div>
          </div>
        )}
      </fieldset>
      <footer className="question-card-footer">
        {onCancel && (
          <button
            className="question-card-cancel"
            type="button"
            disabled={busy}
            onClick={() => resolve(true)}
          >
            Cancel
          </button>
        )}
        {multiple && (
          <nav
            className="question-card-pagination"
            aria-label="Question navigation"
          >
            {questions.map((question, index) => (
              <button
                key={`${formId}:${index}`}
                className={[
                  index === questionIndex && 'active',
                  isAnswered(question, index) && 'answered',
                ].filter(Boolean).join(' ')}
                type="button"
                disabled={busy}
                aria-label={`Go to question ${index + 1}`}
                aria-current={index === questionIndex ? 'step' : undefined}
                onClick={() => setQuestionIndex(index)}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          </nav>
        )}
        <div className="question-card-actions">
          {multiple && (
            <button
              type="button"
              disabled={busy || questionIndex === 0}
              onClick={() => setQuestionIndex((index) => index - 1)}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>Previous</span>
            </button>
          )}
          {questionIndex < questions.length - 1 ? (
            <button
              className="primary-mini"
              type="button"
              disabled={busy}
              onClick={() => setQuestionIndex((index) => index + 1)}
            >
              <span>Next</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <button
              className="primary-mini"
              type="submit"
              disabled={busy || !allAnswered}
            >
              {submitting
                ? 'Submitting...'
                : multiple ? 'Submit answers' : 'Submit'}
            </button>
          )}
        </div>
      </footer>
    </form>
  );
}
