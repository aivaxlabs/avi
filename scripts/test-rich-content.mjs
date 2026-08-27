import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Message } from '../src/renderer/components/Message.jsx';

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

const charts = [
  ['bar', 'Requests', '[{"label":"GET","value":12},{"label":"POST","value":8}]'],
  ['line', 'Latency', '[{"label":"Mon","value":10},{"label":"Tue","value":15}]'],
  ['pie', 'Status', '[{"label":"Success","value":90},{"label":"Error","value":10}]'],
];
for (const [type, title, data] of charts) {
  const markup = renderMessage(`::avi-chart{type="${type}" title="${title}" data='${data}'}`);
  assert.match(markup, new RegExp(`rich-chart-${type}`));
  assert.match(markup, /<figcaption>/);
}

const progress = renderMessage('::avi-chart{type="progress" title="Release" data=\'[{"label":"Tests","value":83,"max":100},{"label":"Docs","value":6,"max":8}]\'}');
assert.match(progress, /rich-chart-progress/);
assert.match(progress, /role="progressbar"/);
assert.match(progress, /aria-valuemax="100"/);
assert.match(progress, /aria-valuenow="83"/);
assert.match(progress, />83 \/ 100</);

for (const [kind, expectedClass] of [
  [undefined, 'callout-info'],
  ['success', 'callout-success'],
  ['warning', 'callout-warning'],
  ['danger', 'callout-danger'],
]) {
  const attributes = kind ? `{kind="${kind}"}` : '';
  const markup = renderMessage(`::callout[**Important** operation.]${attributes}`);
  assert.match(markup, new RegExp(`directive-heading callout-heading ${expectedClass}`));
  assert.match(markup, /<strong>Important<\/strong>/);
}

const diff = renderMessage([
  ':::avi-diff{title="Focused change"}',
  '```diff',
  '@@ -1 +1 @@',
  '-const oldValue = 1;',
  '+const newValue = 2;',
  '```',
  ':::',
].join('\n'));
assert.match(diff, /class="copyable-panel avi-diff"/);
assert.match(diff, /aria-label="Focused change"/);
assert.match(diff, /token deleted-sign/);
assert.match(diff, /token inserted-sign/);

const mermaid = renderMessage([
  ':::mermaid-diagram',
  '```mermaid',
  'flowchart LR',
  '  A --&gt; B',
  '```',
  ':::',
].join('\n'));
assert.match(mermaid, /mermaid-visualization is-loading/);
assert.doesNotMatch(mermaid, /flowchart LR/);

const leafLatex = renderMessage('::latex[E = mc^2]');
assert.match(leafLatex, /latex-visualization is-loading/);
const blockLatex = renderMessage(':::latex\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n:::');
assert.match(blockLatex, /latex-visualization is-loading/);

const fileMention = renderMessage([
  ':::avi-file-mention{path="./src/demo.js" line-from="4" line-to="5" language="js"}',
  'This excerpt contains **Markdown** and a list:',
  '',
  '- `const total = 1 < 2;`',
  ':::',
].join('\n'));
assert.match(fileMention, /class="copyable-panel file-mention"/);
assert.match(fileMention, />demo\.js, lines 4-5</);
assert.match(fileMention, /title="Open \.\/src\/demo\.js"/);
assert.match(fileMention, /<strong>Markdown<\/strong>/);
assert.match(fileMention, /<ul>/);
assert.match(fileMention, /<code>const total = 1 &lt; 2;<\/code>/);

const copy = renderMessage('::avi-copy{label="API token" value="abc<123"}');
assert.match(copy, /aria-label="API token"/);
assert.match(copy, />Copy</);
assert.match(copy, /abc&lt;123/);

const plan = renderMessage('<execution-plan>1. Inspect\n2. Implement</execution-plan>');
assert.match(plan, /class="copyable-panel execution-plan"/);
assert.match(plan, /aria-label="Execution plan"/);
assert.match(plan, /Copy Execution plan/);

const mixed = renderMessage([
  'Before',
  '',
  `::avi-chart{type="bar" data='${charts[0][2]}'}`,
  '',
  'After',
].join('\n'));
assert.match(mixed, /<p>Before<\/p>/);
assert.match(mixed, /rich-chart-bar/);
assert.match(mixed, /<p>After<\/p>/);

const fenced = `\`\`\`markdown\n::avi-copy{value="not rendered"}\n\`\`\``;
assert.match(renderMessage(fenced), /language-markdown/);
assert.doesNotMatch(renderMessage(fenced), /class="copyable-panel"/);

for (const invalid of [
  '::avi-chart{type="area" data=\'[{"label":"A","value":1}]\'}',
  '::avi-chart{type="bar" data="not json"}',
  '::avi-chart{type="bar" data=\'[{"label":"A","value":-1}]\'}',
  '::avi-chart{type="bar" data=\'[{"label":"A","value":1},{"label":"A","value":2}]\'}',
  '::avi-chart{type="progress" data=\'[{"label":"A","value":101,"max":100}]\'}',
  '::avi-chart{type="progress" data=\'[{"label":"A","value":1,"max":0}]\'}',
  ':::callout{kind="warning"}\nWrong node type\n:::',
  '::callout[Unsupported]{kind="neutral"}',
  ':::avi-diff\n```js\n-old\n+new\n```\n:::',
  ':::avi-diff\nNo diff fence\n:::',
  ':::mermaid-diagram\nflowchart LR\nA --> B\n:::',
  ':::mermaid-diagram\n```js\nA --> B\n```\n:::',
  ':::avi-file-mention{path="C:\\outside.js" line-from="1"}\ntext\n:::',
  ':::avi-file-mention{path="./file.js" line-from="4" line-to="2"}\ntext\n:::',
  '::avi-copy{label="Empty"}',
]) {
  const markup = renderMessage(invalid);
  assert.doesNotMatch(markup, /rich-chart|copyable-panel|directive-heading|mermaid-visualization/);
  assert.match(markup, /avi-|callout|mermaid/);
}

assert.doesNotMatch(renderMessage('<script>alert(1)</script>'), /<script>/);
assert.doesNotMatch(renderMessage('::avi-chart{type="bar" data="[]"}'), /rich-chart/);
for (const incomplete of [
  ':::avi-file-mention{path="./file.js"}\nPartial body',
  ':::avi-diff\n```diff\n-old\n+new\n```',
  ':::mermaid-diagram\n```mermaid\nflowchart LR\nA --> B\n```',
  ':::latex\nE = mc^2',
]) {
  const markup = renderMessage(incomplete);
  assert.doesNotMatch(markup, /copyable-panel|mermaid-visualization|latex-visualization/);
  assert.match(markup, /:::/);
}

console.log('Rich content tests passed.');
