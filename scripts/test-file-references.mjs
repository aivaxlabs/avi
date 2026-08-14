import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';

function renderReference(content) {
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

const range = renderReference(
  '<fileref path="./docs/AIVAX Features.md" line-from="23" line-to="29" />',
);
assert.match(range, /class="file-reference-link"/);
assert.match(range, />AIVAX Features\.md, lines 23-29</);
assert.match(range, /title="Open \.\/docs\/AIVAX Features\.md at lines 23 to 29"/);

const singleLine = renderReference(
  '<fileref line-from="7" path="./src/main.js" />',
);
assert.match(singleLine, />main\.js, line 7</);

const noLines = renderReference('<fileref path="./README.md" />');
assert.match(noLines, />README\.md</);
assert.doesNotMatch(noLines, /README\.md, line/);

const legacy = renderReference('#file:./docs/AIVAX Features.md:23-29');
assert.doesNotMatch(legacy, /file-reference-link/);
assert.match(legacy, /#file:\.\/docs\/AIVAX Features\.md:23-29/);

for (const invalid of [
  '<fileref line-from="1" />',
  '<fileref path="./file.js" line-from="0" />',
  '<fileref path="./file.js" line-from="3" line-to="2" />',
  '<fileref path="./file.js" line-to="2" />',
  '<fileref path="../outside.js" line-from="1" />',
  '<fileref path="C:\\outside.js" line-from="1" />',
  '<fileref path="./nested/../../outside.js" line-from="1" />',
]) {
  assert.doesNotMatch(renderReference(invalid), /file-reference-link/);
}

const code = renderReference('`<fileref path="./file.js" line-from="1" />`');
assert.doesNotMatch(code, /file-reference-link/);

console.log('File reference tests passed.');
