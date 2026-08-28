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
  ':fileref{path="./docs/AIVAX Features.md" line-from="23" line-to="29"}',
);
assert.match(range, /class="file-reference-link"/);
assert.match(range, />AIVAX Features\.md, lines 23-29</);
assert.match(range, /title="Open \.\/docs\/AIVAX Features\.md at lines 23 to 29"/);

const singleLine = renderReference(
  ':fileref{line-from="7" path="./src/main.js"}',
);
assert.match(singleLine, />main\.js, line 7</);

const noLines = renderReference(':fileref{path="./README.md"}');
assert.match(noLines, />README\.md</);
assert.doesNotMatch(noLines, /README\.md, line/);

const adjacent = renderReference(
  ':fileref{path="./src/Compiler/Parser.cs" line-from="61" line-to="82"}  \n:fileref{path="./src/Compiler/Flattener.cs" line-from="12" line-to="34"}',
);
assert.equal(adjacent.match(/class="file-reference-link"/g)?.length, 2);
assert.match(adjacent, />Parser\.cs, lines 61-82</);
assert.match(adjacent, />Flattener\.cs, lines 12-34</);

const surroundingText = renderReference(
  'Compare :fileref{path="./before.js"} with :fileref{path="./after.js"}.',
);
assert.equal(surroundingText.match(/class="file-reference-link"/g)?.length, 2);
assert.match(surroundingText, /Compare /);
assert.match(surroundingText, / with /);

const external = renderReference(':fileref{path="../LightJson/Sources/LightJson/Schema/JsonSchemaLoader.cs" line-from="158" line-to="181"}');
assert.match(external, /class="file-reference-link"/);
assert.match(external, /title="Open \.\.\/LightJson\/Sources\/LightJson\/Schema\/JsonSchemaLoader\.cs at lines 158 to 181"/);

const legacy = renderReference('<fileref path="./README.md" />');
assert.doesNotMatch(legacy, /file-reference-link/);
assert.match(legacy, /&lt;fileref path=/);

for (const invalid of [
  ':fileref{line-from="1"}',
  ':fileref{path="./file.js" line-from="0"}',
  ':fileref{path="./file.js" line-from="3" line-to="2"}',
  ':fileref{path="./file.js" line-to="2"}',
  ':fileref{path="C:\\outside.js" line-from="1"}',
]) {
  const markup = renderReference(invalid);
  assert.doesNotMatch(markup, /file-reference-link/);
  assert.match(markup, /:fileref/);
}

const inlineCode = renderReference('See `:fileref{path="./file.js" line-from="1"}`.');
assert.match(inlineCode, /class="file-reference-link"/);
assert.match(inlineCode, />file\.js, line 1</);

for (const blockCode of [
  renderReference('```text\n:fileref{path="./file.js" line-from="1"}\n```'),
  renderReference('    :fileref{path="./file.js" line-from="1"}'),
]) {
  assert.doesNotMatch(blockCode, /file-reference-link/);
  assert.match(blockCode, /:fileref/);
}

console.log('File reference tests passed.');
