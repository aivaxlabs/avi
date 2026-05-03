import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { LoginView } from './components/LoginView.jsx';
import { ModelPicker } from './components/ModelPicker.jsx';
import { AccountDialog } from './components/AccountDialog.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { WindowControls } from './components/WindowControls.jsx';

const api = window.aivax;

export default function App() {
  const [session, setSession] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [running, setRunning] = useState({});
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');

  const currentConversation = conversations.find((item) => item.id === selectedId) ?? null;
  const currentMessages = messagesByConversation[selectedId] ?? [];
  const currentModel = currentConversation?.model || session?.lastModel || models[0]?.id || '';
  const isLoggedIn = Boolean(session?.accessToken);

  useEffect(() => {
    api.auth.session().then(async (nextSession) => {
      setSession(nextSession);
      if (nextSession.accessToken) {
        await refreshShell();
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
        setRunning((state) => ({
          ...state,
          [event.conversationId]: event.message.role === 'assistant' && event.message.status === 'streaming',
        }));
      } else if (event.type === 'conversation') {
        setConversations((state) => upsertById(state, event.conversation).sort(sortByUpdatedAt));
      } else if (event.type === 'run-state') {
        setRunning((state) => ({ ...state, [event.conversationId]: event.running }));
      } else if (event.type === 'error') {
        setError(event.message);
      }
    });
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

  async function handleLogin(loginKey) {
    const nextSession = await api.auth.login(loginKey);
    setSession(nextSession);
    await refreshShell();
    await refreshModels();
  }

  async function handleLogout() {
    const nextSession = await api.auth.logout();
    setSession(nextSession);
    setConversations([]);
    setSelectedId(null);
    setMessagesByConversation({});
    setAccountOpen(false);
  }

  async function selectConversation(id) {
    setSelectedId(id);
    if (!messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  }

  async function newChat() {
    const conversation = await api.conversations.create({
      model: currentModel || models[0]?.id || '',
    });
    setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
    setSelectedId(conversation.id);
    setMessagesByConversation((state) => ({ ...state, [conversation.id]: [] }));
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
  }

  async function stopConversation() {
    if (selectedId) {
      await api.chat.stop(selectedId);
      setRunning((state) => ({ ...state, [selectedId]: false }));
    }
  }

  async function forkConversation(id = selectedId) {
    if (!id) return;
    const result = await api.conversations.fork(id);
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
      const conversation = await api.conversations.create({ model: modelId });
      setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
      setSelectedId(conversation.id);
      setMessagesByConversation((state) => ({ ...state, [conversation.id]: [] }));
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

  const account = session?.account;
  const shellClassName = ['app-shell', session?.platform && `platform-${session.platform}`]
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
      />
      <ChatView
        {...shell}
        models={models}
        onSend={sendMessage}
        onStop={stopConversation}
        onFork={forkConversation}
        onOpenModelPicker={() => setModelPickerOpen(true)}
      />
      {modelPickerOpen && (
        <ModelPicker
          models={models}
          favorites={favorites}
          currentModel={currentModel}
          onClose={() => setModelPickerOpen(false)}
          onChoose={chooseModel}
          onToggleFavorite={toggleFavorite}
          onRefresh={refreshModels}
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
