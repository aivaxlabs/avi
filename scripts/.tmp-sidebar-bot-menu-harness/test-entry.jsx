import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '../../src/renderer/components/Sidebar.jsx';

const workQueue = [
  'Review the next release',
  'Triage failures that need immediate attention across the entire workspace',
  'Update documentation',
];

function TestApp() {
  const activationCalls = useRef([]);

  window.__harness = { activationCalls: activationCalls.current };

  return (
    <Sidebar
      conversations={[]}
      bots={[{
        id: 'bot-1',
        conversationId: 'bot-conversation-1',
        name: 'Release bot',
        iconSeed: 'release-bot',
        enabled: true,
        running: false,
        scheduleState: 'active',
        workQueue,
        workQueueIndex: 1,
      }]}
      models={[]}
      selectedId={null}
      running={{}}
      runStartedAt={{}}
      completedUnseen={{}}
      approvalPending={{}}
      inputPending={{}}
      semaphoreWaiting={{}}
      collapsed={false}
      orchestrationOpen={false}
      homePath="/home/test"
      chatTags={[]}
      folderColors={{}}
      onNewChat={() => {}}
      onQuickChat={() => {}}
      onSelect={() => {}}
      onSelectBot={() => {}}
      onBotSettings={() => {}}
      onDeleteBot={() => {}}
      onActivateBot={(botId, workQueueIndex) => activationCalls.current.push({ botId, workQueueIndex })}
      onSnoozeBot={() => {}}
      onSearch={() => {}}
      onOpenOrchestration={() => {}}
      onFork={() => {}}
      onArchive={() => {}}
      onOpenProject={() => {}}
      onOpenTerminal={() => {}}
      onCopyPath={() => {}}
      onCopyThreadId={() => {}}
      onSettings={() => {}}
      onSetConversationTags={() => {}}
      onSetFolderColor={() => {}}
      onSaveChatTags={() => {}}
      onToggleCollapsed={() => {}}
    />
  );
}

createRoot(document.getElementById('root')).render(<TestApp />);
