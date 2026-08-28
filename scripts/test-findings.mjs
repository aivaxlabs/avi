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
  ['::finding[Redirects can bypass SSRF protection]{level="P1"}', 'P1', 'Redirects can bypass SSRF protection'],
  ['::finding[**Formatted** title]{level="P2"}', 'P2', '<strong>Formatted</strong> title'],
  ['::finding[`Inline code` title]{level="P3"}', 'P3', '<code>Inline code</code> title'],
  [':FINDING{level="P1" label="Text form"}', 'P1', 'Text form'],
  [':finding{level="p2" title="Title alias"}', 'P2', 'Title alias'],
  [':::finding{level="P3" label="Container form"}\nIgnored body\n:::', 'P3', 'Container form'],
]) {
  const markup = renderFinding(content);
  assert.match(markup, new RegExp(`class="directive-heading finding-heading finding-${priority.toLowerCase()}"`));
  assert.match(markup, new RegExp(`data-directive-label="${priority}"`));
  assert.match(markup, new RegExp(title));
  assert.doesNotMatch(markup, /::finding/);
}

const findingWithDetails = renderFinding([
  '::finding[Sem `cache_control` explícito.]{level="P1"}',
  '',
  '**Evidence:** Nenhum `createBody` emite cached hints.',
  '',
  '**Impact:** O cache implícito é frágil.',
].join('\n'));
assert.match(findingWithDetails, /finding-heading finding-p1/);
assert.match(findingWithDetails, /<p><strong>Evidence:<\/strong>/);
assert.match(findingWithDetails, /<p><strong>Impact:<\/strong>/);

for (const invalid of [
  '::finding[Missing level]',
  '::finding[Unsupported level]{level="P4"}',
  ':finding{level="P1"}',
  'Before :finding{level="P1" label="Inline block directive"} after',
]) {
  const markup = renderFinding(invalid);
  assert.doesNotMatch(markup, /class="directive-heading finding-heading/);
  assert.match(markup, /finding/);
}

for (const literalCode of [
  renderFinding('```markdown\n::finding[Not rendered]{level="P0"}\n```'),
  renderFinding('`:finding{level="P1" label="Not rendered"}`'),
]) {
  assert.doesNotMatch(literalCode, /class="directive-heading finding-heading/);
  assert.match(literalCode, /finding/);
}

console.log('Finding rendering tests passed.');
