import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { SettingsPage } from './components/SettingsPage.jsx';
import { SideChatPanel } from './components/SideChatPanel.jsx';
import { WindowControls } from './components/WindowControls.jsx';

const api = window.chatApp;

export default function App() {
  const [appState, setAppState] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [running, setRunning] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsContextFolder, setSettingsContextFolder] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowWindow, setNarrowWindow] = useState(false);
  const [draftModel, setDraftModel] = useState('');
  const [draftProject, setDraftProject] = useState(null);
  const [sideChats, setSideChats] = useState([]);
  const [activeSideChatId, setActiveSideChatId] = useState(null);

  const currentConversation = conversations.find((item) => item.id === selectedId) ?? null;
  const currentMessages = messagesByConversation[selectedId] ?? [];
  const currentProject = currentConversation
    ? {
        path: currentConversation.projectPath,
        name: currentConversation.projectName,
        displayPath: currentConversation.projectDisplayPath,
        gitBranch: currentConversation.gitBranch,
      }
    : draftProject ?? appState?.defaultProject ?? null;
  const recentProjects = useMemo(() => {
    const paths = new Set();
    const projects = [];

    for (const conversation of conversations) {
      if (
        !conversation.projectPath
        || conversation.projectPath === appState?.defaultProject?.path
        || paths.has(conversation.projectPath)
      ) {
        continue;
      }
      paths.add(conversation.projectPath);
      projects.push({
        path: conversation.projectPath,
        name: conversation.projectName,
        displayPath: conversation.projectDisplayPath,
        gitBranch: conversation.gitBranch,
      });
      if (projects.length === 8) break;
    }

    return projects;
  }, [appState?.defaultProject?.path, conversations]);
  const currentModel = useMemo(() => {
    const configuredModelIds = new Set(models.map((model) => model.id));
    return [
      currentConversation?.model,
      draftModel,
      appState?.lastModel,
      models[0]?.id,
    ].find((modelId) => modelId && configuredModelIds.has(modelId)) ?? '';
  }, [appState?.lastModel, currentConversation?.model, draftModel, models]);
  const currentModelContextLimit = models
    .find((model) => model.id === currentModel)
    ?.context.input ?? null;
  const contextUsage = useMemo(() => ({
    tokens: currentConversation?.contextTokens ?? 0,
    limit: currentModelContextLimit,
  }), [currentConversation?.contextTokens, currentModelContextLimit]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.app.state(),
      api.conversations.list(),
      api.providers.list(),
      api.models.list(),
      api.models.favorites(),
    ])
      .then(async ([nextAppState, nextConversations, nextProviders, nextModels, nextFavorites]) => {
        if (!active) return;
        setAppState(nextAppState);
        setConversations(nextConversations);
        setProviders(nextProviders);
        setModels(nextModels);
        setFavorites(nextFavorites);
        setDraftProject(nextAppState.defaultProject);
        setSettingsOpen(nextModels.length === 0);

        if (nextConversations[0]) {
          const messages = await api.conversations.messages(nextConversations[0].id);
          if (!active) return;
          setSelectedId(nextConversations[0].id);
          setMessagesByConversation({ [nextConversations[0].id]: messages });
        }
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setAppState({});
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => (
    api.onChatEvent((event) => {
      if (event.type === 'message') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: upsertMessage(state[event.conversationId] ?? [], event.message),
        }));
        if (event.message.role === 'assistant') {
          setRunning((state) => ({
            ...state,
            [event.conversationId]: event.message.status === 'streaming',
          }));
        }
      } else if (event.type === 'conversation') {
        if (event.conversation.isSideChat) {
          setSideChats((state) => (
            state.some((sideChat) => sideChat.id === event.conversation.id)
              ? upsertById(state, event.conversation)
              : state
          ));
        } else {
          setConversations((state) => upsertById(state, event.conversation).sort(sortByUpdatedAt));
        }
      } else if (event.type === 'message-delete') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: (state[event.conversationId] ?? [])
            .filter((message) => message.id !== event.messageId),
        }));
      } else if (event.type === 'queue-order') {
        const positions = new Map(event.messageIds.map((messageId, index) => [messageId, index]));
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: (state[event.conversationId] ?? []).map((message) => (
            positions.has(message.id)
              ? { ...message, queuePosition: positions.get(message.id) }
              : message
          )),
        }));
      } else if (event.type === 'run-state') {
        setRunning((state) => ({ ...state, [event.conversationId]: event.running }));
      } else if (event.type === 'error') {
        setError(event.message);
      }
    })
  ), []);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSideChats([]);
      setActiveSideChatId(null);
      return undefined;
    }

    api.sideChats.list(selectedId)
      .then(async (nextSideChats) => {
        const entries = await Promise.all(nextSideChats.map(async (sideChat) => (
          [sideChat.id, await api.conversations.messages(sideChat.id)]
        )));
        if (!active) return;
        setSideChats(nextSideChats);
        setMessagesByConversation((state) => ({
          ...state,
          ...Object.fromEntries(entries),
        }));
        setActiveSideChatId((current) => (
          nextSideChats.some((sideChat) => sideChat.id === current)
            ? current
            : nextSideChats[0]?.id ?? null
        ));
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  useEffect(() => {
    const syncSidebarWidth = () => setNarrowWindow(window.innerWidth < 700);
    syncSidebarWidth();
    window.addEventListener('resize', syncSidebarWidth);
    return () => window.removeEventListener('resize', syncSidebarWidth);
  }, []);

  async function selectConversation(id) {
    setSelectedId(id);
    if (!messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  }

  async function sendMessage({
    text,
    attachments,
    steer = false,
    reasoningEffort = null,
    conversationId = selectedId,
    model = currentModel,
    project = currentProject,
  }) {
    if (!text.trim() && attachments.length === 0) return;
    if (!model) {
      setError('Configure at least one model before sending a message.');
      setSettingsOpen(true);
      return;
    }

    const result = await api.chat.send({
      conversationId,
      model,
      text,
      attachments,
      steer,
      reasoningEffort,
      project,
    });
    if (result.conversation.isSideChat) {
      setSideChats((state) => upsertById(state, result.conversation));
    } else {
      setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
      setSelectedId(result.conversation.id);
    }
    setMessagesByConversation((state) => {
      const positions = new Map((result.queueOrder ?? []).map((messageId, index) => [messageId, index]));
      return {
        ...state,
        [result.conversation.id]: upsertMessage(
          state[result.conversation.id] ?? [],
          result.message,
        ).map((message) => (
          positions.has(message.id)
            ? { ...message, queuePosition: positions.get(message.id) }
            : message
        )),
      };
    });
    setRunning((state) => ({
      ...state,
      [result.conversation.id]: !result.queued,
    }));
  }

  async function stopConversation(conversationId = selectedId) {
    if (conversationId) {
      await api.chat.stop(conversationId);
      setRunning((state) => ({ ...state, [conversationId]: false }));
    }
  }

  async function retryAssistantMessage(
    messageId,
    {
      resumeFromFailure = false,
      model = currentModel,
      conversationId = selectedId,
    } = {},
  ) {
    if (!conversationId || !messageId || !model) return;
    const result = await api.chat.retry({
      conversationId,
      model,
      assistantMessageId: messageId,
      resumeFromFailure,
    });
    if (!result?.conversation) return;
    if (result.conversation.isSideChat) {
      setSideChats((state) => upsertById(state, result.conversation));
    } else {
      setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    }
    if (!result.queued) {
      setRunning((state) => ({
        ...state,
        [result.conversation.id]: true,
      }));
    }
  }

  async function cancelQueuedMessage(messageId, conversationId = selectedId) {
    if (!conversationId || !messageId) return false;
    const result = await api.chat.cancelQueued({
      conversationId,
      messageId,
    });
    if (result?.cancelled) {
      setMessagesByConversation((state) => ({
        ...state,
        [conversationId]: (state[conversationId] ?? [])
          .filter((message) => message.id !== messageId),
      }));
    }
    return Boolean(result?.cancelled);
  }

  async function forkConversation(id = selectedId, throughMessageId = null) {
    if (!id) return;
    const result = await api.conversations.fork({ conversationId: id, throughMessageId });
    if (!result) return;
    setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    setMessagesByConversation((state) => ({ ...state, [result.conversation.id]: result.messages }));
    setSelectedId(result.conversation.id);
  }

  async function createSideChat() {
    if (!selectedId) return;
    const result = await api.sideChats.create({ parentConversationId: selectedId });
    if (!result) return;
    setSideChats((state) => [...state, result.conversation]);
    setMessagesByConversation((state) => ({
      ...state,
      [result.conversation.id]: result.messages,
    }));
    setActiveSideChatId(result.conversation.id);
  }

  async function selectSideChat(id) {
    setActiveSideChatId(id);
    if (!messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  }

  async function closeSideChat(id) {
    const index = sideChats.findIndex((sideChat) => sideChat.id === id);
    if (index < 0 || !await api.sideChats.close(id)) return;
    const remaining = sideChats.filter((sideChat) => sideChat.id !== id);
    setSideChats(remaining);
    setMessagesByConversation((state) => {
      const next = { ...state };
      delete next[id];
      return next;
    });
    window.localStorage.removeItem(`aivax.composer.side.${id}`);
    setRunning((state) => ({ ...state, [id]: false }));
    if (activeSideChatId === id) {
      setActiveSideChatId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
    }
  }

  async function deleteConversation(id) {
    const next = await api.conversations.delete(id);
    setConversations(next);
    setMessagesByConversation((state) => {
      const copy = { ...state };
      delete copy[id];
      if (selectedId === id) {
        for (const sideChat of sideChats) delete copy[sideChat.id];
      }
      return copy;
    });
    if (selectedId === id) {
      setSideChats([]);
      setActiveSideChatId(null);
      const fallback = next[0]?.id ?? null;
      setSelectedId(fallback);
      if (!fallback) setDraftProject(appState.defaultProject);
      if (fallback && !messagesByConversation[fallback]) {
        const messages = await api.conversations.messages(fallback);
        setMessagesByConversation((state) => ({ ...state, [fallback]: messages }));
      }
    }
  }

  async function chooseModel(modelId, conversationId = selectedId) {
    if (!conversationId) {
      setDraftModel(modelId);
      return;
    }
    const conversation = await api.conversations.update({ id: conversationId, model: modelId });
    if (conversation.isSideChat) {
      setSideChats((state) => upsertById(state, conversation));
    } else {
      setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
    }
  }

  async function compressConversation(conversationId = selectedId, model = currentModel) {
    if (!conversationId || !model || running[conversationId]) return;
    try {
      const conversation = await api.chat.compress({ conversationId, model });
      if (!conversation) return;
      if (conversation.isSideChat) {
        setSideChats((state) => upsertById(state, conversation));
      } else {
        setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function reorderQueuedMessages(conversationId, messageIds, steerMessageId = null) {
    if (!conversationId) return;
    const result = await api.chat.reorderQueued({
      conversationId,
      messageIds,
      steerMessageId,
    });
    const positions = new Map(
      (result?.queueOrder ?? []).map((messageId, index) => [messageId, index]),
    );
    setMessagesByConversation((state) => ({
      ...state,
      [conversationId]: (state[conversationId] ?? []).map((message) => (
        positions.has(message.id)
          ? { ...message, queuePosition: positions.get(message.id) }
          : message
      )),
    }));
  }

  async function steerQueuedMessage(conversationId, messageId, messageIds) {
    await reorderQueuedMessages(
      conversationId,
      [messageId, ...messageIds.filter((queuedMessageId) => queuedMessageId !== messageId)],
      messageId,
    );
  }

  async function toggleFavorite(modelId) {
    const next = await api.models.favorite({
      modelId,
      favorited: !favorites.includes(modelId),
    });
    setFavorites(next);
  }

  async function applyProviders(nextProviders) {
    setProviders(nextProviders);
    const nextModels = await api.models.list();
    setModels(nextModels);
    return nextProviders;
  }

  const effectiveSidebarCollapsed = sidebarCollapsed || narrowWindow;
  const shellClassName = [
    'app-shell',
    appState?.platform && `platform-${appState.platform}`,
    effectiveSidebarCollapsed && 'sidebar-collapsed',
    settingsOpen && 'settings-active',
  ]
    .filter(Boolean)
    .join(' ');
  const shell = useMemo(() => ({
    conversations,
    currentConversation,
    currentMessages,
    currentModel,
    contextUsage,
    isRunning: Boolean(selectedId && running[selectedId]),
    recentProjects,
    recentModels: (() => {
      const modelsById = new Map(models.map((model) => [model.id, model]));
      const ids = [];
      for (const modelId of [currentModel, ...conversations.map((conversation) => conversation.model)]) {
        if (!modelId || ids.includes(modelId) || !modelsById.has(modelId)) continue;
        ids.push(modelId);
        if (ids.length === 8) break;
      }
      return ids
        .map((modelId) => modelsById.get(modelId))
        .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    })(),
  }), [
    conversations,
    currentConversation,
    currentMessages,
    currentModel,
    contextUsage,
    models,
    recentProjects,
    running,
    selectedId,
  ]);

  if (!appState) {
    return <div className="app-shell" />;
  }

  return (
    <div className={shellClassName}>
      <WindowControls />
      {settingsOpen ? (
        <SettingsPage
          providers={providers}
          initialContextFolder={settingsContextFolder}
          onClose={() => {
            setSettingsContextFolder(null);
            setSettingsOpen(false);
          }}
          onSave={async (provider) => applyProviders(await api.providers.save(provider))}
          onRemove={async (providerId) => applyProviders(await api.providers.remove(providerId))}
        />
      ) : (
        <>
          <Sidebar
            conversations={conversations}
            models={models}
            selectedId={selectedId}
            running={running}
            onNewChat={(preset = {}) => {
              setSelectedId(null);
              setDraftProject(preset.project ?? appState.defaultProject);
              setDraftModel(preset.modelId ?? appState.lastModel ?? models[0]?.id ?? '');
            }}
            onSelect={selectConversation}
            onSearch={() => setSearchOpen(true)}
            onFork={forkConversation}
            onDelete={deleteConversation}
            onOpenProject={async (project) => {
              try {
                await api.context.open(project.path);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              }
            }}
            onSettings={(contextFolder = null) => {
              setSettingsContextFolder(contextFolder);
              setSettingsOpen(true);
            }}
            collapsed={effectiveSidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          />
          <div className={`chat-workspace ${sideChats.length > 0 ? 'with-side-chat' : ''}`}>
            <ChatView
              {...shell}
              currentProject={currentProject}
              models={models}
              favorites={favorites}
              onSend={sendMessage}
              onStop={stopConversation}
              onCompress={compressConversation}
              onCreateSideChat={currentConversation ? createSideChat : undefined}
              onFork={forkConversation}
              onRetry={retryAssistantMessage}
              onResume={(messageId, model) => retryAssistantMessage(
                messageId,
                { resumeFromFailure: true, model },
              )}
              onCancelQueued={cancelQueuedMessage}
              onReorderQueued={(messageIds) => reorderQueuedMessages(selectedId, messageIds)}
              onSteerQueued={(messageId, messageIds) => (
                steerQueuedMessage(selectedId, messageId, messageIds)
              )}
              onSendContinuation={(text) => sendMessage({ text, attachments: [] })}
              onChooseModel={chooseModel}
              onChooseProject={async (project) => {
                if (currentConversation) return;
                if (project) {
                  setDraftProject(project);
                  return;
                }
                const selectedProject = await api.projects.select({
                  defaultPath: currentProject?.path ?? appState.defaultProject.path,
                });
                if (selectedProject) setDraftProject(selectedProject);
              }}
              onUseHome={() => {
                if (!currentConversation) setDraftProject(appState.defaultProject);
              }}
              onToggleFavorite={toggleFavorite}
            />
            {sideChats.length > 0 && (
              <SideChatPanel
                sideChats={sideChats}
                activeId={activeSideChatId}
                messagesByConversation={messagesByConversation}
                running={running}
                models={models}
                favorites={favorites}
                recentModels={shell.recentModels}
                recentProjects={recentProjects}
                fallbackModel={currentModel}
                onSelect={selectSideChat}
                onClose={closeSideChat}
                onSend={(sideChat, model, payload) => sendMessage({
                  ...payload,
                  conversationId: sideChat.id,
                  model,
                  project: {
                    path: sideChat.projectPath,
                    name: sideChat.projectName,
                    displayPath: sideChat.projectDisplayPath,
                    gitBranch: sideChat.gitBranch,
                  },
                })}
                onStop={stopConversation}
                onCompress={compressConversation}
                onFork={forkConversation}
                onRetry={(conversationId, messageId, model) => retryAssistantMessage(
                  messageId,
                  { conversationId, model },
                )}
                onResume={(conversationId, messageId, model) => retryAssistantMessage(
                  messageId,
                  { conversationId, model, resumeFromFailure: true },
                )}
                onCancelQueued={(conversationId, messageId) => (
                  cancelQueuedMessage(messageId, conversationId)
                )}
                onReorderQueued={reorderQueuedMessages}
                onSteerQueued={steerQueuedMessage}
                onChooseModel={chooseModel}
                onToggleFavorite={toggleFavorite}
              />
            )}
          </div>
        </>
      )}
      {!settingsOpen && searchOpen && (
        <SearchDialog
          onClose={() => setSearchOpen(false)}
          onSelect={selectConversation}
        />
      )}
      {error && (
        <button className="toast" type="button" onClick={() => setError('')}>
          {error}
        </button>
      )}
    </div>
  );
}

function upsertById(items, item) {
  const index = items.findIndex((current) => current.id === item.id);
  if (index === -1) return [item, ...items];
  return items.map((current) => (current.id === item.id ? item : current));
}

function upsertMessage(items, item) {
  const index = items.findIndex((current) => current.id === item.id);
  const next = index === -1
    ? [...items, item]
    : items.map((current) => (current.id === item.id ? item : current));
  return next.sort(sortByCreatedAt);
}

function sortByCreatedAt(a, b) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function sortByUpdatedAt(a, b) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}
