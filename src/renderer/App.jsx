import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { SettingsPage } from './components/SettingsPage.jsx';
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowWindow, setNarrowWindow] = useState(false);
  const [draftModel, setDraftModel] = useState('');
  const [draftProject, setDraftProject] = useState(null);

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
        setConversations((state) => upsertById(state, event.conversation).sort(sortByUpdatedAt));
      } else if (event.type === 'message-delete') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: (state[event.conversationId] ?? [])
            .filter((message) => message.id !== event.messageId),
        }));
      } else if (event.type === 'run-state') {
        setRunning((state) => ({ ...state, [event.conversationId]: event.running }));
      } else if (event.type === 'error') {
        setError(event.message);
      }
    })
  ), []);

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
  }) {
    if (!text.trim() && attachments.length === 0) return;
    if (!currentModel) {
      setError('Configure at least one model before sending a message.');
      setSettingsOpen(true);
      return;
    }

    const result = await api.chat.send({
      conversationId: selectedId,
      model: currentModel,
      text,
      attachments,
      steer,
      reasoningEffort,
      project: currentProject,
    });
    setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    setSelectedId(result.conversation.id);
    setMessagesByConversation((state) => ({
      ...state,
      [result.conversation.id]: upsertMessage(state[result.conversation.id] ?? [], result.message),
    }));
    setRunning((state) => ({
      ...state,
      [result.conversation.id]: !result.queued,
    }));
  }

  async function stopConversation() {
    if (selectedId) {
      await api.chat.stop(selectedId);
      setRunning((state) => ({ ...state, [selectedId]: false }));
    }
  }

  async function retryAssistantMessage(messageId) {
    if (!selectedId || !messageId || !currentModel) return;
    const result = await api.chat.retry({
      conversationId: selectedId,
      model: currentModel,
      assistantMessageId: messageId,
    });
    if (!result?.conversation) return;
    setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    if (!result.queued) {
      setRunning((state) => ({
        ...state,
        [result.conversation.id]: true,
      }));
    }
  }

  async function cancelQueuedMessage(messageId) {
    if (!selectedId || !messageId) return;
    const result = await api.chat.cancelQueued({
      conversationId: selectedId,
      messageId,
    });
    if (result?.cancelled) {
      setMessagesByConversation((state) => ({
        ...state,
        [selectedId]: (state[selectedId] ?? []).filter((message) => message.id !== messageId),
      }));
    }
  }

  async function forkConversation(id = selectedId, throughMessageId = null) {
    if (!id) return;
    const result = await api.conversations.fork({ conversationId: id, throughMessageId });
    if (!result) return;
    setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    setMessagesByConversation((state) => ({ ...state, [result.conversation.id]: result.messages }));
    setSelectedId(result.conversation.id);
  }

  async function deleteConversation(id) {
    const next = await api.conversations.delete(id);
    setConversations(next);
    setMessagesByConversation((state) => {
      const copy = { ...state };
      delete copy[id];
      return copy;
    });
    if (selectedId === id) {
      const fallback = next[0]?.id ?? null;
      setSelectedId(fallback);
      if (!fallback) setDraftProject(appState.defaultProject);
      if (fallback && !messagesByConversation[fallback]) {
        const messages = await api.conversations.messages(fallback);
        setMessagesByConversation((state) => ({ ...state, [fallback]: messages }));
      }
    }
  }

  async function chooseModel(modelId) {
    if (!selectedId) {
      setDraftModel(modelId);
      return;
    }
    const conversation = await api.conversations.update({ id: selectedId, model: modelId });
    setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
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
          onClose={() => setSettingsOpen(false)}
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
            onNewChat={() => {
              setSelectedId(null);
              setDraftProject(appState.defaultProject);
            }}
            onSelect={selectConversation}
            onSearch={() => setSearchOpen(true)}
            onFork={forkConversation}
            onDelete={deleteConversation}
            onSettings={() => setSettingsOpen(true)}
            collapsed={effectiveSidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          />
          <ChatView
            {...shell}
            currentProject={currentProject}
            models={models}
            favorites={favorites}
            onSend={sendMessage}
            onStop={stopConversation}
            onCompress={async () => {
              if (!selectedId || !currentModel || running[selectedId]) return;
              try {
                const conversation = await api.chat.compress({
                  conversationId: selectedId,
                  model: currentModel,
                });
                if (conversation) {
                  setConversations((state) => (
                    upsertById(state, conversation).sort(sortByUpdatedAt)
                  ));
                }
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : String(nextError));
              }
            }}
            onFork={forkConversation}
            onRetry={retryAssistantMessage}
            onCancelQueued={cancelQueuedMessage}
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
