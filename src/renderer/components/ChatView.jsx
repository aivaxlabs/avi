import { Sparkles } from 'lucide-react';
import { Composer } from './Composer.jsx';
import { Message } from './Message.jsx';

export function ChatView({
  currentConversation,
  currentMessages,
  currentModel,
  models,
  isRunning,
  onSend,
  onStop,
  onFork,
  onOpenModelPicker,
}) {
  const modelName = models.find((model) => model.id === currentModel)?.name ?? currentModel ?? 'Model';

  return (
    <main className="chat-area">
      <div className="chat-scroll">
        {currentMessages.length === 0 ? (
          <div className="empty-chat">
            <div className="copilot-orb">
              <Sparkles size={22} />
            </div>
            <h1>Hey, good afternoon!</h1>
            <p>How can AIVAX help you today?</p>
          </div>
        ) : (
          <div className="messages-column">
            {currentMessages.map((message) => (
              <Message
                key={message.id}
                message={message}
                onFork={() => onFork(currentConversation?.id)}
              />
            ))}
          </div>
        )}
      </div>
      <Composer
        modelName={modelName}
        isRunning={isRunning}
        onSend={onSend}
        onStop={onStop}
        onOpenModelPicker={onOpenModelPicker}
      />
    </main>
  );
}
