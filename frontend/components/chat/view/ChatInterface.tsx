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
import { buildPiQueueState, isPiQueueForActiveSession, type PiQueueState } from '../utils/piQueueState';
import { api } from '../../../utils/api';
import { hasSessionControlChanged } from '../composer/sessionControlState';
import {
  isCbwRouteSessionId,
  isTemporarySessionId,
  resolveProjectSessionProvider,
  resolveSessionRoutingContext,
  type PendingViewSession,
} from '../session/sessionIdentity';
import { buildConversationBookmarks } from '../utils/conversationBookmarks';
import { useChatSearchNavigation } from './chatInterfaceSearchNavigation';
import { useChatStatusReconcile } from './chatInterfaceStatusReconcile';

const NETWORK_RESPONSE_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MESSAGE =
  '30 秒内没有收到服务端响应，疑似网络连接异常。请检查网络后重试。';

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
  onBookmarkControlsChange,
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
  const [bookmarkScrollTargetKey, setBookmarkScrollTargetKey] = useState<string | null>(null);

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
    codexServiceTier,
    setCodexServiceTier,
    codexServiceTierOptions,
    codexFastServiceTier,
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
    () => resolveProjectSessionProvider(selectedProject, selectedSession?.id, selectedSession),
    [selectedProject, selectedSession],
  );
  const workflowSessionContext = useMemo(
    () => resolveSessionRoutingContext(selectedProject, selectedSession, provider),
    [provider, selectedProject, selectedSession],
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
    isRealtimeConnected: Boolean(ws && ws.readyState === WebSocket.OPEN),
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
  const conversationBookmarks = useMemo(
    () => buildConversationBookmarks(chatMessages),
    [chatMessages],
  );
  const onBookmarkSelect = useCallback((messageKey: string) => {
    if (!messageKey) {
      return;
    }

    setBookmarkScrollTargetKey(messageKey);
    const hasLoadedMessage = chatMessages.some((message) => message.messageKey === messageKey);
    if (hasLoadedMessage) {
      revealLoadedMessage(messageKey);
      return;
    }

    void loadMessagesUntilTarget({ messageKey });
  }, [
    chatMessages,
    loadMessagesUntilTarget,
    revealLoadedMessage,
  ]);
  useEffect(() => {
    if (conversationBookmarks.length === 0) {
      onBookmarkControlsChange?.(null);
      return;
    }

    onBookmarkControlsChange?.({
      bookmarks: conversationBookmarks,
      onBookmarkSelect,
    });

    return () => onBookmarkControlsChange?.(null);
  }, [
    conversationBookmarks,
    onBookmarkControlsChange,
    onBookmarkSelect,
  ]);

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
    codexServiceTier,
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
        || isTemporarySessionId(selectedSession.id)
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

  const handleSetCodexServiceTier = useCallback(
    (nextServiceTier: string) => {
      setCodexServiceTier(nextServiceTier);
    },
    [
      setCodexServiceTier,
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
      || isTemporarySessionId(selectedSession.id)
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

  useChatStatusReconcile({
    canAbortSession,
    currentSessionId,
    effectiveProvider,
    isLoading,
    pendingViewSessionRef,
    selectedProjectPath: selectedProject?.fullPath || selectedProject?.path || '',
    selectedSessionId: selectedSession?.id,
    selectedSessionProjectPath: selectedSession?.projectPath || '',
    selectedSessionRouteIndex: selectedSession?.routeIndex,
    sendMessage,
    statusReconcileKeyRef,
  });

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

  useChatSearchNavigation({
    locationSearch: location.search,
    selectedSessionId: selectedSession?.id,
    chatMessages,
    visibleMessages,
    isLoadingMoreMessages,
    isLoadingAllMessages,
    allMessagesLoaded,
    searchHighlightRetry,
    setSearchHighlightRetry,
    loadMessagesUntilTarget,
    revealLoadedMessage,
  });

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
      <div className="flex-1 min-h-0 flex">
        <div className="relative min-w-0 flex-1 flex flex-col">
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
            isFollowingLatest={isFollowingLatest}
            selectedProject={selectedProject}
            scrollTargetMessageKey={bookmarkScrollTargetKey}
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
          codexServiceTier={codexServiceTier}
          setCodexServiceTier={handleSetCodexServiceTier}
          codexServiceTierOptions={codexServiceTierOptions}
          codexFastServiceTier={codexFastServiceTier}
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
      </div>
    </>
  );
}

export default React.memo(ChatInterface);
