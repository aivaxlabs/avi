export const CONTINUING_GOAL_STATUSES = new Set(['active', 'paused']);
export const TERMINAL_GOAL_STATUSES = new Set(['completed', 'blocked', 'cancelled']);
export const SEMAPHORE_RESUME_TOKEN = Symbol('semaphore-resume');
export const REPLACEMENT_SEND_TOKEN = Symbol('replacement-send');
export const STREAM_PERSIST_INTERVAL_MS = 1_000;
export const STREAM_RENDER_INTERVAL_MS = 240;
export const WATCHDOG_INTERVAL_MS = 250;
export const WATCHDOG_MIN_STALL_MS = 500;
export const WATCHDOG_STALL_COUNT = 3;
export const WATCHDOG_WINDOW_MS = 30_000;
export const AUXILIARY_MODEL_TIMEOUT_MS = 300_000;
export const ASK_QUESTION_AFK_TIMEOUT_MS = 60_000;
export const AUXILIARY_GOAL_CONTEXT_TURN_COUNT = 4;
export const AUXILIARY_PROMPT_CONTEXT_TURN_COUNT = 8;
export const AUXILIARY_CONTINUATION_CONTEXT_TURN_COUNT = 8;
export const MAX_CONTINUATION_COUNT = 4;
export const MAX_CONSECUTIVE_CONTEXT_COMPACTION_FAILURES = 3;
export const SIDE_CHAT_QUICK_COMPRESSION_MARGIN = 0.1;
export const CROSS_BOT_INBOX_TOOL_NAMES = new Set([
  'bots_list',
  'bots_read_work_log',
  'bots_send_work_log_message',
]);
export const PLAN_TOOL_NAMES = new Set([
  'ask_question',
  'chat_inspect_thread',
  'chat_list_folders',
  'chat_list_threads',
  'chat_overview',
  'bots_read_work_log',
  'chat_list_thread_context',
  'list_semaphores',
  'chat_send_prompt',
  'chat_spawn_subagent',
  'read_file',
  'read_terminal_output',
  'run_in_terminal',
  'sleep',
  'sleep_semaphore',
  'release_semaphore',
  'update_semaphore_status',
  'read_url',
]);
export const COMPACTION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a self-contained handoff checkpoint for another LLM that will resume this exact task. The checkpoint becomes the sole conversation history; no earlier messages, in-flight assistant content, tool calls, or tool results will remain available. Preserve all critical information from the supplied context while using substantially fewer tokens. Do not continue the task itself.

Include:
- The user's original objective and the current objective, including how the request evolved
- Relevant in-flight assistant work, tool calls, and tool results
- What you were working on, planning, investigating, or exploring immediately before this checkpoint
- Current progress and every important decision already made, with rationale where it affects future work
- Important context, constraints, user preferences, project conventions, and explicit instructions that must continue to be followed
- Concrete implementation details: relevant files, symbols, interfaces, commands, data shapes, examples, references, and observed behavior
- What has been completed and how it was validated, clearly separating confirmed evidence from assumptions or unverified work
- What remains to be done, including unresolved problems, risks, edge cases, blockers, and open questions
- What you intended to do next, stated as concrete immediate actions
- A step-by-step execution roadmap for the remaining work, clearly marking the current stage and the completion status of each stage
- Any critical data needed to continue without rereading the compacted conversation

Make the checkpoint structured, exhaustive, precise, and optimized for seamless continuation by another LLM.`;
