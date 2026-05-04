import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { LoginView } from './components/LoginView.jsx';
import { AccountDialog } from './components/AccountDialog.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { WindowControls } from './components/WindowControls.jsx';
import { WorkspaceDialog } from './components/WorkspaceDialog.jsx';
import { WorkspaceView } from './components/WorkspaceView.jsx';

const api = window.aivax;

export default function App() {
  const [session, setSession] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [running, setRunning] = useState({});
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [workspaceState, setWorkspaceState] = useState({ activeWorkspaceId: null, workspaces: [] });
  const [uploadQueue, setUploadQueue] = useState({ running: false, currentId: null, items: [] });
  const [mainView, setMainView] = useState('chat');
  const [workspaceAttachments, setWorkspaceAttachments] = useState(null);
  const [error, setError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [narrowWindow, setNarrowWindow] = useState(false);
  const [draftModel, setDraftModel] = useState('');

  const currentConversation = conversations.find((item) => item.id === selectedId) ?? null;
  const currentMessages = messagesByConversation[selectedId] ?? [];
  const currentModel = currentConversation?.model || draftModel || session?.lastModel || models[0]?.id || '';
  const isLoggedIn = Boolean(session?.accessToken);

  useEffect(() => {
    api.auth.session().then(async (nextSession) => {
      setSession(nextSession);
      if (nextSession.accessToken) {
        await refreshShell();
        await refreshWorkspaces();
        refreshModels();
      }
    });
  }, []);

  useEffect(() => {
    return api.onChatEvent((event) => {
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
      } else if (event.type === 'debug') {
        console.log('[AIVAX debug]', event);
      } else if (event.type === 'workspaces') {
        setWorkspaceState(event.state);
      } else if (event.type === 'workspace-uploads') {
        setUploadQueue(event.state);
      }
    });
  }, []);

  useEffect(() => {
    const syncSidebarWidth = () => setNarrowWindow(window.innerWidth < 700);
    syncSidebarWidth();
    window.addEventListener('resize', syncSidebarWidth);
    return () => window.removeEventListener('resize', syncSidebarWidth);
  }, []);

  async function refreshShell() {
    const next = await api.conversations.list();
    setConversations(next);
    if (!selectedId && next[0]) {
      setSelectedId(next[0].id);
      const messages = await api.conversations.messages(next[0].id);
      setMessagesByConversation((state) => ({ ...state, [next[0].id]: messages }));
    }
  }

  async function refreshModels() {
    try {
      const [nextModels, nextFavorites] = await Promise.all([
        api.models.list(),
        api.models.favorites(),
      ]);
      setModels(nextModels);
      setFavorites(nextFavorites);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshWorkspaces() {
    setWorkspaceState(await api.workspaces.list());
    setUploadQueue(await api.workspaceUploads.snapshot());
  }

  async function handleLogin(loginKey) {
    const nextSession = await api.auth.login(loginKey);
    setSession(nextSession);
    await refreshShell();
    await refreshWorkspaces();
    await refreshModels();
  }

  async function handleLogout() {
    const nextSession = await api.auth.logout();
    setSession(nextSession);
    setConversations([]);
    setSelectedId(null);
    setMessagesByConversation({});
    setAccountOpen(false);
    setWorkspaceDialogOpen(false);
    setWorkspaceState({ activeWorkspaceId: null, workspaces: [] });
    setMainView('chat');
  }

  async function selectConversation(id) {
    setSelectedId(id);
    setMainView('chat');
    if (!messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  }

  async function newChat() {
    setSelectedId(null);
    setMainView('chat');
  }

  async function sendMessage({ text, attachments, steer = false }) {
    if (!text.trim() && attachments.length === 0) return;
    const result = await api.chat.send({
      conversationId: selectedId,
      model: currentModel,
      text,
      attachments,
      steer,
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
    setMainView('chat');
  }

  async function stopConversation() {
    if (selectedId) {
      await api.chat.stop(selectedId);
      setRunning((state) => ({ ...state, [selectedId]: false }));
    }
  }

  async function retryAssistantMessage(messageId) {
    if (!selectedId || !messageId) return;
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

  function attachWorkspaceItems(attachments) {
    setWorkspaceAttachments({ id: crypto.randomUUID(), attachments });
    setMainView('chat');
  }

  async function toggleFavorite(modelId) {
    const next = await api.models.favorite({
      modelId,
      favorited: !favorites.includes(modelId),
    });
    setFavorites(next);
  }

  const account = session?.account;
  const effectiveSidebarCollapsed = sidebarCollapsed || narrowWindow;
  const shellClassName = [
    'app-shell',
    session?.platform && `platform-${session.platform}`,
    effectiveSidebarCollapsed && 'sidebar-collapsed',
  ]
    .filter(Boolean)
    .join(' ');
  const shell = useMemo(() => ({
    conversations,
    currentConversation,
    currentMessages,
    currentModel,
    isRunning: Boolean(selectedId && running[selectedId]),
  }), [conversations, currentConversation, currentMessages, currentModel, running, selectedId]);

  if (!session) {
    return <div className="app-shell" />;
  }

  if (!isLoggedIn) {
    return (
      <div className={shellClassName}>
        <WindowControls />
        <LoginView onLogin={handleLogin} error={error} setError={setError} />
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <WindowControls />
      <Sidebar
        conversations={conversations}
        selectedId={selectedId}
        account={account}
        running={running}
        onNewChat={newChat}
        onSelect={selectConversation}
        onSearch={() => setSearchOpen(true)}
        onFork={forkConversation}
        onDelete={deleteConversation}
        onAccount={() => setAccountOpen(true)}
        onSwitchWorkspace={() => setWorkspaceDialogOpen(true)}
        onLogout={handleLogout}
        onWorkspace={() => setMainView('workspace')}
        activeWorkspaceId={workspaceState.activeWorkspaceId}
        collapsed={effectiveSidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      {mainView === 'workspace' && workspaceState.activeWorkspaceId ? (
        <WorkspaceView
          workspaceId={workspaceState.activeWorkspaceId}
          uploadQueue={uploadQueue}
          onUploadQueueChange={setUploadQueue}
          onAttachToChat={attachWorkspaceItems}
        />
      ) : (
        <ChatView
          {...shell}
          models={models}
          favorites={favorites}
          activeWorkspaceId={workspaceState.activeWorkspaceId}
          workspaceAttachments={workspaceAttachments}
          onSend={sendMessage}
          onStop={stopConversation}
          onFork={forkConversation}
          onRetry={retryAssistantMessage}
          onCancelQueued={cancelQueuedMessage}
          onSendContinuation={(text) => sendMessage({ text, attachments: [] })}
          onChooseModel={chooseModel}
          onToggleFavorite={toggleFavorite}
          onRefreshModels={refreshModels}
        />
      )}
      {accountOpen && (
        <AccountDialog
          account={account}
          onClose={() => setAccountOpen(false)}
          onLogout={handleLogout}
        />
      )}
      {searchOpen && (
        <SearchDialog
          onClose={() => setSearchOpen(false)}
          onSelect={selectConversation}
        />
      )}
      {workspaceDialogOpen && (
        <WorkspaceDialog
          workspaceState={workspaceState}
          onClose={() => setWorkspaceDialogOpen(false)}
          onChange={(state) => {
            setWorkspaceState(state);
            if (!state.activeWorkspaceId && mainView === 'workspace') {
              setMainView('chat');
            }
          }}
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
