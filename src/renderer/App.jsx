import { useEffect, useMemo, useState } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { SettingsPage } from './components/SettingsPage.jsx';
import { McpOverlay } from './components/McpOverlay.jsx';
import { AuxiliaryPanel } from './components/AuxiliaryPanel.jsx';
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
  const [settingsInitialView, setSettingsInitialView] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowWindow, setNarrowWindow] = useState(false);
  const [draftModel, setDraftModel] = useState('');
  const [draftProject, setDraftProject] = useState(null);
  const [sideChats, setSideChats] = useState([]);
  const [subagents, setSubagents] = useState([]);
  const [auxiliaryPanelVisible, setAuxiliaryPanelVisible] = useState(false);
  const [activeAuxiliaryTab, setActiveAuxiliaryTab] = useState(null);
  const [activeSubagentId, setActiveSubagentId] = useState(null);
  const [mcpState, setMcpState] = useState(null);
  const [mcpWaiting, setMcpWaiting] = useState({});
  const [mcpAlert, setMcpAlert] = useState(null);
  const [mcpWorkspaceServers, setMcpWorkspaceServers] = useState(null);

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
  const subagentsWithStatus = useMemo(() => subagents.map((subagent) => {
    const messages = messagesByConversation[subagent.id] ?? [];
    const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
    const lastAssistant = messages
      .slice(lastUserIndex + 1)
      .findLast((message) => message.role === 'assistant');
    const status = running[subagent.id]
      ? 'working'
      : lastAssistant?.status === 'completed'
        ? 'finished'
        : ['error', 'aborted', 'streaming'].includes(lastAssistant?.status)
          ? 'failed'
          : 'waiting';
    return { ...subagent, status };
  }), [messagesByConversation, running, subagents]);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.app.state(),
      api.conversations.list(),
      api.providers.list(),
      api.models.list(),
      api.models.favorites(),
      api.mcp.state(),
    ])
      .then(async ([
        nextAppState,
        nextConversations,
        nextProviders,
        nextModels,
        nextFavorites,
        nextMcpState,
      ]) => {
        if (!active) return;
        setAppState(nextAppState);
        setConversations(nextConversations);
        setProviders(nextProviders);
        setModels(nextModels);
        setFavorites(nextFavorites);
        setMcpState(nextMcpState);
        const authServers = nextMcpState.servers
          .filter((server) => server.status === 'auth-required');
        const failedServers = nextMcpState.servers
          .filter((server) => server.status === 'error');
        if (authServers.length > 0 || failedServers.length > 0) {
          setMcpAlert((current) => current ?? (
            authServers.length > 0
              ? {
                  type: 'auth-required',
                  server: authServers[0],
                  authQueue: authServers.slice(1),
                  pendingFailures: failedServers,
                }
              : { type: 'failure', servers: failedServers }
          ));
        }
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
        if (event.conversation.isSubagent) {
          setSubagents((state) => upsertById(state, event.conversation));
        } else if (event.conversation.isSideChat) {
          setSideChats((state) => (
            state.some((sideChat) => sideChat.id === event.conversation.id)
              ? upsertById(state, event.conversation)
              : state
          ));
        } else {
          setConversations((state) => upsertById(state, event.conversation).sort(sortByUpdatedAt));
        }
      } else if (event.type === 'subagent-created') {
        setSubagents((state) => upsertById(state, event.subagent));
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
      } else if (event.type === 'mcp-waiting') {
        setMcpWaiting((state) => {
          if (event.waiting) {
            return { ...state, [event.conversationId]: true };
          }
          const next = { ...state };
          delete next[event.conversationId];
          return next;
        });
      } else if (event.type === 'error') {
        setError(event.message);
      }
    })
  ), []);

  useEffect(() => (
    api.onMcpEvent((event) => {
      if (event.type === 'state') {
        setMcpState(event.state);
      } else if (event.type === 'auth-required') {
        setMcpAlert((current) => {
          if (current?.type === 'auth-required') {
            if (
              current.server.key === event.server.key
              || current.authQueue?.some((server) => server.key === event.server.key)
            ) {
              return current;
            }
            return {
              ...current,
              authQueue: [...(current.authQueue ?? []), event.server],
            };
          }
          return {
            type: 'auth-required',
            server: event.server,
            authQueue: [],
            pendingFailures: current?.type === 'failure' ? current.servers : [],
          };
        });
      } else if (event.type === 'server-failed') {
        setMcpAlert((current) => {
          const servers = [
            ...(current?.type === 'auth-required'
              ? current.pendingFailures ?? []
              : current?.servers ?? []),
            event.server,
          ].filter((server, index, items) => (
            items.findIndex((item) => item.key === server.key) === index
          ));
          if (current?.type === 'auth-required') {
            return { ...current, pendingFailures: servers };
          }
          return { type: 'failure', servers };
        });
      } else if (event.type === 'configuration-error') {
        setMcpAlert({ type: 'failure', message: event.message, servers: [] });
      } else if (event.type === 'auth-complete') {
        setMcpAlert((current) => (
          current?.server?.key === event.server.key
            ? advanceMcpAuthAlert(current)
            : current
        ));
      }
    })
  ), []);

  useEffect(() => {
    let active = true;
    if (!selectedId) {
      setSideChats([]);
      setSubagents([]);
      setActiveAuxiliaryTab(null);
      setActiveSubagentId(null);
      return undefined;
    }

    Promise.all([
      api.sideChats.list(selectedId),
      api.subagents.list(selectedId),
    ])
      .then(async ([nextSideChats, nextSubagents]) => {
        const entries = await Promise.all(
          [...nextSideChats, ...nextSubagents].map(async (childThread) => (
            [childThread.id, await api.conversations.messages(childThread.id)]
          )),
        );
        if (!active) return;
        setSideChats(nextSideChats);
        setSubagents(nextSubagents);
        setMessagesByConversation((state) => ({
          ...state,
          ...Object.fromEntries(entries),
        }));
        setActiveAuxiliaryTab((current) => {
          if (current === 'subagents' && nextSubagents.length > 0) return current;
          if (nextSideChats.some((sideChat) => sideChat.id === current)) return current;
          return nextSideChats[0]?.id ?? null;
        });
        setActiveSubagentId((current) => (
          nextSubagents.some((subagent) => subagent.id === current)
            ? current
            : null
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
    const command = attachments.length === 0 ? text.trim().toLowerCase() : '';
    if (command === '/mcp' || command === '/restart-mcp') {
      try {
        setMcpWorkspaceServers(command === '/mcp'
          ? await api.mcp.workspace(project?.path)
          : await api.mcp.restartAll(project?.path));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
      return;
    }
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
    if (result.conversation.isSubagent) {
      setSubagents((state) => upsertById(state, result.conversation));
    } else if (result.conversation.isSideChat) {
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
    if (result.conversation.isSubagent) {
      setSubagents((state) => upsertById(state, result.conversation));
    } else if (result.conversation.isSideChat) {
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
    setAuxiliaryPanelVisible(true);
    setActiveAuxiliaryTab(result.conversation.id);
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
    if (activeAuxiliaryTab === id) {
      const nextTab = remaining[Math.min(index, remaining.length - 1)]?.id
        ?? (subagents.length > 0 ? 'subagents' : null);
      setActiveAuxiliaryTab(nextTab);
      if (!nextTab) setAuxiliaryPanelVisible(false);
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
        for (const subagent of subagents) delete copy[subagent.id];
      }
      return copy;
    });
    if (selectedId === id) {
      setSideChats([]);
      setSubagents([]);
      setActiveAuxiliaryTab(null);
      setActiveSubagentId(null);
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
    if (conversation.isSubagent) {
      setSubagents((state) => upsertById(state, conversation));
    } else if (conversation.isSideChat) {
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
      if (conversation.isSubagent) {
        setSubagents((state) => upsertById(state, conversation));
      } else if (conversation.isSideChat) {
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
          key={`${settingsInitialView ?? 'providers'}:${settingsContextFolder?.path ?? ''}`}
          providers={providers}
          initialContextFolder={settingsContextFolder}
          initialView={settingsInitialView}
          onClose={() => {
            setSettingsContextFolder(null);
            setSettingsInitialView(null);
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
              setSettingsInitialView(contextFolder ? 'context-folder' : null);
              setSettingsOpen(true);
            }}
            collapsed={effectiveSidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          />
          <div
            className={`chat-workspace${auxiliaryPanelVisible ? ' with-auxiliary-panel' : ''}`}
          >
            <ChatView
              {...shell}
              currentProject={currentProject}
              models={models}
              favorites={favorites}
              onSend={sendMessage}
              onStop={stopConversation}
              onCompress={compressConversation}
              onCreateSideChat={currentConversation ? createSideChat : undefined}
              subagents={subagentsWithStatus}
              onOpenSubagents={() => {
                setAuxiliaryPanelVisible(true);
                setActiveSubagentId(null);
                setActiveAuxiliaryTab('subagents');
              }}
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
            {!auxiliaryPanelVisible && (
              <button
                className="auxiliary-panel-toggle"
                type="button"
                aria-label="Open auxiliary panel"
                title="Open auxiliary panel"
                onClick={() => {
                  setActiveSubagentId(null);
                  setActiveAuxiliaryTab((current) => (
                    sideChats.some((sideChat) => sideChat.id === current)
                    || (current === 'subagents' && subagents.length > 0)
                      ? current
                      : sideChats[0]?.id ?? (subagents.length > 0 ? 'subagents' : null)
                  ));
                  setAuxiliaryPanelVisible(true);
                }}
              >
                <PanelRightOpen size={17} />
              </button>
            )}
            {auxiliaryPanelVisible && (
              <AuxiliaryPanel
                sideChats={sideChats}
                subagents={subagentsWithStatus}
                activeTab={activeAuxiliaryTab}
                activeSubagentId={activeSubagentId}
                messagesByConversation={messagesByConversation}
                running={running}
                models={models}
                favorites={favorites}
                recentModels={shell.recentModels}
                recentProjects={recentProjects}
                fallbackModel={currentModel}
                canCreateSideChat={Boolean(currentConversation)}
                onSelectTab={async (tabId) => {
                  setActiveAuxiliaryTab(tabId);
                  if (tabId === 'subagents') {
                    setActiveSubagentId(null);
                  } else if (!messagesByConversation[tabId]) {
                    const messages = await api.conversations.messages(tabId);
                    setMessagesByConversation((state) => ({ ...state, [tabId]: messages }));
                  }
                }}
                onCloseSideChat={closeSideChat}
                onCloseSubagentsTab={() => {
                  setActiveSubagentId(null);
                  const nextTab = sideChats[0]?.id ?? null;
                  setActiveAuxiliaryTab(nextTab);
                  if (!nextTab) setAuxiliaryPanelVisible(false);
                }}
                onClosePanel={() => setAuxiliaryPanelVisible(false)}
                onCreateSideChat={createSideChat}
                onSelectSubagent={async (id) => {
                  setActiveSubagentId(id);
                  if (id && !messagesByConversation[id]) {
                    const messages = await api.conversations.messages(id);
                    setMessagesByConversation((state) => ({ ...state, [id]: messages }));
                  }
                }}
                onSend={(thread, model, payload) => sendMessage({
                  ...payload,
                  conversationId: thread.id,
                  model,
                  project: {
                    path: thread.projectPath,
                    name: thread.projectName,
                    displayPath: thread.projectDisplayPath,
                    gitBranch: thread.gitBranch,
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
      <McpOverlay
        state={mcpState}
        waitingCount={Object.values(mcpWaiting).filter(Boolean).length}
        alert={mcpAlert}
        workspaceServers={mcpWorkspaceServers}
        onCloseAlert={() => setMcpAlert(null)}
        onCloseWorkspace={() => setMcpWorkspaceServers(null)}
        onAuthenticate={async (serverKey) => {
          try {
            await api.mcp.authenticate(serverKey);
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
          }
        }}
        onDisable={async (serverKey) => {
          try {
            await api.mcp.enabled({ serverKey, enabled: false });
            setMcpAlert(advanceMcpAuthAlert);
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
          }
        }}
        onOpenSettings={() => {
          setMcpAlert(null);
          setMcpWorkspaceServers(null);
          setSettingsContextFolder(null);
          setSettingsInitialView('mcp');
          setSettingsOpen(true);
        }}
      />
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

function advanceMcpAuthAlert(current) {
  const [server, ...authQueue] = current?.authQueue ?? [];
  if (server) {
    return {
      ...current,
      server,
      authQueue,
    };
  }
  return current?.pendingFailures?.length > 0
    ? { type: 'failure', servers: current.pendingFailures }
    : null;
}
