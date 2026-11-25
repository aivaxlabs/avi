import {
  deleteConversation,
  forkConversation,
  getConversation,
  getLatestMessage,
} from '../database.js';
import { traceError } from '../trace-log.js';

const MEMORY_HINT_REASONS = {
  task: 'A step of the task list advanced or was blocked.',
  ultra_context: 'The Ultra team context was recorded or revised.',
  iteration: 'The current iteration finished.',
};

export const memoryHintMethods = {
  requestMemoryHint(conversationId, trigger, run = this.runs.get(conversationId)) {
    const { tuning, aivax } = this.getPreferences();
    if (this.shuttingDown || !tuning?.asyncMemoryHintsEnabled) return;
    if (
      !(aivax?.connected && aivax.memoryEnabled && aivax.memoryCollectionId)
      && tuning.defaultMemoryInstructionsEnabled === false
    ) return;
    if (!run || run.workMode === 'plan') return;
    const source = getConversation(conversationId);
    if (!['thread', 'subagent'].includes(source?.conversationType)) return;

    const request = {
      trigger,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      permissionMode: run.permissionMode,
    };
    const active = this.memoryHints.get(conversationId);
    if (active) {
      active.pending = request;
      return;
    }
    this.memoryHints.set(conversationId, { pending: null });
    void this.runMemoryHint(conversationId, request);
  },

  async runMemoryHint(conversationId, { trigger, model, reasoningEffort, permissionMode }) {
    let hintId = null;
    try {
      const fork = forkConversation(conversationId, { memoryHint: true });
      if (!fork) throw new Error('The memory hint fork could not be created.');
      hintId = fork.conversation.id;
      this.memoryHintThreads.add(hintId);
      await this.send({
        conversationId: hintId,
        model,
        reasoningEffort,
        permissionMode,
        hidden: true,
        fromAgent: true,
        project: { path: fork.conversation.projectPath },
        text: [
          `<memory_hint trigger="${trigger}">`,
          `${MEMORY_HINT_REASONS[trigger]} Record what was done in persistent memory when it produced reusable knowledge, following the Memory section of your instructions.`,
          '</memory_hint>',
        ].join('\n'),
      });
      await this.runs.get(hintId)?.completion;
      const result = getLatestMessage(hintId, { role: 'assistant' });
      if (result?.status !== 'completed') {
        throw new Error(
          result?.segments?.findLast((segment) => segment.type === 'error')?.message
            ?? `The memory hint ended with status "${result?.status ?? 'unknown'}".`,
        );
      }
    } catch (error) {
      traceError('memory-hint.error', {
        thread_id: conversationId,
        operation: trigger,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (hintId) {
        this.memoryHintThreads.delete(hintId);
        try {
          deleteConversation(hintId, { hard: true });
        } catch (error) {
          traceError('memory-hint.cleanup-error', {
            thread_id: conversationId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const pending = this.memoryHints.get(conversationId)?.pending;
      if (pending && !this.shuttingDown) {
        this.memoryHints.set(conversationId, { pending: null });
        void this.runMemoryHint(conversationId, pending);
      } else {
        this.memoryHints.delete(conversationId);
      }
    }
  },
};
