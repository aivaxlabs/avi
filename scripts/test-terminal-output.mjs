import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { terminalTools, terminals } from '../src/main/tools/terminal.js';

const workspacePath = mkdtempSync(join(tmpdir(), 'avi-terminal-output-test-'));
const [runInTerminal, sendToTerminal, readTerminalOutput] = ['run_in_terminal', 'send_to_terminal', 'read_terminal_output']
  .map((name) => terminalTools.find((tool) => tool.name === name));

writeFileSync(join(workspacePath, 'emit.mjs'), `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = process.argv[2];

if (mode === 'ansi') {
  for (const part of ['plain\\n', 'second\\n', 'third \\u001B[3', '1mred\\u001B[0m\\n', '\\u001B[1mbold\\u001B[0m tail']) {
    process.stdout.write(part);
    await sleep(80);
  }
} else if (mode === 'single') {
  process.stdout.write('only chunk');
} else if (mode === 'large') {
  const line = \`\${'x'.repeat(98)}\\n\`;
  process.stdout.write(\`first line\\n\${line.repeat(25_000)}last line\\n\`);
} else if (mode === 'prompt') {
  process.stdout.write('name? ');
  process.stdin.once('data', (data) => {
    process.stdout.write(\`hello \${String(data).trim()}\\n\`);
    process.exit(0);
  });
}
`);

const run = (mode, executionMode = 'sync') => runInTerminal.execute(
  {
    command: `bun emit.mjs ${mode}`,
    explanation: 'Print controlled output.',
    goal: 'Exercise the terminal output buffer.',
    mode: executionMode,
    timeout: 30,
  },
  { signal: new AbortController().signal, workspacePath, conversationId: 'terminal-output-test' },
);

try {
  assert.equal(await run('ansi'), 'plain\nsecond\nthird red\nbold tail');
  assert.equal(await run('single'), 'only chunk', 'output below the batch size is flushed when the process exits');

  const large = await run('large');
  assert.ok(large.endsWith('last line\n\n[output truncated]'));
  assert.doesNotMatch(large, /first line/);
  assert.equal(large.length, 2_000_000 + '\n[output truncated]'.length);

  const prompt = await run('prompt', 'async');
  const terminalId = prompt.match(/Terminal ID: (\S+)/)[1];
  assert.match(prompt, /Status: running\nname\? $/, 'a pending chunk is visible when the output is read');

  const answered = await sendToTerminal.execute({ id: terminalId, command: 'Avi', waitForOutput: true });
  assert.match(answered, /name\? hello Avi\n$/);
  const terminal = terminals.get(terminalId);
  if (terminal.running) await new Promise((resolve) => terminal.events.once('close', resolve));
  assert.equal(
    await readTerminalOutput.execute({ id: terminalId }),
    `Terminal ID: ${terminalId}\nname? hello Avi\n`,
  );

  console.log('Terminal output buffer tests passed.');
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}
