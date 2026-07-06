/**
 * Chat interface container.
 * Coordinates the provider TUI, rendered transcript snapshots, realtime handlers, and session state.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ConversationBookmarks from './subcomponents/ConversationBookmarks';
import Shell from '../../shell/view/Shell';
import type { ChatInterfaceProps } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import type { ChatAttachment, Provider } from '../types/types';
import { api, authenticatedFetch } from '../../../utils/api';
import { validateChatAttachmentQueue } from '../composer/attachmentQueue';
import { hasSessionControlChanged } from '../composer/sessionControlState';
import { convertSessionMessages } from '../utils/messageTransforms';
import {
  getSessionLoadId,
  isCbwRouteSessionId,
  isTemporarySessionId,
  resolveProjectSessionProvider,
  resolveSessionRoutingContext,
  type PendingViewSession,
} from '../session/sessionIdentity';
import { buildConversationBookmarks } from '../utils/conversationBookmarks';
import { buildChatTuiSessionKey } from '../tui/chatTuiSessionKey';
import {
  applyUserRenderSnapshot,
  createInitialRenderSnapshotState,
} from '../session/renderSnapshotController';
import { loadSessionMessagesInPages } from '../session/sessionBulkMessageLoader';
import { useChatSearchNavigation } from './chatInterfaceSearchNavigation';
import { useChatStatusReconcile } from './chatInterfaceStatusReconcile';

const Upload = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => (
  <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth={sw || 2} fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

type TuiTerminalInputSender = (data: string) => boolean;

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
 * Resolve the upload owner used by the existing attachment API.
 */
function resolveUploadProjectName(
  selectedProject: ChatInterfaceProps['selectedProject'],
  selectedSession: ChatInterfaceProps['selectedSession'],
): string {
  /**
   * PURPOSE: Keep TUI uploads in the same project namespace as legacy chat
   * composer uploads.
   */
  return selectedSession?.__projectName || selectedProject?.name || '';
}

/**
 * Format uploaded attachment paths as one TUI input fragment.
 */
function buildTuiAttachmentPathInsertion(paths: string[]): string {
  /**
   * PURPOSE: Insert file references without newline characters so selecting a
   * file never submits the TUI prompt unexpectedly.
   */
  const mentions = paths
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .map((filePath) => `@${filePath}`)
    .join(' ');
  return mentions ? ` ${mentions} ` : '';
}

/**
 * Choose the path that should be inserted into the TUI prompt for one upload.
 */
function resolveTuiAttachmentPath(attachment: ChatAttachment): string {
  /**
   * PURPOSE: Prefer the filesystem path agents can inspect directly while
   * preserving a fallback for older attachment payloads.
   */
  if (typeof attachment.absolutePath === 'string' && attachment.absolutePath.trim()) {
    return attachment.absolutePath.trim();
  }

  return typeof attachment.relativePath === 'string' ? attachment.relativePath.trim() : '';
}

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  messageHistory,
  onFileOpen,
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
  renderSnapshotRequestId = 0,
}: ChatInterfaceProps) {
  const { t } = useTranslation('chat');
  const location = useLocation();

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const dispatchedSessionAutoInitsRef = useRef<Set<string>>(new Set());
  const surfacedWorkflowApplyFailuresRef = useRef<Set<string>>(new Set());
  const statusReconcileKeyRef = useRef<string | null>(null);
  const tuiTerminalInputRef = useRef<TuiTerminalInputSender | null>(null);
  const tuiUploadInputRef = useRef<HTMLInputElement>(null);
  const renderedSnapshotTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [workflowTurnOutcomes, setWorkflowTurnOutcomes] = useState<Record<string, 'completed' | 'failed'>>({});
  const [isFollowingLatest, setIsFollowingLatest] = useState(false);
  const [searchHighlightRetry, setSearchHighlightRetry] = useState(0);
  const [, setActiveTurnStartedAt] = useState<string | null>(null);
  const [bookmarkScrollTargetKey, setBookmarkScrollTargetKey] = useState<string | null>(null);
  const [isRenderingSnapshot, setIsRenderingSnapshot] = useState(false);
  const [, setRenderedSnapshotInput] = useState('');
  const [isUploadingTuiAttachment, setIsUploadingTuiAttachment] = useState(false);
  const [tuiUploadError, setTuiUploadError] = useState('');

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
    piThinkingLevel,
    setPiThinkingLevel,
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
  const [codexModelSwitchSessionId, setCodexModelSwitchSessionId] = useState<string | null>(null);
  const codexModelRef = useRef(codexModel);
  codexModelRef.current = codexModel;
  const codexReasoningEffortRef = useRef(codexReasoningEffort);
  codexReasoningEffortRef.current = codexReasoningEffort;
  const piModelRef = useRef(piModel);
  piModelRef.current = piModel;
  const piThinkingLevelRef = useRef(piThinkingLevel);
  piThinkingLevelRef.current = piThinkingLevel;

  const chatTuiSessionKey = useMemo(() => {
    const routeSessionId = Number.isInteger(Number(selectedSession?.routeIndex))
      ? `c${Number(selectedSession?.routeIndex)}`
      : isCbwRouteSessionId(selectedSession?.id || '')
        ? selectedSession?.id || ''
        : null;
    const providerSessionId = typeof selectedSession?.providerSessionId === 'string' && selectedSession.providerSessionId.trim()
      ? selectedSession.providerSessionId.trim()
      : typeof selectedSession?.id === 'string' && selectedSession.id.trim()
        ? selectedSession.id.trim()
        : null;

    return buildChatTuiSessionKey({
      projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
      provider: effectiveProvider === 'pi' ? 'pi' : 'codex',
      routeSessionId,
      providerSessionId,
    });
  }, [
    effectiveProvider,
    selectedProject?.fullPath,
    selectedProject?.path,
    selectedSession?.id,
    selectedSession?.projectPath,
    selectedSession?.providerSessionId,
    selectedSession?.routeIndex,
  ]);
  const [renderSnapshotState, setRenderSnapshotState] = useState(() =>
    createInitialRenderSnapshotState({ tuiSessionKey: chatTuiSessionKey }),
  );

  useEffect(() => {
    setRenderSnapshotState(createInitialRenderSnapshotState({ tuiSessionKey: chatTuiSessionKey }));
  }, [chatTuiSessionKey]);

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    setSessionMessages,
    sessionMessagesError,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    setIsUserScrolledUp,
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
    renderSnapshotState,
    resetStreamingState,
    pendingViewSessionRef,
  });
  const hasPersistentSession = Boolean(
    (selectedSession?.id && !isTemporarySessionId(selectedSession.id))
    || (currentSessionId && !isTemporarySessionId(currentSessionId)),
  );
  const conversationBookmarks = useMemo(
    () => buildConversationBookmarks(chatMessages),
    [chatMessages],
  );
  const renderedSnapshotBookmarks = useMemo(
    () => buildConversationBookmarks(renderSnapshotState.snapshotMessages as any[]),
    [renderSnapshotState.snapshotMessages],
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
  const handleRenderSnapshot = useCallback(async () => {
    setIsRenderingSnapshot(true);
    try {
      const projectName = selectedSession?.__projectName || selectedProject?.name || '';
      const sessionId = getSessionLoadId(selectedSession) || currentSessionId || '';
      const projectPath = selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '';
      if (!projectName || !sessionId) {
        setRenderSnapshotState((previous) =>
          applyUserRenderSnapshot(previous, {
            messages: [],
            loadedAt: new Date().toISOString(),
          }),
        );
        return;
      }

      const { messages } = await loadSessionMessagesInPages({
        sessionMessages: api.sessionMessages,
        projectName,
        sessionId,
        provider: effectiveProvider === 'pi' ? 'pi' : 'codex',
        projectPath,
      });
      const snapshotMessages = convertSessionMessages(Array.isArray(messages) ? messages : []);
      setRenderSnapshotState((previous) =>
        applyUserRenderSnapshot(previous, {
          messages: snapshotMessages as any[],
          loadedAt: new Date().toISOString(),
        }),
      );
    } finally {
      setIsRenderingSnapshot(false);
    }
  }, [
    currentSessionId,
    effectiveProvider,
    selectedProject?.fullPath,
    selectedProject?.name,
    selectedProject?.path,
    selectedSession,
  ]);

  useEffect(() => {
    /**
     * The top-level Messages tab is the single entry for rendering a transcript
     * snapshot, so the TUI toolbar does not need a second Render button.
     */
    if (renderSnapshotRequestId <= 0 || !selectedSession) {
      return;
    }

    void handleRenderSnapshot();
  }, [handleRenderSnapshot, renderSnapshotRequestId, selectedSession]);

  useEffect(() => {
    /**
     * Rendering from the Messages tab should land on the newest transcript
     * content, matching the TUI tail-first workflow instead of showing history
     * from the top.
     */
    if (renderSnapshotState.mode !== 'renderedSnapshot') {
      return undefined;
    }

    let secondFrameId: number | null = null;
    const focusTail = () => {
      scrollToBottom();
      scrollContainerRef.current?.focus({ preventScroll: true });
    };
    const firstFrameId = window.requestAnimationFrame(() => {
      focusTail();
      secondFrameId = window.requestAnimationFrame(focusTail);
    });

    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
    };
  }, [
    renderSnapshotState.mode,
    renderSnapshotState.snapshotMessages.length,
    renderSnapshotState.snapshotVersion,
    scrollContainerRef,
    scrollToBottom,
  ]);

  const handleTuiTerminalInputReady = useCallback((sendInput: TuiTerminalInputSender | null) => {
    /**
     * PURPOSE: Store the active PTY sender so upload controls can insert paths
     * into whichever TUI instance is currently mounted.
     */
    tuiTerminalInputRef.current = sendInput;
  }, []);

  const handleTuiAttachmentUpload = useCallback(async (files: File[]) => {
    /**
     * PURPOSE: Persist selected browser files, then insert their saved paths
     * into the TUI input line instead of sending a legacy web chat message.
     */
    const { accepted, rejected } = validateChatAttachmentQueue(files);
    if (accepted.length === 0) {
      setTuiUploadError(rejected[0]?.reason || t('input.noAttachmentSelected', { defaultValue: '未选择文件' }));
      return;
    }

    const projectName = resolveUploadProjectName(selectedProject, selectedSession);
    if (!projectName) {
      setTuiUploadError(t('input.uploadProjectMissing', { defaultValue: '无法确定上传项目' }));
      return;
    }

    setIsUploadingTuiAttachment(true);
    setTuiUploadError('');

    try {
      const formData = new FormData();
      accepted.forEach((file) => {
        formData.append('attachments', file);
      });
      formData.append('relativePaths', JSON.stringify(
        accepted.map((file) => file.webkitRelativePath || file.name),
      ));

      const response = await authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/upload-attachments`, {
        method: 'POST',
        headers: {},
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json() as { attachments?: ChatAttachment[] };
      const uploadedPaths = (Array.isArray(result.attachments) ? result.attachments : [])
        .map(resolveTuiAttachmentPath)
        .filter(Boolean);
      const insertion = buildTuiAttachmentPathInsertion(uploadedPaths);
      if (!insertion) {
        throw new Error(t('input.uploadPathMissing', { defaultValue: '上传成功但未返回文件路径' }));
      }

      const sent = tuiTerminalInputRef.current?.(insertion) || false;
      if (!sent) {
        setTuiUploadError(t('input.tuiNotReady', { defaultValue: 'TUI 未连接，文件已上传但路径未插入' }));
        return;
      }

      if (rejected.length > 0) {
        setTuiUploadError(t('input.uploadPartialRejected', {
          count: rejected.length,
          defaultValue: `${rejected.length} 个文件未上传`,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('input.uploadFailed', { defaultValue: '上传失败' });
      setTuiUploadError(message);
    } finally {
      setIsUploadingTuiAttachment(false);
    }
  }, [selectedProject, selectedSession, t]);

  const handleTuiAttachmentSelection = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    /**
     * PURPOSE: Reset the file input after every pick so selecting the same file
     * twice still triggers a browser change event.
     */
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    void handleTuiAttachmentUpload(files);
  }, [handleTuiAttachmentUpload]);

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

    },
  });

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

  const tuiHeaderActions = (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={tuiUploadInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-tui-upload-input"
        onChange={handleTuiAttachmentSelection}
      />
      {tuiUploadError && (
        <span
          className="hidden max-w-[180px] truncate text-xs text-red-600 dark:text-red-300 md:inline"
          title={tuiUploadError}
        >
          {tuiUploadError}
        </span>
      )}
      <button
        type="button"
        data-testid="chat-tui-upload-attachment-button"
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
        disabled={isUploadingTuiAttachment}
        title={t('input.uploadImageOrFile', { defaultValue: '上传图片/文件' })}
        onClick={() => tuiUploadInputRef.current?.click()}
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={2} />
        <span className="hidden sm:inline">
          {isUploadingTuiAttachment
            ? t('input.uploading', { defaultValue: '上传中' })
            : t('input.uploadImageOrFile', { defaultValue: '上传图片/文件' })}
        </span>
      </button>
    </div>
  );

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
          <div
            data-testid="chat-tui-panel"
            data-tui-session-key={renderSnapshotState.tuiSessionKey}
            data-provider={effectiveProvider === 'pi' ? 'pi' : 'codex'}
            data-connection-state="mounted"
            className={renderSnapshotState.mode === 'tui' ? 'min-h-0 flex-1' : 'hidden'}
          >
            <div className="flex h-full min-h-0 flex-col">
              <Shell
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                provider={effectiveProvider === 'pi' ? 'pi' : 'codex'}
                autoConnect
                headerActions={tuiHeaderActions}
                onTerminalInputReady={handleTuiTerminalInputReady}
              />
            </div>
          </div>

          {renderSnapshotState.mode === 'renderedSnapshot' && (
            <div
              data-testid="chat-rendered-snapshot-pane"
              data-snapshot-version={renderSnapshotState.snapshotVersion}
              data-display-mode={renderSnapshotState.mode}
              className="relative min-h-0 flex-1 flex flex-col"
            >
              <ConversationBookmarks
                bookmarks={renderedSnapshotBookmarks}
                onBookmarkSelect={onBookmarkSelect}
                placement="floating"
              />
              <ChatMessagesPane
            scrollContainerRef={scrollContainerRef}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onKeyDown={handleTranscriptKeyDown}
            isLoadingSessionMessages={isLoadingSessionMessages}
            sessionMessagesError={sessionMessagesError}
            chatMessages={renderSnapshotState.snapshotMessages as any[]}
            selectedSession={selectedSession}
            currentSessionId={currentSessionId}
            provider={effectiveProvider}
            setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
            textareaRef={renderedSnapshotTextareaRef}
            codexModel={codexModel}
            setCodexModel={handleSetCodexModel}
            codexModelOptions={codexModelOptions}
            codexReasoningEffort={codexReasoningEffort}
            setCodexReasoningEffort={handleSetCodexReasoningEffort}
            codexReasoningOptions={codexReasoningOptions}
            setInput={setRenderedSnapshotInput}
            isLoadingMoreMessages={isLoadingMoreMessages}
            hasMoreMessages={hasMoreMessages}
            totalMessages={totalMessages}
            visibleMessageCount={visibleMessageCount}
            visibleMessages={renderSnapshotState.snapshotMessages as any[]}
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
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default React.memo(ChatInterface);
