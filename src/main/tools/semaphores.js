import { getConversation, listAllConversations } from '../database.js';
import { TERMINAL_INPUT_IDLE_MS, terminals, terminalStatus } from './terminal.js';
import { isThreadWaitingForInput } from './shared.js';

const MIN_SLEEP_SECONDS = 5;

const MAX_SLEEP_SECONDS = 60 * 60;

const MAX_SLEEP_RELEASE_TRIGGERS = 20;

const SLEEP_TRIGGER_POLL_MS = 500;

export const semaphoreListingTools = [
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
];

export const semaphoreTools = [
  {
    name: 'sleep',
    description: 'Wait for a requested number of seconds without leaving the current conversation. Use this to await long-running sub-agent work, terminal work, or analyses, then receive the current status of this conversation\'s terminals and direct sub-agents. Optional release triggers end the wait early as soon as any of them is satisfied.',
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
          description: 'How long to wait, in seconds. Choose a value from 5 seconds to 1 hour.',
        },
        releaseTriggers: {
          type: 'array',
          maxItems: MAX_SLEEP_RELEASE_TRIGGERS,
          items: { type: 'string', minLength: 1 },
          description: [
            'Optional conditions that end the sleep before the timeout; the first satisfied trigger wins, and an already satisfied trigger releases immediately. Supported values:',
            'after_thread_stop:<thread_id> — the thread is no longer running, waiting for input, or waiting for a semaphore;',
            'after_thread_input_required:<thread_id> — the thread waits for a question answer or tool approval;',
            'after_subagents_stop — every direct sub-agent of this conversation has stopped;',
            'after_process_killed:<terminal_id|pid> — the Avi terminal or OS process has exited;',
            'after_process_output:<terminal_id|pid> — the Avi terminal produced new output;',
            'after_process_input_required:<terminal_id|pid> — heuristic: the running Avi terminal has been silent for 1.5 seconds after printing a line without a trailing newline, such as an interactive prompt.',
          ].join(' '),
        },
      },
      required: ['seconds'],
      additionalProperties: false,
    },
    execute: async ({ seconds, releaseTriggers = [] }, { signal, conversationId, chatRunner }) => {
      if (
        !Number.isFinite(seconds)
        || seconds < MIN_SLEEP_SECONDS
        || seconds > MAX_SLEEP_SECONDS
      ) {
        throw new Error('seconds must be a number from 5 to 3600.');
      }
      if (!Array.isArray(releaseTriggers) || releaseTriggers.length > MAX_SLEEP_RELEASE_TRIGGERS) {
        throw new Error(`releaseTriggers must be an array with at most ${MAX_SLEEP_RELEASE_TRIGGERS} items.`);
      }

      const startedAt = Date.now();
      const isThreadStopped = (threadId) => (
        !chatRunner?.runs?.has(threadId)
        && !isThreadWaitingForInput(chatRunner, threadId)
        && !chatRunner?.semaphores?.waitSnapshot(threadId)
      );
      const findTerminal = (target) => [...terminals.values()]
        .find((terminal) => terminal.id === target || String(terminal.child.pid) === target);
      const requireTerminal = (kind, target) => {
        const terminal = findTerminal(target);
        if (!terminal) {
          throw new Error(`${kind} requires the terminal ID or PID of a terminal started by run_in_terminal: "${target}".`);
        }
        return terminal;
      };
      const triggers = releaseTriggers.map((value) => {
        const trigger = String(value).trim();
        const separator = trigger.indexOf(':');
        const kind = separator < 0 ? trigger : trigger.slice(0, separator);
        const target = separator < 0 ? '' : trigger.slice(separator + 1).trim();
        if (kind !== 'after_subagents_stop' && !target) {
          throw new Error(`Release trigger "${trigger}" requires an argument after ":".`);
        }

        switch (kind) {
          case 'after_thread_stop':
          case 'after_thread_input_required': {
            if (!getConversation(target)) throw new Error(`Release trigger thread was not found: "${target}".`);
            return {
              trigger,
              isReleased: kind === 'after_thread_stop'
                ? () => isThreadStopped(target)
                : () => isThreadWaitingForInput(chatRunner, target),
            };
          }

          case 'after_subagents_stop':
            return {
              trigger,
              isReleased: () => listAllConversations()
                .filter((conversation) => (
                  conversation.isSubagent && conversation.parentConversationId === conversationId
                ))
                .every((subagent) => isThreadStopped(subagent.id)),
            };

          case 'after_process_killed': {
            const terminal = findTerminal(target);
            if (terminal) return { trigger, isReleased: () => !terminal.running };
            if (!/^\d+$/.test(target)) {
              throw new Error(`after_process_killed requires a terminal ID or numeric PID: "${target}".`);
            }
            return {
              trigger,
              isReleased: () => {
                try {
                  process.kill(Number(target), 0);
                  return false;
                } catch (error) {
                  return error?.code !== 'EPERM';
                }
              },
            };
          }

          case 'after_process_output': {
            const terminal = requireTerminal(kind, target);
            return { trigger, isReleased: () => terminal.lastActivityAt > startedAt };
          }

          case 'after_process_input_required': {
            const terminal = requireTerminal(kind, target);
            return {
              trigger,
              isReleased: () => terminal.running
                && terminal.output.length > 0
                && !terminal.output.endsWith('\n')
                && Date.now() - terminal.lastActivityAt >= TERMINAL_INPUT_IDLE_MS,
            };
          }

          default:
            throw new Error(`Unsupported release trigger: "${trigger}".`);
        }
      });

      const releasedBy = await new Promise((resolveSleep, rejectSleep) => {
        const cleanup = () => {
          clearTimeout(timeout);
          clearInterval(poll);
          signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          rejectSleep(new Error('Sleep was interrupted.'));
        };
        const check = () => {
          const released = triggers.find(({ isReleased }) => isReleased());
          if (!released) return;
          cleanup();
          resolveSleep(released.trigger);
        };
        const timeout = setTimeout(() => {
          cleanup();
          resolveSleep(null);
        }, seconds * 1_000);
        const poll = triggers.length > 0 ? setInterval(check, SLEEP_TRIGGER_POLL_MS) : null;
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else check();
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
        `Released by: ${releasedBy ?? 'timeout'}`,
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
            `  Status: ${isThreadWaitingForInput(chatRunner, subagent.id)
              ? 'waiting_for_input'
              : chatRunner?.runs?.has(subagent.id) ? 'running' : 'idle'}`,
          ].join('\n'))
          : ['None.']),
      ].join('\n');
    },
  },
  {
    name: 'sleep_semaphore',
    description: 'Acquire permits from an application-wide managed named semaphore shared by every thread. This must be the only tool call in its model round. If permits are unavailable, this tool ends the current inference and suspends the thread in a FIFO queue; the application automatically resumes the thread when its turn is granted.',
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
          'The application will automatically invoke this thread with a system-user message when the permits are granted. The user may also run now or cancel this semaphore wait.',
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
    name: 'update_semaphore_status',
    description: 'Mark an owned semaphore as blocked when a concrete condition requires user intervention, or active after the blocker is resolved. Blocked semaphores stop automatic completion hooks until the status is cleared.',
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
          description: 'Owned semaphore whose status should change.',
        },
        status: {
          type: 'string',
          enum: ['active', 'blocked'],
        },
        summary: {
          type: 'string',
          maxLength: 4000,
          description: 'Concrete blocker requiring user intervention. Required when status is blocked; use an empty string when active.',
        },
      },
      required: ['name', 'status', 'summary'],
      additionalProperties: false,
    },
    execute: async ({ name, status, summary }, { chatRunner, conversationId }) => {
      const holding = chatRunner.setSemaphoreBlocked({
        conversationId,
        name,
        blocked: status === 'blocked',
        summary,
      });
      return status === 'blocked'
        ? `Semaphore "${holding.name}" marked blocked. Retained permits: ${holding.count}.`
        : `Semaphore "${holding.name}" is active again. Retained permits: ${holding.count}.`;
    },
  },
];
