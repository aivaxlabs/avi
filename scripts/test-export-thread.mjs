import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-export-thread-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.USERPROFILE = resolvedProfile;

let database;
try {
  database = await import('../src/main/database.js');
  const { CLIENT_TOOLS } = await import('../src/main/client-tools.js');
  const {
    createConversation,
    insertMessage,
    replaceTasks,
  } = database;

  const exportTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_export_thread');
  assert.ok(exportTool, 'chat_export_thread must be registered');
  assert.equal(exportTool.approval, 'never');
  assert.equal(exportTool.canEditFile, false);
  assert.equal(exportTool.canPerformDestructiveActions, false);

  const inspectTool = CLIENT_TOOLS.find((tool) => tool.name === 'chat_inspect_thread');
  assert.match(
    inspectTool.description,
    /chat_export_thread/,
    'inspect description must point to the export tool',
  );

  const workspace = join(resolvedProfile, 'workspace');
  const conversation = createConversation({
    title: 'Export sample',
    model: 'test:model',
    projectPath: workspace,
  });
  replaceTasks(conversation.id, [{ title: 'Do the thing', status: 'pending', done: false }]);

  const mediaPath = join(resolvedProfile, 'shot.png');
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(mediaPath, pngBytes);

  const userAttachmentPath = join(resolvedProfile, 'notes.txt');
  writeFileSync(userAttachmentPath, 'user supplied notes');

  insertMessage({
    conversationId: conversation.id,
    role: 'user',
    status: 'sent',
    content: 'Please investigate and use a tool.',
    attachments: [
      { kind: 'file', name: 'notes.txt', mime: 'text/plain', path: userAttachmentPath },
      { kind: 'context_marker', label: '/skill', text: 'design' },
    ],
  });

  insertMessage({
    conversationId: conversation.id,
    role: 'assistant',
    status: 'completed',
    model: 'test:model',
    content: 'Final answer to the user.',
    segments: [
      { type: 'reasoning', status: 'completed', text: 'Private reasoning about the plan.' },
      {
        type: 'tool-call',
        key: 'round:0:call-1',
        callId: 'call-1',
        name: 'run_in_terminal',
        status: 'completed',
        invocationGoal: 'List files',
        requiresHumanApproval: false,
        isMcp: false,
        argumentsText: JSON.stringify({ command: 'ls -la', mode: 'sync' }),
        resultText: 'total 0\ndrwxr-xr-x  2 user user 40 .',
      },
      {
        type: 'tool-call',
        key: 'round:0:call-2',
        callId: 'call-2',
        name: 'read_media_file',
        status: 'completed',
        invocationGoal: 'Inspect screenshot',
        argumentsText: JSON.stringify({ path: mediaPath }),
        resultText: 'Media file loaded.',
        mediaContent: [
          { type: 'image_url', image_url: { path: mediaPath, mime: 'image/png' } },
        ],
      },
      { type: 'content', status: 'completed', text: 'Final answer to the user.' },
    ],
  });

  const result = await exportTool.execute(
    { threadId: conversation.id },
    { chatRunner: { runs: new Map(), semaphores: { waitSnapshot: () => null } }, conversationId: conversation.id },
  );

  const exportDirectory = result.split('\n')[1].trim();
  assert.ok(exportDirectory.length > 0, 'result must include the export directory path');

  const metadata = JSON.parse(readFileSync(join(exportDirectory, 'metadata.json'), 'utf8'));
  assert.equal(metadata.thread.id, conversation.id);
  assert.equal(metadata.thread.title, 'Export sample');
  assert.equal(metadata.counts.messages, 2);
  assert.equal(metadata.counts.assistant, 1);
  assert.equal(metadata.counts.user, 1);
  assert.equal(metadata.thread.tasks.length, 1);
  assert.equal(metadata.thread.status, 'idle');

  assert.equal(metadata.counts.attachments, 2, 'must store the text file and the tool screenshot');
  assert.equal(metadata.attachments.length, 2);

  const transcriptJson = JSON.parse(readFileSync(join(exportDirectory, 'transcript.json'), 'utf8'));
  assert.equal(transcriptJson.messages.length, 2);
  const assistant = transcriptJson.messages.find((message) => message.role === 'assistant');
  const toolSegment = assistant.segments.find((segment) => segment.name === 'run_in_terminal');
  assert.equal(toolSegment.hasResult, true);
  assert.match(toolSegment.argumentsText, /ls -la/);
  assert.match(toolSegment.resultText, /drwxr-xr-x/);
  const mediaSegment = assistant.segments.find((segment) => segment.name === 'read_media_file');
  assert.equal(mediaSegment.mediaContent.length, 1);
  assert.match(mediaSegment.mediaContent[0].ref, /^attachments\//);

  const transcript = readFileSync(join(exportDirectory, 'transcript.md'), 'utf8');
  assert.match(transcript, /----- BEGIN REASONING -----/);
  assert.match(transcript, /Private reasoning about the plan\./);
  assert.match(transcript, /----- BEGIN TOOL CALL: run_in_terminal -----/);
  assert.match(transcript, /\[arguments\]/);
  assert.match(transcript, /----- BEGIN CONTENT -----/);
  assert.match(transcript, /\[context_marker\] \/skill :: design/);

  const storedFiles = readdirSync(join(exportDirectory, 'attachments'));
  assert.equal(storedFiles.length, 2);
  const storedImage = storedFiles.find((name) => name.endsWith('.png'));
  assert.ok(storedImage, 'the screenshot must be stored as a .png');
  assert.deepEqual(readFileSync(join(exportDirectory, 'attachments', storedImage)), pngBytes);

  console.log('chat_export_thread export tests passed.');
} finally {
  database?.closeDatabase();
  rmSync(resolvedProfile, { recursive: true, force: true });
}
process.exit(0);
