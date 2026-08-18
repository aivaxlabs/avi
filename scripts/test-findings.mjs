import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';

function renderFinding(content) {
  return renderToStaticMarkup(createElement(Message, {
    message: {
      id: 'assistant-message',
      role: 'assistant',
      status: 'completed',
      content,
      segments: [],
      attachments: [],
      edits: [],
      continuations: [],
      usage: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    },
    modelName: 'Test model',
    workedMessages: [],
    runActive: false,
    questionPending: false,
    showContinuations: false,
    onOpenFileReference() {},
  }));
}

for (const [content, priority, title] of [
  ['#finding:P1 Redirects can bypass SSRF protection', 'P1', 'Redirects can bypass SSRF protection'],
  ['\u200B#finding:P2 **Formatted** title', 'P2', '<strong>Formatted</strong> title'],
  ['\u2060#finding:P3 `Inline code` title', 'P3', '<code>Inline code</code> title'],
  [
    [
      'Recomendação: Classifique `memory` / `mcp` como semi-estáveis.',
      '',
      '#finding:P1 Sem `cache_control` explícito — depende de cache implícito frágil Evidência: Nenhum `createBody` emite',
      '`cache_control` / cached hints. O projeto conta com prefix-cache implícito do provider (OpenAI/Anthropic).',
    ].join('\n'),
    'P1',
    'Sem <code>cache_control</code> explícito',
  ],
]) {
  const markup = renderFinding(content);
  assert.match(markup, new RegExp(`class="finding-heading finding-${priority.toLowerCase()}"`));
  assert.match(markup, new RegExp(`data-finding-priority="${priority}"`));
  assert.match(markup, new RegExp(title));
  assert.doesNotMatch(markup, /#finding:P[0-3]/);
}

const ordinaryText = renderFinding('Invisible prefix: \u200B#finding:P1 does not start a finding');
assert.doesNotMatch(ordinaryText, /class="finding-heading/);

const wrappedOrdinary = renderFinding('Intro line\n#finding:P1 does not start a finding');
assert.doesNotMatch(wrappedOrdinary, /class="finding-heading/);
assert.match(wrappedOrdinary, /#finding:P1 does not start a finding/);

console.log('Finding rendering tests passed.');
