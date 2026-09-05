import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveAuxiliaryThreadStatuses,
  deriveAuxiliaryThreadStatusList,
  updateAuxiliaryMessageStates,
} from '../src/renderer/lib/auxiliary-thread-status.js';

const sideChat = {
  id: 'side-chat-1',
  lastMessageRole: 'assistant',
  lastMessageStatus: 'completed',
};
const subagent = {
  id: 'subagent-1',
  lastMessageRole: 'assistant',
  lastMessageStatus: 'completed',
};
const threads = [sideChat, subagent];

const completedStates = [sideChat, subagent].reduce((states, thread) => (
  updateAuxiliaryMessageStates(states, {
    conversationId: thread.id,
    role: 'assistant',
    status: 'completed',
    content: 'Initial response',
  })
), {});
const statuses = deriveAuxiliaryThreadStatuses(
  {},
  threads,
  {},
  [],
  completedStates,
);
assert.deepEqual(statuses, {
  'side-chat-1': 'finished',
  'subagent-1': 'finished',
});
const subagentStatusList = deriveAuxiliaryThreadStatusList([], [subagent], statuses);
assert.deepEqual(subagentStatusList, [{ id: subagent.id, status: 'finished' }]);
assert.equal(
  deriveAuxiliaryThreadStatusList(
    subagentStatusList,
    [{ ...subagent, contextTokens: 123 }],
    statuses,
  ),
  subagentStatusList,
  'Non-operational subagent metadata should preserve the ChatView status-list identity.',
);

for (const thread of threads) {
  const textOnlyUpdate = updateAuxiliaryMessageStates(completedStates, {
    conversationId: thread.id,
    role: 'assistant',
    status: 'completed',
    content: 'A later text chunk with the same operational state',
  });
  assert.equal(
    textOnlyUpdate,
    completedStates,
    `${thread.id} text-only chunks should preserve the message-state record identity.`,
  );
  assert.equal(
    deriveAuxiliaryThreadStatuses(statuses, threads, {}, [], textOnlyUpdate),
    statuses,
    `${thread.id} text-only chunks should preserve the derived status record identity.`,
  );
}

const streamingStates = updateAuxiliaryMessageStates(completedStates, {
  conversationId: subagent.id,
  role: 'assistant',
  status: 'streaming',
  content: 'Working',
});
assert.notEqual(streamingStates, completedStates);
const workingStatuses = deriveAuxiliaryThreadStatuses(
  statuses,
  threads,
  { [subagent.id]: true },
  [],
  streamingStates,
);
assert.notEqual(workingStatuses, statuses);
assert.equal(workingStatuses[subagent.id], 'working');

const sleepingStatuses = deriveAuxiliaryThreadStatuses(
  workingStatuses,
  threads,
  { [subagent.id]: true },
  [{ conversationId: subagent.id }],
  streamingStates,
);
assert.equal(sleepingStatuses[subagent.id], 'sleeping');

const failedStates = updateAuxiliaryMessageStates(streamingStates, {
  conversationId: sideChat.id,
  role: 'assistant',
  status: 'error',
  content: 'Failed',
});
const failedStatuses = deriveAuxiliaryThreadStatuses(
  sleepingStatuses,
  threads,
  {},
  [],
  failedStates,
);
assert.equal(failedStatuses[sideChat.id], 'failed');

const finishedStates = updateAuxiliaryMessageStates(failedStates, {
  conversationId: subagent.id,
  role: 'assistant',
  status: 'completed',
  content: 'Done',
});
const finishedStatuses = deriveAuxiliaryThreadStatuses(
  failedStatuses,
  threads,
  {},
  [],
  finishedStates,
);
assert.equal(finishedStatuses[subagent.id], 'finished');

assert.equal(
  updateAuxiliaryMessageStates(finishedStates, {
    conversationId: subagent.id,
    role: 'assistant',
    status: 'queued',
  }),
  finishedStates,
  'Queued messages should not replace the last operational assistant state.',
);
assert.equal(
  updateAuxiliaryMessageStates(
    finishedStates,
    {
      conversationId: 'main-thread',
      role: 'assistant',
      status: 'streaming',
    },
    new Set(threads.map((thread) => thread.id)),
  ),
  finishedStates,
  'Main-thread messages should not enter the auxiliary operational state.',
);

const appSource = readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
assert.match(
  appSource,
  /subagents=\{subagentStatusList\}/,
  'The main ChatView should receive the stable minimal subagent status list.',
);
assert.match(
  appSource,
  /const messagesLoaded = !selectedId \|\| \(\s*messagePagesByConversation\[selectedId\]\?\.loaded\s*\?\? Object\.hasOwn\(messagesByConversation, selectedId\)\s*\);/,
  'The main ChatView loaded state should depend only on the selected conversation page.',
);
assert.doesNotMatch(
  appSource,
  /const shell = useMemo[\s\S]*?\], \[[\s\S]*?messagesByConversation[\s\S]*?\]\);/,
  'The main ChatView shell should not depend on the complete conversation message map.',
);
assert.match(
  appSource,
  /\[\.\.\.sideChats, \.\.\.visibleSubagents\][\s\S]*?auxiliaryMessageStates/,
  'Side chats and subagents should share the minimal operational summary path.',
);
assert.match(appSource, /hydrateLiveRuns\(nextChatState\)/);
assert.match(appSource, /hydrateLiveRuns\(completedReload\)/);
const hydrateStart = appSource.indexOf('  function hydrateLiveRuns(snapshot) {');
const hydrateEnd = appSource.indexOf('\n  const [completedUnseen', hydrateStart);
const liveRunEventsRef = { current: {} };
let running;
let startedAt;
const hydrate = new Function('setRunning', 'setRunStartedAt', 'liveRunEventsRef',
  `${appSource.slice(hydrateStart, hydrateEnd)}; return hydrateLiveRuns;`)(
  (update) => { running = update(); },
  (update) => { startedAt = update(); },
  liveRunEventsRef,
);
hydrate({ conversationIds: ['bot'], runsStartedAt: { bot: 10 } });
assert.deepEqual(running, { bot: true }, 'already-active bot must be running after hydration');
liveRunEventsRef.current = { bot: { running: false }, newRun: { running: true, startedAt: 20 } };
hydrate({ conversationIds: ['bot'], runsStartedAt: { bot: 10 } });
assert.deepEqual(running, { bot: false, newRun: true }, 'events must win over a delayed snapshot');
assert.deepEqual(startedAt, { newRun: 20 });
const messageEvent = appSource.slice(appSource.indexOf("if (event.type === 'message')"), appSource.indexOf("} else if (event.type === 'block-state')"));
assert.doesNotMatch(messageEvent, /setRunning/, 'persisted message status must not change live execution');
assert.match(appSource, /liveRunEventsRef\.current\[event\.conversationId\] =/);

console.log('Auxiliary thread operational status stability tests passed.');
