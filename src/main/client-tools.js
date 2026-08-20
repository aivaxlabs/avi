import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { EOL } from 'node:os';
import {
  basename,
  extname,
  isAbsolute,
  resolve,
} from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
import { requestAivax } from './aivax-client.js';
import {
  attachmentToApiBlock,
  createConversation,
  deleteConversation,
  forkConversation,
  getConversation,
  getMessages,
  listAllConversations,
  listSubagents,
  replaceTasks,
  updateConversation,
} from './database.js';
import { resolveSubagentModel } from './default-models.js';
import { filePathToAttachment, materializeAttachment } from './files.js';
import { applyMultiReplaceFile } from './multi-replace-file.js';
import { resolveTerminalShell } from './terminal-shell.js';
import { traceVerbose } from './trace-log.js';

const MAX_READ_URL_CHARS = 100_000;
const MAX_TERMINAL_OUTPUT_CHARS = 2_000_000;
const MIN_TERMINAL_TIMEOUT_SECONDS = 1;
const MAX_TERMINAL_TIMEOUT_SECONDS = 300;
const DEFAULT_TERMINAL_TIMEOUT_SECONDS = 30;
const MIN_SLEEP_SECONDS = 5;
const MAX_SLEEP_SECONDS = 30 * 60;
const MAX_INSPECTED_TURNS = 4;
const MAX_ASSISTANT_MESSAGES_BEFORE_FINAL = 6;
const MAX_INSPECTED_TOOL_RESULT_CHARS = 512 * 4;
const ANSI_ESCAPE_SEQUENCE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const terminals = new Map();

function appendTerminalOutput(terminal, chunk) {
  terminal.output = `${terminal.output}${String(chunk)}`.replace(ANSI_ESCAPE_SEQUENCE, '');
  if (terminal.output.length > MAX_TERMINAL_OUTPUT_CHARS) {
    terminal.output = terminal.output.slice(-MAX_TERMINAL_OUTPUT_CHARS);
    terminal.truncated = true;
  }
  terminal.events.emit('activity');
}

function terminalStatus(terminal) {
  if (terminal.running) return 'running';
  if (terminal.stopping) return 'stopped';
  return terminal.exitCode === 0 ? 'completed' : 'failed';
}

function terminalSnapshot(terminal, { includeId = true } = {}) {
  const parts = [];
  if (includeId) parts.push(`Terminal ID: ${terminal.id}`);
  const status = terminalStatus(terminal);
  if (status === 'running') {
    parts.push('Status: running');
  } else if (status === 'stopped') {
    parts.push('Status: stopped');
  } else if (status === 'failed') {
    parts.push(`Exit code: ${terminal.exitCode}${terminal.signal ? ` (signal: ${terminal.signal})` : ''}`);
  }
  if (terminal.output) parts.push(terminal.output);
  if (terminal.truncated) parts.push('[output truncated]');
  return parts.join('\n');
}

function stopTerminal(terminal) {
  if (!terminal.running || terminal.stopping) return;
  terminal.stopping = true;
  if (process.platform === 'win32' && terminal.child.pid) {
    spawn('taskkill', ['/PID', String(terminal.child.pid), '/T', '/F'], {
      windowsHide: true,
    }).unref();
    return;
  }
  terminal.child.kill();
}

export function stopConversationTerminals(conversationId) {
  for (const terminal of terminals.values()) {
    if (terminal.conversationId === conversationId) stopTerminal(terminal);
  }
}

async function waitForTerminal(terminal, { untilExit, timeout }) {
  if (!terminal.running) return 'completed';

  return new Promise((resolveWait) => {
    let idleTimer;
    let timeoutTimer;

    const finish = (reason) => {
      clearTimeout(idleTimer);
      clearTimeout(timeoutTimer);
      terminal.events.removeListener('activity', onActivity);
      terminal.events.removeListener('close', onClose);
      resolveWait(reason);
    };
    const onClose = () => finish('completed');
    const onActivity = () => {
      if (untilExit) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish('idle'), 300);
    };

    terminal.events.on('activity', onActivity);
    terminal.events.once('close', onClose);
    if (!untilExit) {
      idleTimer = setTimeout(() => finish('idle'), 300);
    }
    timeoutTimer = setTimeout(() => finish('timeout'), timeout);
  });
}

export const CLIENT_TOOLS = Object.freeze([
  {
    name: 'get_chat_attachments',
    description: 'Get local paths for images, audio, and videos attached by the user in the current chat. Existing files are returned directly; inference-only media is copied to Avi temporary storage first.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_input, { userAttachments = [] }) => {
      const mediaAttachments = userAttachments.filter((attachment) => (
        ['image_url', 'input_audio', 'video_url'].includes(attachment?.kind)
        || ['image', 'audio', 'video'].some((type) => attachment?.mime?.startsWith(`${type}/`))
      ));
      const results = [];
      const seen = new Set();

      for (const attachment of mediaAttachments) {
        const identity = attachment.id
          ?? attachment.path
          ?? attachment.dataUrl
          ?? attachment.base64;
        if (identity && seen.has(identity)) continue;
        if (identity) seen.add(identity);

        const localFile = await materializeAttachment(attachment);
        if (!localFile) continue;

        results.push({
          name: attachment.name ?? basename(localFile.path),
          kind: attachment.kind,
          mime: attachment.mime ?? null,
          ...localFile,
        });
      }

      return { attachments: results };
    },
  },
  {
    name: 'read_media_file',
    description: 'Read local images, videos, audio, and PDFs. The selected model reads supported media directly; when connected and enabled, AIVAX Media Descriptions converts unsupported media to text and the optional extractionGuidance refines that extraction. extractionGuidance is ignored when the model reads the media directly. Text files are not supported.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description: 'Absolute path to the local media file.',
        },
        extractionGuidance: {
          type: 'string',
          description: 'Use this field to refine the extraction result to focus and guide extracting specific details, such as: extracting UI artifacts, extracting text from screenshots, diagnosing errors, understanding technical diagrams, analyzing information, etc.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async ({ path, extractionGuidance }, {
      aivax,
      capabilities = {},
      requestAivax: requestMediaDescription = requestAivax,
      signal,
    }) => {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        throw new Error('path must be an absolute file path.');
      }

      const attachment = filePathToAttachment(path);
      const supported = (attachment.kind === 'image_url' && capabilities.images)
        || (attachment.kind === 'video_url' && capabilities.video)
        || (attachment.kind === 'input_audio' && capabilities.audio)
        || (
          attachment.kind === 'file'
          && attachment.mime === 'application/pdf'
          && capabilities.pdfFiles
        );
      if (supported) {
        return {
          output: `Media file loaded: ${attachment.path}`,
          mediaContent: [attachmentToApiBlock(attachment, capabilities)],
        };
      }
      if (attachment.kind === 'text_inline') {
        throw new Error('read_media_file does not read text files. Use read_file instead.');
      }
      if (aivax?.connected && aivax.mediaDescriptionsEnabled) {
        const audioFormat = extname(attachment.path).slice(1).toLowerCase();
        const input = attachment.kind === 'image_url'
          ? { type: 'image_url', image_url: { url: attachment.dataUrl } }
          : attachment.kind === 'video_url'
            ? { type: 'video_url', video_url: { url: attachment.dataUrl } }
            : attachment.kind === 'input_audio'
              ? {
                type: 'input_audio',
                input_audio: {
                  data: attachment.base64,
                  format: attachment.format ?? 'mp3',
                },
              }
              : ['wav', 'm4a', 'flac', 'ogg', 'webm', 'aac'].includes(audioFormat)
                ? {
                  type: 'input_audio',
                  input_audio: {
                    data: attachment.dataUrl.split(',')[1] ?? '',
                    format: audioFormat,
                  },
                }
                : attachment.kind === 'file' && attachment.mime === 'application/pdf'
                  ? {
                    type: 'file',
                    file: {
                      filename: attachment.name,
                      file_data: attachment.dataUrl,
                    },
                  }
                  : null;
        if (input) {
          const response = await requestMediaDescription('/api/v1/generations/descriptions', {
            body: {
              extractionGuidance: typeof extractionGuidance === 'string' && extractionGuidance.trim()
                ? extractionGuidance.trim()
                : undefined,
              input: [input],
            },
            includeResponseEnvelope: true,
            responseType: 'array',
            signal,
          });
          if (response.data && response.data[0]) {
            return JSON.stringify(response.data[0]);
          } else {
            return JSON.stringify(response);
          }
        }
      }
      if (attachment.kind === 'video_url') {
        throw new Error('The selected model does not expose video input capability.');
      }
      throw new Error(`The selected model cannot read this media type (${attachment.mime}).`);
    },
  },
  {
    name: 'update_tasks',
    description: 'Replace the current thread task list with the complete provided snapshot. Use optionally for substantial multi-step work, not trivial tasks. Send an empty list to clear it.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 200 },
              description: { type: 'string', maxLength: 2000 },
              done: { type: 'boolean' },
              result: { type: ['string', 'null'], maxLength: 4000 },
            },
            required: ['title', 'description', 'done', 'result'],
            additionalProperties: false,
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
    execute: async ({ tasks }, { chatRunner, conversationId, workMode }) => {
      if (workMode === 'plan') throw new Error('update_tasks is unavailable in Plan mode.');
      if (!Array.isArray(tasks) || tasks.length > 100) {
        throw new Error('tasks must be an array with at most 100 items.');
      }
      if (tasks.some((task) => (
        !task
        || typeof task !== 'object'
        || Array.isArray(task)
        || typeof task.title !== 'string'
        || typeof task.description !== 'string'
        || typeof task.done !== 'boolean'
        || (task.result !== null && typeof task.result !== 'string')
      ))) {
        throw new Error('Each task must contain a string title and description, boolean done, and string or null result.');
      }
      const normalized = tasks.map((task) => ({
        title: task.title.trim(),
        description: task.description.trim(),
        done: task.done,
        result: task.result?.trim() || null,
      }));
      if (normalized.some((task) => (
        !task.title
        || task.title.length > 200
        || task.description.length > 2000
        || (task.result?.length ?? 0) > 4000
      ))) {
        throw new Error('One or more tasks exceed the allowed field limits.');
      }
      const persisted = replaceTasks(conversationId, normalized);
      chatRunner.emit(conversationId, { type: 'tasks', tasks: persisted });
      return persisted.length === 0
        ? 'Task list cleared.'
        : `Task list updated: ${persisted.length} task(s).`;
    },
  },
  {
    name: 'start_goal',
    description: 'Start a Goal only when explicitly requested by the user or system/developer instructions; do not infer Goals from ordinary tasks. Fails if an unfinished Goal exists; use update_goal_status only for status.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        specification: {
          type: 'string',
          minLength: 1,
          description: 'The complete objective, acceptance terms, constraints, and conditions for authentic completion.',
        },
      },
      required: ['specification'],
      additionalProperties: false,
    },
    execute: async (
      { specification },
      {
        chatRunner,
        conversationId,
        model,
        reasoningEffort,
        permissionMode,
        ultraMode,
      },
    ) => {
      const normalizedSpecification = String(specification ?? '').trim();
      if (!normalizedSpecification) throw new Error('specification is required.');
      const result = await chatRunner.startGoal({
        conversationId,
        model,
        specification: normalizedSpecification,
        reasoningEffort,
        permissionMode,
        ultraMode,
      });
      return [
        'Goal started.',
        `ID: ${result.goal.id}`,
        `Status: ${result.goal.status}`,
        `Started: ${result.goal.startedAt}`,
        'Specification:',
        result.goal.specification,
      ].join('\n');
    },
  },
  {
    name: 'update_goal_status',
    description: 'Classify the active Goal as completed or blocked. Use completed only with verified acceptance evidence, and blocked only for a real condition that prevents further progress.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['completed', 'blocked'],
        },
        summary: {
          type: 'string',
          minLength: 1,
          description: 'For completed, concrete evidence that every acceptance term was met. For blocked, the exact blocker and work already attempted.',
        },
      },
      required: ['status', 'summary'],
      additionalProperties: false,
    },
    execute: async ({ status, summary }, { chatRunner, conversationId }) => {
      if (!['completed', 'blocked'].includes(status)) {
        throw new Error('status must be completed or blocked.');
      }
      const normalizedSummary = String(summary ?? '').trim();
      if (!normalizedSummary) throw new Error('summary is required.');
      const result = await chatRunner.changeGoal({
        conversationId,
        action: status,
        summary: normalizedSummary,
      });
      return [
        `Goal ${result.status}.`,
        `ID: ${result.goal_id}`,
        'Summary:',
        result.summary,
        `Tokens transacted: ${result.tokens_transacted}`,
        `Active time: ${result.active_time_ms} ms`,
        `Started: ${result.started_at}`,
      ].join('\n');
    },
  },
  {
    name: 'ask_question',
    description: 'Ask the user focused questions and wait for actual answers before continuing. Never infer or invent answers. Use options only for single_choice and multiple_choice questions.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['single_choice', 'multiple_choice', 'free_text'],
                description: 'Use free_text for an open answer without options. Use single_choice or multiple_choice when options are provided.',
              },
              question: {
                type: 'string',
                minLength: 1,
              },
              options: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                description: 'Required for single_choice and multiple_choice. Omit for free_text.',
                items: {
                  type: 'string',
                  minLength: 1,
                },
              },
            },
            required: ['type', 'question'],
            additionalProperties: false,
          },
        },
      },
      required: ['questions'],
      additionalProperties: false,
    },
    execute: async ({ questions }, { chatRunner, conversationId, signal, workMode }) => {
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error('questions must be a non-empty array.');
      }

      const normalizedQuestions = questions.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`questions[${index}] must be an object.`);
        }
        if (!['single_choice', 'multiple_choice', 'free_text'].includes(item.type)) {
          throw new Error(`questions[${index}].type is invalid.`);
        }
        const question = typeof item.question === 'string' ? item.question.trim() : '';
        if (!question) {
          throw new Error(`questions[${index}].question must be a non-empty string.`);
        }
        if (item.type !== 'free_text') {
          if (item.options === undefined) {
            throw new Error(`questions[${index}].options is required for ${item.type}.`);
          }
          if (
            !Array.isArray(item.options)
            || item.options.length < 1
            || item.options.length > 3
            || item.options.some((option) => typeof option !== 'string' || !option.trim())
          ) {
            throw new Error(`questions[${index}].options must contain one to three non-empty strings.`);
          }
        }
        return {
          type: item.type,
          question,
          ...(item.type === 'free_text'
            ? {}
            : { options: item.options.map((option) => option.trim()) }),
        };
      });

      const result = await chatRunner.askQuestion({
        conversationId,
        questions: normalizedQuestions,
        signal,
        workMode: workMode ?? null,
      });
      if (result.cancelled) {
        if (result.afk) {
          return 'The user is away from keyboard (AFK) and did not answer within 60 seconds. No answers were collected. Decide whether to continue without the answers or stop.';
        }
        return 'Question cancelled; no answers were collected.';
      }
      return [
        'User answers:',
        ...result.answers.map(({ question, answer }) => (
          `- ${question}: ${Array.isArray(answer) ? answer.join(', ') : answer}`
        )),
      ].join('\n');
    },
  },
  {
    name: 'chat_list_folders',
    description: 'List folders associated with chat threads.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async (_input, { workspacePath }) => {
      const folders = new Map();
      const conversations = listAllConversations();
      for (const folderPath of [
        workspacePath,
        ...conversations.map((conversation) => conversation.projectPath),
      ].filter(Boolean)) {
        const path = resolve(folderPath);
        const key = process.platform === 'win32' ? path.toLowerCase() : path;
        if (!folders.has(key)) {
          folders.set(key, {
            path,
            name: basename(path) || path,
            threadCount: 0,
          });
        }
      }

      for (const conversation of conversations) {
        const path = resolve(conversation.projectPath);
        const key = process.platform === 'win32' ? path.toLowerCase() : path;
        const folder = folders.get(key);
        if (folder) folder.threadCount += 1;
      }

      const results = [...folders.values()];
      if (results.length === 0) return 'No folders found.';
      return [
        'Folders:',
        results.map((folder) => [
          `- ${folder.name}`,
          `  Path: ${folder.path}`,
          `  Threads: ${folder.threadCount}`,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'chat_list_threads',
    description: 'List chat threads, optionally filtered by an exact folder path.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        folderPath: {
          type: 'string',
          description: 'Optional absolute folder path used to filter threads.',
        },
      },
    },
    execute: async ({ folderPath }, { chatRunner, conversationId }) => {
      if (folderPath && !isAbsolute(String(folderPath))) {
        throw new Error('folderPath must be absolute.');
      }
      const normalizedFolder = folderPath
        ? resolve(folderPath)
        : null;
      const folderKey = process.platform === 'win32'
        ? normalizedFolder?.toLowerCase()
        : normalizedFolder;
      const sourceConversation = getConversation(conversationId);
      const threads = listAllConversations()
        .filter((conversation) => sourceConversation?.isSideChat || !conversation.isSideChat)
        .filter((conversation) => {
          if (!folderKey) return true;
          const conversationPath = resolve(conversation.projectPath);
          return (process.platform === 'win32' ? conversationPath.toLowerCase() : conversationPath)
            === folderKey;
        })
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          folderPath: conversation.projectPath,
          model: conversation.model,
          status: chatRunner.semaphores.waitSnapshot(conversation.id)
            ? 'sleeping'
            : chatRunner.runs.has(conversation.id) ? 'running' : 'idle',
          semaphoreHoldings: chatRunner.semaphores.holdings(conversation.id),
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        }));

      if (threads.length === 0) return 'No threads found.';
      return [
        'Threads:',
        threads.map((thread) => [
          `- ${thread.title}`,
          `  ID: ${thread.id}`,
          `  Folder: ${thread.folderPath}`,
          `  Model: ${thread.model}`,
          `  Status: ${thread.status}`,
          ...(thread.semaphoreHoldings.length > 0
            ? [`  Semaphore permits: ${thread.semaphoreHoldings
              .map((holding) => `${holding.name} (${holding.count})`)
              .join(', ')}`]
            : []),
          `  Created: ${thread.createdAt}`,
          `  Updated: ${thread.updatedAt}`,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'chat_list_thread_context',
    description: 'List the current thread context, including visible orchestrator and sub-agent threads with statuses and initial prompts.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_input, { chatRunner, conversationId }) => {
      const currentConversation = getConversation(conversationId);
      if (!currentConversation) throw new Error('The current thread was not found.');
      const teamRootId = currentConversation.isSubagent || currentConversation.isSideChat
        ? currentConversation.parentConversationId
        : currentConversation.id;
      const orchestrator = teamRootId ? getConversation(teamRootId) : null;
      const subagents = teamRootId ? listSubagents(teamRootId) : [];
      const visibleConversations = currentConversation.isSubagent
        ? [orchestrator, ...subagents.filter(({ id }) => id !== currentConversation.id)]
        : currentConversation.isSideChat
          ? [orchestrator, ...subagents]
          : subagents;
      const threads = visibleConversations.filter(Boolean).map((conversation) => {
        const messages = getMessages(conversation.id);
        const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
        const lastAssistant = messages
          .slice(lastUserIndex + 1)
          .findLast((message) => message.role === 'assistant');
        const initialPrompt = String(
          conversation.initialPrompt ?? conversation.firstPrompt ?? '',
        ).replace(/\s+/g, ' ').trim();
        return {
          id: conversation.id,
          title: conversation.title,
          role: conversation.isSideChat ? 'side_chat' : conversation.isSubagent ? 'subagent' : 'orchestrator',
          parentId: conversation.parentConversationId,
          status: chatRunner.semaphores.waitSnapshot(conversation.id)
            ? 'sleeping'
            : chatRunner.runs.has(conversation.id)
              ? 'in_progress'
              : lastAssistant?.status === 'completed'
                ? 'completed'
                : conversation.isSubagent
                  ? 'failed'
                  : 'idle',
          semaphoreHoldings: chatRunner.semaphores.holdings(conversation.id),
          initialPrompt: initialPrompt.length > 256 ? `${initialPrompt.slice(0, 256)}...` : initialPrompt,
        };
      });
      return {
        currentThread: {
          id: currentConversation.id,
          role: currentConversation.isSideChat ? 'side_chat' : currentConversation.isSubagent ? 'subagent' : 'orchestrator',
          parentId: currentConversation.parentConversationId ?? null,
        },
        threads,
      };
    },
  },
  {
    name: 'list_semaphores',
    description: 'List semaphore permits held by or awaited by the current thread, plus a global snapshot of every semaphore with holders and FIFO queues.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_input, { chatRunner, conversationId }) => ({
      holdings: chatRunner.semaphores.holdings(conversationId),
      waiting: chatRunner.semaphores.waitSnapshot(conversationId),
      all: chatRunner.semaphores.globalSnapshot(),
    }),
  },
  {
    name: 'chat_create_thread',
    description: 'Create a chat thread and optionally start it with a prompt.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Optional prompt to send immediately after creating the thread.',
        },
        folderPath: {
          type: 'string',
          description: 'Optional absolute folder path for the thread. Defaults to the current folder.',
        },
        model_name: {
          type: 'string',
          description: 'Optional configured model to invoke. Defaults to the last model used in the folder.',
        },
        model_level: {
          type: 'string',
          description: 'Configured model level for this task when sub-agent model levels are enabled.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Optional reasoning effort to invoke. Defaults to the last reasoning effort used in the folder.',
        },
        wait_for_response: {
          type: 'boolean',
          description: 'When true, waits for the prompted thread to finish and returns its final response.',
        },
      },
    },
    execute: async (
      {
        prompt,
        folderPath,
        model_name,
        model_level,
        reasoning_effort,
        wait_for_response,
      },
      {
        chatRunner,
        model,
        models,
        reasoningEffort,
        permissionMode,
        workspacePath,
        defaultModels,
      },
    ) => {
      if (folderPath && !isAbsolute(String(folderPath))) {
        throw new Error('folderPath must be absolute.');
      }
      const projectPath = resolve(folderPath || workspacePath || process.cwd());
      const details = await stat(projectPath);
      if (!details.isDirectory()) {
        throw new Error('folderPath must point to a directory.');
      }
      const projectKey = process.platform === 'win32'
        ? projectPath.toLowerCase()
        : projectPath;
      const folderConversations = listAllConversations().filter((item) => {
        const conversationPath = resolve(item.projectPath);
        return (process.platform === 'win32' ? conversationPath.toLowerCase() : conversationPath)
          === projectKey;
      });
      const levelSelection = defaultModels?.subagents?.enabled
        ? resolveSubagentModel(model_level, defaultModels, models, {
          modelId: model,
          reasoningEffort,
        })
        : null;
      const selectedModelId = levelSelection?.modelId ?? (model_name === undefined
        ? folderConversations[0]?.model ?? model
        : String(model_name).trim());
      const selectedModel = models.find((item) => item.id === selectedModelId);
      if (!selectedModel) {
        throw new Error(
          selectedModelId
            ? `Model "${selectedModelId}" is not configured. Pass a valid model_name.`
            : 'No model has been used in this folder. Pass model_name.',
        );
      }
      const lastReasoningEffort = folderConversations
        .flatMap((item) => getMessages(item.id))
        .filter((messageItem) => messageItem.reasoningEffort)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
        ?.reasoningEffort ?? null;
      const selectedReasoningEffort = levelSelection
        ? levelSelection.reasoningEffort
        : reasoning_effort === undefined
          ? lastReasoningEffort
          : String(reasoning_effort).trim();
      if (
        selectedReasoningEffort
        && !selectedModel.reasoning.includes(selectedReasoningEffort)
      ) {
        throw new Error(
          `Reasoning effort "${selectedReasoningEffort}" is not supported by ${selectedModel.name}.`,
        );
      }
      const normalizedPrompt = String(prompt ?? '').trim();
      const conversation = createConversation({
        model: selectedModel.id,
        projectPath,
        createdBy: 'agent',
      });
      let message = null;
      let response = null;

      if (normalizedPrompt) {
        const result = await chatRunner.send({
          conversationId: conversation.id,
          model: selectedModel.id,
          reasoningEffort: selectedReasoningEffort,
          permissionMode,
          text: normalizedPrompt,
          fromAgent: true,
          project: { path: projectPath },
        });
        message = result.message;
        const run = chatRunner.runs.get(conversation.id);
        if (wait_for_response === true && run) {
          await run.completion;
          const responseMessage = getMessages(conversation.id)
            .find((item) => item.id === run.assistantMessageId);
          if (responseMessage) {
            response = {
              messageId: responseMessage.id,
              status: responseMessage.status,
              text: answerTextFromTextualBlocks(responseMessage.content),
            };
          }
        }
      }

      const thread = {
        id: conversation.id,
        title: getConversation(conversation.id).title,
        folderPath: projectPath,
        model: selectedModel.id,
        reasoningEffort: selectedReasoningEffort,
        status: message ? wait_for_response === true ? 'completed' : 'running' : 'idle',
      };
      return [
        `Thread created: ${thread.title}`,
        `ID: ${thread.id}`,
        `Folder: ${thread.folderPath}`,
        `Model: ${thread.model}`,
        `Reasoning effort: ${thread.reasoningEffort ?? 'default'}`,
        `Status: ${thread.status}`,
        ...(message ? [`Prompt message ID: ${message.id}`] : []),
        ...(response ? ['', `Response status: ${response.status}`, 'Response:', response.text] : []),
      ].join('\n');
    },
  },
  {
    name: 'chat_spawn_subagent',
    description: 'Start an asynchronous sub-agent for a focused task in the current workspace. Returns immediately with its thread_id. A Plan-mode sub-agent remains in Plan mode; its final response or terminal error is automatically steered to the orchestrator.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        model_name: {
          type: 'string',
          description: 'Optional configured model. Defaults to the orchestrator model.',
        },
        model_level: {
          type: 'string',
          description: 'Configured model level for this task when sub-agent model levels are enabled.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Optional reasoning effort. Defaults to the orchestrator reasoning effort.',
        },
        prompt: {
          type: 'string',
          description: 'The focused task the sub-agent must complete.',
        },
      },
      required: ['prompt'],
    },
    execute: async (
      {
        model_name,
        model_level,
        reasoning_effort,
        prompt,
      },
      {
        chatRunner,
        conversationId,
        model,
        models,
        reasoningEffort,
        permissionMode,
        tuning,
        defaultModels,
        workMode,
        ultraMode,
      },
    ) => {
      const parent = getConversation(conversationId);
      if (!parent || parent.isSideChat || parent.isSubagent) {
        throw new Error('Only an orchestrator thread can spawn a sub-agent.');
      }
      const runningSubagents = listAllConversations()
        .filter((conversation) => conversation.isSubagent)
        .filter((subagent) => chatRunner.runs.has(subagent.id))
        .length;
      if (runningSubagents >= (tuning?.maxConcurrentSubagents ?? 128)) {
        throw new Error(
          `The limit of ${tuning?.maxConcurrentSubagents ?? 128} running sub-agents has been reached.`,
        );
      }
      const normalizedPrompt = String(prompt ?? '').trim();
      if (!normalizedPrompt) throw new Error('prompt is required.');

      const levelSelection = defaultModels?.subagents?.enabled
        ? resolveSubagentModel(model_level, defaultModels, models, {
          modelId: model,
          reasoningEffort,
        })
        : null;
      const selectedModelId = levelSelection?.modelId
        ?? (model_name === undefined ? model : String(model_name).trim());
      const selectedModel = models.find((item) => item.id === selectedModelId);
      if (!selectedModel) {
        throw new Error(`Model "${selectedModelId}" is not configured.`);
      }
      const selectedReasoningEffort = levelSelection
        ? levelSelection.reasoningEffort
        : reasoning_effort === undefined
          ? reasoningEffort
          : String(reasoning_effort).trim();
      if (
        selectedReasoningEffort
        && !selectedModel.reasoning.includes(selectedReasoningEffort)
      ) {
        throw new Error(
          `Reasoning effort "${selectedReasoningEffort}" is not supported by ${selectedModel.name}.`,
        );
      }

      const result = forkConversation(parent.id, {
        subagent: true,
        subagentPrompt: normalizedPrompt,
        orchestrationMode: workMode === 'plan' ? 'plan' : ultraMode ? 'ultra' : null,
        autoForwardToParent: true,
      });
      if (!result) throw new Error('The sub-agent thread could not be created.');
      const subagent = selectedModel.id === result.conversation.model
        ? result.conversation
        : updateConversation(result.conversation.id, { model: selectedModel.id });
      chatRunner.emit(parent.id, { type: 'subagent-created', subagent });
      traceVerbose('orchestration.subagent-spawned', {
        thread_id: subagent.id,
        parent_thread_id: parent.id,
        model: selectedModel.modelId,
        provider_id: selectedModel.providerId,
        concurrent_runs: runningSubagents + 1,
      });
      const sent = await chatRunner.send({
        conversationId: subagent.id,
        model: selectedModel.id,
        reasoningEffort: selectedReasoningEffort,
        permissionMode,
        text: normalizedPrompt,
        workMode,
        ultraMode,
        project: { path: parent.projectPath },
      });

      return [
        'Sub-agent started.',
        `Thread ID: ${subagent.id}`,
        `Status: ${sent.queued ? 'queued' : 'working'}`,
      ].join('\n');
    },
  },
  {
    name: 'chat_send_prompt',
    description: 'Send a prompt to a chat thread. Messages are prioritized by default; set low_priority to queue behind active work. If the thread is waiting on ask_question, a prioritized message supersedes and cancels the pending question, while a low-priority message remains queued behind it. In Plan mode, messages stay in Plan mode and are limited to the current orchestration team.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The target thread ID.',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to send.',
        },
        low_priority: {
          type: 'boolean',
          description: 'When true, queue behind active work. Defaults to false, which prioritizes the message at the next safe inference or tool boundary.',
        },
      },
      required: ['threadId', 'prompt'],
    },
    execute: async ({ threadId, prompt, low_priority = false }, {
      chatRunner,
      conversationId,
      permissionMode,
      workMode,
    }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
      const normalizedPrompt = String(prompt ?? '').trim();
      if (!normalizedPrompt) throw new Error('prompt is required.');
      if (typeof low_priority !== 'boolean') {
        throw new Error('low_priority must be a boolean.');
      }
      const sourceConversation = getConversation(conversationId);
      if (conversation.isSideChat && !sourceConversation?.isSideChat) {
        throw new Error('Side chats are private to side-chat threads.');
      }
      const planMode = workMode === 'plan' || sourceConversation?.orchestrationMode === 'plan';
      if (planMode) {
        const teamRootId = sourceConversation?.isSubagent
          ? sourceConversation.parentConversationId
          : sourceConversation?.id;
        if (
          !teamRootId
          || (conversation.id !== teamRootId && conversation.parentConversationId !== teamRootId)
        ) {
          throw new Error('Plan-mode prompts are limited to the current orchestration team.');
        }
      }
      const result = await chatRunner.send({
        conversationId: conversation.id,
        model: conversation.model,
        text: normalizedPrompt,
        permissionMode,
        steer: !low_priority,
        fromAgent: true,
        workMode: planMode ? 'plan' : workMode,
        ultraMode: sourceConversation?.orchestrationMode === 'ultra'
          || conversation.orchestrationMode === 'ultra',
        queuePriority: sourceConversation?.isSubagent === true,
        project: { path: conversation.projectPath },
      });

      const pendingQuestion = chatRunner.getPendingQuestion?.(conversation.id);
      if (!low_priority && pendingQuestion) {
        chatRunner.answerQuestion({ questionId: pendingQuestion.questionId, cancelled: true });
      }
      const status = result.queued
        ? low_priority
          ? pendingQuestion ? 'queued_waiting_for_input' : 'queued'
          : 'steered'
        : 'running';
      return [
        'Prompt sent.',
        `Thread ID: ${conversation.id}`,
        `Message ID: ${result.message.id}`,
        `Status: ${status}`,
      ].join('\n');
    },
  },
  {
    name: 'chat_interrupt_thread',
    description: 'Interrupt the active run at its next safe boundary without stopping sub-agents, background processes, or queued prompts.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The thread ID to interrupt.',
        },
      },
      required: ['threadId'],
    },
    execute: async ({ threadId }, { chatRunner, conversationId }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
      if (conversation.isSideChat && !getConversation(conversationId)?.isSideChat) {
        throw new Error('Side chats are private to side-chat threads.');
      }
      const interrupted = chatRunner.runs.has(conversation.id);
      chatRunner.requestSteer(conversation.id);
      return interrupted
        ? `Thread ${conversation.id} interrupted.`
        : `Thread ${conversation.id} was not running.`;
    },
  },
  {
    name: 'chat_inspect_thread',
    description: 'Inspect the latest four turns and whether the thread is waiting for user input, without exposing assistant reasoning.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The thread ID to inspect.',
        },
      },
      required: ['threadId'],
    },
    execute: async ({ threadId }, { chatRunner, conversationId }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
      if (conversation.isSideChat && !getConversation(conversationId)?.isSideChat) {
        throw new Error('Side chats are private to side-chat threads.');
      }
      const turns = [];

      for (const message of getMessages(conversation.id)) {
        if (message.role === 'user') {
          turns.push({
            user: {
              id: message.id,
              status: message.status,
              message: message.content,
              createdAt: message.createdAt,
            },
            assistantMessages: [],
          });
        } else if (message.role === 'assistant' && turns.length > 0) {
          turns.at(-1).assistantMessages.push(message);
        }
      }

      const inspectedTurns = turns.slice(-MAX_INSPECTED_TURNS).map((turn) => {
        const assistantEvents = turn.assistantMessages.flatMap((message) => {
          const segments = message.segments?.length > 0
            ? message.segments
            : [{
              type: 'content',
              text: answerTextFromTextualBlocks(message.content),
            }];
          return segments.flatMap((segment) => {
            if (segment.type === 'content' && segment.text) {
              const text = answerTextFromTextualBlocks(segment.text);
              if (!text) return [];
              return [{
                type: 'message',
                messageId: message.id,
                status: message.status,
                text,
                createdAt: message.createdAt,
              }];
            }
            if (segment.type !== 'tool-call') return [];

            let args = segment.argumentsText;
            try {
              args = JSON.parse(segment.argumentsText);
            } catch { }
            const events = [{
              type: 'tool_call',
              messageId: message.id,
              callId: segment.callId,
              name: segment.name,
              arguments: args,
              status: segment.status,
            }];
            if (segment.resultText !== undefined) {
              const output = String(segment.resultText);
              events.push({
                type: 'tool_result',
                messageId: message.id,
                callId: segment.callId,
                output: output.slice(0, MAX_INSPECTED_TOOL_RESULT_CHARS),
                truncated: output.length > MAX_INSPECTED_TOOL_RESULT_CHARS,
                isError: segment.status === 'error',
              });
            }
            return events;
          });
        });
        const messageIndexes = assistantEvents
          .map((event, index) => event.type === 'message' ? index : -1)
          .filter((index) => index >= 0);
        const includedMessageIndexes = new Set([
          ...messageIndexes.slice(-(MAX_ASSISTANT_MESSAGES_BEFORE_FINAL + 1)),
        ]);

        return {
          user: turn.user,
          assistant: assistantEvents.filter((event, index) => (
            event.type !== 'message' || includedMessageIndexes.has(index)
          )),
        };
      });

      const pendingQuestion = chatRunner.getPendingQuestion?.(conversation.id) ?? null;
      const status = pendingQuestion
        ? 'waiting_for_input'
        : chatRunner.semaphores.waitSnapshot(conversation.id)
          ? 'sleeping'
          : chatRunner.runs.has(conversation.id) ? 'running' : 'idle';
      const renderedTurns = inspectedTurns.flatMap((turn) => [
        `User (${turn.user.status}):\n${turn.user.message}`,
        ...turn.assistant.map((event) => {
          if (event.type === 'message') return `Assistant (${event.status}):\n${event.text}`;
          if (event.type === 'tool_call') {
            return `Tool call: ${event.name}\nArguments: ${typeof event.arguments === 'string'
              ? event.arguments
              : JSON.stringify(event.arguments)
              }`;
          }
          return `Tool result${event.isError ? ' (error)' : ''}:\n${event.output}${event.truncated ? '\n[tool output truncated]' : ''
            }`;
        }),
      ]);
      const result = [
        `Thread: ${conversation.title}`,
        `ID: ${conversation.id}`,
        `Folder: ${conversation.projectPath}`,
        `Model: ${conversation.model}`,
        `Status: ${status}`,
        '',
        'Recent turns:',
        ...(renderedTurns.length > 0 ? renderedTurns : ['None.']),
      ].join('\n\n');
      const lastMessage = getMessages(conversation.id)
        .filter((message) => !message.hidden && !['queued', 'steered'].includes(message.status))
        .at(-1);
      if (
        status === 'idle'
        && ['aborted', 'error'].includes(lastMessage?.status)
      ) {
        deleteConversation(conversation.id);
      }
      return result;
    },
  },
  {
    name: 'memory_search',
    description: 'Search persistent AIVAX memory for files matching one or more terms.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        search_terms: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'One or more search terms describing the file or knowledge to retrieve.',
        },
      },
      required: ['search_terms'],
      additionalProperties: false,
    },
    execute: async ({ search_terms }, { aivax, signal }) => {
      const results = await requestAivax('/api/v1/query', {
        body: {
          terms: search_terms,
          collections: [aivax.memoryCollectionId],
          top: 20,
          includeReferences: false,
          reranker: 'rrf',
          minScore: 0.2,
        },
        responseType: 'array',
        signal,
      });
      if (results.length === 0) return 'No memory results found.';
      return [
        'Memory results:',
        results.map(({ documentName, documentContent }) => [
          `title: ${documentName}`,
          'content:',
          documentContent,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'memory_write',
    description: 'Write or update a file in persistent AIVAX memory.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The file path or name stored in memory.',
        },
        contents: {
          type: 'string',
          description: 'The full content to write to the file.',
        },
        reference: {
          type: 'string',
          description: 'Optional grouping ID or source reference.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags used to categorize the file.',
        },
      },
      required: ['name', 'contents'],
      additionalProperties: false,
    },
    execute: async ({ name, contents, reference, tags }, { aivax, signal }) => {
      await requestAivax(
        `/api/v1/collections/${encodeURIComponent(aivax.memoryCollectionId)}/documents`,
        {
          method: 'PUT',
          body: {
            name,
            contents,
            ...(reference === undefined ? {} : { reference }),
            ...(tags === undefined ? {} : { tags }),
          },
          responseType: 'object',
          signal,
        },
      );
      return `Memory file written: ${name}.`;
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete one or more files from persistent AIVAX memory by exact name.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 },
          description: 'One or more exact file names to delete from memory.',
        },
      },
      required: ['names'],
      additionalProperties: false,
    },
    execute: async ({ names }, { aivax, signal }) => {
      const collectionPath = `/api/v1/collections/${encodeURIComponent(aivax.memoryCollectionId)}/documents`;
      const deleted = [];
      const notFound = [];

      for (const name of names) {
        const documents = await requestAivax(
          `${collectionPath}?filter=${encodeURIComponent(name)}`,
          { responseType: 'array', signal },
        );
        const document = documents.find((item) => item.name === name);
        if (!document) {
          notFound.push(name);
          continue;
        }
        await requestAivax(`${collectionPath}/${encodeURIComponent(document.id)}`, {
          method: 'DELETE',
          signal,
        });
        deleted.push(name);
      }

      return [
        deleted.length > 0 ? `Deleted memory files: ${deleted.join(', ')}.` : 'No memory files were deleted.',
        ...(notFound.length > 0 ? [`Memory files not found: ${notFound.join(', ')}.`] : []),
      ].join('\n');
    },
  },
  {
    name: 'web_search',
    description: 'Search the web using AIVAX with optional country, language, and domain filters.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'The web search query.' },
        location: {
          type: 'string',
          description: 'Optional city, region, or other location added to the search query.',
        },
        country: { type: 'string', description: 'Optional two-letter country code.' },
        language: { type: 'string', description: 'Optional language code.' },
        sites: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional domains to include in results.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async ({ query, location, country, language, sites }, { signal }) => {
      const result = await requestAivax('/api/v1/web/search', {
        body: {
          query: location ? `${query} ${location}` : query,
          topn: 10,
          ...(country ? { country } : {}),
          ...(language ? { language } : {}),
          ...(sites?.length ? { includeDomains: sites } : {}),
        },
        responseType: 'object',
        signal,
      });
      const results = result?.results ?? [];
      if (results.length === 0) return `No web results found for "${query}".`;
      return [
        `Web results for "${query}":`,
        results.map(({ title, url, text }) => [
          `title: ${title}`,
          `url: ${url}`,
          'content:',
          text,
        ].join('\n')).join('\n--------\n'),
      ].join('\n');
    },
  },
  {
    name: 'read_url',
    description: 'Read a public HTTP or HTTPS URL as LLM-friendly text using the configured extraction service.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The public HTTP or HTTPS URL to read.',
        },
      },
      required: ['url'],
    },
    execute: async ({ url }, { aivax, signal }) => {
      let target;
      try {
        target = new URL(String(url));
      } catch {
        throw new Error('url must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('url must use HTTP or HTTPS.');
      }

      if (aivax?.connected && aivax.advancedFetchEnabled) {
        const result = await requestAivax('/api/v1/web/fetch', {
          body: { contents: [target.href], returnErrors: true },
          responseType: 'object',
          signal,
        });
        const fetched = result?.results?.[0];
        if (fetched?.error) throw new Error(fetched.error);
        const content = fetched?.extractedText ?? '';
        return [
          `URL: ${target.href}`,
          '',
          content.slice(0, MAX_READ_URL_CHARS),
          ...(content.length > MAX_READ_URL_CHARS ? ['', '[content truncated]'] : []),
        ].join('\n');
      }

      const response = await fetch(`https://r.jina.ai/${target.href}`, {
        headers: { Accept: 'text/plain' },
        signal,
      });
      const content = await response.text();
      if (!response.ok) {
        throw new Error(content || `Jina Reader returned ${response.status} ${response.statusText}.`);
      }

      return [
        `URL: ${target.href}`,
        '',
        content.slice(0, MAX_READ_URL_CHARS),
        ...(content.length > MAX_READ_URL_CHARS ? ['', '[content truncated]'] : []),
      ].join('\n');
    },
  },
  {
    name: 'sleep',
    description: 'Wait for a requested number of seconds without leaving the current conversation. Use this to await long-running sub-agent work, terminal work, or analyses, then receive the current status of this conversation\'s terminals and direct sub-agents.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          minimum: MIN_SLEEP_SECONDS,
          maximum: MAX_SLEEP_SECONDS,
          description: 'How long to wait, in seconds. Choose a value from 5 seconds to 30 minutes.',
        },
      },
      required: ['seconds'],
      additionalProperties: false,
    },
    execute: async ({ seconds }, { signal, conversationId, chatRunner }) => {
      if (
        !Number.isFinite(seconds)
        || seconds < MIN_SLEEP_SECONDS
        || seconds > MAX_SLEEP_SECONDS
      ) {
        throw new Error('seconds must be a number from 5 to 1800.');
      }

      const startedAt = Date.now();
      await new Promise((resolveSleep, rejectSleep) => {
        const abort = () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          rejectSleep(new Error('Sleep was interrupted.'));
        };
        const timeout = setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolveSleep();
        }, seconds * 1_000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
      const wokeAt = new Date();

      const sleptSeconds = Math.round((Date.now() - startedAt) / 10) / 100;
      const matchingTerminals = [...terminals.values()]
        .filter((terminal) => terminal.conversationId === conversationId);
      const subagents = listAllConversations()
        .filter((conversation) => (
          conversation.isSubagent && conversation.parentConversationId === conversationId
        ));
      return [
        `Slept ${sleptSeconds} seconds.`,
        `Woke at: ${wokeAt.toString()}`,
        '',
        'Terminals:',
        ...(matchingTerminals.length > 0
          ? matchingTerminals.map((terminal) => [
            `- ID: ${terminal.id}`,
            `  Status: ${terminalStatus(terminal)}`,
            `  Command: ${terminal.command}`,
          ].join('\n'))
          : ['None.']),
        '',
        'Sub-agents:',
        ...(subagents.length > 0
          ? subagents.map((subagent) => [
            `- ${subagent.title}`,
            `  Thread ID: ${subagent.id}`,
            `  Status: ${chatRunner?.getPendingQuestion?.(subagent.id)
              ? 'waiting_for_input'
              : chatRunner?.runs?.has(subagent.id) ? 'running' : 'idle'}`,
          ].join('\n'))
          : ['None.']),
      ].join('\n');
    },
  },
  {
    name: 'sleep_semaphore',
    description: 'Acquire permits from an application-wide Avi-managed named semaphore shared by every thread. This must be the only tool call in its model round. If permits are unavailable, this tool ends the current inference and suspends the thread in a FIFO queue; Avi automatically resumes the thread when its turn is granted.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Semaphore name defined by the user or project instructions.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 1_000_000,
          description: 'Number of permits to acquire.',
        },
        maxCount: {
          type: 'integer',
          minimum: 1,
          maximum: 1_000_000,
          description: 'Fixed maximum permit count for this named semaphore.',
        },
      },
      required: ['name', 'count', 'maxCount'],
      additionalProperties: false,
    },
    execute: async ({ name, count, maxCount }, { chatRunner, conversationId }) => {
      const result = chatRunner.acquireSemaphore({ conversationId, name, count, maxCount });
      if (result.acquired) {
        return [
          `Semaphore "${result.name}" granted ${result.count} permit(s). It is safe to begin the protected work.`,
          `You now own these permits. Call release_semaphore(name: "${result.name}", count: ${result.count}) promptly after the protected work is complete, including before reporting a blocker or finishing the task.`,
        ].join('\n');
      }
      return {
        output: [
          `Waiting for semaphore "${result.name}". Queue position: ${result.position}.`,
          'This inference is ending now. Do not continue the protected work in this turn.',
          'Avi will automatically invoke this thread with a system-user message when the permits are granted. The user may also run now or cancel this semaphore wait.',
        ].join('\n'),
        suspendRun: true,
      };
    },
  },
  {
    name: 'release_semaphore',
    description: 'Release permits currently owned by this thread. Releasing permits automatically grants queued waiters in strict FIFO order when capacity permits.',
    approval: 'never',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description: 'Semaphore name whose permits should be released.',
        },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 1_000_000,
          description: 'Number of owned permits to release.',
        },
      },
      required: ['name', 'count'],
      additionalProperties: false,
    },
    execute: async ({ name, count }, { chatRunner, conversationId }) => {
      const result = chatRunner.releaseSemaphore({ conversationId, name, count });
      return [
        `Released ${result.released} permit(s) from semaphore "${result.name}".`,
        `Permits still owned by this thread: ${result.remaining}.`,
        `Queued threads activated: ${result.activated}.`,
      ].join('\n');
    },
  },
  {
    name: 'run_in_terminal',
    description: 'Run a command in a local terminal.',
    canEditFile: true,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to run in the terminal.',
        },
        explanation: {
          type: 'string',
          description: 'A one-sentence description of what the command does. This will be shown to the user before the command is run.',
        },
        goal: {
          type: 'string',
          description: 'A short description of the goal or purpose of the command (e.g., "Install dependencies", "Start development server").',
        },
        mode: {
          type: 'string',
          enum: ['sync', 'async'],
          enumDescriptions: [
            'Wait for command completion and return full output inline. Strongly preferred for all one-shot commands (builds, tests, installs, scripts).',
            'Wait for an initial idle/output signal, then return a terminal ID and output snapshot while the process continues running. Timeout caps how long to wait for the initial signal. Use ONLY for processes that must keep running indefinitely (servers, watchers, daemons).',
          ],
          description: 'Execution mode for this command. Use sync (default) for nearly all commands.',
        },
        isBackground: {
          type: 'boolean',
          description: 'Legacy execution mode flag. Deprecated in favor of "mode". If true, equivalent to mode=async. If false, equivalent to mode=sync.',
        },
        timeout: {
          type: 'number',
          minimum: MIN_TERMINAL_TIMEOUT_SECONDS,
          maximum: MAX_TERMINAL_TIMEOUT_SECONDS,
          default: DEFAULT_TERMINAL_TIMEOUT_SECONDS,
          description: 'Maximum time to wait, in seconds. Defaults to 30 seconds and accepts values from 1 to 300. If the timeout elapses, the command keeps running and the response includes its terminal ID and partial output.',
        },
      },
      required: ['command', 'explanation', 'goal', 'mode'],
    },
    execute: async (
      { command, mode, isBackground, timeout },
      {
        signal,
        workspacePath,
        conversationId,
        tuning,
      },
    ) => {
      const normalizedCommand = String(command ?? '').trim();
      if (!normalizedCommand) throw new Error('command is required.');

      const executionMode = isBackground === true ? 'async' : isBackground === false ? 'sync' : mode;
      if (!['sync', 'async'].includes(executionMode)) {
        throw new Error('mode must be sync or async.');
      }
      const timeoutSeconds = timeout
        ?? tuning?.terminalTimeoutSeconds
        ?? DEFAULT_TERMINAL_TIMEOUT_SECONDS;
      if (
        !Number.isFinite(timeoutSeconds)
        || timeoutSeconds < MIN_TERMINAL_TIMEOUT_SECONDS
        || timeoutSeconds > MAX_TERMINAL_TIMEOUT_SECONDS
      ) {
        throw new Error('timeout must be a number from 1 to 300 seconds.');
      }

      const id = crypto.randomUUID();
      const shell = resolveTerminalShell(
        process.env,
        process.platform,
        tuning?.terminalShell,
      );
      const child = spawn(shell.executable, [...shell.commandArguments, normalizedCommand], {
        cwd: workspacePath ? resolve(workspacePath) : process.cwd(),
        env: process.env,
        shell: false,
        windowsHide: true,
      });
      const terminal = {
        id,
        child,
        command: normalizedCommand,
        shell,
        events: new EventEmitter(),
        output: '',
        truncated: false,
        running: true,
        exitCode: null,
        signal: null,
        conversationId,
        stopping: false,
      };
      terminals.set(id, terminal);

      child.stdout.on('data', (chunk) => appendTerminalOutput(terminal, chunk));
      child.stderr.on('data', (chunk) => appendTerminalOutput(terminal, chunk));
      child.once('error', (error) => appendTerminalOutput(terminal, `${error.message}${EOL}`));
      child.once('close', (exitCode, exitSignal) => {
        terminal.running = false;
        terminal.exitCode = exitCode;
        terminal.signal = exitSignal;
        terminal.events.emit('close');
      });

      let waitResult;
      if (executionMode === 'sync') {
        const abort = () => stopTerminal(terminal);
        signal?.addEventListener('abort', abort, { once: true });
        waitResult = await waitForTerminal(terminal, {
          untilExit: true,
          timeout: timeoutSeconds * 1_000,
        });
        signal?.removeEventListener('abort', abort);
      } else {
        waitResult = await waitForTerminal(terminal, {
          untilExit: false,
          timeout: timeoutSeconds * 1_000,
        });
      }

      if (waitResult === 'timeout' && terminal.running) {
        return `The command reached the ${timeoutSeconds}-second timeout and is still running. Use terminal ID "${terminal.id}" to read its partial output or interact with it.\n${terminalSnapshot(terminal)}`;
      }
      return terminalSnapshot(terminal, { includeId: executionMode === 'async' || terminal.running });
    },
  },
  {
    name: 'send_to_terminal',
    description: 'Send input followed by Enter to an active terminal execution.',
    canEditFile: true,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of an active terminal execution to send a command to (returned by run_in_terminal for async executions, or for sync executions that timed out and were moved to the background).',
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        },
        command: {
          type: 'string',
          description: 'The input text to send to the terminal. The text is sent followed by Enter. Provide an empty or whitespace string to send just Enter (for interactive prompts).',
        },
        waitForOutput: {
          type: 'boolean',
          description: 'When true, waits for the terminal to become idle (no new output for a short period) before returning, instead of returning immediately. Use this for interactive programs where you need to see the full response to your input. Defaults to false.',
        },
      },
      required: ['id', 'command'],
    },
    execute: async ({ id, command, waitForOutput }) => {
      const terminal = terminals.get(String(id));
      if (!terminal) throw new Error('The terminal execution was not found.');
      if (!terminal.running || !terminal.child.stdin.writable) {
        throw new Error('The terminal execution is no longer active.');
      }

      terminal.child.stdin.write(`${String(command ?? '')}${EOL}`);
      if (waitForOutput) {
        await waitForTerminal(terminal, { untilExit: false, timeout: 10_000 });
      }
      return terminalSnapshot(terminal);
    },
  },
  {
    name: 'read_terminal_output',
    description: 'Read the current output and status of a terminal execution.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of an active terminal execution to check (returned by run_in_terminal for async executions, or for sync executions that timed out and were moved to the background). This must be the exact opaque UUID returned by that tool; terminal names, labels, or integers are invalid.',
          pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
        },
      },
      required: ['id'],
    },
    execute: async ({ id }) => {
      const terminal = terminals.get(String(id));
      if (!terminal) throw new Error('The terminal execution was not found.');
      return terminalSnapshot(terminal);
    },
  },
  {
    name: 'multi_replace_file',
    description: 'Apply one or more exact text replacements across existing UTF-8 files as one atomic operation. Replacements run sequentially in input order and require one unique match by default. Errors include exact occurrence previews or fuzzy suggestions without applying approximate matches. Set occurrence to "all" only when every exact occurrence should be replaced, and optionally assert the count with expectedOccurrences. Use this by default for focused edits; use write_file for new files or intentional full-file replacement.',
    canEditFile: true,
    tracksFileChanges: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        replacements: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                minLength: 1,
                description: 'The absolute path of an existing UTF-8 text file.',
              },
              oldString: {
                type: 'string',
                minLength: 1,
                description: 'Exact text to replace in the current file state. It must occur once for occurrence "unique", or at least once for occurrence "all". Preserve whitespace and indentation.',
              },
              newString: {
                type: 'string',
                description: 'Replacement text. Whitespace, indentation, line endings, and final newline are preserved exactly as supplied.',
              },
              occurrence: {
                type: 'string',
                enum: ['unique', 'all'],
                description: 'Use "unique" (the default) to require exactly one match, or "all" to replace every non-overlapping exact match.',
              },
              expectedOccurrences: {
                type: 'integer',
                minimum: 1,
                description: 'Optional safety check for occurrence "all". The operation fails unless exactly this many matches exist.',
              },
            },
            required: ['filePath', 'oldString', 'newString'],
            additionalProperties: false,
          },
        },
      },
      required: ['replacements'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const result = await applyMultiReplaceFile(input);
      return {
        output: [
          `Applied ${result.occurrencesReplaced} replacement occurrence(s) across ${result.filesChanged} file(s).`,
          ...result.files.map((filePath) => {
            const occurrences = result.results.reduce((total, item, index) => (
              resolve(input.replacements[index].filePath) === filePath
                ? total + item.occurrencesReplaced
                : total
            ), 0);
            return `- ${filePath}: ${occurrences} occurrence(s)`;
          }),
        ].join('\n'),
        fileChanges: result.fileChanges,
      };
    },
  },
  {
    name: 'write_file',
    description: 'Write complete UTF-8 text content to an absolute local file. Use this for new files or intentional full-file replacement; prefer multi_replace_file for focused edits to existing files.',
    canEditFile: true,
    tracksFileChanges: true,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The absolute path of the file to create or replace.',
        },
        content: {
          type: 'string',
          description: 'The complete UTF-8 text content to write.',
        },
      },
      required: ['filePath', 'content'],
      additionalProperties: false,
    },
    execute: async ({ filePath, content }) => {
      if (!isAbsolute(String(filePath ?? ''))) throw new Error('filePath must be absolute.');
      if (typeof content !== 'string') throw new Error('content must be a string.');

      let beforeContent = null;
      try {
        beforeContent = await readFile(filePath, 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await writeFile(filePath, content, 'utf8');
      const fileChanges = beforeContent === content ? [] : [{
        filePath,
        before: beforeContent,
        after: content,
      }];
      return {
        output: fileChanges.length === 0
          ? `File unchanged: ${filePath}.`
          : `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}.`,
        fileChanges,
      };
    },
  },
  {
    name: 'read_file',
    description: 'Read an inclusive range of lines from a local file.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'The absolute path of the file to read.',
        },
        startLine: {
          type: 'number',
          description: 'The line number to start reading from, 1-based.',
        },
        endLine: {
          type: 'number',
          description: 'The inclusive line number to end reading at, 1-based.',
        },
      },
      required: ['filePath', 'startLine', 'endLine'],
    },
    execute: async ({ filePath, startLine, endLine }) => {
      if (!isAbsolute(String(filePath ?? ''))) throw new Error('filePath must be absolute.');
      if (!Number.isInteger(startLine) || startLine < 1) {
        throw new Error('startLine must be a positive integer.');
      }
      if (!Number.isInteger(endLine) || endLine < startLine) {
        throw new Error('endLine must be an integer greater than or equal to startLine.');
      }

      const content = await readFile(filePath, 'utf8');
      const lines = content.replaceAll('\r\n', '\n').split('\n');
      const actualEndLine = Math.min(endLine, lines.length);
      return [
        `${filePath} (lines ${startLine}-${actualEndLine} of ${lines.length}):`,
        lines.slice(startLine - 1, endLine).join('\n'),
      ].join('\n');
    },
  },
]);

export function decorateToolsForInvocation(tools, permissionMode = 'approve_for_me') {
  const toolNames = new Set();
  for (const tool of tools) {
    const name = String(tool?.name ?? '');
    if (!name) throw new Error('Every chat tool requires a name.');
    if (toolNames.has(name)) throw new Error(`Chat tool name "${name}" is duplicated.`);
    toolNames.add(name);
  }

  return tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        __invocation_goal: {
          type: 'string',
          description: 'A short description of the goal of this specific tool invocation.',
        },
        __requires_human_approval: {
          type: 'boolean',
          description: tool.approval === 'never'
            ? 'Set this to false because this tool does not require a separate approval.'
            : {
              ask_for_approval: 'Set this to true for every tool invocation because the user selected Ask for approval, unless explicit user guidance always allows this invocation.',
              approve_for_me: 'Set this to true only when this specific invocation needs explicit human approval, or false when it can proceed safely.',
              full_access: 'Set this to false because the user selected Full access.',
            }[permissionMode] ?? 'Set this to true only when this specific invocation needs explicit human approval.',
        },
        ...Object.fromEntries(
          Object.entries(tool.inputSchema.properties ?? {}).filter(
            ([name]) => !['__invocation_goal', '__requires_human_approval'].includes(name),
          ),
        ),
      },
      required: [
        '__invocation_goal',
        '__requires_human_approval',
        ...(tool.inputSchema.required ?? []).filter(
          (name) => !['__invocation_goal', '__requires_human_approval'].includes(name),
        ),
      ],
      additionalProperties: tool.inputSchema.additionalProperties ?? false,
    },
  }));
}
