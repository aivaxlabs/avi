import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message, parseFileReferences } from '../src/renderer/components/Message.jsx';

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

const adjacent = renderReference(
  '<fileref path="./src/Compiler/Parser.cs" line-from="61" line-to="82" />  \n<fileref path="./src/Compiler/Flattener.cs" line-from="12" line-to="34" />',
);
assert.equal(adjacent.match(/class="file-reference-link"/g)?.length, 2);
assert.match(adjacent, />Parser\.cs, lines 61-82</);
assert.match(adjacent, />Flattener\.cs, lines 12-34</);

const surroundingText = renderReference(
  'Compare <fileref path="./before.js" /> with <fileref path="./after.js" />.',
);
assert.equal(surroundingText.match(/class="file-reference-link"/g)?.length, 2);
assert.match(surroundingText, /Compare /);
assert.match(surroundingText, / with /);

const external = renderReference('<fileref path="../LightJson/Sources/LightJson/Schema/JsonSchemaLoader.cs" line-from="158" line-to="181" />');
assert.match(external, /class="file-reference-link"/);
assert.match(external, /title="Open \.\.\/LightJson\/Sources\/LightJson\/Schema\/JsonSchemaLoader\.cs at lines 158 to 181"/);

const unclosedInBullet = renderReference(
  '- <fileref path="./src/renderer/components/Message.jsx" line-from="1527" line-to="1541">: cada traço de raciocínio agora renderiza uma linha.',
);
assert.equal(unclosedInBullet.match(/class="file-reference-link"/g)?.length, 1);
assert.match(unclosedInBullet, />Message\.jsx, lines 1527-1541</);
assert.match(unclosedInBullet, /: cada traço de raciocínio agora renderiza uma linha\.</);

const unclosedInParagraph = renderReference(
  'Veja <fileref path="./src/main.js" line-from="7"> aqui.',
);
assert.match(unclosedInParagraph, /class="file-reference-link"/);
assert.match(unclosedInParagraph, />main\.js, line 7</);
assert.match(unclosedInParagraph, / aqui\./);

const unclosedNoLines = renderReference('Compare <fileref path="./before.js"> com o resto.');
assert.match(unclosedNoLines, />before\.js</);

const legacy = renderReference('#file:./docs/AIVAX Features.md:23-29');
assert.doesNotMatch(legacy, /file-reference-link/);
assert.match(legacy, /#file:\.\/docs\/AIVAX Features\.md:23-29/);

for (const invalid of [
  '<fileref line-from="1" />',
  '<fileref path="./file.js" line-from="0" />',
  '<fileref path="./file.js" line-from="3" line-to="2" />',
  '<fileref path="./file.js" line-to="2" />',
  '<fileref path="C:\\outside.js" line-from="1" />',
]) {
  assert.doesNotMatch(renderReference(invalid), /file-reference-link/);
}

const code = renderReference('`<fileref path="./file.js" line-from="1" />`');
assert.doesNotMatch(code, /file-reference-link/);

const parsed = parseFileReferences(
  'a <fileref path="./x.js" line-from="2" /> b <fileref path="./y.js"> c',
);
assert.equal(parsed.length, 2);
assert.deepEqual(parsed[0].reference, { path: './x.js', lineFrom: 2, lineTo: 2 });
assert.deepEqual(parsed[1].reference, { path: './y.js', lineFrom: null, lineTo: null });

assert.equal(parseFileReferences('<fileref path="./x.js"').length, 0);
assert.equal(parseFileReferences('<fileref path="./x.js" line-from="1" line-to="0" />').length, 0);
assert.equal(parseFileReferences('<fileref path="./x.js" line-from="abc" />').length, 0);
assert.equal(parseFileReferences('<fileref path="/abs/x.js" />').length, 0);
assert.equal(parseFileReferences('<fileref path="./x.js" line-from="5" line-to="3" />').length, 0);
assert.equal(parseFileReferences('<filerefs path="./x.js" />').length, 0);

console.log('File reference tests passed.');
