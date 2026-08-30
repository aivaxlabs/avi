import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PanelRightOpen, ShieldAlert } from 'lucide-react';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatView } from './components/ChatView.jsx';
import { SearchDialog } from './components/SearchDialog.jsx';
import { SettingsPage } from './components/SettingsPage.jsx';
import { McpOverlay } from './components/McpOverlay.jsx';
import { OrchestrationPage } from './components/OrchestrationPage.jsx';
import { AuxiliaryPanel } from './components/AuxiliaryPanel.jsx';
import { BotSettingsDialog } from './components/BotSettingsDialog.jsx';
import { PanelResizer } from './components/PanelResizer.jsx';
import {
  applyTheme,
  onSystemSchemeChange,
  readAppearance,
  resolvedScheme,
  saveAppearance,
} from './lib/apply-theme.js';
import { getTheme, setPluginThemes, themes } from './lib/themes.js';

const api = window.chatApp;
const sidebarWidthStorageKey = 'aivax.layout.sidebar-width';
const auxiliaryPanelWidthStorageKey = 'aivax.layout.auxiliary-panel-width';
const savedSidebarWidth = Number(window.localStorage.getItem(sidebarWidthStorageKey));
const savedAuxiliaryPanelWidth = Number(
  window.localStorage.getItem(auxiliaryPanelWidthStorageKey),
);
window.localStorage.removeItem('aivax.composer.work-mode');
window.localStorage.removeItem('aivax.composer.ultra-mode');
const minimumAuxiliaryPanelWidth = 280;
const minimumMainContentWidth = 320;
const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const initialSidebarWidth = Number.isFinite(savedSidebarWidth) && savedSidebarWidth > 0
  ? Math.max(180, Math.min(420, savedSidebarWidth))
  : 222;
const initialAuxiliaryPanelWidthMax = Math.max(
  minimumAuxiliaryPanelWidth,
  window.innerWidth - initialSidebarWidth - minimumMainContentWidth,
);
const initialAuxiliaryPanelWidth = Number.isFinite(savedAuxiliaryPanelWidth)
  && savedAuxiliaryPanelWidth > 0
  ? Math.max(
      minimumAuxiliaryPanelWidth,
      Math.min(initialAuxiliaryPanelWidthMax, savedAuxiliaryPanelWidth),
    )
  : Math.max(
      minimumAuxiliaryPanelWidth,
      Math.min(
        initialAuxiliaryPanelWidthMax,
        Math.round((window.innerWidth - initialSidebarWidth) * 0.42),
      ),
    );

function useStableCallback(callback) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args) => callbackRef.current(...args), []);
}

function useVisibleConversationRecord(conversationIds, record, fallbackValue) {
  const previousRef = useRef(emptyObject);
  const visibleRecord = useMemo(() => {
    const previous = previousRef.current;
    const next = Object.fromEntries(conversationIds.map((conversationId) => [
      conversationId,
      record[conversationId] ?? fallbackValue,
    ]));
    return Object.keys(previous).length === conversationIds.length
      && conversationIds.every((conversationId) => (
        previous[conversationId] === next[conversationId]
      ))
      ? previous
      : next;
  }, [conversationIds, fallbackValue, record]);
  useEffect(() => {
    previousRef.current = visibleRecord;
  }, [visibleRecord]);
  return visibleRecord;
}

function useVisibleConversationItems(conversationIds, items) {
  const previousRef = useRef(emptyList);
  const visibleItems = useMemo(() => {
    const conversationIdSet = new Set(conversationIds);
    const next = items.filter((item) => conversationIdSet.has(item.conversationId));
    return previousRef.current.length === next.length
      && previousRef.current.every((item, index) => item === next[index])
      ? previousRef.current
      : next;
  }, [conversationIds, items]);
  useEffect(() => {
    previousRef.current = visibleItems;
  }, [visibleItems]);
  return visibleItems;
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

export default function App() {
  const [appState, setAppState] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [providers, setProviders] = useState([]);
  const [providerTypes, setProviderTypes] = useState([]);
  const [models, setModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [running, setRunning] = useState({});
  const [runStartedAt, setRunStartedAt] = useState({});
  const [completedUnseen, setCompletedUnseen] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const [settingsContextFolder, setSettingsContextFolder] = useState(null);
  const [settingsInitialView, setSettingsInitialView] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState('');
  const [conversationErrors, setConversationErrors] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [auxiliaryPanelWidth, setAuxiliaryPanelWidth] = useState(
    initialAuxiliaryPanelWidth,
  );
  const [draftModel, setDraftModel] = useState('');
  const [draftProject, setDraftProject] = useState(null);
  const [sideChats, setSideChats] = useState([]);
  const [subagents, setSubagents] = useState([]);
  const [rubberDucks, setRubberDucks] = useState([]);
  const [bots, setBots] = useState([]);
  const [botWorkStateByBot, setBotWorkStateByBot] = useState({});
  const [botSchedulerSnooze, setBotSchedulerSnooze] = useState({
    active: false,
    mode: null,
    until: null,
  });
  const [botSettingsTarget, setBotSettingsTarget] = useState(null);
  const [botQueueTabOpen, setBotQueueTabOpen] = useState(false);
  const [selectedBotLogId, setSelectedBotLogId] = useState('');
  const [tasksByConversation, setTasksByConversation] = useState({});
  const [providerPanels, setProviderPanels] = useState([]);
  const [openProviderPanelIds, setOpenProviderPanelIds] = useState([]);
  const [filesTabOpen, setFilesTabOpen] = useState(false);
  const [gitReviewTabOpen, setGitReviewTabOpen] = useState(false);
  const [subagentsTabOpen, setSubagentsTabOpen] = useState(false);
  const [tasksTabOpen, setTasksTabOpen] = useState(false);
  const [auxiliaryPanelVisible, setAuxiliaryPanelVisible] = useState(false);
  const [activeAuxiliaryTab, setActiveAuxiliaryTab] = useState(null);
  const [activeSubagentId, setActiveSubagentId] = useState(null);
  const [pendingComposerAttachment, setPendingComposerAttachment] = useState(null);
  const [pendingSideChatAttachment, setPendingSideChatAttachment] = useState(null);
  const [fileNavigation, setFileNavigation] = useState(null);
  const [mcpState, setMcpState] = useState(null);
  const [mcpWaiting, setMcpWaiting] = useState({});
  const [mcpAlert, setMcpAlert] = useState(null);
  const [mcpWorkspaceServers, setMcpWorkspaceServers] = useState(null);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [approvalResolving, setApprovalResolving] = useState(false);
  const [questionRequests, setQuestionRequests] = useState([]);
  const [semaphoreWaits, setSemaphoreWaits] = useState([]);
  const [semaphoreResolving, setSemaphoreResolving] = useState(false);
  const [goalPreparations, setGoalPreparations] = useState({});
  const [workMode, setWorkMode] = useState(null);
  const [ultraMode, setUltraMode] = useState(false);
  const approvalDialogRef = useRef(null);
  const inspectedConversationIdRef = useRef(null);
  const selectedConversationIdRef = useRef(null);

  inspectedConversationIdRef.current = settingsOpen || orchestrationOpen ? null : selectedId;
  selectedConversationIdRef.current = selectedId;

  const selectedBot = bots.find((bot) => bot.conversationId === selectedId) ?? null;
  const currentConversation = conversations.find((item) => item.id === selectedId)
    ?? selectedBot?.conversation
    ?? null;
  const currentMessages = messagesByConversation[selectedId] ?? emptyList;
  const currentProject = useMemo(() => (currentConversation
    ? {
        path: currentConversation.projectPath,
        name: currentConversation.projectName,
        displayPath: currentConversation.projectDisplayPath,
        gitBranch: currentConversation.gitBranch,
      }
    : draftProject ?? appState?.defaultProject ?? null), [
    appState?.defaultProject,
    currentConversation,
    draftProject,
  ]);
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
      selectedBot?.model,
      draftModel,
      currentConversation?.model,
      appState?.lastModel,
      models[0]?.id,
    ].find((modelId) => modelId && configuredModelIds.has(modelId)) ?? '';
  }, [appState?.lastModel, currentConversation?.model, draftModel, models, selectedBot?.model]);
  const currentModelContextLimit = models
    .find((model) => model.id === currentModel)
    ?.context.input ?? null;
  const contextUsage = useMemo(() => ({
    tokens: currentConversation?.contextTokens ?? 0,
    limit: selectedBot?.contextSize > 0
      ? selectedBot.contextSize
      : currentModelContextLimit,
  }), [currentConversation?.contextTokens, currentModelContextLimit, selectedBot?.contextSize]);
  const visibleSubagents = useMemo(() => [
    ...subagents.filter((subagent) => subagent.parentConversationId === selectedId),
    ...rubberDucks,
  ], [rubberDucks, selectedId, subagents]);
  const auxiliaryConversationIds = useMemo(() => [
    ...sideChats.map((sideChat) => sideChat.id),
    ...visibleSubagents.map((subagent) => subagent.id),
  ], [sideChats, visibleSubagents]);
  const auxiliaryMessagesByConversation = useVisibleConversationRecord(
    auxiliaryConversationIds,
    messagesByConversation,
    emptyList,
  );
  const auxiliaryRunning = useVisibleConversationRecord(
    auxiliaryConversationIds,
    running,
    false,
  );
  const auxiliaryQuestionRequests = useVisibleConversationItems(
    auxiliaryConversationIds,
    questionRequests,
  );
  const auxiliarySemaphoreWaits = useVisibleConversationItems(
    auxiliaryConversationIds,
    semaphoreWaits,
  );
  const subagentsWithStatus = useMemo(() => visibleSubagents.map((subagent) => {
    const messages = auxiliaryMessagesByConversation[subagent.id] ?? emptyList;
    const lastUserIndex = messages.findLastIndex((message) => message.role === 'user');
    const lastAssistant = messages
      .slice(lastUserIndex + 1)
      .findLast((message) => message.role === 'assistant');
    let status = 'waiting';
    if (auxiliarySemaphoreWaits.some((wait) => wait.conversationId === subagent.id)) {
      status = 'sleeping';
    } else if (auxiliaryRunning[subagent.id]) {
      status = 'working';
    } else if (lastAssistant?.status === 'completed') {
      status = 'finished';
    } else if (['error', 'aborted', 'streaming'].includes(lastAssistant?.status)) {
      status = 'failed';
    }
    return { ...subagent, status };
  }), [
    auxiliaryMessagesByConversation,
    auxiliaryRunning,
    auxiliarySemaphoreWaits,
    visibleSubagents,
  ]);
  const openProviderPanels = useMemo(() => providerPanels.filter(
    (panel) => openProviderPanelIds.includes(panel.id),
  ), [openProviderPanelIds, providerPanels]);
  const [appearance, setAppearance] = useState(readAppearance);
  const [appearanceReady, setAppearanceReady] = useState(false);
  const [chatBackgroundUrl, setChatBackgroundUrl] = useState(null);

  useEffect(() => {
    applyTheme(appearance);
    if (appearanceReady) saveAppearance(appearance);
  }, [appearance, appearanceReady]);

  useEffect(() => {
    let active = true;
    if (!appearance.backgroundFile) {
      setChatBackgroundUrl(null);
      return undefined;
    }
    api.appearance.background(appearance.backgroundFile)
      .then((url) => {
        if (active) setChatBackgroundUrl(url);
      })
      .catch(() => {
        if (active) setChatBackgroundUrl(null);
      });
    return () => {
      active = false;
    };
  }, [appearance.backgroundFile]);

  useEffect(() => onSystemSchemeChange(() => {
    setAppearance((current) => (current.scheme === 'system' ? { ...current } : current));
  }), []);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.app.state(),
      api.conversations.list(),
      api.providers.list(),
      api.providers.types(),
      api.models.list(),
      api.models.favorites(),
      api.mcp.state(),
      api.chat.state(),
      api.plugins.restoreReload(),
    ])
      .then(async ([
        nextAppState,
        nextConversations,
        nextProviders,
        nextProviderTypes,
        nextModels,
        nextFavorites,
        nextMcpState,
        nextChatState,
        restoredReload,
      ]) => {
        if (!active) return;
        setPluginThemes(nextAppState.pluginCatalog?.themes);
        setAppearance(readAppearance());
        setAppearanceReady(true);
        setAppState(nextAppState);
        const startupErrors = [
          ...(nextAppState.defaultModelWarnings ?? []).map((warning) => warning.message),
          ...(nextAppState.pluginFailures ?? []).map((failure) => (
            `${failure.id || failure.fileName || 'Plugin'} failed to load: ${failure.error}`
          )),
        ];
        if (startupErrors.length) setError(startupErrors.join(' '));
        setConversations(nextConversations);
        setProviders(nextProviders);
        setProviderTypes(nextProviderTypes);
        setModels(nextModels);
        setFavorites(nextFavorites);
        setMcpState(nextMcpState);
        setSemaphoreWaits(nextChatState.semaphoreWaits ?? []);
        if (restoredReload) {
          const restoredMessages = await Promise.all(restoredReload.conversationIds.map(async (id) => (
            [id, await api.conversations.messages(id)]
          )));
          if (!active) return;
          setMessagesByConversation((current) => Object.fromEntries([
            ...Object.entries(current),
            ...restoredMessages.map(([id, messages]) => [
              id,
              (current[id] ?? []).reduce(
                (items, message) => upsertMessage(items, message),
                messages,
              ),
            ]),
          ]));
          const completedReload = await api.plugins.completeReload();
          if (!active || !completedReload) return;
          setRunning(Object.fromEntries(
            completedReload.conversationIds.map((conversationId) => [conversationId, true]),
          ));
          setRunStartedAt(completedReload.runsStartedAt ?? {});
          setApprovalRequests(completedReload.approvals);
          setQuestionRequests(completedReload.questions);
          setSemaphoreWaits(completedReload.semaphoreWaits ?? restoredReload.semaphoreWaits ?? []);
        }
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
          const initialConversation = nextConversations[0];
          setDraftModel(initialConversation.model);
          if (selectedConversationIdRef.current === null) {
            selectedConversationIdRef.current = initialConversation.id;
            setSelectedId(initialConversation.id);
          }
          const messages = await api.conversations.messages(initialConversation.id);
          if (!active) return;
          setMessagesByConversation((state) => ({
            ...state,
            [initialConversation.id]: (state[initialConversation.id] ?? []).reduce(
              (items, message) => upsertMessage(items, message),
              messages,
            ),
          }));
        }
        await api.goals.resume();
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

  const refreshBots = useCallback(async () => {
    try {
      const state = await api.bots.list();
      setBots(state.bots ?? []);
      setBotWorkStateByBot(state.workStateByBot ?? {});
      setBotSchedulerSnooze(state.schedulerSnooze ?? {
        active: false,
        mode: null,
        until: null,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, []);

  useEffect(() => {
    void refreshBots();
    return api.onBotsEvent(() => {
      void refreshBots();
    });
  }, [refreshBots]);

  useEffect(() => {
    if (!selectedId || settingsOpen || orchestrationOpen) return;
    setCompletedUnseen((state) => {
      if (!state[selectedId]) return state;
      const next = { ...state };
      delete next[selectedId];
      return next;
    });
  }, [orchestrationOpen, selectedId, settingsOpen]);

  useEffect(() => {
    if (
      workMode === 'plan'
      && currentConversation?.goal
      && ['active', 'paused'].includes(currentConversation.goal.status)
    ) {
      changeWorkMode(null, currentConversation.id);
    }
  }, [currentConversation?.goal?.status, currentConversation?.id, workMode]);

  useEffect(() => api.app.onNavigate(async ({ view, conversationId, project, draftText }) => {
    setOrchestrationOpen(false);
    setSearchOpen(false);
    if (view === 'new-conversation') {
      window.localStorage.setItem('aivax.composer.draft', String(draftText ?? ''));
      setSettingsContextFolder(null);
      setSettingsInitialView(null);
      setSettingsOpen(false);
      setDraftProject(project ?? appState?.defaultProject ?? null);
      selectedConversationIdRef.current = null;
      setSelectedId(null);
      return;
    }
    if (view === 'settings') {
      setSettingsContextFolder(null);
      setSettingsInitialView(null);
      setSettingsOpen(true);
      return;
    }
    if (view !== 'conversation' || !conversationId) return;
    const nextConversations = await api.conversations.list();
    const conversation = nextConversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    setConversations(nextConversations.map((item) => (
      item.id === conversationId ? { ...item, needsAttention: false } : item
    )));
    setCompletedUnseen((state) => {
      if (!state[conversationId]) return state;
      const next = { ...state };
      delete next[conversationId];
      return next;
    });
    setSettingsOpen(false);
    if (conversation.model) setDraftModel(conversation.model);
    inspectedConversationIdRef.current = conversationId;
    selectedConversationIdRef.current = conversationId;
    setSelectedId(conversationId);
    const messages = await api.conversations.messages(conversationId);
    setMessagesByConversation((state) => ({ ...state, [conversationId]: messages }));
  }), []);

  useEffect(() => (
    api.onChatEvent((event) => {
      if (event.type === 'message') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: upsertMessage(state[event.conversationId] ?? [], event.message),
        }));
        if (event.message.role === 'assistant') {
          const isRunning = event.message.status === 'streaming';
          setRunning((state) => (
            state[event.conversationId] === isRunning
              ? state
              : { ...state, [event.conversationId]: isRunning }
          ));
        }
        if (
          ['assistant', 'user'].includes(event.message.role)
          && !['queued', 'steered'].includes(event.message.status)
        ) {
          const needsAttention = !event.message.stoppedByUser && (
            ['error', 'aborted'].includes(event.message.status)
            || event.message.status === 'streaming'
            || event.message.role === 'user'
          );
          setConversations((state) => {
            const conversation = state.find((item) => item.id === event.conversationId);
            if (!conversation || conversation.needsAttention === needsAttention) return state;
            return state.map((item) => (
              item.id === event.conversationId ? { ...item, needsAttention } : item
            ));
          });
        }
      } else if (event.type === 'block-state') {
        setConversations((state) => state.map((conversation) => (
          conversation.id === event.conversationId
            ? { ...conversation, workStatus: event.blocked ? 'blocked' : null }
            : conversation
        )));
      } else if (event.type === 'conversation') {
        if (event.conversation.isBot) {
          void refreshBots();
        } else if (event.conversation.isSubagent) {
          if (event.conversation.parentConversationId === selectedConversationIdRef.current) {
            setSubagents((state) => upsertById(state, event.conversation));
          }
        } else if (event.conversation.isRubberDuck) {
          setRubberDucks((state) => (
            state.some((rubberDuck) => rubberDuck.id === event.conversation.id)
              ? upsertById(state, event.conversation)
              : state
          ));
        } else if (event.conversation.isSideChat) {
          setSideChats((state) => (
            state.some((sideChat) => sideChat.id === event.conversation.id)
              ? upsertById(state, event.conversation)
              : state
          ));
        } else {
          setConversations((state) => {
            const current = state.find((conversation) => conversation.id === event.conversation.id);
            if (
              current
              && Object.keys(current).length === Object.keys(event.conversation).length
              && Object.entries(current).every(([key, value]) => {
                const nextValue = event.conversation[key];
                return value === nextValue || (
                  Array.isArray(value)
                  && Array.isArray(nextValue)
                  && value.length === nextValue.length
                  && value.every((item, index) => item === nextValue[index])
                );
              })
            ) {
              return state;
            }
            return upsertById(state, event.conversation).sort(sortByUpdatedAt);
          });
        }
      } else if (event.type === 'subagent-created') {
        if (
          event.conversationId === selectedConversationIdRef.current
          && event.subagent.parentConversationId === selectedConversationIdRef.current
        ) {
          setSubagents((state) => upsertById(state, event.subagent));
          setSubagentsTabOpen(true);
        }
      } else if (event.type === 'rubber-duck-created') {
        if (event.rootConversationId === selectedConversationIdRef.current) {
          setRubberDucks((state) => upsertById(state, event.rubberDuck));
          setSubagentsTabOpen(true);
          setAuxiliaryPanelVisible(true);
        }
      } else if (event.type === 'tasks') {
        setTasksByConversation((state) => ({ ...state, [event.conversationId]: event.tasks }));
        if (event.conversationId === selectedConversationIdRef.current) {
          setTasksTabOpen(event.tasks.length > 0);
        }
      } else if (event.type === 'message-delete') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: (state[event.conversationId] ?? [])
            .filter((message) => message.id !== event.messageId),
        }));
      } else if (event.type === 'queue-order') {
        setMessagesByConversation((state) => ({
          ...state,
          [event.conversationId]: applyPendingOrder(
            state[event.conversationId] ?? [],
            event,
          ),
        }));
      } else if (event.type === 'run-state') {
        setRunning((state) => (
          state[event.conversationId] === event.running
            ? state
            : { ...state, [event.conversationId]: event.running }
        ));
        setRunStartedAt((state) => {
          if (!event.running || !Number.isFinite(event.startedAt)) {
            if (!(event.conversationId in state)) return state;
            const next = { ...state };
            delete next[event.conversationId];
            return next;
          }
          return { ...state, [event.conversationId]: event.startedAt };
        });
        if (event.stoppedByUser) {
          setConversations((state) => {
            const conversation = state.find((item) => item.id === event.conversationId);
            if (!conversation?.needsAttention) return state;
            return state.map((item) => (
              item.id === event.conversationId ? { ...item, needsAttention: false } : item
            ));
          });
          setCompletedUnseen((state) => {
            if (!state[event.conversationId]) return state;
            const next = { ...state };
            delete next[event.conversationId];
            return next;
          });
        } else if (
          !event.running
          && !event.sleeping
          && event.conversationId !== inspectedConversationIdRef.current
        ) {
          setCompletedUnseen((state) => ({ ...state, [event.conversationId]: true }));
        }
      } else if (event.type === 'semaphore-state') {
        setSemaphoreWaits(event.waits ?? []);
      } else if (event.type === 'mcp-waiting') {
        setMcpWaiting((state) => {
          if (event.waiting) {
            return { ...state, [event.conversationId]: true };
          }
          const next = { ...state };
          delete next[event.conversationId];
          return next;
        });
      } else if (event.type === 'permission-request') {
        setApprovalRequests((state) => (
          state.some((request) => request.approvalId === event.approvalId)
            ? state
            : [...state, event]
        ));
      } else if (['permission-cancelled', 'permission-resolved'].includes(event.type)) {
        setApprovalRequests((state) => state.filter(
          (request) => request.approvalId !== event.approvalId,
        ));
      } else if (event.type === 'question-request') {
        setQuestionRequests((state) => (
          state.some((request) => request.questionId === event.questionId)
            ? state
            : [...state, event]
        ));
      } else if (event.type === 'question-cancelled') {
        setQuestionRequests((state) => state.filter(
          (request) => request.questionId !== event.questionId,
        ));
      } else if (event.type === 'error') {
        setConversationErrors((state) => ({
          ...state,
          [event.conversationId]: event.message,
        }));
        if (event.conversationId !== selectedConversationIdRef.current) {
          setConversations((state) => state.map((conversation) => (
            conversation.id === event.conversationId
              ? { ...conversation, needsAttention: true }
              : conversation
          )));
        }
      }
    })
  ), []);

  const activeApprovalRequest = approvalRequests.find(
    (request) => request.conversationId === selectedId,
  ) ?? null;
  const approvalPending = useMemo(() => Object.fromEntries(
    approvalRequests.map((request) => [request.conversationId, true]),
  ), [approvalRequests]);
  const inputPending = useMemo(() => Object.fromEntries(
    questionRequests.map((request) => [request.conversationId, true]),
  ), [questionRequests]);
  const currentConversationError = selectedId ? conversationErrors[selectedId] ?? '' : '';

  useEffect(() => {
    if (!activeApprovalRequest) return undefined;
    const previousFocus = document.activeElement;
    const frame = requestAnimationFrame(() => (
      approvalDialogRef.current?.querySelector('.primary-mini, button')?.focus()
    ));
    const disallowOnEscape = (event) => {
      if (event.key !== 'Escape' || approvalResolving) return;
      event.preventDefault();
      api.chat.resolveApproval({
        approvalId: activeApprovalRequest.approvalId,
        decision: 'disallow',
      }).then((resolved) => {
        if (resolved) setApprovalRequests((state) => state.filter(
          (request) => request.approvalId !== activeApprovalRequest.approvalId,
        ));
      }).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    };
    document.addEventListener('keydown', disallowOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', disallowOnEscape);
      previousFocus?.focus?.();
    };
  }, [activeApprovalRequest, approvalResolving]);

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
    api.providers.auxiliaryPanels({
      conversationId: selectedId,
    })
      .then((panels) => {
        if (!active) return;
        setProviderPanels(panels);
        setOpenProviderPanelIds((current) => current.filter(
          (panelId) => panels.some((panel) => panel.id === panelId),
        ));
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      active = false;
    };
  }, [providers, selectedId]);

  useEffect(() => {
    let active = true;
    setSideChats([]);
    setSubagents([]);
    setRubberDucks([]);
    setSubagentsTabOpen(false);
    setTasksTabOpen(false);
    setActiveSubagentId(null);
    if (!selectedId) return undefined;

    Promise.all([
      api.sideChats.list(selectedId),
      api.subagents.list(selectedId),
      api.rubberDucks.list(selectedId),
      api.tasks.list(selectedId),
    ])
      .then(async ([nextSideChats, nextSubagents, nextRubberDucks, nextTasks]) => {
        const entries = await Promise.all(
          [...nextSideChats, ...nextSubagents, ...nextRubberDucks].map(async (childThread) => (
            [childThread.id, await api.conversations.messages(childThread.id)]
          )),
        );
        if (!active) return;
        setSideChats(nextSideChats);
        setSubagents(nextSubagents);
        setRubberDucks(nextRubberDucks);
        setSubagentsTabOpen(nextSubagents.length > 0 || nextRubberDucks.length > 0);
        setTasksByConversation((state) => ({ ...state, [selectedId]: nextTasks }));
        setTasksTabOpen(nextTasks.length > 0);
        setMessagesByConversation((state) => ({
          ...state,
          ...Object.fromEntries(entries),
        }));
        setActiveSubagentId((current) => (
          [...nextSubagents, ...nextRubberDucks].some((thread) => thread.id === current)
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
    setActiveAuxiliaryTab((current) => {
      if (
        sideChats.some((sideChat) => sideChat.id === current)
        || (current === 'files' && filesTabOpen)
        || (current === 'git-review' && gitReviewTabOpen)
        || (current === 'subagents' && subagentsTabOpen)
        || (current === 'tasks' && tasksTabOpen)
        || (current === 'bot-queue' && botQueueTabOpen)
        || openProviderPanels.some((panel) => panel.id === current)
      ) {
        return current;
      }
      return sideChats[0]?.id
        ?? (filesTabOpen ? 'files' : null)
        ?? (gitReviewTabOpen ? 'git-review' : null)
        ?? (tasksTabOpen ? 'tasks' : null)
        ?? (botQueueTabOpen ? 'bot-queue' : null)
        ?? (subagentsTabOpen ? 'subagents' : openProviderPanels[0]?.id ?? null);
    });
  }, [
    botQueueTabOpen,
    filesTabOpen,
    gitReviewTabOpen,
    openProviderPanels,
    sideChats,
    subagentsTabOpen,
    tasksTabOpen,
  ]);

  useEffect(() => {
    const syncWindowWidth = () => setWindowWidth(window.innerWidth);
    syncWindowWidth();
    window.addEventListener('resize', syncWindowWidth);
    return () => window.removeEventListener('resize', syncWindowWidth);
  }, []);

  async function selectConversation(id) {
    const conversation = conversations.find((item) => item.id === id);
    if (conversation?.model) setDraftModel(conversation.model);
    inspectedConversationIdRef.current = id;
    setConversations((state) => state.map((item) => (
      item.id === id && item.needsAttention
        ? { ...item, needsAttention: false }
        : item
    )));
    setCompletedUnseen((state) => {
      if (!state[id]) return state;
      const next = { ...state };
      delete next[id];
      return next;
    });
    selectedConversationIdRef.current = id;
    setSelectedId(id);
    if (!messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  }

  async function createBot(preset = {}) {
    try {
      const modelId = preset.modelId ?? currentModel ?? models[0]?.id;
      if (!modelId) throw new Error('Configure at least one model before creating a bot.');
      const bot = await api.bots.create({ name: 'New bot', model: modelId, ...preset });
      await refreshBots();
      setOrchestrationOpen(false);
      selectConversation(bot.conversationId);
      setBotSettingsTarget(bot.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function deleteBot(botId) {
    const bot = bots.find((item) => item.id === botId);
    if (!bot) return;
    if (!window.confirm(`Delete bot "${bot.name}"? Its conversation and pending approvals are removed. Work files stay on disk.`)) return;
    try {
      await api.bots.delete(botId);
      if (botSettingsTarget === botId) setBotSettingsTarget(null);
      if (selectedConversationIdRef.current === bot.conversationId) {
        selectedConversationIdRef.current = null;
        setSelectedId(null);
      }
      await refreshBots();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function fullResetBot(botId) {
    const bot = bots.find((item) => item.id === botId);
    if (!bot) return;
    try {
      await api.bots.fullReset(botId);
      setConversations(await api.conversations.list());
      setMessagesByConversation((state) => {
        if (!(bot.conversationId in state)) return state;
        const next = { ...state };
        delete next[bot.conversationId];
        return next;
      });
      await refreshBots();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function activateBot(botId) {
    try {
      await api.bots.activate(botId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function snoozeBots(options) {
    try {
      setBotSchedulerSnooze(await api.bots.snooze(options));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function snoozeBot(botId, options) {
    try {
      await api.bots.snoozeOne(botId, options);
      await refreshBots();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function resolveBotApproval(approvalId, decision) {
    try {
      await api.bots.resolveApproval({ approvalId, decision });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  function openBotQueueTab(botId = null) {
    if (botId) setSelectedBotLogId(botId);
    setBotQueueTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('bot-queue');
    setAuxiliaryPanelVisible(true);
  }

  function closeBotQueueTab() {
    setBotQueueTabOpen(false);
    setActiveAuxiliaryTab((current) => (current === 'bot-queue' ? null : current));
  }

  function openFileReference(reference) {
    const outsideWorkspace = reference.path.replaceAll('\\', '/').split('/').includes('..');
    if (
      outsideWorkspace
      && !window.confirm(`"${reference.path}" is outside the current repository. Continue to open it?`)
    ) return;
    setFileNavigation({
      ...reference,
      allowExternalReference: outsideWorkspace,
      id: crypto.randomUUID(),
    });
    setFilesTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('files');
    setAuxiliaryPanelVisible(true);
  }

  async function handleFileReferenceAction(action, reference, project = currentProject) {
    if (!project?.path) return;
    const outsideWorkspace = reference.path.replaceAll('\\', '/').split('/').includes('..');
    if (
      outsideWorkspace
      && !window.confirm(`"${reference.path}" is outside the current repository. Continue?`)
    ) return;
    try {
      await api.files[action === 'reveal' ? 'reveal' : 'copyPath']({
        folderPath: project.path,
        filePath: reference.path,
        allowExternalReference: outsideWorkspace,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
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
    permissionMode = window.localStorage.getItem('aivax.composer.permission-mode')
      || appState?.tuning?.defaultPermissionMode
      || 'approve_for_me',
    workMode: messageWorkMode = (
      currentConversation?.goal
      && ['active', 'paused'].includes(currentConversation.goal.status)
        ? 'goal'
        : workMode
    ),
    ultraMode: messageUltraMode = ultraMode,
  }) {
    text = text.trim();
    if (!text && attachments.length === 0) return;
    const command = attachments.length === 0 ? text.toLowerCase() : '';
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

    const targetConversation = [
      ...conversations,
      ...bots.map((bot) => bot.conversation).filter(Boolean),
      ...sideChats,
      ...subagents,
      ...rubberDucks,
    ].find((conversation) => conversation.id === conversationId);
    const activeBot = bots.find((bot) => bot.conversationId === conversationId) ?? null;
    if (activeBot) {
      model = activeBot.model;
      reasoningEffort = activeBot.reasoningEffort;
      permissionMode = 'approve_for_me';
      messageWorkMode = null;
      messageUltraMode = false;
    }
    const effectiveUltraMode = targetConversation?.isSubagent
      ? targetConversation.orchestrationMode === 'ultra'
      : !targetConversation?.isSideChat && !targetConversation?.isRubberDuck && messageUltraMode;
    if (
      messageWorkMode === 'goal'
      && !['active', 'paused'].includes(targetConversation?.goal?.status)
    ) {
      await startGoal({
        conversationId,
        model,
        project,
        specification: text,
        attachments,
        reasoningEffort,
        permissionMode,
        ultraMode: effectiveUltraMode,
      });
      return;
    }

    const selectedIdBeforeSend = selectedConversationIdRef.current;
    const result = await api.chat.send({
      conversationId,
      model,
      text,
      attachments,
      steer,
      reasoningEffort,
      permissionMode,
      workMode: messageWorkMode,
      ultraMode: effectiveUltraMode,
      project,
    });
    await api.composerState.save({
      conversationId: result.conversation.id,
      permissionMode,
      model,
      reasoningEffort,
      workMode: messageWorkMode,
      ultraMode: effectiveUltraMode,
      draftText: '',
      attachments: [],
    });
    if (result.conversation.isBot) {
      void refreshBots();
    } else if (result.conversation.isSubagent) {
      setSubagents((state) => upsertById(state, result.conversation));
    } else if (result.conversation.isRubberDuck) {
      setRubberDucks((state) => upsertById(state, result.conversation));
    } else if (result.conversation.isSideChat) {
      setSideChats((state) => upsertById(state, result.conversation));
    } else {
      setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
      if (selectedConversationIdRef.current === selectedIdBeforeSend) {
        selectedConversationIdRef.current = result.conversation.id;
        setSelectedId(result.conversation.id);
      }
    }
    setMessagesByConversation((state) => ({
      ...state,
      [result.conversation.id]: applyPendingOrder(
        upsertMessage(state[result.conversation.id] ?? [], result.message),
        result,
      ),
    }));
    if (!result.queued) {
      setRunning((state) => ({
        ...state,
        [result.conversation.id]: true,
      }));
    }
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
      permissionMode: window.localStorage.getItem('aivax.composer.permission-mode')
        || appState?.tuning?.defaultPermissionMode
        || 'approve_for_me',
    });
    if (!result?.conversation) return;
    if (result.conversation.isBot) {
      void refreshBots();
    } else if (result.conversation.isSubagent) {
      setSubagents((state) => upsertById(state, result.conversation));
    } else if (result.conversation.isRubberDuck) {
      setRubberDucks((state) => upsertById(state, result.conversation));
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
    try {
      const result = await api.chat.cancelQueued({
        conversationId,
        messageId,
      });
      setMessagesByConversation((state) => ({
        ...state,
        [conversationId]: applyPendingOrder(
          (state[conversationId] ?? [])
            .filter((message) => !result?.cancelled || message.id !== messageId),
          result,
        ),
      }));
      if (!result?.cancelled) {
        setError('The queued message changed before it could be removed.');
      }
      return Boolean(result?.cancelled);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  }

  async function resolveToolApproval(decision) {
    if (!activeApprovalRequest || approvalResolving) return;
    setApprovalResolving(true);
    try {
      const resolved = await api.chat.resolveApproval({
        approvalId: activeApprovalRequest.approvalId,
        decision,
      });
      if (resolved) setApprovalRequests((state) => state.filter(
        (request) => request.approvalId !== activeApprovalRequest.approvalId,
      ));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setApprovalResolving(false);
    }
  }

  async function changeWorkMode(nextWorkMode, conversationId = selectedId) {
    const normalizedWorkMode = ['plan', 'goal'].includes(nextWorkMode)
      ? nextWorkMode
      : null;
    const target = conversationId
      ? [...conversations, ...sideChats, ...subagents, ...rubberDucks]
        .find((conversation) => conversation.id === conversationId)
      : null;
    if (target?.isSubagent || target?.isRubberDuck) return false;
    if (
      normalizedWorkMode === 'plan'
      && target?.goal
      && ['active', 'paused'].includes(target.goal.status)
    ) {
      const stopped = await changeGoal(conversationId, 'stop');
      if (!stopped) return false;
    }
    const orchestrationMode = normalizedWorkMode === 'plan'
      ? 'plan'
      : target?.orchestrationMode === 'plan'
        ? null
        : undefined;
    if (target && !target.isSubagent && orchestrationMode !== undefined) {
      try {
        const updated = await api.conversations.update({
          id: conversationId,
          orchestrationMode,
        });
        if (updated.isSideChat) {
          setSideChats((state) => upsertById(state, updated));
        } else {
          setConversations((state) => upsertById(state, updated).sort(sortByUpdatedAt));
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        return false;
      }
    }
    setWorkMode(normalizedWorkMode);
    if (normalizedWorkMode === 'plan') setUltraMode(false);
    return true;
  }

  async function changeUltraMode(enabled, conversationId = selectedId) {
    const nextUltraMode = Boolean(enabled);
    const target = conversationId
      ? [...conversations, ...sideChats, ...subagents, ...rubberDucks]
        .find((conversation) => conversation.id === conversationId)
      : null;
    if (target?.isSubagent || target?.isRubberDuck) return false;
    if (target) {
      try {
        const updated = await api.conversations.update({
          id: conversationId,
          orchestrationMode: nextUltraMode ? 'ultra' : null,
        });
        if (updated.isSideChat) {
          setSideChats((state) => upsertById(state, updated));
        } else {
          setConversations((state) => upsertById(state, updated).sort(sortByUpdatedAt));
        }
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        return false;
      }
    }
    if (nextUltraMode) setWorkMode(null);
    setUltraMode(nextUltraMode);
    return true;
  }

  async function startGoal({
    conversationId = selectedId,
    model = currentModel,
    project = currentProject,
    specification,
    attachments = [],
    reasoningEffort = null,
    permissionMode = 'approve_for_me',
    ultraMode: goalUltraMode = ultraMode,
  }) {
    if (!model) {
      setError('Configure at least one model before starting a Goal.');
      setSettingsOpen(true);
      return false;
    }
    try {
      const selectedIdBeforeStart = selectedConversationIdRef.current;
      await changeWorkMode(null, conversationId);
      const preparationKey = conversationId ?? 'draft';
      setGoalPreparations((state) => ({
        ...state,
        [preparationKey]: { conversationId, specification },
      }));
      const result = await api.goals.start({
        conversationId,
        model,
        project,
        specification,
        attachments,
        reasoningEffort,
        permissionMode,
        ultraMode: goalUltraMode,
      });
      if (result.conversation.isSubagent) {
        setSubagents((state) => upsertById(state, result.conversation));
      } else if (result.conversation.isRubberDuck) {
        setRubberDucks((state) => upsertById(state, result.conversation));
      } else if (result.conversation.isSideChat) {
        setSideChats((state) => upsertById(state, result.conversation));
      } else {
        setConversations((state) => (
          upsertById(state, result.conversation).sort(sortByUpdatedAt)
        ));
        if (selectedConversationIdRef.current === selectedIdBeforeStart) {
          selectedConversationIdRef.current = result.conversation.id;
          setSelectedId(result.conversation.id);
        }
      }
      if (!result.queued) {
        setRunning((state) => ({
          ...state,
          [result.conversation.id]: true,
        }));
      }
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    } finally {
      const preparationKey = conversationId ?? 'draft';
      setGoalPreparations((state) => {
        const next = { ...state };
        delete next[preparationKey];
        return next;
      });
    }
  }

  async function changeGoal(conversationId, action, specification = null) {
    if (!conversationId) return false;
    try {
      const result = await api.goals.change({
        conversationId,
        action,
        ...(specification === null ? {} : { specification }),
      });
      if (result.conversation.isSubagent) {
        setSubagents((state) => upsertById(state, result.conversation));
      } else if (result.conversation.isRubberDuck) {
        setRubberDucks((state) => upsertById(state, result.conversation));
      } else if (result.conversation.isSideChat) {
        setSideChats((state) => upsertById(state, result.conversation));
      } else {
        setConversations((state) => (
          upsertById(state, result.conversation).sort(sortByUpdatedAt)
        ));
      }
      if (action === 'stop') {
        setRunning((state) => ({ ...state, [conversationId]: false }));
      }
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  }

  async function resolveQuestionRequest(questionRequest, answers, cancelled) {
    try {
      const resolved = await api.chat.answerQuestion({
        questionId: questionRequest.questionId,
        cancelled,
        answers: cancelled ? [] : answers,
      });
      if (resolved) {
        setQuestionRequests((state) => state.filter(
          (request) => request.questionId !== questionRequest.questionId,
        ));
      }
      return resolved;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  }

  async function implementPlan({
    action = 'default',
    plan = '',
    conversationId = selectedId,
    model = currentModel,
    project = currentProject,
  } = {}) {
    const goalSpecification = 'Start implementation by establishing a well-defined Goal for this plan. Define the final objective, acceptance criteria, validation requirements, and execution rules before proceeding, then carry the work through to completion.';

    if (action === 'goal' || action === 'ultra-goal') {
      if (action === 'ultra-goal') {
        if (!await changeUltraMode(true, conversationId)) return false;
      } else if (!await changeWorkMode(null, conversationId)) {
        return false;
      }
      return startGoal({
        conversationId,
        model,
        project,
        specification: goalSpecification,
        ultraMode: action === 'ultra-goal',
      });
    }

    if (action === 'new-thread') {
      selectedConversationIdRef.current = null;
      setSelectedId(null);
      setDraftProject(project);
      setDraftModel(model);
      setWorkMode(null);
      setUltraMode(false);
      await sendMessage({
        text: `Implement the following plan in a new thread:\n\n${plan}`,
        attachments: [],
        conversationId: null,
        model,
        project,
        workMode: null,
        ultraMode: false,
      });
      return true;
    }

    const modeChanged = action === 'ultra'
      ? await changeUltraMode(true, conversationId)
      : await changeWorkMode(null, conversationId);
    if (!modeChanged) return false;
    await sendMessage({
      text: 'Implement this plan',
      attachments: [],
      conversationId,
      model,
      project,
      workMode: null,
      ultraMode: action === 'ultra',
    });
    return true;
  }

  async function forkConversation(id = selectedId, throughMessageId = null) {
    if (!id) return;
    const result = await api.conversations.fork({ conversationId: id, throughMessageId });
    if (!result) return;
    setConversations((state) => upsertById(state, result.conversation).sort(sortByUpdatedAt));
    setMessagesByConversation((state) => ({ ...state, [result.conversation.id]: result.messages }));
    setDraftModel(result.conversation.model);
    selectedConversationIdRef.current = result.conversation.id;
    setSelectedId(result.conversation.id);
  }

  async function createSideChat(initialAttachment = null) {
    if (!selectedId) return;
    const attachment = initialAttachment?.kind ? initialAttachment : null;
    const result = await api.sideChats.create({ parentConversationId: selectedId });
    if (!result) return;
    setSideChats((state) => [...state, result.conversation]);
    setMessagesByConversation((state) => ({
      ...state,
      [result.conversation.id]: result.messages,
    }));
    setPendingSideChatAttachment(attachment
      ? { conversationId: result.conversation.id, attachment }
      : null);
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
        ?? (filesTabOpen ? 'files' : null)
        ?? (gitReviewTabOpen ? 'git-review' : null)
        ?? (tasksTabOpen ? 'tasks' : null)
        ?? (botQueueTabOpen ? 'bot-queue' : null)
        ?? (subagentsTabOpen ? 'subagents' : openProviderPanels[0]?.id ?? null);
      setActiveAuxiliaryTab(nextTab);
    }
  }

  async function setConversationTags(conversationId, tags) {
    try {
      const conversation = await api.conversations.setTags(conversationId, tags);
      setConversations((state) => state.map((item) => (
        item.id === conversation.id ? conversation : item
      )));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async function saveChatTags(tags) {
    try {
      const result = await api.tags.save(tags);
      setAppState((current) => (current ? { ...current, chatTags: result.tags } : current));
      setConversations(result.conversations);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      throw nextError;
    }
  }

  async function setFolderColor(path, color) {
    const folderColors = await api.folders.saveColor({ path, color });
    setAppState((current) => (current ? { ...current, folderColors } : current));
  }

  async function archiveConversation(id) {
    const next = await api.conversations.archive(id);
    setConversations(next);
    setMessagesByConversation((state) => {
      const copy = { ...state };
      delete copy[id];
      if (selectedId === id) {
        for (const sideChat of sideChats) delete copy[sideChat.id];
        for (const subagent of subagents) delete copy[subagent.id];
        for (const rubberDuck of rubberDucks) delete copy[rubberDuck.id];
      }
      return copy;
    });
    if (selectedId === id) {
      setSideChats([]);
      setSubagents([]);
      setRubberDucks([]);
      setActiveAuxiliaryTab(null);
      setActiveSubagentId(null);
      const fallback = next[0]?.id ?? null;
      if (next[0]?.model) setDraftModel(next[0].model);
      selectedConversationIdRef.current = fallback;
      setSelectedId(fallback);
      if (!fallback) setDraftProject(appState.defaultProject);
      if (fallback && !messagesByConversation[fallback]) {
        const messages = await api.conversations.messages(fallback);
        setMessagesByConversation((state) => ({ ...state, [fallback]: messages }));
      }
    }
  }

  async function chooseModel(modelId, conversationId = selectedId) {
    setDraftModel(modelId);
    if (!conversationId) {
      return;
    }
    const conversation = await api.conversations.update({ id: conversationId, model: modelId });
    if (conversation.isSubagent) {
      setSubagents((state) => upsertById(state, conversation));
    } else if (conversation.isRubberDuck) {
      setRubberDucks((state) => upsertById(state, conversation));
    } else if (conversation.isSideChat) {
      setSideChats((state) => upsertById(state, conversation));
    } else {
      setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
    }
  }

  async function quickCompressConversation(conversationId = selectedId) {
    if (!conversationId || running[conversationId]) return;
    try {
      return await api.chat.compressQuick({ conversationId });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    }
  }

  async function compressConversation(conversationId = selectedId, model = currentModel) {
    if (!conversationId || !model || running[conversationId]) return;
    try {
      const conversation = await api.chat.compress({ conversationId, model });
      if (!conversation) return;
      if (conversation.isSubagent) {
        setSubagents((state) => upsertById(state, conversation));
      } else if (conversation.isRubberDuck) {
        setRubberDucks((state) => upsertById(state, conversation));
      } else if (conversation.isSideChat) {
        setSideChats((state) => upsertById(state, conversation));
      } else {
        setConversations((state) => upsertById(state, conversation).sort(sortByUpdatedAt));
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }

  async function reorderQueuedMessages(
    conversationId,
    queueType,
    messageIds,
    steerMessageId = null,
    dispatchNext = false,
  ) {
    if (!conversationId) return false;
    try {
      const result = await api.chat.reorderQueued({
        conversationId,
        queueType,
        messageIds,
        steerMessageId,
        dispatchNext,
      });
      setMessagesByConversation((state) => ({
        ...state,
        [conversationId]: applyPendingOrder(
          (state[conversationId] ?? []).map((message) => (
            result?.reordered && result?.steered && message.id === steerMessageId
              ? { ...message, status: 'steered' }
              : message
          )),
          result,
        ),
      }));
      if (!result?.reordered) {
        setError('The queue changed before the action completed. Review its order and try again.');
      }
      return Boolean(result?.reordered);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  }

  async function steerQueuedMessage(conversationId, messageId, messageIds) {
    return reorderQueuedMessages(conversationId, 'queue', messageIds, messageId);
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
    const [nextModels, defaultModelStatus] = await Promise.all([
      api.models.list(),
      api.defaultModels.status(),
    ]);
    setModels(nextModels);
    setAppState((current) => ({
      ...current,
      defaultModels: defaultModelStatus.settings,
      defaultModelWarnings: defaultModelStatus.warnings,
    }));
    setError(defaultModelStatus.warnings.map((warning) => warning.message).join(' '));
    return nextProviders;
  }

  const chatOnSend = useStableCallback(sendMessage);
  const chatOnReplaceUserMessage = useStableCallback(async (messageId, payload) => {
    if (!selectedId) return;
    const conversationId = selectedId;
    try {
      const result = await api.chat.replaceUserMessage({
        conversationId,
        messageId,
        model: payload.model,
        text: payload.text,
        attachments: payload.attachments,
        reasoningEffort: payload.reasoningEffort,
        permissionMode: payload.permissionMode,
        workMode: payload.workMode,
        ultraMode: payload.ultraMode,
      });
      setConversations((state) => (
        upsertById(state, result.conversation).sort(sortByUpdatedAt)
      ));
      if (selectedConversationIdRef.current === conversationId) {
        setDraftModel(result.conversation.model);
      }
      setMessagesByConversation((state) => ({
        ...state,
        [result.conversation.id]: upsertMessage(
          state[result.conversation.id] ?? [],
          result.message,
        ),
      }));
      setRunning((state) => ({
        ...state,
        [result.conversation.id]: !result.queued,
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      throw nextError;
    }
  });
  const chatOnImplementPlan = useStableCallback(implementPlan);
  const chatOnAnswerQuestion = useStableCallback(resolveQuestionRequest);
  const chatOnStop = useStableCallback(stopConversation);
  const chatOnQuickCompress = useStableCallback(quickCompressConversation);
  const chatOnCompress = useStableCallback(compressConversation);
  const chatOnRunSemaphoreNow = useStableCallback(async (conversationId = selectedId) => {
    if (!conversationId || semaphoreResolving) return;
    setSemaphoreResolving(true);
    try {
      await api.chat.runSemaphoreNow(conversationId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSemaphoreResolving(false);
    }
  });
  const chatOnCancelSemaphore = useStableCallback(async (conversationId = selectedId) => {
    if (!conversationId || semaphoreResolving) return;
    setSemaphoreResolving(true);
    try {
      await api.chat.cancelSemaphore(conversationId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSemaphoreResolving(false);
    }
  });
  const chatOnCreateSideChat = useStableCallback(createSideChat);
  const chatOnOpenTasks = useStableCallback(() => {
    setAuxiliaryPanelVisible(true);
    setTasksTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('tasks');
  });
  const chatOnOpenSubagents = useStableCallback(() => {
    setAuxiliaryPanelVisible(true);
    setSubagentsTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('subagents');
  });
  const chatOnFork = useStableCallback(forkConversation);
  const chatOnRetry = useStableCallback(retryAssistantMessage);
  const chatOnResume = useStableCallback((messageId, model) => retryAssistantMessage(
    messageId,
    { resumeFromFailure: true, model },
  ));
  const chatOnCancelQueued = useStableCallback(cancelQueuedMessage);
  const chatOnReorderQueued = useStableCallback((queueType, messageIds, steerMessageId, dispatchNext) => (
    reorderQueuedMessages(
      selectedId,
      queueType,
      messageIds,
      steerMessageId,
      dispatchNext,
    )
  ));
  const chatOnSteerQueued = useStableCallback((messageId, messageIds) => (
    steerQueuedMessage(selectedId, messageId, messageIds)
  ));
  const chatOnSendContinuation = useStableCallback((text) => sendMessage({
    text,
    attachments: [],
  }));
  const chatOnUndoEdits = useStableCallback((text) => sendMessage({
    text,
    attachments: [],
    steer: false,
  }));
  const chatOnChooseModel = useStableCallback(chooseModel);
  const chatOnChooseProject = useStableCallback(async (project) => {
    if (currentConversation) return;
    if (project) {
      setDraftProject(project);
      return;
    }
    const selectedProject = await api.projects.select({
      defaultPath: currentProject?.path ?? appState.defaultProject.path,
    });
    if (selectedProject) setDraftProject(selectedProject);
  });
  const chatOnUseHome = useStableCallback(() => {
    if (!currentConversation) setDraftProject(appState.defaultProject);
  });
  const chatOnToggleFavorite = useStableCallback(toggleFavorite);
  const chatOnWorkModeChange = useStableCallback(changeWorkMode);
  const chatOnUltraModeChange = useStableCallback(changeUltraMode);
  const chatOnGoalAction = useStableCallback((action, specification) => (
    changeGoal(selectedId, action, specification)
  ));
  const chatOnPendingAttachmentConsumed = useStableCallback(() => (
    setPendingComposerAttachment(null)
  ));
  const chatOnOpenFileReference = useStableCallback(openFileReference);
  const chatOnExpandPrompt = useStableCallback(async (payload) => {
    try {
      return await api.chat.expandPrompt(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    }
  });
  const chatOnShowBotInPanel = useStableCallback(() => openBotQueueTab(selectedBot?.id));
  const chatOnFileReferenceAction = useStableCallback(handleFileReferenceAction);
  const sidebarSemaphoreWaiting = useMemo(() => Object.fromEntries(
    semaphoreWaits.map((wait) => [wait.conversationId, true]),
  ), [semaphoreWaits]);
  const sidebarOnSetConversationTags = useStableCallback(setConversationTags);
  const sidebarOnSetFolderColor = useStableCallback(setFolderColor);
  const sidebarOnSaveChatTags = useStableCallback(saveChatTags);
  const sidebarOnQuickChat = useStableCallback(() => api.quickChat.open().catch((nextError) => {
    setError(nextError instanceof Error ? nextError.message : String(nextError));
  }));
  const sidebarOnNewChat = useStableCallback((preset = {}) => {
    setOrchestrationOpen(false);
    selectedConversationIdRef.current = null;
    setSelectedId(null);
    setDraftProject(preset.project ?? currentProject ?? appState.defaultProject);
    setDraftModel(preset.modelId ?? currentModel ?? appState.lastModel ?? models[0]?.id ?? '');
    setWorkMode(null);
    setUltraMode(false);
  });
  const sidebarOnSelect = useStableCallback((id) => {
    setOrchestrationOpen(false);
    selectConversation(id);
  });
  const sidebarOnNewBot = useStableCallback(createBot);
  const sidebarOnBotSettings = useStableCallback(setBotSettingsTarget);
  const sidebarOnDeleteBot = useStableCallback(deleteBot);
  const sidebarOnActivateBot = useStableCallback(activateBot);
  const sidebarOnSnoozeBot = useStableCallback(snoozeBot);
  const sidebarOnSnoozeBots = useStableCallback(snoozeBots);
  const sidebarOnFork = useStableCallback(forkConversation);
  const sidebarOnArchive = useStableCallback(archiveConversation);
  const sidebarOnSearch = useStableCallback(() => setSearchOpen(true));
  const sidebarOnOpenOrchestration = useStableCallback(() => {
    setOrchestrationOpen(true);
    setAuxiliaryPanelVisible(false);
  });
  const sidebarOnOpenProject = useStableCallback(async (project) => {
    try {
      await api.context.open(project.path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  });
  const sidebarOnOpenTerminal = useStableCallback(async (project) => {
    try {
      await api.shell.openTerminal(project.path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  });
  const sidebarOnCopyPath = useStableCallback(async (project) => {
    try {
      await navigator.clipboard.writeText(project.path);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  });
  const sidebarOnCopyThreadId = useStableCallback(async (id) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  });
  const sidebarOnSettings = useStableCallback((contextFolder = null, initialView = null) => {
    setSettingsContextFolder(contextFolder);
    setSettingsInitialView(initialView ?? (contextFolder ? 'context-folder' : null));
    setSettingsOpen(true);
  });
  const sidebarOnToggleCollapsed = useStableCallback(() => (
    setSidebarCollapsed((value) => !value)
  ));
  const auxiliaryOnResolveBotApproval = useStableCallback(resolveBotApproval);
  const auxiliaryOnMentionBotWork = useStableCallback((item) => {
    const bot = bots.find((entry) => entry.id === selectedBotLogId);
    if (!bot?.conversationId) return;
    sidebarOnSelect(bot.conversationId);
    setPendingComposerAttachment({
      id: crypto.randomUUID(),
      kind: 'context_marker',
      markerType: 'work_item',
      name: item.title,
      size: 0,
      text: [
        `<bot-work-mention id="${item.id}" state="${item.state}" priority="${item.priority}">`,
        `The user mentioned this work item in chat: "${item.title}".`,
        'Read the full work item with bot_work_read before acting on it.',
        '</bot-work-mention>',
      ].join('\n'),
    });
  });
  const auxiliaryOnSetBotWorkState = useStableCallback((item, state) => (
    api.bots.updateWorkItem({ botId: selectedBotLogId, workItemId: item.id, state })
  ));
  const auxiliaryOnOpenBotQueueTab = useStableCallback(openBotQueueTab);
  const auxiliaryOnCloseBotQueueTab = useStableCallback(closeBotQueueTab);
  const auxiliaryOnSelectTab = useStableCallback(async (tabId) => {
    setActiveAuxiliaryTab(tabId);
    if (['subagents', 'files', 'git-review'].includes(tabId)) {
      setActiveSubagentId(null);
    } else if (
      !providerPanels.some((panel) => panel.id === tabId)
      && !messagesByConversation[tabId]
    ) {
      const messages = await api.conversations.messages(tabId);
      setMessagesByConversation((state) => ({ ...state, [tabId]: messages }));
    }
  });
  const auxiliaryOnCloseSideChat = useStableCallback(closeSideChat);
  const auxiliaryOnCloseFilesTab = useStableCallback(() => {
    setFilesTabOpen(false);
    if (activeAuxiliaryTab === 'files') {
      setActiveAuxiliaryTab(
        sideChats[0]?.id
          ?? (botQueueTabOpen ? 'bot-queue' : null)
          ?? (subagentsTabOpen ? 'subagents' : openProviderPanels[0]?.id ?? null),
      );
    }
  });
  const auxiliaryOnCloseGitReviewTab = useStableCallback(() => {
    setGitReviewTabOpen(false);
    if (activeAuxiliaryTab === 'git-review') {
      setActiveAuxiliaryTab(
        sideChats[0]?.id
          ?? (filesTabOpen ? 'files' : null)
          ?? (tasksTabOpen ? 'tasks' : null)
          ?? (botQueueTabOpen ? 'bot-queue' : null)
          ?? (subagentsTabOpen ? 'subagents' : openProviderPanels[0]?.id ?? null),
      );
    }
  });
  const auxiliaryOnCloseTasksTab = useStableCallback(() => {
    setTasksTabOpen(false);
    setActiveAuxiliaryTab(null);
  });
  const auxiliaryOnCloseSubagentsTab = useStableCallback(() => {
    setActiveSubagentId(null);
    setSubagentsTabOpen(false);
    if (activeAuxiliaryTab === 'subagents') {
      setActiveAuxiliaryTab(
        sideChats[0]?.id
          ?? (filesTabOpen ? 'files' : null)
          ?? (gitReviewTabOpen ? 'git-review' : null)
          ?? openProviderPanels[0]?.id
          ?? null,
      );
    }
  });
  const auxiliaryOnOpenGitReviewTab = useStableCallback(() => {
    setGitReviewTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('git-review');
    setAuxiliaryPanelVisible(true);
  });
  const auxiliaryOnOpenFilesTab = useStableCallback(() => {
    setFilesTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('files');
  });
  const auxiliaryOnOpenTasksTab = useStableCallback(() => {
    setTasksTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('tasks');
  });
  const auxiliaryOnOpenSubagentsTab = useStableCallback(() => {
    setSubagentsTabOpen(true);
    setActiveSubagentId(null);
    setActiveAuxiliaryTab('subagents');
  });
  const auxiliaryOnOpenProviderPanel = useStableCallback((panelId) => {
    if (!providerPanels.some((panel) => panel.id === panelId)) return;
    setOpenProviderPanelIds((current) => (
      current.includes(panelId) ? current : [...current, panelId]
    ));
    setActiveAuxiliaryTab(panelId);
  });
  const auxiliaryOnCloseProviderPanel = useStableCallback((panelId) => {
    const index = openProviderPanelIds.indexOf(panelId);
    if (index < 0) return;
    const remaining = openProviderPanelIds.filter((id) => id !== panelId);
    setOpenProviderPanelIds(remaining);
    if (activeAuxiliaryTab === panelId) {
      setActiveAuxiliaryTab(
        remaining[Math.min(index, remaining.length - 1)]
          ?? (filesTabOpen ? 'files' : null)
          ?? (gitReviewTabOpen ? 'git-review' : null)
          ?? (subagentsTabOpen ? 'subagents' : sideChats[0]?.id ?? null),
      );
    }
  });
  const auxiliaryOnClosePanel = useStableCallback(() => setAuxiliaryPanelVisible(false));
  const auxiliaryOnRunAgent = useStableCallback((payload) => sendMessage({
    ...payload,
    conversationId: selectedId,
    model: currentModel,
    project: currentProject,
    workMode: null,
    ultraMode: false,
  }));
  const auxiliaryOnPendingSideChatAttachmentConsumed = useStableCallback((attachmentId) => {
    setPendingSideChatAttachment((current) => (
      current?.attachment.id === attachmentId ? null : current
    ));
  });
  const auxiliaryOnFileNavigationConsumed = useStableCallback(() => setFileNavigation(null));
  const auxiliaryOnSelectSubagent = useStableCallback(async (id) => {
    setActiveSubagentId(id);
    if (id && !messagesByConversation[id]) {
      const messages = await api.conversations.messages(id);
      setMessagesByConversation((state) => ({ ...state, [id]: messages }));
    }
  });
  const auxiliaryOnSend = useStableCallback((thread, model, payload) => sendMessage({
    ...payload,
    conversationId: thread.id,
    model,
    project: {
      path: thread.projectPath,
      name: thread.projectName,
      displayPath: thread.projectDisplayPath,
      gitBranch: thread.gitBranch,
    },
  }));
  const auxiliaryOnImplementPlan = useStableCallback((thread, model, options) => implementPlan({
    ...options,
    conversationId: thread.id,
    model,
    project: {
      path: thread.projectPath,
      name: thread.projectName,
      displayPath: thread.projectDisplayPath,
      gitBranch: thread.gitBranch,
    },
  }));
  const auxiliaryOnRetry = useStableCallback((conversationId, messageId, model) => (
    retryAssistantMessage(messageId, { conversationId, model })
  ));
  const auxiliaryOnResume = useStableCallback((conversationId, messageId, model) => (
    retryAssistantMessage(messageId, { conversationId, model, resumeFromFailure: true })
  ));
  const auxiliaryOnCancelQueued = useStableCallback((conversationId, messageId) => (
    cancelQueuedMessage(messageId, conversationId)
  ));
  const auxiliaryOnReorderQueued = useStableCallback(reorderQueuedMessages);
  const auxiliaryOnSteerQueued = useStableCallback(steerQueuedMessage);
  const auxiliaryOnGoalAction = useStableCallback((thread, action, specification) => (
    changeGoal(thread.id, action, specification)
  ));

  const narrowWindow = windowWidth <= 700;
  const effectiveSidebarCollapsed = narrowWindow || sidebarCollapsed;
  const sidebarWidthMax = Math.max(
    180,
    Math.min(
      420,
      windowWidth
        - (auxiliaryPanelVisible ? auxiliaryPanelWidth : 0)
        - minimumMainContentWidth,
    ),
  );
  const effectiveSidebarWidth = Math.min(sidebarWidth, sidebarWidthMax);
  const auxiliaryPanelWidthMax = Math.max(
    minimumAuxiliaryPanelWidth,
    windowWidth
      - (effectiveSidebarCollapsed ? 58 : effectiveSidebarWidth)
      - minimumMainContentWidth,
  );
  const effectiveAuxiliaryPanelWidth = Math.min(
    auxiliaryPanelWidth,
    auxiliaryPanelWidthMax,
  );
  const shellClassName = [
    'app-shell',
    appState?.platform && `platform-${appState.platform}`,
    effectiveSidebarCollapsed && 'sidebar-collapsed',
    settingsOpen && 'settings-active',
    appState?.tuning?.chatReasoningTraces === 'hidden' && 'reasoning-traces-hidden',
  ]
    .filter(Boolean)
    .join(' ');
  const recentModels = useMemo(() => {
    const modelsById = new Map(models.map((model) => [model.id, model]));
    const ids = [];
    for (const modelId of [currentModel, ...conversations.map((conversation) => conversation.model)]) {
      if (!modelId || ids.includes(modelId) || !modelsById.has(modelId)) continue;
      ids.push(modelId);
      if (ids.length === 8) break;
    }
    return ids.map((modelId) => modelsById.get(modelId));
  }, [conversations, currentModel, models]);
  const shell = useMemo(() => ({
    currentConversation,
    currentMessages,
    messagesLoaded: !selectedId || Object.hasOwn(messagesByConversation, selectedId),
    currentModel,
    contextUsage,
    isRunning: Boolean(selectedId && running[selectedId]),
    semaphoreWait: semaphoreWaits.find((wait) => wait.conversationId === selectedId) ?? null,
    recentProjects,
    recentModels,
  }), [
    currentConversation,
    currentMessages,
    currentModel,
    contextUsage,
    messagesByConversation,
    recentModels,
    recentProjects,
    running,
    selectedId,
    semaphoreWaits,
  ]);

  if (!appState) {
    return <div className="app-shell" />;
  }

  return (
    <div
      className={shellClassName}
      style={{
        '--sidebar-width': `${effectiveSidebarWidth}px`,
        '--auxiliary-panel-width': `${effectiveAuxiliaryPanelWidth}px`,
      }}
    >
      {settingsOpen ? (
        <SettingsPage
          key={`${settingsInitialView ?? 'providers'}:${settingsContextFolder?.path ?? ''}`}
          providers={providers}
          providerTypes={providerTypes}
          tuning={appState.tuning}
          models={models}
          defaultModels={appState.defaultModels}
          pluginCatalog={{
            themes,
            personalities: appState.pluginCatalog?.personalities ?? [],
          }}
          initialContextFolder={settingsContextFolder}
          initialView={settingsInitialView}
          appearance={appearance}
          backgroundUrl={chatBackgroundUrl}
          desktop={appState.desktop}
          onAppearanceChange={setAppearance}
          onBackgroundSelect={async () => {
            const backgroundFile = await api.appearance.selectBackground();
            if (!backgroundFile) return;
            const backgroundUrl = await api.appearance.background(backgroundFile);
            setChatBackgroundUrl(backgroundUrl);
            setAppearance((current) => ({ ...current, backgroundFile }));
          }}
          onBackgroundRemove={async () => {
            await api.appearance.removeBackground();
            setChatBackgroundUrl(null);
            setAppearance((current) => ({ ...current, backgroundFile: null }));
          }}
          onDesktopChange={async (desktop) => {
            const saved = await api.desktop.save(desktop);
            setAppState((current) => ({ ...current, desktop: saved }));
          }}
          onClose={async () => {
            const nextConversations = await api.conversations.list();
            setConversations(nextConversations);
            setSettingsContextFolder(null);
            setSettingsInitialView(null);
            setSettingsOpen(false);
            if (selectedId && !nextConversations.some((conversation) => conversation.id === selectedId)) {
              const fallback = nextConversations[0]?.id ?? null;
              selectedConversationIdRef.current = fallback;
              setSelectedId(fallback);
            }
          }}
          onSave={async (provider) => applyProviders(await api.providers.save(provider))}
          onRemove={async (providerId) => applyProviders(await api.providers.remove(providerId))}
          onModelsChange={async () => setModels(await api.models.list())}
          onRoutersChange={async () => setModels(await api.models.list())}
          onSaveDefaultModels={async (settings) => {
            const result = await api.defaultModels.save(settings);
            setAppState((current) => ({
              ...current,
              defaultModels: result.settings,
              defaultModelWarnings: result.warnings,
            }));
            setError(result.warnings.map((warning) => warning.message).join(' '));
            return result;
          }}
          onSaveTuning={async (tuning) => {
            const savedTuning = await api.tuning.save(tuning);
            window.localStorage.setItem(
              'aivax.composer.permission-mode',
              savedTuning.defaultPermissionMode,
            );
            setAppState((current) => ({ ...current, tuning: savedTuning }));
            return savedTuning;
          }}
        />
      ) : (
        <>
          <Sidebar
            conversations={conversations}
            bots={bots}
            botSchedulerSnooze={botSchedulerSnooze}
            models={models}
            selectedId={selectedId}
            running={running}
            runStartedAt={runStartedAt}
            completedUnseen={completedUnseen}
            approvalPending={approvalPending}
            inputPending={inputPending}
            semaphoreWaiting={sidebarSemaphoreWaiting}
            homePath={appState.defaultProject.path}
            chatTags={appState.chatTags ?? emptyList}
            folderColors={appState.folderColors ?? emptyObject}
            onSetConversationTags={sidebarOnSetConversationTags}
            onSetFolderColor={sidebarOnSetFolderColor}
            onSaveChatTags={sidebarOnSaveChatTags}
            onQuickChat={sidebarOnQuickChat}
            onNewChat={sidebarOnNewChat}
            onSelect={sidebarOnSelect}
            onNewBot={sidebarOnNewBot}
            onSelectBot={sidebarOnSelect}
            onBotSettings={sidebarOnBotSettings}
            onDeleteBot={sidebarOnDeleteBot}
            onActivateBot={sidebarOnActivateBot}
            onSnoozeBot={sidebarOnSnoozeBot}
            onSnoozeBots={sidebarOnSnoozeBots}
            onSearch={sidebarOnSearch}
            onOpenOrchestration={sidebarOnOpenOrchestration}
            onFork={sidebarOnFork}
            onArchive={sidebarOnArchive}
            onOpenProject={sidebarOnOpenProject}
            onOpenTerminal={sidebarOnOpenTerminal}
            onCopyPath={sidebarOnCopyPath}
            onCopyThreadId={sidebarOnCopyThreadId}
            onSettings={sidebarOnSettings}
            collapsed={effectiveSidebarCollapsed}
            orchestrationOpen={orchestrationOpen}
            onToggleCollapsed={sidebarOnToggleCollapsed}
          />
          {!effectiveSidebarCollapsed && (
            <PanelResizer
              label="Resize sidebar"
              controls="main-sidebar"
              value={effectiveSidebarWidth}
              min={180}
              max={sidebarWidthMax}
              direction={1}
              cssVariable="--sidebar-width"
              onChange={setSidebarWidth}
              onCommit={(width) => window.localStorage.setItem(
                sidebarWidthStorageKey,
                String(width),
              )}
            />
          )}
          <div
            className={`chat-workspace${auxiliaryPanelVisible && !orchestrationOpen
              ? ' with-auxiliary-panel'
              : ''}`}
          >
            {orchestrationOpen ? (
              <OrchestrationPage
                models={models}
                onOpenThread={(id) => {
                  setOrchestrationOpen(false);
                  selectConversation(id);
                }}
              />
            ) : (
              <ChatView
              {...shell}
              botMode={Boolean(selectedBot)}
              onShowBotInPanel={selectedBot ? chatOnShowBotInPanel : undefined}
              emptyBackgroundEnabled={getTheme(appearance.themeId).emptyChatBackground !== false}
              emptyBackgroundThemeKey={`${appearance.themeId}:${resolvedScheme(appearance.scheme)}`}
              backgroundUrl={chatBackgroundUrl}
              backgroundBlendMode={appearance.backgroundBlendMode}
              backgroundOpacity={appearance.backgroundOpacity}
              currentProject={currentProject}
              models={models}
              favorites={favorites}
              intelligenceLevels={appState.defaultModels?.intelligence?.levels ?? emptyList}
              onSend={chatOnSend}
              onReplaceUserMessage={chatOnReplaceUserMessage}
              onExpandPrompt={chatOnExpandPrompt}
              onImplementPlan={chatOnImplementPlan}
              questionRequest={questionRequests.find(
                (request) => request.conversationId === selectedId,
              ) ?? null}
              onAnswerQuestion={chatOnAnswerQuestion}
              onRunSemaphoreNow={chatOnRunSemaphoreNow}
              onCancelSemaphore={chatOnCancelSemaphore}
              semaphoreResolving={semaphoreResolving}
              onStop={chatOnStop}
              onQuickCompress={chatOnQuickCompress}
              onCompress={chatOnCompress}
              onCreateSideChat={currentConversation ? chatOnCreateSideChat : undefined}
              onMentionSelection={setPendingComposerAttachment}
              onAskSelection={currentConversation ? chatOnCreateSideChat : undefined}
              subagents={subagentsWithStatus}
              tasks={tasksByConversation[selectedId] ?? emptyList}
              onOpenTasks={chatOnOpenTasks}
              onOpenSubagents={chatOnOpenSubagents}
              onFork={chatOnFork}
              onRetry={chatOnRetry}
              onResume={chatOnResume}
              onCancelQueued={chatOnCancelQueued}
              onReorderQueued={chatOnReorderQueued}
              onSteerQueued={chatOnSteerQueued}
              onSendContinuation={chatOnSendContinuation}
              onUndoEdits={chatOnUndoEdits}
              onOpenFileEdit={chatOnOpenFileReference}
              onChooseModel={chatOnChooseModel}
              onChooseProject={chatOnChooseProject}
              onUseHome={chatOnUseHome}
              onToggleFavorite={chatOnToggleFavorite}
              workMode={selectedId
                ? currentConversation?.orchestrationMode === 'plan' ? 'plan' : null
                : workMode}
              onWorkModeChange={chatOnWorkModeChange}
              ultraMode={selectedId
                ? currentConversation?.orchestrationMode === 'ultra'
                : ultraMode}
              onUltraModeChange={chatOnUltraModeChange}
              goalPreparation={goalPreparations[selectedId ?? 'draft'] ?? null}
              onGoalAction={chatOnGoalAction}
              pendingAttachment={pendingComposerAttachment}
              onPendingAttachmentConsumed={chatOnPendingAttachmentConsumed}
              onOpenFileReference={chatOnOpenFileReference}
              onFileReferenceAction={chatOnFileReferenceAction}
              messageDeliveryMode={appState.tuning.messageDeliveryMode}
              defaultPermissionMode={appState.tuning.defaultPermissionMode}
              continuationRepliesEnabled={appState.tuning.continuationRepliesEnabled}
              />
            )}
            {!orchestrationOpen && auxiliaryPanelVisible && (
              <PanelResizer
                label="Resize auxiliary panel"
                controls="auxiliary-panel"
                value={effectiveAuxiliaryPanelWidth}
                min={minimumAuxiliaryPanelWidth}
                max={auxiliaryPanelWidthMax}
                direction={-1}
                cssVariable="--auxiliary-panel-width"
                onChange={setAuxiliaryPanelWidth}
                onCommit={(width) => window.localStorage.setItem(
                  auxiliaryPanelWidthStorageKey,
                  String(width),
                )}
              />
            )}
            {!orchestrationOpen && !auxiliaryPanelVisible && (
              <button
                className="auxiliary-panel-toggle"
                type="button"
                aria-label="Open auxiliary panel"
                title="Open auxiliary panel"
                onClick={() => {
                  setActiveSubagentId(null);
                  setActiveAuxiliaryTab((current) => (
                    sideChats.some((sideChat) => sideChat.id === current)
                    || (current === 'files' && filesTabOpen)
                    || (current === 'git-review' && gitReviewTabOpen)
                    || (current === 'subagents' && subagentsTabOpen)
                    || (current === 'tasks' && tasksTabOpen)
                    || (current === 'bot-queue' && botQueueTabOpen)
                    || openProviderPanels.some((panel) => panel.id === current)
                      ? current
                      : sideChats[0]?.id
                        ?? (filesTabOpen ? 'files' : null)
                        ?? (gitReviewTabOpen ? 'git-review' : null)
                        ?? (tasksTabOpen ? 'tasks' : null)
                        ?? (botQueueTabOpen ? 'bot-queue' : null)
                        ?? (subagentsTabOpen
                          ? 'subagents'
                          : openProviderPanels[0]?.id ?? null)
                  ));
                  setAuxiliaryPanelVisible(true);
                }}
              >
                <PanelRightOpen size={17} />
              </button>
            )}
            {!orchestrationOpen && auxiliaryPanelVisible && (
              <AuxiliaryPanel
                sideChats={sideChats}
                bots={bots}
                botWorkStateByBot={botWorkStateByBot}
                onResolveBotApproval={auxiliaryOnResolveBotApproval}
                onMentionBotWork={auxiliaryOnMentionBotWork}
                onSetBotWorkState={auxiliaryOnSetBotWorkState}
                botQueueTabOpen={botQueueTabOpen}
                selectedBotId={selectedBotLogId}
                onSelectBot={setSelectedBotLogId}
                onOpenBotQueueTab={auxiliaryOnOpenBotQueueTab}
                onCloseBotQueueTab={auxiliaryOnCloseBotQueueTab}
                subagents={subagentsWithStatus}
                tasks={tasksByConversation[selectedId] ?? emptyList}
                activeTab={activeAuxiliaryTab}
                activeSubagentId={activeSubagentId}
                visibleMessagesByConversation={auxiliaryMessagesByConversation}
                visibleRunning={auxiliaryRunning}
                semaphoreWaits={auxiliarySemaphoreWaits}
                models={models}
                favorites={favorites}
                recentModels={shell.recentModels}
                recentProjects={recentProjects}
                fallbackModel={currentModel}
                conversationId={selectedId}
                project={currentProject}
                providerPanels={providerPanels}
                openProviderPanels={openProviderPanels}
                filesTabOpen={filesTabOpen}
                gitReviewTabOpen={gitReviewTabOpen}
                subagentsTabOpen={subagentsTabOpen}
                tasksTabOpen={tasksTabOpen}
                canCreateSideChat={Boolean(currentConversation)}
                onSelectTab={auxiliaryOnSelectTab}
                onCloseSideChat={auxiliaryOnCloseSideChat}
                onCloseFilesTab={auxiliaryOnCloseFilesTab}
                onCloseGitReviewTab={auxiliaryOnCloseGitReviewTab}
                onCloseTasksTab={auxiliaryOnCloseTasksTab}
                onCloseSubagentsTab={auxiliaryOnCloseSubagentsTab}
                onOpenGitReviewTab={auxiliaryOnOpenGitReviewTab}
                onOpenFilesTab={auxiliaryOnOpenFilesTab}
                onOpenTasksTab={auxiliaryOnOpenTasksTab}
                onOpenSubagentsTab={auxiliaryOnOpenSubagentsTab}
                onOpenProviderPanel={auxiliaryOnOpenProviderPanel}
                onCloseProviderPanel={auxiliaryOnCloseProviderPanel}
                onClosePanel={auxiliaryOnClosePanel}
                onCreateSideChat={chatOnCreateSideChat}
                onAddToChat={setPendingComposerAttachment}
                onAskInSideChat={chatOnCreateSideChat}
                onRunAgent={auxiliaryOnRunAgent}
                pendingSideChatAttachment={pendingSideChatAttachment}
                onPendingSideChatAttachmentConsumed={auxiliaryOnPendingSideChatAttachmentConsumed}
                fileNavigation={fileNavigation}
                onFileNavigationConsumed={auxiliaryOnFileNavigationConsumed}
                onOpenFileReference={chatOnOpenFileReference}
                onFileReferenceAction={chatOnFileReferenceAction}
                onSelectSubagent={auxiliaryOnSelectSubagent}
                onSend={auxiliaryOnSend}
                onImplementPlan={auxiliaryOnImplementPlan}
                questionRequests={auxiliaryQuestionRequests}
                onAnswerQuestion={chatOnAnswerQuestion}
                onRunSemaphoreNow={chatOnRunSemaphoreNow}
                onCancelSemaphore={chatOnCancelSemaphore}
                semaphoreResolving={semaphoreResolving}
                onStop={chatOnStop}
                onCompress={chatOnCompress}
                onFork={chatOnFork}
                onRetry={auxiliaryOnRetry}
                onResume={auxiliaryOnResume}
                onCancelQueued={auxiliaryOnCancelQueued}
                onReorderQueued={auxiliaryOnReorderQueued}
                onSteerQueued={auxiliaryOnSteerQueued}
                onChooseModel={chatOnChooseModel}
                onToggleFavorite={chatOnToggleFavorite}
                workMode={null}
                onWorkModeChange={chatOnWorkModeChange}
                onUltraModeChange={chatOnUltraModeChange}
                onGoalAction={auxiliaryOnGoalAction}
                messageDeliveryMode={appState.tuning.messageDeliveryMode}
                defaultPermissionMode={appState.tuning.defaultPermissionMode}
                continuationRepliesEnabled={appState.tuning.continuationRepliesEnabled}
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
      {botSettingsTarget && (
        <BotSettingsDialog
          bot={bots.find((bot) => bot.id === botSettingsTarget) ?? null}
          models={models}
          pluginPersonalities={appState.pluginCatalog?.personalities ?? []}
          onClose={() => setBotSettingsTarget(null)}
          onSave={async (changes) => {
            await api.bots.update({ id: botSettingsTarget, changes });
            await refreshBots();
          }}
          onChooseFolder={() => api.bots.chooseFolder()}
          onClearThread={async (botId) => {
            const bot = bots.find((item) => item.id === botId);
            await api.bots.clearThread(botId);
            if (bot) {
              setMessagesByConversation((state) => {
                if (!(bot.conversationId in state)) return state;
                const next = { ...state };
                delete next[bot.conversationId];
                return next;
              });
            }
            await refreshBots();
          }}
          onFullReset={fullResetBot}
          onDeleteBot={deleteBot}
        />
      )}
      {(error || currentConversationError) && (
        <button
          className="toast"
          type="button"
          onClick={() => {
            if (error) {
              setError('');
              return;
            }
            setConversationErrors((state) => {
              const next = { ...state };
              delete next[selectedId];
              return next;
            });
          }}
        >
          {error || currentConversationError}
        </button>
      )}
      {activeApprovalRequest && (
        <div className="dialog-backdrop permission-dialog-backdrop">
          <section
            ref={approvalDialogRef}
            className="permission-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="permission-dialog-title"
            aria-describedby="permission-dialog-description"
          >
            <div className="permission-dialog-icon">
              <ShieldAlert size={20} />
            </div>
            <div className="permission-dialog-copy">
              <h2 id="permission-dialog-title">Allow this tool call?</h2>
              <p id="permission-dialog-description">{activeApprovalRequest.invocationSummary}</p>
              <dl>
                <div>
                  <dt>Tool</dt>
                  <dd>{activeApprovalRequest.toolName}</dd>
                </div>
                <div>
                  <dt>Folder</dt>
                  <dd>{activeApprovalRequest.workspacePath || 'No folder'}</dd>
                </div>
              </dl>
              {activeApprovalRequest.input && Object.keys(activeApprovalRequest.input).length > 0 && (
                <pre>{JSON.stringify(activeApprovalRequest.input, null, 2)}</pre>
              )}
            </div>
            <div className="permission-dialog-actions">
              <button
                type="button"
                disabled={approvalResolving}
                onClick={() => resolveToolApproval('disallow')}
              >
                Disallow
              </button>
              <button
                type="button"
                disabled={approvalResolving}
                onClick={() => resolveToolApproval('allow_all')}
              >
                Always allow this command
              </button>
              <button
                className="primary-mini"
                type="button"
                disabled={approvalResolving}
                onClick={() => resolveToolApproval('allow')}
              >
                Allow
              </button>
            </div>
          </section>
        </div>
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
