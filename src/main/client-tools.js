import { memoryWebTools } from './tools/memory-web.js';
import { mediaTools } from './tools/media.js';
import { taskTools } from './tools/tasks.js';
import { botTools } from './tools/bots.js';
import { threadListingTools, threadActionTools } from './tools/threads.js';
import { semaphoreListingTools, semaphoreTools } from './tools/semaphores.js';
import { terminalTools } from './tools/terminal.js';
import { fileTools } from './tools/files.js';

export { normalizeQuestions } from './tools/tasks.js';
export { stopConversationTerminals } from './tools/terminal.js';
export { decorateToolsForInvocation } from './tools/invocation.js';

export const CLIENT_TOOLS = Object.freeze([
  ...mediaTools,
  ...taskTools,
  ...botTools,
  ...threadListingTools,
  ...semaphoreListingTools,
  ...threadActionTools,
  ...memoryWebTools,
  ...semaphoreTools,
  ...terminalTools,
  ...fileTools,
]);
