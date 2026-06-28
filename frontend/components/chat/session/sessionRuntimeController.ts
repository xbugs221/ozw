/**
 * PURPOSE: Manage chat session history loading, pagination, and view state.
 * Session API routing must honor merged worktree sessions that keep their
 * original Claude project directory in `selectedSession.__projectName`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatMessage } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { safeLocalStorage } from '../utils/chatStorage';
import { dedupeAdjacentChatMessages } from '../utils/messageDedup';
import { chatMessageReducer } from '../state/chatMessageReducer';
import {
  buildVisibleMessageWindow,
  getVisibleWindowMessageKey,
} from './chatSessionLifecycleController';
import {
  dedupeSessionMessagesByIdentity,
  getSessionMessageIdentity,
  getUniqueIncomingSessionMessages,
  mergeSessionMessagesByIdentityPreservingOrder,
} from '../utils/sessionMessageDedup';
import {
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';
import { getIntrinsicMessageKey } from '../utils/messageKeys';
import { filterRenderableMessages } from '../utils/nativeRuntimeTranscript';
import {
  isNativeLiveTurnMessage,
  shouldPreserveAcceptedOptimisticUser,
  shouldDeferFollowLatestRefresh,
} from '../utils/liveTurnMergePolicy';
import {
  createInitialSessionMessageWindow,
  createOlderSessionMessageWindow,
  resolveSessionMessageRawLineCursor,
  SESSION_MESSAGES_PER_PAGE,
} from './sessionMessageLoader';
import { loadSessionMessagesInPages } from './sessionBulkMessageLoader';
import {
  getSessionRecoveryStorageKey,
  trimSessionRecoveryMessages,
} from './sessionRecoveryStore';
import {
  captureSessionScrollSnapshot,
  restoreSessionScrollTop,
  type SessionScrollSnapshot,
} from './sessionScrollAnchor';
import {
  isCurrentSessionLoadGeneration,
  nextSessionLoadGeneration,
} from './terminalReconcileController';
import {
  getSessionLoadId,
  getSessionViewIdentityKey,
  isTemporarySessionId,
  resolveSessionProvider,
  resolveSessionRoutingContext,
  type PendingViewSession,
} from './sessionIdentity';

const INITIAL_VISIBLE_MESSAGES = 100;
const MIN_HISTORY_PREFETCH_DISTANCE_PX = 240;
const HISTORY_PREFETCH_UNLOCK_DISTANCE_PX = 100;

export interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sendMessage: (message: unknown) => void;
  isFollowingLatest?: boolean;
  isRealtimeConnected?: boolean;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
}

type LoadAllMessagesOptions = {
  reveal?: boolean;
  silent?: boolean;
};

type LoadMessagesUntilTargetOptions = {
  messageKey: string;
};

/**
 * Resolve the backend project name for a session.
 */
function getSessionProjectName(selectedProject: Project | null, selectedSession: ProjectSession | null): string {
  return resolveSessionRoutingContext(selectedProject, selectedSession).projectName;
}

/**
 * Resolve a stable key for anchoring a frozen transcript tail.
 */
function getViewMessageKey(message: ChatMessage, index: number): string {
  return getVisibleWindowMessageKey(message, index);
}

/**
 * Decide whether the scroll position is inside the older-history prefetch zone.
 */
export function isInsideHistoryPrefetchZone(container: Pick<HTMLDivElement, 'scrollTop' | 'clientHeight'>): boolean {
  const prefetchDistance = Math.max(MIN_HISTORY_PREFETCH_DISTANCE_PX, Math.floor(container.clientHeight));
  return container.scrollTop <= prefetchDistance;
}

/**
 * Detect native live rows that must survive draft-to-session hydration.
 */
export function useChatSessionState({
  selectedProject,
  selectedSession,
  sendMessage,
  isFollowingLatest = false,
  isRealtimeConnected = false,
  autoScrollToBottom,
  externalMessageUpdate,
  resetStreamingState,
  pendingViewSessionRef,
}: UseChatSessionStateArgs) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const recoveryStorageKey = getSessionRecoveryStorageKey(selectedProject.name);
      const saved = safeLocalStorage.getItem(recoveryStorageKey);
      if (saved) {
        try {
          return dedupeAdjacentChatMessages(JSON.parse(saved) as ChatMessage[]) as ChatMessage[];
        } catch {
          console.error('Failed to parse saved chat messages, resetting');
          safeLocalStorage.removeItem(recoveryStorageKey);
          return [];
        }
      }
      return [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [sessionMessagesError, setSessionMessagesError] = useState<string | null>(null);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [frozenTailMessageKey, setFrozenTailMessageKey] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const isLoadingAllMessagesRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<SessionScrollSnapshot | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter to discard stale loadSessionMessages results when sessions change quickly.
  const sessionLoadGenRef = useRef(0);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionMessagesStateRef = useRef<any[]>(sessionMessages);
  const sessionMessagesRef = useRef<any[]>(sessionMessages);
  const chatMessagesRef = useRef<ChatMessage[]>(chatMessages);
  const hasMoreMessagesRef = useRef(hasMoreMessages);
  const totalMessagesRef = useRef(totalMessages);
  const isUserScrolledUpRef = useRef(isUserScrolledUp);
  const lastHydratedSessionIdRef = useRef<string | null>(null);
  const lastHydratedSessionViewKeyRef = useRef<string | null>(null);
  const chatMergeSessionKeyRef = useRef<string | null>(null);
  const previousSelectedSessionIdRef = useRef<string | null>(null);
  const previousSelectedSessionViewKeyRef = useRef<string | null>(null);
  const frozenTailMessageKeyRef = useRef<string | null>(null);
  const latestTouchYRef = useRef<number | null>(null);
  const refreshLatestMessagesRef = useRef<() => Promise<void>>(async () => {});
  const isFollowingLatestRef = useRef(isFollowingLatest);
  /** Latest raw JSONL line seen by bottom refreshes. */
  const latestRawLineCursorRef = useRef<number | null>(null);
  if (sessionMessagesStateRef.current !== sessionMessages) {
    sessionMessagesStateRef.current = sessionMessages;
    sessionMessagesRef.current = sessionMessages;
  }
  chatMessagesRef.current = chatMessages;
  hasMoreMessagesRef.current = hasMoreMessages;
  totalMessagesRef.current = totalMessages;
  isUserScrolledUpRef.current = isUserScrolledUp;
  frozenTailMessageKeyRef.current = frozenTailMessageKey;
  isFollowingLatestRef.current = isFollowingLatest;

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);
  const selectedSessionViewKey = useMemo(
    () => getSessionViewIdentityKey(selectedProject, selectedSession),
    [selectedProject, selectedSession],
  );

  const advanceLatestRawLineCursor = useCallback((messages: unknown[], nextRawLineOffset: number | null) => {
    /**
     * Bottom refreshes need the newest raw provider line, while top pagination
     * keeps using messagesOffsetRef as a loaded-history window cursor.
     */
    const cursor = resolveSessionMessageRawLineCursor(messages, nextRawLineOffset);
    if (cursor === null) {
      return;
    }
    latestRawLineCursorRef.current = Math.max(latestRawLineCursorRef.current ?? 0, cursor);
  }, []);

  /**
   * Fetch a session message window without mutating local pagination state.
   */
  const fetchSessionMessages = useCallback(
    async (
      projectName: string,
      sessionId: string,
      limit: number | null,
      offset = 0,
      provider: string = 'codex',
      afterLine: number | null = null,
      afterCursor: string | null = null,
      projectPath: string = '',
    ) => {
      if (!projectName || !sessionId) {
        return {
          messages: [] as any[],
          total: 0,
          hasMore: false,
          tokenUsage: null as Record<string, unknown> | null,
          error: null as string | null,
          appendCursor: null as string | null,
          nextRawLineOffset: null as number | null,
        };
      }

      try {
        const response = await (api.sessionMessages as any)(
          projectName,
          sessionId,
          limit,
          offset,
          provider,
          afterLine,
          afterCursor,
          projectPath,
        );
        if (!response.ok) {
          throw new Error('Failed to load session messages');
        }

        const data = await response.json();
        const messages = Array.isArray(data?.messages)
          ? data.messages
          : (Array.isArray(data) ? data : []);

        return {
          messages,
          total: Number.isFinite(Number(data?.total)) ? Number(data.total) : messages.length,
          hasMore: Boolean(data?.hasMore),
          tokenUsage: (data?.tokenUsage || null) as Record<string, unknown> | null,
          error: null as string | null,
          appendCursor: (typeof data?.appendCursor === 'string' && data.appendCursor) ? data.appendCursor : null,
          nextRawLineOffset: Number.isFinite(Number(data?.nextRawLineOffset)) ? Number(data.nextRawLineOffset) : null,
        };
      } catch (error) {
        console.error('Error loading session messages:', error);
        return {
          messages: [] as any[],
          total: 0,
          hasMore: false,
          tokenUsage: null as Record<string, unknown> | null,
          error: error instanceof Error ? error.message : 'Failed to load session messages',
          appendCursor: null as string | null,
          nextRawLineOffset: null as number | null,
        };
      }
    },
    [],
  );

  const loadSessionMessages = useCallback(
    async (projectName: string, sessionId: string, loadMore = false, provider: string = 'codex', projectPath: string = '') => {
      const isInitialLoad = !loadMore;
      if (isInitialLoad) {
        setIsLoadingSessionMessages(true);
        setSessionMessagesError(null);
      } else {
        setIsLoadingMoreMessages(true);
      }

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const requestWindow = loadMore
          ? createOlderSessionMessageWindow(currentOffset)
          : createInitialSessionMessageWindow();
        const result = await fetchSessionMessages(
          projectName,
          sessionId,
          requestWindow.limit,
          requestWindow.offset,
          provider,
          requestWindow.afterLine,
          requestWindow.afterCursor,
          projectPath,
        );
        if (isInitialLoad && result.tokenUsage) {
          setTokenBudget(result.tokenUsage);
        }
        if (isInitialLoad && result.error) {
          setSessionMessagesError(result.error);
        }
        advanceLatestRawLineCursor(result.messages, result.nextRawLineOffset);

        if (result.total > 0 || result.hasMore) {
          const loadedCount = result.messages.length;
          const nextOffset = result.nextRawLineOffset ?? (currentOffset + loadedCount);
          setHasMoreMessages(result.total > 0 ? result.total > nextOffset : result.hasMore);
          setTotalMessages(result.total > 0 ? result.total : loadedCount);
          messagesOffsetRef.current = nextOffset;
          return result.messages;
        }

        const messages = result.messages;
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = result.nextRawLineOffset ?? messages.length;
        return messages;
      } finally {
        if (isInitialLoad) {
          setIsLoadingSessionMessages(false);
        } else {
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [advanceLatestRawLineCursor, fetchSessionMessages],
  );

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    frozenTailMessageKeyRef.current = null;
    isUserScrolledUpRef.current = false;
    setFrozenTailMessageKey(null);
    setIsUserScrolledUp(false);
    if (shouldDeferFollowLatestRefresh({
      messages: chatMessagesRef.current,
      isRealtimeConnected,
      isTurnRunning: isLoading || canAbortSession,
    })) {
      window.requestAnimationFrame(scrollToBottom);
    } else {
      void refreshLatestMessagesRef.current().finally(() => {
        window.requestAnimationFrame(scrollToBottom);
      });
    }
    scrollToBottom();
    if (allMessagesLoaded && !Number.isFinite(visibleMessageCount)) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
  }, [allMessagesLoaded, canAbortSession, isLoading, isRealtimeConnected, scrollToBottom, visibleMessageCount]);

  /**
   * Reset the visible chat view before a different concrete session hydrates.
   */
  const resetSessionViewState = useCallback(() => {
    resetStreamingState();
    pendingViewSessionRef.current = null;
    lastHydratedSessionViewKeyRef.current = null;
    chatMergeSessionKeyRef.current = null;
    setChatMessages([]);
    setSessionMessages([]);
    setSessionMessagesError(null);
    setIsLoading(false);
    setIsLoadingSessionMessages(false);
    setIsLoadingMoreMessages(false);
    setCanAbortSession(false);
    setTokenBudget(null);
    messagesOffsetRef.current = 0;
    latestRawLineCursorRef.current = null;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    isLoadingAllMessagesRef.current = false;
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setFrozenTailMessageKey(null);
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
    pendingInitialScrollRef.current = false;
    pendingScrollRestoreRef.current = null;
    topLoadLockRef.current = false;
  }, [pendingViewSessionRef, resetStreamingState]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const isAtHardBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    return container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
  }, []);

  const freezeTailAtCurrentEnd = useCallback(() => {
    if (isFollowingLatest || isAtHardBottom() || frozenTailMessageKeyRef.current) {
      return false;
    }

    const messages = chatMessagesRef.current;
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) {
      return false;
    }

    setFrozenTailMessageKey(getViewMessageKey(messages[lastIndex], lastIndex));
    return true;
  }, [isAtHardBottom, isFollowingLatest]);

  const releaseFrozenTail = useCallback(() => {
    if (!frozenTailMessageKeyRef.current && !isUserScrolledUpRef.current) {
      return;
    }

    frozenTailMessageKeyRef.current = null;
    isUserScrolledUpRef.current = false;
    setFrozenTailMessageKey(null);
    setIsUserScrolledUp(false);
    if (shouldDeferFollowLatestRefresh({
      messages: chatMessagesRef.current,
      isRealtimeConnected,
      isTurnRunning: isLoading || canAbortSession,
    })) {
      window.requestAnimationFrame(scrollToBottom);
    } else {
      void refreshLatestMessagesRef.current().finally(() => {
        window.requestAnimationFrame(scrollToBottom);
      });
    }
    window.requestAnimationFrame(scrollToBottom);
  }, [canAbortSession, isLoading, isRealtimeConnected, scrollToBottom]);

  const revealLoadedMessage = useCallback((messageKey: string) => {
    /**
     * Search works against all loaded messages, while visibleMessages may still
     * be a tail window. Expand the data window enough for the target to become
     * part of the virtualized transcript without rendering the whole DOM.
     */
    if (!messageKey) {
      return false;
    }

    const displayMessages = dedupeAdjacentChatMessages(chatMessagesRef.current) as ChatMessage[];
    const targetIndex = displayMessages.findIndex((message) => message.messageKey === messageKey);
    if (targetIndex < 0) {
      return false;
    }

    let endIndex = displayMessages.length;
    if (frozenTailMessageKeyRef.current) {
      const frozenIndex = displayMessages.findIndex((message, index) =>
        getViewMessageKey(message, index) === frozenTailMessageKeyRef.current,
      );
      if (frozenIndex >= 0) {
        endIndex = frozenIndex + 1;
      }
    }

    if (targetIndex >= endIndex) {
      frozenTailMessageKeyRef.current = null;
      setFrozenTailMessageKey(null);
      endIndex = displayMessages.length;
    }

    setVisibleMessageCount((previousCount) => {
      const requiredCount = Math.max(INITIAL_VISIBLE_MESSAGES, endIndex - targetIndex);
      return Number.isFinite(previousCount)
        ? Math.max(previousCount, requiredCount)
        : previousCount;
    });
    return true;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = resolveSessionProvider(selectedProject, selectedSession) || 'codex';
      const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);
      const sessionProjectPath = selectedSession.projectPath || selectedProject.fullPath || selectedProject.path || '';

      isLoadingMoreRef.current = true;
      const scrollSnapshot = captureSessionScrollSnapshot(container);
      if (!frozenTailMessageKeyRef.current) {
        const currentMessages = chatMessagesRef.current;
        const lastIndex = currentMessages.length - 1;
        if (lastIndex >= 0) {
          const frozenKey = getViewMessageKey(currentMessages[lastIndex], lastIndex);
          frozenTailMessageKeyRef.current = frozenKey;
          setFrozenTailMessageKey(frozenKey);
        }
      }

      try {
        const moreMessages = await loadSessionMessages(
          sessionProjectName,
          getSessionLoadId(selectedSession),
          true,
          sessionProvider,
          sessionProjectPath,
        );

        if (moreMessages.length === 0) {
          return false;
        }

        const uniqueMoreMessages = getUniqueIncomingSessionMessages(
          sessionMessagesRef.current,
          moreMessages,
        );

        if (uniqueMoreMessages.length === 0) {
          setHasMoreMessages(totalMessagesRef.current > messagesOffsetRef.current);
          return false;
        }

        pendingScrollRestoreRef.current = scrollSnapshot;
        setHasMoreMessages(totalMessagesRef.current > messagesOffsetRef.current);
        const nextSessionMessages = dedupeSessionMessagesByIdentity([
          ...uniqueMoreMessages,
          ...sessionMessagesRef.current,
        ]);
        sessionMessagesRef.current = nextSessionMessages;
        setSessionMessages(nextSessionMessages);
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + uniqueMoreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, loadSessionMessages, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const hardBottom = isAtHardBottom();
    if (hardBottom) {
      topLoadLockRef.current = false;
      if (frozenTailMessageKeyRef.current || isUserScrolledUpRef.current) {
        frozenTailMessageKeyRef.current = null;
        isUserScrolledUpRef.current = false;
        setFrozenTailMessageKey(null);
        setIsUserScrolledUp(false);
      }
      return;
    }

    const didFreeze = freezeTailAtCurrentEnd();
    const nextIsUserScrolledUp = !hardBottom || didFreeze || Boolean(frozenTailMessageKeyRef.current);
    isUserScrolledUpRef.current = nextIsUserScrolledUp;
    setIsUserScrolledUp(nextIsUserScrolledUp);

    if (!allMessagesLoadedRef.current) {
      const insidePrefetchZone = isInsideHistoryPrefetchZone(container);
      if (!insidePrefetchZone) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (container.scrollTop > HISTORY_PREFETCH_UNLOCK_DISTANCE_PX) {
          topLoadLockRef.current = false;
        }
        return;
      }

      const didLoad = await loadOlderMessages(container);
      if (didLoad) {
        topLoadLockRef.current = true;
      }
    }
  }, [freezeTailAtCurrentEnd, isAtHardBottom, loadOlderMessages]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY > 0 && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    latestTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY ?? null;
    const previousY = latestTouchYRef.current;
    latestTouchYRef.current = currentY;
    if (currentY === null || previousY === null) {
      return;
    }

    const isTryingToScrollDown = previousY - currentY > 0;
    if (isTryingToScrollDown && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollDownKeys = new Set(['ArrowDown', 'PageDown', 'End', ' ']);
    if (scrollDownKeys.has(event.key) && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  useLayoutEffect(() => {
    const temporarySessionId = selectedSession?.id;
    const nextSessionViewKey = selectedSessionViewKey;
    const previousSessionViewKey = previousSelectedSessionViewKeyRef.current;
    previousSelectedSessionViewKeyRef.current = nextSessionViewKey;
    if (isTemporarySessionId(temporarySessionId)) {
      const temporaryViewSessionId = temporarySessionId ?? null;
      if (lastHydratedSessionViewKeyRef.current !== nextSessionViewKey) {
        resetSessionViewState();
      }
      lastHydratedSessionIdRef.current = temporaryViewSessionId;
      lastHydratedSessionViewKeyRef.current = nextSessionViewKey;
      setCurrentSessionId(temporaryViewSessionId);
      return;
    }

    const nextSessionId = selectedSession?.id ?? null;
    const previousSessionId = previousSelectedSessionIdRef.current;
    previousSelectedSessionIdRef.current = nextSessionId;
    if (!nextSessionId) {
      if (previousSessionId || previousSessionViewKey) {
        resetSessionViewState();
        setCurrentSessionId(null);
      }
      return;
    }

    if (previousSessionId === nextSessionId && previousSessionViewKey === nextSessionViewKey) {
      return;
    }

    lastHydratedSessionIdRef.current = null;
    lastHydratedSessionViewKeyRef.current = null;
    const hasLiveNativeRealtimeTail =
      (selectedSession?.__provider === 'codex' || selectedSession?.__provider === 'pi') &&
      chatMessagesRef.current.some(isNativeLiveTurnMessage);
    const isPromotingTemporarySession =
      isSystemSessionChange &&
      isTemporarySessionId(currentSessionId) &&
      !isTemporarySessionId(nextSessionId);
    if (!isPromotingTemporarySession || !hasLiveNativeRealtimeTail) {
      resetSessionViewState();
    }

  }, [
    currentSessionId,
    isSystemSessionChange,
    resetSessionViewState,
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSessionViewKey,
  ]);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
  }, [selectedProject?.name, selectedSession?.id, selectedSessionViewKey]);

  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      return;
    }

    pendingInitialScrollRef.current = false;
    scrollToBottom();
    const animationFrameId = requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  useLayoutEffect(() => {
    if (
      !isLoading ||
      isLoadingSessionMessages ||
      frozenTailMessageKeyRef.current ||
      isUserScrolledUpRef.current
    ) {
      return;
    }

    scrollToBottom();
    const animationFrameId = requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [chatMessages.length, isLoading, isLoadingSessionMessages, scrollToBottom]);

  // 用 ref 持有最新的 selectedProject / selectedSession，effect 通过 ref 读取，
  // 依赖只关注 name/id，避免 projects_updated 导致对象引用变化时反复重载消息。
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;

  useEffect(() => {
    // Bump generation so any in-flight loadSessionMessages from a previous session is discarded.
    const gen = nextSessionLoadGeneration(sessionLoadGenRef.current);
    sessionLoadGenRef.current = gen;
    const curProject = selectedProjectRef.current;
    const curSession = selectedSessionRef.current;

    const loadMessages = async () => {
      if (curSession && curProject) {
        const curSessionViewKey = getSessionViewIdentityKey(curProject, curSession);
        if (isTemporarySessionId(curSession.id)) {
          lastHydratedSessionIdRef.current = curSession.id;
          lastHydratedSessionViewKeyRef.current = curSessionViewKey;
          setCurrentSessionId(curSession.id);
          return;
        }

        const sessionProvider = resolveSessionProvider(curProject, curSession) || 'codex';
        const sessionProjectName = getSessionProjectName(curProject, curSession);
        const sessionProjectPath = curSession.projectPath || curProject.fullPath || curProject.path || '';
        isLoadingSessionRef.current = true;

        const sessionChanged = currentSessionId !== null && currentSessionId !== curSession.id;
        const shouldResetForConcreteSessionSwitch = sessionChanged && !isTemporarySessionId(currentSessionId);
        const needsFreshSessionView = curSessionViewKey
          ? lastHydratedSessionViewKeyRef.current !== curSessionViewKey
          : lastHydratedSessionIdRef.current !== curSession.id;
        const shouldResetForSessionLoad = shouldResetForConcreteSessionSwitch || needsFreshSessionView;
        if (sessionChanged || needsFreshSessionView) {
          const isDraftToConcreteSessionHandoff =
            sessionChanged &&
            Boolean(currentSessionId) &&
            isTemporarySessionId(currentSessionId) &&
            !isTemporarySessionId(curSession.id);
          const hasLiveNativeRealtimeTail =
            (sessionProvider === 'codex' || sessionProvider === 'pi') &&
            chatMessagesRef.current.some(isNativeLiveTurnMessage);
          const hasOptimisticUserDelivery = chatMessagesRef.current.some((message) => (
            message.type === 'user' &&
            Boolean(message.deliveryStatus) &&
            (
              message.deliveryStatus !== 'persisted' ||
              shouldPreserveAcceptedOptimisticUser(message)
            )
          ));
          if (!isSystemSessionChange || shouldResetForSessionLoad) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            /**
             * PURPOSE: A new manual session first lives on a stable `/cN` draft
             * route, then receives the provider's real session id before jsonl is
             * guaranteed to exist. Keep the local user send visible through that
             * handoff so persisted history can later confirm or fail it.
             */
            if (!hasLiveNativeRealtimeTail && !(isDraftToConcreteSessionHandoff && hasOptimisticUserDelivery)) {
              setChatMessages([]);
            }
            setSessionMessages([]);
            setSessionMessagesError(null);
            setCanAbortSession(false);
          }

          messagesOffsetRef.current = 0;
          latestRawLineCursorRef.current = null;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
          setAllMessagesLoaded(false);
          allMessagesLoadedRef.current = false;
          setFrozenTailMessageKey(null);
          setIsLoadingAllMessages(false);
          isLoadingAllMessagesRef.current = false;
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          setTokenBudget(null);
          setIsLoading(false);

          // Always send check-session-status via sendMessage (which handles queuing
          // when WebSocket is temporarily disconnected) instead of gating on the ws
          // object which may be stale in the useMemo closure.
          sendMessage({
            type: 'check-session-status',
            sessionId: curSession.id,
            provider: sessionProvider,
            projectPath: sessionProjectPath,
          });
        } else if (currentSessionId === null) {
          messagesOffsetRef.current = 0;
          latestRawLineCursorRef.current = null;
          setHasMoreMessages(false);
          setTotalMessages(0);

          sendMessage({
            type: 'check-session-status',
            sessionId: curSession.id,
            provider: sessionProvider,
            projectPath: sessionProjectPath,
          });
        }

        setCurrentSessionId(curSession.id);

        if (!isSystemSessionChange || shouldResetForSessionLoad) {
          const messages = await loadSessionMessages(
            sessionProjectName,
            getSessionLoadId(curSession),
            false,
            sessionProvider,
            sessionProjectPath,
          );
          // Discard stale result: another session switch happened while we were loading.
          if (!isCurrentSessionLoadGeneration({ current: sessionLoadGenRef.current, incoming: gen })) {
            return;
          }
          lastHydratedSessionIdRef.current = curSession.id;
          lastHydratedSessionViewKeyRef.current = curSessionViewKey;
          setSessionMessages(messages);
        } else {
          setIsSystemSessionChange(false);
        }
      } else {
        if (!isSystemSessionChange) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
         setSessionMessages([]);
          setSessionMessagesError(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }

        lastHydratedSessionIdRef.current = null;
        lastHydratedSessionViewKeyRef.current = null;
        setCurrentSessionId(null);
        messagesOffsetRef.current = 0;
        latestRawLineCursorRef.current = null;
        setHasMoreMessages(false);
        setTotalMessages(0);
        setFrozenTailMessageKey(null);
        setTokenBudget(null);
        setSessionMessagesError(null);
      }

      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [
    // 只关注标识变化，不关注对象引用变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedProject?.name,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedSession?.id,
    selectedSessionViewKey,
    isSystemSessionChange,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    sendMessage,
  ]);

  const appendLatestSessionMessages = useCallback(async () => {
    const curProject = selectedProjectRef.current;
    const curSession = selectedSessionRef.current;
    if (!curSession || !curProject) {
      return;
    }

    const gen = sessionLoadGenRef.current;
    try {
      const sessionProjectName = getSessionProjectName(curProject, curSession);
      const knownTotal = totalMessagesRef.current;
      const knownRawLineCursor = latestRawLineCursorRef.current ?? (knownTotal > 0 ? knownTotal : null);
      const sessionLoadId = getSessionLoadId(curSession);
      const isCoSession = /^c\d+$/.test(String(sessionLoadId || ''));
      const sessionProvider = resolveSessionProvider(curProject, curSession) || 'codex';
      const sessionProjectPath = curSession.projectPath || curProject.fullPath || curProject.path || '';

      // Use the provider raw-line cursor for both co-backed and direct session
      // ids because the backend read model consumes afterLine for JSONL files.
      const result = await fetchSessionMessages(
        sessionProjectName,
        sessionLoadId,
        null,
        0,
        sessionProvider,
        knownRawLineCursor,
        null,
        sessionProjectPath,
      );

      // Discard if user navigated away from this session while loading.
      if (!isCurrentSessionLoadGeneration({ current: sessionLoadGenRef.current, incoming: gen })) {
        return;
      }

      const newMessages = result.messages;
      const newTotal = Math.max(
        knownTotal,
        result.total > 0 ? result.total : 0,
        latestRawLineCursorRef.current ?? 0,
        knownTotal + newMessages.length,
      );

      if (newMessages.length === 0 && newTotal === knownTotal) {
        return;
      }

      if (result.tokenUsage) {
        setTokenBudget(result.tokenUsage);
      }

      if (newMessages.length > 0) {
        const shouldKeepCurrentViewport = Boolean(frozenTailMessageKeyRef.current || isUserScrolledUpRef.current);
        const currentFrozenTailKey = frozenTailMessageKeyRef.current;
        const currentFrozenTailExists = currentFrozenTailKey
          ? chatMessagesRef.current.some((message, index) => getViewMessageKey(message, index) === currentFrozenTailKey)
          : false;
        if (shouldKeepCurrentViewport && !currentFrozenTailExists) {
          const currentMessages = chatMessagesRef.current;
          const lastIndex = currentMessages.length - 1;
          if (lastIndex >= 0) {
            const frozenKey = getViewMessageKey(currentMessages[lastIndex], lastIndex);
            frozenTailMessageKeyRef.current = frozenKey;
            setFrozenTailMessageKey(frozenKey);
          }
        }
        advanceLatestRawLineCursor(newMessages, result.nextRawLineOffset);

        if (isCoSession) {
          // Cursor-based refresh: incoming messages with the same messageKey
          // replace existing ones (content growth), new messageKeys append.
          const previousIdentities = new Set(
            sessionMessagesRef.current
              .map(getSessionMessageIdentity)
              .filter((value): value is string => Boolean(value)),
          );
          const newKeyCount = newMessages.filter((message: Record<string, unknown>) => {
            const identity = getSessionMessageIdentity(message);
            return Boolean(identity && !previousIdentities.has(identity));
          }).length;
          setSessionMessages((previous) => {
            const nextMessages = mergeSessionMessagesByIdentityPreservingOrder(previous, newMessages);
            sessionMessagesRef.current = nextMessages;
            return nextMessages;
          });
          messagesOffsetRef.current += newKeyCount;
          if (!shouldKeepCurrentViewport) {
            setVisibleMessageCount((previousCount) => {
              if (!Number.isFinite(previousCount)) {
                return previousCount;
              }
              const nextCount = previousCount + newKeyCount;
              return isFollowingLatestRef.current
                ? Math.max(nextCount, chatMessagesRef.current.length + newKeyCount)
                : nextCount;
            });
          }
        } else {
          const uniqueNewMessages = getUniqueIncomingSessionMessages(
            sessionMessagesRef.current,
            newMessages,
          );
          if (uniqueNewMessages.length === 0) {
            setTotalMessages(newTotal);
            return;
          }

          sessionMessagesRef.current = dedupeSessionMessagesByIdentity([
            ...sessionMessagesRef.current,
            ...uniqueNewMessages,
          ]);
          setChatMessages((previous) =>
            chatMessageReducer(
              { messages: previous },
              { type: 'persistedDeltaAppended', incomingRawMessages: uniqueNewMessages, sessionId: sessionLoadId },
            ).messages);
          messagesOffsetRef.current += uniqueNewMessages.length;
          if (!shouldKeepCurrentViewport) {
            setVisibleMessageCount((previousCount) => {
              if (!Number.isFinite(previousCount)) {
                return previousCount;
              }
              const nextCount = previousCount + uniqueNewMessages.length;
              return isFollowingLatestRef.current
                ? Math.max(nextCount, chatMessagesRef.current.length + uniqueNewMessages.length)
                : nextCount;
            });
          }
        }
      }

      setTotalMessages(newTotal);

      // hasMore 取决于用户已加载的历史头部是否还有更早内容
      const totalLoaded = sessionMessagesRef.current.length;
      if (newTotal > totalLoaded) {
        setHasMoreMessages(true);
      }

      if (allMessagesLoadedRef.current && newTotal > totalLoaded) {
        allMessagesLoadedRef.current = false;
        setAllMessagesLoaded(false);
      }
    } catch (error) {
      console.error('Error appending messages from external update:', error);
    }
  }, [advanceLatestRawLineCursor, fetchSessionMessages]);

  useEffect(() => {
    refreshLatestMessagesRef.current = appendLatestSessionMessages;
  }, [appendLatestSessionMessages]);

  // 外部消息更新（终端 Claude 写入 .jsonl 触发 projects_updated）时，
  // 外部消息更新：用已知行数作为游标，只拉取新增行直接 append。
  // JSONL 是 append-only 的，行号天然单调递增，不需要签名对比。
  useEffect(() => {
    if (!externalMessageUpdate) {
      return;
    }

    void appendLatestSessionMessages();
    // 通过 ref 读取 project/session，依赖不包含对象引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appendLatestSessionMessages,
    externalMessageUpdate,
  ]);

  useEffect(() => {
    if (selectedSession?.id && !isTemporarySessionId(selectedSession.id)) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);

  useEffect(() => {
    const activeSessionId = selectedSession?.id ?? currentSessionId;
    const activeSessionKey = selectedSessionViewKey ?? (activeSessionId
      ? [
        getSessionProjectName(selectedProject, selectedSession),
        resolveSessionProvider(selectedProject, selectedSession) || 'codex',
        activeSessionId,
      ].join(':')
      : null);

    if (
      selectedSession?.id &&
      !isTemporarySessionId(selectedSession.id) &&
      selectedSessionViewKey &&
      lastHydratedSessionViewKeyRef.current !== selectedSessionViewKey
    ) {
      chatMergeSessionKeyRef.current = null;
      setChatMessages([]);
      return;
    }

    const preservePreviousMessages =
      Boolean(activeSessionKey) &&
      chatMergeSessionKeyRef.current === activeSessionKey;
    chatMergeSessionKeyRef.current = activeSessionKey;

    setChatMessages((previous) =>
      chatMessageReducer(
        { messages: previous },
        {
          type: 'persistedReloaded',
          persistedMessages: convertedMessages,
          preservePreviousMessages,
          sessionId: currentSessionId,
        },
      ).messages);
  }, [
    convertedMessages,
    currentSessionId,
    selectedProject,
    selectedSession,
    selectedSessionViewKey,
  ]);

  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      const dedupedMessages = dedupeAdjacentChatMessages(chatMessages) as ChatMessage[];
      const recoveryMessages = trimSessionRecoveryMessages(
        dedupedMessages.filter((message) => (
          isTemporarySessionId(currentSessionId) ||
          message.deliveryStatus === 'sent' ||
          message.deliveryStatus === 'failed' ||
          shouldPreserveAcceptedOptimisticUser(message) ||
          message.source === 'optimistic'
        )),
      );
      safeLocalStorage.setItem(
        getSessionRecoveryStorageKey(selectedProject.name),
        JSON.stringify(recoveryMessages),
      );
    }
  }, [chatMessages, currentSessionId, selectedProject]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || isTemporarySessionId(selectedSession.id)) {
      setTokenBudget(null);
      return;
    }
    if (selectedSession.workflowId) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = resolveSessionProvider(selectedProject, selectedSession);
    if (!sessionProvider) {
      setTokenBudget(null);
      return;
    }
    if (sessionProvider !== 'codex') {
      setTokenBudget(null);
      return;
    }
    const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${sessionProjectName}/sessions/${selectedSession.id}/token-usage?provider=${encodeURIComponent(sessionProvider)}`;
        const response = await authenticatedFetch(url);
        if (response.status === 204) {
          setTokenBudget(null);
        } else if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        // Transient network failure during startup (e.g. Vite HMR reload, page
        // navigation) — not a real error; token budget remains null until next sync.
        console.warn('Non-critical: failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedProject?.name, selectedSession?.id, selectedSession?.__projectName, selectedSession?.__provider, selectedSession?.provider]);

  const visibleMessages = useMemo(() => {
    const displayMessages = filterRenderableMessages(
      dedupeAdjacentChatMessages(chatMessages) as ChatMessage[],
    );
    return buildVisibleMessageWindow(displayMessages, visibleMessageCount, frozenTailMessageKey);
  }, [chatMessages, frozenTailMessageKey, visibleMessageCount]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    container.scrollTop = restoreSessionScrollTop({ height, top }, container.scrollHeight);
    pendingScrollRestoreRef.current = null;
  }, [visibleMessages.length]);

  useEffect(() => {
    if (isFollowingLatest && !isUserScrolledUp) {
      frozenTailMessageKeyRef.current = null;
      setFrozenTailMessageKey(null);
    }
  }, [isFollowingLatest, isUserScrolledUp]);

  // 消息追加（底部增长）不需要调整 scrollTop——浏览器天然保持上方内容位置。
  // 加载更早的历史消息（顶部增长）由 pendingScrollRestoreRef + useLayoutEffect 处理。

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // processingSessions frontend Set has been removed as an authoritative lifecycle source.
  // Loading and abort states are driven exclusively by provider session-status events.

  // Show "Load all" overlay after a batch finishes loading, persist for 2s then hide
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages && !isUserScrolledUpRef.current) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => {
        setShowLoadAllOverlay(false);
      }, 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async (options: LoadAllMessagesOptions = {}) => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessagesRef.current) return;
    const { reveal = false, silent = false } = options;
    const sessionProvider = resolveSessionProvider(selectedProject, selectedSession) || 'codex';
    const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);

    const requestSessionId = selectedSession.id;

    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    isLoadingAllMessagesRef.current = true;
    if (!silent) {
      setIsLoadingAllMessages(true);
    }
    if (!silent) {
      setShowLoadAllOverlay(true);
    }

    const scrollSnapshot = captureSessionScrollSnapshot(scrollContainerRef.current);

    try {
      const { messages: allMessages, total } = await loadSessionMessagesInPages({
        sessionMessages: api.sessionMessages as never,
        projectName: sessionProjectName,
        sessionId: requestSessionId,
        provider: sessionProvider,
      });

      if (currentSessionId !== requestSessionId) return;

      const normalizedAllMessages = Array.isArray(allMessages) ? allMessages : [];

        pendingScrollRestoreRef.current = scrollSnapshot;

        setSessionMessages(normalizedAllMessages);
        setHasMoreMessages(false);
        setTotalMessages(total || normalizedAllMessages.length);
        messagesOffsetRef.current = normalizedAllMessages.length;
        advanceLatestRawLineCursor(normalizedAllMessages, null);

        if (reveal) {
          const loadedMessageCount = normalizedAllMessages.length || INITIAL_VISIBLE_MESSAGES;
          setVisibleMessageCount(Math.max(loadedMessageCount, INITIAL_VISIBLE_MESSAGES));
          setFrozenTailMessageKey(null);
        }
        setAllMessagesLoaded(true);

        if (!silent) {
          setLoadAllJustFinished(true);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          loadAllFinishedTimerRef.current = setTimeout(() => {
            setLoadAllJustFinished(false);
            setShowLoadAllOverlay(false);
          }, 1000);
        }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      isLoadingAllMessagesRef.current = false;
      if (!silent) {
        setIsLoadingAllMessages(false);
      }
    }
  }, [advanceLatestRawLineCursor, selectedSession, selectedProject, currentSessionId]);

  const loadMessagesUntilTarget = useCallback(async ({ messageKey }: LoadMessagesUntilTargetOptions) => {
    /**
     * Search navigation must page older history into memory without using the
     * unbounded load-all endpoint, then let the virtual transcript reveal it.
     */
    if (!messageKey || !selectedSession || !selectedProject) {
      return false;
    }
    if (chatMessagesRef.current.some((message) => message.messageKey === messageKey)) {
      return revealLoadedMessage(messageKey);
    }
    if (isLoadingMoreRef.current || isLoadingAllMessagesRef.current) {
      return false;
    }

    const sessionProvider = resolveSessionProvider(selectedProject, selectedSession) || 'codex';
    const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);
    const requestSessionId = selectedSession.id;
    let loadedMessages = sessionMessagesRef.current;
    let loadedVisibleCount = visibleMessageCount;

    isLoadingMoreRef.current = true;
    setIsLoadingMoreMessages(true);

    try {
      for (let attempts = 0; attempts < 100; attempts += 1) {
        if (!hasMoreMessagesRef.current && totalMessagesRef.current <= messagesOffsetRef.current) {
          allMessagesLoadedRef.current = true;
          setAllMessagesLoaded(true);
          setHasMoreMessages(false);
          return false;
        }

        const currentOffset = messagesOffsetRef.current;
        const requestWindow = createOlderSessionMessageWindow(currentOffset);
        const result = await fetchSessionMessages(
          sessionProjectName,
          requestSessionId,
          requestWindow.limit,
          requestWindow.offset,
          sessionProvider,
          requestWindow.afterLine,
          requestWindow.afterCursor,
        );

        if (currentSessionId !== requestSessionId || result.error) {
          return false;
        }

        const loadedCount = result.messages.length;
        if (loadedCount === 0) {
          setHasMoreMessages(false);
          allMessagesLoadedRef.current = true;
          setAllMessagesLoaded(true);
          return false;
        }

        messagesOffsetRef.current = result.nextRawLineOffset ?? (currentOffset + loadedCount);
        setTotalMessages(result.total > 0 ? result.total : messagesOffsetRef.current);
        const moreAvailable = result.total > 0
          ? result.total > messagesOffsetRef.current
          : result.hasMore;
        hasMoreMessagesRef.current = moreAvailable;
        setHasMoreMessages(moreAvailable);

        const uniqueMoreMessages = getUniqueIncomingSessionMessages(loadedMessages, result.messages);
        if (uniqueMoreMessages.length > 0) {
          loadedMessages = dedupeSessionMessagesByIdentity([
            ...uniqueMoreMessages,
            ...loadedMessages,
          ]);
          sessionMessagesRef.current = loadedMessages;
          setSessionMessages(loadedMessages);
          loadedVisibleCount += uniqueMoreMessages.length;
          setVisibleMessageCount((previousCount) => previousCount + uniqueMoreMessages.length);

          const converted = convertSessionMessages(loadedMessages);
          if (converted.some((message) => message.messageKey === messageKey)) {
            setFrozenTailMessageKey(null);
            frozenTailMessageKeyRef.current = null;
            window.requestAnimationFrame(() => revealLoadedMessage(messageKey));
            return true;
          }
        }

        if (!moreAvailable) {
          allMessagesLoadedRef.current = true;
          setAllMessagesLoaded(true);
          setVisibleMessageCount(Math.max(loadedVisibleCount, INITIAL_VISIBLE_MESSAGES));
          return false;
        }
      }

      return false;
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMoreMessages(false);
    }
  }, [
    currentSessionId,
    fetchSessionMessages,
    revealLoadedMessage,
    selectedProject,
    selectedSession,
    visibleMessageCount,
  ]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((previousCount) => previousCount + SESSION_MESSAGES_PER_PAGE);
  }, []);

  return {
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
    isNearBottom,
    isAtHardBottom,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleKeyDown,
    loadSessionMessages,
  };
}
