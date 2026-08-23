import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';
import { parseRichBlock, splitRichMarkdownBlocks } from '../src/renderer/lib/rich-content.js';

function renderMessage(content) {
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

const bar = '<avi-chart type="bar" title="Requests">[{"label":"GET","value":12},{"label":"POST","value":8}]</avi-chart>';
const line = '<avi-chart type="line" title="Latency">[{"label":"Mon","value":10},{"label":"Tue","value":15}]</avi-chart>';
const pie = '<avi-chart type="pie" title="Status">[{"label":"Success","value":90},{"label":"Error","value":10}]</avi-chart>';
for (const [source, type] of [[bar, 'bar'], [line, 'line'], [pie, 'pie']]) {
  const markup = renderMessage(source);
  assert.match(markup, new RegExp(`rich-chart-${type}`));
  assert.match(markup, /<figcaption>/);
}

const fileMention = renderMessage([
  '<avi-file-mention path="./src/demo.js" line-from="4" line-to="5" language="js">',
  'const total = 1 &lt; 2;',
  '</avi-file-mention>',
].join('\n'));
assert.match(fileMention, /class="copyable-panel file-mention"/);
assert.match(fileMention, />demo\.js, lines 4-5</);
assert.match(fileMention, /title="Open \.\/src\/demo\.js"/);
assert.match(fileMention, /class="token keyword">const</);
assert.match(fileMention, /class="token operator">=</);
assert.match(fileMention, /class="token number">1</);

const copy = renderMessage('<avi-copy label="API token">abc&lt;123</avi-copy>');
assert.match(copy, /aria-label="API token"/);
assert.match(copy, />Copy</);
assert.match(copy, /abc&lt;123/);

const plan = renderMessage('<execution-plan>1. Inspect\n2. Implement</execution-plan>');
assert.match(plan, /class="copyable-panel execution-plan"/);
assert.match(plan, /aria-label="Execution plan"/);
assert.match(plan, /Copy Execution plan/);

const mixed = splitRichMarkdownBlocks(`Before\n\n${bar}\n\nAfter`);
assert.deepEqual(mixed.map((part) => part.type), ['markdown', 'chart', 'markdown']);
assert.match(mixed[0].text, /Before/);
assert.match(mixed[2].text, /After/);

const fenced = splitRichMarkdownBlocks(`\`\`\`html\n${bar}\n\`\`\``);
assert.deepEqual(fenced.map((part) => part.type), ['markdown']);
assert.match(renderMessage(`\`\`\`html\n${bar}\n\`\`\``), /language-markup/);
assert.doesNotMatch(renderMessage(`\`\`\`html\n${bar}\n\`\`\``), /rich-chart-bar/);

for (const invalid of [
  '<avi-chart type="area">[{"label":"A","value":1}]</avi-chart>',
  '<avi-chart type="bar">not json</avi-chart>',
  '<avi-chart type="bar">[{"label":"A","value":-1}]</avi-chart>',
  '<avi-chart type="bar">[{"label":"A","value":1},{"label":"A","value":2}]</avi-chart>',
  '<avi-file-mention path="C:\\outside.js" line-from="1">text</avi-file-mention>',
  '<avi-file-mention path="./file.js" line-from="4" line-to="2">text</avi-file-mention>',
  '<avi-copy label="Empty"></avi-copy>',
]) {
  assert.equal(parseRichBlock(invalid), null);
}

assert.equal(parseRichBlock('<script>alert(1)</script>'), null);
assert.equal(parseRichBlock('<avi-chart type="bar">[]</avi-chart>'), null);

console.log('Rich content tests passed.');
