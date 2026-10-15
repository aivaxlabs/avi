import 'monaco-editor/features/register.all.js';
import '../../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon-modifiers.css';
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/common/standaloneStrings.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { conf, language } from 'monaco-editor/languages/definitions/markdown/markdown.js';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const frontmatterRules = [
  [/^(\w[\w-]*)(\s*:)/, ['type', 'delimiter']],
  [/#.*$/, 'comment'],
  [/".*?"|'.*?'/, 'string'],
  [/\b(true|false|null)\b/, 'keyword'],
  [/-?\d+(\.\d+)?\b/, 'number'],
];

monaco.languages.register({ id: 'avi-markdown' });
monaco.languages.setLanguageConfiguration('avi-markdown', {
  ...conf,
  onEnterRules: [
    { beforeText: /^\s*([-*+]|\d+[.)])\s+\[[ xX]\]\s+\S.*$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: '- [ ] ' } },
    { beforeText: /^\s*[-*+]\s+\S.*$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: '- ' } },
  ],
});
monaco.languages.setMonarchTokensProvider('avi-markdown', {
  ...language,
  start: 'document',
  tokenizer: {
    ...language.tokenizer,
    document: [
      [/^---\s*$/, { token: 'keyword', next: '@frontmatter' }],
      [/^/, { token: '', switchTo: '@root' }],
    ],
    frontmatter: [
      [/^---\s*$/, { token: 'keyword', switchTo: '@root' }],
      ...frontmatterRules,
    ],
  },
});

monaco.languages.register({ id: 'avi-json' });
monaco.languages.setLanguageConfiguration('avi-json', {
  brackets: [['{', '}'], ['[', ']']],
  autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
});
monaco.languages.setMonarchTokensProvider('avi-json', {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/\b(true|false|null)\b/, 'keyword'],
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
    ],
  },
});

function cssColor(styles, name, fallback) {
  const probe = document.createElement('span');
  probe.style.color = styles.getPropertyValue(name).trim() || fallback;
  document.body.append(probe);
  const [r, g, b, a = 1] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
  probe.remove();
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : ''}`;
}

export function applyMonacoTheme() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const dark = root.dataset.colorScheme === 'dark';
  const color = (name, fallback) => cssColor(styles, name, fallback).slice(1);
  monaco.editor.defineTheme('avi', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: color('--prism-keyword', dark ? '#569cd6' : '#0000ff') },
      { token: 'type', foreground: color('--prism-property', dark ? '#9cdcfe' : '#0451a5') },
      { token: 'string', foreground: color('--prism-string', dark ? '#ce9178' : '#a31515') },
      { token: 'number', foreground: color('--prism-number', dark ? '#b5cea8' : '#098658') },
      { token: 'comment', foreground: color('--prism-comment', dark ? '#6a9955' : '#008000') },
      { token: 'strong', fontStyle: 'bold' },
      { token: 'emphasis', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': cssColor(styles, '--background-1', dark ? '#1e1e1e' : '#ffffff'),
      'editor.foreground': cssColor(styles, '--text-1', dark ? '#cccccc' : '#202020'),
      'editorLineNumber.foreground': cssColor(styles, '--text-3', '#858585'),
      'editor.selectionBackground': cssColor(styles, '--primary-color-opaque', '#264f78'),
    },
  });
  monaco.editor.setTheme('avi');
}

export { monaco };
