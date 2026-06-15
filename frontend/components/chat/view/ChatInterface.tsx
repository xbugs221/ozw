/**
 * Chat interface container.
 * Coordinates composer, realtime handlers, session state, and resilience UX such as network timeout feedback.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import type { ChatInterfaceProps } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import type { Provider } from '../types/types';
import type { SessionProvider } from '../../../types/app';
import { buildPiQueueState, isPiQueueForActiveSession, type PiQueueState } from '../utils/piQueueState';
import { api } from '../../../utils/api';
import { hasSessionControlChanged } from '../composer/sessionControlState';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  clientRequestId?: string;
  draftSessionId?: string | null;
};

const NETWORK_RESPONSE_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MESSAGE =
  '30 秒内没有收到服务端响应，疑似网络连接异常。请检查网络后重试。';
const isTemporarySessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

const isUnsavedSessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && sessionId.startsWith('new-session-'));

/**
 * Build the project identity needed by session-scoped config APIs.
 */
const resolveSessionConfigTarget = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  selectedSession: ChatInterfaceProps['selectedSession'],
) => ({
  projectName: selectedSession?.__projectName || selectedProject?.name || '',
  projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
});

/**
 * PURPOSE: Infer the authoritative provider for a persisted session from the
 * currently loaded project collections when route metadata is missing.
 */
const isCbwRouteSessionId = (sessionId: string): boolean =>
  /^c\d+$/.test(sessionId);

const resolveProjectSessionProvider = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  sessionId?: string | null,
): SessionProvider | null => {
  if (!selectedProject || !sessionId || isTemporarySessionId(sessionId)) {
    return null;
  }

  // Direct ID match in provider session arrays.
  if ((selectedProject.codexSessions || []).some((session) => session.id === sessionId)) {
    return 'codex';
  }
  if ((selectedProject.piSessions || []).some((session) => session.id === sessionId)) {
    return 'pi';
  }

  // Route-based sessions (cN) need routeIndex matching because their
  // provider session has a UUID id, not the route id.
  if (isCbwRouteSessionId(sessionId)) {
    const routeIndex = Number(sessionId.slice(1));
    if ((selectedProject.piSessions || []).some((s) => s.routeIndex === routeIndex)) {
      return 'pi';
    }
    if ((selectedProject.codexSessions || []).some((s) => s.routeIndex === routeIndex)) {
      return 'codex';
    }
  }

  return null;
};

/**
 * Recover workflow routing context from persisted session metadata instead of query parameters.
 */
const resolveFlowrkflowSessionContext = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  selectedSession: ChatInterfaceProps['selectedSession'],
) => {
  return {
    projectName: selectedSession?.__projectName || selectedProject?.name || '',
    projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
    workflowId: typeof selectedSession?.workflowId === 'string' ? selectedSession.workflowId : '',
    workflowStageKey: typeof selectedSession?.stageKey === 'string' ? selectedSession.stageKey : '',
  };
};

/**
 * Identify whether a WebSocket message can be treated as backend activity for chat requests.
 */
const isBackendResponseMessage = (messageType?: string): boolean => {
  if (!messageType) {
    return false;
  }

  if (
    messageType === 'projects_updated'
    || messageType === 'loading_progress'
    || messageType === 'session-model-state-updated'
    || messageType === 'session-queue-state'
    || messageType === 'session-subscribed'
  ) {
    return false;
  }

  return true;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  messageHistory,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onReplaceTemporarySession,
  onNavigateToSession,
  onNewSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  externalMessageUpdate,
}: ChatInterfaceProps) {
  const { t } = useTranslation('chat');
  const location = useLocation();

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const dispatchedSessionAutoInitsRef = useRef<Set<string>>(new Set());
  const surfacedWorkflowApplyFailuresRef = useRef<Set<string>>(new Set());
  const pendingNetworkTimeoutRef = useRef<number | null>(null);
  const awaitingBackendResponseRef = useRef(false);
  const statusReconcileKeyRef = useRef<string | null>(null);
  const [workflowTurnOutcomes, setWorkflowTurnOutcomes] = useState<Record<string, 'completed' | 'failed'>>({});
  const [isFollowingLatest, setIsFollowingLatest] = useState(false);
  const [searchHighlightRetry, setSearchHighlightRetry] = useState(0);
  const [piQueueState, setPiQueueState] = useState<PiQueueState | null>(null);
  const [activeTurnStartedAt, setActiveTurnStartedAt] = useState<string | null>(null);

  const activeSearchTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get('chatSearch');
    const messageKey = params.get('messageKey');

    if (!query || !messageKey) {
      return null;
    }

    return {
      query,
      messageKey,
    };
  }, [location.search]);

  useEffect(() => {
    setSearchHighlightRetry(0);
  }, [activeSearchTarget?.messageKey, activeSearchTarget?.query]);
  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    codexModel,
    setCodexModel,
    codexModelOptions,
    codexReasoningEffort,
    setCodexReasoningEffort,
    codexReasoningOptions,
    piModel,
    setPiModel,
    piModelOptions,
    piModelCatalogLoaded,
    piThinkingLevel,
    setPiThinkingLevel,
    piThinkingOptions,
    setPendingPermissionRequests,
  } = useChatProviderState({
    selectedSession,
  });
  const projectSessionProvider = useMemo(
    () => resolveProjectSessionProvider(selectedProject, selectedSession?.id),
    [selectedProject, selectedSession?.id],
  );
  const workflowSessionContext = useMemo(
    () => resolveFlowrkflowSessionContext(selectedProject, selectedSession),
    [selectedProject, selectedSession],
  );
  const effectiveProvider = useMemo(() => {
    // URL query param takes highest precedence — it's the most reliable
    // signal on page reload when session routes haven't been resolved yet.
    const urlProvider = new URLSearchParams(location.search).get('provider');
    if (urlProvider === 'pi' || urlProvider === 'codex') {
      return urlProvider;
    }
    const sessionProvider = selectedSession?.__provider || null;
    return projectSessionProvider || sessionProvider || provider;
  }, [
    location.search,
    projectSessionProvider,
    provider,
    selectedSession?.__provider,
  ]);
  const isPiModelSelectable = useMemo(() => {
    return piModelOptions.some((option) => option.value === piModel);
  }, [piModel, piModelOptions]);
  const piUnavailableMessage = useMemo(() => {
    /**
     * Keep the visible composer disabled state and submit guard aligned while
     * Pi model discovery is loading or unavailable.
     */
    if (effectiveProvider !== 'pi') {
      return '';
    }
    if (!piModelCatalogLoaded) {
      return 'Loading Pi model catalog...';
    }
    if (!isPiModelSelectable) {
      return 'Pi is unavailable. Configure Pi authentication before sending.';
    }
    return '';
  }, [effectiveProvider, isPiModelSelectable, piModelCatalogLoaded]);
  const [codexModelSwitchSessionId, setCodexModelSwitchSessionId] = useState<string | null>(null);
  const codexModelRef = useRef(codexModel);
  codexModelRef.current = codexModel;
  const codexReasoningEffortRef = useRef(codexReasoningEffort);
  codexReasoningEffortRef.current = codexReasoningEffort;
  const piModelRef = useRef(piModel);
  piModelRef.current = piModel;
  const piThinkingLevelRef = useRef(piThinkingLevel);
  piThinkingLevelRef.current = piThinkingLevel;

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    sessionMessagesError,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    loadMessagesUntilTarget,
    revealLoadedMessage,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleKeyDown: handleTranscriptKeyDown,
    loadSessionMessages,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    sendMessage,
    isFollowingLatest,
    autoScrollToBottom,
    externalMessageUpdate,
    resetStreamingState,
    pendingViewSessionRef,
  });
  const hasPersistentSession = Boolean(
    (selectedSession?.id && !isTemporarySessionId(selectedSession.id))
    || (currentSessionId && !isTemporarySessionId(currentSessionId)),
  );
  const activePiQueueState = useMemo(() => {
    return isPiQueueForActiveSession(piQueueState, currentSessionId, selectedSession?.id)
      ? piQueueState
      : null;
  }, [currentSessionId, piQueueState, selectedSession?.id]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    filteredCommands,
    frequentCommands,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    fileSearchQuery,
    setFileSearchQuery,
    fileTree,
    expandedFileTreePaths,
    toggleFileTreeDirectory,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    openFileDropdown,
    handleFileMentionsKeyDown,
    attachedUploads,
    setAttachedUploads,
    uploadingAttachments,
    attachmentErrors,
    isComposerSubmitting,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker,
    handleAttachmentSelection,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleAbortSession,
    handleTranscript,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider: effectiveProvider,
    codexModel,
    piModel,
    piThinkingLevel,
    piCanSend: effectiveProvider !== 'pi' || !piUnavailableMessage,
    piUnavailableMessage,
    codexModelSwitchSessionId,
    codexReasoningEffort,
    canAbortSession,
    tokenBudget,
    chatMessages,
    sendMessage,
    onSessionActive,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    onRequestDispatched: () => {
      awaitingBackendResponseRef.current = true;
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
      }

      pendingNetworkTimeoutRef.current = window.setTimeout(() => {
        if (!awaitingBackendResponseRef.current) {
          return;
        }

        awaitingBackendResponseRef.current = false;
        pendingNetworkTimeoutRef.current = null;
        setIsLoading(false);
        setCanAbortSession(false);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: NETWORK_TIMEOUT_MESSAGE,
            timestamp: new Date(),
          },
        ]);
      }, NETWORK_RESPONSE_TIMEOUT_MS);
    },
  });
  // 用 ref 持有 input/focus 值，避免输入变化重建状态轮询定时器
  const inputRef = useRef(input);
  inputRef.current = input;
  const isInputFocusedRef = useRef(isInputFocused);
  isInputFocusedRef.current = isInputFocused;

  const handleSetCodexModel = useCallback(
    (nextModel: string) => {
      const normalizedNextModel = nextModel.trim().toLowerCase();
      const nextSessionId = selectedSession?.id || null;
      const normalizedSessionModel = String(codexModel || '').trim().toLowerCase();
      const shouldStartNewCodexSession =
        effectiveProvider === 'codex'
        && selectedSession?.__provider === 'codex'
        && Boolean(nextSessionId)
        && normalizedSessionModel !== normalizedNextModel;

      if (shouldStartNewCodexSession) {
        setCodexModelSwitchSessionId(nextSessionId);
      } else if (codexModelSwitchSessionId === nextSessionId) {
        setCodexModelSwitchSessionId(null);
      }

      setCodexModel(nextModel);
    },
    [
      codexModelSwitchSessionId,
      effectiveProvider,
      selectedSession?.__provider,
      selectedSession?.id,
      codexModel,
      setCodexModel,
    ],
  );

  const persistSessionModelState = useCallback(
    async (patch: { provider?: Provider; model?: string; reasoningEffort?: string; thinkingLevel?: string }) => {
      if (
        !selectedSession?.id
        || isUnsavedSessionId(selectedSession.id)
      ) {
        return;
      }

      const { projectName, projectPath } = resolveSessionConfigTarget(selectedProject, selectedSession);
      if (!projectName || !projectPath) {
        return;
      }

      const nextProvider = patch.provider || effectiveProvider;
      const currentSelection = {
        provider: selectedSession.__provider || effectiveProvider,
        model: typeof selectedSession.model === 'string' ? selectedSession.model : '',
        reasoningEffort: typeof selectedSession.reasoningEffort === 'string'
          ? selectedSession.reasoningEffort
          : undefined,
        thinkingLevel: typeof selectedSession.thinkingLevel === 'string'
          ? selectedSession.thinkingLevel
          : undefined,
      };
      const nextSelection = {
        provider: nextProvider,
        model: patch.model ?? currentSelection.model,
        reasoningEffort: patch.reasoningEffort ?? currentSelection.reasoningEffort,
        thinkingLevel: patch.thinkingLevel ?? currentSelection.thinkingLevel,
      };
      if (!hasSessionControlChanged(currentSelection, nextSelection)) {
        return;
      }

      try {
        const response = await api.updateSessionModelState(projectName, selectedSession.id, {
          projectPath,
          provider: nextProvider,
          ...patch,
        });
        if (!response.ok) {
          console.warn('Failed to persist session model state:', response.status);
        }
      } catch (error) {
        // Transient network failure (e.g. page navigation abort during Vite HMR
        // reload, Playwright page transition) — the state will be re-synced on
        // next load or the next model change.  Not a real error.
        console.warn('Non-critical: failed to persist session model state (will retry on next change):', error);
      }
    },
    [
      effectiveProvider,
      selectedProject,
      selectedSession,
    ],
  );

  const handleSetCodexReasoningEffort = useCallback(
    (nextEffort: string) => {
      setCodexReasoningEffort(nextEffort);
      void persistSessionModelState({
        model: codexModel,
        reasoningEffort: nextEffort,
      }).catch((error) => {
        console.error('Failed to persist Codex reasoning effort:', error);
      });
    },
    [
      codexModel,
      persistSessionModelState,
      setCodexReasoningEffort,
    ],
  );

  const handleSetPiModel = useCallback(
    (nextModel: string) => {
      if (nextModel === piModel) return;
      setPiModel(nextModel);
      void persistSessionModelState({
        provider: 'pi',
        model: nextModel,
        thinkingLevel: piThinkingLevel,
      }).catch((error) => {
        console.error('Failed to persist Pi model:', error);
      });
    },
    [
      persistSessionModelState,
      piModel,
      piThinkingLevel,
      setPiModel,
    ],
  );

  const handleSetPiThinkingLevel = useCallback(
    (nextLevel: string) => {
      if (nextLevel === piThinkingLevel) return;
      setPiThinkingLevel(nextLevel);
      void persistSessionModelState({
        provider: 'pi',
        model: piModel,
        thinkingLevel: nextLevel,
      }).catch((error) => {
        console.error('Failed to persist Pi thinking level:', error);
      });
    },
    [
      persistSessionModelState,
      piModel,
      piThinkingLevel,
      setPiThinkingLevel,
    ],
  );

  useEffect(() => {
    if (
      !selectedSession?.id
      || isUnsavedSessionId(selectedSession.id)
    ) {
      return;
    }

    const { projectName, projectPath } = resolveSessionConfigTarget(selectedProject, selectedSession);
    if (!projectName || !projectPath) {
      return;
    }

    const sessionId = selectedSession.id;

    /**
     * Pull the authoritative model controls for the active provider session.
     */
    const syncSessionModelState = async () => {
      try {
        const response = await api.sessionModelState(projectName, sessionId, projectPath);
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        const model = typeof payload?.state?.model === 'string' ? payload.state.model.trim() : '';
        const reasoningEffort = typeof payload?.state?.reasoningEffort === 'string'
          ? payload.state.reasoningEffort.trim()
          : '';
        const thinkingLevel = typeof payload?.state?.thinkingLevel === 'string'
          ? payload.state.thinkingLevel.trim()
          : '';

        if (effectiveProvider === 'codex' && model && model !== codexModelRef.current) {
          setCodexModel(model);
        }
        if (effectiveProvider === 'codex' && reasoningEffort && reasoningEffort !== codexReasoningEffortRef.current) {
          setCodexReasoningEffort(reasoningEffort);
        }
        if (effectiveProvider === 'pi' && model && model !== piModelRef.current) {
          setPiModel(model);
        }
        if (effectiveProvider === 'pi' && thinkingLevel && thinkingLevel !== piThinkingLevelRef.current) {
          setPiThinkingLevel(thinkingLevel);
        }
      } catch (error) {
        console.error('Failed to sync session model state:', error);
      }
    };

    void syncSessionModelState();
  }, [
    effectiveProvider,
    selectedSession?.id,
    selectedSession?.__projectName,
    selectedSession?.projectPath,
  ]);

  const handleCodexModelSwitchComplete = useCallback(() => {
    setCodexModelSwitchSessionId(null);
  }, []);

  useEffect(() => {
    if (!codexModelSwitchSessionId) {
      return;
    }

    if (
      !selectedSession?.id
      || selectedSession.id !== codexModelSwitchSessionId
      || selectedSession.__provider !== 'codex'
    ) {
      setCodexModelSwitchSessionId(null);
    }
  }, [selectedSession?.id, selectedSession?.__provider, codexModelSwitchSessionId]);

  const reviewLaunchSessionId = selectedSession?.id || currentSessionId || '';
  const reviewLaunchTurnOutcome = reviewLaunchSessionId ? workflowTurnOutcomes[reviewLaunchSessionId] : undefined;

  useEffect(() => {
    const workflowId = workflowSessionContext.workflowId;
    const workflowStageKey = workflowSessionContext.workflowStageKey || '';
    const activeSessionId = reviewLaunchSessionId;

    if (
      !workflowId
      || workflowStageKey !== 'execution'
      || !activeSessionId
      || reviewLaunchTurnOutcome !== 'failed'
    ) {
      return;
    }

    const failureKey = `${workflowId}:${activeSessionId}`;
    if (surfacedWorkflowApplyFailuresRef.current.has(failureKey)) {
      return;
    }
    surfacedWorkflowApplyFailuresRef.current.add(failureKey);

    setChatMessages((previous) => [
      ...previous,
      {
        type: 'error',
        content: '本次 apply 未成功完成，工作流不会自动进入审核。请人工检查失败原因并决定是否重试或介入处理。',
        timestamp: new Date(),
      },
    ]);
  }, [reviewLaunchSessionId, reviewLaunchTurnOutcome, setChatMessages, workflowSessionContext]);

  useChatRealtimeHandlers({
    messageHistory,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setActiveTurnStartedAt,
    setCanAbortSession,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    sendMessage,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive,
    onReplaceTemporarySession,
    onNavigateToSession,
    codexModelSwitchSessionId,
    loadSessionMessages,
    onCodexModelSwitchComplete: handleCodexModelSwitchComplete,
    onTurnOutcome: ({ sessionId, status }) => {
      if (!sessionId) {
        return;
      }

      setWorkflowTurnOutcomes((previous) => {
        if (previous[sessionId] === status) {
          return previous;
        }
        return {
          ...previous,
          [sessionId]: status,
        };
      });
    },
    onRawMessage: (message) => {
      if (
        message.type === 'session-model-state-updated'
        && message.sessionId === selectedSession?.id
      ) {
        const state = message.state && typeof message.state === 'object' ? message.state : {};
        const model = typeof state.model === 'string' ? state.model.trim() : '';
        const reasoningEffort = typeof state.reasoningEffort === 'string' ? state.reasoningEffort.trim() : '';
        const thinkingLevel = typeof state.thinkingLevel === 'string' ? state.thinkingLevel.trim() : '';
        const messageProvider = projectSessionProvider
          || (message.provider === 'codex' || message.provider === 'pi' ? message.provider : effectiveProvider);
        if (messageProvider === 'codex' && model && model !== codexModel) {
          setCodexModel(model);
        }
        if (messageProvider === 'codex' && reasoningEffort && reasoningEffort !== codexReasoningEffort) {
          setCodexReasoningEffort(reasoningEffort);
        }
        if (messageProvider === 'pi' && model && model !== piModel) {
          setPiModel(model);
        }
        if (messageProvider === 'pi' && thinkingLevel && thinkingLevel !== piThinkingLevel) {
          setPiThinkingLevel(thinkingLevel);
        }
      }

      if (message.type === 'session-queue-state' && message.provider === 'pi') {
        const nextQueueState = buildPiQueueState(message);
        if (isPiQueueForActiveSession(nextQueueState, currentSessionId, selectedSession?.id)) {
          setPiQueueState(nextQueueState);
        }
      }

      if (!awaitingBackendResponseRef.current) {
        return;
      }

      if (!isBackendResponseMessage(message.type)) {
        return;
      }

      awaitingBackendResponseRef.current = false;
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
        pendingNetworkTimeoutRef.current = null;
      }
    },
  });

  useEffect(() => {
    return () => {
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
        pendingNetworkTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    /**
     * PURPOSE: Tell the backend which route-backed session this browser window
     * is viewing so private realtime events can be delivered by subscription
     * instead of broad same-user broadcast.
     */
    const routeSessionId = Number.isInteger(Number(selectedSession?.routeIndex))
      ? `c${Number(selectedSession?.routeIndex)}`
      : isCbwRouteSessionId(selectedSession?.id || '')
        ? selectedSession?.id || ''
        : '';
    const sessionId = routeSessionId || selectedSession?.id || currentSessionId || '';
    if (!sessionId || isTemporarySessionId(sessionId)) {
      return;
    }

    sendMessage({
      type: 'subscribe-session',
      provider: effectiveProvider === 'pi' ? 'pi' : 'codex',
      sessionId,
      ozwSessionId: routeSessionId,
      ozw_session_id: routeSessionId,
      projectName: selectedSession?.__projectName || selectedProject?.name || '',
      projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
      providerSessionId: selectedSession?.providerSessionId || (!routeSessionId ? selectedSession?.id || '' : ''),
    });
  }, [
    currentSessionId,
    effectiveProvider,
    selectedProject?.fullPath,
    selectedProject?.name,
    selectedProject?.path,
    selectedSession?.__projectName,
    selectedSession?.id,
    selectedSession?.projectPath,
    selectedSession?.providerSessionId,
    selectedSession?.routeIndex,
    sendMessage,
  ]);

  useEffect(() => {
    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
    const activeRouteSessionId = Number.isInteger(Number(selectedSession?.routeIndex))
      ? `c${Number(selectedSession?.routeIndex)}`
      : null;
    const statusSessionId = activeRouteSessionId || activeViewSessionId;

    if (!statusSessionId || (isTemporarySessionId(statusSessionId) && !activeRouteSessionId)) {
      return;
    }

    const statusProvider = effectiveProvider === 'pi' ? 'pi' : 'codex';
    const statusProjectPath = selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '';
    const reconcileKey = [
      statusProvider,
      statusSessionId,
      activeRouteSessionId || '',
      statusProjectPath,
    ].join('|');

    if (statusReconcileKeyRef.current === reconcileKey && !isLoading) {
      return;
    }

    if (canAbortSession && statusReconcileKeyRef.current === reconcileKey) {
      return;
    }

    statusReconcileKeyRef.current = reconcileKey;

    // Run once; completion and transcript changes arrive through scoped events.
    sendMessage({
      type: 'check-session-status',
      sessionId: statusSessionId,
      ozwSessionId: activeRouteSessionId,
      ozw_session_id: activeRouteSessionId,
      provider: statusProvider,
      projectPath: statusProjectPath,
    });

    // 不做固定周期轮询，重连/事件会触发下一次校准
  }, [
    canAbortSession,
    currentSessionId,
    isLoading,
    effectiveProvider,
    selectedProject?.fullPath,
    selectedProject?.path,
    selectedSession?.id,
    selectedSession?.projectPath,
    selectedSession?.routeIndex,
    sendMessage,
  ]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!activeSearchTarget || !selectedSession?.id) {
      return;
    }

    const hasTargetMessage = chatMessages.some((message) => message.messageKey === activeSearchTarget.messageKey);
    if (hasTargetMessage) {
      revealLoadedMessage(activeSearchTarget.messageKey);
      return;
    }
    if (isLoadingMoreMessages || isLoadingAllMessages || allMessagesLoaded) {
      return;
    }

    void loadMessagesUntilTarget({ messageKey: activeSearchTarget.messageKey });
  }, [
    activeSearchTarget,
    allMessagesLoaded,
    chatMessages,
    isLoadingMoreMessages,
    isLoadingAllMessages,
    loadMessagesUntilTarget,
    revealLoadedMessage,
    selectedSession?.id,
  ]);

  useEffect(() => {
    const clearHighlights = () => {
      document.querySelectorAll('.chat-search-highlight').forEach((element) => {
        const parent = element.parentNode;
        if (!parent) {
          return;
        }

        parent.replaceChild(document.createTextNode(element.textContent || ''), element);
        parent.normalize();
      });
    };

    clearHighlights();

    if (!activeSearchTarget || !selectedSession?.id) {
      return;
    }

    const selector = `.chat-message[data-message-key="${CSS.escape(activeSearchTarget.messageKey)}"]`;
    const retrySearchHighlight = () => {
      if (searchHighlightRetry >= 60) {
        return undefined;
      }

      const retryHandle = window.setTimeout(() => {
        setSearchHighlightRetry((attempt) => attempt + 1);
      }, 100);
      return () => {
        window.clearTimeout(retryHandle);
      };
    };

    const targetElement = document.querySelector<HTMLElement>(selector);
    if (!targetElement) {
      return retrySearchHighlight();
    }

    targetElement.scrollIntoView({ block: 'center', behavior: 'auto' });

    const query = activeSearchTarget.query.trim();
    if (!query) {
      return;
    }

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent || parent.closest('.chat-search-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(escapedQuery, 'gi');

    let didHighlight = false;
    textNodes.forEach((textNode) => {
      const textContent = textNode.nodeValue || '';
      matcher.lastIndex = 0;
      if (!matcher.test(textContent)) {
        return;
      }

      matcher.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of textContent.matchAll(matcher)) {
        const startIndex = match.index ?? 0;
        if (startIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(textContent.slice(lastIndex, startIndex)));
        }

        const highlight = document.createElement('mark');
        highlight.className = 'chat-search-highlight';
        highlight.textContent = match[0];
        fragment.appendChild(highlight);
        lastIndex = startIndex + match[0].length;
      }

      if (lastIndex < textContent.length) {
        fragment.appendChild(document.createTextNode(textContent.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
      didHighlight = true;
    });

    if (!didHighlight) {
      const combinedText = textNodes.map((textNode) => textNode.nodeValue || '').join('');
      const combinedMatchIndex = combinedText.toLowerCase().indexOf(query.toLowerCase());
      if (combinedMatchIndex >= 0) {
        let cursor = 0;
        let startNode: Text | null = null;
        let startOffset = 0;
        let endNode: Text | null = null;
        let endOffset = 0;
        const matchEndIndex = combinedMatchIndex + query.length;

        for (const textNode of textNodes) {
          const textLength = (textNode.nodeValue || '').length;
          const nodeStart = cursor;
          const nodeEnd = cursor + textLength;

          if (!startNode && combinedMatchIndex >= nodeStart && combinedMatchIndex <= nodeEnd) {
            startNode = textNode;
            startOffset = combinedMatchIndex - nodeStart;
          }
          if (!endNode && matchEndIndex >= nodeStart && matchEndIndex <= nodeEnd) {
            endNode = textNode;
            endOffset = matchEndIndex - nodeStart;
            break;
          }

          cursor = nodeEnd;
        }

        if (startNode && endNode) {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);

          const highlight = document.createElement('mark');
          highlight.className = 'chat-search-highlight';
          highlight.appendChild(range.extractContents());
          range.insertNode(highlight);
          didHighlight = true;
        }
      }
    }

    if (!didHighlight) {
      return retrySearchHighlight();
    }

    const refreshHighlight = retrySearchHighlight();
    return () => {
      refreshHighlight?.();
      clearHighlights();
    };
  }, [activeSearchTarget, chatMessages, searchHighlightRetry, selectedSession?.id, visibleMessages]);

  useEffect(() => {
    if (hasPersistentSession) {
      return;
    }

    setIsFollowingLatest(false);
  }, [hasPersistentSession]);

  useEffect(() => {
    /**
     * Manual chat sessions should keep the newest assistant progress in view
     * while the user has explicitly enabled follow mode.
     */
    if (!isFollowingLatest || !hasPersistentSession) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom();
      setIsUserScrolledUp(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    chatMessages,
    hasPersistentSession,
    isFollowingLatest,
    scrollToBottom,
    setIsUserScrolledUp,
  ]);

  if (!selectedProject) {
    const selectedProviderLabel =
      effectiveProvider === 'codex'
        ? t('messageTypes.codex')
        : effectiveProvider === 'pi'
          ? t('messageTypes.pi')
          : t('messageTypes.codex');

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">
              {t('projectSelection.startChatWithProvider', {
                provider: selectedProviderLabel,
                defaultValue: 'Select a project to start chatting with {{provider}}',
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onKeyDown={handleTranscriptKeyDown}
          isLoadingSessionMessages={isLoadingSessionMessages}
          sessionMessagesError={sessionMessagesError}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={effectiveProvider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          codexModel={codexModel}
          setCodexModel={handleSetCodexModel}
          codexModelOptions={codexModelOptions}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={handleSetCodexReasoningEffort}
          codexReasoningOptions={codexReasoningOptions}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
        />

        <ChatComposer
          isLoading={isLoading}
          isComposerSubmitting={isComposerSubmitting}
          onAbortSession={handleAbortSession}
          provider={effectiveProvider}
          codexModel={codexModel}
          setCodexModel={handleSetCodexModel}
          codexModelOptions={codexModelOptions}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={handleSetCodexReasoningEffort}
          codexReasoningOptions={codexReasoningOptions}
          piModel={piModel}
          setPiModel={handleSetPiModel}
          piModelOptions={piModelOptions}
          piThinkingLevel={piThinkingLevel}
          setPiThinkingLevel={handleSetPiThinkingLevel}
          piThinkingOptions={piThinkingOptions}
          piQueueState={activePiQueueState}
          piUnavailableMessage={piUnavailableMessage}
          activeTurnStartedAt={activeTurnStartedAt}
          onToggleCommandMenu={handleToggleCommandMenu}
          onToggleFileMenu={openFileDropdown}
          hasMessages={chatMessages.length > 0 || visibleMessages.length > 0 || sessionMessages.length > 0}
          isFollowingLatest={isFollowingLatest}
          onToggleFollowLatest={() => {
            setIsFollowingLatest((current) => {
              const next = !current;
              if (next) {
                scrollToBottomAndReset();
                setIsUserScrolledUp(false);
              }
              return next;
            });
          }}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedUploads={attachedUploads}
          onRemoveAttachment={(index) =>
            setAttachedUploads((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingAttachments={uploadingAttachments}
          attachmentErrors={attachmentErrors}
          showFileDropdown={showFileDropdown}
          fileSearchQuery={fileSearchQuery}
          onFileSearchQueryChange={setFileSearchQuery}
          fileTree={fileTree}
          expandedFileTreePaths={expandedFileTreePaths}
          onToggleFileTreeDirectory={toggleFileTreeDirectory}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          onFileMenuKeyDown={handleFileMentionsKeyDown}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          onAttachmentSelection={handleAttachmentSelection}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
              provider:
              effectiveProvider === 'codex'
                ? t('messageTypes.codex')
                : effectiveProvider === 'pi'
                  ? t('messageTypes.pi')
                  : t('messageTypes.codex'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          onTranscript={handleTranscript}
        />
      </div>
    </>
  );
}

export default React.memo(ChatInterface);
