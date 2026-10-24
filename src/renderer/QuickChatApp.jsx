import { GitFork } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ChatView } from './components/ChatView.jsx';
import { ComposerFloatButton, ComposerFloatButtonStrip } from './components/ComposerFloatButtons.jsx';
import { applyTheme, readAppearance } from './lib/apply-theme.js';
import { setPluginThemes } from './lib/themes.js';

const api = window.chatApp;
const conversationId = new URLSearchParams(window.location.search).get('conversation');

export default function QuickChatApp() {
  const [appState, setAppState] = useState(null);
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [recentProjects, setRecentProjects] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [questionRequest, setQuestionRequest] = useState(null);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [semaphoreWait, setSemaphoreWait] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [contextUsage, setContextUsage] = useState(null);
  const [goalPreparation, setGoalPreparation] = useState(null);
  const [error, setError] = useState('');
  const [forking, setForking] = useState(false);

  useEffect(() => {
    document.title = 'Quick chat';
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setError('This Quick chat is missing its conversation.');
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      api.app.state(),
      api.conversations.context(conversationId),
      api.models.list(),
      api.models.favorites(),
      api.conversations.list(),
    ]).then(([state, context, availableModels, favoriteModels, threads]) => {
      if (cancelled) return;
      setPluginThemes(state.pluginCatalog?.themes);
      applyTheme(readAppearance());
      setAppState(state);
      setConversation(context.conversation);
      setMessages(context.messages ?? []);
      setRunning(Boolean(context.run?.active));
      setQuestionRequest(context.questions?.[0] ?? null);
      setApprovalRequests(context.approvals ?? []);
      setSemaphoreWait(context.semaphoreWaits?.[0] ?? null);
      setTasks(context.tasks ?? []);
      setContextUsage(context.contextUsage ?? null);
      setModels(availableModels);
      setFavorites(favoriteModels);
      setRecentProjects(recentProjectsFrom(threads, state.defaultProject?.path));
    }).catch((nextError) => {
      if (!cancelled) setError(nextError.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return undefined;
    return api.onChatEvent((event) => {
      if (event.conversationId !== conversationId && event.conversation?.id !== conversationId) return;
      if (event.type === 'message') {
        setMessages((current) => upsertMessage(current, event.message));
      } else if (event.type === 'message-delete') {
        setMessages((current) => current.filter((message) => message.id !== event.messageId));
      } else if (event.type === 'queue-order') {
        setMessages((current) => applyPendingOrder(current, event));
      } else if (event.type === 'conversation') {
        setConversation(event.conversation);
        if (event.conversation.contextTokens) {
          setContextUsage((current) => ({
            ...(current ?? {}),
            tokens: event.conversation.contextTokens,
          }));
        }
      } else if (event.type === 'run-state') {
        setRunning(Boolean(event.running));
      } else if (event.type === 'tasks') {
        setTasks(event.tasks ?? []);
      } else if (event.type === 'question-request') {
        setQuestionRequest(event);
      } else if (event.type === 'question-cancelled') {
        setQuestionRequest((current) => (
          current?.questionId === event.questionId ? null : current
        ));
      } else if (event.type === 'permission-request') {
        setApprovalRequests((current) => (
          current.some((request) => request.approvalId === event.approvalId)
            ? current
            : [...current, event]
        ));
      } else if (['permission-cancelled', 'permission-resolved'].includes(event.type)) {
        setApprovalRequests((current) => current.filter(
          (request) => request.approvalId !== event.approvalId,
        ));
      } else if (event.type === 'semaphore-state') {
        setSemaphoreWait((event.waits ?? []).find((item) => item.conversationId === conversationId) ?? null);
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
  }, []);

  const currentProject = useMemo(() => (
    conversation ? {
      path: conversation.projectPath,
      name: conversation.projectName,
      displayPath: conversation.projectDisplayPath,
      gitBranch: conversation.gitBranch,
    } : null
  ), [conversation]);
  const hasMessage = messages.some((message) => (
    !message.hidden && ['user', 'assistant'].includes(message.role)
  ));
  const workMode = conversation?.orchestrationMode === 'plan' ? 'plan' : null;
  const ultraMode = conversation?.orchestrationMode === 'ultra';

  function retryMessage(messageId, resumeFromFailure, model = conversation?.model) {
    return api.chat.retry({
      conversationId,
      model,
      assistantMessageId: messageId,
      resumeFromFailure,
      permissionMode: window.localStorage.getItem('aivax.composer.permission-mode')
        || appState?.tuning?.defaultPermissionMode
        || 'approve_for_me',
    });
  }

  async function chooseProject(project) {
    const selected = project ?? await api.projects.select({
      defaultPath: currentProject?.path ?? appState?.defaultProject?.path,
    });
    if (!selected?.path || !conversation) return null;
    const updated = await api.conversations.setProject({
      conversationId: conversation.id,
      projectPath: selected.path,
    });
    setConversation(updated);
    return {
      path: updated.projectPath,
      name: updated.projectName,
      displayPath: updated.projectDisplayPath,
      gitBranch: updated.gitBranch,
    };
  }

  async function sendMessage(payload) {
    if (!conversation) return false;
    setError('');
    const model = payload.model || conversation.model;
    const messageWorkMode = payload.workMode ?? workMode;
    if (
      messageWorkMode === 'goal'
      && (!conversation.goal || conversation.goal.status === 'discarded')
    ) {
      setGoalPreparation({ specification: payload.text });
      try {
        await api.goals.start({
          conversationId: conversation.id,
          model,
          project: currentProject,
          specification: payload.text,
          attachments: payload.attachments ?? [],
          reasoningEffort: payload.reasoningEffort ?? null,
          permissionMode: payload.permissionMode,
          ultraMode: Boolean(payload.ultraMode),
        });
        return true;
      } catch (nextError) {
        setError(nextError.message);
        return false;
      } finally {
        setGoalPreparation(null);
      }
    }
    try {
      const result = await api.chat.send({
        conversationId: conversation.id,
        model,
        text: payload.text,
        attachments: payload.attachments ?? [],
        steer: Boolean(payload.steer),
        reasoningEffort: payload.reasoningEffort ?? null,
        permissionMode: payload.permissionMode,
        workMode: messageWorkMode,
        ultraMode: Boolean(payload.ultraMode),
        project: currentProject,
      });
      setConversation(result.conversation);
      setMessages((current) => {
        let next = upsertMessage(current, result.message);
        if (result.assistantMessage) next = upsertMessage(next, result.assistantMessage);
        return applyPendingOrder(next, result);
      });
      return true;
    } catch (nextError) {
      setError(nextError.message);
      return false;
    }
  }

  return (
    <main className="quick-chat-shell">
      {error && <div className="quick-chat-error" role="alert">{error}</div>}
      <div className="chat-view-slot">
        <ChatView
          currentConversation={conversation}
          currentMessages={messages}
          messagesLoaded={Boolean(conversation)}
          currentModel={conversation?.model ?? ''}
          currentProject={currentProject}
          contextUsage={contextUsage}
          recentProjects={recentProjects}
          models={models}
          favorites={favorites}
          intelligenceLevels={appState?.defaultModels?.intelligence?.levels ?? []}
          isRunning={running}
          semaphoreWait={semaphoreWait}
          onRunSemaphoreNow={() => api.chat.runSemaphoreNow(conversationId)}
          onCancelSemaphore={() => api.chat.cancelSemaphore(conversationId)}
          onSend={sendMessage}
          onReplaceUserMessage={async (messageId, payload) => {
            const result = await api.chat.replaceUserMessage({
              conversationId,
              messageId,
              ...payload,
            });
            setConversation(result.conversation);
            setMessages((current) => upsertMessage(current, result.message));
          }}
          onExpandPrompt={(payload) => api.chat.expandPrompt(payload)}
          onStop={() => api.chat.stop(conversationId)}
          onQuickCompress={() => api.chat.compressQuick({ conversationId })}
          onCompress={() => api.chat.compress({
            conversationId,
            model: conversation?.model,
          })}
          tasks={tasks}
          onRetry={(messageId) => retryMessage(messageId, false)}
          onResume={(messageId, model) => retryMessage(messageId, true, model)}
          onCancelQueued={async (messageId) => {
            const result = await api.chat.cancelQueued({ conversationId, messageId });
            setMessages((current) => applyPendingOrder(
              current.filter((message) => !result?.cancelled || message.id !== messageId),
              result,
            ));
            return Boolean(result?.cancelled);
          }}
          onReorderQueued={(queueType, messageIds, steerMessageId, dispatchNext) => api.chat.reorderQueued({
            conversationId,
            queueType,
            messageIds,
            steerMessageId,
            dispatchNext,
          })}
          onSteerQueued={(messageId, messageIds) => api.chat.reorderQueued({
            conversationId,
            queueType: 'steer',
            messageIds,
            steerMessageId: messageId,
          })}
          onChooseModel={async (modelId) => {
            setConversation(await api.conversations.update({ id: conversationId, model: modelId }));
          }}
          onChooseProject={chooseProject}
          allowProjectChange
          onUseHome={() => chooseProject(appState?.defaultProject)}
          onToggleFavorite={async (modelId) => setFavorites(await api.models.favorite({
            modelId,
            favorited: !favorites.includes(modelId),
          }))}
          workMode={workMode}
          onWorkModeChange={async (next) => {
            const updated = await api.conversations.update({
              id: conversationId,
              orchestrationMode: next === 'plan' ? 'plan' : null,
            });
            setConversation(updated);
            return true;
          }}
          ultraMode={ultraMode}
          onUltraModeChange={async (enabled) => {
            const updated = await api.conversations.update({
              id: conversationId,
              orchestrationMode: enabled ? 'ultra' : null,
            });
            setConversation(updated);
            return true;
          }}
          goalPreparation={goalPreparation}
          onGoalAction={async (action, specification) => {
            const result = await api.goals.change({
              conversationId,
              action,
              ...(specification == null ? {} : { specification }),
            });
            setConversation(result.conversation);
            return true;
          }}
          questionRequest={questionRequest}
          onAnswerQuestion={async (request, answers, cancelled) => {
            const resolved = await api.chat.answerQuestion({
              questionId: request.questionId,
              cancelled,
              answers: cancelled ? [] : answers,
            });
            if (resolved) setQuestionRequest(null);
            return resolved;
          }}
          approvalRequests={approvalRequests}
          onResolveApproval={async (request, decision) => {
            const resolved = await api.chat.resolveApproval({
              approvalId: request.approvalId,
              decision,
            });
            if (resolved) {
              setApprovalRequests((current) => current.filter(
                (item) => item.approvalId !== request.approvalId,
              ));
            }
            return resolved;
          }}
          onOpenFileReference={(reference) => api.files.reveal({
            folderPath: currentProject?.path,
            filePath: reference.path,
            allowExternalReference: true,
          })}
          onFileReferenceAction={async (action, reference) => {
            await api.files[action === 'reveal' ? 'reveal' : 'copyPath']({
              folderPath: currentProject?.path,
              filePath: reference.path,
              allowExternalReference: true,
            });
          }}
          messageDeliveryMode={appState?.tuning?.messageDeliveryMode}
          defaultPermissionMode={appState?.tuning?.defaultPermissionMode}
          continuationRepliesEnabled={appState?.tuning?.continuationRepliesEnabled}
          emptyHint="This conversation disappears when you close the window, unless you fork it into a thread."
          homeEmpty={false}
          composerFloat={hasMessage ? (
            <ComposerFloatButtonStrip>
              <ComposerFloatButton
                icon={GitFork}
                disabled={forking}
                onClick={() => {
                  setForking(true);
                  api.quickChat.fork(conversationId).catch((nextError) => {
                    setForking(false);
                    setError(nextError.message);
                  });
                }}
              >
                Fork in thread
              </ComposerFloatButton>
            </ComposerFloatButtonStrip>
          ) : null}
        />
      </div>
    </main>
  );
}

function recentProjectsFrom(threads, homePath) {
  const paths = new Set();
  const projects = [];
  for (const thread of threads) {
    if (!thread.projectPath || thread.projectPath === homePath || paths.has(thread.projectPath)) continue;
    paths.add(thread.projectPath);
    projects.push({
      path: thread.projectPath,
      name: thread.projectName,
      displayPath: thread.projectDisplayPath,
      gitBranch: thread.gitBranch,
    });
    if (projects.length === 30) break;
  }
  return projects;
}

function applyPendingOrder(messages, order) {
  const positions = new Map([
    ...(order?.steerMessageIds ?? []).map((messageId, index) => [messageId, index]),
    ...(order?.queuedMessageIds ?? []).map((messageId, index) => [messageId, index]),
  ]);
  return messages.map((message) => (
    positions.has(message.id)
      ? { ...message, queuePosition: positions.get(message.id) }
      : message
  ));
}

function upsertMessage(items, item) {
  const index = items.findIndex((current) => current.id === item.id);
  const next = index === -1
    ? [...items, item]
    : items.map((current) => (current.id === item.id ? item : current));
  return next.sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
}
