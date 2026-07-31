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
  isAbsolute,
  resolve,
} from 'node:path';
import { answerTextFromTextualBlocks } from '../shared/textual-blocks.js';
import {
  attachmentToApiBlock,
  createConversation,
  forkConversation,
  getConversation,
  getMessages,
  listAllConversations,
  updateConversation,
} from './database.js';
import { filePathToAttachment } from './files.js';
import { resolveTerminalShell } from './terminal-shell.js';

const MAX_READ_URL_CHARS = 100_000;
const MAX_TERMINAL_OUTPUT_CHARS = 2_000_000;
const MIN_TERMINAL_TIMEOUT_SECONDS = 1;
const MAX_TERMINAL_TIMEOUT_SECONDS = 300;
const DEFAULT_TERMINAL_TIMEOUT_SECONDS = 30;
const MAX_INSPECTED_TURNS = 4;
const MAX_ASSISTANT_MESSAGES_BEFORE_FINAL = 6;
const MAX_INSPECTED_TOOL_RESULT_CHARS = 512 * 4;
const terminals = new Map();

function appendTerminalOutput(terminal, chunk) {
  terminal.output += String(chunk);
  if (terminal.output.length > MAX_TERMINAL_OUTPUT_CHARS) {
    terminal.output = terminal.output.slice(-MAX_TERMINAL_OUTPUT_CHARS);
    terminal.truncated = true;
  }
  terminal.events.emit('activity');
}

function terminalSnapshot(terminal, { includeId = true } = {}) {
  const parts = [];
  if (includeId) parts.push(`Terminal ID: ${terminal.id}`);
  if (terminal.running) {
    parts.push('Status: running');
  } else if (terminal.stopping) {
    parts.push('Status: stopped');
  } else if (terminal.exitCode !== 0) {
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
    name: 'read_media_file',
    description: 'Read a local media file using the selected model multimodally. Text files are not supported.',
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
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async ({ path }, { capabilities = {} }) => {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        throw new Error('path must be an absolute file path.');
      }

      const attachment = filePathToAttachment(path);
      const supported = (attachment.kind === 'image_url' && capabilities.images)
        || (attachment.kind === 'input_audio' && capabilities.audio)
        || (
          attachment.kind === 'file'
          && attachment.mime === 'application/pdf'
          && capabilities.pdfFiles
        );
      if (!supported) {
        if (attachment.kind === 'text_inline') {
          throw new Error('read_media_file does not read text files. Use read_file instead.');
        }
        if (attachment.kind === 'video_url') {
          throw new Error('The selected model does not expose video input capability.');
        }
        throw new Error(`The selected model cannot read this media type (${attachment.mime}).`);
      }

      return {
        output: `Media file loaded: ${attachment.path}`,
        mediaContent: [attachmentToApiBlock(attachment, capabilities)],
      };
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
      return {
        goal_id: result.goal.id,
        status: result.goal.status,
        started_at: result.goal.startedAt,
        specification: result.goal.specification,
      };
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
      return chatRunner.changeGoal({
        conversationId,
        action: status,
        summary: normalizedSummary,
      });
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
    execute: async ({ questions }, { chatRunner, conversationId, signal }) => {
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

      return chatRunner.askQuestion({
        conversationId,
        questions: normalizedQuestions,
        signal,
      });
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

      return { folders: [...folders.values()] };
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
    execute: async ({ folderPath }, { chatRunner }) => {
      if (folderPath && !isAbsolute(String(folderPath))) {
        throw new Error('folderPath must be absolute.');
      }
      const normalizedFolder = folderPath
        ? resolve(folderPath)
        : null;
      const folderKey = process.platform === 'win32'
        ? normalizedFolder?.toLowerCase()
        : normalizedFolder;
      const threads = listAllConversations()
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
          status: chatRunner.runs.has(conversation.id) ? 'running' : 'idle',
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        }));

      return { threads };
    },
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
        reasoning_effort: {
          type: 'string',
          description: 'Optional reasoning effort to invoke. Defaults to the last reasoning effort used in the folder.',
        },
      },
    },
    execute: async (
      {
        prompt,
        folderPath,
        model_name,
        reasoning_effort,
      },
      {
        chatRunner,
        model,
        models,
        workspacePath,
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
      const selectedModelId = model_name === undefined
        ? folderConversations[0]?.model ?? model
        : String(model_name).trim();
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
      const selectedReasoningEffort = reasoning_effort === undefined
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
      });
      let message = null;

      if (normalizedPrompt) {
        const result = await chatRunner.send({
          conversationId: conversation.id,
          model: selectedModel.id,
          reasoningEffort: selectedReasoningEffort,
          text: normalizedPrompt,
          project: { path: projectPath },
        });
        message = result.message;
      }

      return {
        thread: {
          id: conversation.id,
          title: getConversation(conversation.id).title,
          folderPath: projectPath,
          model: selectedModel.id,
          reasoningEffort: selectedReasoningEffort,
          status: message ? 'running' : 'idle',
        },
        promptMessageId: message?.id ?? null,
      };
    },
  },
  {
    name: 'chat_spawn_subagent',
    description: 'Start an asynchronous sub-agent for a focused task in the current workspace. Returns immediately with its thread_id. Its final response or terminal error is automatically steered to the orchestrator.',
    canEditFile: false,
    canPerformDestructiveActions: true,
    inputSchema: {
      type: 'object',
      properties: {
        model_name: {
          type: 'string',
          description: 'Optional configured model. Defaults to the orchestrator model.',
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
        reasoning_effort,
        prompt,
      },
      {
        chatRunner,
        conversationId,
        model,
        models,
        reasoningEffort,
        tuning,
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

      const selectedModelId = model_name === undefined ? model : String(model_name).trim();
      const selectedModel = models.find((item) => item.id === selectedModelId);
      if (!selectedModel) {
        throw new Error(`Model "${selectedModelId}" is not configured.`);
      }
      const selectedReasoningEffort = reasoning_effort === undefined
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
        orchestrationMode: ultraMode ? 'ultra' : null,
        autoForwardToParent: true,
      });
      if (!result) throw new Error('The sub-agent thread could not be created.');
      const subagent = selectedModel.id === result.conversation.model
        ? result.conversation
        : updateConversation(result.conversation.id, { model: selectedModel.id });
      chatRunner.emit(parent.id, { type: 'subagent-created', subagent });
      const sent = await chatRunner.send({
        conversationId: subagent.id,
        model: selectedModel.id,
        reasoningEffort: selectedReasoningEffort,
        text: normalizedPrompt,
        ultraMode,
        project: { path: parent.projectPath },
      });

      return {
        thread_id: subagent.id,
        status: sent.queued ? 'queued' : 'working',
      };
    },
  },
  {
    name: 'chat_report_to_orchestrator',
    description: 'Send a material progress update, blocker, dependency, or course correction to the parent orchestrator. The final response is forwarded automatically and should not be duplicated with this tool.',
    canEditFile: false,
    canPerformDestructiveActions: false,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'A concise update or result with evidence, implications, and any blockers.',
        },
      },
      required: ['message'],
    },
    execute: async ({ message }, { chatRunner, conversationId }) => {
      const subagent = getConversation(conversationId);
      if (!subagent?.isSubagent || !subagent.parentConversationId) {
        throw new Error('Only a sub-agent can report to an orchestrator.');
      }
      const parent = getConversation(subagent.parentConversationId);
      if (!parent) throw new Error('The orchestrator thread was not found.');
      const normalizedMessage = String(message ?? '').trim();
      if (!normalizedMessage) throw new Error('message is required.');
      const ultraMode = subagent.orchestrationMode === 'ultra';
      const activeGoal = ultraMode
        && parent.goal
        && ['active', 'paused'].includes(parent.goal.status)
        ? parent.goal
        : null;

      const result = await chatRunner.send({
        conversationId: parent.id,
        model: parent.model,
        text: [
          `<subagent_report thread_id="${subagent.id}" title="${subagent.title}">`,
          normalizedMessage,
          '</subagent_report>',
        ].join('\n'),
        workMode: activeGoal ? 'goal' : null,
        goalId: activeGoal?.id,
        ultraMode,
        queuePriority: true,
        project: { path: parent.projectPath },
      });

      return {
        thread_id: parent.id,
        message_id: result.message.id,
        status: result.queued ? 'queued' : 'running',
      };
    },
  },
  {
    name: 'chat_send_prompt',
    description: 'Send a prompt to a chat thread using queue or steer delivery.',
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
        mode: {
          type: 'string',
          enum: ['queue', 'steer'],
          description: 'queue waits behind active work; steer takes priority and interrupts at the next safe inference or tool boundary.',
        },
      },
      required: ['threadId', 'prompt', 'mode'],
    },
    execute: async ({ threadId, prompt, mode }, { chatRunner, conversationId }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
      const normalizedPrompt = String(prompt ?? '').trim();
      if (!normalizedPrompt) throw new Error('prompt is required.');
      if (!['queue', 'steer'].includes(mode)) {
        throw new Error('mode must be queue or steer.');
      }
      const sourceConversation = getConversation(conversationId);
      const result = await chatRunner.send({
        conversationId: conversation.id,
        model: conversation.model,
        text: normalizedPrompt,
        steer: mode === 'steer',
        ultraMode: conversation.orchestrationMode === 'ultra',
        queuePriority: sourceConversation?.isSubagent === true,
        project: { path: conversation.projectPath },
      });

      return {
        threadId: conversation.id,
        messageId: result.message.id,
        mode,
        status: result.queued ? mode === 'steer' ? 'steered' : 'queued' : 'running',
      };
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
    execute: async ({ threadId }, { chatRunner }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
      const interrupted = chatRunner.runs.has(conversation.id);
      chatRunner.requestSteer(conversation.id);
      return {
        threadId: conversation.id,
        interrupted,
      };
    },
  },
  {
    name: 'chat_inspect_thread',
    description: 'Inspect the latest four turns of a chat thread without exposing assistant reasoning.',
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
    execute: async ({ threadId }, { chatRunner }) => {
      const conversation = getConversation(String(threadId));
      if (!conversation) throw new Error('The thread was not found.');
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
            } catch {}
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

      return {
        thread: {
          id: conversation.id,
          title: conversation.title,
          folderPath: conversation.projectPath,
          model: conversation.model,
          status: chatRunner.runs.has(conversation.id) ? 'running' : 'idle',
        },
        turns: inspectedTurns,
      };
    },
  },
  {
    name: 'read_url',
    description: 'Read a public HTTP or HTTPS URL as LLM-friendly Markdown using the Jina Reader API.',
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
    execute: async ({ url }, { signal }) => {
      let target;
      try {
        target = new URL(String(url));
      } catch {
        throw new Error('url must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('url must use HTTP or HTTPS.');
      }

      const response = await fetch(`https://r.jina.ai/${target.href}`, {
        headers: { Accept: 'text/plain' },
        signal,
      });
      const content = await response.text();
      if (!response.ok) {
        throw new Error(content || `Jina Reader returned ${response.status} ${response.statusText}.`);
      }

      return {
        url: target.href,
        content: content.slice(0, MAX_READ_URL_CHARS),
        truncated: content.length > MAX_READ_URL_CHARS,
      };
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
    name: 'write_file',
    description: 'Write complete UTF-8 text content to an absolute local file. This creates the file or replaces its existing contents.',
    canEditFile: true,
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

      await writeFile(filePath, content, 'utf8');
      return {
        filePath,
        encoding: 'utf8',
        bytesWritten: Buffer.byteLength(content, 'utf8'),
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
      return {
        filePath,
        startLine,
        endLine: Math.min(endLine, lines.length),
        totalLines: lines.length,
        content: lines.slice(startLine - 1, endLine).join('\n'),
      };
    },
  },
]);

export function interceptToolSchemas(tools, permissionMode = 'approve_for_me') {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
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
        __invocation_goal: {
          type: 'string',
          description: 'A short description of the goal of this specific tool invocation.',
        },
      },
      required: [
        ...(tool.inputSchema.required ?? []),
        '__requires_human_approval',
        '__invocation_goal',
      ],
      additionalProperties: tool.inputSchema.additionalProperties ?? false,
    },
  }));
}
